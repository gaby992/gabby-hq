// Fase 6-F: one Telegram message per mail that deserves it (ajuste 6-4:
// only VIP and urgencia alta), with the four buttons and a fifth that opens
// the account's full list; the same message is EDITED afterwards — never a
// new one — when the mail is decided or answered.
//
//   📧 IM Chelsea · ✴️ alta · De: Andrew (TOTT)
//   Asunto
//   resumen
//   razón
//   [Para Chelsea] [Lo hago yo]
//   [Tarea]        [Archivar]
//   [📋 Correos de IM Chelsea]
//
// Ajuste 6-6: "✅ Chelsea respondió" keeps [Lo hago yo] [Tarea] for 48 h
// (answered is not closed for Gabby); "📨 Para Chelsea" keeps [Lo hago yo].

import { createServerClient } from '@/lib/supabase-server'
import { CORREO_URGENCIA_EMOJI, CORREO_TIPO_LABELS, type Correo, type CorreoAccion, type CuentaCorreo } from '@/types'
import { allowedChatIds, editMessageText, escapeHtml, inlineKeyboard, sendTelegram, type InlineButton } from '@/lib/asistente/telegram'
import { mensajeError } from '@/lib/errores'
import { remitenteCorto } from './decisiones'
import { HORAS_RESPONDIDO_VISIBLE } from './pendientes'

/** callback_data "m:<correo uuid>:<accion>" — 36 + 2 + 3 bytes, under Telegram's 64. */
export const BOTON: Record<CorreoAccion, string> = { chelsea: 'ch', yo: 'yo', tarea: 'ta', archivar: 'ar' }
const ACCION_DE: Record<string, CorreoAccion> = { ch: 'chelsea', yo: 'yo', ta: 'tarea', ar: 'archivar' }

export function accionDeBoton(valor: string): CorreoAccion | null {
  return ACCION_DE[valor] ?? null
}

const B = {
  chelsea: (id: string): InlineButton => ({ text: '📨 Para Chelsea', callback_data: `m:${id}:${BOTON.chelsea}` }),
  yo: (id: string): InlineButton => ({ text: '🙋 Lo hago yo', callback_data: `m:${id}:${BOTON.yo}` }),
  tarea: (id: string): InlineButton => ({ text: '➕ Tarea', callback_data: `m:${id}:${BOTON.tarea}` }),
  archivar: (id: string): InlineButton => ({ text: '🗄 Archivar', callback_data: `m:${id}:${BOTON.archivar}` }),
  /** "ml:<cuenta uuid>" → the account's whole pending list (ajuste 6-2). */
  lista: (cuentaId: string, nombre: string): InlineButton => ({ text: `📋 Correos de ${nombre}`.slice(0, 40), callback_data: `ml:${cuentaId}` }),
}

export function botonesCorreo(correoId: string, cuenta?: Pick<CuentaCorreo, 'id' | 'nombre'> | null) {
  const rows: InlineButton[][] = [
    [B.chelsea(correoId), B.yo(correoId)],
    [B.tarea(correoId), B.archivar(correoId)],
  ]
  if (cuenta) rows.push([B.lista(cuenta.id, cuenta.nombre)])
  return inlineKeyboard(rows)
}

/**
 * The buttons a decided / answered mail keeps (ajuste 6-6): answered →
 * [Lo hago yo] [Tarea]; handed to Chelsea → [Lo hago yo]; otherwise none.
 */
export function botonesTrasEstado(c: Pick<Correo, 'id' | 'estado'>) {
  if (c.estado === 'respondido') return inlineKeyboard([[B.yo(c.id), B.tarea(c.id)]])
  if (c.estado === 'para_chelsea') return inlineKeyboard([[B.yo(c.id)]])
  return inlineKeyboard([])
}

/** Hours those leftover buttons stay valid. */
export const HORAS_BOTON_TRAS_ESTADO = HORAS_RESPONDIDO_VISIBLE

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
      const id = await sendTelegram(chat, texto, { html: true, tag: 'correo-alerta', replyMarkup: botonesCorreo(c.id, cuenta) })
      if (!primero && id) primero = { chat, message: id }
    } catch (err) {
      console.error(`[correo] alerta a ${chat} falló: ${mensajeError(err)}`)
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

/** "✅ Chelsea respondió · Asunto · De: …" (or "✅ Respondido" when the account has no owner name). */
export function textoRespondido(c: Pick<Correo, 'asunto' | 'de_nombre' | 'de_email'>, quien: string | null, cola = ''): string {
  return `✅ <b>${quien ? `${escapeHtml(quien)} respondió` : 'Respondido'}</b>${cola} · ${escapeHtml(c.asunto ?? '(sin asunto)')} · De: ${escapeHtml(remitenteCorto(c))}`
}

/**
 * The autoresolver saw a reply: the alert becomes "✅ Chelsea respondió" but
 * KEEPS [Lo hago yo] [Tarea] (ajuste 6-6): answered is not closed for Gabby.
 */
export async function marcarRespondidoEnTelegram(c: Correo, cuenta: Pick<CuentaCorreo, 'duena'> | null): Promise<void> {
  if (!c.telegram_chat_id || !c.telegram_message_id) return
  await editMessageText(Number(c.telegram_chat_id), Number(c.telegram_message_id), textoRespondido(c, cuenta?.duena ?? null), {
    html: true,
    replyMarkup: botonesTrasEstado({ id: c.id, estado: 'respondido' }),
  })
}

const TITULO: Record<CorreoAccion, string> = { chelsea: '📨 Para Chelsea', yo: '🙋 Lo haces tú', tarea: '➕ Tarea creada', archivar: '🗄 Archivado' }

/**
 * After a decision the alert is rewritten in place: what was decided, the
 * subject, and the buttons that still make sense for its new state.
 * `eraRespondido`: it had been answered → "✅ Respondido · 📝 tarea creada".
 */
export async function editarAlertaTrasDecision(c: Correo, accion: CorreoAccion, opts: { eraRespondido: boolean; duena: string | null }): Promise<void> {
  if (!c.telegram_chat_id || !c.telegram_message_id) return
  const texto = opts.eraRespondido && (accion === 'yo' || accion === 'tarea')
    ? textoRespondido(c, opts.duena, ' · 📝 tarea creada')
    : `${TITULO[accion]} · ${escapeHtml(c.asunto ?? '(sin asunto)')} · De: ${escapeHtml(remitenteCorto(c))}`
  await editMessageText(Number(c.telegram_chat_id), Number(c.telegram_message_id), texto, { html: true, replyMarkup: botonesTrasEstado(c) })
}
