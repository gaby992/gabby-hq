// Date helpers for task due dates.
//
// Everything is done on 'YYYY-MM-DD' strings in LOCAL time. Two reasons:
// `due_date` is a Postgres `date` (no timezone), and `new Date('2026-09-15')`
// parses as UTC midnight, which lands on the 14th for anyone west of Greenwich.

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export type DueState = 'overdue' | 'today' | 'future'

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayYmd(): string {
  return ymd(new Date())
}

export function parseYmd(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Shifts a 'YYYY-MM-DD' by whole days, staying in local time. */
export function addDays(value: string, days: number): string {
  const d = parseYmd(value)
  d.setDate(d.getDate() + days)
  return ymd(d)
}

/** "2026-09-15" → "15 sep". Hand-rolled so SSR and the browser always agree. */
export function formatShortEs(value: string): string {
  const d = parseYmd(value)
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]}`
}

/** String compare is enough — both sides are zero-padded 'YYYY-MM-DD'. */
export function dueState(due: string, today: string = todayYmd()): DueState {
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return 'future'
}

/** Whole days between an ISO timestamp and now, floored at 0. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso)
  const diff = Math.floor((now.getTime() - then.getTime()) / 86_400_000)
  return diff < 0 ? 0 : diff
}

/** "hoy" / "ayer" / "hace 3 días" — for the "por dónde iba" notes. */
export function relativeDaysEs(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now)
  if (days === 0) return 'hoy'
  if (days === 1) return 'ayer'
  return `hace ${days} días`
}
