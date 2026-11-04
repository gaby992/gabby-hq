// Fase 9c-C/D: the assistant NARRATES. One short paragraph that says what
// matters (what cannot wait, what has been overdue for over a month, what
// is tomorrow, who we are waiting on, how many mails ask for an answer),
// and only then the compact numbered list. The paragraph names at most 3
// tasks per point and never repeats the list.
//
// The paragraph is composed here, deterministically, from the same data the
// lists use (so it never invents); the model only gets to REWRITE it in a
// warmer voice, with a short timeout and the fixed text as the fallback.
//
// The same module answers the natural questions in prose (preguntas.ts
// decides which one): "¿qué tengo hoy?", "¿qué me queda pendiente?", "¿qué
// tengo mañana?", "¿qué tengo estancado?", "¿cómo va IM?", "¿qué tengo
// esperando?", "¿qué hay esta semana?". Every answer closes with a proposal;
// when the proposal means changes, it comes as a plan with the usual
// [✅ Hacer todo] [✏️ No, corrijo] (the caller renders it).
//
// Plain text only (no Telegram HTML): the answers travel through the same
// `reply` as everything else and must read the same in Telegram and in
// the web chat.

import { createServerClient } from '@/lib/supabase-server'
import type { Company, NotaEmpresa, Task } from '@/types'
import { isChelseaName } from '@/lib/chelsea'
import { daysSince } from '@/lib/dates'
import { HORIZONTE_EMOJI, HORIZONTE_LABELS, compararEnColumna, estaEsperando, horizonteDe, type Horizonte } from '@/lib/horizonte'
import { correosPendientes, grupoDe, quienCorto, type CorreoLite } from '@/lib/correo/pendientes'
import { cargarCuentas } from '@/lib/correo/cuentas'
import { mensajeError } from '@/lib/errores'
import { addDays, cancunYmd, daysBetween, formatCortoEs, formatHoraEs, formatVenceEs } from './cancun'
import { cargarConfig, personaPrompt, type AsistenteConfig } from './config'
import { llmConfig, preguntarLlm } from './llm'
import { SIMBOLO, bucketFor } from './simbolos'
import { clasificarPregunta, type PreguntaNatural } from './preguntas'
import type { AlarmaItem } from './registro-listas'
import type { AccionResuelta } from './plan'

/** Tasks named per point of the paragraph, at most. */
export const MAX_NOMBRES = 3
/** Lines of the compact list under a narrated answer. */
export const MAX_LINEAS = 8
/** "Estancada": no change (updated_at, or created_at before SQL 9c) in this many days. */
export const DIAS_ESTANCADA = 14
/** "Esperando desde hace días": in ⏳ for this many days. */
export const DIAS_ESPERANDO = 3
/** "Más de un mes vencida". */
export const DIAS_MES = 30

export type TareaN = Task & { company?: Pick<Company, 'name' | 'color'> | null; updated_at?: string | null }

export interface Panorama {
  today: string
  tasks: TareaN[]
  companies: Company[]
  notas: NotaEmpresa[]
  /** Pending mail (nuevo / para_chelsea) of the last 7 days, list order. */
  correos: CorreoLite[]
  cuentas: { id: string; nombre: string; company_id: string | null }[]
  chelseaId: string | null
  col: Record<Horizonte, TareaN[]>
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

// ── Data ─────────────────────────────────────────────────────────────────

/** Pure: the picture of the day from rows already loaded. */
export function panoramaDe(tasks: TareaN[], companies: Company[], notas: NotaEmpresa[], correos: CorreoLite[], cuentas: Panorama['cuentas'], today: string): Panorama {
  const chelseaId = companies.find((c) => isChelseaName(c.name))?.id ?? null
  const col: Record<Horizonte, TareaN[]> = { hoy: [], manana: [], semana: [], esperando: [], despues: [] }
  for (const t of tasks) col[horizonteDe(t, today, chelseaId)].push(t)
  for (const h of Object.keys(col) as Horizonte[]) col[h].sort((a, b) => compararEnColumna(a, b, today))
  return { today, tasks, companies, notas, correos, cuentas, chelseaId, col }
}

export async function cargarPanorama(today: string = cancunYmd()): Promise<Panorama> {
  const db = createServerClient()
  const [tasksRes, companiesRes, notasRes, correos, cuentas] = await Promise.all([
    db.from('tasks').select('*, company:companies(name, color)').eq('done', false).order('created_at', { ascending: true }),
    db.from('companies').select('*'),
    db.from('notas_empresa').select('*'),
    correosPendientes({ dias: 7 }),
    cargarCuentas().catch((err) => {
      console.error(`[narracion] cuentas: ${mensajeError(err)}`)
      return []
    }),
  ])
  if (tasksRes.error) throw new Error(`Supabase tasks: ${tasksRes.error.message}`)
  if (companiesRes.error) throw new Error(`Supabase companies: ${companiesRes.error.message}`)
  if (notasRes.error) console.error(`[narracion] notas_empresa: ${notasRes.error.message}`)
  return panoramaDe(
    (tasksRes.data as TareaN[]) ?? [],
    (companiesRes.data as Company[]) ?? [],
    (notasRes.data as NotaEmpresa[]) ?? [],
    correos,
    cuentas.map((c) => ({ id: c.id, nombre: c.nombre, company_id: c.conexion?.company_id ?? null })),
    today
  )
}

// ── Words ────────────────────────────────────────────────────────────────

export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

function corto(s: string, max = 40): string {
  const una = s.replace(/\s+/g, ' ').trim()
  return una.length > max ? una.slice(0, max - 1) + '…' : una
}

/** «a», «b» y «c» — at most MAX_NOMBRES, then "y N más". `cola(t)` adds "(12 días)" and the like. */
export function nombrar(ts: Pick<TareaN, 'text'>[], cola?: (t: TareaN) => string | null, max = MAX_NOMBRES): string {
  const vistos = ts.slice(0, max).map((t) => {
    const c = cola ? cola(t as TareaN) : null
    return `«${corto(t.text)}»${c ? ` ${c}` : ''}`
  })
  const resto = ts.length - vistos.length
  if (resto > 0) return `${vistos.join(', ')} y ${resto} más`
  return vistos.length <= 1 ? vistos.join('') : `${vistos.slice(0, -1).join(', ')} y ${vistos[vistos.length - 1]}`
}

/** "(12 días)" — how long a task has been overdue. */
function lleva(t: TareaN, today: string): string | null {
  if (!t.due_date || t.due_date >= today) return null
  return `(${plural(daysBetween(t.due_date, today), 'día', 'días')})`
}

function aLas(t: TareaN): string | null {
  return t.due_time ? `(${formatHoraEs(t.due_time.slice(0, 5))})` : null
}

/** Days since the last change: updated_at (SQL 9c) or, before it, created_at. */
export function diasSinMover(t: TareaN, now: Date = new Date()): number {
  return daysSince(t.updated_at ?? t.created_at, now)
}

function empresaDe(t: TareaN): string {
  return t.company?.name?.trim() || 'sin empresa'
}

/** Mail waiting on Gabby that a person expects an answer to (alta, necesita respuesta, pedido). */
function correosQuePiden(p: Panorama): CorreoLite[] {
  return p.correos.filter((c) => c.estado === 'nuevo' && grupoDe(c) !== 'resto')
}

// ── The points of the day (each one a sentence, or null when there is nothing to say) ──

/** Gabby's own active work: not Chelsea's, not what waits on someone. */
function propias(p: Panorama, ts: TareaN[]): TareaN[] {
  return ts.filter((t) => !estaEsperando(t) && !(p.chelseaId && t.company_id === p.chelseaId))
}

/** "Lo que no puede esperar: 2 vencidas (…) y 1 para hoy (…)." */
export function puntoHoy(p: Panorama, opts: { restante?: boolean } = {}): string {
  const hoy = propias(p, p.col.hoy)
  const vencidas = hoy.filter((t) => t.due_date && t.due_date < p.today)
  const deHoy = hoy.filter((t) => t.due_date === p.today)
  const urgentes = hoy.filter((t) => !t.due_date)
  if (hoy.length === 0) return opts.restante ? 'Nada de hoy quedó sin cerrar 🎉.' : 'Nada vencido ni urgente para hoy 🎉.'
  const partes: string[] = []
  if (vencidas.length > 0) partes.push(`${plural(vencidas.length, 'vencida', 'vencidas')} — ${nombrar(vencidas, (t) => lleva(t, p.today))}`)
  if (deHoy.length > 0) partes.push(`${deHoy.length} para hoy — ${nombrar(deHoy, aLas)}`)
  if (urgentes.length > 0) partes.push(`${plural(urgentes.length, 'urgente sin fecha', 'urgentes sin fecha')} — ${nombrar(urgentes)}`)
  const lista = partes.join('; ')
  return opts.restante ? `Sigue abierto para hoy: ${lista}.` : `Lo que no puede esperar: ${lista}.`
}

/** "«a» y «b» llevan más de un mes vencidas." */
export function puntoViejas(p: Panorama): string | null {
  const viejas = propias(p, p.col.hoy).filter((t) => t.due_date && daysBetween(t.due_date, p.today) > DIAS_MES)
  if (viejas.length === 0) return null
  return viejas.length === 1 ? `${nombrar(viejas)} lleva más de un mes vencida.` : `${nombrar(viejas)} llevan más de un mes vencidas.`
}

/** "Mañana: «a» (10:00 am), «b» y 1 más." */
export function puntoManana(p: Panorama): string {
  const manana = propias(p, p.col.manana)
  if (manana.length === 0) return 'Mañana está libre.'
  return `Mañana ${manana.length === 1 ? 'tienes 1 cosa' : `tienes ${manana.length} cosas`}: ${nombrar(manana, aLas)}.`
}

/** "Esperas a Andrew por «landing» y a Chelsea por 2 cosas." */
export function puntoEsperando(p: Panorama): string | null {
  const grupos = gruposEsperando(p)
  if (grupos.length === 0) return null
  const frases = grupos.slice(0, MAX_NOMBRES).map((g) => {
    const quien = g.quien ?? 'alguien (no dijiste a quién)'
    return g.tareas.length === 1 ? `a ${quien} por ${nombrar(g.tareas)}` : `a ${quien} por ${g.tareas.length} cosas`
  })
  const resto = grupos.length - frases.length
  const base = frases.length <= 1 ? frases.join('') : `${frases.slice(0, -1).join(', ')} y ${frases[frases.length - 1]}`
  return `Esperas ${base}${resto > 0 ? ` y a ${resto} más` : ''}.`
}

/** Waiting tasks grouped by who, biggest group first; Chelsea's company tasks count as waiting on Chelsea. */
export function gruposEsperando(p: Panorama): { quien: string | null; tareas: TareaN[] }[] {
  const m = new Map<string, { quien: string | null; tareas: TareaN[] }>()
  for (const t of p.col.esperando) {
    const quien = t.esperando_a?.trim() || (p.chelseaId && t.company_id === p.chelseaId ? 'Chelsea' : null)
    const key = quien ? quien.toLowerCase() : ''
    if (!m.has(key)) m.set(key, { quien, tareas: [] })
    m.get(key)!.tareas.push(t)
  }
  return Array.from(m.values()).sort((a, b) => b.tareas.length - a.tareas.length)
}

/** "3 correos piden respuesta (1 urgente)." */
export function puntoCorreos(p: Panorama): string | null {
  const piden = correosQuePiden(p)
  if (piden.length === 0) return null
  const altas = piden.filter((c) => c.urgencia === 'alta').length
  return `${piden.length === 1 ? '1 correo pide respuesta' : `${piden.length} correos piden respuesta`}${altas > 0 ? ` (${plural(altas, 'urgente', 'urgentes')})` : ''}.`
}

function unir(frases: (string | null)[]): string {
  return frases.filter((f): f is string => !!f).join(' ')
}

// ── The paragraphs of the two alarms ─────────────────────────────────────

/** The morning paragraph, fixed wording. */
export function parrafoMananaFijo(cfg: AsistenteConfig, p: Panorama): string {
  return unir([`Buenos días, ${cfg.nombre_persona}.`, puntoHoy(p), puntoViejas(p), puntoManana(p), puntoEsperando(p), puntoCorreos(p)])
}

/** The evening paragraph, fixed wording: what got done and what is left. */
export function parrafoTardeFijo(cfg: AsistenteConfig, p: Panorama, hechas: TareaN[]): string {
  const abiertas = p.tasks.length
  const cerradas = hechas.length > 0
    ? `Cerraste ${hechas.length} de ${hechas.length + abiertas} hoy (${nombrar(hechas)}) 👏.`
    : abiertas > 0 ? `Hoy no se cerró nada, ${cfg.nombre_persona}.` : `Nada abierto, ${cfg.nombre_persona} 🎉.`
  return unir([cerradas, abiertas > 0 ? puntoHoy(p, { restante: true }) : null, puntoViejas(p), puntoManana(p), puntoEsperando(p), puntoCorreos(p)])
}

/**
 * Lets the model rewrite the fixed paragraph in its own warm voice. The
 * facts are already in the text: it may not add or drop any, and every
 * «title» must survive. 8 s, then the fixed one.
 */
export async function pulir(cfg: AsistenteConfig, fijo: string): Promise<string> {
  const titulos = Array.from(fijo.matchAll(/«([^»]+)»/g)).map((m) => m[1])
  try {
    llmConfig()
    const r = await preguntarLlm(
      personaPrompt(cfg) +
        '\n\nReescribe el RESUMEN en UN solo párrafo cálido y natural, máximo 110 palabras, español neutro (nunca voseo), sin lista ni saltos de línea. ' +
        'No agregues ni quites ningún dato, número ni tarea; conserva cada título tal cual entre «». Puedes cambiar el orden y las palabras. Responde solo con el párrafo.',
      `RESUMEN: ${fijo}`,
      { maxTokens: 260, timeoutMs: 8_000 }
    )
    const texto = r.text.replace(/\s*\n+\s*/g, ' ').trim()
    const ok = texto.length >= 20 && texto.length <= 900 && titulos.every((t) => texto.includes(t))
    return ok ? texto : fijo
  } catch (err) {
    console.warn(`[narracion] pulir: ${mensajeError(err)} — uso el fijo`)
    return fijo
  }
}

export async function parrafoManana(cfg: AsistenteConfig, p: Panorama): Promise<string> {
  return pulir(cfg, parrafoMananaFijo(cfg, p))
}

export async function parrafoTarde(cfg: AsistenteConfig, p: Panorama, hechas: TareaN[]): Promise<string> {
  return pulir(cfg, parrafoTardeFijo(cfg, p, hechas))
}

// ── Compact numbered lines (plain text) ──────────────────────────────────

function lineaTarea(n: number, t: TareaN, p: Panorama, h: Horizonte): string {
  const hora = t.due_time ? formatHoraEs(t.due_time.slice(0, 5)) : ''
  if (h === 'esperando') {
    const quien = t.esperando_a?.trim() || (p.chelseaId && t.company_id === p.chelseaId ? 'Chelsea' : '¿de quién?')
    const d = diasSinMover(t)
    return `⏳ ${n}. ${t.text} · ${empresaDe(t)} · ${quien} · ${plural(d, 'día', 'días')}`
  }
  const bucket = bucketFor(t, p.today)
  const porque =
    bucket === 'vencida' ? `hace ${plural(daysBetween(t.due_date!, p.today), 'día', 'días')}`
    : bucket === 'hoy' ? hora
    : t.due_date && h !== 'manana' ? `${formatCortoEs(t.due_date)}${hora ? ` ${hora}` : ''}`
    : hora || (t.priority === 'urgente' ? (t.importante ? 'urgente ★' : 'urgente') : '')
  return `${SIMBOLO[bucket]} ${n}. ${[t.text, empresaDe(t), porque].filter(Boolean).join(' · ')}`
}

/** Numbers `ts` from items.length + 1, records each line, cuts at `max` with "+N más". */
function listar(ts: TareaN[], p: Panorama, h: Horizonte, items: AlarmaItem[], max = MAX_LINEAS): string[] {
  const lines: string[] = []
  for (const t of ts.slice(0, max)) {
    items.push({ n: items.length + 1, task_id: t.id })
    lines.push(lineaTarea(items.length, t, p, h))
  }
  if (ts.length > max) lines.push(`· +${ts.length - max} más en ${appUrl()}/hoy`)
  return lines
}

// ── The narrated answers ─────────────────────────────────────────────────

export interface Narrada {
  /** Plain text: paragraph, blank line, the numbered lines, blank line, the proposal. */
  texto: string
  /** The numbering (recorded by the caller as a 'lista' so "la 3 lista" works). */
  items: AlarmaItem[]
  /** A proposal that means changes: the caller shows it as a plan with [✅ Hacer todo] [✏️ No, corrijo]. */
  plan?: AccionResuelta[]
}

function bloques(...partes: (string | string[] | null)[]): string {
  return partes
    .map((x) => (Array.isArray(x) ? x.join('\n') : x))
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join('\n\n')
}

function propuestaHoy(p: Panorama): string {
  const primera = propias(p, p.col.hoy)[0]
  if (primera) return `¿Arrancamos con «${corto(primera.text)}»? Cuando esté, dime «la 1 lista»; si no va a salir hoy, «pasa 1 a mañana».`
  if (p.col.manana.length > 0) return `Nada urge hoy. ¿Adelantamos algo de mañana? Dime «pasa 2 para hoy» o pide «qué sigue».`
  return 'Nada urge hoy. ¿Te mando «qué sigue» o el tablero?'
}

function narrarHoy(p: Panorama, cfg: AsistenteConfig): Narrada {
  const items: AlarmaItem[] = []
  const parrafo = unir([puntoHoy(p), puntoViejas(p), puntoCorreos(p)])
  const lineas = listar(propias(p, p.col.hoy), p, 'hoy', items)
  void cfg
  return { texto: bloques(parrafo, lineas.length > 0 ? [`${HORIZONTE_EMOJI.hoy} ${HORIZONTE_LABELS.hoy} (${propias(p, p.col.hoy).length})`, ...lineas] : null, propuestaHoy(p)), items }
}

function narrarPendiente(p: Panorama, cfg: AsistenteConfig): Narrada {
  const items: AlarmaItem[] = []
  const c = p.col
  const total = p.tasks.length
  const vencidas = propias(p, c.hoy).filter((t) => t.due_date && t.due_date < p.today).length
  const reparto = [
    `${c.hoy.length} en Hoy sí o sí${vencidas > 0 ? ` (${plural(vencidas, 'vencida', 'vencidas')})` : ''}`,
    c.manana.length > 0 ? `${c.manana.length} mañana` : null,
    c.semana.length > 0 ? `${c.semana.length} esta semana` : null,
    c.esperando.length > 0 ? `${c.esperando.length} esperando` : null,
    c.despues.length > 0 ? `${c.despues.length} en Después` : null,
  ].filter(Boolean)
  const cabeza = total === 0 ? `No tienes nada pendiente, ${cfg.nombre_persona} 🎉.` : `Tienes ${plural(total, 'tarea abierta', 'tareas abiertas')}: ${reparto.join(', ')}.`
  const parrafo = unir([cabeza, total > 0 ? puntoHoy(p) : null, puntoViejas(p), puntoEsperando(p), puntoCorreos(p)])
  const lineas = listar(propias(p, c.hoy), p, 'hoy', items)
  return { texto: bloques(parrafo, lineas.length > 0 ? [`${HORIZONTE_EMOJI.hoy} ${HORIZONTE_LABELS.hoy} (${propias(p, c.hoy).length})`, ...lineas] : null, propuestaHoy(p)), items }
}

function narrarManana(p: Panorama): Narrada {
  const items: AlarmaItem[] = []
  const manana = propias(p, p.col.manana)
  const parrafo = unir([puntoManana(p), manana.length > 0 && p.col.semana.length > 0 ? `El resto de la semana trae ${plural(p.col.semana.length, 'cosa más', 'cosas más')}.` : null])
  const lineas = listar(manana, p, 'manana', items)
  const propuesta = propias(p, p.col.hoy).length > 0
    ? 'Si algo de hoy no va a salir, dime «pasa 2 a mañana» y lo acomodo.'
    : p.col.semana.length > 0 ? '¿Adelantamos algo de la semana? Dime «pasa 3 a mañana».' : 'Si quieres apartar algo para mañana, dímelo como tarea: «mañana llamar a Juan».'
  return { texto: bloques(parrafo, lineas.length > 0 ? [`${HORIZONTE_EMOJI.manana} ${HORIZONTE_LABELS.manana} (${manana.length}) · ${formatVenceEs(addDays(p.today, 1))}`, ...lineas] : null, propuesta), items }
}

function narrarEstancado(p: Panorama): Narrada {
  const items: AlarmaItem[] = []
  const now = new Date()
  // Stuck = untouched for 14+ days AND not scheduled ahead (a task due today or later is planned, not stuck).
  const estancadas = propias(p, p.tasks)
    .filter((t) => diasSinMover(t, now) >= DIAS_ESTANCADA && (!t.due_date || t.due_date < p.today))
    .sort((a, b) => diasSinMover(b, now) - diasSinMover(a, now))
  const esperando = p.col.esperando
    .filter((t) => diasSinMover(t, now) >= DIAS_ESPERANDO)
    .sort((a, b) => diasSinMover(b, now) - diasSinMover(a, now))
  if (estancadas.length === 0 && esperando.length === 0) {
    return { texto: bloques('Nada estancado: todo se movió en las últimas dos semanas y nadie te tiene esperando desde hace días 🎉.', '¿Vemos «qué sigue»?'), items }
  }
  const dias = (t: TareaN) => `(${plural(diasSinMover(t, now), 'día', 'días')})`
  const parrafo = unir([
    estancadas.length > 0 ? `Tienes ${plural(estancadas.length, 'tarea sin moverse', 'tareas sin moverse')} desde hace más de dos semanas: ${nombrar(estancadas, dias)}.` : null,
    esperando.length > 0
      ? `${estancadas.length > 0 ? 'Y ' : ''}${plural(esperando.length, 'lleva días esperando', 'llevan días esperando')}: ${nombrar(esperando, (t) => `(${t.esperando_a?.trim() || (p.chelseaId && t.company_id === p.chelseaId ? 'Chelsea' : 'no dijiste a quién')}, ${plural(diasSinMover(t, now), 'día', 'días')})`)}.`
      : null,
  ])
  const lineasEst = listar(estancadas, p, 'despues', items, MAX_LINEAS)
  const lineasEsp = listar(esperando, p, 'esperando', items, 5)
  // The proposal that means changes: the stale ones (the listed ones) go to 📦 Después, as a plan she approves or corrects.
  const plan: AccionResuelta[] = estancadas.slice(0, MAX_LINEAS).map((t, i) => ({
    tipo: 'despues',
    ref: `#${i + 1}`,
    tarea: { id: t.id, text: t.text, company: t.company ? { name: t.company.name } : null },
  }))
  const propuesta = plan.length > 0
    ? `¿Las paso a Después, las cancelo o les pongo alarma? Te propongo pasar a Después las ${plan.length === 1 ? 'de arriba' : `${plan.length} sin moverse`}; corrige lo que quieras («cancela la 2», «la 3 déjala», «alarma el viernes para la 1»):`
    : 'Si alguien ya respondió, dime «la 1 ya no espera»; si no, te pongo una alarma para dar seguimiento: «alarma mañana 10am seguimiento».'
  return {
    texto: bloques(parrafo, lineasEst.length > 0 ? ['📦 Sin moverse', ...lineasEst] : null, lineasEsp.length > 0 ? [`${HORIZONTE_EMOJI.esperando} Esperando desde hace días`, ...lineasEsp] : null, propuesta),
    items,
    plan: plan.length > 0 ? plan : undefined,
  }
}

function narrarEmpresa(p: Panorama, nombre: string): Narrada {
  const items: AlarmaItem[] = []
  const c = p.companies.find((x) => x.name.trim().toLowerCase() === nombre.trim().toLowerCase())
  if (!c) return { texto: `No conozco la empresa «${nombre}». Las que tengo: ${p.companies.map((x) => x.name.trim()).join(', ')}.`, items }
  const name = c.name.trim()
  const mias = p.tasks.filter((t) => t.company_id === c.id)
  const sub = panoramaDe(mias, p.companies, p.notas, p.correos, p.cuentas, p.today)
  const hoy = propias(sub, sub.col.hoy)
  const vencidas = hoy.filter((t) => t.due_date && t.due_date < p.today)
  const deHoy = hoy.filter((t) => t.due_date === p.today)
  const cuentasDe = new Set(p.cuentas.filter((k) => k.company_id === c.id).map((k) => k.id))
  const correos = p.correos.filter((m) => cuentasDe.has(m.cuenta_id) && m.estado === 'nuevo')
  const altas = correos.filter((m) => m.urgencia === 'alta').length
  const nota = p.notas.find((n) => n.company_id === c.id)
  const partes: string[] = []
  if (mias.length === 0) partes.push(`${name} está limpio: nada abierto.`)
  else {
    const reparto = [
      vencidas.length > 0 ? `${plural(vencidas.length, 'vencida', 'vencidas')} — ${nombrar(vencidas, (t) => lleva(t, p.today))}` : null,
      deHoy.length > 0 ? `${deHoy.length} para hoy — ${nombrar(deHoy, aLas)}` : null,
      sub.col.manana.length > 0 ? `${sub.col.manana.length} mañana` : null,
      sub.col.semana.length > 0 ? `${sub.col.semana.length} esta semana` : null,
      sub.col.esperando.length > 0 ? `${sub.col.esperando.length} esperando (${gruposEsperando(sub).map((g) => `${g.quien ?? '¿de quién?'}: ${nombrar(g.tareas)}`).slice(0, 2).join('; ')})` : null,
      sub.col.despues.length > 0 ? `${sub.col.despues.length} en Después` : null,
    ].filter(Boolean)
    partes.push(`${name}: ${plural(mias.length, 'tarea abierta', 'tareas abiertas')}${reparto.length > 0 ? `: ${reparto.join('; ')}` : ''}.`)
  }
  if (correos.length > 0) partes.push(`${plural(correos.length, 'correo pendiente', 'correos pendientes')}${altas > 0 ? ` (${plural(altas, 'urgente', 'urgentes')})` : ''}: ${correos.slice(0, 2).map((m) => `${quienCorto(m)} · «${corto(m.asunto ?? '(sin asunto)', 36)}»`).join(', ')}${correos.length > 2 ? ` y ${correos.length - 2} más` : ''}.`)
  if (nota?.nota.trim()) {
    const d = daysSince(nota.updated_at)
    partes.push(`Por dónde ibas (${d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`}): «${corto(nota.nota, 160)}».`)
  }
  const lineas = listar(hoy, p, 'hoy', items, 6)
  const propuesta = hoy[0]
    ? `¿Seguimos con «${corto(hoy[0].text)}»? Dime «la 1 lista» cuando esté, o «todo lo pendiente de ${name}» para verlo completo.`
    : mias.length > 0 ? `Nada urge de ${name}. ¿Te mando «todo lo pendiente de ${name}»?` : `¿Anotamos algo nuevo de ${name}? Dímelo como tarea.`
  return { texto: bloques(unir(partes), lineas.length > 0 ? [`${HORIZONTE_EMOJI.hoy} ${HORIZONTE_LABELS.hoy} · ${name} (${hoy.length})`, ...lineas] : null, propuesta), items }
}

function narrarEsperando(p: Panorama): Narrada {
  const items: AlarmaItem[] = []
  const rows = [...p.col.esperando].sort((a, b) => diasSinMover(b) - diasSinMover(a))
  const paraChelsea = p.correos.filter((c) => c.estado === 'para_chelsea').length
  if (rows.length === 0) {
    return { texto: bloques(`Nada en manos de nadie 🎉.${paraChelsea > 0 ? ` Solo ${plural(paraChelsea, 'correo pasado', 'correos pasados')} a Chelsea sin responder.` : ''}`, 'Cuando dejes algo en manos de alguien, dime «la de TOTT está esperando a Andrew».'), items }
  }
  const parrafo = unir([
    puntoEsperando(p),
    rows.some((t) => diasSinMover(t) >= DIAS_ESPERANDO) ? `La más vieja es «${corto(rows[0].text)}», desde hace ${plural(diasSinMover(rows[0]), 'día', 'días')}.` : null,
    paraChelsea > 0 ? `Además, ${plural(paraChelsea, 'correo pasado', 'correos pasados')} a Chelsea sin responder.` : null,
  ])
  const lineas = listar(rows, p, 'esperando', items, 10)
  return {
    texto: bloques(parrafo, [`${HORIZONTE_EMOJI.esperando} ${HORIZONTE_LABELS.esperando} (${rows.length})`, ...lineas], 'Si alguien ya respondió, dime «la 2 ya no espera»; para cerrar, «listo 2»; para dar seguimiento, «alarma mañana 10am seguimiento TOTT».'),
    items,
  }
}

const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function narrarSemana(p: Panorama): Narrada {
  const items: AlarmaItem[] = []
  const dow = new Date(`${p.today}T12:00:00Z`).getUTCDay()
  const lunes = addDays(p.today, -((dow + 6) % 7))
  const dias = Array.from({ length: 7 }, (_, i) => addDays(lunes, i))
  const activas = propias(p, p.tasks)
  const porDia = dias.map((d) => ({ d, tareas: activas.filter((t) => t.due_date === d).sort((a, b) => compararEnColumna(a, b, p.today)) }))
  const conFecha = porDia.reduce((n, x) => n + x.tareas.length, 0)
  const vencidasAntes = activas.filter((t) => t.due_date && t.due_date < lunes).length
  const cargado = [...porDia].sort((a, b) => b.tareas.length - a.tareas.length)[0]
  const parrafo = unir([
    conFecha === 0 ? 'Esta semana no tienes nada con fecha.' : `Esta semana tienes ${plural(conFecha, 'cosa con fecha', 'cosas con fecha')}${cargado && cargado.tareas.length > 1 ? `; el día más cargado es el ${DIAS_LARGOS[new Date(`${cargado.d}T12:00:00Z`).getUTCDay()].toLowerCase()} (${cargado.tareas.length})` : ''}.`,
    vencidasAntes > 0 ? `Además arrastras ${plural(vencidasAntes, 'vencida', 'vencidas')} de antes.` : null,
    p.col.esperando.length > 0 ? `${p.col.esperando.length} ${p.col.esperando.length === 1 ? 'está' : 'están'} esperando a alguien.` : null,
  ])
  const secciones: string[][] = []
  for (const x of porDia) {
    if (x.tareas.length === 0) continue
    const [y, m, d] = x.d.split('-').map(Number)
    const nombre = DIAS_LARGOS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    const marca = x.d === p.today ? ' · hoy' : x.d < p.today ? ' · pasó' : ''
    secciones.push([`${nombre} ${d}${marca}`, ...listar(x.tareas, p, x.d <= p.today ? 'hoy' : 'manana', items, 6)])
  }
  const propuesta = conFecha > 0 ? 'Si quieres acomodar algo, dime «pasa 3 al viernes» o «la 2 para después».' : '¿Le ponemos fecha a algo de Después? Dime «paypal para el jueves».'
  return { texto: bloques(parrafo, ...secciones, propuesta), items }
}

/**
 * The narrated answer for a natural question, or null when the text is not
 * one of them (the caller then asks the model). Plain text.
 */
export async function responderNarrada(chatId: number, texto: string): Promise<Narrada | null> {
  void chatId
  const cfg = await cargarConfig()
  const db = createServerClient()
  const { data } = await db.from('companies').select('id, name')
  const q = clasificarPregunta(texto, (data as { id: string; name: string }[]) ?? [])
  if (!q) return null
  const p = await cargarPanorama()
  return narrar(q, p, cfg)
}

export function narrar(q: PreguntaNatural, p: Panorama, cfg: AsistenteConfig): Narrada {
  switch (q.tipo) {
    case 'hoy': return narrarHoy(p, cfg)
    case 'pendiente': return narrarPendiente(p, cfg)
    case 'manana': return narrarManana(p)
    case 'estancado': return narrarEstancado(p)
    case 'empresa': return narrarEmpresa(p, q.nombre)
    case 'esperando': return narrarEsperando(p)
    case 'semana': return narrarSemana(p)
  }
}
