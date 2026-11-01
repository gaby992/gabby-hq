// Fase 7: the conversation thread. Every message in and out is a row in
// bot_conversacion; the interpreter sees the last 10 turns (or those of the
// last 30 minutes, whichever is fewer) so "sí", "la segunda", "lo mismo para
// PD" and "cambia la hora a las 4" make sense. "Olvida lo anterior" clears it.
// Declined suggestions ("luego") live here too, so the bot never insists.

import { createServerClient } from '@/lib/supabase-server'

export type Rol = 'user' | 'assistant'

export interface TareaMencionada {
  id: string
  text: string
}

export interface AccionesTurno {
  /** Tasks this turn talked about, in the order they were shown. */
  tareas?: TareaMencionada[]
  /** A suggestion the person declined: which one (and for which task). */
  declinado?: { clase: string; task_id?: string | null }
  /** The message was a button tap. */
  boton?: string
}

export interface Turno {
  id: string
  chat_id: number
  rol: Rol
  texto: string
  acciones: AccionesTurno | null
  created_at: string
}

export const MAX_TURNOS = 10
export const VENTANA_MIN = 30

function tabla() {
  return createServerClient().from('bot_conversacion')
}

/** Never throws: a missing table must not break a reply. */
export async function guardarTurno(chatId: number, rol: Rol, texto: string, acciones?: AccionesTurno): Promise<void> {
  const t = texto.replace(/<[^>]+>/g, '').trim()
  if (!t) return
  const { error } = await tabla().insert({ chat_id: chatId, rol, texto: t.slice(0, 4000), acciones: acciones ?? null })
  if (error) console.error(`[conversacion] insert: ${error.message}`)
}

/** The recent thread, oldest first. Stops at the last "olvida lo anterior". */
export async function historial(chatId: number, now: Date = new Date()): Promise<Turno[]> {
  const desde = new Date(now.getTime() - VENTANA_MIN * 60_000).toISOString()
  const { data, error } = await tabla()
    .select('*')
    .eq('chat_id', chatId)
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(MAX_TURNOS)
  if (error || !data) return []
  const turnos = (data as Turno[]).reverse()
  const corte = turnos.map((t) => t.texto).lastIndexOf('⟂ hilo limpiado')
  return corte >= 0 ? turnos.slice(corte + 1) : turnos
}

/** "Olvida lo anterior": a marker row; everything before it is ignored. */
export async function limpiarHilo(chatId: number): Promise<void> {
  await guardarTurno(chatId, 'assistant', '⟂ hilo limpiado')
}

/** The last task the thread talked about (for "la anterior"), newest first. */
export async function tareasRecientes(chatId: number): Promise<TareaMencionada[]> {
  const turnos = await historial(chatId)
  const out: TareaMencionada[] = []
  for (const t of [...turnos].reverse()) for (const x of t.acciones?.tareas ?? []) if (!out.some((o) => o.id === x.id)) out.push(x)
  return out
}

/** Did she decline this suggestion recently (today for a class, ever for a task)? */
export async function declinado(chatId: number, clase: string, taskId?: string | null): Promise<boolean> {
  const hace = new Date(Date.now() - (taskId ? 30 : 1) * 86_400_000).toISOString()
  const { data } = await tabla()
    .select('acciones')
    .eq('chat_id', chatId)
    .gte('created_at', hace)
    .not('acciones', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50)
  for (const row of (data as { acciones: AccionesTurno | null }[]) ?? []) {
    const d = row.acciones?.declinado
    if (d && d.clase === clase && (!taskId || d.task_id === taskId)) return true
  }
  return false
}

export async function registrarDeclinada(chatId: number, clase: string, taskId?: string | null): Promise<void> {
  await guardarTurno(chatId, 'user', `[luego: ${clase}]`, { declinado: { clase, task_id: taskId ?? null }, boton: 'luego' })
}

/**
 * The thread as the interpreter reads it. Assistant turns list the tasks
 * they showed with their current ref, so "la segunda" resolves.
 */
export function renderHistorial(turnos: Turno[], refDe: (id: string) => string | null): string {
  if (turnos.length === 0) return ''
  const lines = turnos.map((t) => {
    const quien = t.rol === 'user' ? 'ella' : 'tú'
    const texto = t.texto.length > 400 ? t.texto.slice(0, 399) + '…' : t.texto
    const tareas = (t.acciones?.tareas ?? [])
      .map((x, i) => `${i + 1}ª=${refDe(x.id) ?? `«${x.text}»`}`)
      .join(', ')
    return `${quien}: ${texto}${tareas ? `  [tareas mencionadas: ${tareas}]` : ''}`
  })
  return ['CONVERSACIÓN RECIENTE (de más vieja a más nueva; "sí", "la segunda", "esa no, la otra", "lo mismo para PD" se refieren a esto):', ...lines].join('\n')
}
