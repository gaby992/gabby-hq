import { createClient } from '@supabase/supabase-js'

// Use the anon key (always set via NEXT_PUBLIC_*) so validation works even when
// SUPABASE_SERVICE_ROLE_KEY is absent. api_keys is readable by the anon role.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function validateApiKey(request: Request): Promise<boolean> {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) return false

  const { data } = await supabase
    .from('api_keys')
    .select('id')
    .eq('key_hash', apiKey)
    .maybeSingle()

  return !!data
}
