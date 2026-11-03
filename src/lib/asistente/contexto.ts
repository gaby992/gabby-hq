// What the assistant knows when it answers a question: today's picture, the
// week, what was closed recently, the "por dónde iba" notes and the recent
// mail (fase 6) — as plain text, grouped by company, capped at ~3000 tokens.
//
// NEVER includes `tasks.notes`: that column carries email bodies
// ("Ref: gmail:…") and must not leave the database.

import { createServerClient } from '@/lib/supabase-server'
import type { Company, NotaEmpresa, Priority } from '@/types'
import { CHELSEA_COMPANY_NAME } from '@/lib/chelsea'
import { CANCUN_TZ, addDays, cancunDayBounds, cancunYmd, daysBetween, formatHoraEs, formatVenceEs } from './cancun'
import { correosRecientes, quienCorto } from '@/lib/correo/pendientes'
import { CORREO_ESTADO_LABELS } from '@/types'

/** Only these columns are read — `notes` is deliberately absent. */
interface TaskLite {
  id: string
  text: string
  priority: Priority
  importante: boolean
  due_date: string | null
  due_time: string | null
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
  // Fase 5: the hour, so "¿qué tengo a las 3?" can be answered.
  const hora = t.due_time ? ` a las ${formatHoraEs(t.due_time.slice(0, 5))}` : ''
  if (t.due_date) {
    if (t.due_date < today) {
      const d = daysBetween(t.due_date, today)
      out.push(`vencida hace ${d} ${d === 1 ? 'día' : 'días'} (${formatVenceEs(t.due_date)}${hora})`)
    } else if (t.due_date === today) out.push(`vence hoy${hora}`)
    else out.push(`vence ${formatVenceEs(t.due_date)}${hora}`)
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
  const cols = 'id, text, priority, importante, due_date, due_time, company_id, completed_at'
  const [openRes, doneRes, companiesRes, notasRes, correos] = await Promise.all([
    db.from('tasks').select(cols).eq('done', false),
    db.from('tasks').select(cols).eq('done', true).gte('completed_at', hace7).order('completed_at', { ascending: false }),
    db.from('companies').select('*'),
    db.from('notas_empresa').select('*'),
    // Fase 6: subject + summary + state of the last 7 days. NEVER the body.
    correosRecientes({ estados: ['nuevo', 'para_chelsea', 'lo_hago_yo', 'tarea', 'respondido', 'archivado'], dias: 7, max: 40 }),
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

    if (!nota && hoy.length === 0 && semana.length === 0 && cerradas.length === 0 && !(isChelsea && correos.some((m) => m.estado === 'para_chelsea'))) continue

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
        const fecha = t.completed_at ? cancunYmd(new Date(t.completed_at)) : null
        const d = fecha ? daysBetween(fecha, today) : null
        const cuando = d === null ? '' : d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`
        lines.push(`- ${t.text}${fecha ? ` [cerrada ${cuando}, ${formatVenceEs(fecha)}]` : ''}`)
      }
      if (c.extra > 0) lines.push(`- (+${c.extra} más)`)
    }
    if (isChelsea) {
      // Ajuste 6-0: Chelsea's mail is the `correos` table (para_chelsea), listed below — never inbox-IM.
      const suyos = correos.filter((m) => m.estado === 'para_chelsea').length
      lines.push(`Correos pasados a Chelsea sin responder: ${suyos} (ver == Correos ==)`)
    }
    lines.push('')
  }

  if (correos.length > 0) {
    lines.push(`== Correos (últimos 7 días, ${correos.length}) ==`)
    const c = cap(correos)
    for (const m of c.items) {
      const fecha = m.recibido_en ? formatVenceEs(cancunYmd(new Date(m.recibido_en))) : ''
      lines.push(`- ${quienCorto(m)} · «${m.asunto ?? '(sin asunto)'}»${m.resumen && m.resumen !== m.asunto ? `: ${m.resumen}` : ''} [${m.cuenta} · ${m.urgencia ?? '?'} · ${m.tipo ?? '?'} · ${CORREO_ESTADO_LABELS[m.estado].toLowerCase()}${fecha ? ` · ${fecha}` : ''}]`)
    }
    if (c.extra > 0) lines.push(`- (+${c.extra} más)`)
    lines.push('')
  }

  let text = lines.join('\n').trim()
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n[contexto recortado por tamaño]'
  return { text, chars: text.length }
}
