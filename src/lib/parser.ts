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
//   nota IM: texto  /  nota IM + línea  /  nota IM:        (replace / append / delete)
//   listo 3  /  listo 2,5  /  listo paypal                  (complete, by alarm number or title)
//   pasa 2,5  /  pasa todo  /  pasa paypal                  (move to tomorrow)
//   borra 3  /  borra paypal                                (delete, always confirmed with buttons)
//   nota en paypal: texto                                   (append a dated line to that task's notes)
//   paypal para el viernes / paypal urgente / paypal es de PD   (edit an existing task)
//   /pregunta <…>  /  ? <pregunta>  /  ¿…?  /  pregunta <…>   (answered by the LLM)
//   mis alarmas  /  quita alarma 2                           (fase 4 reminders)
//   /ayuda / ayuda / help / formato / /start
// Anything else ("1 terminado / 9 cancelar", "alarma mañana 3pm revisar X")
// is free text: the webhook sends it to the LLM interpreter first and only
// falls back to the `edicion` / `tarea` result below when the model fails.

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

export type NotaModo = 'reemplazar' | 'agregar' | 'borrar'

export interface NotaParsed {
  company_id: string | null
  company_name: string | null
  modo: NotaModo
  texto: string
}

export type Accion = 'pasa' | 'listo' | 'borra' | 'nota_tarea' | 'editar'

/** What "paypal urgente" / "paypal para el viernes" / "paypal es de PD" want to change. */
export interface Cambios {
  priority?: Priority
  importante?: boolean
  due_date?: string
  company_id?: string
  company_name?: string
}

export type Parsed =
  | { kind: 'ayuda' }
  | { kind: 'alarmas' }
  | { kind: 'quitar_alarma'; arg: string }
  | { kind: 'pregunta'; texto: string }
  | { kind: 'radar'; titulo: string }
  | { kind: 'nota'; nota: NotaParsed }
  | { kind: 'accion'; accion: Accion; arg: string }
  | { kind: 'nota_tarea'; termino: string; texto: string }
  /** Title + trailing modifier(s). If no open task matches `termino`, `fallback` is the new task to create. */
  | { kind: 'edicion'; termino: string; cambios: Cambios; fallback: TareaParsed }
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

// "nota IM: …" / "nota IM + …" / "nota IM:" — company first, then the mode.
// Voice says "más" for "+", so that works too right after the company.
function parseNota(rest: string, companies: CompanyRef[]): NotaParsed {
  let company: CompanyRef | null = null
  let body = rest.trim()
  if (companies.length > 0) {
    const sorted = [...companies].sort((a, b) => b.name.length - a.name.length)
    const names = sorted.map((c) => escapeRe(c.name.trim())).join('|')
    const m = body.match(new RegExp(`^(${names})\\b\\s*([\\s\\S]*)$`, 'i'))
    if (m) {
      company = sorted.find((c) => c.name.trim().toLowerCase() === m[1].toLowerCase()) ?? null
      body = m[2].trim()
    }
  }
  const base = { company_id: company?.id ?? null, company_name: company?.name.trim() ?? null }
  let m = body.match(/^(?:\+|más\b)\s*([\s\S]*)$/i)
  if (m) return { ...base, modo: 'agregar', texto: m[1].trim() }
  m = body.match(/^:\s*([\s\S]*)$/)
  if (m) {
    const texto = m[1].trim()
    return { ...base, modo: texto ? 'reemplazar' : 'borrar', texto }
  }
  return { ...base, modo: 'reemplazar', texto: body }
}

// "paypal urgente" / "paypal para el viernes" / "paypal es de PD": the title
// first, then one or more modifiers at the very end. Only the trailing
// position counts — "urgente IM llamar a Juan" (modifier first) always creates.
function parseEdicion(text: string, companies: CompanyRef[], today: string): { termino: string; cambios: Cambios } | null {
  let rest = norm(text)
  const cambios: Cambios = {}
  let found = true
  while (found) {
    found = false
    let m = rest.match(/^(.+?)[\s,]+(urgente|normal|cuando\s+pueda)$/i)
    if (m && cambios.priority === undefined) {
      const p = m[2].toLowerCase().startsWith('cuando') ? 'cuando' : (m[2].toLowerCase() as Priority)
      cambios.priority = p
      if (p === 'urgente') cambios.importante = true
      rest = norm(m[1]); found = true; continue
    }
    m = rest.match(new RegExp(`^(.+?)[\\s,]+(?:para|due)(?:\\s+el)?\\s+(${DAY_TOKEN})$`, 'i')) ??
        rest.match(/^(.+?)[\s,]+(hoy|mañana|manana|today|tomorrow)$/i)
    if (m && cambios.due_date === undefined) {
      const d = resolveDay(m[2], today)
      if (d) { cambios.due_date = d; rest = norm(m[1]); found = true; continue }
    }
    if (companies.length > 0 && cambios.company_id === undefined) {
      const sorted = [...companies].sort((a, b) => b.name.length - a.name.length)
      const names = sorted.map((c) => escapeRe(c.name.trim())).join('|')
      m = rest.match(new RegExp(`^(.+?)[\\s,]+(?:es|va|pasa|cambia)\\s+(?:de|a|para)\\s+(${names})$`, 'i'))
      if (m) {
        const c = sorted.find((x) => x.name.trim().toLowerCase() === m![2].toLowerCase())
        if (c) { cambios.company_id = c.id; cambios.company_name = c.name.trim(); rest = norm(m[1]); found = true; continue }
      }
    }
  }
  if (Object.keys(cambios).length === 0) return null
  const termino = tidy(rest)
  // A bare modifier ("urgente") or a word-long term is a new task, not an edit.
  if (termino.length < 3) return null
  return { termino, cambios }
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
  const notaTarea = text.match(/^nota\s+en\s+([^:]+?)\s*:\s*([\s\S]*)$/i)
  if (notaTarea) return { kind: 'nota_tarea', termino: tidy(notaTarea[1]), texto: tidy(notaTarea[2]) }
  const nota = text.match(/^nota\b\s*([\s\S]*)$/i)
  if (nota) return { kind: 'nota', nota: parseNota(nota[1], companies) }
  if (/^(?:mis\s+)?alarmas\s*[.!?]?$/i.test(text)) return { kind: 'alarmas' }
  const quitar = text.match(/^(?:quita|quitar|borra|borrar|elimina|cancela)\s+(?:la\s+)?alarma\s+([\s\S]+)$/i)
  if (quitar) return { kind: 'quitar_alarma', arg: tidy(quitar[1]) }
  const accion = text.match(/^(pasa|listo|borra)\b\s*([\s\S]*)$/i)
  if (accion) return { kind: 'accion', accion: accion[1].toLowerCase() as Accion, arg: tidy(accion[2]) }

  const edicion = /^(urgente|normal|cuando|para)\b/i.test(text) ? null : parseEdicion(text, companies, today)

  let rest = norm(text)
  const p = takePriority(rest); rest = norm(p.text)
  const c = takeCompany(rest, companies); rest = norm(c.text)
  const i = takeImportante(rest); rest = norm(i.text)
  const d = takeDueDate(rest, today); rest = norm(d.text)

  const tarea: TareaParsed = {
    text: tidy(rest),
    priority: p.priority,
    company_id: c.company?.id ?? null,
    company_name: c.company?.name.trim() ?? null,
    // Same rule as the forms and the matrix: urgente implies ★.
    importante: i.importante || p.priority === 'urgente',
    due_date: d.due_date,
  }
  if (edicion) return { kind: 'edicion', termino: edicion.termino, cambios: edicion.cambios, fallback: tarea }
  return { kind: 'tarea', tarea }
}

/** What the bot still has to ask before it can save. Order = order of questions. */
export function faltantes(t: TareaParsed): Faltante[] {
  const out: Faltante[] = []
  if (!t.company_id) out.push('empresa')
  if (!t.priority) out.push('urgencia')
  return out
}

/** /ayuda — five short sections, at most 16 lines. */
export function ayuda(modelo: string): string {
  return [
    '💬 HÁBLAME NORMAL: "el 3 ya está", "pasa el 5 al lunes", "9 cancelar, no se va a hacer", "alarma mañana 9am revisar X" · varias órdenes en un mensaje y te muestro el plan antes de hacerlo',
    '📥 AGREGAR',
    'urgente/normal/cuando [empresa] tarea [importante] [hoy · mañana · para el viernes] · o "para IM: tarea"',
    '🎤 Por voz igual (máx 2 min) · 💡 radar <idea> · si falta algo, te pregunto con botones',
    '✅ CERRAR / MOVER',
    'listo 3 · listo paypal (completa) · pasa 2,5 · pasa todo · pasa paypal (a mañana) · borra 3 · borra paypal',
    'paypal para el viernes · paypal urgente · paypal es de PD (cambia fecha, urgencia o empresa)',
    '🗒 NOTAS',
    'nota IM: texto (reemplaza) · nota IM + línea (agrega) · nota IM: (borra)',
    'nota en paypal: texto (la agrega al pie de esa tarea, con fecha)',
    '❓ PREGUNTAR',
    '/pregunta ¿qué tengo hoy? (o empieza con ? o ¿) · te contesto con tus tareas y notas',
    '⏰ ALARMAS PROPIAS (no son tareas)',
    'alarma mañana 3pm revisar pagos · recuérdame el viernes a las 10 llamar al contador · avísame en 2 horas X · mis alarmas · quita alarma 2',
    '⏰ Alarmas ☀️ 8:00 am y 🌙 6:00 pm, lun–sáb · 🏢 IM · DATAVIA · PD · Personal · Chelsea',
    `🤖 Modelo actual: ${modelo}`,
  ].join('\n')
}
