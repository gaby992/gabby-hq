import { Company, COMPANY_COLORS } from '@/types'

interface Props {
  company: Company | null | undefined
  size?: 'sm' | 'xs'
}

export default function CompanyBadge({ company, size = 'sm' }: Props) {
  if (!company) return null
  const color = COMPANY_COLORS[company.color] ?? '#888780'

  return (
    <span
      className={`inline-flex items-center rounded font-medium ${size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'}`}
      style={{ backgroundColor: color + '22', color }}
    >
      {company.name}
    </span>
  )
}
