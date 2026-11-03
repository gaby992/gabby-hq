// Ajuste 6-0 / 6-2 / 6-3: the mail lines of every list, the "correos"
// list of an account, and striking a line through in place.
//
//   📧 IM Chelsea (7)
//   📧 15. ✴️ Andrew (TOTT) · Landing page changes · hace 3h
//   📧 16. Lion's Gate (TOTT) · Invoice · hace 5h · 📨 Chelsea
//   · +2 más → correos
//   ✅ respondido · Lion's Gate (TOTT) · Proposal
//
// The numbers continue the list's own sequence, so "el 15 lo hago yo" works
// like "listo 3". The "correos" command sends the WHOLE pending list of one
// account grouped by urgency and records it (tipo 'correos').

import { CORREO_URGENCIA_EMOJI, type CuentaCorreo } from '@/types'
import { TELEGRAM_MAX, editMessageText, escapeHtml, sendTelegram } from '@/lib/asistente/telegram'
import { actualizarTextoAlarma, guardarAlarma, ultimaListaCon, type AlarmaItem } from '@/lib/asistente/registro-listas'
import { mensajeError } from '@/lib/errores'
import { cargarCuentas } from './cuentas'
import { correosPendientes, correosRespondidosVip, grupoDe, haceCuanto, quienCorto, type CorreoLite, type GrupoCorreo } from './pendientes'

/** Lines per account inside the 8:00 / 6:00 pm lists before "+N más → correos". */
export const MAX_EN_LISTA_DIARIA = 5
/** Lines in the "correos" list before "+N más → /correo" (Telegram splits at 4000 chars anyway). */
export const MAX_EN_LISTA_CORREOS = 40

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

function linkCorreo(texto = 'correos'): string {
  return `<a href="${appUrl()}/correo">${texto}</a>`
}

/** "📧 15. ✴️ Andrew (TOTT) · Landing page changes · hace 3h · 📨 Chelsea" */
export function lineaCorreo(n: number, c: CorreoLite, now: Date = new Date()): string {
  const alta = c.urgencia === 'alta' ? `${CORREO_URGENCIA_EMOJI.alta} ` : ''
  const edad = haceCuanto(c.recibido_en, now)
  const chelsea = c.estado === 'para_chelsea' ? ' · 📨 Chelsea' : ''
  return `📧 ${n}. ${alta}${escapeHtml(quienCorto(c))} · ${escapeHtml(c.asunto ?? '(sin asunto)')}${edad ? ` · ${edad}` : ''}${chelsea}`
}

/** "✅ respondido · Lion's Gate (TOTT) · Proposal" — greyed (italic): not numbered, nothing to decide. */
export function lineaRespondido(c: CorreoLite, quien: string | null): string {
  return `<i>✅ ${quien ? `${escapeHtml(quien)} respondió` : 'respondido'} · ${escapeHtml(quienCorto(c))} · ${escapeHtml(c.asunto ?? '(sin asunto)')}</i>`
}

export function pieDecidir(n: number): string {
  return `Para decidir: <code>el ${n} lo hago yo</code> · <code>el ${n} para Chelsea</code> · <code>archiva el ${n}</code> · <code>correos</code> = la lista completa · ${linkCorreo('/correo')}`
}

interface Bloque {
  html: string
  items: AlarmaItem[]
  total: number
}

function porCuenta<T extends { cuenta_id: string; cuenta: string }>(rows: T[]): Map<string, { nombre: string; rows: T[] }> {
  const m = new Map<string, { nombre: string; rows: T[] }>()
  for (const r of rows) {
    if (!m.has(r.cuenta_id)) m.set(r.cuenta_id, { nombre: r.cuenta, rows: [] })
    m.get(r.cuenta_id)!.rows.push(r)
  }
  return m
}

/**
 * The "📧" section of the 8:00 and 6:00 pm lists: per account, the pending
 * mails (nuevo / para_chelsea) numbered from `desde + 1`, at most
 * MAX_EN_LISTA_DIARIA each, then the VIPs answered in the last 48 h.
 * Returns the HTML (one line "Sin correos pendientes" when there is none).
 */
export async function seccionCorreosDiaria(desde: number, items: AlarmaItem[], now: Date = new Date()): Promise<string> {
  const [pendientes, respondidos, cuentas] = await Promise.all([correosPendientes({ dias: 7 }), correosRespondidosVip(), cargarCuentasSinFallar()])
  if (pendientes.length === 0 && respondidos.length === 0) return '📧 Sin correos pendientes'
  const duena = (cuentaId: string) => cuentas.find((c) => c.id === cuentaId)?.duena ?? null
  const grupos = porCuenta(pendientes)
  for (const r of respondidos) if (!grupos.has(r.cuenta_id)) grupos.set(r.cuenta_id, { nombre: r.cuenta, rows: [] })
  const bloques: string[] = []
  let n = desde
  const primero = desde + 1
  for (const [cuentaId, g] of Array.from(grupos.entries())) {
    const lines = [`📧 <b>${escapeHtml(g.nombre)} (${g.rows.length})</b>`]
    for (const c of g.rows.slice(0, MAX_EN_LISTA_DIARIA)) {
      n += 1
      items.push({ n, correo_id: c.id })
      lines.push(lineaCorreo(n, c, now))
    }
    if (g.rows.length > MAX_EN_LISTA_DIARIA) lines.push(`· +${g.rows.length - MAX_EN_LISTA_DIARIA} más → ${linkCorreo()}`)
    for (const r of respondidos.filter((x) => x.cuenta_id === cuentaId)) lines.push(lineaRespondido(r, duena(cuentaId)))
    bloques.push(lines.join('\n'))
  }
  if (n > desde) bloques.push(pieDecidir(primero))
  return bloques.join('\n\n')
}

async function cargarCuentasSinFallar(): Promise<CuentaCorreo[]> {
  try {
    return await cargarCuentas()
  } catch (err) {
    console.error(`[correo] cuentas: ${mensajeError(err)}`)
    return []
  }
}

/** "correos de Chelsea" / "correos de IM Gabby" → the account (by owner or name); null = all. */
export async function cuentaPorTexto(texto: string | null | undefined): Promise<CuentaCorreo | null> {
  const t = (texto ?? '').trim().toLowerCase()
  if (!t) return null
  const cuentas = await cargarCuentasSinFallar()
  return cuentas.find((c) => (c.duena ?? '').trim().toLowerCase() === t)
    ?? cuentas.find((c) => c.nombre.trim().toLowerCase() === t)
    ?? cuentas.find((c) => c.nombre.toLowerCase().includes(t) || (c.duena ?? '').toLowerCase().includes(t) || (c.conexion?.email ?? '').toLowerCase().includes(t))
    ?? null
}

const TITULO_GRUPO: Record<GrupoCorreo, string> = { alta: '✴️ Alta', respuesta: '✉️ Necesitan respuesta', resto: 'Resto' }

/**
 * Ajuste 6-2: the "correos" list — EVERY pending mail of the account (or of
 * all accounts), numbered, grouped alta / necesita respuesta / resto, with
 * sender and age; then the VIPs answered in the last 48 h, greyed.
 */
export async function construirListaCorreos(cuenta: CuentaCorreo | null, now: Date = new Date()): Promise<Bloque> {
  const [pendientes, respondidos, cuentas] = await Promise.all([
    correosPendientes({ cuentaId: cuenta?.id ?? null, dias: 7 }),
    correosRespondidosVip({ cuentaId: cuenta?.id ?? null }),
    cargarCuentasSinFallar(),
  ])
  const nombre = cuenta ? escapeHtml(cuenta.nombre) : 'todas las cuentas'
  const items: AlarmaItem[] = []
  if (pendientes.length === 0) {
    const cola = respondidos.length > 0 ? '\n' + respondidos.map((r) => lineaRespondido(r, cuentas.find((c) => c.id === r.cuenta_id)?.duena ?? null)).join('\n') : ''
    return { html: `📧 <b>Correos · ${nombre} (0)</b>\nNada pendiente 🎉 · ${linkCorreo('/correo')}${cola}`, items, total: 0 }
  }
  const bloques = [`📧 <b>Correos · ${nombre} (${pendientes.length})</b>`]
  const mostrados = pendientes.slice(0, MAX_EN_LISTA_CORREOS)
  let n = 0
  for (const grupo of ['alta', 'respuesta', 'resto'] as GrupoCorreo[]) {
    const del = mostrados.filter((c) => grupoDe(c) === grupo)
    if (del.length === 0) continue
    const lines = [`<b>${TITULO_GRUPO[grupo]}</b>`]
    for (const c of del) {
      n += 1
      items.push({ n, correo_id: c.id })
      lines.push(cuenta ? lineaCorreo(n, c, now) : `${lineaCorreo(n, c, now)} · ${escapeHtml(c.cuenta)}`)
    }
    bloques.push(lines.join('\n'))
  }
  if (pendientes.length > MAX_EN_LISTA_CORREOS) bloques.push(`· +${pendientes.length - MAX_EN_LISTA_CORREOS} más → ${linkCorreo('/correo')}`)
  if (respondidos.length > 0) bloques.push(respondidos.map((r) => lineaRespondido(r, cuentas.find((c) => c.id === r.cuenta_id)?.duena ?? null)).join('\n'))
  bloques.push(pieDecidir(1))
  return { html: bloques.join('\n\n'), items, total: pendientes.length }
}

/** Sends the "correos" list to one chat and records it (tipo 'correos') so its numbers work. */
export async function enviarListaCorreos(chatId: number, cuenta: CuentaCorreo | null): Promise<number> {
  const built = await construirListaCorreos(cuenta)
  const messageId = await sendTelegram(chatId, built.html, { html: true, tag: 'lista-correos' })
  await guardarAlarma('correos', built.items, { chat_id: chatId, message_id: messageId, texto: built.html })
  return built.total
}

/**
 * Ajuste 6-3: when a mail gets decided or answered, the newest list message
 * (≤ 12 h) that numbers it is edited in place: its line struck through plus
 * a mark ("~~16. Lion's Gate…~~ ✅"). No new message. Best-effort.
 */
export async function tacharCorreoEnLista(correoId: string, marca: string): Promise<boolean> {
  try {
    const lista = await ultimaListaCon(correoId)
    if (!lista || !lista.texto || !lista.chat_id || !lista.message_id) return false
    // A list Telegram split in parts has one message id for the last part only: leave it alone.
    if (lista.texto.length > TELEGRAM_MAX) return false
    const item = lista.items.find((i) => i.correo_id === correoId)
    if (!item) return false
    const re = new RegExp(`^(📧 )${item.n}\\. (?!<s>)(.*)$`, 'm')
    if (!re.test(lista.texto)) return false
    const texto = lista.texto.replace(re, (_m, pre: string, resto: string) => `${pre}<s>${item.n}. ${resto}</s> ${marca}`)
    const ok = await editMessageText(Number(lista.chat_id), Number(lista.message_id), texto, { html: true })
    if (ok) await actualizarTextoAlarma(lista.id, texto)
    return ok
  } catch (err) {
    console.error(`[correo] tachar en lista: ${mensajeError(err)}`)
    return false
  }
}
