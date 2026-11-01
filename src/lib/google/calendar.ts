// Google Calendar events for tasks with a date AND an hour (fase 5), on the
// primary calendar of the connected account. Title "[IM] …", 30 minutes,
// description with the priority and the link to /tasks, popup 15 min before.

import { CANCUN_TZ } from '@/lib/asistente/cancun'
import { PRIORITY_LABELS, type Priority } from '@/types'
import { GoogleError, accessToken, conexionActiva } from './oauth'

export const DURACION_MIN = 30
export const AVISO_MIN = 15

export interface TareaEvento {
  id: string
  text: string
  priority: Priority
  importante: boolean
  due_date: string
  /** 'HH:MM' or 'HH:MM:SS'. */
  due_time: string
  company_name: string | null
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

function hm(t: string): string {
  return t.slice(0, 5)
}

/** The request body Calendar expects for this task. */
export function cuerpoEvento(t: TareaEvento): Record<string, unknown> {
  // Cancún is UTC-5 all year, so the fixed offset is exact.
  const start = new Date(`${t.due_date}T${hm(t.due_time)}:00-05:00`)
  const end = new Date(start.getTime() + DURACION_MIN * 60_000)
  return {
    summary: `${t.company_name ? `[${t.company_name}] ` : ''}${t.text}`,
    description: `Prioridad: ${PRIORITY_LABELS[t.priority]}${t.importante ? ' ★' : ''}\n${appUrl()}/tasks`,
    start: { dateTime: start.toISOString(), timeZone: CANCUN_TZ },
    end: { dateTime: end.toISOString(), timeZone: CANCUN_TZ },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: AVISO_MIN }] },
    source: { title: 'GabbyHQ', url: `${appUrl()}/tasks` },
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

/** Creates the event and returns its id. */
export async function crearEvento(t: TareaEvento): Promise<string> {
  const json = await llamar('POST', '', cuerpoEvento(t))
  const id = String(json?.id ?? '')
  if (!id) throw new GoogleError('Calendar no devolvió id del evento')
  return id
}

/** Updates an existing event; returns false if it no longer exists. */
export async function actualizarEvento(eventId: string, t: TareaEvento): Promise<boolean> {
  const json = await llamar('PATCH', `/${encodeURIComponent(eventId)}`, cuerpoEvento(t))
  return json !== null
}

export async function borrarEvento(eventId: string): Promise<void> {
  await llamar('DELETE', `/${encodeURIComponent(eventId)}`)
}

export { GoogleError }
