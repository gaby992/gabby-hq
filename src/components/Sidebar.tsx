'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

// Fase 12: the left menu of the Dashboard de vida, in the palette of the
// reference ("Dashboard de vida" reel): a dark indigo column with the active
// entry in violet, white brand on top. Fixed on a desktop, a drawer under a
// top bar on a phone. Each entry is one screen:
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
  { href: '/resumen', label: 'Resumen', icon: '⌂', activo: (p) => p === '/resumen' || p === '/' },
  { href: '/hoy', label: 'Tablero', icon: '▦', activo: (p) => p === '/hoy' },
  { href: '/calendario', label: 'Calendario', icon: '▣', activo: (p) => p === '/calendario' },
  { href: '/correo', label: 'Correos', icon: '✉', activo: (p) => p.startsWith('/correo') },
  { href: '/notas', label: 'Notas', icon: '✎', activo: (p) => p === '/notas' },
  { href: '/archivos', label: 'Archivos', icon: '🗂', activo: (p) => p === '/archivos' },
  { href: '/settings', label: 'Settings', icon: '⚙', activo: (p) => p.startsWith('/settings') },
]

const MAS: Item[] = [
  { href: '/tasks', label: 'Tasks', icon: '☑', activo: (p) => p === '/tasks' },
  { href: '/radar', label: 'Radar', icon: '◎', activo: (p) => p === '/radar' },
  { href: '/inbox', label: 'Inbox IM', icon: '▤', activo: (p) => ['/inbox', '/chelsea', '/rules'].includes(p) },
]

/** The palette of the menu — the reference's dark indigo with a violet active row. */
export const MENU = {
  fondo: '#1F1C3B',
  activo: '#6C5CE7',
  texto: '#B9B6D3',
  textoActivo: '#FFFFFF',
  linea: '#2C2950',
}

function Entrada({ item, pathname, onNavigate }: { item: Item; pathname: string; onNavigate?: () => void }) {
  const active = item.activo(pathname)
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors ${
        active ? 'font-semibold' : 'hover:bg-white/5'
      }`}
      style={active ? { backgroundColor: MENU.activo, color: MENU.textoActivo } : { color: MENU.texto }}
    >
      <span className="w-5 text-center text-base leading-none">{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  )
}

function Marca() {
  return (
    <Link href="/resumen" className="flex items-center gap-2 px-3 py-1">
      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ backgroundColor: MENU.activo }}>G</span>
      <span>
        <span className="block text-sm font-semibold text-white leading-tight">GabbyHQ</span>
        <span className="block text-[10px] leading-tight" style={{ color: MENU.texto }}>Dashboard de vida</span>
      </span>
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
    <div className="flex h-full flex-col" style={{ backgroundColor: MENU.fondo }}>
      <div className="px-2 pt-4 pb-3">
        <Marca />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {PRINCIPAL.map((item) => (
          <Entrada key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
        <p className="px-3 pt-5 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: MENU.texto, opacity: 0.6 }}>Más</p>
        {MAS.map((item) => (
          <Entrada key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="px-3 py-3" style={{ borderTop: `1px solid ${MENU.linea}` }}>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] hover:bg-white/5 transition-colors"
          style={{ color: MENU.texto }}
        >
          <span className="w-5 text-center text-base leading-none">↩</span>
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop: fixed dark indigo column. */}
      <aside className="hidden md:block fixed inset-y-0 left-0 w-56 z-20">
        {contenido()}
      </aside>

      {/* Phone: top bar + drawer. */}
      <header className="md:hidden sticky top-0 z-20" style={{ backgroundColor: MENU.fondo }}>
        <div className="h-12 px-3 flex items-center justify-between">
          <button
            onClick={() => setAbierto(true)}
            aria-label="Abrir menú"
            className="w-9 h-9 flex items-center justify-center rounded-md text-white hover:bg-white/10 text-xl"
          >
            ☰
          </button>
          <Link href="/resumen" className="text-sm font-semibold text-white tracking-tight">GabbyHQ</Link>
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
