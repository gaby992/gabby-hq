import { createServerClient } from './supabase-server'

export async function validateApiKey(request: Request): Promise<boolean> {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) return false

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('api_keys')
    .select('id')
    .eq('key_hash', apiKey)
    .single()

  return !error && !!data
}
