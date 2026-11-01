import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isValidSession } from '@/lib/session'
import { conectarConCodigo } from '@/lib/google/oauth'

// Google sends the browser back here with ?code=…&state=…. We trade the code
// for tokens, store the refresh token encrypted, and go back to Settings.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function volver(request: Request, q: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/settings/conexiones?${q}`, request.url))
  res.cookies.set('ghq_oauth_state', '', { maxAge: 0, path: '/api/google/oauth' })
  return res
}

export async function GET(request: Request) {
  if (!(await isValidSession())) return NextResponse.redirect(new URL('/login', request.url))
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const denied = url.searchParams.get('error')
  if (denied) return volver(request, `error=${encodeURIComponent(`Google: ${denied}`)}`)
  const expected = cookies().get('ghq_oauth_state')?.value
  if (!code || !state || !expected || state !== expected) {
    return volver(request, 'error=' + encodeURIComponent('la sesión de conexión expiró; intenta otra vez'))
  }
  try {
    const email = await conectarConCodigo(code)
    console.log(`[google] cuenta conectada: ${email}`)
    return volver(request, `conectado=${encodeURIComponent(email)}`)
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err)
    console.error(`[google] callback: ${motivo}`)
    return volver(request, `error=${encodeURIComponent(motivo)}`)
  }
}
