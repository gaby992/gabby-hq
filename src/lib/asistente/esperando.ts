// Fase 9: moving a task between horizons, and the "⏳ Esperando" state.
// ONE write path for the board (POST /api/hoy) and the bot ("la de TOTT
// está esperando a Andrew", "qué tengo esperando"), so dragging a card and
// saying it do exactly the same thing to the row.
//
//   hoy / manana / semana → due_date = that day, back to 'abierta'
//   despues               → no date (and no hour), back to 'abierta'
//   esperando             → estado 'esperando' + esperando_a; the date stays
//   a mail dragged to hoy / manana → "Lo hago yo" (same as the button) and
//                            the task it creates gets that date

import { createServerClient } from '@/lib/supabase-server'
import type { Task } from '@/types'
import { fechaParaHorizonte, HORIZONTE_EMOJI, HORIZONTE_LABELS, type Horizonte } from '@/lib/horizonte'
import { avisosDe, sincronizarTarea } from '@/lib/google/sync'
import { decidirCorreo } from '@/lib/correo/decisiones'
import { COLS, etiqueta, type TaskRow } from './acciones'
import { cancunYmd, formatVenceEs } from './cancun'
import { escapeHtml, sendTelegram } from './telegram'
import { guardarAlarma, type AlarmaItem } from './registro-listas'

export const HORIZONTES_MOVER: Horizonte[] = ['hoy', 'manana', 'semana', 'esperando', 'despues']

export function esHorizonte(v: unknown): v is Horizonte {
  return typeof v === 'string' && (HORIZONTES_MOVER as string[]).includes(v)
}

/** "Andrew (TOTT)" — at most 60 chars, one line. null when empty. */
export function limpiarQuien(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim().replace(/^(?:a|de)\s+/i, '')
  return s ? s.slice(0, 60) : null
}

function conAvisos(texto: string, avisos: string[]): string {
  return avisos.length > 0 ? `${texto}\n${avisos.join('\n')}` : texto
}

/**
 * Moves the open tasks `ids` to `destino`. Returns the confirmation line(s)
 * in the bot's style. Closed tasks are skipped, never reopened.
 */
export async function moverTarea(ids: string[], destino: Horizonte, opts: { esperando_a?: string | null; today?: string } = {}): Promise<string> {
  const today = opts.today ?? cancunYmd()
  const fecha = fechaParaHorizonte(destino, today)
  const update: Record<string, unknown> =
    destino === 'esperando'
      ? { estado: 'esperando', esperando_a: limpiarQuien(opts.esperando_a) }
      : { estado: 'abierta', esperando_a: null, due_date: fecha }
  // No date → no hour either (an hour without a date means nothing).
  if (destino === 'despues') update.due_time = null

  const db = createServerClient()
  const { data, error } = await db.from('tasks').update(update).in('id', ids).eq('done', false).select(COLS)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const rows = (data as unknown as TaskRow[]) ?? []
  if (rows.length === 0) return 'Esa tarea ya está cerrada; no cambié nada.'

  // Its Calendar event (if any) follows the date — or goes when the date goes.
  const sync = await Promise.all(rows.filter((t) => t.gcal_event_id || t.due_time).map((t) => sincronizarTarea(t.id)))
  const avisos = avisosDe(sync)

  const quien = limpiarQuien(opts.esperando_a)
  const lineas = rows.map((t) => {
    switch (destino) {
      case 'esperando':
        return `⏳ ${etiqueta(t)} queda esperando${quien ? ` a ${quien}` : ''}`
      case 'despues':
        return `📦 ${etiqueta(t)} → Después (sin fecha)`
      default:
        return `${HORIZONTE_EMOJI[destino]} ${etiqueta(t)} → ${HORIZONTE_LABELS[destino]} (${formatVenceEs(fecha!)})`
    }
  })
  return conAvisos(lineas.join('\n'), avisos)
}

/** "la de TOTT ya no está esperando": back to 'abierta', date untouched. */
export async function dejarDeEsperar(ids: string[]): Promise<string> {
  const db = createServerClient()
  const { data, error } = await db.from('tasks').update({ estado: 'abierta', esperando_a: null }).in('id', ids).eq('done', false).select(COLS)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const rows = (data as unknown as TaskRow[]) ?? []
  if (rows.length === 0) return 'Esa tarea ya está cerrada; no cambié nada.'
  return rows.map((t) => `▶️ ${etiqueta(t)} vuelve a tus manos`).join('\n')
}

/**
 * A mail dragged onto 🔥 Hoy or 📅 Mañana: the same "Lo hago yo" the button
 * runs (state + task with the Ref line, never duplicated), then the task
 * takes that date. Returns the decision line plus the move line.
 */
export async function correoAHorizonte(correoId: string, destino: 'hoy' | 'manana' | 'esperando'): Promise<{ texto: string; task_id: string | null }> {
  if (destino === 'esperando') {
    const d = await decidirCorreo(correoId, 'chelsea')
    return { texto: d.texto, task_id: d.correo.task_id }
  }
  const d = await decidirCorreo(correoId, 'yo')
  if (!d.correo.task_id) return { texto: d.texto, task_id: null }
  const movida = await moverTarea([d.correo.task_id], destino)
  return { texto: `${d.texto}\n${movida}`, task_id: d.correo.task_id }
}

// ── "qué tengo esperando" ────────────────────────────────────────────────

type Fila = Pick<Task, 'id' | 'text' | 'due_date' | 'esperando_a' | 'created_at'> & { company: { name: string } | null }

/** Every open task in 'esperando', oldest first. */
export async function tareasEsperando(): Promise<Fila[]> {
  const { data, error } = await createServerClient()
    .from('tasks')
    .select('id, text, due_date, esperando_a, created_at, company:companies(name)')
    .eq('done', false)
    .eq('estado', 'esperando')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  return (data as unknown as Fila[]) ?? []
}

/** "⏳ 3. Landing TOTT · IM · Andrew (TOTT)" — numbered from `desde + 1`. */
export function lineaEsperando(n: number, t: Fila): string {
  const partes = [escapeHtml(t.text), escapeHtml(t.company?.name?.trim() ?? 'sin empresa')]
  if (t.esperando_a) partes.push(`⏳ ${escapeHtml(t.esperando_a)}`)
  if (t.due_date) partes.push(formatVenceEs(t.due_date))
  return `⏳ ${n}. ${partes.join(' · ')}`
}

/** The "⏳ Esperando" list, numbered and recorded so "listo 2" works on it. */
export async function enviarListaEsperando(chatId: number): Promise<number> {
  const rows = await tareasEsperando()
  const items: AlarmaItem[] = []
  const lineas = [`⏳ <b>Esperando (${rows.length})</b>`]
  if (rows.length === 0) lineas.push('— nada en manos de nadie 🎉')
  rows.forEach((t, i) => {
    items.push({ n: i + 1, task_id: t.id })
    lineas.push(lineaEsperando(i + 1, t))
  })
  if (rows.length > 0) lineas.push('', 'Para retomar: <code>la 2 ya no espera</code> · cerrar: <code>listo 2</code>')
  const html = lineas.join('\n')
  const messageId = await sendTelegram(chatId, html, { html: true, tag: 'lista-esperando' })
  if (items.length > 0) await guardarAlarma('lista', items, { chat_id: chatId, message_id: messageId, texto: html })
  return rows.length
}
