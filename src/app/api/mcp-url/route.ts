import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { HERRAMIENTAS, llaveMcp } from '@/lib/mcp'

// Fase 19: la URL del conector, solo para quien tiene sesión en GabbyHQ.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const llave = llaveMcp()
  if (!llave) return NextResponse.json({ error: 'Falta un secreto en el servidor (API_SECRET_SEED o CRON_SECRET) para generar la llave.' }, { status: 500 })
  const base = (process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, '')
  return NextResponse.json({
    url: `${base}/api/mcp/${llave}`,
    herramientas: HERRAMIENTAS.map((h) => ({ nombre: h.name, que: h.description.split('. ')[0], cambia: !h.soloLectura })),
  })
}
