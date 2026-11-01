// Google Calendar for the assistant (fase 5), on the primary calendar of the
// connected account:
//   · a task's event, ONLY when Gabby asks for it ("y ponla en calendar"):
//     "[IM] título", 30 min at its hour, or all day; popup 15 min before.
//   · a recurring monthly payment (fase 5-C): "💳 IM · Vercel" on day N,
//     9:00–9:30 am Cancún, popups 7 days, 3 days and the same morning.

import { CANCUN_TZ, addDays } from '@/lib/asistente/cancun'
import { PRIORITY_LABELS, type Priority } from '@/types'
import { GoogleError, accessToken, conexionActiva } from './oauth'

export const DURACION_MIN = 30
export const AVISO_MIN = 15
/** Payments are a 30-minute slot at this hour so the "same day" reminder can be at 9 am. */
export const PAGO_HORA = '09:00'

export interface TareaEvento {
  id: string
  text: string
  priority: Priority
  importante: boolean
  due_date: string
  /** 'HH:MM' or 'HH:MM:SS'; null → all-day event. */
  due_time: string | null
  company_name: string | null
}

export interface PagoEvento {
  nombre: string
  company_name: string
  dia_del_mes: number
  monto_texto: string | null
  /** Days before: 7, 3, 0 (0 = the same morning). */
  recordatorios: number[]
  /** First occurrence 'YYYY-MM-DD' (today or the next day N). */
  desde: string
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

function hm(t: string): string {
  return t.slice(0, 5)
}

/** The request body Calendar expects for this task. */
export function cuerpoEvento(t: TareaEvento): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: `${t.company_name ? `[${t.company_name}] ` : ''}${t.text}`,
    description: `Prioridad: ${PRIORITY_LABELS[t.priority]}${t.importante ? ' ★' : ''}\n${appUrl()}/tasks`,
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: AVISO_MIN }] },
    source: { title: 'GabbyHQ', url: `${appUrl()}/tasks` },
  }
  if (t.due_time) {
    // Cancún is UTC-5 all year, so the fixed offset is exact.
    const start = new Date(`${t.due_date}T${hm(t.due_time)}:00-05:00`)
    const end = new Date(start.getTime() + DURACION_MIN * 60_000)
    body.start = { dateTime: start.toISOString(), timeZone: CANCUN_TZ }
    body.end = { dateTime: end.toISOString(), timeZone: CANCUN_TZ }
  } else {
    // All-day: `end.date` is exclusive.
    body.start = { date: t.due_date }
    body.end = { date: addDays(t.due_date, 1) }
  }
  return body
}

/** Monthly recurring 9:00–9:30 event with the payment reminders. */
export function cuerpoPago(p: PagoEvento): Record<string, unknown> {
  const start = new Date(`${p.desde}T${PAGO_HORA}:00-05:00`)
  const end = new Date(start.getTime() + DURACION_MIN * 60_000)
  return {
    summary: `💳 ${p.company_name} · ${p.nombre}${p.monto_texto ? ` · ${p.monto_texto}` : ''}`,
    description: `Pago recurrente de ${p.company_name}, día ${p.dia_del_mes} de cada mes.\n${appUrl()}/settings`,
    start: { dateTime: start.toISOString(), timeZone: CANCUN_TZ },
    end: { dateTime: end.toISOString(), timeZone: CANCUN_TZ },
    recurrence: [`RRULE:FREQ=MONTHLY;BYMONTHDAY=${p.dia_del_mes}`],
    reminders: {
      useDefault: false,
      overrides: p.recordatorios.map((d) => ({ method: 'popup', minutes: Math.max(0, d) * 1440 })),
    },
    source: { title: 'GabbyHQ', url: `${appUrl()}/settings` },
  }
}

const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

async function llamar(method: string, path: string, body?: unknown): Promise<Record<string, unknown> | null> {
  const conn = await conexionActiva()
  if (!conn) throw new GoogleError('no hay cuenta de Google conectada (Settings → Conexiones)')
  const token = await accessToken(conn)
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    // Gone / not found on delete or patch: the event is already not there.
    if ((res.status === 404 || res.status === 410) && method !== 'POST') return null
    throw new GoogleError(json?.error?.message ?? `Calendar HTTP ${res.status}`)
  }
  return json
}

async function crear(body: Record<string, unknown>): Promise<string> {
  const json = await llamar('POST', '', body)
  const id = String(json?.id ?? '')
  if (!id) throw new GoogleError('Calendar no devolvió id del evento')
  return id
}

/** Creates the event and returns its id. */
export async function crearEvento(t: TareaEvento): Promise<string> {
  return crear(cuerpoEvento(t))
}

/** Updates an existing event; returns false if it no longer exists. */
export async function actualizarEvento(eventId: string, t: TareaEvento): Promise<boolean> {
  // PUT, not PATCH: switching between timed and all-day must drop the other pair of fields.
  const json = await llamar('PUT', `/${encodeURIComponent(eventId)}`, cuerpoEvento(t))
  return json !== null
}

export async function borrarEvento(eventId: string): Promise<void> {
  await llamar('DELETE', `/${encodeURIComponent(eventId)}`)
}

export async function crearEventoPago(p: PagoEvento): Promise<string> {
  return crear(cuerpoPago(p))
}

export async function actualizarEventoPago(eventId: string, p: PagoEvento): Promise<boolean> {
  const json = await llamar('PUT', `/${encodeURIComponent(eventId)}`, cuerpoPago(p))
  return json !== null
}

export { GoogleError }
