import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/asistente/cron-auth'
import { ejecutarAlarma } from '@/lib/asistente/alarmas'
import { enviarResumenChelsea } from '@/lib/asistente/canal-chelsea'
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

  // Fase 18: el resumen de Chelsea va a su canal (si está configurado). Nunca tumba la alarma de Gabby.
  const chelsea = await enviarResumenChelsea({ test })
  if (chelsea) console.log(`[alarma-manana] canal de Chelsea: ${chelsea.correos} correos · ${chelsea.paraChelsea} para Chelsea · ${chelsea.tareas} tareas`)

  try {
    const r = await ejecutarAlarma('manana', { test })
    return NextResponse.json({ ok: true, ...r, test })
  } catch (err) {
    const error = mensajeError(err)
    return NextResponse.json({ ok: false, tipo: 'manana', error, test }, { status: 500 })
  }
}
