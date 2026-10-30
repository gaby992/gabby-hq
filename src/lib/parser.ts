// One parser for everything that reaches the bot as text — typed or
// transcribed from a voice note. It never touches the database: it gets the
// list of companies and today's date and returns what it understood plus what
// is still missing, so the webhook can save or ask.
//
// Understood forms (all case-insensitive, pieces can come in any order):
//   urgente/normal/cuando [empresa] tarea [importante] [hoy|mañana|para el viernes|due friday]
//   para <empresa>: tarea            (also without the colon)
//   tarea … <empresa>  /  tarea … hoy   (company or date at the end — voice says it that way)
//   radar <descripción>
//   /pregunta <…>  /  ? <pregunta>  /  ¿…?  /  pregunta <…>   (answered by the LLM)
//   /ayuda / ayuda / help / formato / /start

import type { Company, Priority } from '@/types'
import { addDays } from '@/lib/asistente/cancun'

export interface TareaParsed {
  text: string
  priority: Priority | null
  company_id: string | null
  company_name: string | null
  importante: boolean
  due_date: string | null
}

export type Faltante = 'empresa' | 'urgencia'

export type Parsed =
  | { kind: 'ayuda' }
  | { kind: 'pregunta'; texto: string }
  | { kind: 'radar'; titulo: string }
  | { kind: 'tarea'; tarea: TareaParsed }

type CompanyRef = Pick<Company, 'id' | 'name'>

// Weekday tokens (es + en) → day-of-week index (Sun = 0).
const WEEKDAYS: Record<string, number> = {
  domingo: 0, sunday: 0,
  lunes: 1, monday: 1,
  martes: 2, tuesday: 2,
  miercoles: 3, 'miércoles': 3, wednesday: 3,
  jueves: 4, thursday: 4,
  viernes: 5, friday: 5,
  sabado: 6, 'sábado': 6, saturday: 6,
}
const WEEKDAY_ALT = Object.keys(WEEKDAYS).join('|')
const DAY_TOKEN = `hoy|today|mañana|manana|tomorrow|${WEEKDAY_ALT}`

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tidy(s: string): string {
  return s.replace(/\s{2,}/g, ' ').replace(/^[\s:,.\-–]+|[\s:,.\-–]+$/g, '').trim()
}

// Run between extraction steps: removing ", urgente" from the end leaves a
// dangling comma that would otherwise hide the "mañana" right before it.
function norm(s: string): string {
  return s.replace(/\s{2,}/g, ' ').replace(/^[\s,;]+|[\s,.;!]+$/g, '')
}

function dowOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function resolveDay(token: string, today: string): string | null {
  const t = token.toLowerCase()
  if (t === 'hoy' || t === 'today') return today
  if (t === 'mañana' || t === 'manana' || t === 'tomorrow') return addDays(today, 1)
  if (t in WEEKDAYS) {
    // Naming a weekday always means the NEXT one: "para el lunes" said on a
    // Monday is next Monday, not today. Today has its own tokens.
    const diff = (WEEKDAYS[t] - dowOf(today) + 7) % 7 || 7
    return addDays(today, diff)
  }
  return null
}

// ── Pieces ──────────────────────────────────────────────────────────────

function takePriority(text: string): { priority: Priority | null; text: string } {
  // At the start, the classic form.
  let m = text.match(/^(urgente|normal|cuando(?:\s+pueda)?)\b\s*/i)
  if (m) {
    const p = m[1].toLowerCase().startsWith('cuando') ? 'cuando' : (m[1].toLowerCase() as Priority)
    return { priority: p, text: text.slice(m[0].length) }
  }
  // Anywhere else — voice tends to put it at the end ("… llamar a Juan, urgente").
  // Bare "cuando" is a normal Spanish word, so only "cuando pueda" counts here.
  m = text.match(/\b(urgente|cuando\s+pueda|normal)\b/i)
  if (m) {
    const p = m[1].toLowerCase().startsWith('cuando') ? 'cuando' : (m[1].toLowerCase() as Priority)
    return { priority: p, text: text.replace(m[0], ' ') }
  }
  return { priority: null, text }
}

function takeCompany(text: string, companies: CompanyRef[]): { company: CompanyRef | null; text: string } {
  if (companies.length === 0) return { company: null, text }
  // Longest names first so "PD Studio" wins over "PD".
  const sorted = [...companies].sort((a, b) => b.name.length - a.name.length)
  const names = sorted.map((c) => escapeRe(c.name.trim())).join('|')
  const find = (name: string) => sorted.find((c) => c.name.trim().toLowerCase() === name.toLowerCase()) ?? null

  // "para IM: …" / "para IM …" / "para la empresa IM" — stripped from the title.
  let m = text.match(new RegExp(`(?:^|\\s)para\\s+(?:la\\s+|el\\s+)?(?:empresa\\s+)?(${names})\\b:?`, 'i'))
  if (m) return { company: find(m[1]), text: text.replace(m[0], ' ') }
  // At the start ("IM llamar a Juan") or at the end ("llamar a Juan, IM").
  m = text.match(new RegExp(`^(${names})\\b:?`, 'i')) ?? text.match(new RegExp(`[\\s,]+(${names})\\s*[.!]?$`, 'i'))
  if (m) return { company: find(m[1]), text: text.replace(m[0], ' ') }
  // In the middle: use it, but keep the title intact — "regalo personal"
  // should not lose a word.
  m = text.match(new RegExp(`\\b(${names})\\b`, 'i'))
  if (m) return { company: find(m[1]), text }
  return { company: null, text }
}

function takeImportante(text: string): { importante: boolean; text: string } {
  const re = /\b(?:importante|important)\b/gi
  if (!re.test(text)) return { importante: false, text }
  return { importante: true, text: text.replace(re, ' ') }
}

function takeDueDate(text: string, today: string): { due_date: string | null; text: string } {
  // "para (el) viernes", "due friday", "para mañana".
  let m = text.match(new RegExp(`\\b(?:due|para)(?:\\s+el)?\\s+(${DAY_TOKEN})\\b`, 'i'))
  if (m) {
    const d = resolveDay(m[1], today)
    if (d) return { due_date: d, text: text.replace(m[0], ' ') }
  }
  // Bare "hoy" / "mañana" as the LAST word ("urgente IM shift Google Ads hoy")
  // or the first one ("hoy llamar a Juan"). In the middle it stays: that's a
  // sentence, not a date ("avisar que hoy no voy" is the title).
  m = text.match(/[\s,]+(hoy|mañana|manana|today|tomorrow)\s*[.!]?$/i) ?? text.match(/^(hoy|mañana|manana|today|tomorrow)\b[\s,]*/i)
  if (m) {
    const d = resolveDay(m[1], today)
    if (d) return { due_date: d, text: text.replace(m[0], ' ') }
  }
  return { due_date: null, text }
}

// ── Entry point ─────────────────────────────────────────────────────────

export function parseMensaje(raw: string, companies: CompanyRef[], today: string): Parsed {
  const text = raw.trim()
  const lower = text.toLowerCase()

  if (/^(?:\/start|\/help|\/ayuda|ayuda|help|formato)\b/i.test(lower)) return { kind: 'ayuda' }
  if (/^[?¿]/.test(text) || /^\/?pregunta\b/i.test(text)) {
    // Keep the question as asked (its "¿…?" included) — only drop the trigger.
    // "? qué cerré ayer" → "qué cerré ayer"; "¿qué tengo hoy?" stays whole.
    const texto = /^¿/.test(text) ? text : tidy(text.replace(/^\?+|^\/?pregunta\b/i, ''))
    return { kind: 'pregunta', texto }
  }
  const radar = text.match(/^radar\b\s*([\s\S]*)$/i)
  if (radar) return { kind: 'radar', titulo: tidy(radar[1]) }

  let rest = norm(text)
  const p = takePriority(rest); rest = norm(p.text)
  const c = takeCompany(rest, companies); rest = norm(c.text)
  const i = takeImportante(rest); rest = norm(i.text)
  const d = takeDueDate(rest, today); rest = norm(d.text)

  return {
    kind: 'tarea',
    tarea: {
      text: tidy(rest),
      priority: p.priority,
      company_id: c.company?.id ?? null,
      company_name: c.company?.name.trim() ?? null,
      // Same rule as the forms and the matrix: urgente implies ★.
      importante: i.importante || p.priority === 'urgente',
      due_date: d.due_date,
    },
  }
}

/** What the bot still has to ask before it can save. Order = order of questions. */
export function faltantes(t: TareaParsed): Faltante[] {
  const out: Faltante[] = []
  if (!t.company_id) out.push('empresa')
  if (!t.priority) out.push('urgencia')
  return out
}

/** /ayuda — eight lines, everything the bot understands. */
export const AYUDA = [
  '📝 Tarea: urgente/normal/cuando [empresa] tarea [importante] [hoy · mañana · para el viernes]',
  '↳ También "para IM: tarea" o la empresa/urgencia al final; si falta algo, te pregunto con botones',
  '🎤 Voz: mándame un audio (máx 2 min) y lo entiendo igual que el texto',
  '📅 pasa 2,5 · pasa todo: mueve a mañana lo numerado en la última alarma',
  '❓ /pregunta ¿qué tengo hoy? (o empieza con ? o ¿): te contesto con tus tareas y notas',
  '💡 radar <idea>: la guarda en Radar',
  '⏰ Alarmas: ☀️ 8:00 am y 🌙 6:00 pm, lunes a sábado',
  '🏢 Empresas: IM · DATAVIA · PD · Personal · Chelsea',
].join('\n')
