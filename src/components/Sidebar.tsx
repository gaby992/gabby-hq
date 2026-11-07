'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

// Fase 12: the left menu of the Dashboard de vida — WHITE with a BLUE
// accent (the rest of the app keeps its dark theme). Fixed on a desktop,
// a drawer under a white top bar on a phone. Each entry is one screen:
//   🏠 Resumen · 🗂 Tablero · 📅 Calendario · 📧 Correos · 📝 Notas · ⚙️ Settings
// and a small "Más" group for the older screens (Tasks, Radar, Inbox IM).

interface Item {
  href: string
  label: string
  icon: string
  /** Paths that keep this entry highlighted. */
  activo: (pathname: string) => boolean
}

const PRINCIPAL: Item[] = [
  { href: '/resumen', label: 'Resumen', icon: '🏠', activo: (p) => p === '/resumen' || p === '/' },
  { href: '/hoy', label: 'Tablero', icon: '🗂', activo: (p) => p === '/hoy' },
  { href: '/calendario', label: 'Calendario', icon: '📅', activo: (p) => p === '/calendario' },
  { href: '/correo', label: 'Correos', icon: '📧', activo: (p) => p.startsWith('/correo') },
  { href: '/notas', label: 'Notas', icon: '📝', activo: (p) => p === '/notas' },
  { href: '/settings', label: 'Settings', icon: '⚙️', activo: (p) => p.startsWith('/settings') },
]

const MAS: Item[] = [
  { href: '/tasks', label: 'Tasks', icon: '☑️', activo: (p) => p === '/tasks' },
  { href: '/radar', label: 'Radar', icon: '📡', activo: (p) => p === '/radar' },
  { href: '/inbox', label: 'Inbox IM', icon: '🗃', activo: (p) => ['/inbox', '/chelsea', '/rules'].includes(p) },
]

function Entrada({ item, pathname, onNavigate }: { item: Item; pathname: string; onNavigate?: () => void }) {
  const active = item.activo(pathname)
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-blue-600" />}
      <span className="w-5 text-center text-base leading-none">{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  )
}

function Marca() {
  return (
    <Link href="/resumen" className="block px-3 py-1">
      <span className="block text-base font-bold tracking-tight text-blue-700">GabbyHQ</span>
      <span className="block text-[11px] text-slate-400 -mt-0.5">Dashboard de vida</span>
    </Link>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)

  // The drawer closes on every navigation.
  useEffect(() => { setAbierto(false) }, [pathname])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const contenido = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-white text-slate-700">
      <div className="px-2 pt-4 pb-3 border-b border-slate-100">
        <Marca />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {PRINCIPAL.map((item) => (
          <Entrada key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
        <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Más</p>
        {MAS.map((item) => (
          <Entrada key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="px-2 py-3 border-t border-slate-100">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
        >
          <span className="w-5 text-center text-base leading-none">↩</span>
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop: fixed white column. */}
      <aside className="hidden md:block fixed inset-y-0 left-0 w-56 border-r border-slate-200 bg-white z-20">
        {contenido()}
      </aside>

      {/* Phone: white top bar + drawer. */}
      <header className="md:hidden sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="h-12 px-3 flex items-center justify-between">
          <button
            onClick={() => setAbierto(true)}
            aria-label="Abrir menú"
            className="w-9 h-9 flex items-center justify-center rounded-md text-blue-700 hover:bg-blue-50 text-xl"
          >
            ☰
          </button>
          <Link href="/resumen" className="text-sm font-bold text-blue-700 tracking-tight">GabbyHQ</Link>
          <span className="w-9" />
        </div>
      </header>
      {abierto && (
        <div className="md:hidden fixed inset-0 z-30" onClick={() => setAbierto(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-y-0 left-0 w-64 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {contenido(() => setAbierto(false))}
          </div>
        </div>
      )}
    </>
  )
}
