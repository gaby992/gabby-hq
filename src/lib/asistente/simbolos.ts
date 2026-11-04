// The list symbols, in a module of their own so narracion.ts and the board
// picture can use them without importing alarmas.ts (which imports them).
//   🔺 vencida · 🔸 vence hoy · ✴️ urgente o ★ · ▫️ normal · ▪️ cuando pueda

import type { Task } from '@/types'

/** What the symbol says about a task. Shared by every list and "¿qué sigue?". */
export type Bucket = 'vencida' | 'hoy' | 'estrella' | 'normal' | 'cuando'

export const SIMBOLO: Record<Bucket, string> = { vencida: '🔺', hoy: '🔸', estrella: '✴️', normal: '▫️', cuando: '▪️' }

/** Which symbol a task gets. Every open task has one (fase 4d: the lists show everything). */
export function bucketFor(t: Pick<Task, 'due_date' | 'priority' | 'importante'>, today: string): Bucket {
  if (t.due_date) {
    if (t.due_date < today) return 'vencida'
    if (t.due_date === today) return 'hoy'
  }
  if (t.priority === 'urgente' || t.importante) return 'estrella'
  if (t.priority === 'normal') return 'normal'
  return 'cuando'
}

export function simboloDe(t: Pick<Task, 'due_date' | 'priority' | 'importante'>, today: string): string {
  return SIMBOLO[bucketFor(t, today)]
}
