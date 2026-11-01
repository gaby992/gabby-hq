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
//   qué sigue / qué hago primero / solo urgentes / qué vence esta semana / qué sigue de IM   (fase 4b)
//   /hoy · dame la lista · lista completa · todo lo pendiente   →  the 8:00 list, now   (fase 4c)
//   cierre · lista de la tarde                                 →  the 6:00 pm list, now
//   Dates: hoy · mañana · pasado mañana · el viernes · para el viernes · en 3 días · el 15 de noviembre · due friday
//   Hours (fase 5): mañana 3pm · el viernes a las 10 · due friday 2pm · 15:00 · 3 de la tarde
//   "Agregar un task, whatsapp chelito, due date, mañana, compañía"  (fields dictated by voice)
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
  /** 'HH:MM' (24 h, Cancún). Shown everywhere; goes to Calendar only on request. */
  due_time?: string | null
  /** "y ponla en calendar": create the Calendar event too (fase 5-B). */
  calendar?: boolean
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
  /** 'HH:MM'; '' clears the hour. */
  due_time?: string
  company_id?: string
  company_name?: string
  /** "paypal mañana 3pm y ponla en calendar": also create the event (fase 5-B). */
  calendar?: boolean
}

export type ListaTipo = 'manana' | 'tarde' | 'pendientes'

export interface QueSigueOpts {
  empresa?: string | null
  solo_urgentes?: boolean
  solo_vencer?: boolean
}

export type Parsed =
  /** `larga`: "/ayuda todo" — the full guide (docs/comandos.md) in 2–3 messages. */
  | { kind: 'ayuda'; larga: boolean }
  /** "/start" / "hola": the presentation ("para empezar" of the master prompt). */
  | { kind: 'inicio' }
  /** Fase 7: "organízame" / "no sé por dónde empezar" → the guided session. */
  | { kind: 'organizar' }
  /** Fase 7: "olvida lo anterior" / "empecemos de nuevo" → clears the thread. */
  | { kind: 'olvidar' }
  | { kind: 'que_sigue'; opts: QueSigueOpts }
  /** Fase 4c: the 8:00 / 6:00 pm list, on demand; fase 4d: 'pendientes' + empresa = one company's full list. */
  | { kind: 'lista'; tipo: ListaTipo; empresa?: CompanyRef | null }
  /** Fase 5-B: "pon en calendar la de TOTT" → the open task whose title contains `termino`. */
  | { kind: 'calendar'; termino: string }
  /** Fase 5-C: recurring payments — the bot only LISTS them (they are managed in /settings). */
  | { kind: 'pagos'; empresa: CompanyRef | null; semana: boolean }
  /** "pago IM Vercel el 15" / "quita el pago …": managed in /settings only. */
  | { kind: 'pagos_web' }
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

const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6,
  julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9, octubre: 10, oct: 10,
  noviembre: 11, nov: 11, diciembre: 12, dic: 12,
}
const NUMEROS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7 }

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** "15 de noviembre" → this year's, or next year's if it already passed. */
function ymdDiaMes(dia: number, mes: number, today: string): string | null {
  if (dia < 1 || dia > 31) return null
  const y = Number(today.slice(0, 4))
  const mk = (yy: number) => `${yy}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  const candidate = mk(y)
  // Reject impossible dates (31 de febrero) by round-tripping through Date.
  const d = new Date(`${candidate}T12:00:00Z`)
  if (d.getUTCMonth() + 1 !== mes) return null
  return candidate < today ? mk(y + 1) : candidate
}

/**
 * The ONE date extractor, shared by the classic parser and the LLM
 * interpreter (fase 4c): finds the date phrase, resolves it and removes it
 * from the title. Forms, in order of precedence:
 *   pasado mañana · en N días / en una semana · el 15 de noviembre ·
 *   para (el) <día> / due <weekday> · el <día> (at the end) ·
 *   hoy / mañana / <día> as the last word, or hoy / mañana as the first.
 * "hoy"/"mañana" in the middle of a sentence stay ("avisar que hoy no voy").
 */
export function extraerFecha(text: string, today: string): { due_date: string | null; text: string } {
  const quitar = (m: RegExpMatchArray) => text.replace(m[0], ' ')

  let m = text.match(/(?:^|[\s,])(?:(?:para|due)\s+)?pasado\s+ma[ñn]ana\b\s*[.!]?/i)
  if (m) return { due_date: addDays(today, 2), text: quitar(m) }

  m = text.match(/(?:^|[\s,])(?:para\s+)?en\s+(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete)\s+(d[ií]as?|semanas?)\b\s*[.!]?/i)
  if (m) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : NUMEROS[sinAcentos(m[1])]
    if (n > 0) return { due_date: addDays(today, /^sem/i.test(m[2]) ? n * 7 : n), text: quitar(m) }
  }

  m = text.match(/(?:^|[\s,])(?:(?:para|due)\s+)?(?:el\s+)?(\d{1,2})\s+de\s+([a-záéíóú]+)\b\s*[.!]?/i)
  if (m && MESES[sinAcentos(m[2])]) {
    const d = ymdDiaMes(Number(m[1]), MESES[sinAcentos(m[2])], today)
    if (d) return { due_date: d, text: quitar(m) }
  }

  // "para (el) viernes", "due friday", "para mañana".
  m = text.match(new RegExp(`\\b(?:due|para)(?:\\s+el)?\\s+(${DAY_TOKEN})\\b\\s*[.!]?`, 'i'))
  if (m) {
    const d = resolveDay(m[1], today)
    if (d) return { due_date: d, text: quitar(m) }
  }
  // "… el viernes" at the end.
  m = text.match(new RegExp(`[\\s,]+el\\s+(${WEEKDAY_ALT})\\s*[.!]?$`, 'i'))
  if (m) {
    const d = resolveDay(m[1], today)
    if (d) return { due_date: d, text: quitar(m) }
  }
  // Bare "hoy" / "mañana" / "viernes" as the LAST word ("urgente IM shift Google Ads hoy")
  // or hoy/mañana as the first one ("hoy llamar a Juan"). In the middle it stays: that's a
  // sentence, not a date ("avisar que hoy no voy" is the title).
  m = text.match(new RegExp(`[\\s,]+(${DAY_TOKEN})\\s*[.!]?$`, 'i')) ?? text.match(/^(hoy|mañana|manana|today|tomorrow)\b[\s,]*/i)
  if (m) {
    const d = resolveDay(m[1], today)
    if (d) return { due_date: d, text: quitar(m) }
  }
  return { due_date: null, text }
}

/**
 * Fase 5: the hour, as 'HH:MM' (24 h), removed from the title. Needs a
 * marker so a bare number is never taken for a time ("llamar a 3 clientes"):
 *   a las 3 · a las 3:30 · 3pm · 3 pm · 15:00 · 3 de la tarde · 10 de la mañana · 8 de la noche · 14h
 * Without am/pm, 1–6 is afternoon and 7–12 is morning (office hours).
 */
export function extraerHora(text: string): { due_time: string | null; text: string } {
  const re = /(?:^|[\s,])(a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|hrs?\b|h\b|de\s+la\s+(?:ma[ñn]ana|tarde|noche))?(?=$|[\s,.!])/gi
  // The first number WITH a marker wins: "el 15 de noviembre a las 10" → 10.
  let m: RegExpExecArray | null = null
  for (const cand of Array.from(text.matchAll(re))) {
    if (cand[1] || cand[3] || cand[4]) { m = cand as RegExpExecArray; break }
  }
  if (!m) return { due_time: null, text }
  const [, , hh, mm, sufijo] = m
  let h = Number(hh)
  const min = Number(mm ?? '0')
  if (h > 24 || min > 59) return { due_time: null, text }
  const suf = sinAcentos(sufijo ?? '')
  if (/^p/.test(suf) || /tarde|noche/.test(suf)) { if (h < 12) h += 12 }
  else if (/^a\.?m/.test(suf) || /manana/.test(suf)) { if (h === 12) h = 0 }
  else if (!suf && h >= 1 && h <= 6) h += 12
  if (h === 24) h = 0
  return { due_time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, text: text.replace(m[0], ' ') }
}

function takeDueDate(text: string, today: string): { due_date: string | null; text: string } {
  return extraerFecha(text, today)
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
  // "paypal mañana 3pm": the hour goes with the date.
  const h = extraerHora(rest)
  if (h.due_time) { cambios.due_time = h.due_time; rest = norm(h.text) }
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
  if (Object.keys(cambios).length === 0 || (Object.keys(cambios).length === 1 && cambios.due_time)) return null
  const termino = tidy(rest)
  // A bare modifier ("urgente") or a word-long term is a new task, not an edit.
  if (termino.length < 3) return null
  return { termino, cambios }
}

// ── Entry point ─────────────────────────────────────────────────────────

// "¿qué sigue?", "qué hago primero", "qué es lo más urgente", "qué está por
// vencer", "solo urgentes", "qué vence esta semana", "qué sigue de IM".
function parseQueSigue(text: string, companies: CompanyRef[]): QueSigueOpts | null {
  const t = text.replace(/^[¿?¡!\s]+|[?!.\s]+$/g, '').replace(/^\/?pregunta\s+/i, '').toLowerCase()
  const n = t.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const opts: QueSigueOpts = {}
  let match = false
  if (/^(que|qué)\s+sigue\b/.test(n) || /^(que\s+)?(hago|toca)\s+(primero|ahora)\b/.test(n) || /^(que|cual)\s+es\s+lo\s+(mas\s+)?urgente\b/.test(n) || /^por\s+donde\s+(empiezo|arranco)\b/.test(n)) match = true
  if (/^solo\s+(lo\s+)?urgentes?\b/.test(n)) { match = true; opts.solo_urgentes = true }
  if (/^(que|cuales?)\s+(esta[n]?\s+por\s+vencer|vence[n]?)\b/.test(n) || /^por\s+vencer\b/.test(n)) { match = true; opts.solo_vencer = true }
  if (!match) return null
  const sorted = [...companies].sort((a, b) => b.name.length - a.name.length)
  for (const c of sorted) {
    const name = c.name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (new RegExp(`\\b(?:de|en|para|con)\\s+${escapeRe(name)}\\b`).test(n)) { opts.empresa = c.name.trim(); break }
  }
  return opts
}

// Fase 5-B: "… y ponla en calendar", "… y agrégala al calendario", "calendar: …",
// "… (en calendar)". Removed from the text; the flag travels in TareaParsed.
const CALENDAR_RE = /(?:^calendar:\s*|[\s,]+(?:y\s+)?(?:ponla|ponlo|ponerla|ponerlo|agr[ée]gala|agr[ée]galo|agregarla|agregarlo|m[ée]tela|m[ée]telo|anótala|anotala)\s+(?:en|al)\s+(?:el\s+)?(?:google\s+)?(?:calendar|calendario|agenda)\b\s*[.!]?|[\s,]+(?:en|al)\s+(?:google\s+)?(?:calendar|calendario)\s*[.!]?$)/i
export function extraerCalendar(text: string): { calendar: boolean; text: string } {
  const m = text.match(CALENDAR_RE)
  if (!m) return { calendar: false, text }
  return { calendar: true, text: text.replace(m[0], ' ') }
}

// Fase 5-C: payments, read-only from the bot:
//   pagos · pagos de IM · qué pagos hay esta semana · qué pagos vencen esta semana de PD
function findCompany(name: string, companies: CompanyRef[]): CompanyRef | null {
  const n = sinAcentos(name.trim())
  return companies.find((c) => sinAcentos(c.name.trim()) === n) ?? null
}
function parsePagos(text: string, companies: CompanyRef[]): Parsed | null {
  const n = sinAcentos(text.replace(/^[¿?¡!\s]+|[?!.\s]+$/g, '').trim())
  // Creating, changing or deleting a payment is web-only: say so instead of
  // letting "pago IM Vercel el 15" become a task.
  const empresas = companies.map((c) => escapeRe(sinAcentos(c.name.trim()))).join('|')
  const pagoDeEmpresa = empresas && new RegExp(`^pago\\s+(?:de\\s+)?(?:${empresas})\\b`).test(n)
  if (
    /^(?:(?:agrega|agregar|crea|crear|nuevo|pon|ponme)\s+(?:el\s+|un\s+)?pago\b|(?:quita|quitar|borra|borrar|elimina|cancela|cambia|cambiar|mueve|pasa)\s+(?:el\s+)?pago\b)/.test(n) ||
    (/^pago\s+/.test(n) && (pagoDeEmpresa || /\b(?:cada\s+mes|mensual|de\s+cada\s+mes|recurrente)\b/.test(n)))
  ) {
    return { kind: 'pagos_web' }
  }
  let m = n.match(/^(?:que|cuales)\s+pagos\s+(?:hay|tengo|vencen|tocan|caen|se\s+vencen)(?:\s+(?:esta|en\s+la)\s+semana)?(?:\s+de\s+(.+?))?(?:\s+(?:esta|en\s+la)\s+semana)?$/)
    ?? n.match(/^(?:mis\s+)?pagos\s+(?:de\s+)?(?:esta|la)\s+semana(?:\s+de\s+(.+))?$/)
  if (m) {
    const empresa = m[1] ? findCompany(m[1], companies) : null
    if (m[1] && !empresa) return null
    return { kind: 'pagos', empresa, semana: /semana/.test(n) }
  }
  m = n.match(/^(?:mis\s+)?pagos(?:\s+(?:recurrentes|mensuales))?(?:\s+de\s+(.+))?$/)
  if (m) {
    const empresa = m[1] ? findCompany(m[1], companies) : null
    if (m[1] && !empresa) return null
    return { kind: 'pagos', empresa, semana: false }
  }
  return null
}

// Fase 4c: the full list, now. "/hoy", "dame la lista", "la lista de la
// mañana", "lista completa", "todo lo pendiente" → the 8:00 message;
// "cierre", "lista de la tarde", "/cierre" → the 6:00 pm one.
function parseLista(text: string, companies: CompanyRef[]): { tipo: ListaTipo; empresa?: CompanyRef | null } | null {
  const n = sinAcentos(text.replace(/^[¿?¡!\s]+|[?!.\s]+$/g, ''))
  // Fase 4d: "/pendientes IM", "pendientes de IM", "todo lo pendiente de IM", "qué tengo pendiente de PD".
  const pend = n.match(/^\/?pendientes?(?:\s+(?:de\s+)?(.+))?$/)
    ?? n.match(/^(?:todo\s+)?lo\s+pendiente\s+(?:de|en)\s+(.+)$/)
    ?? n.match(/^(?:que|cuales)\s+(?:tengo|hay|queda)\s+pendientes?\s+(?:de|en)\s+(.+)$/)
  if (pend) {
    if (!pend[1]) return { tipo: 'manana' }
    const empresa = findCompany(pend[1], companies)
    if (empresa) return { tipo: 'pendientes', empresa }
    return null
  }
  if (/^\/?(hoy|lista)$/.test(n)) return { tipo: 'manana' }
  if (/^(dame|mandame|pasame|ponme|quiero|ver)\s+(la\s+)?lista(\s+(completa|de\s+(la\s+)?manana|de\s+hoy))?$/.test(n)) return { tipo: 'manana' }
  if (/^(la\s+)?lista\s+(completa|de\s+(la\s+)?manana|de\s+hoy)$/.test(n)) return { tipo: 'manana' }
  if (/^todo\s+lo\s+pendiente$/.test(n) || /^(que|cuales)\s+(son\s+)?(todas\s+)?(mis|las)\s+(tareas\s+)?pendientes$/.test(n)) return { tipo: 'manana' }
  if (/^\/?cierre(\s+del\s+dia)?$/.test(n) || /^(dame\s+|mandame\s+)?(el\s+|la\s+)?(cierre|lista\s+de\s+(la\s+)?tarde)$/.test(n)) return { tipo: 'tarde' }
  return null
}

// A voice note that DICTATES the fields as a comma-separated list:
// "Agregar un nuevo task, whatsapp, chelito, due date, mañana, compañía".
// The field words are not the title; what is left between them is.
const CAMPO_RE = /^(?:agregar?|agrega|añadir?|crear?|nuevo|nueva|un|una|task|tarea|tareas|titulo|título|due|date|fecha|vence|para|compañ[ií]a|company|empresa|prioridad|priority|urgencia)$/i
export function parseDictado(text: string, companies: CompanyRef[], today: string): TareaParsed | null {
  const partes = text.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean)
  if (partes.length < 3) return null
  const tieneCampo = partes.some((x) => /^(?:due\s*date|fecha|compañ[ií]a|company|empresa|task|tarea|prioridad)$/i.test(x) || /^(?:agregar?|agrega|crear?)\s+(?:un[a]?\s+)?(?:nuevo\s+|nueva\s+)?(?:task|tarea)\b/i.test(x))
  if (!tieneCampo) return null
  const base: TareaParsed = { text: '', priority: null, company_id: null, company_name: null, importante: false, due_date: null, due_time: null }
  const titulo: string[] = []
  for (const parte of partes) {
    const words = parte.split(/\s+/)
    if (words.every((w) => CAMPO_RE.test(w))) continue
    const d = resolveDay(parte.toLowerCase().replace(/^(?:el|para el|para)\s+/, ''), today)
    if (d) { base.due_date = base.due_date ?? d; continue }
    const hp = extraerHora(` ${parte}`)
    if (hp.due_time && !tidy(hp.text)) { base.due_time = hp.due_time; continue }
    const pm = parte.match(/^(urgente|normal|cuando(?:\s+pueda)?)$/i)
    if (pm) { base.priority = pm[1].toLowerCase().startsWith('cuando') ? 'cuando' : (pm[1].toLowerCase() as Priority); continue }
    const c = companies.find((x) => x.name.trim().toLowerCase() === parte.toLowerCase())
    if (c) { base.company_id = c.id; base.company_name = c.name.trim(); continue }
    if (/^importante$/i.test(parte)) { base.importante = true; continue }
    titulo.push(parte)
  }
  if (titulo.length === 0) return null
  base.text = tidy(titulo.join(' '))
  base.importante = base.importante || base.priority === 'urgente'
  if (!base.due_date) base.due_time = null
  return base
}

export function parseMensaje(raw: string, companies: CompanyRef[], today: string): Parsed {
  const text = raw.trim()
  const lower = text.toLowerCase()

  if (/^\/?comandos\b|^\/?(?:ayuda|help)\s+(?:todo|toda|larga|completa|full)\b/i.test(lower)) return { kind: 'ayuda', larga: true }
  if (/^\/start\b/i.test(lower) || /^(?:hola|buenas|buenos\s+d[ií]as|buenas\s+tardes|hey|hi)[\s!.,]*$/i.test(lower)) return { kind: 'inicio' }
  if (/^(?:\/help|\/ayuda|ayuda|help|formato)\b/i.test(lower)) return { kind: 'ayuda', larga: false }
  const n0 = sinAcentos(text.replace(/^[¿?¡!\s]+|[?!.\s]+$/g, ''))
  if (/^(?:olvida(?:te)?\s+(?:de\s+)?(?:lo\s+)?(?:anterior|todo|eso)|empecemos\s+de\s+nuevo|empezamos\s+de\s+nuevo|borron\s+y\s+cuenta\s+nueva|reinicia(?:r)?\s+(?:la\s+)?conversacion)$/.test(n0)) return { kind: 'olvidar' }
  if (/^(?:organizame|organiza(?:me)?\s+(?:mis\s+)?(?:pendientes|tareas|dia)|ayudame\s+con\s+(?:mis\s+)?(?:pendientes|tareas)|no\s+se\s+por\s+donde\s+empezar|estoy\s+abrumad[ao]|que\s+hago|ponme\s+en\s+orden|ordename)$/.test(n0)) return { kind: 'organizar' }
  const lista = parseLista(text, companies)
  if (lista) return { kind: 'lista', tipo: lista.tipo, empresa: lista.empresa ?? null }
  const pagos = parsePagos(text, companies)
  if (pagos) return pagos
  const calCmd = text.match(/^(?:pon|ponme|agrega|agr[ée]game|mete|m[ée]teme)\s+(?:en|al)\s+(?:el\s+)?(?:google\s+)?(?:calendar|calendario|agenda)\s+(?:la\s+(?:tarea\s+)?(?:de|del)\s+|la\s+|el\s+)?(.+)$/i)
    ?? text.match(/^calendar\s+(.+)$/i)
  if (calCmd && !/^calendar:/i.test(text)) return { kind: 'calendar', termino: tidy(calCmd[1]) }
  const qs = parseQueSigue(text, companies)
  if (qs) return { kind: 'que_sigue', opts: qs }
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
  // "nota IM: …" and, fase 4d, "por dónde iba IM: …" / "notas de IM: …": a note, never a task.
  const nota = text.match(/^nota\b\s*([\s\S]*)$/i)
    ?? text.match(/^(?:por\s+d[oó]nde\s+(?:iba|voy|vamos|ibamos|íbamos)|notas?\s+de)\s*:?\s*([\s\S]*)$/i)
  if (nota) return { kind: 'nota', nota: parseNota(nota[1], companies) }
  if (/^(?:mis\s+)?alarmas\s*[.!?]?$/i.test(text)) return { kind: 'alarmas' }
  const quitar = text.match(/^(?:quita|quitar|borra|borrar|elimina|cancela)\s+(?:la\s+)?alarma\s+([\s\S]+)$/i)
  if (quitar) return { kind: 'quitar_alarma', arg: tidy(quitar[1]) }
  const accion = text.match(/^(pasa|listo|borra)\b\s*([\s\S]*)$/i)
  if (accion) return { kind: 'accion', accion: accion[1].toLowerCase() as Accion, arg: tidy(accion[2]) }

  // "calendar: …" / "… y ponla en calendar" comes off first, whatever the form.
  const cal = extraerCalendar(text)
  const sinCal = norm(cal.text)

  const dictado = parseDictado(sinCal, companies, today)
  if (dictado) return { kind: 'tarea', tarea: { ...dictado, calendar: cal.calendar } }

  const edicion = /^(urgente|normal|cuando|para)\b/i.test(sinCal) ? null : parseEdicion(sinCal, companies, today)
  if (edicion && cal.calendar) edicion.cambios.calendar = true

  let rest = sinCal
  const p = takePriority(rest); rest = norm(p.text)
  const c = takeCompany(rest, companies); rest = norm(c.text)
  const i = takeImportante(rest); rest = norm(i.text)
  // Hour before date: "mañana 3pm" leaves "mañana" as the last word for the date rule.
  const h = extraerHora(rest); rest = norm(h.text)
  const d = takeDueDate(rest, today); rest = norm(d.text)

  const tarea: TareaParsed = {
    text: tidy(rest),
    priority: p.priority,
    company_id: c.company?.id ?? null,
    company_name: c.company?.name.trim() ?? null,
    // Same rule as the forms and the matrix: urgente implies ★.
    importante: i.importante || p.priority === 'urgente',
    due_date: d.due_date,
    // An hour without a date means nothing to the calendar.
    due_time: d.due_date ? h.due_time : null,
    calendar: cal.calendar,
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
    '💬 HÁBLAME NORMAL: "el 3 ya está", "pasa el 5 al lunes", "9 cancelar, no se va a hacer", "alarma mañana 9am revisar X" · varias órdenes en un mensaje y te muestro el plan antes de hacerlo · me acuerdo de lo último que hablamos ("sí", "la segunda", "lo mismo para PD") · "olvida lo anterior" limpia',
    '🧭 ORGANÍZAME · "no sé por dónde empezar" · "estoy abrumada" → repasamos tus pendientes uno por uno con botones (Hoy · Mañana · Esta semana · Cancelar · Delegar · Siguiente); "para" sale',
    '🎯 ¿QUÉ SIGUE? · "qué hago primero" · "solo urgentes" · "qué vence esta semana" · "qué sigue de IM" → una tarea para ahora, 3 después, 3 por vencer; luego "listo 1" / "pasa el segundo"',
    '📋 /hoy · "dame la lista" · "todo lo pendiente" → la lista completa de las 8:00, ahora · "cierre" → la de las 6:00 pm · /pendientes IM → solo esa empresa',
    '💳 PAGOS: "pagos de IM" · "qué pagos hay esta semana" (se administran en /settings → Pagos recurrentes)',
    '📥 AGREGAR',
    'urgente/normal/cuando [empresa] tarea [importante] [hoy · mañana · pasado mañana · el viernes · en 3 días · el 15 de nov] [3pm · a las 10] · "… y ponla en calendar" → también evento 📅 · "pon en calendar la de TOTT"',
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
    `📖 /ayuda todo → la guía completa con ejemplos · 🤖 Modelo actual: ${modelo}`,
  ].join('\n')
}
