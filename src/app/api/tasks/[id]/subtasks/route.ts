import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validateApiKey } from '@/lib/api-auth'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!await validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { title } = body
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('subtasks')
    .insert({ task_id: params.id, title, completed: false })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
