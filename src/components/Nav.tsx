'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Tasks' },
  { href: '/radar', label: 'Radar' },
  { href: '/settings', label: 'Settings' },
]

export default function Nav() {
  const pathname = usePathname()

  return (
    <header className="bg-[#1c1c1c] border-b border-[#2a2a2a] sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between">
        <span className="font-semibold text-[#e8e8e8] text-sm tracking-tight">GabbyHQ</span>
        <nav className="flex gap-1">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                pathname === href
                  ? 'bg-[#7F77DD]/20 text-[#7F77DD] font-medium'
                  : 'text-[#888888] hover:text-[#e8e8e8] hover:bg-[#2a2a2a]'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
