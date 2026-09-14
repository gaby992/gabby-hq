import { supabase } from '@/lib/supabase'
import { NotaEmpresa } from '@/types'

/**
 * Single write path for the "por dónde iba" notes, shared by the inline editor
 * in /hoy and the panel in /tasks. One live row per company: the upsert hits
 * the unique index on company_id, so it overwrites instead of accumulating.
 */
export async function saveNota(companyId: string, nota: string) {
  return supabase
    .from('notas_empresa')
    .upsert(
      { company_id: companyId, nota, updated_at: new Date().toISOString() },
      { onConflict: 'company_id' }
    )
    .select()
    .single<NotaEmpresa>()
}

export function notaFor(notas: NotaEmpresa[], companyId: string): NotaEmpresa | null {
  return notas.find((n) => n.company_id === companyId) ?? null
}
