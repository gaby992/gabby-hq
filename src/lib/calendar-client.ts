// Browser-side helpers for Calendar (fase 5-D). The browser never talks to
// Google: it writes the task in Supabase and then asks the server to keep
// the event in step. Both are no-ops when the task has no event, and never
// throw — a Calendar hiccup must not break the UI.

import type { Task } from '@/types'

type Ref = Pick<Task, 'id' | 'gcal_event_id'>

async function post(body: unknown): Promise<string | null> {
  try {
    const res = await fetch('/api/calendar/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    return json?.aviso ?? (res.ok ? null : json?.error ?? `HTTP ${res.status}`)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** After updating a task (done, date, hour, title…). Returns a warning line or null. */
export async function syncCalendar(task: Ref): Promise<string | null> {
  if (!task.gcal_event_id) return null
  return post({ task_id: task.id })
}

/** Before deleting a task row. Returns a warning line or null. */
export async function dropCalendarBeforeDelete(task: Ref): Promise<string | null> {
  if (!task.gcal_event_id) return null
  return post({ task_id: task.id, antes_de_borrar: true })
}

/** "📅 Agregar a Calendar" / "quitar": creates (or removes) the task's event. */
export async function toggleCalendar(taskId: string, quitar: boolean, todoElDia: boolean): Promise<{ ok: boolean; mensaje: string }> {
  try {
    const res = await fetch('/api/calendar/tarea', {
      method: quitar ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, todo_el_dia: todoElDia }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, mensaje: json?.error ?? `HTTP ${res.status}` }
    return { ok: true, mensaje: quitar ? 'Evento quitado de Calendar' : json?.confirmacion ?? '📅 En Calendar' }
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : String(err) }
  }
}
