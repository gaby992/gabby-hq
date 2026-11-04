// Fase 9: the board by horizon. One place decides which column a task (or a
// mail) belongs to, so the web board, the 8:00 / 6:00 pm lists and the bot
// never disagree. Pure functions on 'YYYY-MM-DD' strings — no database, no
// browser — so both the client component and the server code import this.
//
//   🔥 hoy       due today, overdue, or urgent★ with no date
//   📅 manana    due tomorrow
//   🗓 semana    due after tomorrow and up to Sunday
//   ⏳ esperando estado 'esperando' (with "de quién"), or Chelsea's company
//   📦 despues   no date, beyond this week, or "cuando pueda" without a date
//
// Waiting tasks come first in the check: a task in someone else's hands is
// never "hoy sí o sí", whatever its date says.

import type { Task } from '@/types'
import { addDays } from '@/lib/asistente/cancun'

export type Horizonte = 'hoy' | 'manana' | 'semana' | 'esperando' | 'despues'

/** Column order on the board and in the alarm. 'correos' is the sixth column (mail, not tasks). */
export const HORIZONTES: Horizonte[] = ['hoy', 'manana', 'semana', 'esperando', 'despues']

export const HORIZONTE_EMOJI: Record<Horizonte | 'correos', string> = {
  hoy: '🔥',
  manana: '📅',
  semana: '🗓',
  esperando: '⏳',
  despues: '📦',
  correos: '📧',
}

export const HORIZONTE_LABELS: Record<Horizonte | 'correos', string> = {
  hoy: 'Hoy sí o sí',
  manana: 'Mañana',
  semana: 'Esta semana',
  esperando: 'Esperando',
  despues: 'Después',
  correos: 'Correos',
}

/** The fields the classification reads. `Task` has them all; the bot's lighter rows too. */
export type TareaHorizonte = Pick<Task, 'due_date' | 'priority' | 'importante'> & {
  estado?: Task['estado'] | null
  company_id?: string | null
}

export function estaEsperando(t: Pick<TareaHorizonte, 'estado'>): boolean {
  return t.estado === 'esperando'
}

/** Day of week (0 = Sunday) of a 'YYYY-MM-DD', with no timezone involved. */
export function diaSemana(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay()
}

/** "Esta semana" ends on Sunday. On a Sunday it is that same day. */
export function domingoDe(today: string): string {
  return addDays(today, (7 - diaSemana(today)) % 7)
}

/**
 * Where a task dropped on "🗓 Esta semana" lands: this Friday when today is
 * before Friday (Sunday counts as "before": the coming Friday), otherwise
 * next Monday — a Friday or Saturday drop means "the week after".
 */
export function fechaSemana(today: string): string {
  const dow = diaSemana(today)
  if (dow <= 4) return addDays(today, 5 - dow)
  return addDays(today, 8 - dow) // 5 → +3 (Mon), 6 → +2 (Mon)
}

/** The date a horizon drop sets; null = clear the date ('despues'); undefined = keep it ('esperando'). */
export function fechaParaHorizonte(h: Horizonte, today: string): string | null | undefined {
  switch (h) {
    case 'hoy': return today
    case 'manana': return addDays(today, 1)
    case 'semana': return fechaSemana(today)
    case 'despues': return null
    case 'esperando': return undefined
  }
}

/**
 * Which column a task belongs to. First match wins, in this order, so every
 * open task lands in exactly one. `chelseaId` is the "Chelsea" company: her
 * tasks are delegated, so they sit in ⏳ whatever their date.
 */
export function horizonteDe(t: TareaHorizonte, today: string, chelseaId?: string | null): Horizonte {
  if (estaEsperando(t) || (chelseaId && t.company_id === chelseaId)) return 'esperando'
  const manana = addDays(today, 1)
  if (t.due_date) {
    if (t.due_date <= today) return 'hoy'
    if (t.due_date === manana) return 'manana'
    if (t.due_date <= domingoDe(today)) return 'semana'
    return 'despues'
  }
  if (t.priority === 'urgente') return 'hoy'
  return 'despues'
}

const PRIORITY_RANK = { urgente: 0, normal: 1, cuando: 2 } as const

/**
 * Order inside a column. 🔥: overdue (oldest first) → today by hour → urgent
 * without date. Elsewhere: by date (then hour), then priority, then ★, then
 * oldest first — the same feel as the bot's lists.
 */
export function compararEnColumna<T extends TareaHorizonte & { due_time?: string | null; created_at?: string }>(a: T, b: T, today: string): number {
  const bucket = (t: T) => (t.due_date && t.due_date < today ? 0 : t.due_date === today ? 1 : t.due_date ? 2 : t.priority === 'urgente' ? 3 : 4)
  const r = bucket(a) - bucket(b)
  if (r !== 0) return r
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
  if ((a.due_time ?? '') !== (b.due_time ?? '')) {
    if (!a.due_time) return 1
    if (!b.due_time) return -1
    return a.due_time < b.due_time ? -1 : 1
  }
  const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (pr !== 0) return pr
  if (!!a.importante !== !!b.importante) return a.importante ? -1 : 1
  return (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1
}

/** Age bands of a card: grey after 14 days, red after 30 (days since the task was created). */
export type EdadTarjeta = 'normal' | 'gris' | 'roja'
export const EDAD_GRIS_DIAS = 14
export const EDAD_ROJA_DIAS = 30

export function edadTarjeta(dias: number): EdadTarjeta {
  if (dias > EDAD_ROJA_DIAS) return 'roja'
  if (dias > EDAD_GRIS_DIAS) return 'gris'
  return 'normal'
}

/**
 * A mail on the board: 📧 when it waits on Gabby and matters (alta, or a
 * person expects an answer / asked for something); ⏳ when it was handed to
 * Chelsea; null = not on the board (the rest lives in /correo).
 */
export function columnaCorreo(c: { estado: string; urgencia: string | null; tipo: string | null }): 'correos' | 'esperando' | null {
  if (c.estado === 'para_chelsea') return 'esperando'
  if (c.estado !== 'nuevo') return null
  if (c.urgencia === 'alta' || c.tipo === 'necesita_respuesta' || c.tipo === 'pedido_de_tarea') return 'correos'
  return null
}
