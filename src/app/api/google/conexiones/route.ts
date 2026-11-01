import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { createServerClient } from '@/lib/supabase-server'
import { desconectar, googleConfigurado } from '@/lib/google/oauth'
import type { ConexionGoogle } from '@/types'

// What the Settings card shows: never the token, only who and when.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await createServerClient()
    .from('conexiones_google')
    .select('id, email, scopes, conectado_en, ultimo_uso, activa')
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
