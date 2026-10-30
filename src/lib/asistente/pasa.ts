// "pasa 2,5" / "pasa todo": move tasks from the LAST alarm to tomorrow.
// Numbers are resolved against the `items` saved with that alarm, so they
// keep meaning the same task even if the list has changed since.

import { createServerClient } from '@/lib/supabase-server'
import { addDays, cancunYmd, formatCortoEs } from './cancun'
import type { AlarmaItem, AlarmaTipo } from './alarmas'

export const PASA_HELP =
  'Formato: pasa 2,5 (números de la última alarma) · pasa todo'

interface UltimaAlarma {
  id: string
  tipo: AlarmaTipo
  enviada_en: string
  items: AlarmaItem[]
}

export function esComandoPasa(text: string): boolean {
  return /^pasa\b/i.test(text.trim())
}

/** Returns the reply the bot should send. Never throws for user mistakes. */
export async function manejarPasa(text: string): Promise<string> {
  const rest = text.trim().replace(/^pasa\b/i, '').trim()
  if (!rest) return PASA_HELP

  const todo = /^todo$/i.test(rest)
  let wanted: number[] = []
  if (!todo) {
    const tokens = rest.split(/[\s,;]+/).filter(Boolean)
    if (tokens.some((t) => !/^\d+$/.test(t))) return PASA_HELP
    wanted = Array.from(new Set(tokens.map(Number)))
  }

  const db = createServerClient()
  const { data: alarma, error } = await db
    .from('bot_alarmas')
    .select('id, tipo, enviada_en, items')
    .order('enviada_en', { ascending: false })
    .limit(1)
    .maybeSingle<UltimaAlarma>()
  if (error) throw new Error(`Supabase bot_alarmas: ${error.message}`)
  if (!alarma || !Array.isArray(alarma.items) || alarma.items.length === 0) {
    return 'No hay ninguna alarma con tareas numeradas todavía. Espera la de las 8:00 o la de las 6:00 pm.'
  }

  const byN = new Map(alarma.items.map((i) => [i.n, i.task_id]))
  let ids: string[]
  if (todo) {
    ids = alarma.items.map((i) => i.task_id)
  } else {
    const missing = wanted.filter((n) => !byN.has(n))
    if (missing.length > 0) {
      const max = Math.max(...alarma.items.map((i) => i.n))
      return `No encontré ${missing.length === 1 ? 'el' : 'los'} ${missing.join(', ')} en la última alarma (va del 1 al ${max}).`
    }
    ids = wanted.map((n) => byN.get(n)!)
  }

  const manana = addDays(cancunYmd(), 1)
  const { data: moved, error: updErr } = await db
    .from('tasks')
    .update({ due_date: manana })
    .in('id', ids)
    .eq('done', false)
    .select('id')
  if (updErr) throw new Error(`Supabase tasks: ${updErr.message}`)

  const count = moved?.length ?? 0
  if (count === 0) {
    return todo
      ? 'Nada que pasar: todo lo de la última alarma ya está cerrado.'
      : 'Esas tareas ya están cerradas; no moví nada.'
  }
  const skipped = ids.length - count
  const base = count === 1
    ? `✅ 1 tarea pasa a mañana (${formatCortoEs(manana)})`
    : `✅ ${count} tareas pasan a mañana (${formatCortoEs(manana)})`
  return skipped > 0 ? `${base} · ${skipped} ya ${skipped === 1 ? 'estaba cerrada' : 'estaban cerradas'}` : base
}
