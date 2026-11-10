import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { createServerClient } from '@/lib/supabase-server'
import { cargarEmpresas } from '@/lib/asistente/tareas'
import { agregarPasos, explicarProyectos, limpiarEntrada, listarProyectos, type Proyecto } from '@/lib/proyectos'
import { mensajeError } from '@/lib/errores'

// Fase 17: /proyectos. GET = every project with its steps; POST = create,
// change, or add a step; DELETE = remove the project (its steps stay as
// ordinary tasks). Session-guarded, never cached.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const [proyectos, empresas] = await Promise.all([listarProyectos(), cargarEmpresas()])
    return NextResponse.json({ proyectos, empresas: empresas.map((e) => ({ id: e.id, name: e.name.trim() })) })
  } catch (err) {
    const error = explicarProyectos(mensajeError(err))
    console.error(`[proyectos] GET: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createServerClient()
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : null
    // A new step for an existing project.
    if (body.tipo === 'paso') {
      if (!id) throw new Error('falta el proyecto')
      const { data, error } = await db.from('proyectos').select('id, company_id').eq('id', id).single<Pick<Proyecto, 'id' | 'company_id'>>()
      if (error) throw new Error(error.message)
      const n = await agregarPasos(data, [{ titulo: String(body.titulo ?? ''), fecha: typeof body.fecha === 'string' ? body.fecha : null, minutos: typeof body.minutos === 'number' ? body.minutos : null }])
      if (n === 0) throw new Error('escribe qué hay que hacer')
      return NextResponse.json({ ok: true })
    }
    const limpio = limpiarEntrada(body)
    if (id) {
      const { error } = await db.from('proyectos').update({ ...limpio, actualizado: new Date().toISOString() }).eq('id', id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (!limpio.nombre) throw new Error('el proyecto necesita un nombre')
    const { data, error } = await db.from('proyectos').insert(limpio).select('id').single<{ id: string }>()
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: explicarProyectos(mensajeError(err)) }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const id = new URL(request.url).searchParams.get('id')
    if (!id) throw new Error('falta el id')
    const { error } = await createServerClient().from('proyectos').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: explicarProyectos(mensajeError(err)) }, { status: 400 })
  }
}
