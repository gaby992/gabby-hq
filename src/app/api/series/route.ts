import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { cargarEnFila, cargarSeries } from '@/lib/series'
import { ejecutarAccion } from '@/lib/asistente/acciones'
import { createServerClient } from '@/lib/supabase-server'
import { mensajeError } from '@/lib/errores'

// Series page: GET = her series built from the "Serie: …" episode tasks;
// POST {task_id, visto} = mark an episode seen (completes the task, its
// Calendar alarm goes) or unseen again.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const [series, enFila] = await Promise.all([cargarSeries(), cargarEnFila()])
    return NextResponse.json({ series, enFila })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[series] GET: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const b = await request.json().catch(() => ({}))
    const id = typeof b?.task_id === 'string' ? b.task_id : ''
    if (!id) return NextResponse.json({ error: 'task_id requerido' }, { status: 400 })
    if (b.visto === false) {
      const { error } = await createServerClient().from('tasks').update({ done: false }).eq('id', id)
      if (error) throw new Error(error.message)
    } else {
      await ejecutarAccion({ accion: 'listo' }, [id])
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[series] POST: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
