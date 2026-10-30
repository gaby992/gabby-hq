// Outbound Telegram for the assistant: HTML messages, auto-split, logged.
// The inbound webhook lives in src/app/api/telegram/route.ts and uses the same
// helpers, so both directions share one definition of "who is allowed".

const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

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
  return allowedChatIds().includes(chatId)
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
export async function sendTelegram(chatId: number, text: string, opts: SendOptions = {}): Promise<void> {
  const parts = splitMessage(text)
  const tag = opts.tag ?? 'telegram'
  for (let i = 0; i < parts.length; i++) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: parts[i],
      disable_web_page_preview: true,
    }
    if (opts.html) body.parse_mode = 'HTML'
    if (opts.replyMarkup && i === parts.length - 1) body.reply_markup = opts.replyMarkup

    let res: Response
    try {
      res = await fetch(`${API()}/sendMessage`, {
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
  }
}

// ── Inline buttons ───────────────────────────────────────────────────────

export interface InlineButton {
  text: string
  callback_data: string // Telegram caps this at 64 bytes
}

export function inlineKeyboard(rows: InlineButton[][]): { inline_keyboard: InlineButton[][] } {
  return { inline_keyboard: rows }
}

/** Stops the "loading" spinner on the button the user tapped. Best-effort. */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
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
  try {
    await fetch(`${API()}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
    })
  } catch (err) {
    console.error(`[bot] editMessageReplyMarkup: ${String(err)}`)
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
  const file = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}`)
  if (!file.ok) throw new TelegramError(file.status, `descarga de ${path}`)
  return { bytes: await file.arrayBuffer(), path }
}
