import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { accessToken, conexionPorId, explicarErrorGoogle } from '@/lib/google/oauth'
import { mensajeError } from '@/lib/errores'

// Fase 12b: "Probar" on a connection — asks Google for a fresh access token
// with the stored permission and reports, in plain words, whether it still
// works. Nothing is changed; the token never leaves the server.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  try {
    const conn = await conexionPorId(id)
    if (!conn) return NextResponse.json({ error: 'esa conexión ya no existe' }, { status: 404 })
    const t0 = Date.now()
    try {
      await accessToken(conn)
      return NextResponse.json({ ok: true, texto: `Google aceptó el permiso de ${conn.email} (${Date.now() - t0} ms).` })
    } catch (err) {
      const e = explicarErrorGoogle(err, conn.email)
      return NextResponse.json({ ok: false, texto: e.texto, reconectar: e.reconectar })
    }
  } catch (err) {
    return NextResponse.json({ error: mensajeError(err) }, { status: 500 })
  }
}
