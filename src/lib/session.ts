import { cookies } from 'next/headers'

// Mirrors the token derivation in middleware.ts. Used to guard API routes
// that the middleware lets through (it bypasses all /api/*). Any route that
// touches the RLS-disabled inbox-IM data must call requireSession() first.
async function expectedToken(): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(process.env.API_SECRET_SEED!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(process.env.ADMIN_PASSWORD!))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function isValidSession(): Promise<boolean> {
  const session = cookies().get('ghq_session')?.value
  if (!session) return false
  return session === (await expectedToken())
}
