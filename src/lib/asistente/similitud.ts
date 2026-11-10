// Fase 7-G: "never duplicate". Before creating a task from a sentence, look
// for an open task that is really the same thing: title similarity ≥ 0.75
// (Dice over character bigrams, accents and case out) or a shared SPECIFIC
// keyword ("marketing", "Jobescape", "Chelsea": a word of 5+ letters that is
// not generic — "asistente", "equipo", "curso" match nothing).
//
// Ajuste 7-G (2 nov): one open task pairs with ONE line of a plan, the most
// similar one; the other lines create new tasks. The same keywords decide
// whether a message "named" a task, tolerating how Whisper splits or
// misspells a name ("Job Escape", "Jobscape" still name «Jobescape»).

import { normalizar } from './acciones'

/**
 * Words that never identify a task on their own: function words, days,
 * verbs of ordering, and the generic nouns Gabby uses for everything. Kept
 * in code on purpose — add here when a false match shows up in the log.
 */
export const GENERICAS = new Set([
  // function words / pronouns
  'para', 'con', 'sin', 'sobre', 'desde', 'hasta', 'entre', 'como', 'cuando', 'donde', 'porque', 'pero', 'aunque',
  'este', 'esta', 'esto', 'estos', 'estas', 'ese', 'esa', 'eso', 'esos', 'esas', 'aquel', 'aquella', 'mismo', 'misma',
  'otros', 'otras', 'otro', 'otra', 'algo', 'alguien', 'nadie', 'nunca', 'siempre', 'ahora', 'luego', 'despues', 'antes',
  'tambien', 'todavia', 'entonces', 'mucho', 'mucha', 'poco', 'poca', 'cada', 'todo', 'todos', 'todas', 'junto', 'hacia',
  'nuestro', 'nuestra', 'ellos', 'ellas', 'ustedes', 'nosotros', 'mios', 'mias',
  // verbs that describe the order, not the thing
  'hacer', 'tengo', 'tiene', 'tienen', 'quiero', 'quiere', 'puede', 'pueden', 'necesito', 'empezar', 'seguir', 'probar',
  'mandar', 'enviar', 'llamar', 'revisar', 'pasar', 'armar', 'cancelar', 'pagar', 'hablar', 'escribir', 'terminar',
  'preparar', 'buscar', 'ver', 'checar', 'avisar', 'agendar', 'organizar', 'contestar', 'responder', 'subir', 'bajar',
  // time words
  'manana', 'semana', 'viernes', 'lunes', 'martes', 'miercoles', 'jueves', 'sabado', 'domingo', 'tarde', 'noche',
  // generic nouns
  'tarea', 'tareas', 'cosa', 'cosas', 'pendiente', 'pendientes', 'asistente', 'equipo', 'curso', 'cursos',
  'correo', 'correos', 'reunion', 'propuesta', 'cliente', 'clientes', 'proyecto', 'nuevo', 'nueva', 'mensaje', 'mensajes',
  'llamada', 'junta', 'cita', 'pago', 'pagos', 'factura', 'facturas', 'documento', 'documentos', 'archivo', 'archivos',
  // tools she uses for every client: never the identity of a task (ajuste 16c)
  'google', 'quickbooks', 'keywords', 'estrategia', 'reporte', 'cashflow',
  'suscripcion', 'cuenta', 'cuentas', 'persona', 'personas', 'gente', 'lista', 'nota', 'notas', 'plan', 'planes',
])

function bigramas(s: string): Map<string, number> {
  const t = s.replace(/[^a-z0-9ñ]+/g, ' ').trim()
  const m = new Map<string, number>()
  for (const w of t.split(' ')) {
    const x = ` ${w} `
    for (let i = 0; i < x.length - 1; i++) {
      const b = x.slice(i, i + 2)
      m.set(b, (m.get(b) ?? 0) + 1)
    }
  }
  return m
}

/** Dice coefficient over character bigrams, 0..1. */
export function similitud(a: string, b: string): number {
  const A = bigramas(normalizar(a))
  const B = bigramas(normalizar(b))
  let inter = 0
  let na = 0
  let nb = 0
  for (const [k, v] of Array.from(A.entries())) {
    na += v
    inter += Math.min(v, B.get(k) ?? 0)
  }
  for (const v of Array.from(B.values())) nb += v
  return na + nb === 0 ? 0 : (2 * inter) / (na + nb)
}

function tokens(s: string): string[] {
  return normalizar(s).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter(Boolean)
}

/** Specific words of a title: 5+ letters and not generic. */
export function palabrasClave(s: string): string[] {
  return Array.from(new Set(tokens(s).filter((w) => w.length >= 5 && !GENERICAS.has(w))))
}

/** How alike two single words must be to count as the same name ("jobscape" ~ "jobescape"). */
export const UMBRAL_PALABRA = 0.75

/**
 * Is the keyword in this text? Exact token, a token that is almost it
 * (typo), or the text with its spaces removed containing it ("Job Escape").
 */
export function claveEn(clave: string, texto: string): boolean {
  const ts = tokens(texto)
  if (ts.includes(clave)) return true
  if (ts.some((w) => w.length >= 5 && similitud(w, clave) >= UMBRAL_PALABRA)) return true
  return ts.join('').includes(clave)
}

/** The first keyword of `a` that `b` also carries, or null. */
export function claveComun(a: string, b: string): string | null {
  return palabrasClave(a).find((k) => claveEn(k, b)) ?? palabrasClave(b).find((k) => claveEn(k, a)) ?? null
}

/** Acronyms that are a kind of work, not whose work it is. */
const SIGLAS_DE_OFICIO = new Set(['SEO', 'GEO', 'GHL', 'QB', 'CRM', 'API', 'SDK', 'PDF', 'IA', 'AI', 'SQL', 'KPI', 'FB', 'IG', 'GL', 'BL'])

/** The names a title carries: acronyms as written ("PTHO", "TOTT", "CPT", "IM"), minus the ones that are a kind of work. */
export function nombresDe(s: string): string[] {
  return Array.from(new Set((s.match(/\b[A-ZÑ][A-ZÑ0-9]{1,6}\b/g) ?? []).filter((w) => !SIGLAS_DE_OFICIO.has(w))))
}

/** True when both titles name someone and share none of the names ("… PTHO" vs "… TOTT"). */
export function nombresDistintos(a: string, b: string): boolean {
  const A = nombresDe(a)
  const B = nombresDe(b)
  if (A.length === 0 || B.length === 0) return false
  return !A.some((x) => B.includes(x))
}

export const UMBRAL_SIMILITUD = 0.75

export interface Parecida<T> {
  tarea: T
  score: number
  /** Why: "similar 0.82" or "palabra clave «jobescape»". */
  motivo: string
}

/**
 * Every open task that could be "the same" as `titulo`, best first: similar
 * titles (≥ 0.75), then tasks sharing a specific keyword (only when that
 * keyword points to a single task, or to the most similar of them, ≥ 0.3).
 */
export function candidatasParecidas<T extends { text: string }>(titulo: string, abiertas: T[]): Parecida<T>[] {
  const similares: Parecida<T>[] = []
  const porClave: Parecida<T>[] = []
  for (const t of abiertas) {
    // Ajuste 16c: "Google Ads PTHO" is not «Shift Google Ads»: two different names, two tasks.
    if (nombresDistintos(titulo, t.text)) continue
    const s = similitud(titulo, t.text)
    if (s >= UMBRAL_SIMILITUD) {
      similares.push({ tarea: t, score: s, motivo: `similar ${s.toFixed(2)}` })
      continue
    }
    const comun = claveComun(titulo, t.text)
    if (comun) porClave.push({ tarea: t, score: s, motivo: `palabra clave «${comun}»` })
  }
  similares.sort((a, b) => b.score - a.score)
  if (porClave.length === 1) return [...similares, porClave[0]]
  if (porClave.length > 1) {
    porClave.sort((a, b) => b.score - a.score)
    return [...similares, ...porClave.filter((p) => p.score >= 0.3)]
  }
  return similares
}

/** The open task that is "the same" as `titulo`, or null. */
export function buscarParecida<T extends { text: string }>(titulo: string, abiertas: T[]): Parecida<T> | null {
  return candidatasParecidas(titulo, abiertas)[0] ?? null
}

/**
 * Several new titles against the open tasks, one task per title at most:
 * the pair with the highest similarity is taken first, then the next among
 * what is left. Returns the match for each title index (missing = new task).
 * `ocupadas` are tasks the plan already touches by ref: never matched.
 */
export function emparejarParecidas<T extends { id: string; text: string }>(
  titulos: string[],
  abiertas: T[],
  ocupadas: Set<string> = new Set()
): Map<number, Parecida<T>> {
  const libres = abiertas.filter((t) => !ocupadas.has(t.id))
  const pares: { i: number; p: Parecida<T>; peso: number }[] = []
  titulos.forEach((titulo, i) => {
    const claves = palabrasClave(titulo)
    for (const p of candidatasParecidas(titulo, libres)) {
      // A similar title beats a keyword match. Among keyword matches, the
      // line whose specific words are all in the task wins ("armar el
      // equipo de marketing" → «Marketing Team» before "zip de marketing y
      // ventas"); a tie goes to the line said first.
      const porClave = claves.length > 0 ? claves.filter((k) => claveEn(k, p.tarea.text)).length / claves.length : 0
      pares.push({ i, p, peso: p.motivo.startsWith('similar') ? 10 + p.score : porClave })
    }
  })
  pares.sort((a, b) => b.peso - a.peso || a.i - b.i)
  const out = new Map<number, Parecida<T>>()
  const usadas = new Set<string>()
  for (const { i, p } of pares) {
    if (out.has(i) || usadas.has(p.tarea.id)) continue
    out.set(i, p)
    usadas.add(p.tarea.id)
  }
  return out
}

/**
 * Did the message name this task? Its whole title, or one of its specific
 * keywords (tolerating a split or misspelled name), or nothing to go on.
 */
export function nombradaEn(titulo: string, mensaje: string): boolean {
  const msg = normalizar(mensaje)
  if (msg.includes(normalizar(titulo))) return true
  return palabrasClave(titulo).some((k) => claveEn(k, mensaje))
}
