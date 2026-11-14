// What the rest of the assistant needs to know about mail: the recent
// mails per state, with their account's name, never the body. Used by the
// 8:00 / 6:00 pm lists, "¿qué sigue?", the "correos" list, /pregunta's
// context and the interpreter ("el correo de Andrew lo hago yo").
//
// Ajuste 6-0: everything reads the `correos` table (fase 6), never
// inbox-IM's `im_triaje`. "Pending" = estado nuevo or para_chelsea.

import { createServerClient } from '@/lib/supabase-server'
import type { Correo, CorreoEstado, CuentaCorreo, IdiomaCorreo } from '@/types'
import { nivelDe } from './cuentas'
import { textos } from './idioma'

/** A mail as the lists and the interpreter see it: no body. */
export type CorreoLite = Pick<Correo, 'id' | 'cuenta_id' | 'de_nombre' | 'de_email' | 'asunto' | 'resumen' | 'recibido_en' | 'urgencia' | 'tipo' | 'estado' | 'alertado' | 'gmail_thread_id' | 'vip' | 'respondido_en'> & {
  cuenta: string
}

const COLS = 'id, cuenta_id, de_nombre, de_email, asunto, resumen, recibido_en, urgencia, tipo, estado, alertado, gmail_thread_id, vip, respondido_en, cuenta:cuentas_correo(nombre)'

/** The states a list shows as "pendiente": waiting on Gabby, or handed to Chelsea and not answered yet. */
export const ESTADOS_PENDIENTES: CorreoEstado[] = ['nuevo', 'para_chelsea']

/** Hours a VIP's "✅ respondido" stays visible in the lists (ajuste 6-6). */
export const HORAS_RESPONDIDO_VISIBLE = 48

type Fila = Omit<CorreoLite, 'cuenta'> & { cuenta: { nombre: string } | null }

function conCuenta(rows: Fila[] | null | undefined): CorreoLite[] {
  return (rows ?? []).map((r) => ({ ...r, vip: r.vip === true, respondido_en: r.respondido_en ?? null, cuenta: r.cuenta?.nombre ?? 'Correo' }))
}

/** Mails of the last `dias` days in the given states, newest first. Never throws: no table → []. */
export async function correosRecientes(opts: { estados: CorreoEstado[]; dias?: number; max?: number; cuentaId?: string | null }): Promise<CorreoLite[]> {
  try {
    const desde = new Date(Date.now() - (opts.dias ?? 7) * 86_400_000).toISOString()
    let q = createServerClient()
      .from('correos')
      .select(COLS)
      .in('estado', opts.estados)
      .gte('recibido_en', desde)
      .order('recibido_en', { ascending: false })
      .limit(opts.max ?? 60)
    if (opts.cuentaId) q = q.eq('cuenta_id', opts.cuentaId)
    const { data, error } = await q
    if (error) throw error
    return conCuenta(data as unknown as Fila[])
  } catch (err) {
    console.error(`[correo] correosRecientes: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/** alta → 0 · a person waits (necesita respuesta / pedido de tarea) → 1 · the rest → 2. */
export type GrupoCorreo = 'alta' | 'respuesta' | 'resto'

export function grupoDe(c: Pick<CorreoLite, 'urgencia' | 'tipo'>): GrupoCorreo {
  if (c.urgencia === 'alta') return 'alta'
  if (c.tipo === 'necesita_respuesta' || c.tipo === 'pedido_de_tarea') return 'respuesta'
  return 'resto'
}

/**
 * Ajuste 18a: does this mail ASK for something — urgent, from a VIP, a person
 * waiting for an answer, or already handed to Chelsea? The rest (bills,
 * newsletters, notices) is counted, not listed, in the daily summaries.
 */
export function pideAlgo(c: Pick<CorreoLite, 'urgencia' | 'tipo'> & Partial<Pick<CorreoLite, 'vip' | 'estado'>>): boolean {
  return grupoDe(c) !== 'resto' || c.vip === true || c.estado === 'para_chelsea'
}

const RANGO: Record<GrupoCorreo, number> = { alta: 0, respuesta: 1, resto: 2 }

/** Alta first, then "someone waits", then the rest; newest first inside each. */
export function ordenarPendientes(correos: CorreoLite[]): CorreoLite[] {
  return [...correos].sort((a, b) => RANGO[grupoDe(a)] - RANGO[grupoDe(b)] || (b.recibido_en ?? '').localeCompare(a.recibido_en ?? ''))
}

/**
 * Ajuste 6-0 / 6-2: EVERY pending mail (nuevo or para_chelsea) of the last
 * 7 days, optionally of one account, in list order.
 */
export async function correosPendientes(opts: { cuentaId?: string | null; dias?: number; max?: number } = {}): Promise<CorreoLite[]> {
  const todos = await correosRecientes({ estados: ESTADOS_PENDIENTES, dias: opts.dias ?? 7, max: opts.max ?? 200, cuentaId: opts.cuentaId })
  return ordenarPendientes(todos)
}

/** Ajuste 6-6: VIP mails answered in the last 48 h — shown greyed, not numbered. */
export async function correosRespondidosVip(opts: { cuentaId?: string | null; horas?: number } = {}): Promise<CorreoLite[]> {
  try {
    const desde = new Date(Date.now() - (opts.horas ?? HORAS_RESPONDIDO_VISIBLE) * 3_600_000).toISOString()
    let q = createServerClient()
      .from('correos')
      .select(COLS)
      .eq('vip', true)
      .gte('respondido_en', desde)
      .order('respondido_en', { ascending: false })
      .limit(20)
    if (opts.cuentaId) q = q.eq('cuenta_id', opts.cuentaId)
    const { data, error } = await q
    if (error) throw error
    return conCuenta(data as unknown as Fila[])
  } catch (err) {
    console.error(`[correo] correosRespondidosVip: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/** Ajuste 18c: every mail of a VIP sender in the last `dias` days, WHATEVER its state (the picture says if something is left to do). */
export async function correosVipRecientes(opts: { cuentaId?: string | null; cuenta?: Pick<CuentaCorreo, 'id' | 'vip' | 'ruido' | 'solo_app'>; dias?: number; max?: number } = {}): Promise<CorreoLite[]> {
  try {
    const desde = new Date(Date.now() - (opts.dias ?? 7) * 86_400_000).toISOString()
    const db = createServerClient()
    // Ajuste 18e: with the account in hand, VIP is decided NOW against its 🔔 list, not only by the
    // mark the mail got when it arrived — a sender added to the list today shows from today,
    // with the mails she already sent. Those mails get the mark too, so the reply check sees them.
    if (opts.cuenta) {
      const { data, error } = await db.from('correos').select(COLS).eq('cuenta_id', opts.cuenta.id).gte('recibido_en', desde).order('recibido_en', { ascending: false }).limit(500)
      if (error) throw error
      const todos = conCuenta(data as unknown as Fila[])
      const deLista = todos.filter((c) => !c.vip && nivelDe(opts.cuenta!, c.de_email)?.nivel === 'alerta')
      if (deLista.length > 0) {
        const { error: e } = await db.from('correos').update({ vip: true }).in('id', deLista.map((c) => c.id))
        if (e) console.error(`[correo] marcar VIP: ${e.message}`)
      }
      const ids = new Set(deLista.map((c) => c.id))
      return todos.filter((c) => c.vip || ids.has(c.id)).map((c) => ({ ...c, vip: true })).slice(0, opts.max ?? 60)
    }
    let q = db.from('correos').select(COLS).eq('vip', true).gte('recibido_en', desde).order('recibido_en', { ascending: false }).limit(opts.max ?? 60)
    if (opts.cuentaId) q = q.eq('cuenta_id', opts.cuentaId)
    const { data, error } = await q
    if (error) throw error
    return conCuenta(data as unknown as Fila[])
  } catch (err) {
    console.error(`[correo] correosVipRecientes: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/** Waiting on Gabby and worth "¿qué sigue?": alta, or a person expects an answer / asked for something. */
export async function correosQueEsperan(opts: { dias?: number; max?: number } = {}): Promise<CorreoLite[]> {
  const todos = await correosRecientes({ estados: ['nuevo'], dias: opts.dias ?? 7, max: 120 })
  return ordenarPendientes(todos.filter((c) => grupoDe(c) !== 'resto')).slice(0, opts.max ?? 12)
}

/** "Andrew (TOTT)" for a list line. */
export function quienCorto(c: Pick<CorreoLite, 'de_nombre' | 'de_email'>): string {
  const dominio = c.de_email?.split('@')[1]?.split('.')[0]
  if (c.de_nombre) return dominio && !c.de_nombre.toLowerCase().includes(dominio.toLowerCase()) ? `${c.de_nombre} (${dominio.toUpperCase()})` : c.de_nombre
  return c.de_email ?? '(sin remitente)'
}

/** "hace 5 min" · "hace 3h" · "hace 2d" (or "5 min ago" for an English account) — how old a mail is, for a list line. */
export function haceCuanto(iso: string | null | undefined, now: Date = new Date(), idioma: IdiomaCorreo = 'es'): string {
  if (!iso) return ''
  const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  return textos(idioma).hace(min)
}
