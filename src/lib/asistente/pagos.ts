// Fase 5-C: recurring payment dates ("pago IM Vercel el 15 de cada mes").
// One row per payment in `pagos_recurrentes` and one RECURRING monthly event
// in Calendar ("💳 IM · Vercel", 9:00–9:30 am Cancún, reminders 7 days,
// 3 days and the same morning). Payments are NOT tasks: they never show in
// Hoy, the matrix or the alarms. (Pending, fase 2: "💳 Hoy vence: IM Vercel"
// in the 8:00 alarm, read from this table.)

import { createServerClient } from '@/lib/supabase-server'
import type { PagoRecurrente } from '@/types'
import { actualizarEventoPago, borrarEvento, crearEventoPago, type PagoEvento } from '@/lib/google/calendar'
import { googleConfigurado } from '@/lib/google/oauth'
import { cancunYmd } from './cancun'
import { normalizar } from './acciones'

export interface PagoConEmpresa extends PagoRecurrente {
  company: { name: string } | null
}

export const COLS_PAGO = 'id, company_id, nombre, dia_del_mes, monto_texto, recordatorios, gcal_event_id, activo, created_at, company:companies(name)'

function tabla() {
  return createServerClient().from('pagos_recurrentes')
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 'YYYY-MM-DD' of the next day-N: this month if still ahead (or today), else next month. */
export function proximaFecha(dia: number, today: string = cancunYmd()): string {
  const [y, m] = today.split('-').map(Number)
  const mk = (yy: number, mm: number) => {
    // Clamp to the month's length so day 31 lands on the 30th in short months
    // (Calendar's BYMONTHDAY=31 simply skips those months).
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
    return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(dia, last)).padStart(2, '0')}`
  }
  const esteMes = mk(y, m)
  if (esteMes >= today) return esteMes
  return m === 12 ? mk(y + 1, 1) : mk(y, m + 1)
}

function comoEvento(p: PagoConEmpresa): PagoEvento {
  return {
    nombre: p.nombre,
    company_name: p.company?.name?.trim() ?? '?',
    dia_del_mes: p.dia_del_mes,
    monto_texto: p.monto_texto,
    recordatorios: p.recordatorios?.length ? p.recordatorios : [7, 3, 0],
    desde: proximaFecha(p.dia_del_mes),
  }
}

export function describirPago(p: PagoConEmpresa): string {
  return `💳 ${p.company?.name?.trim() ?? '?'} · ${p.nombre} · día ${p.dia_del_mes}${p.monto_texto ? ` · ${p.monto_texto}` : ''}${p.gcal_event_id ? ' 📅' : ''}`
}

async function cargar(id: string): Promise<PagoConEmpresa | null> {
  const { data, error } = await tabla().select(COLS_PAGO).eq('id', id).maybeSingle()
  if (error) throw new Error(`Supabase pagos_recurrentes: ${error.message}`)
  return (data as unknown as PagoConEmpresa) ?? null
}

export async function listarPagos(companyId?: string | null): Promise<PagoConEmpresa[]> {
  let q = tabla().select(COLS_PAGO).eq('activo', true).order('dia_del_mes', { ascending: true })
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw new Error(`Supabase pagos_recurrentes: ${error.message}`)
  return (data as unknown as PagoConEmpresa[]) ?? []
}

/** Creates or refreshes the recurring event. Returns the warning line, if any. */
export async function sincronizarPago(id: string): Promise<string | null> {
  if (!googleConfigurado()) return '⚠️ sin evento en Calendar: faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / APP_ENCRYPTION_KEY en Vercel'
  const p = await cargar(id)
  if (!p) return null
  try {
    if (p.gcal_event_id && (await actualizarEventoPago(p.gcal_event_id, comoEvento(p)))) return null
    const eventId = await crearEventoPago(comoEvento(p))
    const { error } = await tabla().update({ gcal_event_id: eventId }).eq('id', id)
    if (error) throw new Error(`Supabase pagos_recurrentes: ${error.message}`)
    return null
  } catch (err) {
    console.error(`[pagos] calendar: ${errorMsg(err)}`)
    return `⚠️ sin evento en Calendar: ${errorMsg(err)}`
  }
}

export interface NuevoPago {
  company_id: string
  nombre: string
  dia_del_mes: number
  monto_texto?: string | null
  recordatorios?: number[]
}

/** Row + recurring event. Returns the confirmation (with the warning below it when Google failed). */
export async function crearPago(n: NuevoPago): Promise<string> {
  if (n.dia_del_mes < 1 || n.dia_del_mes > 31) return 'El día tiene que estar entre 1 y 31.'
  const { data, error } = await tabla()
    .insert({
      company_id: n.company_id,
      nombre: n.nombre.trim(),
      dia_del_mes: n.dia_del_mes,
      monto_texto: n.monto_texto?.trim() || null,
      recordatorios: n.recordatorios?.length ? n.recordatorios : [7, 3, 0],
      activo: true,
    })
    .select('id')
    .single<{ id: string }>()
  if (error) throw new Error(`Supabase pagos_recurrentes: ${error.message}`)
  const aviso = await sincronizarPago(data.id)
  const p = (await cargar(data.id))!
  const linea = `${describirPago(p)} · cada mes${p.gcal_event_id ? ' · avisos 7 días, 3 días y ese día 9:00 am' : ''}`
  return aviso ? `${linea}\n${aviso}` : linea
}

/** Finds one active payment by a word of its name (optionally within a company). */
export async function buscarPago(termino: string, companyId?: string | null): Promise<{ pago?: PagoConEmpresa; error?: string }> {
  const todos = await listarPagos(companyId)
  const needle = normalizar(termino)
  const hits = todos.filter((p) => normalizar(p.nombre).includes(needle))
  if (hits.length === 0) return { error: `No encontré ningún pago con «${termino}».` }
  if (hits.length > 1) return { error: `Hay ${hits.length} pagos con «${termino}»: ${hits.map((p) => `${p.company?.name} · ${p.nombre}`).join(', ')}. Dime cuál.` }
  return { pago: hits[0] }
}

export async function quitarPago(id: string): Promise<string> {
  const p = await cargar(id)
  if (!p) return 'Ese pago ya no existe.'
  let aviso: string | null = null
  if (p.gcal_event_id && googleConfigurado()) {
    try {
      await borrarEvento(p.gcal_event_id)
    } catch (err) {
      aviso = `⚠️ el evento de Calendar no se pudo borrar: ${errorMsg(err)}`
    }
  }
  const { error } = await tabla().delete().eq('id', id)
  if (error) throw new Error(`Supabase pagos_recurrentes: ${error.message}`)
  const linea = `🗑 Pago quitado: ${p.company?.name} · ${p.nombre} (día ${p.dia_del_mes})`
  return aviso ? `${linea}\n${aviso}` : linea
}

export async function cambiarPago(id: string, cambios: { dia_del_mes?: number; nombre?: string; monto_texto?: string | null; recordatorios?: number[] }): Promise<string> {
  const update: Record<string, unknown> = {}
  if (cambios.dia_del_mes !== undefined) {
    if (cambios.dia_del_mes < 1 || cambios.dia_del_mes > 31) return 'El día tiene que estar entre 1 y 31.'
    update.dia_del_mes = cambios.dia_del_mes
  }
  if (cambios.nombre?.trim()) update.nombre = cambios.nombre.trim()
  if (cambios.monto_texto !== undefined) update.monto_texto = cambios.monto_texto?.trim() || null
  if (cambios.recordatorios?.length) update.recordatorios = cambios.recordatorios
  if (Object.keys(update).length === 0) return 'No dijiste qué cambiar del pago.'
  const { error } = await tabla().update(update).eq('id', id)
  if (error) throw new Error(`Supabase pagos_recurrentes: ${error.message}`)
  const aviso = await sincronizarPago(id)
  const p = (await cargar(id))!
  const linea = `✏️ ${describirPago(p)}`
  return aviso ? `${linea}\n${aviso}` : linea
}

/** "pagos de IM" / "pagos" → the list, numbered. */
export async function textoListaPagos(companyId?: string | null, companyName?: string | null): Promise<string> {
  const rows = await listarPagos(companyId)
  if (rows.length === 0) return `No hay pagos recurrentes${companyName ? ` de ${companyName}` : ''}. Agrega uno: "pago IM Vercel el 15 de cada mes".`
  return [`💳 Pagos recurrentes${companyName ? ` de ${companyName}` : ''} (${rows.length}):`, ...rows.map((p, i) => `${i + 1}. ${describirPago(p).replace(/^💳 /, '')}`)].join('\n')
}
