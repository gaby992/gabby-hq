// Fase 4b: "¿qué sigue?" — not the whole list (that is the 8:00 alarm) but a
// short, ORDERED answer: one task to do now, up to three after it, up to
// three due this week, and the notes of the last 3 days.
//
// The order is decided HERE, deterministically; the LLM only words it. If
// the model fails, the same sections go out in the fixed format anyway.
//   vencidas (más vieja primero) > vence hoy > urgente★ > urgente >
//   ★ con fecha esta semana > ★ sin fecha
// The task lines are numbered and recorded in bot_alarmas (tipo 'que_sigue')
// so "listo 1" / "pasa el segundo" work on this answer like on an alarm.

import { createServerClient } from '@/lib/supabase-server'
import type { Company, NotaEmpresa, Priority } from '@/types'
import { CHELSEA_COMPANY_NAME } from '@/lib/chelsea'
import { NOTA_FRESCA_DIAS } from '@/lib/notas'
import { daysSince } from '@/lib/dates'
import { guardarAlarma, type AlarmaItem } from './alarmas'
import { addDays, cancunYmd, daysBetween, formatHoraEs, formatVenceEs } from './cancun'
import { llmConfig, preguntarLlm } from './llm'

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
}

export interface QueSigue {
  ahora: Rankeada | null
  despues: Rankeada[]
  porVencer: TaskLite[]
  notas: { empresa: string; texto: string; dias: number }[]
  /** The numbering, in message order. */
  items: AlarmaItem[]
  /** Deterministic rendering (also the fallback). */
  textoFijo: string
}

const MAX_DESPUES = 3
const MAX_VENCER = 3
const MAX_NOTA_CHARS = 140
export const MAX_TOKENS = 400
export const TIMEOUT_MS = 15_000

function corto(s: string, max: number): string {
  const una = s.replace(/\s+/g, ' ').trim()
  return una.length > max ? una.slice(0, max - 1) + '…' : una
}

/** rank + the "por qué" shown next to the task. null → not a candidate for Ahora/Después. */
function rankear(t: TaskLite, today: string, domingo: string): { rank: number; porque: string } | null {
  if (t.due_date && t.due_date < today) {
    const d = daysBetween(t.due_date, today)
    // 0..9999: oldest first inside the bucket.
    return { rank: 10_000 - Math.min(d, 9_999), porque: `vencida hace ${d} ${d === 1 ? 'día' : 'días'}` }
  }
  if (t.due_date === today) return { rank: 20_000, porque: 'vence hoy' }
  if (t.priority === 'urgente' && t.importante) return { rank: 30_000, porque: 'urgente ★' }
  if (t.priority === 'urgente') return { rank: 40_000, porque: 'urgente' }
  if (t.importante && t.due_date && t.due_date <= domingo) return { rank: 50_000, porque: `★ vence ${formatVenceEs(t.due_date)}` }
  if (t.importante) return { rank: 60_000, porque: '★ sin fecha' }
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
    .filter((x): x is { task: TaskLite; r: { rank: number; porque: string } } => x.r !== null)
    .map((x) => ({ task: x.task, rank: x.r.rank, porque: x.r.porque }))
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

  const items: AlarmaItem[] = []
  const lineas: string[] = []
  const emp = (t: TaskLite) => t.company?.name ?? 'sin empresa'
  const num = (t: TaskLite) => {
    items.push({ n: items.length + 1, task_id: t.id })
    return items.length
  }

  if (!opts.solo_vencer) {
    if (ahora) lineas.push(`🎯 Ahora: ${num(ahora.task)}. «${ahora.task.text}» · ${emp(ahora.task)} · ${ahora.porque}`)
    else lineas.push('🎯 Ahora: nada vencido ni urgente' + (opts.empresa ? ` de ${opts.empresa}` : '') + ' 🎉')
    if (despues.length > 0) {
      lineas.push('📌 Después:')
      for (const d of despues) lineas.push(`${num(d.task)}. «${d.task.text}» · ${emp(d.task)} · ${d.porque}`)
    }
  }
  // Fase 4c: the answer always has the same shape — empty sections say so.
  if (!opts.solo_urgentes) {
    if (porVencer.length > 0) {
      lineas.push('⏳ Por vencer esta semana:')
      for (const t of porVencer) lineas.push(`${num(t)}. «${t.text}» · ${emp(t)} · ${formatVenceEs(t.due_date!)}${t.due_time ? ` ${formatHoraEs(t.due_time.slice(0, 5))}` : ''}`)
    } else {
      lineas.push('⏳ Nada vence esta semana' + (opts.empresa ? ` de ${opts.empresa}` : ''))
    }
  }
  if (!opts.solo_vencer) {
    if (notasFrescas.length > 0) {
      lineas.push('📝 Por dónde ibas:')
      for (const n of notasFrescas) lineas.push(`${n.empresa}: ${n.texto}`)
    } else {
      lineas.push('📝 Sin notas de los últimos 3 días')
    }
  }

  return { ahora, despues, porVencer, notas: notasFrescas, items, textoFijo: lineas.join('\n') }
}

const SYSTEM_PROMPT =
  'Eres el asistente personal de Gabby. Te doy una lista YA ORDENADA de sus tareas y tu único trabajo es redactarla ' +
  'en español neutro (tuteo, nunca voseo), corta y clara, con EXACTAMENTE este formato y en este orden:\n' +
  '🎯 Ahora: N. «título» · empresa · por qué\n' +
  '📌 Después:\nN. «título» · empresa · por qué   (hasta 3 líneas)\n' +
  '⏳ Por vencer esta semana:\nN. «título» · empresa · fecha   (hasta 3 líneas)\n' +
  '📝 Por dónde ibas:\nEmpresa: una línea por nota\n' +
  'Reglas: conserva los números, los títulos entre «» y el orden tal cual; no agregues ni quites tareas; ' +
  'las líneas "⏳ Nada vence esta semana" y "📝 Sin notas de los últimos 3 días" se copian tal cual cuando vienen; ' +
  'el "por qué" puede ir en tus palabras pero con el mismo dato ' +
  '("vencida hace 3 días", "vence hoy", "urgente ★"). Puedes resumir una nota larga a una línea. ' +
  'Sin saludos, sin encabezados, sin comentarios: solo las secciones.'

/**
 * Computes, words with the LLM (or not), records the numbering for the chat.
 * `chatId` null (the web) skips the recording.
 */
export async function responderQueSigue(chatId: number | null, opts: QueSigueOpts = {}): Promise<string> {
  const q = await calcularQueSigue(opts)
  let texto = q.textoFijo
  if (q.items.length > 0 || q.notas.length > 0) {
    try {
      const cfg = llmConfig()
      const r = await preguntarLlm(SYSTEM_PROMPT, `LISTA ORDENADA:\n${q.textoFijo}`, { maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS })
      // Keep the model's text only if it kept every number (the refs rely on
      // them) and every section header (the fixed shape).
      const cabeceras = ['🎯', '📌', '⏳', '📝'].filter((c) => q.textoFijo.includes(c))
      const ok = r.text && q.items.every((it) => new RegExp(`(^|\\s)${it.n}\\.\\s`).test(r.text)) && cabeceras.every((c) => r.text.includes(c))
      if (ok) texto = r.text.trim()
      else console.warn(`[que-sigue] el modelo (${cfg.model}) cambió la numeración; uso el texto fijo`)
    } catch (err) {
      console.error(`[que-sigue] LLM falló: ${err instanceof Error ? err.message : String(err)} — texto fijo`)
    }
  }
  if (chatId !== null && q.items.length > 0) {
    try {
      await guardarAlarma('que_sigue', q.items)
    } catch (err) {
      console.error(`[que-sigue] bot_alarmas: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return texto
}
