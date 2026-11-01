// Fase 7-G: "never duplicate". Before creating a task from a sentence, look
// for an open task that is really the same thing: title similarity ≥ 0.6
// (Dice over character bigrams, accents and case out) or a shared keyword
// ("marketing", "Jobescape", "Chelsea": a distinctive word of 5+ letters).

import { normalizar } from './acciones'

const STOP = new Set([
  'para', 'con', 'sin', 'sobre', 'desde', 'hasta', 'entre', 'como', 'cuando', 'donde', 'porque', 'pero', 'aunque',
  'este', 'esta', 'esto', 'estos', 'estas', 'ese', 'esa', 'eso', 'esos', 'esas', 'aquel', 'aquella',
  'tarea', 'tareas', 'cosa', 'cosas', 'hacer', 'tengo', 'tiene', 'tienen', 'quiero', 'todo', 'todos', 'todas',
  'mandar', 'enviar', 'llamar', 'revisar', 'pasar', 'armar', 'cancelar', 'pagar', 'hablar', 'escribir', 'terminar',
  'manana', 'semana', 'viernes', 'lunes', 'martes', 'miercoles', 'jueves', 'sabado', 'domingo', 'pendiente', 'pendientes',
  'correo', 'correos', 'reunion', 'propuesta', 'cliente', 'clientes', 'proyecto', 'equipo', 'nuevo', 'nueva',
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

/** Distinctive words of a title: 5+ letters, not a stopword, not a plain verb. */
export function palabrasClave(s: string): string[] {
  return Array.from(new Set(normalizar(s).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter((w) => w.length >= 5 && !STOP.has(w))))
}

export const UMBRAL_SIMILITUD = 0.6

export interface Parecida<T> {
  tarea: T
  score: number
  /** Why: "similar 0.72" or "palabra clave «jobescape»". */
  motivo: string
}

/**
 * The open task that is "the same" as `titulo`, or null. A shared keyword
 * wins when it points to exactly one task, or to the most similar one if it
 * is at least loosely similar (≥ 0.3).
 */
export function buscarParecida<T extends { text: string }>(titulo: string, abiertas: T[]): Parecida<T> | null {
  const claves = palabrasClave(titulo)
  let mejor: Parecida<T> | null = null
  const porClave: Parecida<T>[] = []
  for (const t of abiertas) {
    const s = similitud(titulo, t.text)
    if (s >= UMBRAL_SIMILITUD && (!mejor || s > mejor.score)) mejor = { tarea: t, score: s, motivo: `similar ${s.toFixed(2)}` }
    const suyas = palabrasClave(t.text)
    const comun = claves.find((k) => suyas.includes(k))
    if (comun) porClave.push({ tarea: t, score: s, motivo: `palabra clave «${comun}»` })
  }
  if (mejor) return mejor
  if (porClave.length === 1) return porClave[0]
  if (porClave.length > 1) {
    const top = porClave.sort((a, b) => b.score - a.score)[0]
    if (top.score >= 0.3) return top
  }
  return null
}
