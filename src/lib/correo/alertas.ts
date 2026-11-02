// Fase 6-F: one Telegram message per mail that deserves it, with the four
// buttons; "✅ Respondido" edits that same message when the autoresolver
// sees a reply in the thread.
//
//   📧 IM Chelsea · ✴️ alta · De: Andrew (TOTT)
//   Asunto
//   resumen
//   razón
//   [Para Chelsea] [Lo hago yo] [Tarea] [Archivar]

import { createServerClient } from '@/lib/supabase-server'
import { CORREO_URGENCIA_EMOJI, CORREO_TIPO_LABELS, type Correo, type CorreoAccion, type CuentaCorreo } from '@/types'
import { allowedChatIds, editMessageText, escapeHtml, inlineKeyboard, sendTelegram } from '@/lib/asistente/telegram'
import { remitenteCorto } from './decisiones'

/** callback_data "m:<correo uuid>:<accion>" — 36 + 2 + 3 bytes, under Telegram's 64. */
export const BOTON: Record<CorreoAccion, string> = { chelsea: 'ch', yo: 'yo', tarea: 'ta', archivar: 'ar' }
const ACCION_DE: Record<string, CorreoAccion> = { ch: 'chelsea', yo: 'yo', ta: 'tarea', ar: 'archivar' }

export function accionDeBoton(valor: string): CorreoAccion | null {
  return ACCION_DE[valor] ?? null
}

export function botonesCorreo(correoId: string) {
  return inlineKeyboard([
    [
      { text: '📨 Para Chelsea', callback_data: `m:${correoId}:${BOTON.chelsea}` },
      { text: '🙋 Lo hago yo', callback_data: `m:${correoId}:${BOTON.yo}` },
    ],
    [
      { text: '➕ Tarea', callback_data: `m:${correoId}:${BOTON.tarea}` },
      { text: '🗄 Archivar', callback_data: `m:${correoId}:${BOTON.archivar}` },
    ],
  ])
}

export function textoAlerta(c: Correo, cuenta: Pick<CuentaCorreo, 'nombre'>): string {
  const u = c.urgencia ?? 'media'
  const cabecera = `📧 <b>${escapeHtml(cuenta.nombre)}</b> · ${CORREO_URGENCIA_EMOJI[u]} ${u}${c.tipo ? ` · ${escapeHtml(CORREO_TIPO_LABELS[c.tipo].toLowerCase())}` : ''} · De: ${escapeHtml(remitenteCorto(c))}`
  const lines = [cabecera, `<b>${escapeHtml(c.asunto ?? '(sin asunto)')}</b>`]
  if (c.resumen && c.resumen !== c.asunto) lines.push(escapeHtml(c.resumen))
  if (c.razon) lines.push(`<i>${escapeHtml(c.razon)}</i>`)
  return lines.join('\n')
}

/** The chat an account alerts: its own, or the bot's allowed chats. */
export function chatsDeAlerta(cuenta: Pick<CuentaCorreo, 'chat_id_alertas'>): number[] {
  if (cuenta.chat_id_alertas) return [Number(cuenta.chat_id_alertas)]
  return allowedChatIds()
}

/** Sends the alert and records where it went (so a decision or "Respondido" can edit it). */
export async function enviarAlerta(c: Correo, cuenta: CuentaCorreo): Promise<boolean> {
  const chats = chatsDeAlerta(cuenta)
  if (chats.length === 0) {
    console.warn(`[correo] sin chat para alertar «${c.asunto}» (${cuenta.nombre})`)
    return false
  }
  const texto = textoAlerta(c, cuenta)
  let primero: { chat: number; message: number } | null = null
  for (const chat of chats) {
    try {
      const id = await sendTelegram(chat, texto, { html: true, tag: 'correo-alerta', replyMarkup: botonesCorreo(c.id) })
      if (!primero && id) primero = { chat, message: id }
    } catch (err) {
      console.error(`[correo] alerta a ${chat} falló: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (!primero) return false
  const { error } = await createServerClient()
    .from('correos')
    .update({ alertado: true, telegram_chat_id: primero.chat, telegram_message_id: primero.message })
    .eq('id', c.id)
  if (error) console.error(`[correo] marcar alertado: ${error.message}`)
  return true
}

/** The autoresolver saw a reply: "✅ Respondido" on the alert, buttons gone. */
export async function marcarRespondidoEnTelegram(c: Correo): Promise<void> {
  if (!c.telegram_chat_id || !c.telegram_message_id) return
  const texto = `✅ <b>Respondido</b> · ${escapeHtml(c.asunto ?? '(sin asunto)')} · De: ${escapeHtml(remitenteCorto(c))}`
  await editMessageText(Number(c.telegram_chat_id), Number(c.telegram_message_id), texto, { html: true })
}
