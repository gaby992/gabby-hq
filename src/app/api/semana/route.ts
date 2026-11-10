import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { createServerClient } from '@/lib/supabase-server'
import { cargarEmpresas } from '@/lib/asistente/tareas'
import { mensajeError } from '@/lib/errores'

// Fase 16: Settings → Mi semana. The plantilla of blocks and the month
// rules, read and edited from the web. GET returns everything (inactive rows
// included, so nothing she switched off disappears); POST creates or updates
// one block or one rule; DELETE removes one.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'

const FALTA_SQL = 'Todavía no existe la plantilla de la semana (falta correr el SQL de la fase 16 en Supabase).'

function explicar(mensaje: string): string {
  return /semana_bloques|semana_reglas_mes/.test(mensaje) && /does not exist|schema cache/i.test(mensaje) ? FALTA_SQL : mensaje
}

function hora(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().slice(0, 5) : ''
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null
}

function lista(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n|,/) : []
  return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 30)
}

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createServerClient()
  try {
    const [b, r, empresas] = await Promise.all([
      db.from('semana_bloques').select('*').order('dia').order('inicio'),
      db.from('semana_reglas_mes').select('*').order('desde').order('inicio'),
      cargarEmpresas(),
    ])
    if (b.error) throw new Error(b.error.message)
    if (r.error) throw new Error(r.error.message)
    return NextResponse.json({
      bloques: b.data ?? [],
      reglas: r.data ?? [],
      empresas: empresas.map((e) => ({ id: e.id, name: e.name.trim() })),
    })
  } catch (err) {
    const error = explicar(mensajeError(err))
    console.error(`[semana] GET: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createServerClient()
  try {
    const body = await request.json().catch(() => ({}))
    if (body?.tipo === 'regla') {
      const desde = Number(body.desde)
      const hasta = Number(body.hasta)
      const inicio = hora(body.inicio)
      const tema = String(body.tema ?? '').trim()
      if (!(desde >= 1 && desde <= 31 && hasta >= desde && hasta <= 31)) return NextResponse.json({ error: 'Los días del mes van de 1 a 31, y "hasta" no puede ser menor que "desde".' }, { status: 400 })
      if (!inicio) return NextResponse.json({ error: 'La hora del bloque que cambia va como 10:30.' }, { status: 400 })
      if (!tema) return NextResponse.json({ error: 'Falta de qué es la regla.' }, { status: 400 })
      const row = { desde, hasta, inicio, tema: tema.slice(0, 200), rotacion: lista(body.rotacion), fijas: lista(body.fijas), activo: body.activo !== false }
      const q = typeof body.id === 'string' && body.id ? db.from('semana_reglas_mes').update(row).eq('id', body.id) : db.from('semana_reglas_mes').insert(row)
      const { data, error } = await q.select('*').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, regla: data })
    }

    const dia = Number(body?.dia)
    const inicio = hora(body?.inicio)
    const fin = hora(body?.fin)
    const nombre = String(body?.nombre ?? '').trim()
    if (!(dia >= 0 && dia <= 6)) return NextResponse.json({ error: 'Falta el día.' }, { status: 400 })
    if (!inicio || !fin) return NextResponse.json({ error: 'Las horas van como 08:15.' }, { status: 400 })
    if (fin <= inicio) return NextResponse.json({ error: 'El bloque tiene que terminar después de empezar.' }, { status: 400 })
    if (!nombre) return NextResponse.json({ error: 'Falta el nombre del bloque.' }, { status: 400 })
    const row = {
      dia,
      inicio,
      fin,
      nombre: nombre.slice(0, 60),
      tema: String(body.tema ?? '').trim().slice(0, 200),
      company_id: typeof body.company_id === 'string' && body.company_id ? body.company_id : null,
      palabras: lista(body.palabras).map((p) => p.toLowerCase()),
      fijas: lista(body.fijas),
      toma_tareas: body.toma_tareas !== false,
      bloqueado: body.bloqueado === true,
      activo: body.activo !== false,
      actualizado: new Date().toISOString(),
    }
    const q = typeof body.id === 'string' && body.id ? db.from('semana_bloques').update(row).eq('id', body.id) : db.from('semana_bloques').insert(row)
    const { data, error } = await q.select('*').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, bloque: data })
  } catch (err) {
    const error = explicar(mensajeError(err))
    console.error(`[semana] POST: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const tabla = url.searchParams.get('tipo') === 'regla' ? 'semana_reglas_mes' : 'semana_bloques'
  if (!id) return NextResponse.json({ error: 'Falta el id.' }, { status: 400 })
  try {
    const { error } = await createServerClient().from(tabla).delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const error = explicar(mensajeError(err))
    console.error(`[semana] DELETE: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
