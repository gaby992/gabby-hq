import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { isValidSession } from '@/lib/session'
import { googleConfigurado, urlDeAutorizacion } from '@/lib/google/oauth'

// Settings → Conexiones → "Conectar": sends the browser to Google's consent
// screen. The random `state` goes in a short-lived cookie so the callback can
// check it came from this browser.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!(await isValidSession())) return NextResponse.redirect(new URL('/login', request.url))
  if (!googleConfigurado()) {
    return NextResponse.redirect(new URL('/settings/conexiones?error=faltan+GOOGLE_CLIENT_ID%2C+GOOGLE_CLIENT_SECRET+o+APP_ENCRYPTION_KEY+en+Vercel', request.url))
  }
  const state = randomBytes(16).toString('hex')
  const res = NextResponse.redirect(urlDeAutorizacion(state))
  res.cookies.set('ghq_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/api/google/oauth',
  })
  return res
}
