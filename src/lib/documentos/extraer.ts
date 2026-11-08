// Fase 14: getting the words out of what she sends.
//   · PDF with a text layer → pdf-parse (no network, no cost).
//   · A photo, a screenshot, or a scanned PDF (text layer empty) → the
//     model reads the image and types out what it sees.
// Whatever comes out is the `texto` of the row, which is what the Postgres
// search looks at later. Nothing here ever throws: a document with no text
// is still a document (she can write the title herself).

import { clasificarErrorOpenAI, avisarOpenAI } from '@/lib/asistente/openai-avisos'
import { mensajeError } from '@/lib/errores'
import { esImagen, esPdf } from './tipos'

/** Enough to find anything; the column is text, but the prompt has a budget. */
export const MAX_TEXTO = 60_000
export const TIMEOUT_VISION_MS = 45_000

export interface Extraccion {
  texto: string
  paginas: number | null
  /** 'pdf' = text layer · 'vision' = the model read the image · 'ninguno' = nothing came out. */
  via: 'pdf' | 'vision' | 'ninguno'
}

/** The model that reads images. Vision is a different job from the interpreter, so it has its own var. */
export function modeloVision(): string {
  return (process.env.LLM_MODEL_VISION ?? process.env.LLM_MODEL ?? 'gpt-5-mini').trim()
}

function recortar(s: string): string {
  const limpio = s.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return limpio.length > MAX_TEXTO ? `${limpio.slice(0, MAX_TEXTO)}\n…(recortado)` : limpio
}

/** A PDF's text layer. Returns empty text for a scan (no layer) — the caller then tries vision. */
export async function textoDePdf(bytes: ArrayBuffer): Promise<{ texto: string; paginas: number | null }> {
  try {
    // The package's index.js runs a debug read of a test file when it thinks
    // it is the main module; the lib entry point skips that.
    const mod = await import('pdf-parse/lib/pdf-parse.js')
    const pdfParse = ((mod as unknown as { default?: unknown }).default ?? mod) as (b: Buffer) => Promise<{ text: string; numpages: number }>
    const r = await pdfParse(Buffer.from(bytes))
    return { texto: recortar(String(r?.text ?? '')), paginas: Number.isFinite(r?.numpages) ? r.numpages : null }
  } catch (err) {
    console.error(`[documentos] pdf-parse: ${mensajeError(err)}`)
    return { texto: '', paginas: null }
  }
}

const PROMPT_VISION =
  'Eres un lector de documentos. Te doy la foto o el escaneo de un documento (contrato, póliza, factura, recibo, identificación). ' +
  'Escribe TODO el texto que ves, en el orden en que aparece, tal cual, sin resumir ni comentar nada. ' +
  'Conserva números, fechas, montos, nombres propios y los nombres de empresas exactamente como están. ' +
  'Si una parte está borrosa o no se lee, escribe [ilegible]. No agregues nada que no esté en la imagen.'

/** The model types out what the image says. Empty string on any failure (never throws). */
export async function textoDeImagen(bytes: ArrayBuffer, tipo: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    console.error('[documentos] vision: OPENAI_API_KEY no está definida')
    return ''
  }
  const modelo = modeloVision()
  const dataUrl = `data:${tipo};base64,${Buffer.from(bytes).toString('base64')}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_VISION_MS)
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: modelo,
        max_completion_tokens: 4000,
        messages: [
          { role: 'system', content: PROMPT_VISION },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe este documento completo.' },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
      }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const err = clasificarErrorOpenAI(res.status, json)
      console.error(`[documentos] vision error (${err.kind}): ${err.message}`)
      await avisarOpenAI(err, modelo)
      return ''
    }
    const texto = recortar(String(json?.choices?.[0]?.message?.content ?? ''))
    console.log(`[documentos] vision ok · ${modelo} · ${bytes.byteLength} bytes · ${texto.length} chars`)
    return texto
  } catch (err) {
    console.error(`[documentos] vision: ${mensajeError(err)}`)
    return ''
  } finally {
    clearTimeout(timer)
  }
}

/** A scan is a PDF whose text layer is basically empty. */
export function pareceEscaneo(texto: string, paginas: number | null): boolean {
  const utiles = texto.replace(/\s+/g, '').length
  return utiles < 40 * Math.max(1, paginas ?? 1)
}

/**
 * One file → its text. A PDF with no text layer falls back to vision over
 * its first page only when it is one page (rasterizing is not available
 * here); otherwise it keeps whatever little it found and says so.
 */
export async function extraerTexto(bytes: ArrayBuffer, tipo: string): Promise<Extraccion> {
  if (esPdf(tipo)) {
    const { texto, paginas } = await textoDePdf(bytes)
    if (texto && !pareceEscaneo(texto, paginas)) return { texto, paginas, via: 'pdf' }
    return { texto, paginas, via: texto ? 'pdf' : 'ninguno' }
  }
  if (esImagen(tipo)) {
    const texto = await textoDeImagen(bytes, tipo)
    return { texto, paginas: 1, via: texto ? 'vision' : 'ninguno' }
  }
  return { texto: '', paginas: null, via: 'ninguno' }
}
