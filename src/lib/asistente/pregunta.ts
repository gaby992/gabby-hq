// "/pregunta ¿qué tengo hoy?" → context + LLM → ≤5 lines, logged in
// bot_preguntas so cost and prompt quality can be reviewed later.

import { createServerClient } from '@/lib/supabase-server'
import { construirContexto } from './contexto'
import { llmConfig, preguntarLlm } from './llm'

export const SYSTEM_PROMPT =
  'Eres el asistente personal de Gabby. Respondes en español, informal, en MÁXIMO 5 líneas. ' +
  'Solo usas el contexto dado; si algo no está ahí, dices que no lo tienes. ' +
  'Nunca inventas tareas ni fechas. Si pregunta qué hacer primero, priorizas: ' +
  'vencidas > vence hoy > urgente★ > urgente > ★.'

export const MAX_TOKENS = 300
export const TIMEOUT_MS = 20_000
export const RESPUESTA_TRABADA = 'Se me trabó, pregunta otra vez.'
export const USO_PREGUNTA = 'Uso: /pregunta ¿qué tengo hoy?  (o empieza el mensaje con ? o ¿)'

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
    const respuesta = r.text || RESPUESTA_TRABADA
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
