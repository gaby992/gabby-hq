import { Priority, PRIORITY_LABELS } from '@/types'

const styles: Record<Priority, string> = {
  urgente: 'bg-red-950/60 text-red-400',
  normal: 'bg-[#1e1a3d] text-[#7F77DD]',
  cuando: 'bg-[#2a2a2a] text-[#888888]',
}

export default function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[priority]}`}>
      {PRIORITY_LABELS[priority]}
    </span>
  )
}
