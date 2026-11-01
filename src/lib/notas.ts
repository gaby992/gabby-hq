import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { NotaEmpresa, NotaHistorial } from '@/types'
import { daysSince } from '@/lib/dates'

/**
 * Age bands of a "por dónde iba" note (fase 4b):
 *   fresca   ≤ 3 días  → C1 and the 8:00 alarm
 *   gris     4–14 días → only in its company block, greyed, "escrita hace N días"
 *   vieja    > 14 días → collapsed to one line "📝 nota de hace N días — ver / archivar"
 */
export type NotaEdad = 'fresca' | 'gris' | 'vieja'
export const NOTA_FRESCA_DIAS = 3
export const NOTA_VIEJA_DIAS = 14

export function edadNota(nota: Pick<NotaEmpresa, 'updated_at'>, now: Date = new Date()): NotaEdad {
  const d = daysSince(nota.updated_at, now)
  if (d <= NOTA_FRESCA_DIAS) return 'fresca'
  if (d <= NOTA_VIEJA_DIAS) return 'gris'
  return 'vieja'
}

/** Copies the live note into notas_historial. Never throws: losing the archive must not block the save. */
async function archivar(live: NotaEmpresa, client: SupabaseClient): Promise<void> {
  if (!live.nota?.trim()) return
  const { error } = await client
    .from('notas_historial')
    .insert({ company_id: live.company_id, nota: live.nota, escrita_en: live.updated_at })
  if (error) console.error(`[notas] notas_historial insert: ${error.message}`)
}

async function notaViva(companyId: string, client: SupabaseClient): Promise<NotaEmpresa | null> {
  const { data } = await client.from('notas_empresa').select('*').eq('company_id', companyId).maybeSingle<NotaEmpresa>()
  return data ?? null
}

/**
 * Single write path for the "por dónde iba" notes, shared by the inline editor
 * in /hoy, the panel in /tasks and the Telegram bot. One live row per company:
 * the upsert hits the unique index on company_id, so it overwrites instead of
 * accumulating. The browser uses the default (anon) client; the bot passes
 * the server client because there is no browser session there.
 *
 * Fase 4b: writing a NEW note over an old one sends the old one to
 * notas_historial by itself. `archivarAnterior: false` is for "nota IM + línea",
 * which only appends — nothing is being replaced there.
 */
export async function saveNota(
  companyId: string,
  nota: string,
  client: SupabaseClient = supabase,
  opts: { archivarAnterior?: boolean } = {}
) {
  if (opts.archivarAnterior !== false) {
    const anterior = await notaViva(companyId, client)
    if (anterior && anterior.nota.trim() && anterior.nota.trim() !== nota.trim()) await archivar(anterior, client)
  }
  return client
    .from('notas_empresa')
    .upsert(
      { company_id: companyId, nota, updated_at: new Date().toISOString() },
      { onConflict: 'company_id' }
    )
    .select()
    .single<NotaEmpresa>()
}

/** "nota IM:" with nothing after it — the note is gone, not emptied. The text survives in notas_historial. */
export async function deleteNota(companyId: string, client: SupabaseClient = supabase) {
  const anterior = await notaViva(companyId, client)
  if (anterior) await archivar(anterior, client)
  return client.from('notas_empresa').delete().eq('company_id', companyId)
}

/** The "archivar" button on an old note: same as deleting it — it lives on in notas_historial. */
export async function archivarNota(companyId: string, client: SupabaseClient = supabase) {
  return deleteNota(companyId, client)
}

export async function loadHistorial(companyId: string, client: SupabaseClient = supabase): Promise<NotaHistorial[]> {
  const { data } = await client
    .from('notas_historial')
    .select('*')
    .eq('company_id', companyId)
    .order('archivada_en', { ascending: false })
    .limit(20)
  return (data as NotaHistorial[]) ?? []
}

export function notaFor(notas: NotaEmpresa[], companyId: string): NotaEmpresa | null {
  return notas.find((n) => n.company_id === companyId) ?? null
}
