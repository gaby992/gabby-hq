import { NextResponse } from 'next/server'
import { createInboxClient } from '@/lib/supabase-inboxim'
import { isValidSession } from '@/lib/session'
import { URGENCIA_ORDER } from '@/types'
import type { ImTriaje, ImUrgencia, InboxAction } from '@/types'

const DEFAULT_STATUS = ['nuevo', 'registrado']

// Central definition of what each row action writes — mirrors the Telegram bot.
function actionUpdate(action: InboxAction, now: string): Record<string, unknown> | null {
  switch (action) {
    case 'for_chelsea':
      return { status: 'pasado_a_chelsea', asignado_a: 'Chelsea', decidido_at: now }
    case 'ill_handle':
      return { status: 'lo_resuelvo_yo', asignado_a: 'Gabby', decidido_at: now }
    case 'archive':
      return { status: 'archivado', decidido_at: now }
    case 'done':
      return { status: 'resuelto', resuelto_at: now }
    default:
      return null
  }
}

export async function GET(request: Request) {
  if (!(await isValidSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const statusParam = searchParams.get('status')
  const urgencia = searchParams.get('urgencia')
  const tipo = searchParams.get('tipo')
  const categoria = searchParams.get('categoria')
  const inbox = searchParams.get('inbox')
  const asignado = searchParams.get('asignado')
  const search = searchParams.get('search')?.trim()

  const supabase = createInboxClient()
  let query = supabase.from('im_triaje').select('*')

  if (statusParam && statusParam !== 'all') {
    query = query.in('status', statusParam.split(','))
  } else if (!statusParam) {
    query = query.in('status', DEFAULT_STATUS)
  }
  if (urgencia) query = query.eq('urgencia', urgencia)
  if (tipo) query = query.eq('tipo', tipo)
  if (categoria) query = query.eq('categoria', categoria)
  if (inbox) query = query.eq('inbox', inbox)
  if (asignado) query = query.eq('asignado_a', asignado)
  if (search) {
    const esc = search.replace(/[%,]/g, '')
    query = query.or(`remitente.ilike.%${esc}%,asunto.ilike.%${esc}%`)
  }

  query = query.order('recibido_at', { ascending: false })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sort by urgencia (alta first), keeping recibido_at desc within each bucket.
  const rank = (u: ImUrgencia | null) =>
    u ? URGENCIA_ORDER.indexOf(u) : URGENCIA_ORDER.length
  const rows = (data as ImTriaje[]).sort((a, b) => rank(a.urgencia) - rank(b.urgencia))

  return NextResponse.json(rows)
}

export async function PATCH(request: Request) {
  if (!(await isValidSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const ids: unknown = body?.ids
  const action: InboxAction = body?.action

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const update = actionUpdate(action, now)
  if (!update) {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  }

  const supabase = createInboxClient()
  const { data, error } = await supabase
    .from('im_triaje')
    .update(update)
    .in('id', ids as string[])
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
