import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/asistente/cron-auth'
import { isValidSession } from '@/lib/session'
import { construirModeloChelsea, construirModeloGabby } from '@/lib/asistente/canal-chelsea'
import { generarChelseaPng } from '@/lib/asistente/chelsea-imagen'
import { mensajeError } from '@/lib/errores'

// Ajuste 18c: el resumen de Chelsea como PNG, para verlo en el navegador con la sesión
// abierta (o con el secreto del cron). El canal no pide esta URL: dibuja los mismos bytes
// y los sube a Telegram.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: Request) {
  if (!isCronAuthorized(request) && !(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // Ajuste 18d: ?de=gabby dibuja el de Gabby.
    const deGabby = new URL(request.url).searchParams.get('de') === 'gabby'
    const png = await generarChelseaPng(deGabby ? await construirModeloGabby() : await construirModeloChelsea())
    return new Response(Buffer.from(png), { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="chelsea.png"' } })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[chelsea.png] ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
