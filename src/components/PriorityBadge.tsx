import { Priority, PRIORITY_LABELS } from '@/types'

const styles: Record<Priority, string> = {
  urgente: 'bg-red-50 text-red-600',
  normal: 'bg-blue-50 text-blue-600',
  cuando: 'bg-gray-100 text-gray-500',
}

export default function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[priority]}`}>
      {PRIORITY_LABELS[priority]}
    </span>
  )
}
