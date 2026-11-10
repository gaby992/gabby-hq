import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { marcarAgenda } from '@/lib/asistente/resumen'
import { cancunYmd } from '@/lib/asistente/cancun'
import { mensajeError } from '@/lib/errores'

// Ajuste 16b: the tick on an agenda line (a Calendar event, a payment).
// It only remembers "done today" in GabbyHQ; Google Calendar is never touched.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = (await req.json().catch(() => ({}))) as { clave?: unknown; hecho?: unknown }
    const clave = typeof body.clave === 'string' ? body.clave.trim().slice(0, 300) : ''
    if (!/^(evento|pago):.+/.test(clave)) return NextResponse.json({ error: 'clave inválida' }, { status: 400 })
    await marcarAgenda(cancunYmd(), clave, body.hecho !== false)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: mensajeError(err) }, { status: 500 })
  }
}
