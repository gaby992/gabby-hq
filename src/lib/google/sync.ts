// Keeps one Calendar event per task that has a date AND an hour (fase 5).
// Called after every write the bot or the API makes to a task. Google
// failing never blocks the task: the caller gets a one-line warning to show.

import { createServerClient } from '@/lib/supabase-server'
import type { Priority } from '@/types'
import { actualizarEvento, borrarEvento, crearEvento, type TareaEvento } from './calendar'
import { conexionActiva, googleConfigurado } from './oauth'

interface Row {
  id: string
  text: string
  priority: Priority
  importante: boolean
  due_date: string | null
  due_time: string | null
  done: boolean
  gcal_event_id: string | null
  company: { name: string } | null
}

export type EstadoSync = 'creado' | 'actualizado' | 'borrado' | 'sin_cambio' | 'sin_conexion' | 'error'

export interface ResultadoSync {
  estado: EstadoSync
  /** "⚠️ sin evento en Calendar: …" when something went wrong. */
  aviso?: string
}

const SIN_CAMBIO: ResultadoSync = { estado: 'sin_cambio' }

export const COLS_SYNC = 'id, text, priority, importante, due_date, due_time, done, gcal_event_id, company:companies(name)'

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function aviso(err: unknown): ResultadoSync {
  console.error(`[calendar] ${errorMsg(err)}`)
  return { estado: 'error', aviso: `⚠️ sin evento en Calendar: ${errorMsg(err)}` }
}

function comoEvento(r: Row): TareaEvento {
  return {
    id: r.id,
    text: r.text,
    priority: r.priority,
    importante: r.importante,
    due_date: r.due_date!,
    due_time: r.due_time!,
    company_name: r.company?.name?.trim() ?? null,
  }
}

async function guardarEventId(id: string, eventId: string | null): Promise<void> {
  const { error } = await createServerClient().from('tasks').update({ gcal_event_id: eventId }).eq('id', id)
  if (error) console.error(`[calendar] no pude guardar gcal_event_id: ${error.message}`)
}

/**
 * Create / update / delete the event so it matches the task's current row.
 * Open + date + hour → an event exists (create or patch). Anything else →
 * no event (delete if there was one).
 */
export async function sincronizarTarea(taskId: string): Promise<ResultadoSync> {
  if (!googleConfigurado()) return SIN_CAMBIO
  const { data, error } = await createServerClient().from('tasks').select(COLS_SYNC).eq('id', taskId).maybeSingle()
  if (error || !data) return SIN_CAMBIO
  const r = data as unknown as Row
  const quiereEvento = !r.done && !!r.due_date && !!r.due_time

  try {
    if (!quiereEvento) {
      if (!r.gcal_event_id) return SIN_CAMBIO
      await borrarEvento(r.gcal_event_id)
      await guardarEventId(r.id, null)
      return { estado: 'borrado' }
    }
    if (!(await conexionActiva())) {
      return { estado: 'sin_conexion', aviso: '⚠️ sin evento en Calendar: no hay cuenta de Google conectada (Settings → Conexiones)' }
    }
    if (r.gcal_event_id) {
      const ok = await actualizarEvento(r.gcal_event_id, comoEvento(r))
      if (ok) return { estado: 'actualizado' }
      // The event was deleted by hand in Google: make a new one.
    }
    const id = await crearEvento(comoEvento(r))
    await guardarEventId(r.id, id)
    return { estado: 'creado' }
  } catch (err) {
    return aviso(err)
  }
}

/** Before a task row is deleted: drop its event (best-effort, never throws). */
export async function borrarEventoDeTarea(row: { id: string; gcal_event_id?: string | null }): Promise<ResultadoSync> {
  if (!row.gcal_event_id || !googleConfigurado()) return SIN_CAMBIO
  try {
    await borrarEvento(row.gcal_event_id)
    return { estado: 'borrado' }
  } catch (err) {
    return aviso(err)
  }
}

/** Joins the warnings of several syncs into the lines to append to a confirmation. */
export function avisosDe(resultados: ResultadoSync[]): string[] {
  return Array.from(new Set(resultados.map((r) => r.aviso).filter((a): a is string => !!a)))
}
