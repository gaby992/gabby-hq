import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { NotaEmpresa } from '@/types'

/**
 * Single write path for the "por dónde iba" notes, shared by the inline editor
 * in /hoy, the panel in /tasks and the Telegram bot. One live row per company:
 * the upsert hits the unique index on company_id, so it overwrites instead of
 * accumulating. The browser uses the default (anon) client; the bot passes
 * the server client because there is no browser session there.
 */
export async function saveNota(companyId: string, nota: string, client: SupabaseClient = supabase) {
  return client
    .from('notas_empresa')
    .upsert(
      { company_id: companyId, nota, updated_at: new Date().toISOString() },
      { onConflict: 'company_id' }
    )
    .select()
    .single<NotaEmpresa>()
}

/** "nota IM:" with nothing after it — the note is gone, not emptied. */
export async function deleteNota(companyId: string, client: SupabaseClient = supabase) {
  return client.from('notas_empresa').delete().eq('company_id', companyId)
}

export function notaFor(notas: NotaEmpresa[], companyId: string): NotaEmpresa | null {
  return notas.find((n) => n.company_id === companyId) ?? null
}
