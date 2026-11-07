import Sidebar from '@/components/Sidebar'
import Fondo from '@/components/Fondo'

// Fase 12: a dark indigo left menu plus the content area. The menu is fixed
// on a desktop (the main column leaves room for it) and a drawer under a top
// bar on a phone. The content background is light on the Dashboard de vida
// screens and dark on the older ones (see Fondo).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      <Fondo>{children}</Fondo>
    </>
  )
}
