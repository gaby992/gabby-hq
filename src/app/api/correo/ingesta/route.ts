import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/asistente/cron-auth'
import { isValidSession } from '@/lib/session'
import { ingestarTodo } from '@/lib/correo/ingesta'
import { mensajeError } from '@/lib/errores'

// Vercel Cron → GET here every 15 minutes (see vercel.json): new mail of
// every active account → classify → alert; plus the autoresolver. Same
// CRON_SECRET as the alarms. A logged-in browser may also trigger it
// ("Leer ahora" in Settings → Correo). Long enough for 50 mails.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: Request) {
  if (!isCronAuthorized(request) && !(await isValidSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const max = Number(new URL(request.url).searchParams.get('max') ?? '')
  try {
    const r = await ingestarTodo({ max: Number.isFinite(max) && max > 0 ? Math.min(max, 50) : undefined })
    const ok = r.every((x) => !x.error)
    console.log(`[correo-ingesta] ${r.map((x) => `${x.cuenta}: +${x.nuevos} · alertas ${x.alertados} · respondidos ${x.respondidos}${x.reinicio ? ' · backlog' : ''}${x.error ? ` · ERROR ${x.error}` : ''}`).join(' | ') || 'sin cuentas activas'}`)
    return NextResponse.json({ ok, cuentas: r }, { status: ok ? 200 : 500 })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[correo-ingesta] error: ${error}`)
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}
