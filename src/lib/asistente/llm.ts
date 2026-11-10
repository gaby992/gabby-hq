// One call, one answer. The provider and model come from env vars only:
//   LLM_PROVIDER = openai (default) | anthropic
//   LLM_MODEL    = gpt-5-mini (default) | any model id of that provider
// Switching to Anthropic is: set LLM_PROVIDER=anthropic, LLM_MODEL=claude-…,
// add ANTHROPIC_API_KEY, redeploy. No code changes.
//
// When OpenAI retires LLM_MODEL, one retry goes to LLM_MODEL_FALLBACK
// (default gpt-4o-mini) and Telegram gets a once-a-day warning.

import { OpenAIError, avisarOpenAI, clasificarErrorOpenAI } from './openai-avisos'
import { redactar } from '@/lib/errores'

/** 'compatible' = any OpenAI-compatible chat endpoint (fase 6: JEV for mail) at its own base URL + key. */
export type LlmProvider = 'openai' | 'anthropic' | 'compatible'

/** Where one call goes. `preguntarLlm` builds it from the env; mail and the evaluator pass their own. */
export interface LlmTarget {
  provider: LlmProvider
  model: string
  baseUrl?: string
  apiKey?: string
}

export interface LlmResult {
  text: string
  provider: LlmProvider
  model: string
  tokensIn: number
  tokensOut: number
  ms: number
}

export class LlmError extends Error {}

export function llmConfig(): { provider: 'openai' | 'anthropic'; model: string; fallback: string } {
  const provider = (process.env.LLM_PROVIDER ?? 'openai').trim().toLowerCase()
  if (provider !== 'openai' && provider !== 'anthropic') {
    // Never echo the value: it may be a key pasted into the wrong variable.
    throw new LlmError('LLM_PROVIDER inválido (usa openai o anthropic)')
  }
  const model = (process.env.LLM_MODEL ?? 'gpt-5-mini').trim()
  const fallback = (process.env.LLM_MODEL_FALLBACK ?? 'gpt-4o-mini').trim()
  return { provider, model, fallback }
}

/**
 * Fase 6: the mail classifier has its own provider, independent of
 * /pregunta: LLM_PROVIDER_CORREO (openai | anthropic | compatible),
 * LLM_MODEL_CORREO, and for "compatible" LLM_CORREO_BASE_URL +
 * LLM_CORREO_API_KEY. Unset → the same model /pregunta uses.
 */
export function llmConfigCorreo(): LlmTarget {
  const provider = (process.env.LLM_PROVIDER_CORREO ?? process.env.LLM_PROVIDER ?? 'openai').trim().toLowerCase()
  if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'compatible') {
    // Never echo the value (ajuste 6-1: a key once ended up here and went out to Telegram).
    throw new LlmError('LLM_PROVIDER_CORREO inválido (usa openai, anthropic o compatible)')
  }
  const model = (process.env.LLM_MODEL_CORREO ?? process.env.LLM_MODEL ?? 'gpt-5-mini').trim()
  return { provider, model, baseUrl: process.env.LLM_CORREO_BASE_URL?.trim() || undefined, apiKey: process.env.LLM_CORREO_API_KEY?.trim() || undefined }
}

/**
 * "openai:gpt-5-mini" / "anthropic:claude-haiku-5-5" / "compatible:jev-1" /
 * a bare model id (provider guessed from the name) → where to send it.
 * "compatible" always uses LLM_CORREO_BASE_URL + LLM_CORREO_API_KEY.
 */
export function parsearModelo(spec: string): LlmTarget {
  const s = spec.trim()
  const m = s.match(/^(openai|anthropic|compatible):(.+)$/i)
  const provider = (m ? m[1].toLowerCase() : /^claude/i.test(s) ? 'anthropic' : /^(gpt|o\d)/i.test(s) ? 'openai' : 'compatible') as LlmProvider
  const model = (m ? m[2] : s).trim()
  if (!model) throw new LlmError('modelo vacío')
  return provider === 'compatible'
    ? { provider, model, baseUrl: process.env.LLM_CORREO_BASE_URL?.trim() || undefined, apiKey: process.env.LLM_CORREO_API_KEY?.trim() || undefined }
    : { provider, model }
}

export function nombreModelo(t: LlmTarget): string {
  return `${t.provider}:${t.model}`
}

interface Opts {
  maxTokens: number
  timeoutMs: number
  /** Ask for a JSON object (OpenAI json mode; Anthropic relies on the prompt). */
  json?: boolean
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new LlmError(`timeout tras ${timeoutMs / 1000}s`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function openai(model: string, system: string, user: string, o: Opts, compatible?: { baseUrl?: string; apiKey?: string }) {
  const key = compatible ? compatible.apiKey : process.env.OPENAI_API_KEY
  if (!key) throw new LlmError(compatible ? 'LLM_CORREO_API_KEY no está definida' : 'OPENAI_API_KEY no está definida')
  if (compatible && !compatible.baseUrl) throw new LlmError('LLM_CORREO_BASE_URL no está definida')
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    // `max_tokens` is rejected by the gpt-5 / o-series models; this name works everywhere.
    max_completion_tokens: o.maxTokens,
  }
  // Reasoning models would otherwise spend the whole budget thinking and
  // return an empty answer. Older models reject the field, so only add it
  // where it applies.
  if (/^(gpt-5|o\d)/i.test(model)) body.reasoning_effort = 'minimal'
  // A compatible endpoint may not know json mode or max_completion_tokens: the prompt asks for JSON instead.
  if (o.json && !compatible) body.response_format = { type: 'json_object' }
  if (compatible) {
    delete body.max_completion_tokens
    body.max_tokens = o.maxTokens
  }

  const base = (compatible?.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetchWithTimeout(
    `${base}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    },
    o.timeoutMs
  )
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    if (compatible) throw new LlmError(redactar(String(json?.error?.message ?? json?.message ?? `endpoint compatible HTTP ${res.status}`)))
    // Fase 16: the newest models may only exist on the Responses API. OpenAI
    // says so in the error itself; when it does, the same question goes there.
    if (/v1\/responses|responses api/i.test(String(json?.error?.message ?? ''))) return openaiResponses(model, system, user, o, key)
    throw clasificarErrorOpenAI(res.status, json)
  }
  return {
    text: String(json?.choices?.[0]?.message?.content ?? '').trim(),
    tokensIn: Number(json?.usage?.prompt_tokens ?? 0),
    tokensOut: Number(json?.usage?.completion_tokens ?? 0),
  }
}

/** The same call through POST /v1/responses, for models that are not on chat/completions. */
async function openaiResponses(model: string, system: string, user: string, o: Opts, key: string) {
  const res = await fetchWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, instructions: system, input: user, max_output_tokens: o.maxTokens }),
    },
    o.timeoutMs
  )
  const json = await res.json().catch(() => null)
  if (!res.ok) throw clasificarErrorOpenAI(res.status, json)
  // `output_text` is the convenience field; the structured form is output[].content[].text.
  const partes: string[] = []
  if (typeof json?.output_text === 'string') partes.push(json.output_text)
  else if (Array.isArray(json?.output)) {
    for (const item of json.output as { type?: string; content?: { type?: string; text?: string }[] }[]) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue
      for (const c of item.content) if (typeof c?.text === 'string') partes.push(c.text)
    }
  }
  return {
    text: partes.join('').trim(),
    tokensIn: Number(json?.usage?.input_tokens ?? 0),
    tokensOut: Number(json?.usage?.output_tokens ?? 0),
  }
}

async function anthropic(model: string, system: string, user: string, o: Opts) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new LlmError('ANTHROPIC_API_KEY no está definida')
  const res = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: o.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    },
    o.timeoutMs
  )
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new LlmError(redactar(String(json?.error?.message ?? `Anthropic HTTP ${res.status}`)))
  const text = Array.isArray(json?.content)
    ? json.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
    : ''
  return {
    text: text.trim(),
    tokensIn: Number(json?.usage?.input_tokens ?? 0),
    tokensOut: Number(json?.usage?.output_tokens ?? 0),
  }
}

/** One call to an explicit target (fase 6: mail classifier, model evaluation). No fallback, no warnings. */
export async function llamarLlm(t: LlmTarget, system: string, user: string, o: Opts): Promise<LlmResult> {
  const t0 = Date.now()
  const r = t.provider === 'anthropic'
    ? await anthropic(t.model, system, user, o)
    : await openai(t.model, system, user, o, t.provider === 'compatible' ? { baseUrl: t.baseUrl, apiKey: t.apiKey } : undefined)
  return { ...r, provider: t.provider, model: t.model, ms: Date.now() - t0 }
}

export async function preguntarLlm(system: string, user: string, o: Opts): Promise<LlmResult> {
  const { provider, model, fallback } = llmConfig()
  const t0 = Date.now()
  if (provider === 'anthropic') {
    const r = await anthropic(model, system, user, o)
    return { ...r, provider, model, ms: Date.now() - t0 }
  }

  try {
    const r = await openai(model, system, user, o)
    return { ...r, provider, model, ms: Date.now() - t0 }
  } catch (err) {
    if (!(err instanceof OpenAIError)) throw err
    // Key or credit problems: warn (once a day) and give up — a fallback
    // model would hit the same wall.
    if (err.kind !== 'model_not_found' || fallback === model) {
      await avisarOpenAI(err, model)
      throw err
    }
    console.warn(`[llm] ${model} no existe (${err.message}); reintento con ${fallback}`)
    await avisarOpenAI(err, model)
    try {
      const r = await openai(fallback, system, user, o)
      return { ...r, provider, model: fallback, ms: Date.now() - t0 }
    } catch (err2) {
      if (err2 instanceof OpenAIError) await avisarOpenAI(err2, fallback)
      throw err2
    }
  }
}
