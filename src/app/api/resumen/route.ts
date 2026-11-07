import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { cargarResumen } from '@/lib/asistente/resumen'
import { mensajeError } from '@/lib/errores'

// Fase 12: everything the Dashboard de vida (/resumen) shows, in one GET.
// Session-guarded (the middleware lets /api/* through). Never cached: the
// agenda reads Supabase and Google.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await cargarResumen())
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[resumen] GET: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
