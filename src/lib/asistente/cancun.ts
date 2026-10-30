// Everything the assistant says about "hoy" / "mañana" is computed in Cancún
// time. America/Cancun is UTC-5 all year (no daylight saving since 2015), so
// a civil day there is always [00:00-05:00, 24:00-05:00) — that fixed offset is
// what lets us turn a 'YYYY-MM-DD' into exact UTC bounds without a tz library.

export const CANCUN_TZ = 'America/Cancun'
const CANCUN_OFFSET = '-05:00'

const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** 'YYYY-MM-DD' of the current civil date in Cancún. */
export function cancunYmd(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; the timeZone option does the conversion.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CANCUN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** 'YYYY-MM-DD' + n days (n may be negative). Pure calendar arithmetic. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d + n)
  const r = new Date(t)
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, '0')}-${String(r.getUTCDate()).padStart(2, '0')}`
}

/** Whole days between two 'YYYY-MM-DD' strings (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** UTC instants that bound the Cancún civil day `ymd`: [start, end). */
export function cancunDayBounds(ymd: string): { startIso: string; endIso: string } {
  const start = new Date(`${ymd}T00:00:00${CANCUN_OFFSET}`)
  const end = new Date(`${addDays(ymd, 1)}T00:00:00${CANCUN_OFFSET}`)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

/** '2026-10-30' → 'viernes 30 oct'. Hand-rolled so it never depends on ICU data. */
export function formatDiaLargoEs(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${DIAS_ES[dow]} ${d} ${MESES_ES[m - 1]}`
}

/** '2026-10-30' → '30 oct'. */
export function formatCortoEs(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${d} ${MESES_ES[m - 1]}`
}
