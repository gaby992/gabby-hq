// What the assistant knows when it answers a question: today's picture, the
// week, what was closed recently, the "por dónde iba" notes and Chelsea's
// mail count — as plain text, grouped by company, capped at ~3000 tokens.
//
// NEVER includes `tasks.notes`: that column carries email bodies
// ("Ref: gmail:…") and must not leave the database.

import { createServerClient } from '@/lib/supabase-server'
import type { Company, NotaEmpresa, Priority } from '@/types'
import { CHELSEA_COMPANY_NAME } from '@/lib/chelsea'
import { CANCUN_TZ, addDays, cancunDayBounds, cancunYmd, daysBetween, formatVenceEs } from './cancun'
import { countChelseaMail } from './alarmas'

/** Only these columns are read — `notes` is deliberately absent. */
interface TaskLite {
  id: string
  text: string
  priority: Priority
  importante: boolean
  due_date: string | null
  company_id: string | null
  completed_at: string | null
}

const EMPRESAS_ORDEN = ['IM', 'DATAVIA', 'PD', 'Personal', CHELSEA_COMPANY_NAME]
const SIN_EMPRESA = 'Sin empresa'

// ~4 chars per token in Spanish: 12 000 chars ≈ 3 000 tokens.
const MAX_CHARS = 12_000
const MAX_NOTA_CHARS = 1_200
const MAX_ITEMS = 30

const PRIORITY_RANK: Record<Priority, number> = { urgente: 0, normal: 1, cuando: 2 }

function companiesInOrder(companies: Company[]): Company[] {
  const fixed: Company[] = []
  for (const wanted of EMPRESAS_ORDEN) {
    const c = companies.find((x) => x.name.trim().toLowerCase() === wanted.toLowerCase())
    if (c) fixed.push(c)
  }
  const rest = companies.filter((c) => !fixed.includes(c)).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return [...fixed, ...rest]
}

function byUrgency(a: TaskLite, b: TaskLite): number {
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
  if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
}

function tags(t: TaskLite, today: string): string {
  const out: string[] = []
  if (t.due_date) {
    if (t.due_date < today) {
      const d = daysBetween(t.due_date, today)
      out.push(`vencida hace ${d} ${d === 1 ? 'día' : 'días'} (${formatVenceEs(t.due_date)})`)
    } else if (t.due_date === today) out.push('vence hoy')
    else out.push(`vence ${formatVenceEs(t.due_date)}`)
  } else out.push('sin fecha')
  out.push(t.priority + (t.importante ? ' ★' : ''))
  return out.join(' · ')
}

function esDeHoy(t: TaskLite, today: string): boolean {
  if (t.due_date && t.due_date <= today) return true
  return t.priority === 'urgente' || t.importante
}

function cap<T>(items: T[]): { items: T[]; extra: number } {
  return { items: items.slice(0, MAX_ITEMS), extra: Math.max(0, items.length - MAX_ITEMS) }
}

function nowCancun(now: Date): string {
  const f = new Intl.DateTimeFormat('es-MX', {
    timeZone: CANCUN_TZ,
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return f.format(now)
}

export interface Contexto {
  text: string
  /** Rough size, for the logs. */
  chars: number
}

export async function construirContexto(now: Date = new Date()): Promise<Contexto> {
  const today = cancunYmd(now)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const domingo = addDays(today, (7 - dow) % 7)
  const hace7 = cancunDayBounds(addDays(today, -7)).startIso

  const db = createServerClient()
  const cols = 'id, text, priority, importante, due_date, company_id, completed_at'
  const [openRes, doneRes, companiesRes, notasRes, chelseaMail] = await Promise.all([
    db.from('tasks').select(cols).eq('done', false),
    db.from('tasks').select(cols).eq('done', true).gte('completed_at', hace7).order('completed_at', { ascending: false }),
    db.from('companies').select('*'),
    db.from('notas_empresa').select('*'),
    countChelseaMail(),
  ])
  if (openRes.error) throw new Error(`Supabase tasks: ${openRes.error.message}`)
  if (doneRes.error) throw new Error(`Supabase tasks (hechas): ${doneRes.error.message}`)
  if (companiesRes.error) throw new Error(`Supabase companies: ${companiesRes.error.message}`)
  if (notasRes.error) throw new Error(`Supabase notas_empresa: ${notasRes.error.message}`)

  const open = (openRes.data as TaskLite[]) ?? []
  const done = (doneRes.data as TaskLite[]) ?? []
  const companies = (companiesRes.data as Company[]) ?? []
  const notas = (notasRes.data as NotaEmpresa[]) ?? []

  const lines: string[] = [
    `Fecha y hora actual (Cancún): ${nowCancun(now)}`,
    `Hoy es ${today}. "Esta semana" termina el domingo ${domingo}.`,
    '',
  ]

  const sections = [
    ...companiesInOrder(companies).map((c) => ({ id: c.id as string | null, name: c.name.trim() })),
    { id: null, name: SIN_EMPRESA },
  ]

  for (const s of sections) {
    const mine = open.filter((t) => t.company_id === s.id)
    const hoy = mine.filter((t) => esDeHoy(t, today)).sort(byUrgency)
    const semana = mine
      .filter((t) => !esDeHoy(t, today) && t.due_date && t.due_date > today && t.due_date <= domingo)
      .sort(byUrgency)
    const cerradas = done.filter((t) => t.company_id === s.id)
    const nota = s.id ? notas.find((n) => n.company_id === s.id)?.nota?.trim() : null
    const isChelsea = s.name.toLowerCase() === CHELSEA_COMPANY_NAME.toLowerCase()

    if (!nota && hoy.length === 0 && semana.length === 0 && cerradas.length === 0 && !isChelsea) continue

    lines.push(`== ${s.name} ==`)
    if (nota) {
      const recortada = nota.length > MAX_NOTA_CHARS ? nota.slice(0, MAX_NOTA_CHARS) + ' […]' : nota
      lines.push(`Por dónde iba: ${recortada}`)
    }
    const h = cap(hoy)
    lines.push(`Hoy (${hoy.length}):` + (hoy.length === 0 ? ' nada' : ''))
    for (const t of h.items) lines.push(`- ${t.text} [${tags(t, today)}]`)
    if (h.extra > 0) lines.push(`- (+${h.extra} más)`)
    if (semana.length > 0) {
      const w = cap(semana)
      lines.push(`Resto de la semana (${semana.length}):`)
      for (const t of w.items) lines.push(`- ${t.text} [${tags(t, today)}]`)
      if (w.extra > 0) lines.push(`- (+${w.extra} más)`)
    }
    if (cerradas.length > 0) {
      const c = cap(cerradas)
      lines.push(`Cerradas en los últimos 7 días (${cerradas.length}):`)
      for (const t of c.items) {
        const d = t.completed_at ? daysBetween(cancunYmd(new Date(t.completed_at)), today) : null
        const cuando = d === null ? '' : d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`
        lines.push(`- ${t.text}${cuando ? ` [cerrada ${cuando}]` : ''}`)
      }
      if (c.extra > 0) lines.push(`- (+${c.extra} más)`)
    }
    if (isChelsea) {
      lines.push(
        chelseaMail === null
          ? 'Correos pendientes de Chelsea en inbox-IM: no disponible ahora'
          : `Correos pendientes de Chelsea en inbox-IM: ${chelseaMail}`
      )
    }
    lines.push('')
  }

  let text = lines.join('\n').trim()
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n[contexto recortado por tamaño]'
  return { text, chars: text.length }
}
