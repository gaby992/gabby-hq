'use client'

import { usePathname } from 'next/navigation'

// Fase 12: the Dashboard de vida (Resumen) uses the light palette of the
// reference — pale grey background, white cards. The other screens (Tablero,
// Calendario, Notas, Correos, Settings…) keep the dark theme until they are
// restyled, so the content area picks its background by route.
const CLARAS = ['/resumen']

export const CLARO = {
  fondo: '#F4F5FA',
  tarjeta: '#FFFFFF',
  borde: '#E6E7F0',
  texto: '#1E1B3A',
  textoSuave: '#6B6A80',
  textoApagado: '#A2A1B5',
  acento: '#6C5CE7',
  acentoSuave: '#EEEBFF',
}

export function esClara(pathname: string): boolean {
  return CLARAS.includes(pathname)
}

export default function Fondo({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const clara = esClara(pathname)
  return (
    <main className="flex-1 w-full md:pl-56 min-h-screen" style={clara ? { backgroundColor: CLARO.fondo, color: CLARO.texto } : undefined}>
      <div className="max-w-5xl mx-auto w-full px-4 py-6 md:py-8">{children}</div>
    </main>
  )
}
