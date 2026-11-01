import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { cambiarPago, crearPago, listarPagos, quitarPago, sincronizarPago } from '@/lib/asistente/pagos'

// Settings → Pagos recurrentes (fase 5-C). The browser goes through here,
// not straight to Supabase, so Calendar stays in step with every change.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function fallo(err: unknown) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
}

export async function GET(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const company = new URL(request.url).searchParams.get('company')
  try {
    return NextResponse.json(await listarPagos(company || null))
  } catch (err) {
    return fallo(err)
  }
}

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  if (typeof b?.company_id !== 'string' || typeof b?.nombre !== 'string' || !b.nombre.trim() || !Number.isInteger(b?.dia_del_mes)) {
    return NextResponse.json({ error: 'company_id, nombre y dia_del_mes son obligatorios' }, { status: 400 })
  }
  try {
    const mensaje = await crearPago({ company_id: b.company_id, nombre: b.nombre, dia_del_mes: b.dia_del_mes, monto_texto: b.monto_texto ?? null })
    return NextResponse.json({ ok: true, mensaje, pagos: await listarPagos(b.company_id) }, { status: 201 })
  } catch (err) {
    return fallo(err)
  }
}

export async function PATCH(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  if (typeof b?.id !== 'string') return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  try {
    // {calendar: true} alone = "(re)create the event".
    const mensaje = b.calendar === true && b.nombre === undefined && b.dia_del_mes === undefined && b.monto_texto === undefined
      ? (await sincronizarPago(b.id)) ?? '📅 Evento en Calendar'
      : await cambiarPago(b.id, { nombre: b.nombre, dia_del_mes: b.dia_del_mes, monto_texto: b.monto_texto })
    return NextResponse.json({ ok: true, mensaje })
  } catch (err) {
    return fallo(err)
  }
}

export async function DELETE(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  if (typeof b?.id !== 'string') return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, mensaje: await quitarPago(b.id) })
  } catch (err) {
    return fallo(err)
  }
}
