// Outbound Telegram for the assistant: HTML messages, auto-split, logged.
// The inbound webhook lives in src/app/api/telegram/route.ts and uses the same
// helpers, so both directions share one definition of "who is allowed".
//
// Fase 9c: every send first asks the current channel (canal.ts). Inside the
// web chat's request the message is collected instead of sent, so the same
// engine talks to both; the "edit / remove buttons" calls become no-ops
// there. The persistent menu (menu.ts) rides on the first plain reply when
// the request asked for it.

import { canalActual, esWeb, registrarMensajeWeb, tomarMenuPendiente } from './canal'
import { tecladoMenu } from './menu'

// Fase 18: el canal de Chelsea. Un SEGUNDO bot (TELEGRAM_BOT_TOKEN_CHELSEA) que habla en UN
// chat (CHELSEA_CHAT_ID): ahí van las alertas de sus correos y su resumen del día, para que
// lo de Chelsea no se mezcle con el Telegram de Gabby. Todo lo que va a ese chat sale por ese
// bot, y lo que llega por su webhook (?bot=chelsea) se contesta por él.

/** The chat of Chelsea's channel, or null when the channel is not configured (both variables are needed). */
export function chelseaChatId(): number | null {
  const n = Number((process.env.CHELSEA_CHAT_ID ?? '').trim())
  return process.env.TELEGRAM_BOT_TOKEN_CHELSEA && Number.isFinite(n) && n !== 0 ? n : null
}

export function esChatChelsea(chatId: number | null | undefined): boolean {
  const c = chelseaChatId()
  return c !== null && chatId === c
}

/** Which bot speaks: Chelsea's for her chat or inside her webhook's request; the main one otherwise. */
function tokenPara(chatId?: number | null): string | undefined {
  if (chelseaChatId() !== null && (esChatChelsea(chatId) || (chatId == null && canalActual()?.bot === 'chelsea'))) return process.env.TELEGRAM_BOT_TOKEN_CHELSEA
  return process.env.TELEGRAM_BOT_TOKEN
}

const API = (chatId?: number | null) => `https://api.telegram.org/bot${tokenPara(chatId)}`

/** Telegram's hard limit is 4096; we split a bit earlier to leave room. */
export const TELEGRAM_MAX = 4000

/** Chat ids the bot obeys and the alarms are sent to. Empty → nobody. */
export function allowedChatIds(): number[] {
  return (process.env.ALLOWED_CHAT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n))
}

export function isAllowedChat(chatId: number): boolean {
  // Fase 18: the buttons of Chelsea's channel are hers to tap too. (The alarms still go only to ALLOWED_CHAT_IDS.)
  return allowedChatIds().includes(chatId) || esChatChelsea(chatId)
}

/**
 * Fase 9c-E: the chat id the web chat talks as — Gabby's own Telegram chat
 * (the first of ALLOWED_CHAT_IDS), so the web and Telegram are ONE thread
 * and an alarm set from the web rings in Telegram. 0 when none is configured.
 */
export function chatIdWeb(): number {
  return allowedChatIds()[0] ?? 0
}

/** Escape user-provided text for parse_mode HTML (only these three matter). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Split on line breaks so no chunk exceeds `max`. A single line longer than
 * `max` (a huge pasted note) is hard-cut — ugly but never a Telegram 400.
 */
export function splitMessage(text: string, max: number = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text]
  const parts: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    const chunks = line.length > max ? line.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g'))! : [line]
    for (const chunk of chunks) {
      const candidate = current ? `${current}\n${chunk}` : chunk
      if (candidate.length > max) {
        if (current) parts.push(current)
        current = chunk
      } else {
        current = candidate
      }
    }
  }
  if (current) parts.push(current)
  return parts
}

export class TelegramError extends Error {
  status: number
  description: string
  constructor(status: number, description: string) {
    super(`Telegram ${status}: ${description}`)
    this.status = status
    this.description = description
  }
}

interface SendOptions {
  html?: boolean
  /** Shows up in the Vercel log line so a failure can be traced to its alarm. */
  tag?: string
  /** Inline keyboard etc. Attached to the last part when the text is split. */
  replyMarkup?: unknown
}

/**
 * Send one message (splitting if needed) and throw on any non-2xx so callers
 * can retry. Every part is logged — ok or error — in the Vercel function logs.
 */
export async function sendTelegram(chatId: number, text: string, opts: SendOptions = {}): Promise<number | null> {
  // Fase 9c-E: the web chat gets the message as data; nothing goes to Telegram.
  if (esWeb()) {
    registrarMensajeWeb({ texto: text, html: !!opts.html, botones: botonesWeb(opts.replyMarkup) })
    return null
  }
  const parts = splitMessage(text)
  const tag = opts.tag ?? 'telegram'
  // Fase 9c-A: the menu rides on the first reply of the request that has no buttons of its own.
  // (Fase 18: the menu is Gabita's — it never rides on a message of Chelsea's channel.)
  const replyMarkup = opts.replyMarkup ?? (!esChatChelsea(chatId) && tomarMenuPendiente() ? tecladoMenu() : undefined)
  let messageId: number | null = null
  for (let i = 0; i < parts.length; i++) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: parts[i],
      disable_web_page_preview: true,
    }
    if (opts.html) body.parse_mode = 'HTML'
    if (replyMarkup && i === parts.length - 1) body.reply_markup = replyMarkup

    let res: Response
    try {
      res = await fetch(`${API(chatId)}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      console.error(`[${tag}] telegram error chat=${chatId} parte ${i + 1}/${parts.length}: ${String(err)}`)
      throw err
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      let description = detail
      try {
        description = JSON.parse(detail)?.description ?? detail
      } catch {
        /* not JSON — keep raw body */
      }
      console.error(`[${tag}] telegram error chat=${chatId} parte ${i + 1}/${parts.length}: ${res.status} ${description}`)
      throw new TelegramError(res.status, description)
    }
    console.log(`[${tag}] telegram ok chat=${chatId} parte ${i + 1}/${parts.length} (${parts[i].length} chars)`)
    const json = await res.json().catch(() => null)
    if (typeof json?.result?.message_id === 'number') messageId = json.result.message_id
  }
  return messageId
}

/**
 * Fase 9c-B: one photo (PNG bytes, uploaded as multipart — no public URL
 * needed) with an optional caption and buttons. Throws on a Telegram error
 * like sendMessage. In the web chat the picture travels as a data URL.
 */
export async function sendPhoto(chatId: number, png: Uint8Array, opts: { caption?: string; html?: boolean; replyMarkup?: unknown; tag?: string } = {}): Promise<number | null> {
  if (esWeb()) {
    registrarMensajeWeb({ texto: opts.caption ?? '', html: !!opts.html, botones: botonesWeb(opts.replyMarkup), imagen: `data:image/png;base64,${Buffer.from(png).toString('base64')}` })
    return null
  }
  const tag = opts.tag ?? 'telegram'
  const form = new FormData()
  form.append('chat_id', String(chatId))
  const bytes = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
  form.append('photo', new Blob([bytes], { type: 'image/png' }), 'tablero.png')
  if (opts.caption) form.append('caption', opts.caption)
  if (opts.html) form.append('parse_mode', 'HTML')
  if (opts.replyMarkup) form.append('reply_markup', JSON.stringify(opts.replyMarkup))
  let res: Response
  try {
    res = await fetch(`${API(chatId)}/sendPhoto`, { method: 'POST', body: form })
  } catch (err) {
    console.error(`[${tag}] telegram sendPhoto error chat=${chatId}: ${String(err)}`)
    throw err
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    let description = detail
    try {
      description = JSON.parse(detail)?.description ?? detail
    } catch {
      /* raw body */
    }
    console.error(`[${tag}] telegram sendPhoto error chat=${chatId}: ${res.status} ${description}`)
    throw new TelegramError(res.status, description)
  }
  console.log(`[${tag}] telegram sendPhoto ok chat=${chatId} (${png.byteLength} bytes)`)
  const json = await res.json().catch(() => null)
  return typeof json?.result?.message_id === 'number' ? json.result.message_id : null
}

// ── Inline buttons ───────────────────────────────────────────────────────

export interface InlineButton {
  text: string
  /** Telegram caps this at 64 bytes. Absent on a link button. */
  callback_data?: string
  /** Fase 9c: a link button ("🖥 Abrir tablero"). */
  url?: string
}

export function inlineKeyboard(rows: InlineButton[][]): { inline_keyboard: InlineButton[][] } {
  return { inline_keyboard: rows }
}

/** The inline buttons of a reply_markup as the web chat renders them (a reply keyboard has none: the web has its own). */
function botonesWeb(replyMarkup: unknown): { text: string; data?: string; url?: string }[][] {
  const rows = (replyMarkup as { inline_keyboard?: InlineButton[][] } | undefined)?.inline_keyboard
  if (!Array.isArray(rows)) return []
  return rows.map((fila) => fila.map((b) => ({ text: b.text, data: b.callback_data, url: b.url })))
}

/** Stops the "loading" spinner on the button the user tapped. Best-effort. */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  if (esWeb()) return
  try {
    await fetch(`${API()}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    })
  } catch (err) {
    console.error(`[bot] answerCallbackQuery: ${String(err)}`)
  }
}

/** Removes the buttons from a question already answered. Best-effort. */
export async function removeInlineKeyboard(chatId: number, messageId: number): Promise<void> {
  if (esWeb()) return
  try {
    await fetch(`${API(chatId)}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
    })
  } catch (err) {
    console.error(`[bot] editMessageReplyMarkup: ${String(err)}`)
  }
}

/** Rewrites a message the bot sent (fase 6: "✅ Respondido" on a mail alert). Best-effort; drops its buttons. */
export async function editMessageText(chatId: number, messageId: number, text: string, opts: { html?: boolean; replyMarkup?: unknown } = {}): Promise<boolean> {
  if (esWeb()) return false
  try {
    const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text: text.slice(0, TELEGRAM_MAX), disable_web_page_preview: true }
    if (opts.html) body.parse_mode = 'HTML'
    body.reply_markup = opts.replyMarkup ?? { inline_keyboard: [] }
    const res = await fetch(`${API(chatId)}/editMessageText`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) console.error(`[bot] editMessageText: ${res.status} ${await res.text().catch(() => '')}`)
    return res.ok
  } catch (err) {
    console.error(`[bot] editMessageText: ${String(err)}`)
    return false
  }
}

// ── Files (voice notes) ──────────────────────────────────────────────────

/** getFile + download. Throws with a readable reason on any failure. */
export async function downloadTelegramFile(fileId: string): Promise<{ bytes: ArrayBuffer; path: string }> {
  const meta = await fetch(`${API()}/getFile?file_id=${encodeURIComponent(fileId)}`)
  const json = await meta.json().catch(() => null)
  if (!meta.ok || !json?.ok || !json.result?.file_path) {
    throw new TelegramError(meta.status, json?.description ?? 'getFile sin file_path')
  }
  const path: string = json.result.file_path
  const file = await fetch(`https://api.telegram.org/file/bot${tokenPara()}/${path}`)
  if (!file.ok) throw new TelegramError(file.status, `descarga de ${path}`)
  return { bytes: await file.arrayBuffer(), path }
}

// ── Fase 18: conectar el canal de Chelsea ────────────────────────────────

export interface EstadoCanalChelsea {
  configurado: boolean
  bot?: string
  webhook?: string
  ok: boolean
  detalle: string
}

/**
 * Points Chelsea's bot at this deployment (so its buttons arrive here) and
 * says hello in her chat. Safe to run again. Never throws: the result says
 * what happened, in plain words.
 */
export async function conectarCanalChelsea(appUrl: string): Promise<EstadoCanalChelsea> {
  const chat = chelseaChatId()
  if (chat === null) {
    return { configurado: false, ok: false, detalle: 'Faltan las variables TELEGRAM_BOT_TOKEN_CHELSEA y CHELSEA_CHAT_ID en Vercel (y hacer Redeploy después de ponerlas).' }
  }
  const base = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN_CHELSEA}`
  const webhook = `${appUrl.replace(/\/$/, '')}/api/telegram?bot=chelsea`
  try {
    const me = await (await fetch(`${base}/getMe`)).json().catch(() => null)
    if (!me?.ok) return { configurado: true, ok: false, detalle: `Telegram no reconoce el token del bot de Chelsea (${me?.description ?? 'sin respuesta'}). Revisa TELEGRAM_BOT_TOKEN_CHELSEA.` }
    const bot = `@${me.result?.username ?? '?'}`
    const wh = await (
      await fetch(`${base}/setWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: webhook, allowed_updates: ['message', 'callback_query'] }) })
    ).json().catch(() => null)
    if (!wh?.ok) return { configurado: true, bot, ok: false, detalle: `No pude apuntar ${bot} a GabbyHQ: ${wh?.description ?? 'sin respuesta'}.` }
    const hola = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: '✅ Canal de Chelsea conectado a GabbyHQ. Aquí llegan las alertas de sus correos y su resumen del día.' }),
    })
    if (!hola.ok) {
      const d = await hola.json().catch(() => null)
      return { configurado: true, bot, webhook, ok: false, detalle: `${bot} quedó apuntando a GabbyHQ, pero no pudo escribir en el chat ${chat}: ${d?.description ?? hola.status}. Revisa CHELSEA_CHAT_ID y que el bot esté en ese grupo.` }
    }
    return { configurado: true, bot, webhook, ok: true, detalle: `${bot} conectado: ya escribió en el chat de Chelsea y sus botones llegan a GabbyHQ.` }
  } catch (err) {
    return { configurado: true, ok: false, detalle: `No pude hablar con Telegram: ${err instanceof Error ? err.message : String(err)}` }
  }
}
