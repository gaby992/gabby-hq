import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { cargarCuentas, crearCuenta, guardarCuenta, normalizarLista, normalizarReglas, type CambiosCuenta } from '@/lib/correo/cuentas'
import { fusionarImport, importarDeN8n } from '@/lib/correo/importar'
import { createServerClient } from '@/lib/supabase-server'
import type { ConexionGoogle } from '@/types'

// Settings → Correo (fase 6-B): one card per account. GET lists accounts
// (with the connections that have none yet); PUT saves one; POST creates
// the row for a connection or imports an n8n JSON into an account.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const [cuentas, conexiones] = await Promise.all([
      cargarCuentas(),
      createServerClient().from('conexiones_google').select('id, email, activa, usa_gmail, usa_calendar, duena, company_id, conectado_en, ultimo_uso, scopes'),
    ])
    if (conexiones.error) throw new Error(conexiones.error.message)
    const con = (conexiones.data as ConexionGoogle[]) ?? []
    const sinCuenta = con.filter((c) => !cuentas.some((x) => x.conexion_id === c.id))
    return NextResponse.json({ cuentas, sin_cuenta: sinCuenta })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  if (typeof b?.id !== 'string') return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  const cambios: CambiosCuenta = {}
  if (typeof b.nombre === 'string' && b.nombre.trim()) cambios.nombre = b.nombre.trim()
  if (typeof b.duena === 'string') cambios.duena = b.duena.trim() || null
  if (typeof b.activa === 'boolean') cambios.activa = b.activa
  if (typeof b.alertar === 'boolean') cambios.alertar = b.alertar
  if (typeof b.vip === 'string' || Array.isArray(b.vip)) cambios.vip = normalizarLista(b.vip)
  if (typeof b.ruido === 'string' || Array.isArray(b.ruido)) cambios.ruido = normalizarLista(b.ruido)
  if (Array.isArray(b.reglas)) cambios.reglas = normalizarReglas(b.reglas)
  if (b.chat_id_alertas === null || b.chat_id_alertas === '') cambios.chat_id_alertas = null
  else if (b.chat_id_alertas !== undefined && Number.isFinite(Number(b.chat_id_alertas))) cambios.chat_id_alertas = Number(b.chat_id_alertas)
  if (typeof b.horario_alertas === 'string') cambios.horario_alertas = b.horario_alertas.trim()
  if (b.reiniciar_cursor === true) cambios.ultimo_history_id = null
  try {
    await guardarCuenta(b.id, cambios)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  try {
    // Create the account row for a connection.
    if (typeof b?.conexion_id === 'string') {
      const cuenta = await crearCuenta(b.conexion_id, typeof b.nombre === 'string' && b.nombre.trim() ? b.nombre.trim() : 'Correo', typeof b.duena === 'string' ? b.duena : null)
      return NextResponse.json({ ok: true, cuenta })
    }
    // Import an n8n JSON into an account.
    if (typeof b?.id === 'string' && b.json !== undefined) {
      let json: unknown = b.json
      if (typeof json === 'string') {
        try {
          json = JSON.parse(json)
        } catch {
          return NextResponse.json({ error: 'El JSON no es válido' }, { status: 400 })
        }
      }
      const imp = importarDeN8n(json)
      const actual = (await cargarCuentas()).find((c) => c.id === b.id)
      if (!actual) return NextResponse.json({ error: 'cuenta no encontrada' }, { status: 404 })
      const fusion = fusionarImport(actual, imp)
      await guardarCuenta(b.id, fusion)
      return NextResponse.json({ ok: true, importado: { vip: imp.vip.length, ruido: imp.ruido.length, reglas: imp.reglas.length, ignoradas: imp.ignoradas }, cuenta: { ...actual, ...fusion } })
    }
    return NextResponse.json({ error: 'conexion_id o (id + json) requerido' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
