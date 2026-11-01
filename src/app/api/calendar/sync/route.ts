import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { borrarEventoDeTarea, sincronizarTarea } from '@/lib/google/sync'
import { createServerClient } from '@/lib/supabase-server'

// Fase 5-D: the browser writes tasks straight into Supabase; after a write
// it calls here so the task's Calendar event (if it has one) follows.
// POST {task_id} → update/remove to match the row;
// POST {task_id, antes_de_borrar: true} → drop the event before the row goes.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const taskId = typeof body?.task_id === 'string' ? body.task_id : ''
  if (!taskId) return NextResponse.json({ error: 'task_id requerido' }, { status: 400 })
  try {
    if (body?.antes_de_borrar === true) {
      const { data } = await createServerClient().from('tasks').select('id, gcal_event_id').eq('id', taskId).maybeSingle()
      const r = data ? await borrarEventoDeTarea(data as { id: string; gcal_event_id: string | null }) : { estado: 'sin_cambio' as const }
      return NextResponse.json({ ok: !('aviso' in r && r.aviso), estado: r.estado, aviso: 'aviso' in r ? r.aviso : undefined })
    }
    const r = await sincronizarTarea(taskId)
    return NextResponse.json({ ok: !r.aviso, estado: r.estado, aviso: r.aviso })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
