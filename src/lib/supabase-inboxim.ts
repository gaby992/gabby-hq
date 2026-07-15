import { createClient } from '@supabase/supabase-js'

// Separate Supabase project for the inbox-IM triage system.
// RLS is DISABLED on these tables, so this client uses the service key
// and MUST only ever be created server-side (API routes / server components).
export function createInboxClient() {
  return createClient(
    process.env.SUPABASE_INBOXIM_URL!,
    process.env.SUPABASE_INBOXIM_SERVICE_KEY!,
    { auth: { persistSession: false } }
  )
}
