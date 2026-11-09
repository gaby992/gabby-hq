// Fase 14: everything that happens between "llegó un archivo" and "guardado".
//
// A draft (documentos_borradores) holds what the bot proposed while it waits
// for [💾 Guardar] / [✏️ Corregir]. Every button carries its OWN draft id, so
// several can wait at the same time: she can send a contract, then a recibo,
// and save each one from its own message, in any order.
//
// Three things she asked for live here:
//   · varias fotos = un documento ("¿es página del mismo documento?")
//   · notas sin archivo ("guarda: el seguro del carro es con GNP")
//   · renovaciones (la póliza nueva reemplaza a la vieja, que queda en el historial)

import { createServerClient } from '@/lib/supabase-server'
import { preguntarLlm } from '@/lib/asistente/llm'
import { cancunYmd } from '@/lib/asistente/cancun'
import { escapeHtml, inlineKeyboard } from '@/lib/asistente/telegram'
import { mensajeError } from '@/lib/errores'
import { rutaPara, subirArchivo } from './almacen'
import { extraerTexto } from './extraer'
import {
  confirmacionGuardado,
  explicarSupabase,
  guardarDocumento,
  limpiarPropuesta,
  posibleAnterior,
  preguntaRenovacion,
  proponerFicha,
  renderPropuesta,
  type EmpresaRef,
} from './ficha'
import {
  CATEGORIAS,
  TELEGRAM_MAX_BYTES,
  TIPOS_ACEPTADOS,
  esImagen,
  type ArchivoGuardado,
  type Documento,
  type OrigenDocumento,
  type Propuesta,
} from './tipos'

/** A draft waits a whole day: she may send a contract at night and finish in the morning. */
export const BORRADOR_DOC_TTL_MS = 24 * 60 * 60 * 1000
/** Photos that arrive this close together may be pages of one thing. */
export const VENTANA_PAGINAS_MS = 5 * 60 * 1000

export type EstadoBorrador = 'propuesto' | 'esperando_paginas' | 'corrigiendo' | 'preguntando_renovacion'

export interface BorradorDoc {
  id: string
  chat_id: number
  estado: EstadoBorrador
  propuesta: Propuesta
  archivos: ArchivoGuardado[]
  reemplaza_a: string | null
  documento_id: string | null
  creado: string
}

/** What the engine has to send: the text, and the buttons if any. */
export interface Salida {
  texto: string
  botones?: unknown
  /** True when nothing is pending any more (the engine may then suggest something). */
  cerrado?: boolean
}

// ── Draft rows ───────────────────────────────────────────────────────────

export async function crearBorradorDoc(
  chatId: number,
  campos: { estado?: EstadoBorrador; propuesta: Propuesta; archivos?: ArchivoGuardado[]; reemplaza_a?: string | null; documento_id?: string | null }
): Promise<BorradorDoc> {
  const { data, error } = await createServerClient()
    .from('documentos_borradores')
    .insert({
      chat_id: chatId,
      estado: campos.estado ?? 'propuesto',
      propuesta: campos.propuesta,
      archivos: campos.archivos ?? [],
      reemplaza_a: campos.reemplaza_a ?? null,
      documento_id: campos.documento_id ?? null,
    })
    .select('*')
    .single<BorradorDoc>()
  if (error) throw new Error(explicarSupabase(error.message))
  return data
}

export async function borradorDocPorId(id: string): Promise<BorradorDoc | null> {
  const { data, error } = await createServerClient().from('documentos_borradores').select('*').eq('id', id).maybeSingle<BorradorDoc>()
  if (error) throw new Error(explicarSupabase(error.message))
  if (!data) return null
  return Date.now() - new Date(data.creado).getTime() > BORRADOR_DOC_TTL_MS ? null : data
}

/** The newest live draft of this chat (what a new photo or a correction applies to). */
export async function borradorDocVigente(chatId: number): Promise<BorradorDoc | null> {
  const { data, error } = await createServerClient()
    .from('documentos_borradores')
    .select('*')
    .eq('chat_id', chatId)
    .order('creado', { ascending: false })
    .limit(1)
    .maybeSingle<BorradorDoc>()
  if (error) {
    console.error(`[documentos] borrador vigente: ${error.message}`)
    return null
  }
  if (!data) return null
  return Date.now() - new Date(data.creado).getTime() > BORRADOR_DOC_TTL_MS ? null : data
}

export async function actualizarBorradorDoc(id: string, patch: Partial<Pick<BorradorDoc, 'estado' | 'propuesta' | 'archivos' | 'reemplaza_a' | 'documento_id'>>): Promise<void> {
  const { error } = await createServerClient().from('documentos_borradores').update(patch).eq('id', id)
  if (error) throw new Error(explicarSupabase(error.message))
}

export async function borrarBorradorDoc(id: string): Promise<void> {
  await createServerClient().from('documentos_borradores').delete().eq('id', id)
}

// ── Buttons ──────────────────────────────────────────────────────────────

export function botonesPropuesta(id: string) {
  return inlineKeyboard([[
    { text: '💾 Guardar', callback_data: `dg:${id}` },
    { text: '✏️ Corregir', callback_data: `dc:${id}` },
  ]])
}

export function botonesPaginas(id: string) {
  return inlineKeyboard([[
    { text: '📎 Sí, misma', callback_data: `dm:${id}` },
    { text: '📄 No, otro', callback_data: `do:${id}` },
  ]])
}

export function botonesRenovacion(id: string) {
  return inlineKeyboard([[
    { text: '🔄 Sí, reemplaza', callback_data: `dr:${id}` },
    { text: '📄 No, aparte', callback_data: `dn:${id}` },
  ]])
}

export const COMO_CORREGIR_DOC =
  '✏️ Dime qué cambio, en una línea: «el título es Póliza del carro 2027», «vence el 15 de marzo», «es de IM», «categoría seguros», «el monto son 18,400 pesos», «quítale el vencimiento».'

// ── A file arrives ───────────────────────────────────────────────────────

export interface ArchivoEntrante {
  bytes: ArrayBuffer
  nombre: string
  tipo: string
  /** What she wrote with it (Telegram caption or the web's note). */
  pista?: string | null
  /** True for a Telegram photo — only those are asked about as pages. */
  esFoto?: boolean
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

/** The sentence for a file Telegram refuses to hand over (over 20 MB). */
export function avisoDemasiadoGrande(nombre: string, bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1)
  return [
    `📦 «${escapeHtml(nombre)}» pesa ${mb} MB y Telegram solo me deja bajar archivos de hasta 20 MB.`,
    `Súbelo por la web y lo archivo igual: <a href="${appUrl()}/archivos">abrir Archivos</a>.`,
  ].join('\n')
}

export function avisoTipoNoSirve(nombre: string, tipo: string): string {
  return `🤷 «${escapeHtml(nombre)}» es un ${escapeHtml(tipo || 'archivo desconocido')} y todavía no sé leer eso. Mándame el PDF o una foto, o dime «guarda: …» con el dato.`
}

/** Store the file and read its text. */
export async function guardarArchivo(a: ArchivoEntrante): Promise<ArchivoGuardado> {
  const ruta = rutaPara(a.nombre, cancunYmd())
  await subirArchivo(ruta, a.bytes, a.tipo)
  const ex = await extraerTexto(a.bytes, a.tipo)
  return { ruta, tipo: a.tipo, nombre: a.nombre, paginas: ex.paginas ?? undefined, texto: ex.texto || undefined }
}

/**
 * The whole intake of one file: store it, read it, propose the ficha, and
 * decide whether to ask about pages or about a renewal first.
 */
export async function recibirArchivo(chatId: number, a: ArchivoEntrante, empresas: EmpresaRef[]): Promise<Salida> {
  if (!TIPOS_ACEPTADOS.includes(a.tipo)) return { texto: avisoTipoNoSirve(a.nombre, a.tipo), cerrado: true }

  const guardado = await guardarArchivo(a)

  // Varias fotos = un documento: a photo right after another, with its ficha still waiting.
  if (a.esFoto) {
    const previo = await borradorDocVigente(chatId)
    const fresco = previo && Date.now() - new Date(previo.creado).getTime() < VENTANA_PAGINAS_MS
    if (previo && fresco && previo.estado === 'propuesto' && previo.archivos.length > 0 && previo.archivos.every((x) => esImagen(x.tipo))) {
      await actualizarBorradorDoc(previo.id, { estado: 'esperando_paginas', archivos: [...previo.archivos, guardado] })
      return {
        texto: `📎 Llegó otra foto. ¿Es página del mismo documento, «${escapeHtml(previo.propuesta.titulo)}»?`,
        botones: botonesPaginas(previo.id),
      }
    }
  }

  return proponerYPreguntar(chatId, [guardado], { pista: a.pista, nombreArchivo: a.nombre, empresas, origen: 'telegram' })
}

/**
 * Files in hand → the ficha on screen. Shared by Telegram, the web upload
 * and the "misma página" merge, so the three propose exactly the same way.
 */
export async function proponerYPreguntar(
  chatId: number,
  archivos: ArchivoGuardado[],
  opts: { pista?: string | null; nombreArchivo?: string | null; empresas: EmpresaRef[]; origen: OrigenDocumento; esNota?: boolean }
): Promise<Salida> {
  const texto = archivos.map((x) => x.texto ?? '').filter(Boolean).join('\n\n--- página ---\n\n')
  let propuesta: Propuesta
  try {
    propuesta = await proponerFicha({
      texto: texto || (opts.pista ?? ''),
      nombreArchivo: opts.nombreArchivo ?? archivos[0]?.nombre ?? null,
      pista: opts.pista ?? null,
      empresas: opts.empresas,
      esNota: opts.esNota,
    })
  } catch (err) {
    console.error(`[documentos] ficha: ${mensajeError(err)}`)
    // Guardado está: lo que falló fue entender de qué es. Que lo diga ella.
    propuesta = limpiarPropuesta({}, { pista: opts.pista, nombreArchivo: opts.nombreArchivo ?? archivos[0]?.nombre, empresas: opts.empresas.map((e) => e.name.trim()), hoy: cancunYmd() })
    const b = await crearBorradorDoc(chatId, { estado: 'corrigiendo', propuesta, archivos })
    return {
      texto: [
        '📥 Me llegó y lo tengo guardado, pero no pude leer de qué es (el modelo no contestó).',
        `Dime el título y la categoría y lo archivo: «es la póliza del carro, categoría seguros». Categorías: ${CATEGORIAS.join(' · ')}.`,
      ].join('\n'),
      botones: botonesPropuesta(b.id),
    }
  }

  const sinTexto = !texto
  const anterior = await posibleAnterior(propuesta, opts.empresas)
  const b = await crearBorradorDoc(chatId, {
    estado: anterior ? 'preguntando_renovacion' : 'propuesto',
    propuesta,
    archivos,
    reemplaza_a: anterior?.id ?? null,
  })
  const cuerpo = renderPropuesta(propuesta, { archivos: archivos.length })
  const aviso = sinTexto && archivos.length > 0 ? '\n⚠️ No pude leer el texto del archivo, así que la ficha salió de lo que me dijiste y del nombre. Revísala.' : ''

  if (anterior) {
    return { texto: `${cuerpo}${aviso}\n\n${preguntaRenovacion(propuesta, anterior)}`, botones: botonesRenovacion(b.id) }
  }
  return { texto: `${cuerpo}${aviso}`, botones: botonesPropuesta(b.id) }
}

// ── Notes with no file ───────────────────────────────────────────────────

/** "guarda: …", "anota en el cerebro …", "archiva este dato: …" → the text to file. */
const RE_NOTA_CEREBRO = /^(?:guarda(?:me)?|gu[aá]rdalo|anota|ap[uú]ntame|ap[uú]nta|archiva|rec[ué]erda(?:me)?|memoriza)\b(?:\s+(?:esto|este\s+dato|el\s+dato|en\s+el\s+cerebro|en\s+mis\s+documentos|en\s+archivos?))?\s*[:,]\s*([\s\S]+)$/i

/** The sentence she dictated, or null when the message is not one of these. */
export function leerNotaCerebro(texto: string): string | null {
  // "Gabita, guarda: …" — el cerebro tiene nombre; llamarlo no cambia la orden.
  const m = texto.trim().replace(/^(?:oye\s+)?gabita\s*[,:.]?\s+/i, '').match(RE_NOTA_CEREBRO)
  const dato = m?.[1]?.trim()
  // "guarda: listo" is not a document; a real note has something in it.
  return dato && dato.length >= 8 ? dato : null
}

export async function recibirNota(chatId: number, dato: string, empresas: EmpresaRef[]): Promise<Salida> {
  return proponerYPreguntar(chatId, [], { pista: dato, empresas, origen: 'nota', esNota: true })
}

// ── The buttons ─────────────────────────────────────────────────────────

/** [💾 Guardar] — the only place a row is written. */
export async function guardar(b: BorradorDoc, empresas: EmpresaRef[], opts: { reemplazar?: boolean } = {}): Promise<Salida> {
  const reemplazaA = opts.reemplazar === false ? null : b.reemplaza_a
  let anterior: Documento | null = null
  if (reemplazaA) {
    const { data } = await createServerClient().from('documentos').select('*').eq('id', reemplazaA).maybeSingle<Documento>()
    anterior = (data as Documento) ?? null
  }
  const d = await guardarDocumento({
    propuesta: b.propuesta,
    archivos: b.archivos,
    empresas,
    origen: b.archivos.length === 0 ? 'nota' : 'telegram',
    reemplazaA,
  })
  await borrarBorradorDoc(b.id)
  const lines = [confirmacionGuardado(d, { reemplazo: anterior })]
  lines.push(`Pregúntame lo que quieras de esto cuando lo necesites · <a href="${appUrl()}/archivos">ver Archivos</a>`)
  return { texto: lines.join('\n'), cerrado: true }
}

/** [📎 Sí, misma] — the pages become one document and the ficha is proposed again. */
export async function unirPaginas(b: BorradorDoc, empresas: EmpresaRef[]): Promise<Salida> {
  return proponerYPreguntar(b.chat_id, b.archivos, {
    pista: b.propuesta.titulo,
    nombreArchivo: b.archivos[0]?.nombre ?? null,
    empresas,
    origen: 'telegram',
  }).then(async (s) => {
    // The merged draft replaces the one that was waiting for the answer.
    await borrarBorradorDoc(b.id)
    return s
  })
}

/** [📄 No, otro] — the new file goes on its own; the earlier ficha keeps waiting on its own message. */
export async function separarPaginas(b: BorradorDoc, empresas: EmpresaRef[]): Promise<Salida> {
  const ultimo = b.archivos[b.archivos.length - 1]
  const previos = b.archivos.slice(0, -1)
  await actualizarBorradorDoc(b.id, { estado: 'propuesto', archivos: previos })
  const s = await proponerYPreguntar(b.chat_id, ultimo ? [ultimo] : [], {
    nombreArchivo: ultimo?.nombre ?? null,
    empresas,
    origen: 'telegram',
  })
  return { ...s, texto: `Ok, son dos cosas distintas. El anterior («${escapeHtml(b.propuesta.titulo)}») sigue esperando tu 💾 en su mensaje.\n\n${s.texto}` }
}

// ── Corrections ─────────────────────────────────────────────────────────

const SYSTEM_CORREGIR =
  'Eres el archivero personal de Gabby. Te doy la FICHA actual de un documento (JSON) y una CORRECCIÓN que ella dictó. ' +
  'Devuelves SOLO el JSON completo de la ficha corregida, con los mismos campos: ' +
  '{"titulo","categoria","empresa","resumen","fecha_documento","vence","monto","moneda","se_renueva","notas"}. ' +
  'Cambias ÚNICAMENTE lo que ella corrige; todo lo demás se queda exactamente igual. ' +
  'Si dice "quítale el vencimiento" o "no vence", pon vence en null. Si dice "no es de ninguna empresa", empresa null. ' +
  `Las categorías posibles son: ${CATEGORIAS.join(' · ')}. Las fechas van en YYYY-MM-DD. Nada fuera del JSON.`

/** Her phrase → the corrected ficha, shown again with the same two buttons. */
export async function corregir(b: BorradorDoc, frase: string, empresas: EmpresaRef[]): Promise<Salida> {
  const nombres = empresas.map((e) => e.name.trim())
  let propuesta = b.propuesta
  try {
    const user = `FICHA ACTUAL:\n${JSON.stringify(b.propuesta)}\n\nEMPRESAS POSIBLES: ${nombres.join(', ')}\nHOY: ${cancunYmd()}\n\nCORRECCIÓN: ${frase}`
    const r = await preguntarLlm(SYSTEM_CORREGIR, user, { maxTokens: 400, timeoutMs: 20_000, json: true })
    const t = r.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    const json = JSON.parse(t.startsWith('{') ? t : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) as Record<string, unknown>
    propuesta = limpiarPropuesta(json, { empresas: nombres, hoy: cancunYmd() })
  } catch (err) {
    console.error(`[documentos] corregir: ${mensajeError(err)}`)
    return {
      texto: '⚠️ No pude aplicar la corrección (el modelo no contestó). Dímelo otra vez en una línea, por ejemplo «el título es Póliza del carro 2027».',
      botones: botonesPropuesta(b.id),
    }
  }
  await actualizarBorradorDoc(b.id, { estado: 'propuesto', propuesta })
  return {
    texto: renderPropuesta(propuesta, { archivos: b.archivos.length, cabecera: '📥 <b>Así queda</b>' }),
    botones: botonesPropuesta(b.id),
  }
}

/** Telegram's file object, as the webhook sees it. */
export interface TelegramFile {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

/** Telegram photos come as several sizes; the biggest is the one worth reading. */
export function fotoMasGrande(photos: { file_id: string; file_size?: number; width?: number }[]): { file_id: string; file_size?: number } | null {
  if (!Array.isArray(photos) || photos.length === 0) return null
  return photos.reduce((mejor, p) => ((p.width ?? 0) > (mejor.width ?? 0) ? p : mejor), photos[0])
}

export { TELEGRAM_MAX_BYTES }
