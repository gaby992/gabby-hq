// Every numbered message the bot sends (the 8:00 list, the 6:00 pm close,
// "¿qué sigue?", a list asked by hand, the "correos" list) is recorded in
// `bot_alarmas` so "listo 3" / "el 15 lo hago yo" can resolve the number
// later, whatever the list looks like by then. Ajuste 6-3/6-7: the row
// also keeps WHERE the message went (chat + message id) and its text, so a
// line can be struck through in place when its mail gets resolved, and the
// last list of ANY type is the one a bare number refers to.

import { createServerClient } from '@/lib/supabase-server'

export type AlarmaTipo = 'manana' | 'tarde' | 'que_sigue' | 'lista' | 'correos'

/** One numbered line: `n` is what Gabby types in "pasa n". A line is a task OR a mail. */
export interface AlarmaItem {
  n: number
  task_id?: string
  correo_id?: string
}

export interface AlarmaRegistrada {
  id: string
  tipo: AlarmaTipo
  enviada_en: string
  items: AlarmaItem[]
  chat_id: number | null
  message_id: number | null
  texto: string | null
}

export interface MetaMensaje {
  chat_id: number
  message_id: number | null
  texto: string
}

const COLS = 'id, tipo, enviada_en, items, chat_id, message_id, texto'

export async function guardarAlarma(tipo: AlarmaTipo, items: AlarmaItem[], meta?: MetaMensaje | null): Promise<void> {
  const db = createServerClient()
  const row: Record<string, unknown> = { tipo, items, enviada_en: new Date().toISOString() }
  if (meta) {
    row.chat_id = meta.chat_id
    row.message_id = meta.message_id
    row.texto = meta.texto
  }
  let { error } = await db.from('bot_alarmas').insert(row)
  // Before sql/2026-11-asistente-fase6b-ajustes.sql the columns (or the tipo) do not exist: keep the numbering at least.
  if (error && meta && /column|constraint|violates/i.test(error.message)) {
    const fallback = tipo === 'lista' ? 'manana' : tipo === 'correos' ? 'que_sigue' : tipo
    console.warn(`[bot_alarmas] sin migración 6b (${error.message}); guardo sin mensaje como ${fallback}`)
    ;({ error } = await db.from('bot_alarmas').insert({ tipo: fallback, items, enviada_en: row.enviada_en }))
  }
  if (error) throw new Error(`Supabase bot_alarmas: ${error.message}`)
}

/**
 * The last numbered list of ANY type. A row with no items (an empty list
 * asked by hand) does not hide the one before it (ajuste 6-7).
 */
export async function ultimaAlarma(): Promise<AlarmaRegistrada | null> {
  const { data, error } = await createServerClient()
    .from('bot_alarmas')
    .select(COLS)
    .order('enviada_en', { ascending: false })
    .limit(8)
  if (error) throw new Error(`Supabase bot_alarmas: ${error.message}`)
  for (const row of (data as AlarmaRegistrada[]) ?? []) {
    if (Array.isArray(row.items) && row.items.length > 0) return row
  }
  return null
}

/** The newest list message (≤ `horas` old, with its text recorded) that numbers this mail. */
export async function ultimaListaCon(correoId: string, horas = 12): Promise<AlarmaRegistrada | null> {
  const desde = new Date(Date.now() - horas * 3_600_000).toISOString()
  const { data, error } = await createServerClient()
    .from('bot_alarmas')
    .select(COLS)
    .gte('enviada_en', desde)
    .not('message_id', 'is', null)
    .order('enviada_en', { ascending: false })
    .limit(20)
  if (error) throw new Error(`Supabase bot_alarmas: ${error.message}`)
  for (const row of (data as AlarmaRegistrada[]) ?? []) {
    if (row.texto && Array.isArray(row.items) && row.items.some((i) => i.correo_id === correoId)) return row
  }
  return null
}

export async function actualizarTextoAlarma(id: string, texto: string): Promise<void> {
  const { error } = await createServerClient().from('bot_alarmas').update({ texto }).eq('id', id)
  if (error) throw new Error(`Supabase bot_alarmas: ${error.message}`)
}
