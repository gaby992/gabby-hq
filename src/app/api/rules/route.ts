import { NextResponse } from 'next/server'
import { createInboxClient } from '@/lib/supabase-inboxim'
import { isValidSession } from '@/lib/session'

export async function GET() {
  if (!(await isValidSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createInboxClient()
  const { data, error } = await supabase
    .from('im_reglas')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  if (!(await isValidSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const { inbox, match_tipo, match_valor, accion, alerta } = body ?? {}

  if (!match_tipo || !match_valor || !accion) {
    return NextResponse.json(
      { error: 'match_tipo, match_valor and accion are required' },
      { status: 400 }
    )
  }

  const supabase = createInboxClient()
  const { data, error } = await supabase
    .from('im_reglas')
    .insert({
      inbox: inbox || 'chelsea',
      match_tipo,
      match_valor,
      accion,
      alerta: !!alerta,
      activa: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
