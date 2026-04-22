import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'

export async function POST(request: Request) {
  const { password } = await request.json()

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = createHmac('sha256', process.env.API_SECRET_SEED!)
    .update(password)
    .digest('hex')

  const response = NextResponse.json({ ok: true })
  response.cookies.set('ghq_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return response
}
