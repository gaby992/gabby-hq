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

import { CORREO_URGENCIA_EMOJI, type CuentaCorreo, type IdiomaCorreo } from '@/types'
import { textos } from './idioma'
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

/** "📧 15. ✴️ Andrew (TOTT) · Landing page changes · hace 3h · 📨 Chelsea" (ajuste 6c: in the account's language). */
export function lineaCorreo(n: number, c: CorreoLite, now: Date = new Date(), idioma: IdiomaCorreo = 'es'): string {
  const t = textos(idioma)
  const alta = c.urgencia === 'alta' ? `${CORREO_URGENCIA_EMOJI.alta} ` : ''
  const edad = haceCuanto(c.recibido_en, now, idioma)
  const chelsea = c.estado === 'para_chelsea' ? ' · 📨 Chelsea' : ''
  return `📧 ${n}. ${alta}${escapeHtml(quienCorto(c))} · ${escapeHtml(c.asunto ?? t.sinAsunto)}${edad ? ` · ${edad}` : ''}${chelsea}`
}

/** "✅ respondido · Lion's Gate (TOTT) · Proposal" — greyed (italic): not numbered, nothing to decide. */
export function lineaRespondido(c: CorreoLite, quien: string | null, idioma: IdiomaCorreo = 'es'): string {
  const t = textos(idioma)
  return `<i>✅ ${escapeHtml(t.respondio(quien))} · ${escapeHtml(quienCorto(c))} · ${escapeHtml(c.asunto ?? t.sinAsunto)}</i>`
}

/** The decide-by-number hints, in the account's language (ajuste 9c-2); the commands themselves stay in Spanish. */
export function pieDecidir(n: number, idioma: IdiomaCorreo = 'es'): string {
  return textos(idioma).pie(n, linkCorreo('/correo'))
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
  const idiomaDe = (cuentaId: string): IdiomaCorreo => cuentas.find((c) => c.id === cuentaId)?.idioma ?? 'es'
  const grupos = porCuenta(pendientes)
  for (const r of respondidos) if (!grupos.has(r.cuenta_id)) grupos.set(r.cuenta_id, { nombre: r.cuenta, rows: [] })
  const bloques: string[] = []
  let n = desde
  const primero = desde + 1
  for (const [cuentaId, g] of Array.from(grupos.entries())) {
    const idioma = idiomaDe(cuentaId)
    const lines = [`📧 <b>${escapeHtml(g.nombre)} (${g.rows.length})</b>`]
    for (const c of g.rows.slice(0, MAX_EN_LISTA_DIARIA)) {
      n += 1
      items.push({ n, correo_id: c.id })
      lines.push(lineaCorreo(n, c, now, idioma))
    }
    if (g.rows.length > MAX_EN_LISTA_DIARIA) lines.push(`· ${textos(idioma).mas(g.rows.length - MAX_EN_LISTA_DIARIA, linkCorreo())}`)
    for (const r of respondidos.filter((x) => x.cuenta_id === cuentaId)) lines.push(lineaRespondido(r, duena(cuentaId), idioma))
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

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/**
 * Ajuste 9c-1: the accounts a spoken hint points at — partial and
 * case-insensitive over the account's name, its owner and its email
 * ("chelsea" → IM Chelsea; "pd" → PD Gabby; "im gabby" → IM Gabby). Pure.
 *   exact owner or name → that one
 *   every word of the hint found in "nombre duena email" → those
 *   `mio` ("mi correo de IM") and still several → the person's own (owner = `persona`)
 * Several left → the caller asks with buttons. Empty hint → [] (means "all").
 */
export function elegirCuentas(texto: string | null | undefined, cuentas: CuentaCorreo[], opts: { mio?: boolean; persona?: string } = {}): CuentaCorreo[] {
  const t = sinAcentos(texto ?? '')
  if (!t) return []
  const exacta = cuentas.find((c) => sinAcentos(c.duena ?? '') === t) ?? cuentas.find((c) => sinAcentos(c.nombre) === t) ?? cuentas.find((c) => sinAcentos(c.conexion?.email ?? '') === t)
  if (exacta) return [exacta]
  const palabras = t.split(/\s+/).filter(Boolean)
  const clave = (c: CuentaCorreo) => sinAcentos(`${c.nombre} ${c.duena ?? ''} ${c.conexion?.email ?? ''}`)
  let hits = cuentas.filter((c) => palabras.every((w) => clave(c).includes(w)))
  if (hits.length > 1 && opts.mio && opts.persona) {
    const mias = hits.filter((c) => sinAcentos(c.duena ?? '') === sinAcentos(opts.persona!))
    if (mias.length >= 1) hits = mias
  }
  return hits
}

/** The accounts a hint points at (see elegirCuentas), from the database. */
export async function cuentasPorTexto(texto: string | null | undefined, opts: { mio?: boolean; persona?: string } = {}): Promise<CuentaCorreo[]> {
  if (!(texto ?? '').trim()) return []
  return elegirCuentas(texto, await cargarCuentasSinFallar(), opts)
}

/** "correos de Chelsea" / "correos de IM Gabby" → the ONE account the hint points at; null when none or several. */
export async function cuentaPorTexto(texto: string | null | undefined): Promise<CuentaCorreo | null> {
  const hits = await cuentasPorTexto(texto)
  return hits.length === 1 ? hits[0] : null
}

/**
 * Ajuste 6-2: the "correos" list — EVERY pending mail of the account (or of
 * all accounts), numbered, grouped alta / necesita respuesta / resto, with
 * sender and age; then the VIPs answered in the last 48 h, greyed.
 */
export async function construirListaCorreos(cuenta: CuentaCorreo | null, now: Date = new Date(), opts: { importante?: boolean } = {}): Promise<Bloque> {
  const [todos, respondidos, cuentas] = await Promise.all([
    correosPendientes({ cuentaId: cuenta?.id ?? null, dias: 7 }),
    correosRespondidosVip({ cuentaId: cuenta?.id ?? null }),
    cargarCuentasSinFallar(),
  ])
  // Ajuste 9c-1: "lo más importante" / "urgentes" / "qué necesita respuesta" → alta + a person waits; the rest stays out (and is counted).
  const pendientes = opts.importante ? todos.filter((c) => grupoDe(c) !== 'resto') : todos
  const fuera = todos.length - pendientes.length
  // One account → its language; every account → Spanish headers, each line in its account's language.
  const idioma: IdiomaCorreo = cuenta?.idioma ?? 'es'
  const t = textos(idioma)
  const idiomaDe = (cuentaId: string): IdiomaCorreo => cuenta?.idioma ?? cuentas.find((c) => c.id === cuentaId)?.idioma ?? 'es'
  const duenaDe = (cuentaId: string) => cuentas.find((c) => c.id === cuentaId)?.duena ?? null
  const nombre = cuenta ? escapeHtml(cuenta.nombre) : t.todasLasCuentas
  const items: AlarmaItem[] = []
  if (pendientes.length === 0) {
    const cola = respondidos.length > 0 ? '\n' + respondidos.map((r) => lineaRespondido(r, duenaDe(r.cuenta_id), idiomaDe(r.cuenta_id))).join('\n') : ''
    const nada = opts.importante && fuera > 0 ? t.nadaImportante(fuera, linkCorreo('/correo')) : `${t.nadaPendiente} · ${linkCorreo('/correo')}`
    return { html: `📧 <b>${t.correos} · ${nombre}${opts.importante ? ` · ${t.loImportante}` : ''} (0)</b>\n${nada}${cola}`, items, total: 0 }
  }
  // Ajuste 9c-2: the summary LINES first (counts + one recommendation, in the account's language), then the numbered lines.
  const bloques = [`📧 <b>${t.correos} · ${nombre}${opts.importante ? ` · ${t.loImportante}` : ''} (${pendientes.length})</b>\n${resumenCorreos(pendientes, { importante: !!opts.importante, fuera, idioma, now }).map(escapeHtml).join('\n')}`]
  const mostrados = pendientes.slice(0, MAX_EN_LISTA_CORREOS)
  let n = 0
  for (const grupo of ['alta', 'respuesta', 'resto'] as GrupoCorreo[]) {
    const del = mostrados.filter((c) => grupoDe(c) === grupo)
    if (del.length === 0) continue
    const lines = [`<b>${t.grupos[grupo]}</b>`]
    for (const c of del) {
      n += 1
      items.push({ n, correo_id: c.id })
      lines.push(cuenta ? lineaCorreo(n, c, now, idioma) : `${lineaCorreo(n, c, now, idiomaDe(c.cuenta_id))} · ${escapeHtml(c.cuenta)}`)
    }
    bloques.push(lines.join('\n'))
  }
  if (pendientes.length > MAX_EN_LISTA_CORREOS) bloques.push(`· ${t.mas(pendientes.length - MAX_EN_LISTA_CORREOS, linkCorreo('/correo'))}`)
  if (respondidos.length > 0) bloques.push(respondidos.map((r) => lineaRespondido(r, duenaDe(r.cuenta_id), idiomaDe(r.cuenta_id))).join('\n'))
  if (opts.importante && fuera > 0) bloques.push(t.verTodos(fuera, `correos${cuenta ? ` de ${escapeHtml(cuenta.nombre)}` : ''}`))
  bloques.push(pieDecidir(1, idioma))
  return { html: bloques.join('\n\n'), items, total: pendientes.length }
}

/**
 * Ajuste 9c-2: the summary as LINES, not a paragraph, in the account's
 * language: one line with the counts (what matters / pending: urgent,
 * needs a reply, FYI, with Chelsea; the oldest; what was left out) and a
 * 👉 line with ONE recommendation by the sender's short name — never a
 * subject. Subjects live in the numbered lines below, as they arrived.
 */
export function resumenCorreos(pendientes: CorreoLite[], opts: { importante: boolean; fuera: number; idioma: IdiomaCorreo; now?: Date }): string[] {
  const t = textos(opts.idioma)
  const now = opts.now ?? new Date()
  const altas = pendientes.filter((c) => grupoDe(c) === 'alta')
  const respuesta = pendientes.filter((c) => grupoDe(c) === 'respuesta')
  const resto = pendientes.filter((c) => grupoDe(c) === 'resto')
  const chelsea = pendientes.filter((c) => c.estado === 'para_chelsea').length
  const lineas: string[] = []
  let primera = t.resumen({ total: pendientes.length, altas: altas.length, respuesta: respuesta.length, resto: resto.length, chelsea, importante: opts.importante })
  if (opts.importante && opts.fuera > 0) primera += ` ${t.fuera(opts.fuera)}`
  const viejo = [...pendientes].sort((a, b) => (a.recibido_en ?? '').localeCompare(b.recibido_en ?? ''))[0]
  const dias = viejo?.recibido_en ? Math.floor((now.getTime() - new Date(viejo.recibido_en).getTime()) / 86_400_000) : 0
  if (viejo && dias >= 2) primera += ` ${t.masViejo(dias, nombreRemitente(viejo))}`
  lineas.push(primera)
  const primero = altas[0] ?? respuesta[0] ?? pendientes[0]
  if (primero) lineas.push(t.empieza(1, nombreRemitente(primero)))
  return lineas
}

/** "TechFin" — the sender's name without the domain tag, for a recommendation. */
function nombreRemitente(c: CorreoLite): string {
  return (c.de_nombre?.trim() || quienCorto(c)).replace(/\s*\([^)]*\)\s*$/, '').split(/\s+/).slice(0, 2).join(' ')
}

/** Sends the "correos" list to one chat and records it (tipo 'correos') so its numbers work. */
export async function enviarListaCorreos(chatId: number, cuenta: CuentaCorreo | null, opts: { importante?: boolean } = {}): Promise<number> {
  const built = await construirListaCorreos(cuenta, new Date(), opts)
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
