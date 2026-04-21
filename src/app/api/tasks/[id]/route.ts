import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validateApiKey } from '@/lib/api-auth'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!await validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const allowed = ['title', 'priority', 'status', 'due_date', 'notes', 'link_url', 'link_label', 'company_id']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('tasks')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
