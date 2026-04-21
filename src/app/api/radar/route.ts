import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validateApiKey } from '@/lib/api-auth'

export async function GET(request: Request) {
  if (!await validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')

  const supabase = createServerClient()
  let query = supabase.from('radar').select('*').order('created_at', { ascending: false })

  if (search) {
    query = query.or(`titulo.ilike.%${search}%,descripcion.ilike.%${search}%,categoria.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  if (!await validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { titulo, descripcion, categoria, estado } = body

  if (!titulo) return NextResponse.json({ error: 'titulo is required' }, { status: 400 })

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('radar')
    .insert({
      titulo,
      descripcion: descripcion ?? null,
      categoria: categoria ?? null,
      estado: estado ?? 'idea',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
