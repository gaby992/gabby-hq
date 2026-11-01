import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { textoQueSigue } from '@/lib/asistente/que-sigue'

// The "¿Qué sigue?" button in /hoy. Same computation and wording as the bot
// command; guarded by the app session cookie (the middleware lets /api/*
// through, so the check lives here). Nothing is recorded: the numbers only
// matter in Telegram.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: Request) {
  if (!(await isValidSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const empresa = new URL(request.url).searchParams.get('empresa')
  try {
    const text = await textoQueSigue({ empresa: empresa || null })
    return NextResponse.json({ text })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[que-sigue] web: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
