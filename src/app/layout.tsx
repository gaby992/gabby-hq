import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GabbyHQ',
  description: 'Task management for focused teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="bg-[#0f0f0f] text-[#e8e8e8] antialiased">
        <div className="min-h-screen flex flex-col">
          {children}
        </div>
      </body>
    </html>
  )
}
