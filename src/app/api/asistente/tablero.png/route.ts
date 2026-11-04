import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/asistente/cron-auth'
import { isValidSession } from '@/lib/session'
import { firmaValida, generarTableroPng } from '@/lib/asistente/tablero-imagen'
import { mensajeError } from '@/lib/errores'

// Fase 9c-B: the board as a PNG. Three doors, no more: the cron secret
// (`Authorization: Bearer $CRON_SECRET`, like the alarms), the app session
// (open it in the browser while logged in), or the internal signature of
// the day (`?firma=…`, HMAC of CRON_SECRET — for a link that must work
// without the secret itself). The alarms do not fetch this URL: they
// render the same bytes in-process and upload them to Telegram.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: Request) {
  const url = new URL(request.url)
  const autorizado = isCronAuthorized(request) || firmaValida(url.searchParams.get('firma')) || (await isValidSession())
  if (!autorizado) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const png = await generarTableroPng()
    return new Response(Buffer.from(png), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="tablero.png"' },
    })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[tablero.png] ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
