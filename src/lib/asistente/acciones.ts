// Everything the bot does TO an existing task, named by the number it had in
// the LAST alarm (bot_alarmas) or by a word of its title:
//   listo 3 · listo 2,5 · listo paypal        → done = true (the trigger stamps completed_at)
//   pasa 2,5 · pasa todo · pasa paypal        → due_date = tomorrow (Cancún)
//   borra 3 · borra paypal                    → delete, ALWAYS after a [Sí, borrar] [No]
//   nota en paypal: texto                     → append "30 oct: texto" to tasks.notes
//   paypal urgente / para el viernes / es de PD → edit priority, date or company
// Title search with 2–5 hits asks with buttons ("t:<nonce>:<task_id>"); the
// webhook then calls ejecutarAccion() with the chosen id.

import { createServerClient } from '@/lib/supabase-server'
import { PRIORITY_LABELS } from '@/types'
import type { Accion, Cambios } from '@/lib/parser'
import { addDays, cancunYmd, formatCortoEs, formatVenceEs } from './cancun'
import type { AlarmaItem, AlarmaTipo } from './alarmas'
import { inlineKeyboard, type InlineButton } from './telegram'

/** The action plus whatever it needs besides the task ids. Travels inside drafts. */
export interface AccionParams {
  accion: Accion
  /** nota_tarea: the line to append. */
  texto?: string
  /** editar: what to change. */
  cambios?: Cambios
}

export const USO: Record<Accion, string> = {
  pasa: 'Formato: pasa 2,5 (números de la última alarma) · pasa todo · pasa paypal (palabra del título)',
  listo: 'Formato: listo 3 · listo 2,5 (números de la última alarma) · listo paypal (palabra del título)',
  borra: 'Formato: borra 3 (número de la última alarma) · borra paypal (palabra del título)',
  nota_tarea: 'Formato: nota en paypal: texto que quieres agregar',
  editar: 'Formato: paypal para el viernes · paypal urgente · paypal es de PD',
}

const MAX_CANDIDATOS = 5

interface UltimaAlarma {
  id: string
  tipo: AlarmaTipo
  enviada_en: string
  items: AlarmaItem[]
}

export interface TaskRow {
  id: string
  text: string
  done: boolean
  notes: string | null
  due_date: string | null
  priority: 'urgente' | 'normal' | 'cuando'
  importante: boolean
  company: { name: string } | null
}

const COLS = 'id, text, done, notes, due_date, priority, importante, company:companies(name)'
/** Same without `notes`: what may travel to the LLM (fase 4 interpreter). */
export const COLS_SIN_NOTAS = 'id, text, done, due_date, priority, importante, company:companies(name)'

export interface Respuesta {
  text: string
  replyMarkup?: unknown
  /** Buttons shown to pick ONE task: the ids the tap may choose. */
  candidatos?: string[]
  /** [Sí, borrar] [No] shown: the ids waiting for the yes. */
  confirmar?: string[]
}

// ── Resolution ──────────────────────────────────────────────────────────

/** Accents and case out: "PayPal" matches "paypal", "está" matches "esta". */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export async function ultimaAlarma(): Promise<UltimaAlarma | null> {
  const { data, error } = await createServerClient()
    .from('bot_alarmas')
    .select('id, tipo, enviada_en, items')
    .order('enviada_en', { ascending: false })
    .limit(1)
    .maybeSingle<UltimaAlarma>()
  if (error) throw new Error(`Supabase bot_alarmas: ${error.message}`)
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return null
  return data
}

type Resuelto = { ids: string[] } | { text: string } | { elegir: TaskRow[] }

async function porNumeros(wanted: number[] | 'todo'): Promise<Resuelto> {
  const alarma = await ultimaAlarma()
  if (!alarma) {
    return { text: 'No hay ninguna alarma con tareas numeradas todavía. Espera la de las 8:00 o la de las 6:00 pm, o dime una palabra del título.' }
  }
  if (wanted === 'todo') return { ids: alarma.items.map((i) => i.task_id) }
  const byN = new Map(alarma.items.map((i) => [i.n, i.task_id]))
  const missing = wanted.filter((n) => !byN.has(n))
  if (missing.length > 0) {
    const max = Math.max(...alarma.items.map((i) => i.n))
    return { text: `No encontré ${missing.length === 1 ? 'el' : 'los'} ${missing.join(', ')} en la última alarma (va del 1 al ${max}).` }
  }
  return { ids: wanted.map((n) => byN.get(n)!) }
}

/** Open tasks whose title contains the term. Used by every "…paypal" form. */
export async function buscarPorTitulo(termino: string): Promise<TaskRow[]> {
  const { data, error } = await createServerClient()
    .from('tasks')
    .select(COLS)
    .eq('done', false)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const needle = normalizar(termino)
  return ((data as unknown as TaskRow[]) ?? []).filter((t) => normalizar(t.text).includes(needle))
}

async function porTitulo(termino: string): Promise<Resuelto> {
  const hits = await buscarPorTitulo(termino)
  if (hits.length === 0) return { text: `No encontré ninguna tarea con «${termino}».` }
  if (hits.length === 1) return { ids: [hits[0].id] }
  if (hits.length > MAX_CANDIDATOS) {
    return { text: `Encontré ${hits.length} tareas con «${termino}». Dime algo más específico.` }
  }
  return { elegir: hits }
}

// ── Questions ───────────────────────────────────────────────────────────

const VERBO: Record<Accion, string> = {
  listo: 'completo',
  pasa: 'paso a mañana',
  borra: 'borro',
  nota_tarea: 'lleva la nota',
  editar: 'cambio',
}

export function etiqueta(t: Pick<TaskRow, 'text' | 'company'>): string {
  return `«${t.text}»${t.company ? ` · ${t.company.name}` : ''}`
}

export function botonesElegir(hits: Pick<TaskRow, 'id' | 'text' | 'company'>[], nonce: string): InlineButton[] {
  return hits.map((t) => ({
    text: `${t.text.length > 40 ? t.text.slice(0, 39) + '…' : t.text}${t.company ? ` · ${t.company.name}` : ''}`,
    callback_data: `t:${nonce}:${t.id}`,
  }))
}

function preguntaElegir(accion: Accion, hits: TaskRow[], nonce: string): Respuesta {
  const buttons = botonesElegir(hits, nonce)
  return {
    text: `¿Cuál ${VERBO[accion]}?`,
    replyMarkup: inlineKeyboard(buttons.map((b) => [b])),
    candidatos: hits.map((t) => t.id),
  }
}

/** "borra": never without this. */
export async function preguntaConfirmarBorrado(ids: string[], nonce: string): Promise<Respuesta> {
  const { data, error } = await createServerClient().from('tasks').select(COLS).in('id', ids)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const rows = (data as unknown as TaskRow[]) ?? []
  if (rows.length === 0) return { text: 'Esas tareas ya no existen.' }
  const lista = rows.map((t) => `• ${etiqueta(t)}`).join('\n')
  return {
    text: `¿Borrar ${rows.length === 1 ? 'esta tarea' : `estas ${rows.length} tareas`}?\n${lista}`,
    replyMarkup: inlineKeyboard([[
      { text: '🗑️ Sí, borrar', callback_data: `y:${nonce}:1` },
      { text: 'No', callback_data: `y:${nonce}:0` },
    ]]),
    confirmar: rows.map((t) => t.id),
  }
}

// ── Execution ───────────────────────────────────────────────────────────

function describirCambios(c: Cambios): string {
  const out: string[] = []
  if (c.company_name) out.push(c.company_name)
  if (c.priority) out.push(`${PRIORITY_LABELS[c.priority]}${c.importante ? ' ★' : ''}`)
  if (c.due_date) out.push(`vence ${formatVenceEs(c.due_date)}`)
  return out.join(' · ')
}

/** Runs the action on the given tasks and returns the one-line confirmation(s). */
export async function ejecutarAccion(params: AccionParams, ids: string[]): Promise<string> {
  const db = createServerClient()

  if (params.accion === 'borra') {
    const { data, error } = await db.from('tasks').delete().in('id', ids).select(COLS)
    if (error) throw new Error(`Supabase tasks: ${error.message}`)
    const rows = (data as unknown as TaskRow[]) ?? []
    if (rows.length === 0) return 'Esas tareas ya no existían.'
    return rows.map((t) => `🗑️ Borrada: ${etiqueta(t)}`).join('\n')
  }

  if (params.accion === 'nota_tarea') {
    // Append only — never overwrite: inbox-IM tasks keep their "De:/resumen/
    // Ref: gmail:…" block exactly as n8n wrote it.
    const { data: before, error: e1 } = await db.from('tasks').select(COLS).in('id', ids)
    if (e1) throw new Error(`Supabase tasks: ${e1.message}`)
    const linea = `${formatCortoEs(cancunYmd())}: ${params.texto ?? ''}`.trim()
    const out: string[] = []
    for (const t of (before as unknown as TaskRow[]) ?? []) {
      const notes = t.notes?.trim() ? `${t.notes.trimEnd()}\n\n${linea}` : linea
      const { error } = await db.from('tasks').update({ notes }).eq('id', t.id)
      if (error) throw new Error(`Supabase tasks: ${error.message}`)
      out.push(`📎 Nota agregada a «${t.text}»`)
    }
    return out.join('\n') || 'Esa tarea ya no existe.'
  }

  if (params.accion === 'editar') {
    const c = params.cambios ?? {}
    const update: Record<string, unknown> = {}
    if (c.priority) update.priority = c.priority
    if (c.importante) update.importante = true
    if (c.due_date) update.due_date = c.due_date
    if (c.company_id) update.company_id = c.company_id
    if (Object.keys(update).length === 0) return USO.editar
    const { data, error } = await db.from('tasks').update(update).in('id', ids).eq('done', false).select(COLS)
    if (error) throw new Error(`Supabase tasks: ${error.message}`)
    const rows = (data as unknown as TaskRow[]) ?? []
    if (rows.length === 0) return 'Esa tarea ya está cerrada; no cambié nada.'
    return rows.map((t) => `✏️ ${etiqueta(t)} → ${describirCambios(c)}`).join('\n')
  }

  // listo / pasa
  const manana = addDays(cancunYmd(), 1)
  const cambio = params.accion === 'listo' ? { done: true } : { due_date: manana }
  const { data, error } = await db.from('tasks').update(cambio).in('id', ids).eq('done', false).select(COLS)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const rows = (data as unknown as TaskRow[]) ?? []
  if (rows.length === 0) {
    return params.accion === 'listo' ? 'Esas tareas ya estaban cerradas.' : 'Nada que pasar: esas tareas ya están cerradas.'
  }
  const skipped = ids.length - rows.length
  const cola = skipped > 0 ? `\n(${skipped} ya ${skipped === 1 ? 'estaba cerrada' : 'estaban cerradas'})` : ''
  if (params.accion === 'listo') return rows.map((t) => `✅ Hecha: ${etiqueta(t)}`).join('\n') + cola
  const fecha = formatCortoEs(manana)
  if (rows.length === 1) return `📅 ${etiqueta(rows[0])} pasa a mañana (${fecha})${cola}`
  return `✅ ${rows.length} tareas pasan a mañana (${fecha}):\n` + rows.map((t) => `• ${etiqueta(t)}`).join('\n') + cola
}

/**
 * Fase 4 "cancelar": done = true plus a dated line in notes — never deleted.
 * "{fecha}: cancelada — {motivo}" so the reason survives in /tasks → Completadas.
 */
export async function cancelarTareas(ids: string[], motivo?: string | null): Promise<string> {
  const db = createServerClient()
  const { data, error } = await db.from('tasks').select(COLS).in('id', ids).eq('done', false)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const rows = (data as unknown as TaskRow[]) ?? []
  if (rows.length === 0) return 'Esas tareas ya estaban cerradas.'
  const linea = `${formatCortoEs(cancunYmd())}: cancelada${motivo?.trim() ? ` — ${motivo.trim()}` : ''}`
  const out: string[] = []
  for (const t of rows) {
    const notes = t.notes?.trim() ? `${t.notes.trimEnd()}\n\n${linea}` : linea
    const { error: e2 } = await db.from('tasks').update({ done: true, notes }).eq('id', t.id)
    if (e2) throw new Error(`Supabase tasks: ${e2.message}`)
    out.push(`🗑 Cancelada: ${etiqueta(t)}${motivo?.trim() ? ` (${motivo.trim()})` : ''}`)
  }
  return out.join('\n')
}

/** Fase 4 "renombrar": a new title for an open task. */
export async function renombrarTarea(id: string, titulo: string): Promise<string> {
  const nuevo = titulo.trim()
  if (!nuevo) return 'Falta el título nuevo.'
  const db = createServerClient()
  const { data: before, error: e1 } = await db.from('tasks').select(COLS).eq('id', id).maybeSingle<TaskRow>()
  if (e1) throw new Error(`Supabase tasks: ${e1.message}`)
  if (!before) return 'Esa tarea ya no existe.'
  const { error } = await db.from('tasks').update({ text: nuevo }).eq('id', id)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  return `✏️ «${before.text}» → «${nuevo}»`
}

/** What happens once the task ids are known: run it, or (borra) ask first. */
export async function conIds(params: AccionParams, ids: string[], nonce: string): Promise<Respuesta> {
  if (params.accion === 'borra') return preguntaConfirmarBorrado(ids, nonce)
  return { text: await ejecutarAccion(params, ids) }
}

// ── Entry points from the webhook ───────────────────────────────────────

/**
 * listo / pasa / borra with `arg` = nothing, "todo", "2,5" or a word.
 * `nonce` ties any buttons to the draft the webhook created.
 */
export async function manejarAccion(params: AccionParams, arg: string, nonce: string): Promise<Respuesta> {
  const rest = arg.trim()
  if (!rest) return { text: USO[params.accion] }

  let resuelto: Resuelto
  if (/^todo$/i.test(rest)) {
    // Only "pasa todo" exists: closing or deleting a whole alarm in one tap is
    // too easy to send by accident.
    if (params.accion !== 'pasa') return { text: USO[params.accion] }
    resuelto = await porNumeros('todo')
  } else if (/^[\d\s,;]+$/.test(rest)) {
    resuelto = await porNumeros(Array.from(new Set(rest.split(/[\s,;]+/).filter(Boolean).map(Number))))
  } else {
    resuelto = await porTitulo(rest)
  }

  if ('text' in resuelto) return { text: resuelto.text }
  if ('elegir' in resuelto) return preguntaElegir(params.accion, resuelto.elegir, nonce)
  return conIds(params, resuelto.ids, nonce)
}

/**
 * "nota en paypal: …" and "paypal urgente": title search only. Returns null
 * for the edit form when nothing matches, so the webhook creates the task.
 */
export async function manejarPorTitulo(params: AccionParams, termino: string, nonce: string): Promise<Respuesta | null> {
  const hits = await buscarPorTitulo(termino)
  if (hits.length === 0) {
    return params.accion === 'editar' ? null : { text: `No encontré ninguna tarea con «${termino}».` }
  }
  if (hits.length === 1) return conIds(params, [hits[0].id], nonce)
  if (hits.length > MAX_CANDIDATOS) return { text: `Encontré ${hits.length} tareas con «${termino}». Dime algo más específico.` }
  return preguntaElegir(params.accion, hits, nonce)
}
