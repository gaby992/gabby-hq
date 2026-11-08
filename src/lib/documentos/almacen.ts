// Fase 14: the private bucket. Nothing in `documentos` is public — every
// link the bot or the web hands out is signed and expires, so a forwarded
// Telegram message cannot leak a contract a week later.

import { createServerClient } from '@/lib/supabase-server'
import { cancunYmd } from '@/lib/asistente/cancun'

export const BUCKET = 'documentos'
/** A signed link lives one hour: long enough to open it, short enough to be useless later. */
export const FIRMA_SEGUNDOS = 60 * 60

export class AlmacenError extends Error {}

/** "2026/11/1762549201-contrato-gnp.pdf" — year/month folders keep the bucket browsable. */
export function rutaPara(nombre: string, hoy: string = cancunYmd()): string {
  const limpio = (nombre || 'documento')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'documento'
  return `${hoy.slice(0, 4)}/${hoy.slice(5, 7)}/${Date.now()}-${limpio}`
}

export async function subirArchivo(ruta: string, bytes: ArrayBuffer | Uint8Array, tipo: string): Promise<void> {
  const db = createServerClient()
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const { error } = await db.storage.from(BUCKET).upload(ruta, body, { contentType: tipo, upsert: false })
  if (error) {
    // The bucket is created by the fase 14 SQL; say so instead of the raw message.
    if (/bucket not found/i.test(error.message)) {
      throw new AlmacenError('todavía no existe el archivero (falta correr el SQL de la fase 14 en Supabase)')
    }
    throw new AlmacenError(error.message)
  }
}

/** A link that opens the file and dies in an hour. Null when there is no file (a note). */
export async function enlaceFirmado(ruta: string | null, segundos: number = FIRMA_SEGUNDOS): Promise<string | null> {
  if (!ruta) return null
  const db = createServerClient()
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(ruta, segundos)
  if (error) {
    console.error(`[documentos] firma ${ruta}: ${error.message}`)
    return null
  }
  return data?.signedUrl ?? null
}

/** Signs several routes at once; a failure on one never loses the rest. */
export async function enlacesFirmados(rutas: (string | null)[], segundos: number = FIRMA_SEGUNDOS): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const limpias = Array.from(new Set(rutas.filter((r): r is string => !!r)))
  if (limpias.length === 0) return out
  const db = createServerClient()
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(limpias, segundos)
  if (error) {
    console.error(`[documentos] firmas: ${error.message}`)
    return out
  }
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  }
  return out
}

/** Removes the files of a document. Best-effort: the row is what matters. */
export async function borrarArchivos(rutas: (string | null)[]): Promise<void> {
  const limpias = rutas.filter((r): r is string => !!r)
  if (limpias.length === 0) return
  const { error } = await createServerClient().storage.from(BUCKET).remove(limpias)
  if (error) console.error(`[documentos] borrar ${limpias.join(', ')}: ${error.message}`)
}

/** The bytes of a stored file (the web download and the vision pass use it). */
export async function bajarArchivo(ruta: string): Promise<ArrayBuffer> {
  const { data, error } = await createServerClient().storage.from(BUCKET).download(ruta)
  if (error || !data) throw new AlmacenError(error?.message ?? 'no pude bajar el archivo')
  return data.arrayBuffer()
}
