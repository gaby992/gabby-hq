import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { evaluar, tablaEvaluacion } from '@/lib/correo/evaluar'
import { llmConfigCorreo, nombreModelo } from '@/lib/asistente/llm'

// Fase 6-E. GET without `modelo`: the table (mails × models × verdicts).
// GET with `modelo=`: re-classifies the window's mails with that model,
// without changing any state, and stores the answers. `cuenta=` and
// `dias=` (default 7) scope both.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const cuentaId = searchParams.get('cuenta') || null
  const dias = Math.max(1, Math.min(60, Number(searchParams.get('dias') ?? 7) || 7))
  const modelo = searchParams.get('modelo')?.trim()
  try {
    if (modelo) {
      const r = await evaluar({ cuentaId, dias, modelo, rehacer: searchParams.get('rehacer') === '1' })
      return NextResponse.json({ ok: true, ...r })
    }
    const t = await tablaEvaluacion({ cuentaId, dias })
    let actual: string | null = null
    try {
      actual = nombreModelo(llmConfigCorreo())
    } catch {
      actual = null
    }
    return NextResponse.json({ ...t, modelo_actual: actual, dias })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
