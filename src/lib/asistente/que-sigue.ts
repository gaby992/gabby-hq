// Fase 4b: "¿qué sigue?" — not the whole list (that is the 8:00 alarm) but a
// short, ORDERED answer: one task to do now, up to three after it, up to
// three due this week, and the notes of the last 3 days.
//
// The order is decided HERE, deterministically, and the message is rendered
// in the same HTML style as the 8:00 list (bold section titles, one item per
// line, text symbols). No LLM: with a fixed item format there is nothing left
// to word, and this way it is instant and free.
//   vencidas (más vieja primero) > vence hoy > urgente★ > urgente >
//   ★ con fecha esta semana > ★ sin fecha
// The task lines are numbered and recorded in bot_alarmas (tipo 'que_sigue')
// so "listo 1" / "pasa el segundo" work on this answer like on an alarm.

import { createServerClient } from '@/lib/supabase-server'
import type { Company, NotaEmpresa, Priority } from '@/types'
import { CHELSEA_COMPANY_NAME } from '@/lib/chelsea'
import { NOTA_FRESCA_DIAS } from '@/lib/notas'
import { daysSince } from '@/lib/dates'
import { SIMBOLO, guardarAlarma, simboloDe, type AlarmaItem } from './alarmas'
import { addDays, cancunYmd, daysBetween, formatHoraEs, formatVenceEs } from './cancun'
import { escapeHtml, sendTelegram } from './telegram'

export interface QueSigueOpts {
  /** "qué sigue de IM" */
  empresa?: string | null
  /** "solo urgentes": no "Por vencer" section. */
  solo_urgentes?: boolean
  /** "qué vence esta semana": only the "Por vencer" section. */
  solo_vencer?: boolean
}

interface TaskLite {
  id: string
  text: string
  priority: Priority
  importante: boolean
  due_date: string | null
  due_time: string | null
  company_id: string | null
  company: { name: string } | null
}

interface Rankeada {
  task: TaskLite
  /** Lower first. */
  rank: number
  porque: string
  simbolo: string
}

export interface QueSigue {
  ahora: Rankeada | null
  despues: Rankeada[]
  porVencer: TaskLite[]
  notas: { empresa: string; texto: string; dias: number }[]
  /** The numbering, in message order. */
  items: AlarmaItem[]
  /** Telegram HTML, same style as the 8:00 list. */
  html: string
  /** The same message without tags, for the web card. */
  textoPlano: string
}

const MAX_DESPUES = 3
const MAX_VENCER = 3
const MAX_NOTA_CHARS = 140

function corto(s: string, max: number): string {
  const una = s.replace(/\s+/g, ' ').trim()
  return una.length > max ? una.slice(0, max - 1) + '…' : una
}

/** rank + symbol + the "por qué" tail. null → not a candidate for Ahora/Después. */
function rankear(t: TaskLite, today: string, domingo: string): { rank: number; porque: string; simbolo: string } | null {
  if (t.due_date && t.due_date < today) {
    const d = daysBetween(t.due_date, today)
    // 0..9999: oldest first inside the bucket.
    return { rank: 10_000 - Math.min(d, 9_999), porque: `hace ${d} ${d === 1 ? 'día' : 'días'}`, simbolo: SIMBOLO.vencida }
  }
  if (t.due_date === today) return { rank: 20_000, porque: `hoy${t.due_time ? ` ${formatHoraEs(t.due_time.slice(0, 5))}` : ''}`, simbolo: SIMBOLO.hoy }
  if (t.priority === 'urgente' && t.importante) return { rank: 30_000, porque: 'urgente ★', simbolo: SIMBOLO.estrella }
  if (t.priority === 'urgente') return { rank: 40_000, porque: 'urgente', simbolo: SIMBOLO.estrella }
  if (t.importante && t.due_date && t.due_date <= domingo) return { rank: 50_000, porque: `★ ${formatVenceEs(t.due_date)}`, simbolo: SIMBOLO.estrella }
  if (t.importante) return { rank: 60_000, porque: '★ sin fecha', simbolo: SIMBOLO.estrella }
  return null
}

export async function calcularQueSigue(opts: QueSigueOpts = {}, now: Date = new Date()): Promise<QueSigue> {
  const today = cancunYmd(now)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  // "Esta semana" ends on Sunday; asked ON a Sunday it means the week that starts tomorrow.
  const domingo = addDays(today, (7 - dow) % 7 || 7)
  const db = createServerClient()
  const [tasksRes, companiesRes, notasRes] = await Promise.all([
    db.from('tasks').select('id, text, priority, importante, due_date, due_time, company_id, company:companies(name)').eq('done', false),
    db.from('companies').select('*'),
    db.from('notas_empresa').select('*'),
  ])
  if (tasksRes.error) throw new Error(`Supabase tasks: ${tasksRes.error.message}`)
  if (companiesRes.error) throw new Error(`Supabase companies: ${companiesRes.error.message}`)
  if (notasRes.error) throw new Error(`Supabase notas_empresa: ${notasRes.error.message}`)
  const companies = (companiesRes.data as Company[]) ?? []
  let tasks = (tasksRes.data as unknown as TaskLite[]) ?? []
  let notas = (notasRes.data as NotaEmpresa[]) ?? []

  // Chelsea's tasks are delegated: never "lo que sigue" for Gabby.
  const chelsea = companies.find((c) => c.name.trim().toLowerCase() === CHELSEA_COMPANY_NAME.toLowerCase())
  if (chelsea && !opts.empresa) tasks = tasks.filter((t) => t.company_id !== chelsea.id)

  if (opts.empresa) {
    const n = opts.empresa.trim().toLowerCase()
    const c = companies.find((x) => x.name.trim().toLowerCase() === n) ?? companies.find((x) => x.name.trim().toLowerCase().includes(n))
    tasks = c ? tasks.filter((t) => t.company_id === c.id) : []
    notas = c ? notas.filter((x) => x.company_id === c.id) : []
  }

  const ranked = tasks
    .map((task) => ({ task, r: rankear(task, today, domingo) }))
    .filter((x): x is { task: TaskLite; r: { rank: number; porque: string; simbolo: string } } => x.r !== null)
    .map((x) => ({ task: x.task, rank: x.r.rank, porque: x.r.porque, simbolo: x.r.simbolo }))
    .sort((a, b) => a.rank - b.rank || (a.task.due_date ?? '9999').localeCompare(b.task.due_date ?? '9999'))

  const ahora = opts.solo_vencer ? null : ranked[0] ?? null
  const despues = opts.solo_vencer ? [] : ranked.slice(1, 1 + MAX_DESPUES)
  const usados = new Set([ahora, ...despues].filter(Boolean).map((x) => x!.task.id))
  const porVencer = opts.solo_urgentes
    ? []
    : tasks
        .filter((t) => t.due_date && t.due_date > today && t.due_date <= domingo && !usados.has(t.id))
        .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
        .slice(0, MAX_VENCER)

  const notasFrescas = opts.solo_vencer
    ? []
    : notas
        .filter((n) => n.nota.trim() && daysSince(n.updated_at, now) <= NOTA_FRESCA_DIAS)
        .map((n) => ({
          empresa: companies.find((c) => c.id === n.company_id)?.name.trim() ?? '?',
          texto: corto(n.nota, MAX_NOTA_CHARS),
          dias: daysSince(n.updated_at, now),
        }))

  // ── Rendering: same shape as the 8:00 list ──
  const items: AlarmaItem[] = []
  const bloques: string[] = []
  const emp = (t: TaskLite) => escapeHtml(t.company?.name ?? 'sin empresa')
  const num = (t: TaskLite) => {
    items.push({ n: items.length + 1, task_id: t.id })
    return items.length
  }
  const item = (simbolo: string, t: TaskLite, cola: string) => `${simbolo} ${num(t)}. ${escapeHtml(t.text)} · ${emp(t)} · ${cola}`

  const de = opts.empresa ? ` · ${escapeHtml(opts.empresa)}` : ''
  bloques.push(`🎯 <b>Qué sigue${de} · ${formatVenceEs(today)}</b>`)

  if (!opts.solo_vencer) {
    bloques.push(['<b>Ahora</b>', ahora ? item(ahora.simbolo, ahora.task, ahora.porque) : '— nada vencido ni urgente 🎉'].join('\n'))
    if (despues.length > 0) {
      bloques.push(['<b>Después</b>', ...despues.map((d) => item(d.simbolo, d.task, d.porque))].join('\n'))
    }
  }
  if (!opts.solo_urgentes) {
    bloques.push([
      '<b>Por vencer esta semana</b>',
      ...(porVencer.length > 0
        ? porVencer.map((t) => item(simboloDe(t, today), t, `${formatVenceEs(t.due_date!)}${t.due_time ? ` ${formatHoraEs(t.due_time.slice(0, 5))}` : ''}`))
        : ['— nada vence esta semana']),
    ].join('\n'))
  }
  if (!opts.solo_vencer) {
    bloques.push([
      '<b>Por dónde ibas</b>',
      ...(notasFrescas.length > 0
        ? notasFrescas.map((n) => `📝 ${escapeHtml(n.empresa)}: ${escapeHtml(n.texto)}`)
        : ['— sin notas de los últimos 3 días']),
    ].join('\n'))
  }

  const html = bloques.join('\n\n')
  const textoPlano = html.replace(/<\/?b>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return { ahora, despues, porVencer, notas: notasFrescas, items, html, textoPlano }
}

/**
 * Sends the HTML message to the chat and records the numbering, so
 * "listo 1" / "pasa el segundo" work on it. Returns the number of items.
 */
export async function enviarQueSigue(chatId: number, opts: QueSigueOpts = {}): Promise<number> {
  const q = await calcularQueSigue(opts)
  await sendTelegram(chatId, q.html, { html: true, tag: 'que-sigue' })
  if (q.items.length > 0) {
    try {
      await guardarAlarma('que_sigue', q.items)
    } catch (err) {
      console.error(`[que-sigue] bot_alarmas: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return q.items.length
}

/** The same message without tags: the "¿Qué sigue?" card in /hoy. */
export async function textoQueSigue(opts: QueSigueOpts = {}): Promise<string> {
  return (await calcularQueSigue(opts)).textoPlano
}
