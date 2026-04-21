interface Props {
  date: string | null | undefined
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export default function DueDateLabel({ date }: Props) {
  if (!date) return null

  const due = parseLocalDate(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const isOverdue = due < today
  const isToday = due.getTime() === today.getTime()

  const label = isToday
    ? 'Today'
    : due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <span
      className={`text-xs ${
        isOverdue ? 'text-red-400 font-medium' : isToday ? 'text-amber-400 font-medium' : 'text-[#888888]'
      }`}
    >
      {label}
    </span>
  )
}
