// Fase 15: where a reminder lives.
//
// Until now "alarma mañana 10am pagar el seguro" was a row in
// bot_recordatorios that the bot sent to Telegram at the hour. It worked, but
// Telegram ended up carrying everything with the same weight — alarms, their
// "te lo recuerdo otra vez", the lists, the conversation — and she stopped
// telling them apart. The rule she chose (9 nov):
//
//   · it has an HOUR  → Google Calendar. The phone rings by itself, at the
//                        hour, even with the chat closed. It can repeat
//                        ("los días 10 de cada mes").
//   · it is a TIMER   → Telegram ("avísame en 20 minutos"): a nudge inside
//                        the conversation, not a date.
//   · Calendar fails  → Telegram, this once, saying why. A reminder is never
//                        lost because of a connection.
//
// She keeps saying "alarma…", "recuérdame…", "avísame…" exactly as before.

import { crearEventoLibre, describirRepeticion, primeraFechaEn, type EventoLibre, type Repeticion } from '@/lib/google/calendar'
import { avisoCalendar } from '@/lib/google/oauth'
import { mensajeError } from '@/lib/errores'
import { cancunHm, cancunYmd, formatFechaHoraEs, formatHoraEs, formatVenceEs } from './cancun'
import { crearRecordatorio, recordatoriosPendientes, type Recordatorio } from './recordatorios'
import { createServerClient } from '@/lib/supabase-server'

/** A reminder is a point in time, not a meeting: a short block is enough to see it in the day. */
export const DURACION_AVISO_MIN = 15
/** In the calendar, the clock tells a reminder apart from an appointment at a glance. */
export const PREFIJO_AVISO = '⏰ '

export interface Aviso {
  texto: string
  /** When it fires (ISO instant). */
  dispara_en: string
  repetir?: Repeticion | null
  /** "en 20 minutos": a timer, stays in Telegram. */
  temporizador?: boolean
}

/** The Calendar event a reminder becomes: at its hour, ringing at minute 0. */
export function eventoDeAviso(a: Pick<Aviso, 'texto' | 'dispara_en' | 'repetir'>): EventoLibre {
  const cuando = new Date(a.dispara_en)
  const base = cancunYmd(cuando)
  // A weekly repeat starts on the first of its weekdays, like any other event.
  const fecha = a.repetir?.cada === 'semana' && a.repetir.dias && a.repetir.dias.length > 0 ? primeraFechaEn(base, a.repetir.dias) : base
  return {
    titulo: a.texto.startsWith(PREFIJO_AVISO) ? a.texto : `${PREFIJO_AVISO}${a.texto}`,
    fecha,
    hora: cancunHm(cuando),
    duracion_min: DURACION_AVISO_MIN,
    repetir: a.repetir ?? null,
    aviso_min: 0,
  }
}

/** "⏰ En tu calendario: «pagar el seguro» · mar 10 nov 10:00 am · cada mes, hasta que avises · abrir" */
export function confirmacionEnCalendar(a: Pick<Aviso, 'texto' | 'dispara_en' | 'repetir'>, link: string | null): string {
  // The date shown is the event's own first day (a weekly one may start a few days later).
  const ev = eventoDeAviso(a)
  const rep = describirRepeticion(a.repetir, ev.fecha)
  const partes = [`⏰ En tu calendario: «${a.texto}»`, `${formatVenceEs(ev.fecha)} ${formatHoraEs(ev.hora ?? '09:00')}`]
  if (rep) partes.push(rep)
  if (link) partes.push(`<a href="${link}">abrir</a>`)
  return partes.join(' · ')
}

/** "⏰ Te aviso por aquí: «revisar el deploy» · lun 9 nov 5:10 pm" */
export function confirmacionEnTelegram(r: Pick<Recordatorio, 'texto' | 'dispara_en'>): string {
  return `⏰ Te aviso por aquí: «${r.texto}» · ${formatFechaHoraEs(r.dispara_en)}`
}

/**
 * Creates the reminder where it belongs and returns the line that confirms
 * it. Never throws for a Calendar problem: the reminder falls back to
 * Telegram and the line says why and how to fix it.
 */
export async function crearAviso(chatId: number, a: Aviso): Promise<string> {
  if (a.temporizador) {
    return confirmacionEnTelegram(await crearRecordatorio(chatId, a.texto, a.dispara_en))
  }
  try {
    const r = await crearEventoLibre(eventoDeAviso(a))
    return confirmacionEnCalendar(a, r.link)
  } catch (err) {
    console.warn(`[avisos] calendar falló, va por Telegram: ${mensajeError(err)}`)
    const r = await crearRecordatorio(chatId, a.texto, a.dispara_en)
    const lines = [avisoCalendar(err), `${confirmacionEnTelegram(r)} (por esta vez).`]
    if (a.repetir) lines.push('Ojo: por aquí suena solo esta vez, no se repite. Cuando Calendar esté bien, dímela otra vez y queda fija.')
    return lines.join('\n')
  }
}

export interface Mudanza {
  movidas: Recordatorio[]
  fallidas: { recordatorio: Recordatorio; motivo: string }[]
}

/**
 * "pasa mis alarmas al calendario": every pending Telegram reminder becomes
 * a Calendar event at its hour and leaves the bot's list. One that Calendar
 * refuses stays where it was, so nothing is lost halfway.
 */
export async function mudarACalendar(chatId: number): Promise<Mudanza> {
  const pendientes = await recordatoriosPendientes(chatId)
  const out: Mudanza = { movidas: [], fallidas: [] }
  for (const r of pendientes) {
    try {
      await crearEventoLibre(eventoDeAviso({ texto: r.texto, dispara_en: r.dispara_en }))
      const { error } = await createServerClient().from('bot_recordatorios').delete().eq('id', r.id)
      if (error) throw new Error(`Supabase bot_recordatorios: ${error.message}`)
      out.movidas.push(r)
    } catch (err) {
      out.fallidas.push({ recordatorio: r, motivo: mensajeError(err) })
      // The first refusal is the same for all of them (a connection problem): stop asking Google.
      if (out.movidas.length === 0) {
        for (const resto of pendientes.slice(pendientes.indexOf(r) + 1)) out.fallidas.push({ recordatorio: resto, motivo: 'no lo intenté' })
        return out
      }
    }
  }
  return out
}

/** What "pasa mis alarmas al calendario" answers. */
export async function textoMudanza(chatId: number): Promise<string> {
  const pendientes = await recordatoriosPendientes(chatId)
  if (pendientes.length === 0) return 'No tienes alarmas pendientes por aquí. Las nuevas con hora ya van directo a tu calendario.'
  const m = await mudarACalendar(chatId)
  const lines: string[] = []
  if (m.movidas.length > 0) {
    lines.push(`📆 Pasé ${m.movidas.length} ${m.movidas.length === 1 ? 'alarma' : 'alarmas'} a tu calendario:`)
    for (const r of m.movidas) lines.push(`• «${r.texto}» · ${formatFechaHoraEs(r.dispara_en)}`)
  }
  if (m.fallidas.length > 0) {
    const primera = m.fallidas[0]
    lines.push(avisoCalendar(new Error(primera.motivo)))
    lines.push(`${m.fallidas.length === 1 ? 'Quedó 1 alarma' : `Quedaron ${m.fallidas.length} alarmas`} por aquí, tal como ${m.fallidas.length === 1 ? 'estaba' : 'estaban'}: no se perdió nada.`)
  }
  return lines.join('\n')
}
