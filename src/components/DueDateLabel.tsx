import { dueState, formatShortEs, type DueState } from '@/lib/dates'

interface Props {
  date: string | null | undefined
  /** 'HH:MM[:SS]' — shown after the date when the task has an hour (fase 5). */
  time?: string | null
  /** Pass the current 'YYYY-MM-DD' to keep a long list consistent. */
  today?: string
}

function hora12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

const STYLES: Record<DueState, string> = {
  overdue: 'bg-red-950/60 text-red-400',
  today: 'bg-amber-950/50 text-amber-400',
  future: 'bg-[#2a2a2a] text-[#888888]',
}

/** Collapsed-card date chip. Renders nothing when the task has no due date. */
export default function DueDateLabel({ date, time, today }: Props) {
  if (!date) return null

  const state = dueState(date, today)
  const label = (state === 'today' ? 'Hoy' : formatShortEs(date)) + (time ? ` ${hora12(time)}` : '')

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${STYLES[state]}`}
      title={date}
    >
      📅 {label}
    </span>
  )
}
