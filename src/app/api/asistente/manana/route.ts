import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/asistente/cron-auth'
import { ejecutarAlarma } from '@/lib/asistente/alarmas'
import { mensajeError } from '@/lib/errores'

// Vercel Cron → GET here (see vercel.json). Also callable by hand with
// `?test=1` and the same Bearer header. Never cached, and long enough to
// survive the 30 s retry.
export const dynamic = 'force-dynamic'
// GET-only handler: without this, Next 14 caches every fetch (Supabase, Google) in its Data Cache.
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const test = new URL(request.url).searchParams.get('test') === '1'
  console.log(`[alarma-manana] inicio (${test ? 'manual' : 'cron'})`)

  try {
    const r = await ejecutarAlarma('manana', { test })
    return NextResponse.json({ ok: true, ...r, test })
  } catch (err) {
    const error = mensajeError(err)
    return NextResponse.json({ ok: false, tipo: 'manana', error, test }, { status: 500 })
  }
}
