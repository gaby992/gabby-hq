import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'

export const metadata: Metadata = {
  title: 'GabbyHQ',
  description: 'Task management for focused teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <div className="min-h-screen flex flex-col">
          <Nav />
          <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
