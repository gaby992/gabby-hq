import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { createServerClient } from '@/lib/supabase-server'
import { ejecutarAccion } from '@/lib/asistente/acciones'
import { correoAHorizonte, esHorizonte, limpiarQuien, moverTarea } from '@/lib/asistente/esperando'
import { correosRecientes } from '@/lib/correo/pendientes'
import { cargarCuentas } from '@/lib/correo/cuentas'
import { mensajeError } from '@/lib/errores'
import type { Company, NotaEmpresa, RadarItem, Task } from '@/types'

// Fase 9: the board at /hoy. GET is everything the page shows (tasks with
// company and subtasks, companies, notes, radar, the pending mail of the
// active accounts); POST is every action a drag or a tap does — the SAME
// functions the bot runs (moverTarea, ejecutarAccion, decidirCorreo), so
// the browser never writes to Supabase on its own for the board.
// Session-guarded: the middleware lets /api/* through.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const db = createServerClient()
    const [tasksRes, companiesRes, notasRes, radarRes, cuentas, correos] = await Promise.all([
      db.from('tasks').select('*, company:companies(*), subtasks(*)').eq('done', false).order('created_at', { ascending: false }),
      db.from('companies').select('*').order('name'),
      db.from('notas_empresa').select('*'),
      db.from('radar').select('*').order('created_at', { ascending: false }),
      cargarCuentas().catch((err) => {
        console.error(`[hoy] cuentas: ${mensajeError(err)}`)
        return []
      }),
      // Pending = waiting on Gabby (nuevo) or handed to Chelsea. Never the body.
      correosRecientes({ estados: ['nuevo', 'para_chelsea'], dias: 14, max: 200 }),
    ])
    if (tasksRes.error) throw new Error(`Supabase tasks: ${tasksRes.error.message}`)
    if (companiesRes.error) throw new Error(`Supabase companies: ${companiesRes.error.message}`)
    // Notes and radar are optional: an unrun migration must not blank the board.
    if (notasRes.error) console.error(`[hoy] notas_empresa: ${notasRes.error.message}`)
    if (radarRes.error) console.error(`[hoy] radar: ${radarRes.error.message}`)
    const activas = new Set(cuentas.filter((c) => c.activa).map((c) => c.id))
    return NextResponse.json({
      tasks: (tasksRes.data as Task[]) ?? [],
      companies: (companiesRes.data as Company[]) ?? [],
      notas: (notasRes.data as NotaEmpresa[]) ?? [],
      radar: (radarRes.data as RadarItem[]) ?? [],
      notas_error: notasRes.error?.message ?? null,
      correos: correos.filter((c) => activas.has(c.cuenta_id)),
      cuentas: cuentas.map((c) => ({ id: c.id, nombre: c.nombre, duena: c.duena, activa: c.activa, company_id: c.conexion?.company_id ?? null })),
    })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[hoy] GET: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  const accion = typeof b?.accion === 'string' ? b.accion : ''
  try {
    if (accion === 'mover') {
      const taskId = typeof b.task_id === 'string' ? b.task_id : ''
      if (!taskId || !esHorizonte(b.destino)) return NextResponse.json({ error: 'task_id y destino requeridos' }, { status: 400 })
      const texto = await moverTarea([taskId], b.destino, { esperando_a: limpiarQuien(b.esperando_a) })
      return NextResponse.json({ ok: true, texto })
    }
    if (accion === 'completar') {
      const taskId = typeof b.task_id === 'string' ? b.task_id : ''
      if (!taskId) return NextResponse.json({ error: 'task_id requerido' }, { status: 400 })
      // "listo": done = true, the Calendar event goes, same wording as the bot.
      const texto = await ejecutarAccion({ accion: 'listo' }, [taskId])
      return NextResponse.json({ ok: true, texto })
    }
    if (accion === 'correo') {
      const correoId = typeof b.correo_id === 'string' ? b.correo_id : ''
      const destino = b.destino
      if (!correoId || !['hoy', 'manana', 'esperando'].includes(destino)) return NextResponse.json({ error: 'correo_id y destino (hoy | manana | esperando) requeridos' }, { status: 400 })
      const r = await correoAHorizonte(correoId, destino)
      return NextResponse.json({ ok: true, texto: r.texto, task_id: r.task_id })
    }
    return NextResponse.json({ error: 'acción inválida' }, { status: 400 })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[hoy] POST ${accion}: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
