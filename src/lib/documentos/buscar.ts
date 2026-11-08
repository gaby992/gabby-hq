// Fase 14: asking the brain. "¿Con quién tengo el seguro del carro?",
// "¿cuánto pago de alquiler?", "mándame el contrato de Bonampak".
//
// Two steps, always in this order:
//   1. Postgres finds the documents (the `busqueda` tsvector, Spanish).
//   2. The model answers ONLY from what those documents say.
// Then the answer carries a signed link to the document it came from, so she
// can open it right there and check.

import { createServerClient } from '@/lib/supabase-server'
import { preguntarLlm } from '@/lib/asistente/llm'
import { normalizar } from '@/lib/asistente/acciones'
import { cancunYmd, formatVenceEs } from '@/lib/asistente/cancun'
import { escapeHtml } from '@/lib/asistente/telegram'
import { mensajeError } from '@/lib/errores'
import { enlaceFirmado } from './almacen'
import { explicarSupabase } from './ficha'
import { CATEGORIA_EMOJI, montoTexto, type Categoria, type Documento } from './tipos'

export const MAX_RESULTADOS = 6
export const MAX_TOKENS = 350
export const TIMEOUT_MS = 20_000
/** Per document, in the prompt: enough for the clauses that answer, not the whole contract. */
const MAX_TEXTO_POR_DOC = 3_000

export interface Filtros {
  q?: string | null
  categoria?: Categoria | null
  empresa_id?: string | null
  /** Replaced versions are out unless she asks for them. */
  historial?: boolean
  /** Only the ones with a vencimiento. */
  conVencimiento?: boolean
  max?: number
}

/** Words that are the question, not the thing ("¿cuánto pago de alquiler?"). */
const PARADAS = new Set([
  'que', 'qué', 'cual', 'cuál', 'cuanto', 'cuánto', 'cuanta', 'cuánta', 'cuando', 'cuándo', 'donde', 'dónde',
  'quien', 'quién', 'como', 'cómo', 'con', 'sin', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'mi', 'mis', 'me', 'te', 'se', 'lo', 'le', 'y', 'o', 'a', 'en', 'por', 'para', 'es', 'son', 'esta', 'está',
  'tengo', 'tiene', 'tenemos', 'hay', 'pago', 'pagar', 'dime', 'dame', 'muestrame', 'muéstrame', 'mandame', 'mándame',
  'busca', 'buscame', 'búscame', 'encuentra', 'documento', 'documentos', 'archivo', 'archivos', 'papel', 'papeles',
])

/** The question → the words worth searching for, as a websearch query. */
export function consultaDe(pregunta: string): string {
  const palabras = pregunta
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9ñÑ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length >= 3 && !PARADAS.has(w.toLowerCase()))
  return Array.from(new Set(palabras)).slice(0, 8).join(' ')
}

/**
 * The documents that match. The text search comes first; when it finds
 * nothing (a typo, a title in English) the titles are swept with ilike, so
 * "GNP" still lands even if the tsvector stemmed it away.
 */
export async function buscarDocumentos(f: Filtros): Promise<Documento[]> {
  const db = createServerClient()
  const max = f.max ?? MAX_RESULTADOS
  const base = () => {
    let q = db.from('documentos').select('*').eq('historial', f.historial === true)
    if (f.categoria) q = q.eq('categoria', f.categoria)
    if (f.empresa_id) q = q.eq('company_id', f.empresa_id)
    if (f.conVencimiento) q = q.not('vence', 'is', null)
    return q
  }
  const termino = f.q?.trim() ? consultaDe(f.q) : ''

  if (termino) {
    const { data, error } = await base()
      .textSearch('busqueda', termino, { config: 'spanish', type: 'websearch' })
      .order('creado', { ascending: false })
      .limit(max)
    if (error) {
      // A missing column means the SQL has not been run yet: say it clearly.
      if (/busqueda/i.test(error.message)) throw new Error(explicarSupabase(error.message))
      console.error(`[documentos] textSearch: ${error.message}`)
    }
    const hits = (data as Documento[]) ?? []
    if (hits.length > 0) return hits

    const like = `%${f.q!.trim().replace(/[%_]/g, '').slice(0, 60)}%`
    const { data: d2, error: e2 } = await base()
      .or(`titulo.ilike.${like},notas.ilike.${like},resumen.ilike.${like}`)
      .order('creado', { ascending: false })
      .limit(max)
    if (e2) throw new Error(explicarSupabase(e2.message))
    return (d2 as Documento[]) ?? []
  }

  const { data, error } = await base().order('creado', { ascending: false }).limit(max)
  if (error) throw new Error(explicarSupabase(error.message))
  return (data as Documento[]) ?? []
}

/** Everything, for the web list (with its own paging). */
export async function listarDocumentos(f: Filtros & { max?: number; offset?: number }): Promise<{ filas: Documento[]; total: number }> {
  const db = createServerClient()
  const max = f.max ?? 100
  const termino = f.q?.trim() ? consultaDe(f.q) : ''
  let q = db.from('documentos').select('*', { count: 'exact' }).eq('historial', f.historial === true)
  if (f.categoria) q = q.eq('categoria', f.categoria)
  if (f.empresa_id) q = q.eq('company_id', f.empresa_id)
  if (f.conVencimiento) q = q.not('vence', 'is', null)
  if (termino) q = q.textSearch('busqueda', termino, { config: 'spanish', type: 'websearch' })
  const { data, error, count } = await q.order('creado', { ascending: false }).range(f.offset ?? 0, (f.offset ?? 0) + max - 1)
  if (error) {
    // Text search failed (typo, stemming): fall back to the title sweep so the screen is never empty by accident.
    if (termino) {
      const like = `%${f.q!.trim().replace(/[%_]/g, '').slice(0, 60)}%`
      const alt = await db
        .from('documentos')
        .select('*', { count: 'exact' })
        .eq('historial', f.historial === true)
        .or(`titulo.ilike.${like},notas.ilike.${like},resumen.ilike.${like}`)
        .order('creado', { ascending: false })
        .limit(max)
      if (!alt.error) return { filas: (alt.data as Documento[]) ?? [], total: alt.count ?? 0 }
    }
    throw new Error(explicarSupabase(error.message))
  }
  return { filas: (data as Documento[]) ?? [], total: count ?? 0 }
}

// ── The answer ──────────────────────────────────────────────────────────

const SYSTEM =
  'Eres el archivero personal de Gabby. Te doy los DOCUMENTOS que ella guardó (su ficha y su texto) y una PREGUNTA. ' +
  'Respondes la pregunta en MÁXIMO 3 líneas, en español neutro, directo y sin rodeos: primero el dato exacto que pidió. ' +
  'Usas SOLO lo que dicen los documentos. Si el dato no está ahí, lo dices claro: "eso no lo dice el documento" y mencionas qué sí tienes. ' +
  'NUNCA inventas montos, fechas, números de póliza ni nombres. Si hay dos documentos que podrían responder, dices de cuál estás hablando. ' +
  'No repitas la pregunta, no pongas encabezados y no describas el documento completo: solo contesta.'

function fichaParaPrompt(d: Documento, i: number): string {
  const partes = [
    `[${i + 1}] «${d.titulo}» · ${d.categoria}`,
    d.resumen ? `resumen: ${d.resumen}` : null,
    d.fecha_documento ? `fecha del documento: ${d.fecha_documento}` : null,
    d.vence ? `vence: ${d.vence}` : null,
    montoTexto(d.monto, d.moneda) ? `monto: ${montoTexto(d.monto, d.moneda)}` : null,
    d.notas ? `notas: ${d.notas}` : null,
    d.texto ? `texto:\n${d.texto.slice(0, MAX_TEXTO_POR_DOC)}` : '(sin texto: es una nota)',
  ].filter(Boolean)
  return partes.join('\n')
}

export interface RespuestaDocumentos {
  texto: string
  /** The documents the answer came from, best first. */
  usados: Documento[]
}

/**
 * The whole question → the answer plus the signed link. Never throws: a
 * failure comes back as a line she can act on.
 */
export async function responderDeDocumentos(pregunta: string, f: Filtros = {}): Promise<RespuestaDocumentos> {
  let docs: Documento[]
  try {
    docs = await buscarDocumentos({ ...f, q: pregunta, max: f.max ?? 4 })
  } catch (err) {
    return { texto: `⚠️ No pude buscar en el archivero: ${mensajeError(err)}.`, usados: [] }
  }
  if (docs.length === 0) {
    return {
      texto: '📂 No tengo nada guardado sobre eso. Mándame el PDF o la foto, o dime «guarda: …» y lo archivo.',
      usados: [],
    }
  }

  let respuesta: string
  try {
    const user = `DOCUMENTOS:\n${docs.map(fichaParaPrompt).join('\n\n---\n\n')}\n\nHOY: ${cancunYmd()}\n\nPREGUNTA: ${pregunta}`
    const r = await preguntarLlm(SYSTEM, user, { maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS })
    respuesta = r.text.trim()
    console.log(`[documentos] respuesta ok · ${r.model} · ${docs.length} docs · ${r.ms} ms`)
  } catch (err) {
    console.error(`[documentos] respuesta: ${mensajeError(err)}`)
    // The model is down, but the ficha already answers a lot of it.
    respuesta = resumenDeFicha(docs[0])
  }
  if (!respuesta) respuesta = resumenDeFicha(docs[0])

  const lines = [escapeHtml(respuesta).replace(/&lt;/g, '&lt;')]
  lines.push('', await lineaFuente(docs[0]))
  for (const d of docs.slice(1, 3)) lines.push(await lineaFuente(d, true))
  return { texto: lines.join('\n'), usados: docs }
}

/** "📄 Póliza GNP 2026 · Seguros · vence el 15 mar · abrir" with a link that expires. */
export async function lineaFuente(d: Documento, secundaria = false): Promise<string> {
  const emoji = CATEGORIA_EMOJI[d.categoria] ?? '📄'
  const url = await enlaceFirmado(d.ruta)
  const partes = [`${emoji} ${secundaria ? '' : '<b>'}${escapeHtml(d.titulo)}${secundaria ? '' : '</b>'}`, escapeHtml(d.categoria)]
  if (d.vence) partes.push(`vence el ${formatVenceEs(d.vence)}`)
  const linea = partes.join(' · ')
  return url ? `${linea} · <a href="${url}">abrir</a>` : `${linea} · (nota sin archivo)`
}

/** When the model is unavailable: the ficha itself, which is already an answer. */
export function resumenDeFicha(d: Documento): string {
  const partes = [d.resumen ?? d.titulo]
  const monto = montoTexto(d.monto, d.moneda)
  if (monto) partes.push(`Monto: ${monto}.`)
  if (d.vence) partes.push(`Vence el ${formatVenceEs(d.vence)}.`)
  if (d.notas) partes.push(d.notas)
  return partes.join(' ')
}

/** "mándame el contrato de X": the document itself, no model in between. */
export async function buscarUno(termino: string): Promise<Documento | null> {
  const hits = await buscarDocumentos({ q: termino, max: 3 })
  if (hits.length === 0) return null
  if (hits.length === 1) return hits[0]
  // Prefer the one whose title really contains what she said.
  const n = normalizar(termino)
  return hits.find((d) => normalizar(d.titulo).includes(n)) ?? hits[0]
}

/**
 * Does this question smell like paperwork? Used only to decide whether to
 * LOOK in the archivero before answering from tasks — if nothing is found,
 * the normal answer happens anyway, so a false positive costs one query.
 */
const PALABRAS_DOC =
  /(seguro|p[oó]liz|contrato|alquil|renta|arrend|factur|recib|pasaporte|\bine\b|licencia|identificaci|credencial|vence|vencimient|vigencia|cobertur|escritur|\bacta\b|\brfc\b|\bcurp\b|estado de cuenta|p[oó]liza|deducible|prima|documento|archivo|papel|guardado|archivad)/i

export function pareceDeDocumentos(texto: string): boolean {
  return PALABRAS_DOC.test(texto)
}

export async function borrarDocumento(id: string): Promise<void> {
  const { error } = await createServerClient().from('documentos').delete().eq('id', id)
  if (error) throw new Error(explicarSupabase(error.message))
}
