import { NextResponse } from 'next/server'
import { createInboxClient } from '@/lib/supabase-inboxim'
import { isValidSession } from '@/lib/session'

const EDITABLE = ['inbox', 'match_tipo', 'match_valor', 'accion', 'alerta', 'activa']

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!(await isValidSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  for (const field of EDITABLE) {
    if (field in body) update[field] = body[field]
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no editable fields provided' }, { status: 400 })
  }

  const supabase = createInboxClient()
  const { data, error } = await supabase
    .from('im_reglas')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!(await isValidSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createInboxClient()
  const { error } = await supabase.from('im_reglas').delete().eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
