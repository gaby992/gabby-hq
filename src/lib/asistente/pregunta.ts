// "/pregunta ¿qué tengo hoy?" → context + LLM → ≤5 lines, logged in
// bot_preguntas so cost and prompt quality can be reviewed later.

import { createServerClient } from '@/lib/supabase-server'
import { construirContexto } from './contexto'
import { llmConfig, preguntarLlm } from './llm'

export const SYSTEM_PROMPT =
  'Eres el asistente personal de Gabby. Respondes en español, informal, en MÁXIMO 5 líneas. ' +
  'Solo usas el contexto dado; si algo no está ahí, dices que no lo tienes. ' +
  'Nunca inventas tareas ni fechas. Si pregunta qué hacer primero, priorizas: ' +
  'vencidas > vence hoy > urgente★ > urgente > ★.\n' +
  'Español neutro, como se habla en Venezuela: tuteo ("tienes", "quieres", "puedes"). ' +
  'NUNCA uses voseo ("tenés", "querés", "podés", "vos").\n' +
  'Formato: si la pregunta pide una lista (qué tengo, qué hay, qué cerré, qué se me olvidó), ' +
  'responde solo con la lista: MÁXIMO 8 ítems, uno por línea, compactos, así: "- título · empresa · fecha" ' +
  '(usa "sin fecha" si no tiene). Para tareas cerradas, la fecha es la de cierre, p. ej. "- título · IM · cerrada jue 29 oct". ' +
  'Si en el contexto hay más de 8, cierra con una línea exacta "+N más en GabbyHQ" ' +
  'donde N es cuántos faltan. Si la pregunta no pide lista, responde en prosa, máximo 5 líneas, sin encabezados.'

/** Hard cap after the model answers: 8 items + the "+N más" line. */
const MAX_LINEAS = 9

export const MAX_TOKENS = 300
export const TIMEOUT_MS = 20_000
export const RESPUESTA_TRABADA = 'Se me trabó, pregunta otra vez.'
export const USO_PREGUNTA = 'Uso: /pregunta ¿qué tengo hoy?  (o empieza el mensaje con ? o ¿)'

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

/**
 * Keeps the answer within the agreed size and turns the model's literal
 * "+N más en GabbyHQ" into a line with the link to /hoy.
 */
export function acotar(text: string): string {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
  const out = lines.slice(0, MAX_LINEAS)
  if (lines.length > out.length && !/\+\d+ más/i.test(out[out.length - 1])) {
    out[out.length - 1] = `+${lines.length - out.length + 1} más en GabbyHQ`
  }
  return out
    .map((l) => l.replace(/^\+(\d+) más en GabbyHQ\.?$/i, (_m, n) => `+${n} más en GabbyHQ → ${appUrl()}/hoy`))
    .join('\n')
}

async function registrar(row: {
  chat_id: number
  pregunta: string
  respuesta: string
  modelo: string
  tokens_in: number
  tokens_out: number
  ms: number
}) {
  const { error } = await createServerClient().from('bot_preguntas').insert(row)
  // Logging must never break the answer; a missing table shows up in Vercel logs.
  if (error) console.error(`[pregunta] bot_preguntas insert: ${error.message}`)
}

export async function responderPregunta(chatId: number, pregunta: string): Promise<string> {
  const q = pregunta.trim()
  if (!q) return USO_PREGUNTA

  const t0 = Date.now()
  let modelo = 'desconocido'
  try {
    const cfg = llmConfig()
    modelo = `${cfg.provider}:${cfg.model}`
    const ctx = await construirContexto()
    const user = `CONTEXTO:\n${ctx.text}\n\nPREGUNTA: ${q}`
    const r = await preguntarLlm(SYSTEM_PROMPT, user, { maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS })
    const respuesta = r.text ? acotar(r.text) : RESPUESTA_TRABADA
    console.log(`[pregunta] ok · ${modelo} · ctx ${ctx.chars} chars · in ${r.tokensIn} · out ${r.tokensOut} · ${r.ms} ms`)
    await registrar({ chat_id: chatId, pregunta: q, respuesta, modelo, tokens_in: r.tokensIn, tokens_out: r.tokensOut, ms: r.ms })
    return respuesta
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err)
    const ms = Date.now() - t0
    console.error(`[pregunta] error · ${modelo} · ${ms} ms · ${motivo}`)
    await registrar({ chat_id: chatId, pregunta: q, respuesta: `ERROR: ${motivo}`, modelo, tokens_in: 0, tokens_out: 0, ms })
    return RESPUESTA_TRABADA
  }
}
