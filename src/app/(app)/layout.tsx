import Sidebar from '@/components/Sidebar'

// Fase 12: the app is a white/blue left menu plus a dark content area. The
// menu is fixed on a desktop (the main column leaves room for it) and a
// drawer under a top bar on a phone.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      <main className="flex-1 w-full md:pl-56">
        <div className="max-w-5xl mx-auto w-full px-4 py-6 md:py-8">
          {children}
        </div>
      </main>
    </>
  )
}
