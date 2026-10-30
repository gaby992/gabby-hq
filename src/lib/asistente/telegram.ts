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
