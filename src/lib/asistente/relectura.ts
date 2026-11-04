// Ajuste 9c-1 (rule 4): "eso no son correos, son tareas", "no, me refería a
// los correos de PD", "no era eso: los correos" — a CORRECTION of how the
// bot read the previous message, not a new order. The bot admits the slip
// and tries again with the other reading. Pure text → what she meant; the
// engine (motor.ts) decides what to re-run with it.

export type Lectura = 'correos' | 'tareas'

export interface Relectura {
  /** What she meant, when the sentence says it ("son tareas", "los correos"). */
  lectura: Lectura | null
  /** The thing she points at after "me refería a" / "quise decir" / "mejor", if any — to be re-read as a message. */
  resto: string | null
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^[¿?¡!\s]+|[?!.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const RE_CORREOS = /\b(?:correos?|mails?|e-?mails?|buzon|bandeja)\b/
const RE_TAREAS = /\b(?:tareas?|pendientes|lista\s+de\s+tareas|lo\s+pendiente)\b/

function lecturaDe(fragmento: string): Lectura | null {
  const c = fragmento.search(RE_CORREOS)
  const t = fragmento.search(RE_TAREAS)
  if (c < 0 && t < 0) return null
  if (c < 0) return 'tareas'
  if (t < 0) return 'correos'
  // Both named ("no son correos, son tareas"): the one said LAST is what she meant.
  return c > t ? 'correos' : 'tareas'
}

/**
 * Null when the message is not a correction. The patterns are deliberately
 * narrow: they all start by denying ("no", "eso no", "no era", "te
 * equivocaste") or by restating ("me refería a", "quise decir").
 */
export function leerRelectura(texto: string): Relectura | null {
  const n = normalizar(texto)
  if (!n) return null
  const esCorreccion =
    /^(?:no[,;]?\s*)?(?:eso\s+no\s+(?:es|son|era|eran)|no\s+(?:es|son|era|eran)\s+eso|no\s+era\s+eso|te\s+(?:equivocaste|confundiste)|eso\s+no\b|no\s+(?:es|son|era|eran)\b|no[,;]?\s+(?:me\s+refer[ií]a|quise\s+decir|quer[ií]a\s+decir|mejor|pregunt[eé]|ped[ií]|dije))/.test(n) ||
    /^(?:me\s+refer[ií]a\s+a|quise\s+decir|quer[ií]a\s+decir|no[,;]?\s+(?:los?|las?)\s+(?:correos?|mails?|tareas?|pendientes))\b/.test(n) ||
    /^no[,;]\s+\S/.test(n)
  if (!esCorreccion) return null
  // What she restates, after the LAST "me refería a" / "quise decir" / "mejor": re-read as a message.
  const explicitos = Array.from(n.matchAll(/(?:me\s+refer[ií]a\s+a|quise\s+decir|quer[ií]a\s+decir|mejor)\s+(?:a\s+)?(.+)$/g))
  const resto = explicitos.length > 0 ? explicitos[explicitos.length - 1][1].trim() : null
  // What she meant: the mail/task word after the last "son" / "eran" / "sino" / restatement, else the last one in the sentence.
  const marcas = Array.from(n.matchAll(/(?:me\s+refer[ií]a\s+a|quise\s+decir|quer[ií]a\s+decir|mejor|sino(?:\s+a)?|\b(?:era|eran|es|son))\s+(.+)$/g))
  const lectura = (marcas.length > 0 ? lecturaDe(marcas[marcas.length - 1][1]) : null) ?? lecturaDe(n)
  // "no" + something that names neither mail nor tasks nor a restatement is an answer, not a re-reading.
  if (!lectura && !resto) return null
  return { lectura, resto: resto && resto.length >= 3 ? resto : null }
}
