// Fase 7-B: the assistant proposes, it does not only obey. After an action
// or an answer it may add ONE short suggestion with buttons:
//   fecha      new task without a date   → ¿Para cuándo? [Hoy] [Mañana] [Esta semana] [Sin fecha]
//   calendar   important task with hour  → ¿La pongo en calendar? [Sí] [No]
//   seguir     after completing one      → 👏 Te quedan N de IM. ¿Seguimos con «…»? [Sí] [Luego]
//   vencida    an answer reveals a stale overdue task → Ojo: … [Esta semana] [Cancelar] [Déjala]
//   nota       … or a 20-day-old note    → ¿La archivo? [Archivar] [Déjala]
//   lista      end of "organízame"       → ¿Te mando la lista? [Sí]
//   todo_manana evening with nothing closed → ¿Pasamos todo a mañana? [Sí] [Elijo]
// Never more than one per message; never again once she said "luego"
// (bot_conversacion remembers); nothing at all when Settings says "solo obedece".

import { createServerClient } from '@/lib/supabase-server'
import type { Company, NotaEmpresa } from '@/types'
import { CHELSEA_COMPANY_NAME } from '@/lib/chelsea'
import { archivarNota } from '@/lib/notas'
import { daysSince } from '@/lib/dates'
import { agregarACalendar } from '@/lib/google/sync'
import { COLS_SIN_NOTAS, cancelarTareas, ejecutarAccion, etiqueta, manejarAccion, type TaskRow } from './acciones'
import { addDays, cancunYmd, daysBetween, formatVenceEs } from './cancun'
import type { AsistenteConfig } from './config'
import { declinado, guardarTurno, registrarDeclinada } from './conversacion'
import { enviarLista } from './alarmas'
import { inlineKeyboard, type InlineButton } from './telegram'

export type ClaseSugerencia = 'fecha' | 'calendar' | 'seguir' | 'vencida' | 'nota' | 'lista' | 'todo_manana'

export interface SugerenciaDraft {
  tipo: 'sugerencia'
  clase: ClaseSugerencia
  task_id?: string | null
  company_id?: string | null
}

export interface Sugerencia {
  texto: string
  /** Rows of [label, value]; the webhook turns them into "s:<nonce>:<value>". */
  botones: [string, string][][]
  draft: SugerenciaDraft
}

export const NOTA_VIEJA_DIAS = 20
export const VENCIDAS_PROBLEMA = 3

/** "Esta semana": Friday of this week; Friday itself today; Sat/Sun → next Friday. */
export function fechaEstaSemana(today: string = cancunYmd()): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  if (dow === 5) return today
  const diff = (5 - dow + 7) % 7
  return addDays(today, diff === 0 ? 7 : diff)
}

export function botonesDe(s: Sugerencia, nonce: string) {
  return inlineKeyboard(s.botones.map((fila) => fila.map(([text, v]): InlineButton => ({ text, callback_data: `s:${nonce}:${v}` }))))
}

async function tarea(id: string): Promise<TaskRow | null> {
  const { data } = await createServerClient().from('tasks').select(COLS_SIN_NOTAS).eq('id', id).maybeSingle()
  return (data as unknown as TaskRow) ?? null
}

// ── When to suggest ─────────────────────────────────────────────────────

/** After a new task was saved (and nothing is pending). */
export async function trasCrear(cfg: AsistenteConfig, taskId: string, t: { due_date: string | null; due_time?: string | null; priority: string | null; importante: boolean; calendar?: boolean }): Promise<Sugerencia | null> {
  if (!cfg.sugerencias) return null
  if (!t.due_date) {
    return {
      texto: '¿Para cuándo?',
      botones: [[['Hoy', 'hoy'], ['Mañana', 'man'], ['Esta semana', 'sem'], ['Sin fecha', 'no']]],
      draft: { tipo: 'sugerencia', clase: 'fecha', task_id: taskId },
    }
  }
  if (t.due_time && (t.priority === 'urgente' || t.importante) && !t.calendar) {
    return {
      texto: '¿La pongo en calendar?',
      botones: [[['📅 Sí', 'si'], ['No', 'no']]],
      draft: { tipo: 'sugerencia', clase: 'calendar', task_id: taskId },
    }
  }
  return null
}

/** After ONE task was completed: how many are left in its company, and the next one. */
export async function trasCompletar(chatId: number, cfg: AsistenteConfig, taskId: string): Promise<Sugerencia | null> {
  if (!cfg.sugerencias) return null
  if (await declinado(chatId, 'seguir')) return null
  const hecha = await tarea(taskId)
  if (!hecha) return null
  const db = createServerClient()
  const { data: rows } = await db.from('tasks').select(COLS_SIN_NOTAS + ', company_id').eq('done', false)
  const abiertas = ((rows as unknown as (TaskRow & { company_id: string | null })[]) ?? [])
  const { data: hechaRow } = await db.from('tasks').select('company_id').eq('id', taskId).maybeSingle<{ company_id: string | null }>()
  const mismas = abiertas.filter((t) => t.company_id === (hechaRow?.company_id ?? null))
  const empresa = hecha.company?.name ?? 'sin empresa'
  if (mismas.length === 0) return { texto: `👏 Con esa cerraste todo lo de ${empresa}.`, botones: [], draft: { tipo: 'sugerencia', clase: 'seguir', task_id: null } }
  const today = cancunYmd()
  const rank = (t: TaskRow) => (t.due_date && t.due_date < today ? 0 : t.due_date === today ? 1 : t.priority === 'urgente' ? 2 : t.importante ? 3 : 4)
  const siguiente = [...mismas].sort((a, b) => rank(a) - rank(b) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'))[0]
  return {
    texto: `👏 Te quedan ${mismas.length} de ${empresa}. ¿Seguimos con «${siguiente.text}»?`,
    botones: [[['Sí', 'si'], ['Luego', 'luego']]],
    draft: { tipo: 'sugerencia', clase: 'seguir', task_id: siguiente.id },
  }
}

/** After an answer: does the data show a problem worth ONE line? */
export async function trasPregunta(chatId: number, cfg: AsistenteConfig): Promise<Sugerencia | null> {
  if (!cfg.sugerencias) return null
  const today = cancunYmd()
  const db = createServerClient()
  const [{ data: rows }, { data: companies }, { data: notas }] = await Promise.all([
    db.from('tasks').select(COLS_SIN_NOTAS + ', company_id').eq('done', false).lt('due_date', today).order('due_date', { ascending: true }),
    db.from('companies').select('*'),
    db.from('notas_empresa').select('*'),
  ])
  const vencidas = ((rows as unknown as (TaskRow & { company_id: string | null })[]) ?? [])
  const porEmpresa = new Map<string | null, (TaskRow & { company_id: string | null })[]>()
  for (const t of vencidas) porEmpresa.set(t.company_id, [...(porEmpresa.get(t.company_id) ?? []), t])
  for (const [, lista] of Array.from(porEmpresa.entries())) {
    if (lista.length < VENCIDAS_PROBLEMA) continue
    const vieja = lista[0]
    if (await declinado(chatId, 'vencida', vieja.id)) continue
    const d = daysBetween(vieja.due_date!, today)
    return {
      texto: `Ojo: ${lista.length} vencidas de ${vieja.company?.name ?? 'sin empresa'}; «${vieja.text}» lleva ${d} días. ¿La pasamos a esta semana o la cancelamos?`,
      botones: [[['Esta semana', 'sem'], ['Cancelar', 'can'], ['Déjala', 'dej']]],
      draft: { tipo: 'sugerencia', clase: 'vencida', task_id: vieja.id },
    }
  }
  for (const n of (notas as NotaEmpresa[]) ?? []) {
    const dias = daysSince(n.updated_at)
    if (dias < NOTA_VIEJA_DIAS || !n.nota.trim()) continue
    if (await declinado(chatId, 'nota', n.company_id)) continue
    const c = ((companies as Company[]) ?? []).find((x) => x.id === n.company_id)
    return {
      texto: `Ojo: la nota de ${c?.name.trim() ?? '?'} tiene ${dias} días. ¿La archivo?`,
      botones: [[['Archivar', 'arch'], ['Déjala', 'dej']]],
      draft: { tipo: 'sugerencia', clase: 'nota', company_id: n.company_id },
    }
  }
  return null
}

export function trasOrganizar(): Sugerencia {
  return { texto: '¿Te mando la lista?', botones: [[['Sí', 'si'], ['No', 'no']]], draft: { tipo: 'sugerencia', clase: 'lista' } }
}

export function diaDificil(): Sugerencia {
  return {
    texto: 'Día difícil. ¿Pasamos todo a mañana y arrancamos limpio?',
    botones: [[['Sí', 'si'], ['Elijo', 'no']]],
    draft: { tipo: 'sugerencia', clase: 'todo_manana' },
  }
}

// ── The tap ─────────────────────────────────────────────────────────────

/** Runs what the button means and returns the one-line answer. */
export async function resolverSugerencia(chatId: number, cfg: AsistenteConfig, d: SugerenciaDraft, valor: string, nonce: string): Promise<string> {
  const today = cancunYmd()
  switch (d.clase) {
    case 'fecha': {
      if (!d.task_id) return 'Ok.'
      if (valor === 'no') return 'Ok, sin fecha.'
      const fecha = valor === 'hoy' ? today : valor === 'man' ? addDays(today, 1) : fechaEstaSemana(today)
      return ejecutarAccion({ accion: 'editar', cambios: { due_date: fecha } }, [d.task_id])
    }
    case 'calendar': {
      if (!d.task_id || valor !== 'si') return 'Ok, sin calendar.'
      const r = await agregarACalendar(d.task_id)
      return r.confirmacion ?? r.aviso ?? '📅 Listo.'
    }
    case 'seguir': {
      if (valor !== 'si' || !d.task_id) {
        await registrarDeclinada(chatId, 'seguir')
        return 'Ok, luego.'
      }
      const t = await tarea(d.task_id)
      if (!t) return 'Esa ya no está.'
      const cuando = t.due_date ? (t.due_date < today ? `vencida ${formatVenceEs(t.due_date)}` : t.due_date === today ? 'vence hoy' : `vence ${formatVenceEs(t.due_date)}`) : 'sin fecha'
      await guardarTurno(chatId, 'assistant', `Vamos con «${t.text}»`, { tareas: [{ id: t.id, text: t.text }] })
      return `Vamos con ${etiqueta(t)} · ${cuando}. Cuando esté: "listo ${t.text.split(' ')[0]}".`
    }
    case 'vencida': {
      if (!d.task_id) return 'Ok.'
      if (valor === 'sem') return ejecutarAccion({ accion: 'editar', cambios: { due_date: fechaEstaSemana(today) } }, [d.task_id])
      if (valor === 'can') return cancelarTareas([d.task_id], 'se dejó vencer')
      await registrarDeclinada(chatId, 'vencida', d.task_id)
      return 'Ok, la dejo.'
    }
    case 'nota': {
      if (!d.company_id) return 'Ok.'
      if (valor === 'arch') {
        const { error } = await archivarNota(d.company_id, createServerClient())
        return error ? `No pude archivarla: ${error.message}` : '📝 Archivada; la tienes en el historial.'
      }
      await registrarDeclinada(chatId, 'nota', d.company_id)
      return 'Ok, la dejo.'
    }
    case 'lista': {
      if (valor !== 'si') return `Ok. Cuando quieras: /hoy.`
      await enviarLista(chatId, 'manana')
      return '📋 (lista enviada arriba)'
    }
    case 'todo_manana': {
      if (valor !== 'si') return 'Ok. Dime cuáles: "pasa 2,5" o "pasa paypal".'
      const r = await manejarAccion({ accion: 'pasa' }, 'todo', nonce)
      return r.text
    }
  }
  void cfg
  void CHELSEA_COMPANY_NAME
  return 'Ok.'
}
