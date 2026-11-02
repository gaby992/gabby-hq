// Fase 6-C: the Gmail side. Reads new mail for one connected account
// (history since the last cursor, or the last N days the first time), turns
// a message into plain fields (decoded subject, sender, text body capped at
// 3000 chars), archives on request (removes INBOX — the only write) and
// tells whether a thread got a reply from this account.

import { GoogleError, accessToken, type ConexionRow } from '@/lib/google/oauth'

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const CUERPO_MAX = 3000

export interface MensajeGmail {
  id: string
  threadId: string
  labelIds: string[]
  de_nombre: string | null
  de_email: string | null
  asunto: string
  /** ISO instant the message was received (Gmail's internalDate). */
  recibido_en: string
  cuerpo_texto: string
}

async function llamar(conn: ConexionRow, method: string, path: string, body?: unknown): Promise<Record<string, unknown> | null> {
  const token = await accessToken(conn)
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new GoogleError(json?.error?.message ?? `Gmail HTTP ${res.status}`)
    ;(err as GoogleError & { status?: number }).status = res.status
    throw err
  }
  return json
}

export async function perfil(conn: ConexionRow): Promise<{ email: string; historyId: string }> {
  const j = await llamar(conn, 'GET', '/profile')
  return { email: String(j?.emailAddress ?? ''), historyId: String(j?.historyId ?? '') }
}

/**
 * Ids of the messages that arrived since `desdeHistoryId` (INBOX only, no
 * drafts/sent), newest first, at most `max`. With no cursor — or a cursor
 * Gmail no longer remembers (404) — the backlog of the last `dias` days.
 */
export async function listarNuevos(
  conn: ConexionRow,
  opts: { desdeHistoryId: string | null; dias: number; max: number }
): Promise<{ ids: string[]; historyId: string; reinicio: boolean }> {
  const { historyId } = await perfil(conn)
  if (opts.desdeHistoryId) {
    try {
      const ids = new Set<string>()
      let pageToken: string | undefined
      do {
        const q = new URLSearchParams({ startHistoryId: opts.desdeHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: '200' })
        if (pageToken) q.set('pageToken', pageToken)
        const j = await llamar(conn, 'GET', `/history?${q.toString()}`)
        for (const h of (j?.history as { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]) ?? []) {
          for (const m of h.messagesAdded ?? []) {
            const labels = m.message.labelIds ?? []
            if (labels.includes('DRAFT') || labels.includes('SENT') || labels.includes('SPAM') || labels.includes('TRASH')) continue
            ids.add(m.message.id)
          }
        }
        pageToken = typeof j?.nextPageToken === 'string' ? j.nextPageToken : undefined
      } while (pageToken && ids.size < opts.max * 4)
      // Gmail hands them oldest first; the cap keeps the newest.
      return { ids: Array.from(ids).reverse().slice(0, opts.max), historyId, reinicio: false }
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status !== 404) throw err
      console.warn(`[gmail] history ${opts.desdeHistoryId} ya no existe para ${conn.email}: reinicio con los últimos ${opts.dias} días`)
    }
  }
  const q = new URLSearchParams({ q: `newer_than:${opts.dias}d`, labelIds: 'INBOX', maxResults: String(opts.max) })
  const j = await llamar(conn, 'GET', `/messages?${q.toString()}`)
  const ids = ((j?.messages as { id: string }[]) ?? []).map((m) => m.id)
  return { ids, historyId, reinicio: true }
}

// ── Message → fields ─────────────────────────────────────────────────────

interface Parte {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number }
  parts?: Parte[]
}

function base64url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

/** RFC 2047 encoded words ("=?UTF-8?B?...?=") → text. Gmail usually decodes them already; this covers the rest. */
export function decodificarMime(s: string): string {
  return s
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, texto: string) => {
      try {
        const bytes = enc.toUpperCase() === 'B'
          ? Buffer.from(texto, 'base64')
          : Buffer.from(texto.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1')
        const cs = charset.toLowerCase().replace('iso-8859-1', 'latin1')
        return new TextDecoder(cs === 'latin1' ? 'iso-8859-1' : cs).decode(bytes)
      } catch {
        return texto
      }
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Andrew Smith <andrew@tottatl.com>" → { nombre, email }. */
export function partirRemitente(from: string): { nombre: string | null; email: string | null } {
  const m = from.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/)
  if (m) return { nombre: m[1]?.trim() || null, email: m[2].trim().toLowerCase() }
  const solo = from.trim()
  if (/^[^\s@]+@[^\s@]+$/.test(solo)) return { nombre: null, email: solo.toLowerCase() }
  return { nombre: solo || null, email: null }
}

/** Very small HTML → text: drop scripts/styles, turn block ends into newlines, decode a few entities. */
export function htmlATexto(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

function recogerTexto(p: Parte | undefined, acc: { plain: string[]; html: string[] }): void {
  if (!p) return
  const tipo = (p.mimeType ?? '').toLowerCase()
  if (p.body?.data && !p.filename) {
    if (tipo === 'text/plain') acc.plain.push(base64url(p.body.data))
    else if (tipo === 'text/html') acc.html.push(base64url(p.body.data))
  }
  for (const sub of p.parts ?? []) recogerTexto(sub, acc)
}

/** The quoted history under a reply is not "the message": cut at the usual markers. */
function sinCitas(texto: string): string {
  const marcas = [/^On .+ wrote:$/m, /^El .+ escribi[oó]:$/m, /^-----Original Message-----/m, /^From: .+$/m, /^De: .+$/m, /^>/m]
  let corte = texto.length
  for (const re of marcas) {
    const m = texto.match(re)
    if (m && m.index !== undefined && m.index > 40 && m.index < corte) corte = m.index
  }
  return texto.slice(0, corte).trim()
}

export async function obtenerMensaje(conn: ConexionRow, id: string): Promise<MensajeGmail | null> {
  let j: Record<string, unknown> | null
  try {
    j = await llamar(conn, 'GET', `/messages/${encodeURIComponent(id)}?format=full`)
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null
    throw err
  }
  if (!j) return null
  const payload = (j.payload as Parte) ?? {}
  const headers = payload.headers ?? []
  const h = (name: string) => headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  const { nombre, email } = partirRemitente(decodificarMime(h('From')))
  const acc = { plain: [] as string[], html: [] as string[] }
  recogerTexto(payload, acc)
  const crudo = acc.plain.length > 0 ? acc.plain.join('\n') : htmlATexto(acc.html.join('\n'))
  const texto = sinCitas(crudo).replace(/\r/g, '').trim() || String(j.snippet ?? '')
  const internal = Number(j.internalDate ?? 0)
  return {
    id: String(j.id),
    threadId: String(j.threadId ?? ''),
    labelIds: (j.labelIds as string[]) ?? [],
    de_nombre: nombre,
    de_email: email,
    asunto: decodificarMime(h('Subject')) || '(sin asunto)',
    recibido_en: new Date(internal > 0 ? internal : Date.now()).toISOString(),
    cuerpo_texto: texto.slice(0, CUERPO_MAX),
  }
}

/** "Archivar": removes INBOX. The only thing the assistant ever changes in Gmail. */
export async function quitarDeInbox(conn: ConexionRow, id: string): Promise<void> {
  try {
    await llamar(conn, 'POST', `/messages/${encodeURIComponent(id)}/modify`, { removeLabelIds: ['INBOX'] })
  } catch (err) {
    if ((err as { status?: number }).status === 404) return
    throw err
  }
}

/** Did this account send something in the thread after `despuesDe`? (the autoresolver's question) */
export async function hiloRespondido(conn: ConexionRow, threadId: string, despuesDe: string): Promise<boolean> {
  let j: Record<string, unknown> | null
  try {
    j = await llamar(conn, 'GET', `/threads/${encodeURIComponent(threadId)}?format=minimal`)
  } catch (err) {
    if ((err as { status?: number }).status === 404) return false
    throw err
  }
  const desde = new Date(despuesDe).getTime()
  for (const m of (j?.messages as { labelIds?: string[]; internalDate?: string }[]) ?? []) {
    if ((m.labelIds ?? []).includes('SENT') && Number(m.internalDate ?? 0) > desde) return true
  }
  return false
}
