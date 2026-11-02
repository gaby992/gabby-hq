import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { guardarVeredicto } from '@/lib/correo/evaluar'
import { TIPOS, URGENCIAS } from '@/lib/correo/clasificar'
import type { CorreoTipo, CorreoUrgencia } from '@/types'

// Fase 6-E: Gabby's verdict on one mail — what it should have been.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  const id = typeof b?.correo_id === 'string' ? b.correo_id : null
  const urgencia = b?.urgencia as CorreoUrgencia
  const tipo = b?.tipo as CorreoTipo
  if (!id || !URGENCIAS.includes(urgencia) || !TIPOS.includes(tipo)) return NextResponse.json({ error: 'correo_id, urgencia y tipo requeridos' }, { status: 400 })
  try {
    await guardarVeredicto(id, { urgencia, tipo })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
