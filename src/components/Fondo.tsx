'use client'

import { usePathname } from 'next/navigation'

// Fase 12: the content area keeps the app's dark theme on every screen
// (Gabby's call: "en negro, pero el menú está bien así"); only the menu
// carries the indigo/violet of the reference. CLARAS stays as the switch in
// case a screen ever wants the light palette.
const CLARAS: string[] = []

/** The palette of the Resumen cards — the app's dark theme with the menu's violet as accent. */
export const CLARO = {
  fondo: '#0f0f0f',
  tarjeta: '#1c1c1c',
  borde: '#2a2a2a',
  texto: '#e8e8e8',
  textoSuave: '#9a9a9a',
  textoApagado: '#666666',
  acento: '#7F77DD',
  acentoSuave: '#1f1d33',
  hover: '#262626',
  chip: '#161616',
}

export function esClara(pathname: string): boolean {
  return CLARAS.includes(pathname)
}

export default function Fondo({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const clara = esClara(pathname)
  return (
    <main className="flex-1 w-full md:pl-56 min-h-screen" style={clara ? { backgroundColor: '#F4F5FA', color: '#1E1B3A' } : undefined}>
      <div className="max-w-5xl mx-auto w-full px-4 py-6 md:py-8">{children}</div>
    </main>
  )
}
