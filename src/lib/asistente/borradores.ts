// A draft is a task the bot understood only partly (no company, or no
// priority). It lives in `bot_borradores` until the inline button that
// completes it arrives — at most 10 minutes, and only one per chat: a new
// message replaces whatever was pending.

import { createServerClient } from '@/lib/supabase-server'
import type { Accion, NotaParsed, TareaParsed } from '@/lib/parser'

/**
 * What waits in a draft. Tasks are stored flat (the phase 2 shape, no `tipo`);
 * notes and actions carry a discriminator.
 */
export type BorradorParsed =
  | (TareaParsed & { tipo?: 'tarea' })
  | { tipo: 'nota'; nota: NotaParsed }
  | { tipo: 'accion'; accion: Accion; candidatos: string[] }

export const BORRADOR_TTL_MS = 10 * 60 * 1000

export interface Borrador {
  id: string
  chat_id: number
  texto: string
  parsed: BorradorParsed
  created_at: string
}

/** The 8 hex chars that travel inside callback_data to tie a tap to its draft. */
export function nonceDe(id: string): string {
  return id.replace(/-/g, '').slice(0, 8)
}

export async function crearBorrador(chatId: number, texto: string, parsed: BorradorParsed): Promise<Borrador> {
  const db = createServerClient()
  // One live draft per chat.
  await db.from('bot_borradores').delete().eq('chat_id', chatId)
  const { data, error } = await db
    .from('bot_borradores')
    .insert({ chat_id: chatId, texto, parsed })
    .select()
    .single<Borrador>()
  if (error) throw new Error(`Supabase bot_borradores: ${error.message}`)
  return data
}

/** The chat's pending draft, or null if there is none or it is older than 10 min. */
export async function borradorVigente(chatId: number): Promise<Borrador | null> {
  const db = createServerClient()
  const { data, error } = await db
    .from('bot_borradores')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<Borrador>()
  if (error) throw new Error(`Supabase bot_borradores: ${error.message}`)
  if (!data) return null
  if (Date.now() - new Date(data.created_at).getTime() > BORRADOR_TTL_MS) return null
  return data
}

export async function actualizarBorrador(id: string, parsed: BorradorParsed): Promise<void> {
  const db = createServerClient()
  const { error } = await db.from('bot_borradores').update({ parsed }).eq('id', id)
  if (error) throw new Error(`Supabase bot_borradores: ${error.message}`)
}

export async function borrarBorrador(id: string): Promise<void> {
  const db = createServerClient()
  await db.from('bot_borradores').delete().eq('id', id)
}
