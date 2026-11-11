// Fase 9c-C/D (ajuste 9c-2): the assistant NARRATES — in LINES, not a
// paragraph. A greeting, one line per horizon (symbol + count + at most one
// short fact in parentheses: 🔺 vencidas · 🔸 para hoy · ✴️ urgentes sin
// fecha · 📅 mañana · ⏳ esperando · 📧 correos; 0s omitted), and a last 👉
// line with ONE recommendation by short name (never a title in quotes).
// At most 8 lines, then the compact numbered list, where the titles live.
//
// The lines are composed here, deterministically, from the same data the
// lists use (so they never invent); the model may only POLISH the wording
// of each line, with a short timeout and the fixed lines as the fallback.
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

import { esCuentaDeChelsea, esEmpresaDeChelsea } from './de-chelsea'
import { createServerClient } from '@/lib/supabase-server'
import type { Company, NotaEmpresa, Task } from '@/types'
import { isChelseaName } from '@/lib/chelsea'
import { daysSince } from '@/lib/dates'
import { HORIZONTE_EMOJI, HORIZONTE_LABELS, compararEnColumna, estaEsperando, horizonteDe, type Horizonte } from '@/lib/horizonte'
import { correosPendientes, grupoDe, type CorreoLite } from '@/lib/correo/pendientes'
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

export async function cargarPanorama(today: string = cancunYmd(), opts: { sinChelsea?: boolean } = {}): Promise<Panorama> {
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
  // Fase 18: con el canal de Chelsea encendido, SUS tareas y SUS correos no entran en el día de Gabby
  // (van a su canal). Se quitan aquí, antes de contar, para que el resumen y la lista nunca discrepen.
  let tareas = (tasksRes.data as TareaN[]) ?? []
  let correosDelDia = correos
  if (opts.sinChelsea) {
    const empresas = new Set(((companiesRes.data as Company[]) ?? []).filter(esEmpresaDeChelsea).map((c) => c.id))
    const suyas = new Set(cuentas.filter(esCuentaDeChelsea).map((c) => c.id))
    tareas = tareas.filter((t) => !t.company_id || !empresas.has(t.company_id))
    correosDelDia = correos.filter((c) => !suyas.has(c.cuenta_id))
  }
  return panoramaDe(
    tareas,
    (companiesRes.data as Company[]) ?? [],
    (notasRes.data as NotaEmpresa[]) ?? [],
    correosDelDia,
    cuentas.map((c) => ({ id: c.id, nombre: c.nombre, company_id: c.conexion?.company_id ?? null })),
    today
  )
}


// ── Words ────────────────────────────────────────────────────────────────

export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

/**
 * Ajuste 9c-2: a task by its SHORT name — the first words of the title
 * (at most three, ~24 chars), never the whole title and never in quotes.
 * "Shift Google Ads campaign review for Q4" → "Shift Google Ads".
 */
export function nombreCorto(texto: string, max = 24): string {
  const palabras = texto.replace(/\s+/g, ' ').trim().replace(/[«»"']/g, '').split(' ')
  let out = ''
  for (const w of palabras.slice(0, 3)) {
    const sig = out ? `${out} ${w}` : w
    if (sig.length > max && out) break
    out = sig
  }
  return (out || palabras[0] || '').replace(/[.,;:]+$/, '').slice(0, max)
}

/** "9 am" · "3:30 pm" — the hour as a summary line says it. */
function horaCorta(hm: string): string {
  const [h, m] = hm.slice(0, 5).split(':').map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
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

/** Gabby's own active work: not Chelsea's, not what waits on someone. */
function propias(p: Panorama, ts: TareaN[]): TareaN[] {
  return ts.filter((t) => !estaEsperando(t) && !(p.chelseaId && t.company_id === p.chelseaId))
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

function quienEspera(t: TareaN, p: Panorama): string {
  return t.esperando_a?.trim() || (p.chelseaId && t.company_id === p.chelseaId ? 'Chelsea' : '¿de quién?')
}

// ── The summary lines (ajuste 9c-2) ──────────────────────────────────────
//   One line per horizon: symbol + count + at most ONE short fact in
//   parentheses. Lines with 0 are left out. No titles, no subjects: those
//   live in the list below. The structure is built here; the model may only
//   polish the wording (pulir).

/** 🔺 2 vencidas (la de Shift lleva 9 días) */
export function lineaVencidas(p: Panorama, ts: TareaN[] = propias(p, p.col.hoy)): string | null {
  const vencidas = ts.filter((t) => t.due_date && t.due_date < p.today).sort((a, b) => a.due_date!.localeCompare(b.due_date!))
  if (vencidas.length === 0) return null
  const vieja = vencidas[0]
  const d = daysBetween(vieja.due_date!, p.today)
  const dato = d > DIAS_MES ? `la de ${nombreCorto(vieja.text)} lleva más de un mes` : `la de ${nombreCorto(vieja.text)} lleva ${plural(d, 'día', 'días')}`
  return `🔺 ${plural(vencidas.length, 'vencida', 'vencidas')} (${dato})`
}

/** 🔸 4 para hoy, la primera a las 9 */
export function lineaHoy(p: Panorama, ts: TareaN[] = propias(p, p.col.hoy)): string | null {
  const deHoy = ts.filter((t) => t.due_date === p.today)
  if (deHoy.length === 0) return null
  const conHora = deHoy.filter((t) => t.due_time).sort((a, b) => a.due_time!.localeCompare(b.due_time!))[0]
  return `🔸 ${deHoy.length} para hoy${conHora ? `, la primera a las ${horaCorta(conHora.due_time!)}` : ''}`
}

/** ✴️ 3 urgentes sin fecha */
export function lineaUrgentes(p: Panorama, ts: TareaN[] = propias(p, p.col.hoy)): string | null {
  const urgentes = ts.filter((t) => !t.due_date)
  if (urgentes.length === 0) return null
  return `✴️ ${plural(urgentes.length, 'urgente sin fecha', 'urgentes sin fecha')}`
}

/** 📅 Mañana: 3 (la primera a las 10) */
export function lineaManana(p: Panorama, ts: TareaN[] = propias(p, p.col.manana)): string | null {
  if (ts.length === 0) return null
  const conHora = ts.filter((t) => t.due_time).sort((a, b) => a.due_time!.localeCompare(b.due_time!))[0]
  return `📅 Mañana: ${ts.length}${conHora ? ` (la primera a las ${horaCorta(conHora.due_time!)})` : ''}`
}

/** ⏳ Chelsea sigue esperando a PTHO · ⏳ 4 esperando (3 a Chelsea) */
export function lineaEsperando(p: Panorama, ts: TareaN[] = p.col.esperando): string | null {
  if (ts.length === 0) return null
  if (ts.length === 1) return `⏳ ${nombreCorto(ts[0].text)} sigue esperando a ${quienEspera(ts[0], p)}`
  const grupos = gruposEsperando({ ...p, col: { ...p.col, esperando: ts } })
  const mayor = grupos[0]
  if (mayor?.quien && mayor.tareas.length >= 2) return `⏳ ${ts.length} esperando (${mayor.tareas.length === ts.length ? 'todas' : mayor.tareas.length} a ${mayor.quien})`
  const vieja = [...ts].sort((a, b) => diasSinMover(b) - diasSinMover(a))[0]
  return `⏳ ${ts.length} esperando (la de ${nombreCorto(vieja.text)} espera a ${quienEspera(vieja, p)})`
}

/** 📧 9 correos piden respuesta (2 urgentes) */
export function lineaCorreos(p: Panorama, correos: CorreoLite[] = correosQuePiden(p)): string | null {
  if (correos.length === 0) return null
  const altas = correos.filter((c) => c.urgencia === 'alta').length
  return `📧 ${correos.length === 1 ? '1 correo pide respuesta' : `${correos.length} correos piden respuesta`}${altas > 0 ? ` (${plural(altas, 'urgente', 'urgentes')})` : ''}`
}

/** 👉 Empieza por Shift Google Ads. — ONE recommendation, by short name. */
export function lineaRecomendacion(p: Panorama, ts: TareaN[] = propias(p, p.col.hoy)): string {
  const primera = ts[0]
  if (primera) return `👉 Empieza por ${nombreCorto(primera.text)}.`
  const correo = correosQuePiden(p)[0]
  if (correo) return `👉 Empieza por el correo de ${nombreCorto(correo.de_nombre ?? correo.de_email ?? 'correo', 20)}.`
  if (p.col.manana.length > 0) return `👉 Nada urge hoy: adelanta ${nombreCorto(p.col.manana[0].text)} si quieres.`
  return '👉 Nada urge hoy. Pide «qué sigue» o el tablero.'
}

/** The six horizon lines of the day, 0s omitted. */
export function lineasDia(p: Panorama): string[] {
  return [lineaVencidas(p), lineaHoy(p), lineaUrgentes(p), lineaManana(p), lineaEsperando(p), lineaCorreos(p)].filter((l): l is string => !!l)
}

function sinNada(lineas: string[]): string[] {
  return lineas.length > 0 ? lineas : ['✨ Nada vencido ni urgente, mañana libre y nadie te tiene esperando.']
}

/** The morning summary: greeting, the horizon lines, one recommendation. At most 8 lines. */
export function resumenMananaFijo(cfg: AsistenteConfig, p: Panorama): string[] {
  return [`Buenos días, ${cfg.nombre_persona}.`, ...sinNada(lineasDia(p)), lineaRecomendacion(p)].slice(0, 8)
}

/** The evening summary: what got done, what is left per horizon, one recommendation. */
export function resumenTardeFijo(cfg: AsistenteConfig, p: Panorama, hechas: TareaN[]): string[] {
  const abiertas = p.tasks.length
  const balance = hechas.length > 0
    ? `Cerraste ${hechas.length} de ${hechas.length + abiertas} hoy 👏.`
    : abiertas > 0 ? `Hoy no se cerró nada, ${cfg.nombre_persona}.` : `Nada abierto, ${cfg.nombre_persona} 🎉.`
  const lineas = lineasDia(p)
  const hoy = propias(p, p.col.hoy)
  const cierre = hoy.length > 0
    ? `👉 ${hoy.length === 1 ? `Pasa ${nombreCorto(hoy[0].text)} a mañana` : `Pasa lo de ${nombreCorto(hoy[0].text)} a mañana`} o dime «pasa todo».`
    : '👉 Mañana arrancas limpia.'
  return [balance, ...lineas, cierre].slice(0, 8)
}

/**
 * Lets the model polish the WORDING of each line. The structure is fixed:
 * same number of lines, each keeps its leading symbol and its numbers, no
 * quotes, no titles added. 8 s, then the fixed lines.
 */
export async function pulir(cfg: AsistenteConfig, lineas: string[]): Promise<string[]> {
  try {
    llmConfig()
    const r = await preguntarLlm(
      personaPrompt(cfg) +
        '\n\nTe doy un RESUMEN en líneas. Devuelve EXACTAMENTE las mismas líneas, en el mismo orden, una por línea, puliendo solo el fraseo para que suene natural y cálido en español neutro (nunca voseo). ' +
        'Cada línea conserva su emoji inicial, sus números y sus nombres; no agregues líneas, títulos, comillas ni datos. Responde solo con las líneas.',
      `RESUMEN:\n${lineas.join('\n')}`,
      { maxTokens: 300, timeoutMs: 8_000 }
    )
    const out = r.text.split('\n').map((l) => l.trim()).filter(Boolean)
    const numeros = (s: string) => (s.match(/\d+/g) ?? []).join(',')
    const emoji = (s: string) => (s.match(/^\S+/)?.[0] ?? '')
    const ok =
      out.length === lineas.length &&
      out.every((l, i) => emoji(l) === emoji(lineas[i]) && numeros(l) === numeros(lineas[i]) && !/[«»"]/.test(l) && l.length <= 160)
    return ok ? out : lineas
  } catch (err) {
    console.warn(`[narracion] pulir: ${mensajeError(err)} — uso el fijo`)
    return lineas
  }
}

export async function resumenManana(cfg: AsistenteConfig, p: Panorama): Promise<string> {
  return (await pulir(cfg, resumenMananaFijo(cfg, p))).join('\n')
}

export async function resumenTarde(cfg: AsistenteConfig, p: Panorama, hechas: TareaN[]): Promise<string> {
  return (await pulir(cfg, resumenTardeFijo(cfg, p, hechas))).join('\n')
}

// ── Compact numbered lines (plain text) ──────────────────────────────────

function lineaTarea(n: number, t: TareaN, p: Panorama, h: Horizonte): string {
  const hora = t.due_time ? formatHoraEs(t.due_time.slice(0, 5)) : ''
  if (h === 'esperando') {
    const d = diasSinMover(t)
    return `⏳ ${n}. ${t.text} · ${empresaDe(t)} · ${quienEspera(t, p)} · ${plural(d, 'día', 'días')}`
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
  /** Plain text: the summary lines, blank line, the numbered lines (the 👉 line is the last of the summary). */
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

function narrarHoy(p: Panorama, cfg: AsistenteConfig): Narrada {
  const items: AlarmaItem[] = []
  const hoy = propias(p, p.col.hoy)
  const resumen = [`Hoy, ${formatVenceEs(p.today)}, ${cfg.nombre_persona}:`, ...sinNada([lineaVencidas(p), lineaHoy(p), lineaUrgentes(p), lineaCorreos(p)].filter((l): l is string => !!l)), lineaRecomendacion(p)]
  const lineas = listar(hoy, p, 'hoy', items)
  return { texto: bloques(resumen, lineas.length > 0 ? [`${HORIZONTE_EMOJI.hoy} ${HORIZONTE_LABELS.hoy} (${hoy.length})`, ...lineas] : null), items }
}

function narrarPendiente(p: Panorama, cfg: AsistenteConfig): Narrada {
  const items: AlarmaItem[] = []
  const hoy = propias(p, p.col.hoy)
  const total = p.tasks.length
  const cabeza = total === 0 ? `No tienes nada pendiente, ${cfg.nombre_persona} 🎉.` : `${plural(total, 'tarea abierta', 'tareas abiertas')}${p.col.despues.length > 0 ? ` (${p.col.despues.length} en Después)` : ''}, ${cfg.nombre_persona}:`
  const resumen = [cabeza, ...(total > 0 ? lineasDia(p) : []), lineaRecomendacion(p)].slice(0, 8)
  const lineas = listar(hoy, p, 'hoy', items)
  return { texto: bloques(resumen, lineas.length > 0 ? [`${HORIZONTE_EMOJI.hoy} ${HORIZONTE_LABELS.hoy} (${hoy.length})`, ...lineas] : null), items }
}

function narrarManana(p: Panorama): Narrada {
  const items: AlarmaItem[] = []
  const manana = propias(p, p.col.manana)
  const resumen = [
    lineaManana(p) ?? '📅 Mañana está libre.',
    p.col.semana.length > 0 ? `🗓 Resto de la semana: ${p.col.semana.length}` : null,
    propias(p, p.col.hoy).length > 0
      ? `👉 Si algo de hoy no sale, dime «pasa ${nombreCorto(propias(p, p.col.hoy)[0].text)} a mañana».`
      : p.col.semana.length > 0 ? `👉 ¿Adelantamos ${nombreCorto(p.col.semana[0].text)}? Dime «pasa … a mañana».` : '👉 Si quieres apartar algo para mañana, dímelo como tarea.',
  ].filter((l): l is string => !!l)
  const lineas = listar(manana, p, 'manana', items)
  return { texto: bloques(resumen, lineas.length > 0 ? [`${HORIZONTE_EMOJI.manana} ${HORIZONTE_LABELS.manana} (${manana.length}) · ${formatVenceEs(addDays(p.today, 1))}`, ...lineas] : null), items }
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
    return { texto: ['✨ Nada estancado: todo se movió en las últimas dos semanas.', '👉 ¿Vemos «qué sigue»?'].join('\n'), items }
  }
  const resumen = [
    estancadas.length > 0 ? `📦 ${plural(estancadas.length, 'sin moverse', 'sin moverse')} (la de ${nombreCorto(estancadas[0].text)} lleva ${plural(diasSinMover(estancadas[0], now), 'día', 'días')})` : null,
    esperando.length > 0 ? `⏳ ${plural(esperando.length, 'esperando desde hace días', 'esperando desde hace días')} (${nombreCorto(esperando[0].text)}: ${quienEspera(esperando[0], p)}, ${plural(diasSinMover(esperando[0], now), 'día', 'días')})` : null,
  ].filter((l): l is string => !!l)
  const lineasEst = listar(estancadas, p, 'despues', items, MAX_LINEAS)
  const lineasEsp = listar(esperando, p, 'esperando', items, 5)
  const plan: AccionResuelta[] = estancadas.slice(0, MAX_LINEAS).map((t, i) => ({
    tipo: 'despues',
    ref: `#${i + 1}`,
    tarea: { id: t.id, text: t.text, company: t.company ? { name: t.company.name } : null },
  }))
  resumen.push(plan.length > 0
    ? `👉 ¿Las paso a Después, las cancelo o les pongo alarma? Te propongo Después para ${plan.length === 1 ? 'la de arriba' : `las ${plan.length}`}; corrige lo que quieras («cancela la 2», «la 3 déjala»).`
    : `👉 Si ${quienEspera(esperando[0], p)} ya respondió, dime «la 1 ya no espera»; si no, «alarma mañana 10am seguimiento».`)
  return {
    texto: bloques(resumen, lineasEst.length > 0 ? ['📦 Sin moverse', ...lineasEst] : null, lineasEsp.length > 0 ? [`${HORIZONTE_EMOJI.esperando} Esperando desde hace días`, ...lineasEsp] : null),
    items,
    plan: plan.length > 0 ? plan : undefined,
  }
}

function narrarEmpresa(p: Panorama, nombre: string): Narrada {
  const items: AlarmaItem[] = []
  const c = p.companies.find((x) => x.name.trim().toLowerCase() === nombre.trim().toLowerCase())
  if (!c) return { texto: `No conozco la empresa ${nombre}. Las que tengo: ${p.companies.map((x) => x.name.trim()).join(', ')}.`, items }
  const name = c.name.trim()
  const mias = p.tasks.filter((t) => t.company_id === c.id)
  const sub = panoramaDe(mias, p.companies, p.notas, p.correos, p.cuentas, p.today)
  const hoy = propias(sub, sub.col.hoy)
  const cuentasDe = new Set(p.cuentas.filter((k) => k.company_id === c.id).map((k) => k.id))
  const correos = p.correos.filter((m) => cuentasDe.has(m.cuenta_id) && m.estado === 'nuevo' && grupoDe(m) !== 'resto')
  const nota = p.notas.find((n) => n.company_id === c.id)
  const resumen: string[] = [`${name}: ${mias.length === 0 ? 'nada abierto 🎉' : plural(mias.length, 'tarea abierta', 'tareas abiertas')}${sub.col.semana.length + sub.col.despues.length > 0 ? ` (${sub.col.semana.length} esta semana, ${sub.col.despues.length} en Después)` : ''}.`]
  resumen.push(...[lineaVencidas(sub), lineaHoy(sub), lineaUrgentes(sub), lineaManana(sub), lineaEsperando(sub), lineaCorreos(sub, correos)].filter((l): l is string => !!l))
  if (nota?.nota.trim()) {
    const d = daysSince(nota.updated_at)
    resumen.push(`📝 Por dónde ibas (${d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`}): ${nota.nota.replace(/\s+/g, ' ').trim().slice(0, 90)}${nota.nota.trim().length > 90 ? '…' : ''}`)
  }
  resumen.push(hoy[0]
    ? `👉 Sigue con ${nombreCorto(hoy[0].text)}; «la 1 lista» cuando esté, o «todo lo pendiente de ${name}».`
    : mias.length > 0 ? `👉 Nada urge de ${name}. ¿Te mando «todo lo pendiente de ${name}»?` : `👉 ¿Anotamos algo nuevo de ${name}? Dímelo como tarea.`)
  const lineas = listar(hoy, p, 'hoy', items, 6)
  return { texto: bloques(resumen.slice(0, 8), lineas.length > 0 ? [`${HORIZONTE_EMOJI.hoy} ${HORIZONTE_LABELS.hoy} · ${name} (${hoy.length})`, ...lineas] : null), items }
}

function narrarEsperando(p: Panorama): Narrada {
  const items: AlarmaItem[] = []
  const rows = [...p.col.esperando].sort((a, b) => diasSinMover(b) - diasSinMover(a))
  const paraChelsea = p.correos.filter((c) => c.estado === 'para_chelsea').length
  if (rows.length === 0) {
    return { texto: [`✨ Nada en manos de nadie.${paraChelsea > 0 ? ` ${plural(paraChelsea, 'correo', 'correos')} con Chelsea sin responder.` : ''}`, '👉 Cuando dejes algo en manos de alguien, dime «la de TOTT está esperando a Andrew».'].join('\n'), items }
  }
  const grupos = gruposEsperando(p)
  const resumen = [
    ...grupos.slice(0, 5).map((g) => `⏳ ${g.quien ?? 'Sin decir a quién'}: ${g.tareas.length}${g.tareas.length === 1 ? ` (${nombreCorto(g.tareas[0].text)}, ${plural(diasSinMover(g.tareas[0]), 'día', 'días')})` : ` (la más vieja lleva ${plural(diasSinMover([...g.tareas].sort((a, b) => diasSinMover(b) - diasSinMover(a))[0]), 'día', 'días')})`}`),
    paraChelsea > 0 ? `📧 ${plural(paraChelsea, 'correo con Chelsea', 'correos con Chelsea')} sin responder` : null,
    `👉 Si ${quienEspera(rows[0], p)} ya respondió, dime «la 1 ya no espera»; si no, «alarma mañana 10am seguimiento ${nombreCorto(rows[0].text, 16)}».`,
  ].filter((l): l is string => !!l).slice(0, 8)
  const lineas = listar(rows, p, 'esperando', items, 10)
  return { texto: bloques(resumen, [`${HORIZONTE_EMOJI.esperando} ${HORIZONTE_LABELS.esperando} (${rows.length})`, ...lineas]), items }
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
  const resumen = [
    conFecha === 0 ? '🗓 Esta semana no tienes nada con fecha.' : `🗓 ${plural(conFecha, 'cosa con fecha', 'cosas con fecha')} esta semana${cargado && cargado.tareas.length > 1 ? ` (el ${DIAS_LARGOS[new Date(`${cargado.d}T12:00:00Z`).getUTCDay()].toLowerCase()} es el más cargado: ${cargado.tareas.length})` : ''}`,
    vencidasAntes > 0 ? `🔺 ${plural(vencidasAntes, 'vencida', 'vencidas')} de antes` : null,
    lineaEsperando(p),
    conFecha > 0 ? '👉 Si quieres acomodar algo, dime «pasa 3 al viernes» o «la 2 para después».' : '👉 ¿Le ponemos fecha a algo de Después? Dime «paypal para el jueves».',
  ].filter((l): l is string => !!l).slice(0, 8)
  const secciones: string[][] = []
  for (const x of porDia) {
    if (x.tareas.length === 0) continue
    const [y, m, d] = x.d.split('-').map(Number)
    const nombre = DIAS_LARGOS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    const marca = x.d === p.today ? ' · hoy' : x.d < p.today ? ' · pasó' : ''
    secciones.push([`${nombre} ${d}${marca}`, ...listar(x.tareas, p, x.d <= p.today ? 'hoy' : 'manana', items, 6)])
  }
  return { texto: bloques(resumen, ...secciones), items }
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
