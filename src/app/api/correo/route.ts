import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { createServerClient } from '@/lib/supabase-server'
import { decidirCorreo } from '@/lib/correo/decisiones'
import { CORREO_URGENCIA_ORDER, type Correo, type CorreoAccion, type CorreoUrgencia } from '@/types'

// Fase 6-G: the /correo feed and its four actions. Session-guarded (the
// middleware lets /api/* through). The body of a mail never leaves here
// unless the row is asked for one by one (`?id=`).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACCIONES: CorreoAccion[] = ['chelsea', 'yo', 'tarea', 'archivar']
const DEFAULT_ESTADOS = ['nuevo']

export async function GET(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const db = createServerClient()
  if (id) {
    const { data, error } = await db.from('correos').select('*').eq('id', id).maybeSingle<Correo>()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }
  const estado = searchParams.get('estado')
  const cuenta = searchParams.get('cuenta')
  const urgencia = searchParams.get('urgencia')
  const tipo = searchParams.get('tipo')
  const dias = Number(searchParams.get('dias') ?? 14)
  const buscar = searchParams.get('q')?.trim()

  let q = db
    .from('correos')
    .select('id, cuenta_id, gmail_message_id, gmail_thread_id, de_nombre, de_email, asunto, resumen, recibido_en, urgencia, tipo, categoria, confianza, razon, estado, alertado, decidido_en, task_id, created_at')
    .gte('recibido_en', new Date(Date.now() - (Number.isFinite(dias) ? dias : 14) * 86_400_000).toISOString())
    .order('recibido_en', { ascending: false })
    .limit(400)
  if (estado && estado !== 'all') q = q.in('estado', estado.split(','))
  else if (!estado) q = q.in('estado', DEFAULT_ESTADOS)
  if (cuenta) q = q.eq('cuenta_id', cuenta)
  if (urgencia) q = q.eq('urgencia', urgencia)
  if (tipo) q = q.eq('tipo', tipo)
  if (buscar) {
    const esc = buscar.replace(/[%,()]/g, '')
    q = q.or(`de_nombre.ilike.%${esc}%,de_email.ilike.%${esc}%,asunto.ilike.%${esc}%`)
  }
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rank = (u: CorreoUrgencia | null) => (u ? CORREO_URGENCIA_ORDER.indexOf(u) : CORREO_URGENCIA_ORDER.length)
  const rows = ((data as Correo[]) ?? []).sort((a, b) => rank(a.urgencia) - rank(b.urgencia))
  return NextResponse.json(rows)
}

export async function PATCH(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const ids: unknown = body?.ids
  const accion: CorreoAccion = body?.accion
  if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ error: 'ids requerido' }, { status: 400 })
  if (!ACCIONES.includes(accion)) return NextResponse.json({ error: 'acción inválida' }, { status: 400 })
  const out: { id: string; texto?: string; error?: string }[] = []
  for (const id of ids as string[]) {
    try {
      const d = await decidirCorreo(id, accion)
      out.push({ id, texto: d.texto })
    } catch (err) {
      out.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return NextResponse.json(out)
}
