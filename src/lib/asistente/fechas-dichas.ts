// Ajuste 16c: "el viernes 14" when Friday is the 13th. She speaks fast and the
// number slips; the weekday is what she plans around. When the two disagree
// by a few days, the weekday wins and Gabita says so in one line — instead
// of silently filing everything on Saturday.

import { addDays } from './cancun'

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const NOMBRE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function dow(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay()
}

export interface FechaCorregida {
  /** The date the number alone points to (what the model tends to pick). */
  mala: string
  /** The date of the weekday she said. */
  buena: string
  aviso: string
}

/** Every "weekday + number" of the message where the two disagree by 3 days or less. */
export function fechasQueNoCuadran(texto: string, hoy: string): FechaCorregida[] {
  const plano = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const out: FechaCorregida[] = []
  const re = /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\s+(?:dia\s+)?(\d{1,2})\b(?!\s*(?::|am\b|pm\b|a\.m|p\.m|horas?\b|h\b))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(plano))) {
    const d = DIAS.indexOf(m[1])
    const n = Number(m[2])
    if (n < 1 || n > 31) continue
    // "hoy martes 11": today's own name is not a plan for next week.
    const esHoy = /\bhoy\s*$/.test(plano.slice(0, m.index))
    let buena = hoy
    if (!(esHoy && dow(hoy) === d)) {
      buena = addDays(hoy, 1)
      while (dow(buena) !== d) buena = addDays(buena, 1)
    }
    // The day N of this month, or of the next one when it already passed.
    const [y, mes] = hoy.split('-').map(Number)
    const hoyN = Number(hoy.slice(8, 10))
    const base = n >= hoyN ? Date.UTC(y, mes - 1, n) : Date.UTC(y, mes, n)
    const mala = new Date(base).toISOString().slice(0, 10)
    if (Number(mala.slice(8, 10)) !== n) continue // 31 in a 30-day month
    if (dow(mala) === d) continue // they agree (maybe a later week): nothing to fix
    const lejos = Math.abs((Date.parse(mala) - Date.parse(buena)) / 86_400_000)
    if (lejos > 3) continue // not a slip: leave it to her
    if (out.some((x) => x.mala === mala && x.buena === buena)) continue
    const nb = Number(buena.slice(8, 10))
    out.push({ mala, buena, aviso: `📅 Dijiste ${NOMBRE[d]} ${n}, pero el ${NOMBRE[d]} es ${nb}: lo puse el ${NOMBRE[d]} ${nb}.` })
  }
  return out
}

/** Moves every `fecha` that fell on the wrong date to the weekday she said. Returns the lines to tell her. */
export function corregirFechas<T extends object>(acciones: T[], texto: string, hoy: string): string[] {
  const avisos: string[] = []
  for (const c of fechasQueNoCuadran(texto, hoy)) {
    let toco = false
    for (const a of acciones as { fecha?: unknown }[]) {
      if (a.fecha === c.mala) {
        a.fecha = c.buena
        toco = true
      }
    }
    if (toco) avisos.push(c.aviso)
  }
  return avisos
}
