import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validateApiKey } from '@/lib/api-auth'

export async function POST(request: Request) {
  if (!await validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { text, priority, company_id, due_date, start_date, importante, notes, link_url, link_label } = body

  if (!text || !priority) {
    return NextResponse.json({ error: 'text and priority are required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('tasks')
    // `importante` is optional and defaults to false, so callers that predate
    // it (n8n Workflow B, the Inbox-IM buttons) keep working unchanged.
    .insert({ text, priority, company_id: company_id ?? null, due_date: due_date ?? null, start_date: start_date ?? null, importante: importante ?? false, notes: notes ?? null, link_url: link_url ?? null, link_label: link_label ?? null, done: false })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
