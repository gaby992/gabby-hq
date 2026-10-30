// OpenAI changes model names, keys get revoked, credit runs out. Each of
// those is classified here and, at most once a day, reported to Telegram so
// Gabby finds out from the bot — not from silence.
//
// The "already warned today" mark lives in bot_preguntas (chat_id 0, pregunta
// "⚠️aviso:<tipo>"): no new table, and bot_alarmas has a CHECK on `tipo`
// (manana/tarde) that would need a migration to accept a third value.

import { createServerClient } from '@/lib/supabase-server'
import { cancunDayBounds, cancunYmd } from './cancun'
import { allowedChatIds, sendTelegram } from './telegram'

export type OpenAIErrorKind = 'model_not_found' | 'auth' | 'quota' | 'other'

export class OpenAIError extends Error {
  kind: OpenAIErrorKind
  status: number
  constructor(kind: OpenAIErrorKind, status: number, message: string) {
    super(message)
    this.kind = kind
    this.status = status
  }
}

/** Turns an OpenAI error response into something the callers can act on. */
export function clasificarErrorOpenAI(status: number, json: unknown): OpenAIError {
  const err = (json as { error?: { message?: string; code?: string; type?: string } } | null)?.error
  const message = err?.message ?? `OpenAI HTTP ${status}`
  const code = `${err?.code ?? ''} ${err?.type ?? ''}`.toLowerCase()

  if (status === 404 || code.includes('model_not_found') || /model .*(not found|does not exist|has been deprecated)/i.test(message)) {
    return new OpenAIError('model_not_found', status, message)
  }
  if (status === 401 || code.includes('invalid_api_key')) return new OpenAIError('auth', status, message)
  if (status === 429 && (code.includes('insufficient_quota') || /quota|billing/i.test(message))) {
    return new OpenAIError('quota', status, message)
  }
  return new OpenAIError('other', status, message)
}

const AVISO_CHAT = 0
const AVISO_PREFIJO = '⚠️aviso:'

async function yaAvisadoHoy(tipo: string): Promise<boolean> {
  const { startIso } = cancunDayBounds(cancunYmd())
  const { data, error } = await createServerClient()
    .from('bot_preguntas')
    .select('id')
    .eq('chat_id', AVISO_CHAT)
    .eq('pregunta', `${AVISO_PREFIJO}${tipo}`)
    .gte('created_at', startIso)
    .limit(1)
  if (error) {
    console.error(`[openai-aviso] no pude leer bot_preguntas: ${error.message}`)
    return false
  }
  return (data?.length ?? 0) > 0
}

async function marcarAvisado(tipo: string, texto: string): Promise<void> {
  const { error } = await createServerClient().from('bot_preguntas').insert({
    chat_id: AVISO_CHAT,
    pregunta: `${AVISO_PREFIJO}${tipo}`,
    respuesta: texto,
    modelo: 'aviso',
  })
  if (error) console.error(`[openai-aviso] no pude marcar el aviso: ${error.message}`)
}

/**
 * Sends the warning for this kind of failure to every allowed chat, once per
 * Cancún day. `modelo` is the model that failed (for model_not_found).
 */
export async function avisarOpenAI(err: OpenAIError, modelo: string): Promise<void> {
  let texto: string
  switch (err.kind) {
    case 'model_not_found':
      texto = modelo.startsWith('whisper')
        ? `⚠️ El modelo ${modelo} ya no existe. Hay que actualizarlo en src/lib/asistente/whisper.ts.`
        : `⚠️ El modelo ${modelo} ya no existe. Cambia LLM_MODEL en Vercel.`
      break
    case 'auth':
      texto = `⚠️ OpenAI: la key no es válida (${err.message}). Revisa saldo/key.`
      break
    case 'quota':
      texto = `⚠️ OpenAI: sin saldo o tope mensual alcanzado (${err.message}). Revisa saldo/key.`
      break
    default:
      return
  }
  const clave = err.kind === 'model_not_found' ? `${err.kind}:${modelo}` : err.kind
  try {
    if (await yaAvisadoHoy(clave)) return
    await marcarAvisado(clave, texto)
    for (const chat of allowedChatIds()) {
      try {
        await sendTelegram(chat, texto, { tag: 'openai-aviso' })
      } catch {
        /* logged by sendTelegram */
      }
    }
  } catch (e) {
    console.error(`[openai-aviso] ${String(e)}`)
  }
}
