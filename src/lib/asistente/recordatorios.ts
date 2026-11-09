// Gabby's own alarms (fase 4): "alarma mañana 3pm revisar pagos de PD".
// One row per reminder in `bot_recordatorios`; a cron every 5 minutes
// (/api/asistente/recordatorios) sends the ones whose time has come as
// "⏰ texto" with [✅ Listo] [⏰ +1h] [📅 Mañana] and marks them `enviado`.
// They are NOT tasks: they never show in Hoy, the matrix or the alarms.

import { createServerClient } from '@/lib/supabase-server'
import { addDays, cancunHm, cancunInstant, cancunYmd, formatFechaHoraEs } from './cancun'
import { inlineKeyboard, isAllowedChat, sendTelegram } from './telegram'

export interface Recordatorio {
  id: string
  chat_id: number
  texto: string
  dispara_en: string
  enviado: boolean
  created_at: string
}

/** The four buttons when "alarma …" came without an hour. */
export const HORAS_BOTONES = ['09', '12', '15', '18'] as const

export const USO_ALARMA =
  'Formato: alarma mañana 3pm revisar pagos · recuérdame el viernes a las 10 llamar al contador · avísame en 2 horas revisar el deploy'

function tabla() {
  return createServerClient().from('bot_recordatorios')
}

/** "⏰ Alarma: «texto» · sáb 1 nov 3:00 pm" */
export function confirmacionAlarma(r: Pick<Recordatorio, 'texto' | 'dispara_en'>): string {
  return `⏰ Alarma: «${r.texto}» · ${formatFechaHoraEs(r.dispara_en)}`
}

/**
 * Turns what the interpreter understood into the instant to fire. `hora` is
 * 'HH:MM' (24 h); `en_minutos` is the "avísame en 2 horas" form. Returns null
 * when there is not enough to decide (no hour) — the webhook then asks.
 */
export function instanteDe(a: { fecha?: string | null; hora?: string | null; en_minutos?: number | null }, now: Date = new Date()): string | null {
  if (typeof a.en_minutos === 'number' && Number.isFinite(a.en_minutos) && a.en_minutos > 0) {
    return new Date(now.getTime() + Math.round(a.en_minutos) * 60_000).toISOString()
  }
  const hora = a.hora && /^\d{1,2}:\d{2}$/.test(a.hora) ? a.hora.padStart(5, '0') : null
  if (!hora) return null
  let fecha = a.fecha && /^\d{4}-\d{2}-\d{2}$/.test(a.fecha) ? a.fecha : cancunYmd(now)
  // "alarma 3pm" said at 4 pm means tomorrow, not a minute ago.
  if (!a.fecha && hora <= cancunHm(now)) fecha = addDays(fecha, 1)
  return cancunInstant(fecha, hora)
}

export async function crearRecordatorio(chatId: number, texto: string, disparaEn: string): Promise<Recordatorio> {
  const { data, error } = await tabla()
    .insert({ chat_id: chatId, texto, dispara_en: disparaEn })
    .select()
    .single<Recordatorio>()
  if (error) throw new Error(`Supabase bot_recordatorios: ${error.message}`)
  return data
}

/** Pending (not yet sent) reminders of a chat, soonest first — the numbering "mis alarmas" shows. */
export async function recordatoriosPendientes(chatId: number): Promise<Recordatorio[]> {
  const { data, error } = await tabla()
    .select('*')
    .eq('chat_id', chatId)
    .eq('enviado', false)
    .order('dispara_en', { ascending: true })
  if (error) throw new Error(`Supabase bot_recordatorios: ${error.message}`)
  return (data as Recordatorio[]) ?? []
}

export async function listarRecordatorios(chatId: number): Promise<string> {
  const rows = await recordatoriosPendientes(chatId)
  // Fase 15: las alarmas con hora ya viven en Google Calendar; aquí solo quedan los temporizadores y las viejas.
  if (rows.length === 0) return 'No tienes alarmas pendientes por aquí. Las que tienen hora están en tu Google Calendar (con ⏰ en el título).'
  const lines = rows.map((r, i) => `${i + 1}. «${r.texto}» · ${formatFechaHoraEs(r.dispara_en)}`)
  return [`⏰ Alarmas que te aviso por aquí (${rows.length}):`, ...lines, 'Las que tienen hora están en tu Google Calendar. Para quitar una de aquí: "quita alarma 2" · para mudarlas: "pasa mis alarmas al calendario".'].join('\n')
}

/**
 * Fase 15: what comes after "quita … alarma(s)" when she means several:
 * "todas" → all of them; "todas las de pago" / "las de pago" → the ones with
 * that word. Null when it names just one (a number or a word).
 */
export function leerQuitarVarias(arg: string): { palabra: string | null } | null {
  const n = arg.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  // Only the plural form reaches here marked with "todas": "quita alarma de pago" (one) is never a sweep.
  const m = n.match(/^todas?(?:\s+(?:las?\s+)?(?:de|del|que\s+digan?|con)\s+(.+))?$/)
  return m ? { palabra: m[1]?.trim() || null } : null
}

/** "quita alarma 2" (its number in "mis alarmas") or "quita alarma pagos" (a word of the text). */
export async function quitarRecordatorio(chatId: number, arg: string): Promise<string> {
  const rows = await recordatoriosPendientes(chatId)
  if (rows.length === 0) return 'No tienes alarmas pendientes.'
  const rest = arg.trim()
  // Fase 15: "quita todas las alarmas" y "quita las alarmas de pago" — varias de una vez.
  const varias = leerQuitarVarias(rest)
  if (varias) {
    const plano = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const fuera = varias.palabra ? rows.filter((r) => plano(r.texto).includes(plano(varias.palabra!))) : rows
    if (fuera.length === 0) return `No encontré ninguna alarma con «${varias.palabra}».`
    const { error } = await tabla().delete().in('id', fuera.map((r) => r.id))
    if (error) throw new Error(`Supabase bot_recordatorios: ${error.message}`)
    return [`🗑 Quité ${fuera.length} ${fuera.length === 1 ? 'alarma' : 'alarmas'}:`, ...fuera.map((r) => `• «${r.texto}» · ${formatFechaHoraEs(r.dispara_en)}`)].join('\n')
  }
  let hit: Recordatorio | undefined
  if (/^\d+$/.test(rest)) {
    hit = rows[Number(rest) - 1]
    if (!hit) return `No hay alarma ${rest} (tienes ${rows.length}). Mira "mis alarmas".`
  } else {
    const needle = rest.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const hits = rows.filter((r) => r.texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(needle))
    if (hits.length === 0) return `No encontré ninguna alarma con «${rest}».`
    if (hits.length > 1) return `Hay ${hits.length} alarmas con «${rest}». Dime el número ("mis alarmas").`
    hit = hits[0]
  }
  const { error } = await tabla().delete().eq('id', hit.id)
  if (error) throw new Error(`Supabase bot_recordatorios: ${error.message}`)
  return `🗑 Alarma quitada: «${hit.texto}» · ${formatFechaHoraEs(hit.dispara_en)}`
}

// ── Sending (cron) ───────────────────────────────────────────────────────

function botonesRecordatorio(id: string) {
  // "r:<uuid>:ok|1h|man" — 36 + 6 chars, under Telegram's 64-byte cap.
  return inlineKeyboard([[
    { text: '✅ Listo', callback_data: `r:${id}:ok` },
    { text: '⏰ +1h', callback_data: `r:${id}:1h` },
    { text: '📅 Mañana', callback_data: `r:${id}:man` },
  ]])
}

export interface EnvioRecordatorios {
  vencidos: number
  enviados: number
  fallidos: number
}

/**
 * Sends every reminder whose time has come and marks it sent. A reminder
 * that fails to send stays pending, so the next run (5 min) retries it.
 * A reminder of a chat no longer in ALLOWED_CHAT_IDS is marked sent without
 * sending — the list of who the bot talks to is the env var, nothing else.
 */
export async function enviarRecordatoriosVencidos(now: Date = new Date()): Promise<EnvioRecordatorios> {
  const { data, error } = await tabla()
    .select('*')
    .eq('enviado', false)
    .lte('dispara_en', now.toISOString())
    .order('dispara_en', { ascending: true })
  if (error) throw new Error(`Supabase bot_recordatorios: ${error.message}`)
  const rows = (data as Recordatorio[]) ?? []
  let enviados = 0
  let fallidos = 0
  for (const r of rows) {
    try {
      if (isAllowedChat(r.chat_id)) {
        await sendTelegram(r.chat_id, `⏰ ${r.texto}`, { tag: 'recordatorio', replyMarkup: botonesRecordatorio(r.id) })
      } else {
        console.warn(`[recordatorio] chat ${r.chat_id} ya no está autorizado; se descarta «${r.texto}»`)
      }
      const { error: e2 } = await tabla().update({ enviado: true }).eq('id', r.id)
      if (e2) throw new Error(`Supabase bot_recordatorios: ${e2.message}`)
      enviados += 1
    } catch (err) {
      fallidos += 1
      console.error(`[recordatorio] ${r.id} «${r.texto}»: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { vencidos: rows.length, enviados, fallidos }
}

// ── Buttons on a sent reminder ───────────────────────────────────────────

export type RespuestaRecordatorio = 'ok' | '1h' | 'man'

export async function responderRecordatorio(chatId: number, id: string, que: RespuestaRecordatorio, now: Date = new Date()): Promise<string> {
  const { data, error } = await tabla().select('*').eq('id', id).eq('chat_id', chatId).maybeSingle<Recordatorio>()
  if (error) throw new Error(`Supabase bot_recordatorios: ${error.message}`)
  if (!data) return 'Esa alarma ya no existe.'
  if (que === 'ok') return `✅ Listo: «${data.texto}»`
  // Fase 15: this text REPLACES the alarm's own message (no second message).

  let disparaEn: string
  if (que === '1h') {
    disparaEn = new Date(now.getTime() + 60 * 60_000).toISOString()
  } else {
    // Same wall-clock time, tomorrow (Cancún).
    disparaEn = cancunInstant(addDays(cancunYmd(now), 1), cancunHm(new Date(data.dispara_en)))
  }
  const { error: e2 } = await tabla().update({ dispara_en: disparaEn, enviado: false }).eq('id', id)
  if (e2) throw new Error(`Supabase bot_recordatorios: ${e2.message}`)
  return `💤 Pospuesta: «${data.texto}» → ${formatFechaHoraEs(disparaEn)}`
}
