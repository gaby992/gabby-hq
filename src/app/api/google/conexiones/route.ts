import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { createServerClient } from '@/lib/supabase-server'
import { cambiarRoles, desconectar, googleConfigurado } from '@/lib/google/oauth'
import type { ConexionGoogle } from '@/types'

// What the Settings card shows: never the token, only who and when.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await createServerClient()
    .from('conexiones_google')
    .select('id, email, scopes, conectado_en, ultimo_uso, activa, usa_calendar, usa_gmail, duena, company_id')
    .order('conectado_en', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ configurado: googleConfigurado(), conexiones: (data as ConexionGoogle[]) ?? [] })
}

export async function DELETE(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await request.json().catch(() => ({}))
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  try {
    await desconectar(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/** Fase 6-A: the 📅 Calendar / 📧 Correo toggles, the owner and the company of a connection. */
export async function PATCH(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  if (typeof b?.id !== 'string' || !b.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  const roles: { usa_calendar?: boolean; usa_gmail?: boolean; duena?: string | null; company_id?: string | null } = {}
  if (typeof b.usa_calendar === 'boolean') roles.usa_calendar = b.usa_calendar
  if (typeof b.usa_gmail === 'boolean') roles.usa_gmail = b.usa_gmail
  if (typeof b.duena === 'string' || b.duena === null) roles.duena = b.duena ? String(b.duena).trim() : null
  if (typeof b.company_id === 'string' || b.company_id === null) roles.company_id = b.company_id || null
  if (Object.keys(roles).length === 0) return NextResponse.json({ error: 'nada que cambiar' }, { status: 400 })
  try {
    await cambiarRoles(b.id, roles)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
