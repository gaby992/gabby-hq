import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/asistente/cron-auth'
import { isValidSession } from '@/lib/session'
import { reaplicarTodo, textoReaplicar } from '@/lib/correo/niveles'
import { mensajeError } from '@/lib/errores'

// Ajuste 6c: re-read the three sender lists against the mails already
// ingested and still pending. GET with the CRON_SECRET bearer (by hand,
// `?cuenta=<id>` narrows it) or POST { cuenta_id } from Settings → Correo.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
export const maxDuration = 120

async function correr(cuentaId: string | null) {
  try {
    const cuentas = await reaplicarTodo(cuentaId)
    const texto = cuentas.map((c) => `${c.cuenta}: ${c.error ? `error (${c.error})` : textoReaplicar(c)}`).join(' | ') || 'sin cuentas'
    console.log(`[correo-reaplicar] ${texto}`)
    return NextResponse.json({ ok: cuentas.every((c) => !c.error), cuentas, texto })
  } catch (err) {
    return NextResponse.json({ ok: false, error: mensajeError(err) }, { status: 500 })
  }
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request) && !(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return correr(new URL(request.url).searchParams.get('cuenta'))
}

export async function POST(request: Request) {
  if (!(await isValidSession()) && !isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  return correr(typeof b?.cuenta_id === 'string' ? b.cuenta_id : null)
}
