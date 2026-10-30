// "listo …" and "pasa …": act on tasks named by the number they had in the
// LAST alarm (bot_alarmas) or by a word of their title.
//   listo 3 · listo 2,5 · listo paypal      → done = true (the trigger stamps completed_at)
//   pasa 2,5 · pasa todo · pasa paypal      → due_date = tomorrow (Cancún)
// Title search with 2–5 hits asks with buttons; the tap lands in the webhook
// as "t:<nonce>:<task_id>" and comes back here through ejecutarAccion().

import { createServerClient } from '@/lib/supabase-server'
import type { Accion } from '@/lib/parser'
import { addDays, cancunYmd, formatCortoEs } from './cancun'
import type { AlarmaItem, AlarmaTipo } from './alarmas'
import { inlineKeyboard, type InlineButton } from './telegram'

export const USO: Record<Accion, string> = {
  pasa: 'Formato: pasa 2,5 (números de la última alarma) · pasa todo · pasa paypal (palabra del título)',
  listo: 'Formato: listo 3 · listo 2,5 (números de la última alarma) · listo paypal (palabra del título)',
}

const MAX_CANDIDATOS = 5

interface UltimaAlarma {
  id: string
  tipo: AlarmaTipo
  enviada_en: string
  items: AlarmaItem[]
}

/** A task as the confirmations need it. */
interface TaskRow {
  id: string
  text: string
  done: boolean
  company: { name: string } | null
}

export interface Respuesta {
  text: string
  replyMarkup?: unknown
  /** When buttons are shown: the ids the tap may pick (saved in the draft). */
  candidatos?: string[]
}

// ── Resolution ──────────────────────────────────────────────────────────

/** Accents and case out: "PayPal" matches "paypal", "está" matches "esta". */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

async function ultimaAlarma(): Promise<UltimaAlarma | null> {
  const { data, error } = await createServerClient()
    .from('bot_alarmas')
    .select('id, tipo, enviada_en, items')
    .order('enviada_en', { ascending: false })
    .limit(1)
    .maybeSingle<UltimaAlarma>()
  if (error) throw new Error(`Supabase bot_alarmas: ${error.message}`)
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return null
  return data
}

type Resuelto = { ids: string[] } | { text: string }

async function porNumeros(wanted: number[] | 'todo'): Promise<Resuelto> {
  const alarma = await ultimaAlarma()
  if (!alarma) {
    return { text: 'No hay ninguna alarma con tareas numeradas todavía. Espera la de las 8:00 o la de las 6:00 pm, o dime una palabra del título.' }
  }
  if (wanted === 'todo') return { ids: alarma.items.map((i) => i.task_id) }
  const byN = new Map(alarma.items.map((i) => [i.n, i.task_id]))
  const missing = wanted.filter((n) => !byN.has(n))
  if (missing.length > 0) {
    const max = Math.max(...alarma.items.map((i) => i.n))
    return { text: `No encontré ${missing.length === 1 ? 'el' : 'los'} ${missing.join(', ')} en la última alarma (va del 1 al ${max}).` }
  }
  return { ids: wanted.map((n) => byN.get(n)!) }
}

async function porTitulo(termino: string, accion: Accion): Promise<Resuelto | { pregunta: Respuesta }> {
  const { data, error } = await createServerClient()
    .from('tasks')
    .select('id, text, done, company:companies(name)')
    .eq('done', false)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const needle = normalizar(termino)
  const hits = ((data as unknown as TaskRow[]) ?? []).filter((t) => normalizar(t.text).includes(needle))

  if (hits.length === 0) return { text: `No encontré ninguna tarea con «${termino}».` }
  if (hits.length === 1) return { ids: [hits[0].id] }
  if (hits.length > MAX_CANDIDATOS) {
    return { text: `Encontré ${hits.length} tareas con «${termino}». Dime algo más específico.` }
  }
  const verbo = accion === 'listo' ? 'completo' : 'paso a mañana'
  const buttons: InlineButton[] = hits.map((t) => ({
    text: `${t.text.length > 40 ? t.text.slice(0, 39) + '…' : t.text}${t.company ? ` · ${t.company.name}` : ''}`,
    callback_data: `t:NONCE:${t.id}`,
  }))
  return {
    pregunta: {
      text: `¿Cuál ${verbo}?`,
      replyMarkup: inlineKeyboard(buttons.map((b) => [b])),
      candidatos: hits.map((t) => t.id),
    },
  }
}

// ── Execution ───────────────────────────────────────────────────────────

function etiqueta(t: TaskRow): string {
  return `«${t.text}»${t.company ? ` · ${t.company.name}` : ''}`
}

/** Runs the action on the given open tasks and returns the one-line confirmation(s). */
export async function ejecutarAccion(accion: Accion, ids: string[]): Promise<string> {
  const db = createServerClient()
  const manana = addDays(cancunYmd(), 1)
  const cambio = accion === 'listo' ? { done: true } : { due_date: manana }
  const { data, error } = await db
    .from('tasks')
    .update(cambio)
    .in('id', ids)
    .eq('done', false)
    .select('id, text, done, company:companies(name)')
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const rows = (data as unknown as TaskRow[]) ?? []

  if (rows.length === 0) {
    return accion === 'listo' ? 'Esas tareas ya estaban cerradas.' : 'Nada que pasar: esas tareas ya están cerradas.'
  }
  const skipped = ids.length - rows.length
  const cola = skipped > 0 ? `\n(${skipped} ya ${skipped === 1 ? 'estaba cerrada' : 'estaban cerradas'})` : ''

  if (accion === 'listo') {
    return rows.map((t) => `✅ Hecha: ${etiqueta(t)}`).join('\n') + cola
  }
  const fecha = formatCortoEs(manana)
  if (rows.length === 1) return `📅 ${etiqueta(rows[0])} pasa a mañana (${fecha})${cola}`
  return `✅ ${rows.length} tareas pasan a mañana (${fecha}):\n` + rows.map((t) => `• ${etiqueta(t)}`).join('\n') + cola
}

// ── Entry point from the webhook ────────────────────────────────────────

/**
 * `arg` is what came after "listo"/"pasa": nothing, "todo", "2,5" or a word.
 * `nonce` ties the buttons (if any) to the draft the webhook will create.
 */
export async function manejarAccion(accion: Accion, arg: string, nonce: string): Promise<Respuesta> {
  const rest = arg.trim()
  if (!rest) return { text: USO[accion] }

  let resuelto: Resuelto | { pregunta: Respuesta }
  if (/^todo$/i.test(rest)) {
    // "listo todo" closes everything in the last alarm in one tap — too easy
    // to send by accident, so only "pasa todo" exists.
    if (accion !== 'pasa') return { text: USO[accion] }
    resuelto = await porNumeros('todo')
  } else if (/^[\d\s,;]+$/.test(rest)) {
    const nums = Array.from(new Set(rest.split(/[\s,;]+/).filter(Boolean).map(Number)))
    resuelto = await porNumeros(nums)
  } else {
    resuelto = await porTitulo(rest, accion)
  }

  if ('pregunta' in resuelto) {
    const markup = JSON.parse(JSON.stringify(resuelto.pregunta.replyMarkup).replace(/NONCE/g, nonce))
    return { ...resuelto.pregunta, replyMarkup: markup }
  }
  if ('text' in resuelto) return { text: resuelto.text }
  return { text: await ejecutarAccion(accion, resuelto.ids) }
}
