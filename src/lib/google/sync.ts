// One Calendar event per task that Gabby asked to put there (fase 5-B).
// A task never goes to Calendar on its own, hour or not. Once it has an
// event (gcal_event_id), every write the bot or the API makes keeps that
// event in step: moved → updated, done / cancelled / deleted → removed.
// Google failing never blocks the task: the caller gets a one-line warning.

import { createServerClient } from '@/lib/supabase-server'
import type { Priority } from '@/types'
import { formatFechaHoraEs, formatVenceEs, cancunInstant } from '@/lib/asistente/cancun'
import { actualizarEvento, borrarEvento, crearEvento, type TareaEvento } from './calendar'
import { googleConfigurado } from './oauth'

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

export type EstadoSync = 'creado' | 'actualizado' | 'borrado' | 'sin_cambio' | 'error'

export interface ResultadoSync {
  estado: EstadoSync
  /** "⚠️ sin evento en Calendar: …" when something went wrong. */
  aviso?: string
  /** "📅 En calendar: «título» · vie 6 nov 3:00 pm" after a create. */
  confirmacion?: string
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
    due_time: r.due_time,
    company_name: r.company?.name?.trim() ?? null,
  }
}

async function cargar(taskId: string): Promise<Row | null> {
  const { data, error } = await createServerClient().from('tasks').select(COLS_SYNC).eq('id', taskId).maybeSingle()
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  return (data as unknown as Row) ?? null
}

async function guardarEventId(id: string, eventId: string | null): Promise<void> {
  const { error } = await createServerClient().from('tasks').update({ gcal_event_id: eventId }).eq('id', id)
  if (error) console.error(`[calendar] no pude guardar gcal_event_id: ${error.message}`)
}

/** "vie 6 nov 3:00 pm" or "vie 6 nov · todo el día". */
export function cuandoDe(r: { due_date: string; due_time: string | null }): string {
  return r.due_time ? formatFechaHoraEs(cancunInstant(r.due_date, r.due_time.slice(0, 5))) : `${formatVenceEs(r.due_date)} · todo el día`
}

/**
 * "y ponla en calendar": creates (or refreshes) the event of an open task
 * with a date. `hora` may set the task's hour first; `todoElDia` clears it.
 */
export async function agregarACalendar(taskId: string, opts: { hora?: string | null; todoElDia?: boolean } = {}): Promise<ResultadoSync> {
  if (!googleConfigurado()) return { estado: 'error', aviso: '⚠️ sin evento en Calendar: faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / APP_ENCRYPTION_KEY en Vercel' }
  const db = createServerClient()
  if (opts.hora || opts.todoElDia) {
    const { error } = await db.from('tasks').update({ due_time: opts.todoElDia ? null : opts.hora }).eq('id', taskId)
    if (error) throw new Error(`Supabase tasks: ${error.message}`)
  }
  const r = await cargar(taskId)
  if (!r) return { estado: 'error', aviso: '⚠️ sin evento en Calendar: esa tarea ya no existe' }
  if (r.done) return { estado: 'error', aviso: '⚠️ sin evento en Calendar: la tarea ya está cerrada' }
  if (!r.due_date) return { estado: 'error', aviso: `⚠️ sin evento en Calendar: «${r.text}» no tiene fecha. Ponle una ("… para el viernes") y vuelve a pedirlo.` }
  try {
    const confirmacion = `📅 En calendar: «${r.text}» · ${cuandoDe({ due_date: r.due_date, due_time: r.due_time })}`
    if (r.gcal_event_id && (await actualizarEvento(r.gcal_event_id, comoEvento(r)))) {
      return { estado: 'actualizado', confirmacion }
    }
    const id = await crearEvento(comoEvento(r))
    await guardarEventId(r.id, id)
    return { estado: 'creado', confirmacion }
  } catch (err) {
    return aviso(err)
  }
}

/** Removes the task's event and forgets its id. */
export async function quitarDeCalendar(taskId: string): Promise<ResultadoSync> {
  const r = await cargar(taskId)
  if (!r?.gcal_event_id) return SIN_CAMBIO
  try {
    await borrarEvento(r.gcal_event_id)
    await guardarEventId(r.id, null)
    return { estado: 'borrado' }
  } catch (err) {
    return aviso(err)
  }
}

/**
 * After a write: keep the existing event (if any) equal to the row. Never
 * creates one — that is Gabby's call (agregarACalendar).
 */
export async function sincronizarTarea(taskId: string): Promise<ResultadoSync> {
  if (!googleConfigurado()) return SIN_CAMBIO
  let r: Row | null
  try {
    r = await cargar(taskId)
  } catch {
    return SIN_CAMBIO
  }
  if (!r?.gcal_event_id) return SIN_CAMBIO
  try {
    if (r.done || !r.due_date) {
      await borrarEvento(r.gcal_event_id)
      await guardarEventId(r.id, null)
      return { estado: 'borrado' }
    }
    const ok = await actualizarEvento(r.gcal_event_id, comoEvento(r))
    if (!ok) {
      // Deleted by hand in Google: stop tracking it.
      await guardarEventId(r.id, null)
      return SIN_CAMBIO
    }
    return { estado: 'actualizado' }
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
