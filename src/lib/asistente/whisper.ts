// Voice note → text, through OpenAI's transcription endpoint (whisper-1).
// Plain fetch + FormData: no SDK, no new dependency.

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'

/** Telegram voice notes are .ogg/opus; whisper-1 accepts them as-is. */
export const MAX_AUDIO_SECONDS = 120

// Spanish with the odd English word: the prompt seeds the vocabulary so
// company names and marketing jargon come back spelled right.
const PROMPT =
  'Nota de voz en español, a veces con palabras en inglés. Empresas: IM, DATAVIA, PD, Personal, Chelsea. ' +
  'Términos: SEO, Google Ads, Shift, deck, follow up, urgente, importante, radar.'

export class WhisperError extends Error {}

export async function transcribirAudio(bytes: ArrayBuffer, filename: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new WhisperError('OPENAI_API_KEY no está definida')

  const form = new FormData()
  form.append('file', new Blob([bytes]), filename)
  form.append('model', 'whisper-1')
  form.append('language', 'es')
  form.append('prompt', PROMPT)
  form.append('response_format', 'json')

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const reason = json?.error?.message ?? `HTTP ${res.status}`
    console.error(`[voz] whisper error: ${reason}`)
    throw new WhisperError(reason)
  }
  const text = String(json?.text ?? '').trim()
  console.log(`[voz] whisper ok · ${filename} · ${bytes.byteLength} bytes · ${text.length} chars`)
  return text
}
