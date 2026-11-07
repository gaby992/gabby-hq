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
    cache: 'no-store',
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

// ── Fase 12: READ one day of the connected calendar ──────────────────────
// The "Agenda de hoy" of the Dashboard de vida shows the events of the
// connected Google Calendar next to the tasks with an hour and the payments.
// Reading only: nothing is created, moved or deleted here — Calendar still
// WRITES on request only (fase 5). calendar.events already covers reads.

export interface EventoDia {
  id: string
  titulo: string
  /** 'HH:MM' Cancún, or null for an all-day event. */
  hora: string | null
  /** 'HH:MM' Cancún, or null. */
  fin: string | null
  todoElDia: boolean
  link: string | null
  /** Where the event comes from, as Calendar reports it (the account's primary calendar). */
  calendario: string | null
}

function horaCancun(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: CANCUN_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace(/^24:/, '00:')
}

/**
 * The events of the Cancún civil day `ymd`, in start order, from the primary
 * calendar of the account with Calendar on. Recurring events arrive expanded
 * (one row per instance). Throws GoogleError when there is no connection or
 * Google refuses; the caller decides how silent to be.
 */
export async function eventosDelDia(ymd: string): Promise<EventoDia[]> {
  const conn = await conexionActiva()
  if (!conn) throw new GoogleError('no hay cuenta de Google conectada (Settings → Conexiones)')
  const token = await accessToken(conn)
  const q = new URLSearchParams({
    timeMin: new Date(`${ymd}T00:00:00-05:00`).toISOString(),
    timeMax: new Date(`${addDays(ymd, 1)}T00:00:00-05:00`).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
    timeZone: CANCUN_TZ,
  })
  const res = await fetch(`${BASE}?${q.toString()}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new GoogleError(json?.error?.message ?? `Calendar HTTP ${res.status}`)
  const items = Array.isArray(json?.items) ? (json.items as Record<string, unknown>[]) : []
  return items
    .filter((e) => e.status !== 'cancelled')
    .map((e) => {
      const start = (e.start ?? {}) as { dateTime?: string; date?: string }
      const end = (e.end ?? {}) as { dateTime?: string; date?: string }
      const todoElDia = !start.dateTime
      return {
        id: String(e.id ?? ''),
        titulo: String(e.summary ?? '(sin título)'),
        hora: start.dateTime ? horaCancun(start.dateTime) : null,
        fin: end.dateTime ? horaCancun(end.dateTime) : null,
        todoElDia,
        link: typeof e.htmlLink === 'string' ? e.htmlLink : null,
        calendario: conn.email ?? null,
      }
    })
    .filter((e) => e.id)
}

export async function actualizarEventoPago(eventId: string, p: PagoEvento): Promise<boolean> {
  const json = await llamar('PUT', `/${encodeURIComponent(eventId)}`, cuerpoPago(p))
  return json !== null
}

export { GoogleError }
