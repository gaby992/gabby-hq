// What the rest of the assistant needs to know about mail: the recent
// mails per state, with their account's name, never the body. Used by the
// 8:00 / 6:00 pm lists, "¿qué sigue?", /pregunta's context and the
// interpreter ("el correo de Andrew lo hago yo").

import { createServerClient } from '@/lib/supabase-server'
import type { Correo, CorreoEstado } from '@/types'

/** A mail as the lists and the interpreter see it: no body. */
export type CorreoLite = Pick<Correo, 'id' | 'cuenta_id' | 'de_nombre' | 'de_email' | 'asunto' | 'resumen' | 'recibido_en' | 'urgencia' | 'tipo' | 'estado' | 'alertado' | 'gmail_thread_id'> & {
  cuenta: string
}

const COLS = 'id, cuenta_id, de_nombre, de_email, asunto, resumen, recibido_en, urgencia, tipo, estado, alertado, gmail_thread_id, cuenta:cuentas_correo(nombre)'

/** Mails of the last `dias` days in the given states, newest first. Never throws: no table → []. */
export async function correosRecientes(opts: { estados: CorreoEstado[]; dias?: number; max?: number } ): Promise<CorreoLite[]> {
  try {
    const desde = new Date(Date.now() - (opts.dias ?? 7) * 86_400_000).toISOString()
    const { data, error } = await createServerClient()
      .from('correos')
      .select(COLS)
      .in('estado', opts.estados)
      .gte('recibido_en', desde)
      .order('recibido_en', { ascending: false })
      .limit(opts.max ?? 60)
    if (error) throw error
    return ((data as unknown as (Omit<CorreoLite, 'cuenta'> & { cuenta: { nombre: string } | null })[]) ?? []).map((r) => ({ ...r, cuenta: r.cuenta?.nombre ?? 'Correo' }))
  } catch (err) {
    console.error(`[correo] correosRecientes: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/** Waiting on a decision and worth a line in the lists: alta, or a person expects an answer / asked for something. */
export async function correosQueEsperan(opts: { dias?: number; max?: number } = {}): Promise<CorreoLite[]> {
  const todos = await correosRecientes({ estados: ['nuevo'], dias: opts.dias ?? 7, max: 120 })
  const rank = (c: CorreoLite) => (c.urgencia === 'alta' ? 0 : c.tipo === 'necesita_respuesta' ? 1 : 2)
  return todos
    .filter((c) => c.urgencia === 'alta' || c.tipo === 'necesita_respuesta' || c.tipo === 'pedido_de_tarea')
    .sort((a, b) => rank(a) - rank(b) || (b.recibido_en ?? '').localeCompare(a.recibido_en ?? ''))
    .slice(0, opts.max ?? 12)
}

/** "Andrew (TOTT)" for a list line. */
export function quienCorto(c: Pick<CorreoLite, 'de_nombre' | 'de_email'>): string {
  const dominio = c.de_email?.split('@')[1]?.split('.')[0]
  if (c.de_nombre) return dominio && !c.de_nombre.toLowerCase().includes(dominio.toLowerCase()) ? `${c.de_nombre} (${dominio.toUpperCase()})` : c.de_nombre
  return c.de_email ?? '(sin remitente)'
}
