import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { agregarACalendar, quitarDeCalendar } from '@/lib/google/sync'

// The "📅 Agregar a Calendar" button in the task's edit panel (fase 5-B).
// POST {task_id, todo_el_dia?} creates/refreshes the event; DELETE removes it.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const taskId = typeof body?.task_id === 'string' ? body.task_id : ''
  if (!taskId) return NextResponse.json({ error: 'task_id requerido' }, { status: 400 })
  try {
    const r = await agregarACalendar(taskId, { todoElDia: body?.todo_el_dia === true })
    if (r.aviso) return NextResponse.json({ ok: false, error: r.aviso.replace(/^⚠️ sin evento en Calendar: /, '') }, { status: 400 })
    return NextResponse.json({ ok: true, confirmacion: r.confirmacion })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const taskId = typeof body?.task_id === 'string' ? body.task_id : ''
  if (!taskId) return NextResponse.json({ error: 'task_id requerido' }, { status: 400 })
  try {
    const r = await quitarDeCalendar(taskId)
    if (r.aviso) return NextResponse.json({ ok: false, error: r.aviso }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
