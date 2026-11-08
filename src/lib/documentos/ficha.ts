// Fase 14: from the text of a document to the ficha the bot proposes, and
// from the ficha she approves to the row in `documentos`.
//
// The model only fills in fields; it never decides to save. What it answers
// is always shown first ("Esto entendí…") with [💾 Guardar] [✏️ Corregir],
// because a wrong vencimiento would warn her on the wrong day for a year.

import { createServerClient } from '@/lib/supabase-server'
import { preguntarLlm } from '@/lib/asistente/llm'
import { normalizar } from '@/lib/asistente/acciones'
import { addDays, cancunYmd, formatVenceEs } from '@/lib/asistente/cancun'
import { escapeHtml } from '@/lib/asistente/telegram'
import {
  CATEGORIAS,
  CATEGORIA_EMOJI,
  montoTexto,
  normalizarCategoria,
  type ArchivoGuardado,
  type Documento,
  type OrigenDocumento,
  type Propuesta,
} from './tipos'

export const MAX_TOKENS = 500
export const TIMEOUT_MS = 25_000
/** How much of the document the model reads to fill the ficha. */
export const MAX_CONTEXTO = 12_000

export interface EmpresaRef {
  id: string
  name: string
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() && !/^(null|undefined|n\/a|-)$/i.test(v.trim()) ? v.trim() : undefined
}

function fecha(v: unknown): string | null {
  const s = str(v)
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** "1,250.00" · "$1.250,00 MXN" · 1250 → 1250. Null when there is no amount. */
export function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = str(v)
  if (!s) return null
  // Keep digits and separators, then decide which one is the decimal point.
  const limpio = s.replace(/[^\d.,-]/g, '')
  if (!limpio || !/\d/.test(limpio)) return null
  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')
  let normalizado: string
  if (ultimaComa > ultimoPunto) {
    normalizado = limpio.replace(/\./g, '').replace(',', '.')
  } else {
    normalizado = limpio.replace(/,/g, '')
  }
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

function moneda(v: unknown): string | null {
  const s = str(v)?.toUpperCase().replace(/[^A-Z]/g, '')
  if (!s) return null
  if (s.startsWith('MXN') || s === 'MX' || s === 'PESOS') return 'MXN'
  if (s.startsWith('USD') || s === 'DOLARES' || s === 'DLS') return 'USD'
  if (s.startsWith('EUR')) return 'EUR'
  if (s.startsWith('VES') || s === 'BS') return 'VES'
  if (s.startsWith('COP')) return 'COP'
  return s.slice(0, 6)
}

// ── The prompt ───────────────────────────────────────────────────────────

export function systemPromptFicha(hoy: string, empresas: string[]): string {
  return [
    'Eres el archivero personal de Gabby. Recibes el TEXTO de un documento (contrato, póliza de seguro, contrato de alquiler, factura, recibo, estado de cuenta, identificación, resultado médico) ' +
      'o una NOTA que ella dictó, y devuelves SOLO un JSON con la ficha para archivarlo. Nada fuera del JSON.',
    '',
    'Formato exacto:',
    '{"titulo":"…","categoria":"…","empresa":"…"|null,"resumen":"…","fecha_documento":"YYYY-MM-DD"|null,' +
      '"vence":"YYYY-MM-DD"|null,"monto":1234.56|null,"moneda":"MXN"|null,"se_renueva":true|false,"notas":"…"|null}',
    '',
    'Reglas:',
    '- titulo: corto y reconocible, como lo buscaría ella después: "Póliza del carro GNP 2026", "Contrato de alquiler Av. Bonampak", "Recibo CFE octubre". ' +
      'Incluye la empresa o marca si la hay. Máximo 70 caracteres. NUNCA pongas "documento sin título".',
    `- categoria: UNA de estas, exactamente como está escrita: ${CATEGORIAS.join(' · ')}.`,
    `- empresa: solo si el documento es claramente de una de SUS empresas: ${empresas.join(', ')}. Si es personal o no se ve, null.`,
    '- resumen: 1 o 2 líneas de qué es y para qué sirve, en español neutro. Sin copiar párrafos del documento.',
    '- fecha_documento: la fecha del documento (emisión, firma, corte). null si no aparece.',
    '- vence: cuándo deja de servir o hay que pagar/renovar (vigencia, fecha límite de pago, expiración de una identificación). ' +
      `Hoy es ${hoy}. Si el documento dice "vigencia de 1 año desde el 15 de marzo de 2026", vence = 2027-03-15. Si no hay vencimiento, null. NUNCA inventes una fecha.`,
    '- monto / moneda: el monto principal (prima, renta, total a pagar) como número, sin símbolos; la moneda en 3 letras. Si no hay, null.',
    '- se_renueva: true si es algo que se renueva o se paga periódicamente (póliza, alquiler, suscripción, servicio); false si es un documento de una sola vez (un recibo pagado, un acta).',
    '- notas: datos sueltos que ella querrá tener a mano (número de póliza, cobertura, dirección, nombre del agente, teléfono). Una línea. null si no hay.',
    '',
    'Si el texto es una NOTA dictada ("el seguro del carro es con GNP, se paga en marzo"), igual llena la ficha: ' +
      'titulo "Seguro del carro GNP", categoria "Seguros", notas con el dato, y vence solo si dijo una fecha concreta. Un mes sin año es el próximo que venga.',
    'Si el texto viene cortado o ilegible, llena lo que se pueda y deja el resto en null. No adivines.',
  ].join('\n')
}

/**
 * Text → the proposed ficha. `pista` is the Telegram caption ("el seguro
 * nuevo del carro") or what she typed with a web upload: it outranks the
 * document's own words for the title. Throws when the model fails, so the
 * caller can say so in plain words.
 */
export async function proponerFicha(opts: {
  texto: string
  nombreArchivo?: string | null
  pista?: string | null
  empresas: EmpresaRef[]
  hoy?: string
  esNota?: boolean
}): Promise<Propuesta> {
  const hoy = opts.hoy ?? cancunYmd()
  const nombres = opts.empresas.map((e) => e.name.trim())
  const partes: string[] = []
  if (opts.pista) partes.push(`LO QUE ELLA DIJO AL MANDARLO (manda sobre el título): ${opts.pista}`)
  if (opts.nombreArchivo) partes.push(`NOMBRE DEL ARCHIVO: ${opts.nombreArchivo}`)
  partes.push(`${opts.esNota ? 'NOTA DICTADA' : 'TEXTO DEL DOCUMENTO'}:\n${opts.texto.slice(0, MAX_CONTEXTO) || '(sin texto legible)'}`)

  const r = await preguntarLlm(systemPromptFicha(hoy, nombres), partes.join('\n\n'), {
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
    json: true,
  })
  let json: Record<string, unknown>
  try {
    const t = r.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    json = JSON.parse(t.startsWith('{') ? t : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
  } catch {
    throw new Error('el modelo no devolvió una ficha legible')
  }
  console.log(`[documentos] ficha ok · ${r.model} · in ${r.tokensIn} · out ${r.tokensOut} · ${r.ms} ms`)
  return limpiarPropuesta(json, { pista: opts.pista, nombreArchivo: opts.nombreArchivo, empresas: nombres, hoy })
}

/** The model's JSON → a Propuesta that is always safe to show and save. */
export function limpiarPropuesta(
  json: Record<string, unknown>,
  ctx: { pista?: string | null; nombreArchivo?: string | null; empresas: string[]; hoy: string }
): Propuesta {
  const titulo = (str(json.titulo) ?? str(ctx.pista) ?? str(ctx.nombreArchivo)?.replace(/\.[a-z0-9]{2,5}$/i, '') ?? 'Documento sin título').slice(0, 120)
  // The company only counts when it is really one of hers.
  const empresaRaw = str(json.empresa)
  const empresa = empresaRaw
    ? ctx.empresas.find((n) => normalizar(n) === normalizar(empresaRaw)) ?? ctx.empresas.find((n) => normalizar(empresaRaw).includes(normalizar(n))) ?? null
    : null
  const vence = fecha(json.vence)
  return {
    titulo,
    categoria: normalizarCategoria(json.categoria),
    empresa,
    resumen: str(json.resumen)?.slice(0, 600) ?? null,
    fecha_documento: fecha(json.fecha_documento),
    // A vencimiento in the far past is almost always a misread year.
    vence: vence && vence >= addDays(ctx.hoy, -3650) ? vence : null,
    monto: numero(json.monto),
    moneda: moneda(json.moneda),
    se_renueva: json.se_renueva === true,
    notas: str(json.notas)?.slice(0, 600) ?? null,
  }
}

// ── How the proposal reads in Telegram ───────────────────────────────────

/** "Esto entendí" + the fields that have something, one per line. */
export function renderPropuesta(p: Propuesta, opts: { archivos?: number; cabecera?: string } = {}): string {
  const emoji = CATEGORIA_EMOJI[p.categoria] ?? '📄'
  const lines: string[] = [opts.cabecera ?? '📥 <b>Esto entendí</b>']
  lines.push(`${emoji} <b>${escapeHtml(p.titulo)}</b>`)
  lines.push(`🗂 ${escapeHtml(p.categoria)}${p.empresa ? ` · ${escapeHtml(p.empresa)}` : ''}`)
  if (p.resumen) lines.push(`📝 ${escapeHtml(p.resumen)}`)
  if (p.fecha_documento) lines.push(`📅 Del ${formatVenceEs(p.fecha_documento)}`)
  if (p.vence) lines.push(`⏳ Vence el ${formatVenceEs(p.vence)}${p.se_renueva ? ' (se renueva)' : ''}`)
  else if (p.se_renueva) lines.push('🔄 Se renueva (sin fecha de vencimiento)')
  const monto = montoTexto(p.monto, p.moneda)
  if (monto) lines.push(`💵 ${escapeHtml(monto)}`)
  if (p.notas) lines.push(`📌 ${escapeHtml(p.notas)}`)
  if (opts.archivos && opts.archivos > 1) lines.push(`📎 ${opts.archivos} páginas`)
  return lines.join('\n')
}

/** The one-line confirmation after it is saved. */
export function confirmacionGuardado(d: Documento, opts: { reemplazo?: Documento | null } = {}): string {
  const emoji = CATEGORIA_EMOJI[d.categoria] ?? '📄'
  const partes = [`${emoji} Guardado: «${escapeHtml(d.titulo)}»`, escapeHtml(d.categoria)]
  if (d.vence) partes.push(`vence el ${formatVenceEs(d.vence)}`)
  let texto = `✓ ${partes.join(' · ')}`
  if (opts.reemplazo) texto += `\n🔄 La versión anterior («${escapeHtml(opts.reemplazo.titulo)}») queda en el historial.`
  return texto
}

// ── Saving ──────────────────────────────────────────────────────────────

/**
 * The approved ficha becomes a row. The first file is the document's own
 * `ruta`; the rest travel in `notas` as extra pages, so one contract of five
 * photos is ONE thing in the brain, not five.
 */
export async function guardarDocumento(opts: {
  propuesta: Propuesta
  archivos?: ArchivoGuardado[]
  empresas: EmpresaRef[]
  origen: OrigenDocumento
  reemplazaA?: string | null
}): Promise<Documento> {
  const db = createServerClient()
  const archivos = opts.archivos ?? []
  const p = opts.propuesta
  const empresa = p.empresa ? opts.empresas.find((e) => normalizar(e.name) === normalizar(p.empresa!)) ?? null : null
  const texto = archivos.map((a) => a.texto ?? '').filter(Boolean).join('\n\n--- página ---\n\n') || null
  const paginas = archivos.length > 1 ? archivos.length : archivos[0]?.paginas ?? null

  const row = {
    titulo: p.titulo,
    categoria: p.categoria,
    company_id: empresa?.id ?? null,
    ruta: archivos[0]?.ruta ?? null,
    tipo: archivos[0]?.tipo ?? null,
    paginas,
    texto,
    resumen: p.resumen ?? null,
    fecha_documento: p.fecha_documento ?? null,
    vence: p.vence ?? null,
    monto: p.monto ?? null,
    moneda: p.moneda ?? null,
    se_renueva: p.se_renueva === true,
    // The other pages' routes live with the notes so nothing is orphaned.
    notas: [p.notas ?? null, archivos.length > 1 ? `Páginas: ${archivos.map((a) => a.ruta).join(' | ')}` : null].filter(Boolean).join('\n') || null,
    reemplaza_a: opts.reemplazaA ?? null,
    origen: opts.origen,
  }
  const { data, error } = await db.from('documentos').insert(row).select('*').single<Documento>()
  if (error) throw new Error(explicarSupabase(error.message))

  // A renewal: the old version stops counting for vencimientos but is kept.
  if (opts.reemplazaA) {
    const { error: e2 } = await db.from('documentos').update({ historial: true }).eq('id', opts.reemplazaA)
    if (e2) console.error(`[documentos] historial ${opts.reemplazaA}: ${e2.message}`)
  }
  return data
}

/** A missing table is the usual cause; say what to do instead of the Postgres line. */
export function explicarSupabase(mensaje: string): string {
  if (/relation "?documentos/i.test(mensaje) || /does not exist/i.test(mensaje)) {
    return 'todavía no existe el archivero en la base (falta correr el SQL de la fase 14 en Supabase)'
  }
  return mensaje
}

export async function actualizarDocumento(id: string, cambios: Partial<Propuesta> & { empresa_id?: string | null }): Promise<Documento> {
  const row: Record<string, unknown> = {}
  if (cambios.titulo !== undefined) row.titulo = cambios.titulo
  if (cambios.categoria !== undefined) row.categoria = normalizarCategoria(cambios.categoria)
  if (cambios.empresa_id !== undefined) row.company_id = cambios.empresa_id
  if (cambios.resumen !== undefined) row.resumen = cambios.resumen
  if (cambios.fecha_documento !== undefined) row.fecha_documento = cambios.fecha_documento
  if (cambios.vence !== undefined) row.vence = cambios.vence
  if (cambios.monto !== undefined) row.monto = cambios.monto
  if (cambios.moneda !== undefined) row.moneda = cambios.moneda
  if (cambios.se_renueva !== undefined) row.se_renueva = cambios.se_renueva === true
  if (cambios.notas !== undefined) row.notas = cambios.notas
  const { data, error } = await createServerClient().from('documentos').update(row).eq('id', id).select('*').single<Documento>()
  if (error) throw new Error(explicarSupabase(error.message))
  return data
}

export async function documentoPorId(id: string): Promise<Documento | null> {
  const { data, error } = await createServerClient().from('documentos').select('*').eq('id', id).maybeSingle<Documento>()
  if (error) throw new Error(explicarSupabase(error.message))
  return data
}

// ── Renewals: "¿esto reemplaza a lo anterior?" ───────────────────────────

/** Words that say nothing about which document it is. */
const RUIDO = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'para', 'por', 'con', 'en', 'un', 'una',
  'documento', 'contrato', 'poliza', 'recibo', 'factura', 'estado', 'cuenta', 'copia', 'nuevo', 'nueva',
  'renovacion', 'renovado', 'renovada', 'version', 'final', 'firmado', 'firmada', 'escaneado',
])

export function clavesDe(titulo: string): string[] {
  return normalizar(titulo)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !RUIDO.has(w) && !/^\d{1,2}$/.test(w))
}

/** 0–1: how much two titles talk about the same thing. */
export function parecido(a: string, b: string): number {
  const ka = clavesDe(a)
  const kb = new Set(clavesDe(b))
  if (ka.length === 0 || kb.size === 0) return 0
  const comunes = ka.filter((w) => kb.has(w)).length
  return comunes / Math.max(ka.length, kb.size)
}

/**
 * The document this one probably renews: same category, same company, and a
 * title that talks about the same thing. Only the live versions count — a
 * document already in the historial was replaced once already.
 */
export async function posibleAnterior(p: Propuesta, empresas: EmpresaRef[]): Promise<Documento | null> {
  const db = createServerClient()
  const empresa = p.empresa ? empresas.find((e) => normalizar(e.name) === normalizar(p.empresa!)) ?? null : null
  let q = db.from('documentos').select('*').eq('categoria', p.categoria).eq('historial', false).order('creado', { ascending: false }).limit(25)
  q = empresa ? q.eq('company_id', empresa.id) : q.is('company_id', null)
  const { data, error } = await q
  if (error) {
    console.error(`[documentos] posibleAnterior: ${error.message}`)
    return null
  }
  let mejor: Documento | null = null
  let mejorPuntos = 0
  for (const d of (data as Documento[]) ?? []) {
    const puntos = parecido(p.titulo, d.titulo)
    if (puntos > mejorPuntos) {
      mejor = d
      mejorPuntos = puntos
    }
  }
  return mejorPuntos >= 0.5 ? mejor : null
}

export async function marcarHistorial(id: string, historial = true): Promise<void> {
  const { error } = await createServerClient().from('documentos').update({ historial }).eq('id', id)
  if (error) throw new Error(explicarSupabase(error.message))
}

/** The question when something that already exists comes in again. */
export function preguntaRenovacion(nuevo: Propuesta, anterior: Documento): string {
  const desde = anterior.vence ? ` (vencía el ${formatVenceEs(anterior.vence)})` : anterior.fecha_documento ? ` (del ${formatVenceEs(anterior.fecha_documento)})` : ''
  return [
    `🔄 Ya tengo algo parecido: «${escapeHtml(anterior.titulo)}»${desde}.`,
    `¿Este «${escapeHtml(nuevo.titulo)}» lo reemplaza? La versión vieja no se borra, queda en el historial.`,
  ].join('\n')
}

/** What the deletion of a document says, before doing it. */
export function describirCorto(d: Documento): string {
  const emoji = CATEGORIA_EMOJI[d.categoria] ?? '📄'
  return `${emoji} «${d.titulo}» · ${d.categoria}${d.vence ? ` · vence ${formatVenceEs(d.vence)}` : ''}`
}
