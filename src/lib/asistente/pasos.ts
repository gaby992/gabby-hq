// Fase 7-H: "un paso a la vez" (rule 4 of the master prompt). "me da flojera
// «X»" / "divide «X»" → the model proposes 3–5 concrete steps, saved as the
// task's subtasks (they already exist in the app), and the bot says only
// the first one. "siguiente paso" ticks it and shows the next.

import { createServerClient } from '@/lib/supabase-server'
import type { Subtask } from '@/types'
import { COLS_SIN_NOTAS, type TaskRow } from './acciones'
import { cargarConfig, personaPrompt } from './config'
import { llmConfig, preguntarLlm } from './llm'

const MAX_PASOS = 5
const MIN_PASOS = 3

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

async function tarea(id: string): Promise<TaskRow | null> {
  const { data } = await createServerClient().from('tasks').select(COLS_SIN_NOTAS).eq('id', id).maybeSingle()
  return (data as unknown as TaskRow) ?? null
}

async function subtareas(taskId: string): Promise<Subtask[]> {
  const { data } = await createServerClient().from('subtasks').select('*').eq('task_id', taskId).order('created_at', { ascending: true })
  return (data as Subtask[]) ?? []
}

/** Asks the model for the steps. Only the title and company travel; never the notes. */
async function proponerPasos(titulo: string, empresa: string | null): Promise<string[]> {
  const cfg = await cargarConfig()
  llmConfig()
  const system =
    personaPrompt(cfg) +
    `\n\nDivide una tarea grande en entre ${MIN_PASOS} y ${MAX_PASOS} pasos concretos, pequeños y en orden, que se puedan hacer en una sentada cada uno. ` +
    'Empieza cada paso con un verbo. Nada de pasos obvios ("abrir la computadora"). Responde SOLO con JSON: {"pasos":["…","…"]}.'
  const r = await preguntarLlm(system, `TAREA: ${titulo}${empresa ? ` (empresa: ${empresa})` : ''}`, { maxTokens: 300, timeoutMs: 15_000, json: true })
  const t = r.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const json = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
  const pasos = (Array.isArray(json?.pasos) ? json.pasos : []).map(str).filter((x: string | null): x is string => !!x).slice(0, MAX_PASOS)
  if (pasos.length < 2) throw new Error('el modelo no devolvió pasos')
  return pasos
}

/** "divide «X»": creates the subtasks (if it has none yet) and names the first step. */
export async function dividirTarea(taskId: string): Promise<string> {
  const t = await tarea(taskId)
  if (!t) return 'Esa tarea ya no existe.'
  const existentes = await subtareas(taskId)
  const pendientes = existentes.filter((s) => !s.done)
  if (pendientes.length > 0) {
    return [`«${t.text}» ya está dividida (${pendientes.length} ${pendientes.length === 1 ? 'paso pendiente' : 'pasos pendientes'}):`, ...pendientes.map((s, i) => `${i + 1}. ${s.text}`), '', `Empieza por: ${pendientes[0].text}`].join('\n')
  }
  let pasos: string[]
  try {
    pasos = await proponerPasos(t.text, t.company?.name ?? null)
  } catch (err) {
    return `Se me trabó dividiendo «${t.text}» (${err instanceof Error ? err.message : String(err)}). Dime tú el primer paso y lo apunto: "nota en ${t.text.split(' ')[0]}: primer paso …".`
  }
  const db = createServerClient()
  for (const texto of pasos) {
    const { error } = await db.from('subtasks').insert({ task_id: taskId, text: texto, done: false })
    if (error) throw new Error(`Supabase subtasks: ${error.message}`)
  }
  return [`Divido «${t.text}» en ${pasos.length} pasos:`, ...pasos.map((p, i) => `${i + 1}. ${p}`), '', `Empieza por: ${pasos[0]}`, 'Cuando esté, dime "siguiente paso".'].join('\n')
}

/** "siguiente paso": ticks the current one and shows the next. */
export async function siguientePaso(taskId: string): Promise<string> {
  const t = await tarea(taskId)
  if (!t) return 'Esa tarea ya no existe.'
  const pendientes = (await subtareas(taskId)).filter((s) => !s.done)
  if (pendientes.length === 0) return `«${t.text}» no tiene pasos pendientes. ¿La divido? Dime "divide ${t.text.split(' ').slice(0, 2).join(' ')}".`
  const actual = pendientes[0]
  const { error } = await createServerClient().from('subtasks').update({ done: true }).eq('id', actual.id)
  if (error) throw new Error(`Supabase subtasks: ${error.message}`)
  const siguiente = pendientes[1]
  if (!siguiente) return `✅ «${actual.text}» hecho 👏 Ese era el último paso de «${t.text}». ¿La cierro? Dime "listo ${t.text.split(' ')[0]}".`
  return `✅ «${actual.text}» hecho 👏\nSiguiente: ${siguiente.text}${pendientes.length > 2 ? ` (quedan ${pendientes.length - 2} más)` : ' (es el último)'}`
}
