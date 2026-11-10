// Fase 16: the week in blocks.
//
// Until now GabbyHQ knew WHAT she had to do, never WHEN she works on what.
// The plantilla (semana_bloques) is that missing half: every day has its
// blocks — Estudio, the 7:00 banks, Bloque A, Bloque B, the afternoon — each
// with what it is about, the routine that always happens there, and which
// tasks fall in it. Three places read it:
//   · the Resumen ("Hoy te toca"),
//   · the morning message,
//   · Gabita, to PROPOSE when something fits instead of asking.
// Everything here is pure except the two loaders, so the same day can be
// computed for today, for next Thursday, or in a test.

import { createServerClient } from '@/lib/supabase-server'
import type { Company, Task } from '@/types'
import { addDays, cancunYmd, formatHoraEs } from './cancun'
import { mensajeError } from '@/lib/errores'

export interface Bloque {
  id: string
  /** 0 = domingo … 6 = sábado. */
  dia: number
  /** 'HH:MM' */
  inicio: string
  fin: string
  nombre: string
  tema: string
  company_id: string | null
  palabras: string[]
  fijas: string[]
  toma_tareas: boolean
  bloqueado: boolean
  activo: boolean
}

export interface ReglaMes {
  id: string
  desde: number
  hasta: number
  inicio: string
  tema: string
  rotacion: string[]
  fijas: string[]
  activo: boolean
}

export interface Plantilla {
  bloques: Bloque[]
  reglas: ReglaMes[]
}

/** A task as a block shows it. */
export interface TareaEnBloque {
  id: string
  text: string
  empresa: string | null
  minutos: number
  /** True when the minutes are the default, not her estimate. */
  estimado: boolean
  vencida: boolean
  importante: boolean
}

/** One block of one concrete day, with what falls in it. */
export interface BloqueDelDia {
  id: string
  inicio: string
  fin: string
  nombre: string
  tema: string
  empresa: string | null
  fijas: string[]
  toma_tareas: boolean
  bloqueado: boolean
  /** How long the block is. */
  minutos: number
  tareas: TareaEnBloque[]
  /** Minutes the tasks ask for. */
  carga: number
  /** True when the tasks ask for more than the block has. */
  no_cabe: boolean
  /** True when a month rule changed this block today ("SEO/GEO del mes · hoy: Shift"). */
  regla_mes: boolean
}

/** A task with no estimate counts as half an hour: better a rough number than none. */
export const MINUTOS_POR_DEFECTO = 30

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
export function nombreDia(dia: number): string {
  return DIAS[dia] ?? ''
}

/** 'HH:MM:SS' / 'HH:MM' → 'HH:MM'. */
function hm(t: string): string {
  return String(t).slice(0, 5)
}

export function minutosEntre(inicio: string, fin: string): number {
  const [h1, m1] = inicio.split(':').map(Number)
  const [h2, m2] = fin.split(':').map(Number)
  return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1))
}

/** 0 = domingo … 6 = sábado, for a 'YYYY-MM-DD'. */
export function diaDeLaSemana(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay()
}

/** "1 h 30" · "45 min" · "2 h". */
export function duracion(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

// ── Loading ──────────────────────────────────────────────────────────────

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []
}

/**
 * The whole plantilla. Empty (never throws) when the fase 16 SQL has not
 * been run: every reader then simply shows nothing about blocks.
 */
export async function cargarPlantilla(): Promise<Plantilla> {
  const db = createServerClient()
  try {
    const [b, r] = await Promise.all([
      db.from('semana_bloques').select('*').eq('activo', true).order('dia').order('inicio'),
      db.from('semana_reglas_mes').select('*').eq('activo', true).order('desde').order('inicio'),
    ])
    if (b.error) {
      console.warn(`[bloques] semana_bloques: ${b.error.message}`)
      return { bloques: [], reglas: [] }
    }
    const bloques = ((b.data as Record<string, unknown>[]) ?? []).map((x) => ({
      id: String(x.id),
      dia: Number(x.dia),
      inicio: hm(String(x.inicio)),
      fin: hm(String(x.fin)),
      nombre: String(x.nombre ?? ''),
      tema: String(x.tema ?? ''),
      company_id: (x.company_id as string | null) ?? null,
      palabras: lista(x.palabras),
      fijas: lista(x.fijas),
      toma_tareas: x.toma_tareas !== false,
      bloqueado: x.bloqueado === true,
      activo: x.activo !== false,
    }))
    const reglas = r.error
      ? []
      : ((r.data as Record<string, unknown>[]) ?? []).map((x) => ({
          id: String(x.id),
          desde: Number(x.desde),
          hasta: Number(x.hasta),
          inicio: hm(String(x.inicio)),
          tema: String(x.tema ?? ''),
          rotacion: lista(x.rotacion),
          fijas: lista(x.fijas),
          activo: x.activo !== false,
        }))
    return { bloques, reglas }
  } catch (err) {
    console.warn(`[bloques] plantilla: ${mensajeError(err)}`)
    return { bloques: [], reglas: [] }
  }
}

// ── The blocks of one day ────────────────────────────────────────────────

/**
 * Which working day (lun–vie) of the rule's range `ymd` is: 0 for the first,
 * 1 for the second… -1 when the date is outside the range or on a weekend.
 * "Del 1 al 7, un cliente por día" means the first five WORKING days.
 */
export function indiceHabil(ymd: string, desde: number, hasta: number): number {
  const diaMes = Number(ymd.slice(8, 10))
  const dow = diaDeLaSemana(ymd)
  if (diaMes < desde || diaMes > hasta || dow === 0 || dow === 6) return -1
  let n = 0
  for (let d = desde; d < diaMes; d++) {
    const otro = `${ymd.slice(0, 8)}${String(d).padStart(2, '0')}`
    const w = diaDeLaSemana(otro)
    if (w !== 0 && w !== 6) n += 1
  }
  return n
}

/** The rule that changes the block starting at `inicio` on `ymd`, with its turn of the rotation. */
export function reglaPara(reglas: ReglaMes[], ymd: string, inicio: string): { regla: ReglaMes; turno: string | null } | null {
  for (const r of reglas) {
    if (!r.activo || r.inicio !== inicio) continue
    const i = indiceHabil(ymd, r.desde, r.hasta)
    if (i < 0) continue
    if (r.rotacion.length === 0) return { regla: r, turno: null }
    // The list ran out: the rule is done for this month and the normal block is back.
    if (i >= r.rotacion.length) continue
    return { regla: r, turno: r.rotacion[i] }
  }
  return null
}

type TareaLite = Pick<Task, 'id' | 'text' | 'company_id' | 'due_date' | 'importante' | 'done'> & {
  estado?: string | null
  minutos_estimados?: number | null
}

function plano(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Does this task belong in this block? Company first, then the block's words. */
export function tareaVaEn(b: Pick<Bloque, 'company_id' | 'palabras'>, t: Pick<TareaLite, 'company_id' | 'text'>): boolean {
  if (b.company_id && t.company_id !== b.company_id) return false
  if (b.palabras.length === 0) return true
  const texto = plano(t.text)
  return b.palabras.some((p) => texto.includes(plano(p)))
}

/**
 * The tasks that ask for time on `ymd`: for today, everything open that is
 * due today or overdue; for a future day, only what is due that day.
 * What waits on someone else is nobody's block (and "Después" has no date, so it never shows up here).
 */
export function tareasDelDia(tasks: TareaLite[], ymd: string, hoy: string): TareaLite[] {
  return tasks.filter((t) => {
    if (t.done || !t.due_date) return false
    if (t.estado === 'esperando') return false
    return ymd === hoy ? t.due_date <= hoy : t.due_date === ymd
  })
}

/**
 * One day, resolved: its blocks in order, the month rules applied, and every
 * task of the day placed in the first block that takes it. A block with a
 * company or with words is specific; one with neither is a catch-all
 * ("Colchón") and only gets what nobody else took.
 */
export function bloquesDelDia(
  p: Plantilla,
  ymd: string,
  tasks: TareaLite[] = [],
  companies: Pick<Company, 'id' | 'name'>[] = [],
  hoy: string = cancunYmd()
): BloqueDelDia[] {
  const dow = diaDeLaSemana(ymd)
  const nombreEmpresa = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name.trim() ?? null : null)
  const delDia = p.bloques.filter((b) => b.activo && b.dia === dow).sort((a, b) => a.inicio.localeCompare(b.inicio))

  const out: BloqueDelDia[] = delDia.map((b) => {
    const r = b.bloqueado ? null : reglaPara(p.reglas, ymd, b.inicio)
    return {
      id: b.id,
      inicio: b.inicio,
      fin: b.fin,
      nombre: b.nombre,
      tema: r ? `${r.regla.tema}${r.turno ? ` · hoy: ${r.turno}` : ''}` : b.tema,
      empresa: r ? null : nombreEmpresa(b.company_id),
      fijas: r ? r.regla.fijas : b.fijas,
      // A month rule takes the whole block: the usual tasks of that slot wait.
      toma_tareas: r ? false : b.toma_tareas,
      bloqueado: b.bloqueado,
      minutos: minutosEntre(b.inicio, b.fin),
      tareas: [],
      carga: 0,
      no_cabe: false,
      regla_mes: !!r,
    }
  })

  const pendientes = tareasDelDia(tasks, ymd, hoy)
  const colocar = (soloEspecificos: boolean) => {
    for (const t of [...pendientes]) {
      const i = delDia.findIndex((b, k) => {
        if (!out[k].toma_tareas || out[k].bloqueado) return false
        const especifico = !!b.company_id || b.palabras.length > 0
        return especifico === soloEspecificos && tareaVaEn(b, t)
      })
      if (i < 0) continue
      const min = t.minutos_estimados && t.minutos_estimados > 0 ? t.minutos_estimados : MINUTOS_POR_DEFECTO
      out[i].tareas.push({
        id: t.id,
        text: t.text,
        empresa: nombreEmpresa(t.company_id),
        minutos: min,
        estimado: !(t.minutos_estimados && t.minutos_estimados > 0),
        vencida: !!t.due_date && t.due_date < hoy,
        importante: !!t.importante,
      })
      pendientes.splice(pendientes.indexOf(t), 1)
    }
  }
  colocar(true)
  colocar(false)

  for (const b of out) {
    b.carga = b.tareas.reduce((n, t) => n + t.minutos, 0)
    b.no_cabe = b.carga > b.minutos
  }
  return out
}

/** The tasks of the day that no block took (no block of their company today). */
export function sinBloque(bloques: BloqueDelDia[], tasks: TareaLite[], ymd: string, hoy: string = cancunYmd()): TareaLite[] {
  const puestas = new Set(bloques.flatMap((b) => b.tareas.map((t) => t.id)))
  return tareasDelDia(tasks, ymd, hoy).filter((t) => !puestas.has(t.id))
}

// ── How it reads ─────────────────────────────────────────────────────────

/** "8:15 am Bloque A · PD: cierre de la semana — 3 tareas (1 h 30)" */
export function lineaBloque(b: BloqueDelDia): string {
  const partes = [`${formatHoraEs(b.inicio)} ${b.nombre} · ${b.tema}`]
  if (b.tareas.length > 0) {
    partes.push(`${b.tareas.length} ${b.tareas.length === 1 ? 'tarea' : 'tareas'} (${duracion(b.carga)}${b.no_cabe ? `, no caben en ${duracion(b.minutos)}` : ''})`)
  }
  return partes.join(' — ')
}

/**
 * The "🧭 Hoy te toca" block of the morning message: the working blocks from
 * `desdeHm` on, each with its routine and how loaded it is. Null when there
 * is no plantilla or nothing is left today.
 */
export function textoHoyTeToca(bloques: BloqueDelDia[], desdeHm: string = '00:00'): string | null {
  const quedan = bloques.filter((b) => !b.bloqueado && b.fin > desdeHm && (b.toma_tareas || b.regla_mes || b.fijas.length > 0))
  if (quedan.length === 0) return null
  const lines = ['🧭 <b>Hoy te toca</b>']
  for (const b of quedan) {
    lines.push(`${b.no_cabe ? '⚠️' : '▫️'} ${escapar(lineaBloque(b))}`)
  }
  return lines.join('\n')
}

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The next `dias` days as plain text for Gabita's prompt: every block with
 * its hours, what it is for, what is already in it and how much room is
 * left. This is what lets her answer "¿cuándo hago lo de CPT?" with days
 * and hours instead of another question.
 */
export function semanaParaPrompt(
  p: Plantilla,
  desde: string,
  dias: number,
  tasks: TareaLite[],
  companies: Pick<Company, 'id' | 'name'>[],
  hoy: string = cancunYmd()
): string {
  if (p.bloques.length === 0) return '(no hay plantilla de semana todavía)'
  const out: string[] = []
  for (let i = 0; i < dias; i++) {
    const ymd = addDays(desde, i)
    const bloques = bloquesDelDia(p, ymd, tasks, companies, hoy)
    if (bloques.length === 0) continue
    out.push(`${nombreDia(diaDeLaSemana(ymd))} ${ymd}${ymd === hoy ? ' (HOY)' : ''}:`)
    for (const b of bloques) {
      if (b.bloqueado) {
        out.push(`  ${b.inicio}–${b.fin} NO DISPONIBLE (${b.tema})`)
        continue
      }
      const libre = Math.max(0, b.minutos - b.carga)
      const partes = [`  ${b.inicio}–${b.fin} ${b.nombre} · ${b.tema}`]
      if (b.fijas.length > 0) partes.push(`rutina: ${b.fijas.join('; ')}`)
      if (b.tareas.length > 0) partes.push(`ya tiene: ${b.tareas.map((t) => `«${t.text}» ${duracion(t.minutos)}`).join(', ')}`)
      partes.push(b.toma_tareas ? `libre: ${duracion(libre)}` : 'no recibe tareas')
      out.push(partes.join(' | '))
    }
    const fuera = sinBloque(bloques, tasks, ymd, hoy)
    if (fuera.length > 0) out.push(`  SIN BLOQUE ese día: ${fuera.map((t) => `«${t.text}»`).join(', ')}`)
  }
  return out.join('\n')
}

/** Today's blocks with their tasks, for the Resumen and the morning message. */
export async function hoyTeToca(
  tasks: TareaLite[],
  companies: Pick<Company, 'id' | 'name'>[],
  hoy: string = cancunYmd()
): Promise<{ bloques: BloqueDelDia[]; sin_bloque: { id: string; text: string }[] }> {
  const p = await cargarPlantilla()
  if (p.bloques.length === 0) return { bloques: [], sin_bloque: [] }
  const bloques = bloquesDelDia(p, hoy, tasks, companies, hoy)
  return { bloques, sin_bloque: sinBloque(bloques, tasks, hoy, hoy).map((t) => ({ id: t.id, text: t.text })) }
}
