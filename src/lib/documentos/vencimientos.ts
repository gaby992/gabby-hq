// Fase 14: a vencimiento is only useful if it finds her BEFORE the day.
// The 8:00 am message warns at 30, 7 and 1 day, and every day once it is
// overdue, with a button that turns it into a task ("Renovar …") so the
// warning has somewhere to go. The Resumen shows the same dates as chips.

import { createServerClient } from '@/lib/supabase-server'
import { addDays, cancunYmd, daysBetween, formatVenceEs } from '@/lib/asistente/cancun'
import { escapeHtml, inlineKeyboard } from '@/lib/asistente/telegram'
import { CATEGORIA_EMOJI, montoTexto, type Documento } from './tipos'
import { explicarSupabase } from './ficha'

/** The days before a vencimiento that deserve a message. */
export const AVISOS_DIAS = [30, 7, 1] as const
/** How far ahead the Resumen's chips look. */
export const HORIZONTE_CHIPS = 45

export interface Vencimiento {
  documento: Documento
  /** Days from today: 0 = today, negative = already overdue. */
  dias: number
}

/** The live documents with a vencimiento inside the window (overdue ones included). */
export async function vencimientosProximos(hoy: string = cancunYmd(), dias: number = HORIZONTE_CHIPS): Promise<Vencimiento[]> {
  const { data, error } = await createServerClient()
    .from('documentos')
    .select('*')
    .eq('historial', false)
    .not('vence', 'is', null)
    .lte('vence', addDays(hoy, dias))
    .gte('vence', addDays(hoy, -365))
    .order('vence', { ascending: true })
    .limit(40)
  if (error) throw new Error(explicarSupabase(error.message))
  return ((data as Documento[]) ?? []).map((d) => ({ documento: d, dias: daysBetween(hoy, d.vence!) }))
}

/** "en 30 días" · "en 7 días" · "mañana" · "hoy" · "hace 3 días". */
export function cuandoVence(dias: number): string {
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'mañana'
  if (dias === -1) return 'ayer'
  return dias > 0 ? `en ${dias} días` : `hace ${Math.abs(dias)} días`
}

/** True on the days the morning message should bring it up. */
export function toca(dias: number): boolean {
  return dias <= 0 || (AVISOS_DIAS as readonly number[]).includes(dias)
}

/** One line of the morning warning. */
export function lineaVencimiento(v: Vencimiento): string {
  const emoji = CATEGORIA_EMOJI[v.documento.categoria] ?? '📄'
  const monto = montoTexto(v.documento.monto, v.documento.moneda)
  const partes = [`${emoji} ${escapeHtml(v.documento.titulo)}`, `vence ${cuandoVence(v.dias)} (${formatVenceEs(v.documento.vence!)})`]
  if (monto) partes.push(escapeHtml(monto))
  return `${v.dias <= 0 ? '🔴' : v.dias <= 7 ? '🟠' : '🟡'} ${partes.join(' · ')}`
}

/** The button that turns a vencimiento into a task. */
export function botonRenovar(d: Documento) {
  return inlineKeyboard([[{ text: '➕ Tarea de renovar', callback_data: `dv:${d.id}` }]])
}

export interface AvisoVencimientos {
  texto: string
  /** The ones the button can act on, in the order they appear. */
  documentos: Documento[]
}

/**
 * The "⏳ Por vencer" block of the 8:00 am message, or null when nothing is
 * due today. Never throws: without the fase 14 SQL the morning carries on
 * exactly as before.
 */
export async function avisoVencimientos(hoy: string = cancunYmd()): Promise<AvisoVencimientos | null> {
  let proximos: Vencimiento[]
  try {
    proximos = await vencimientosProximos(hoy)
  } catch (err) {
    console.warn(`[documentos] vencimientos: ${String(err)}`)
    return null
  }
  const hoyToca = proximos.filter((v) => toca(v.dias))
  if (hoyToca.length === 0) return null
  const lines = ['⏳ <b>Por vencer</b>', ...hoyToca.slice(0, 6).map(lineaVencimiento)]
  if (hoyToca.length > 6) lines.push(`+${hoyToca.length - 6} más en Archivos`)
  return { texto: lines.join('\n'), documentos: hoyToca.slice(0, 6).map((v) => v.documento) }
}

/** The chips the Resumen and the Calendario show (everything in the window, not only the warning days). */
export interface ChipVencimiento {
  id: string
  titulo: string
  categoria: string
  emoji: string
  vence: string
  dias: number
  cuando: string
  monto: string | null
}

export async function chipsVencimientos(hoy: string = cancunYmd()): Promise<ChipVencimiento[]> {
  let proximos: Vencimiento[]
  try {
    proximos = await vencimientosProximos(hoy)
  } catch (err) {
    console.warn(`[documentos] chips: ${String(err)}`)
    return []
  }
  return proximos.slice(0, 8).map((v) => ({
    id: v.documento.id,
    titulo: v.documento.titulo,
    categoria: v.documento.categoria,
    emoji: CATEGORIA_EMOJI[v.documento.categoria] ?? '📄',
    vence: v.documento.vence!,
    dias: v.dias,
    cuando: cuandoVence(v.dias),
    monto: montoTexto(v.documento.monto, v.documento.moneda),
  }))
}

/** The title of the task the button creates. */
export function tituloRenovar(d: Documento): string {
  return `Renovar ${d.titulo}`.slice(0, 160)
}
