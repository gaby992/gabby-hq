import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { createServerClient } from '@/lib/supabase-server'
import { cargarConfig, guardarConfig } from '@/lib/asistente/config'

// Settings → Asistente (fase 7-D/F): the persona config and this month's
// LLM cost, read from bot_preguntas (every turn that hit the model is there).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** List prices of gpt-5-mini (USD per 1M tokens), the default model. */
const USD_IN = 0.25
const USD_OUT = 2.0

async function costoDelMes() {
  const inicio = new Date()
  inicio.setUTCDate(1)
  inicio.setUTCHours(0, 0, 0, 0)
  const { data, error } = await createServerClient()
    .from('bot_preguntas')
    .select('tokens_in, tokens_out, modelo')
    .gte('created_at', inicio.toISOString())
    .neq('chat_id', 0)
  if (error) return { error: error.message }
  const rows = (data as { tokens_in: number; tokens_out: number; modelo: string }[]) ?? []
  const tokens_in = rows.reduce((a, r) => a + (r.tokens_in ?? 0), 0)
  const tokens_out = rows.reduce((a, r) => a + (r.tokens_out ?? 0), 0)
  const porTipo: Record<string, number> = {}
  for (const r of rows) {
    const k = r.modelo.startsWith('interprete:') ? 'interprete' : r.modelo.startsWith('manana:') ? 'manana' : 'pregunta'
    porTipo[k] = (porTipo[k] ?? 0) + 1
  }
  return {
    mes: inicio.toISOString().slice(0, 7),
    turnos: rows.length,
    porTipo,
    tokens_in,
    tokens_out,
    usd: Math.round((tokens_in * USD_IN + tokens_out * USD_OUT) / 1e6 * 10000) / 10000,
    precios: { entrada_por_millon: USD_IN, salida_por_millon: USD_OUT, modelo_referencia: 'gpt-5-mini' },
  }
}

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [config, costo] = await Promise.all([cargarConfig(), costoDelMes()])
  return NextResponse.json({ config, costo })
}

export async function PUT(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  try {
    const config = await guardarConfig({
      nombre_persona: typeof b?.nombre_persona === 'string' ? b.nombre_persona : undefined,
      nombre_bot: typeof b?.nombre_bot === 'string' ? b.nombre_bot : undefined,
      tono: b?.tono === 'formal' || b?.tono === 'informal' ? b.tono : undefined,
      sugerencias: typeof b?.sugerencias === 'boolean' ? b.sugerencias : undefined,
    })
    return NextResponse.json({ ok: true, config })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
