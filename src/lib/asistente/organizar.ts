// Fase 7-C: "organízame" — for whoever does not know where to start. The
// bot takes the lead in a short guided conversation: overdue tasks (oldest
// first) → undated → urgent, one at a time with buttons; each answer runs
// the action and moves on. At most 8 per session; "para" / "después" exits.

import { createServerClient } from '@/lib/supabase-server'
import type { Company } from '@/types'
import { CHELSEA_COMPANY_NAME } from '@/lib/chelsea'
import { COLS_SIN_NOTAS, cancelarTareas, ejecutarAccion, type TaskRow } from './acciones'
import { addDays, cancunYmd, daysBetween, formatVenceEs } from './cancun'
import type { AsistenteConfig } from './config'
import { fechaEstaSemana } from './sugerencias'
import { inlineKeyboard } from './telegram'

export const MAX_ITEMS = 8

export interface ItemOrganizar {
  id: string
  text: string
  company: string | null
  /** Why it is in the queue: "lleva 46 días vencida" / "no tiene fecha" / "es urgente ★". */
  motivo: string
}

export interface OrganizarDraft {
  tipo: 'organizar'
  cola: ItemOrganizar[]
  idx: number
  stats: { hoy: number; manana: number; semana: number; cancel: number; delegadas: number; saltadas: number }
  /** Open tasks in total (for the intro) and how many were left out. */
  total: number
  fuera: number
}

export type RespuestaOrganizar = 'hoy' | 'man' | 'sem' | 'can' | 'del' | 'sig' | 'fin'

function botones(nonce: string) {
  return inlineKeyboard([
    [{ text: 'Hoy', callback_data: `o:${nonce}:hoy` }, { text: 'Mañana', callback_data: `o:${nonce}:man` }, { text: 'Esta semana', callback_data: `o:${nonce}:sem` }],
    [{ text: 'Cancelar', callback_data: `o:${nonce}:can` }, { text: 'Delegar', callback_data: `o:${nonce}:del` }, { text: 'Siguiente ›', callback_data: `o:${nonce}:sig` }],
  ])
}

function pregunta(it: ItemOrganizar, n: number, total: number): string {
  return `${n}/${total} · «${it.text}»${it.company ? ` · ${it.company}` : ''} ${it.motivo}. ¿Qué hacemos?`
}

/** Builds the queue and the opening message. null when there is nothing to sort out. */
export async function iniciarOrganizar(cfg: AsistenteConfig, today: string = cancunYmd()): Promise<{ draft: OrganizarDraft; texto: string } | null> {
  const db = createServerClient()
  const [{ data: rows, error }, { data: companies }] = await Promise.all([
    db.from('tasks').select(COLS_SIN_NOTAS + ', company_id, created_at').eq('done', false),
    db.from('companies').select('*'),
  ])
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const chelsea = ((companies as Company[]) ?? []).find((c) => c.name.trim().toLowerCase() === CHELSEA_COMPANY_NAME.toLowerCase())
  const abiertas = ((rows as unknown as (TaskRow & { company_id: string | null; created_at: string })[]) ?? []).filter((t) => t.company_id !== chelsea?.id)
  const total = abiertas.length
  if (total === 0) return null

  const vencidas = abiertas.filter((t) => t.due_date && t.due_date < today).sort((a, b) => a.due_date!.localeCompare(b.due_date!))
  const sinFecha = abiertas
    .filter((t) => !t.due_date)
    .sort((a, b) => (a.priority === 'urgente' ? 0 : a.importante ? 1 : 2) - (b.priority === 'urgente' ? 0 : b.importante ? 1 : 2) || a.created_at.localeCompare(b.created_at))
  const urgentes = abiertas.filter((t) => t.priority === 'urgente' && t.due_date && t.due_date >= today).sort((a, b) => a.due_date!.localeCompare(b.due_date!))
  const vistos = new Set<string>()
  const cola: ItemOrganizar[] = []
  const push = (t: TaskRow, motivo: string) => {
    if (vistos.has(t.id)) return
    vistos.add(t.id)
    cola.push({ id: t.id, text: t.text, company: t.company?.name?.trim() ?? null, motivo })
  }
  for (const t of vencidas) {
    const d = daysBetween(t.due_date!, today)
    push(t, `lleva ${d} ${d === 1 ? 'día' : 'días'} vencida`)
  }
  for (const t of sinFecha) push(t, `no tiene fecha${t.priority === 'urgente' ? ' y es urgente' : t.importante ? ' y es importante ★' : ''}`)
  for (const t of urgentes) push(t, `es urgente y vence ${t.due_date === today ? 'hoy' : formatVenceEs(t.due_date!)}`)
  if (cola.length === 0) return null

  const fuera = Math.max(0, cola.length - MAX_ITEMS)
  const draft: OrganizarDraft = {
    tipo: 'organizar',
    cola: cola.slice(0, MAX_ITEMS),
    idx: 0,
    stats: { hoy: 0, manana: 0, semana: 0, cancel: 0, delegadas: 0, saltadas: 0 },
    total,
    fuera,
  }
  const minutos = Math.max(1, Math.round(draft.cola.length / 4))
  const intro = [
    `Tienes ${total} pendientes, ${cfg.nombre_persona}. Vamos a dejarlos en orden en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`,
    fuera > 0 ? `Vamos con los ${MAX_ITEMS} más viejos; el resto mañana.` : null,
    `Empiezo por ${vencidas.length > 0 ? 'lo vencido' : sinFecha.length > 0 ? 'lo que no tiene fecha' : 'lo urgente'}:`,
    pregunta(draft.cola[0], 1, draft.cola.length),
  ].filter(Boolean).join(' ')
  return { draft, texto: intro }
}

export function tecladoOrganizar(nonce: string) {
  return botones(nonce)
}

export function resumen(d: OrganizarDraft, cfg: AsistenteConfig): string {
  const s = d.stats
  const partes = [
    s.hoy > 0 ? `Hoy: ${s.hoy}` : null,
    s.manana > 0 ? `Mañana: ${s.manana}` : null,
    s.semana > 0 ? `Esta semana: ${s.semana}` : null,
    s.cancel > 0 ? `Cancelaste ${s.cancel}` : null,
    s.delegadas > 0 ? `Delegaste ${s.delegadas}` : null,
    s.saltadas > 0 ? `Sin tocar: ${s.saltadas}` : null,
  ].filter(Boolean)
  return `Listo, ${cfg.nombre_persona} 👏 ${partes.length > 0 ? partes.join('. ') + '.' : 'No cambiamos nada.'}${d.fuera > 0 ? ` Quedan ${d.fuera} más para mañana.` : ''}`
}

/**
 * Applies the answer to the current item and advances. Returns the line for
 * what was done, the next question (or null when the session is over) and
 * the updated draft.
 */
export async function responderOrganizar(d: OrganizarDraft, valor: RespuestaOrganizar, cfg: AsistenteConfig, today: string = cancunYmd()): Promise<{ hecho: string | null; siguiente: string | null; draft: OrganizarDraft; terminado: boolean }> {
  const it = d.cola[d.idx]
  let hecho: string | null = null
  if (it && valor !== 'fin') {
    try {
      if (valor === 'hoy' || valor === 'man' || valor === 'sem') {
        const fecha = valor === 'hoy' ? today : valor === 'man' ? addDays(today, 1) : fechaEstaSemana(today)
        hecho = await ejecutarAccion({ accion: 'editar', cambios: { due_date: fecha } }, [it.id])
        d.stats[valor === 'hoy' ? 'hoy' : valor === 'man' ? 'manana' : 'semana'] += 1
      } else if (valor === 'can') {
        hecho = await cancelarTareas([it.id], 'organizando pendientes')
        d.stats.cancel += 1
      } else if (valor === 'del') {
        hecho = await delegar(it)
        d.stats.delegadas += 1
      } else {
        d.stats.saltadas += 1
      }
    } catch (err) {
      hecho = `⚠️ No pude con «${it.text}»: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  const next = { ...d, idx: valor === 'fin' ? d.cola.length : d.idx + 1 }
  if (next.idx >= next.cola.length) return { hecho, siguiente: null, draft: next, terminado: true }
  return { hecho, siguiente: pregunta(next.cola[next.idx], next.idx + 1, next.cola.length), draft: next, terminado: false }
}

/** "Delegar": to the Chelsea company if it exists; otherwise a dated note on the task. */
async function delegar(it: ItemOrganizar): Promise<string> {
  const db = createServerClient()
  const { data: companies } = await db.from('companies').select('*')
  const chelsea = ((companies as Company[]) ?? []).find((c) => c.name.trim().toLowerCase() === CHELSEA_COMPANY_NAME.toLowerCase())
  if (chelsea) {
    return ejecutarAccion({ accion: 'editar', cambios: { company_id: chelsea.id, company_name: chelsea.name.trim() } }, [it.id])
  }
  return ejecutarAccion({ accion: 'nota_tarea', texto: 'delegar (sin empresa Chelsea en Settings)' }, [it.id])
}

export { formatVenceEs }
