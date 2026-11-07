import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GabbyHQ · Dashboard de vida',
  description: 'Tu día en una página: agenda, prioridades, correos y notas, con tu asistente de Telegram.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body suppressHydrationWarning className="bg-[#0f0f0f] text-[#e8e8e8] antialiased">
        <div className="min-h-screen flex flex-col">
          {children}
        </div>
      </body>
    </html>
  )
}
