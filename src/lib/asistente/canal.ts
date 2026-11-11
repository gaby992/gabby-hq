// Fase 9c: WHERE the bot is talking right now. The same engine (parser,
// interpreter, plans, drafts, lists) answers Telegram and the 💬 chat in
// /hoy; the only difference is where the outgoing messages go. Instead of
// threading a "sink" through every function, the request is wrapped in an
// AsyncLocalStorage context and `sendTelegram` looks it up: in a web
// request the message is collected and returned as JSON; in a Telegram
// request (or outside any context — the crons) it goes to Telegram.
//
// The context also carries the "install the menu with the next reply"
// flag (fase 9c-A): a reply keyboard can only ride on a message, so the
// first plain reply of the request takes it.

import { AsyncLocalStorage } from 'node:async_hooks'

export type TipoCanal = 'telegram' | 'web'

/** One bot message as the web chat receives it: Telegram HTML or plain text, plus its inline buttons. */
export interface MensajeWeb {
  texto: string
  html: boolean
  /** Rows of buttons: `data` = callback_data (posted back as `boton`), `url` = a link. */
  botones: { text: string; data?: string; url?: string }[][]
  /** A board picture: data URL (image/png). */
  imagen?: string
}

export interface Canal {
  tipo: TipoCanal
  /** Fase 18: the update came through the SECOND bot (Chelsea's channel), so answers use its token. */
  bot?: 'chelsea'
  /** Web only: every message the engine "sent" during this request. */
  mensajes?: MensajeWeb[]
  /** Telegram only: attach the persistent menu to the next reply without buttons. */
  menuPendiente?: boolean
}

const als = new AsyncLocalStorage<Canal>()

/** Runs `fn` with `canal` as the current channel. Nested calls see the innermost. */
export function conCanal<T>(canal: Canal, fn: () => Promise<T>): Promise<T> {
  return als.run(canal, fn)
}

export function canalActual(): Canal | undefined {
  return als.getStore()
}

export function esWeb(): boolean {
  return als.getStore()?.tipo === 'web'
}

/** The next reply without its own keyboard carries the persistent menu. No-op outside a Telegram request. */
export function pedirMenu(): void {
  const c = als.getStore()
  if (c && c.tipo === 'telegram') c.menuPendiente = true
}

/** Takes (and clears) the pending-menu flag. */
export function tomarMenuPendiente(): boolean {
  const c = als.getStore()
  if (!c || !c.menuPendiente) return false
  c.menuPendiente = false
  return true
}

/** Web: records a message the engine sent. Returns false when not in a web request. */
export function registrarMensajeWeb(m: MensajeWeb): boolean {
  const c = als.getStore()
  if (!c || c.tipo !== 'web') return false
  ;(c.mensajes ??= []).push(m)
  return true
}
