import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function validateApiKey(request: Request): Promise<boolean> {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) return false

  const { data } = await supabase
    .from('api_keys')
    .select('id')
    .eq('key', apiKey)
    .maybeSingle()

  return !!data
}
