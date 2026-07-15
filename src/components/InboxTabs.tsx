'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/chelsea', label: 'Chelsea' },
  { href: '/rules', label: 'Rules' },
]

export default function InboxTabs() {
  const pathname = usePathname()

  return (
    <div className="flex gap-1 border-b border-[#2a2a2a] mb-6">
      {tabs.map(({ href, label }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              active
                ? 'border-[#7F77DD] text-[#e8e8e8] font-medium'
                : 'border-transparent text-[#888888] hover:text-[#e8e8e8]'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
