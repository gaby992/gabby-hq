// One call, one answer. The provider and model come from env vars only:
//   LLM_PROVIDER = openai (default) | anthropic
//   LLM_MODEL    = gpt-5-mini (default) | any model id of that provider
// Switching to Anthropic is: set LLM_PROVIDER=anthropic, LLM_MODEL=claude-…,
// add ANTHROPIC_API_KEY, redeploy. No code changes.

export type LlmProvider = 'openai' | 'anthropic'

export interface LlmResult {
  text: string
  provider: LlmProvider
  model: string
  tokensIn: number
  tokensOut: number
  ms: number
}

export class LlmError extends Error {}

export function llmConfig(): { provider: LlmProvider; model: string } {
  const provider = (process.env.LLM_PROVIDER ?? 'openai').trim().toLowerCase()
  if (provider !== 'openai' && provider !== 'anthropic') {
    throw new LlmError(`LLM_PROVIDER inválido: "${provider}" (usa openai o anthropic)`)
  }
  const model = (process.env.LLM_MODEL ?? 'gpt-5-mini').trim()
  return { provider, model }
}

interface Opts {
  maxTokens: number
  timeoutMs: number
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

async function openai(model: string, system: string, user: string, o: Opts) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new LlmError('OPENAI_API_KEY no está definida')
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

  const res = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    },
    o.timeoutMs
  )
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new LlmError(json?.error?.message ?? `OpenAI HTTP ${res.status}`)
  return {
    text: String(json?.choices?.[0]?.message?.content ?? '').trim(),
    tokensIn: Number(json?.usage?.prompt_tokens ?? 0),
    tokensOut: Number(json?.usage?.completion_tokens ?? 0),
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
  if (!res.ok) throw new LlmError(json?.error?.message ?? `Anthropic HTTP ${res.status}`)
  const text = Array.isArray(json?.content)
    ? json.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
    : ''
  return {
    text: text.trim(),
    tokensIn: Number(json?.usage?.input_tokens ?? 0),
    tokensOut: Number(json?.usage?.output_tokens ?? 0),
  }
}

export async function preguntarLlm(system: string, user: string, o: Opts): Promise<LlmResult> {
  const { provider, model } = llmConfig()
  const t0 = Date.now()
  const r = provider === 'anthropic' ? await anthropic(model, system, user, o) : await openai(model, system, user, o)
  return { ...r, provider, model, ms: Date.now() - t0 }
}
