// Fase 4: from the interpreter's actions to what actually happens.
//   resolverAcciones  → refs become task ids, company names become ids,
//                       alarm fecha+hora become an instant; problems become
//                       `error` on the action (shown, never executed)
//   renderPlan        → the "Entendí: 1. ✅ …" list for [✅ Hacer todo]
//   ejecutarPlan      → runs every action in order, one line each
//
// Single simple actions skip the plan and run directly (see the webhook).

import { PRIORITY_LABELS } from '@/types'
import type { Cambios, TareaParsed } from '@/lib/parser'
import { cancelarTareas, ejecutarAccion, renombrarTarea } from './acciones'
import { enviarLista } from './alarmas'
import { cuentasPorTexto, enviarListaCorreos } from '@/lib/correo/listas'
import { addDays, cancunHm, cancunYmd, formatFechaHoraEs, formatHoraEs, formatVenceEs } from './cancun'
import { buscarEnAbiertas, type AccionLlm, type ContextoInterprete, type FiltroCorreo, type TareaLite } from './interprete'
import { decidirCorreo } from '@/lib/correo/decisiones'
import { aprenderNivel } from '@/lib/correo/niveles'
import { quienCorto, type CorreoLite } from '@/lib/correo/pendientes'
import { CORREO_ACCION_LABELS, CORREO_TIPO_LABELS, NIVEL_REMITENTE_EMOJI, NIVEL_REMITENTE_LABELS } from '@/types'
import { normalizar } from './acciones'
import { ejecutarNota } from './notas-bot'
import { responderPregunta } from './pregunta'
import { responderNarrada } from './narracion'
import { enviarTablero } from './tablero-imagen'
import { enviarQueSigue } from './que-sigue'
import { dejarDeEsperar, enviarListaEsperando, moverTarea } from './esperando'
import { instanteDe } from './recordatorios'
import { crearAviso } from './avisos'
import { cargarEmpresas, confirmacion, guardarTarea } from './tareas'
import { responderDeDocumentos } from '@/lib/documentos/buscar'
import { recibirNota } from '@/lib/documentos/entrada'
import { agregarACalendar, cuandoDe } from '@/lib/google/sync'
import { crearEventoLibre, describirRepeticion, primeraFechaEn } from '@/lib/google/calendar'
import { avisoCalendar } from '@/lib/google/oauth'
import { textoListaPagos } from './pagos'
import { dividirTarea, siguientePaso } from './pasos'
import { buscarParecida, claveComun, emparejarParecidas, nombradaEn, similitud } from './similitud'
import { SIMBOLO } from './alarmas'
import { mensajeError } from '@/lib/errores'

export interface TareaRef {
  id: string
  text: string
  company: { name: string } | null
}

export interface EmpresaRef {
  id: string
  name: string
}

/** An action with everything it needs resolved, or an `error` that explains why it will be skipped. */
export type AccionResuelta = AccionLlm & {
  tarea?: TareaRef
  /** 2–5 title matches: the webhook may ask with buttons (single action only). */
  candidatos?: TareaRef[]
  empresa_ref?: EmpresaRef
  /** alarma: when to fire (ISO). Missing when no hour was given. */
  dispara_en?: string
  /** crear: an open task that is the same thing (fase 7-G) — update it instead of creating. */
  existente?: TareaRef & { motivo: string }
  /** correo: the mails the decision applies to (fase 6). */
  correos?: CorreoLite[]
  error?: string
}

export const MAX_CANDIDATOS = 5

export { cuandoDe }

function lite(t: TareaLite): TareaRef {
  return { id: t.id, text: t.text, company: t.company }
}

function corto(s: string, max = 42): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// ── Resolution ──────────────────────────────────────────────────────────

type RefResuelta = { tarea: TareaRef } | { candidatos: TareaRef[] } | { error: string }

function resolverRef(ref: string, ctx: ContextoInterprete, anterior: TareaRef | null): RefResuelta {
  const r = ref.trim()
  if (/^anterior$/i.test(r) || /^la anterior$/i.test(r)) {
    return anterior ? { tarea: anterior } : { error: 'no sé cuál es "la anterior"' }
  }
  // "#3", "3", "t12", "T12" — the ids the context used.
  const num = r.match(/^#?\s*(\d+)$/)
  const key = num ? `#${num[1]}` : r.match(/^t\d+$/i) ? r.toLowerCase() : null
  if (key) {
    const t = ctx.porRef.get(key)
    if (t) return { tarea: lite(t) }
    // Ajuste 6-0: a number of the list that is a mail is never a task ("15 listo" → how to decide it).
    if (key.startsWith('#') && ctx.porRefCorreo.has(key)) {
      const n = key.slice(1)
      return { error: `el ${n} es un correo: dime "el ${n} lo hago yo", "el ${n} para Chelsea" o "archiva el ${n}"` }
    }
    return { error: `no encontré ${key.startsWith('#') ? `el ${key.slice(1)} en la última lista` : `la tarea ${key}`}` }
  }
  const hits = buscarEnAbiertas(ctx.abiertas, r)
  if (hits.length === 1) return { tarea: lite(hits[0]) }
  if (hits.length === 0) return { error: `no encontré ninguna tarea con «${r}»` }
  if (hits.length > MAX_CANDIDATOS) return { error: `«${r}» coincide con ${hits.length} tareas; dime algo más específico` }
  return { candidatos: hits.map(lite) }
}

export function resolverEmpresa(nombre: string, companies: EmpresaRef[]): EmpresaRef | null {
  const n = nombre.trim().toLowerCase()
  if (!n) return null
  const exact = companies.find((c) => c.name.trim().toLowerCase() === n)
  if (exact) return exact
  const parcial = companies.filter((c) => c.name.trim().toLowerCase().includes(n) || n.includes(c.name.trim().toLowerCase()))
  return parcial.length === 1 ? parcial[0] : null
}

/**
 * Resolves every action against the context the model saw. "anterior" starts
 * as the last task mentioned in a previous message and then follows along:
 * in "1 terminado y a la anterior ponle nota" the note goes to #1.
 *
 * Never duplicate (7-G): a "crear" whose title is really an open task becomes
 * an update of that task. One open task pairs with ONE line at most — the
 * most similar one; the other lines create new tasks. A "crear" that names a
 * task another action of the same message already moves by ref is the same
 * order said twice: it is dropped.
 */
export function resolverAcciones(acciones: AccionLlm[], ctx: ContextoInterprete, companies: EmpresaRef[]): AccionResuelta[] {
  let anterior: TareaRef | null = ctx.anterior ? lite(ctx.anterior) : null
  const out: AccionResuelta[] = []
  for (const a of acciones) {
    const r: AccionResuelta = { ...a }
    if ('ref' in a && a.ref) {
      const res = resolverRef(a.ref, ctx, anterior)
      if ('tarea' in res) {
        r.tarea = res.tarea
        anterior = res.tarea
      } else if ('candidatos' in res) {
        r.candidatos = res.candidatos
        r.error = `«${a.ref}» coincide con ${res.candidatos.length} tareas: ${res.candidatos.map((t) => `«${corto(t.text, 30)}»`).join(', ')}`
      } else {
        r.error = res.error
      }
    }
    if ((a.tipo === 'cambiar' || a.tipo === 'crear' || a.tipo === 'nota_empresa' || a.tipo === 'pagos_listar' || a.tipo === 'lista') && a.empresa) {
      const e = resolverEmpresa(a.empresa, companies)
      if (e) r.empresa_ref = e
      else if (a.tipo !== 'crear') r.error = r.error ?? `no conozco la empresa «${a.empresa}»`
    }
    if (a.tipo === 'nota_empresa' && !a.empresa) r.error = r.error ?? 'no sé de qué empresa es la nota: dime "nota IM: …"'
    if (a.tipo === 'cambiar' && !a.prioridad && !a.fecha && !a.empresa && !a.hora && !a.calendar) r.error = r.error ?? 'no dijiste qué cambiar'
    if (a.tipo === 'alarma') {
      const cuando = instanteDe(a)
      if (cuando) r.dispara_en = cuando
    }
    if (a.tipo === 'siguiente_paso' && !a.ref) {
      if (anterior) r.tarea = anterior
      else r.error = 'no sé de qué tarea: dime "siguiente paso de X"'
    }
    if (a.tipo === 'correo') {
      // A "ref" on a mail action is not a task ref: undo whatever resolverRef said.
      r.tarea = undefined
      r.candidatos = undefined
      r.error = undefined
      const res = resolverCorreos(a.ref, a.filtro, ctx)
      if ('error' in res) r.error = res.error
      else r.correos = res.correos
    }
    out.push(r)
  }
  return emparejarCrear(out, ctx)
}

/** "#15" / "c3" / "Andrew" / a filter → the mails a decision is about. */
function resolverCorreos(ref: string | undefined, filtro: FiltroCorreo | undefined, ctx: ContextoInterprete): { correos: CorreoLite[] } | { error: string } {
  if (ref) {
    const num = ref.trim().match(/^#?\s*(\d+)$/)
    const key = num ? `#${num[1]}` : ref.trim().toLowerCase()
    const directo = ctx.porRefCorreo.get(key)
    if (directo) return { correos: [directo] }
    if (/^(#\d+|c\d+)$/.test(key)) return { error: `no encontré el correo ${key}` }
    const needle = normalizar(ref)
    const hits = ctx.correos.filter((c) => normalizar(`${c.de_nombre ?? ''} ${c.de_email ?? ''} ${c.asunto ?? ''}`).includes(needle))
    if (hits.length === 1) return { correos: hits }
    if (hits.length === 0) return { error: `no encontré ningún correo de «${ref}» en los últimos 7 días` }
    if (!filtro) return { error: `«${ref}» coincide con ${hits.length} correos: ${hits.slice(0, 4).map((c) => `«${corto(c.asunto ?? '', 30)}»`).join(', ')}` }
    return { correos: aplicarFiltro(hits, filtro) }
  }
  if (!filtro) return { error: 'no sé de qué correo hablas' }
  const hits = aplicarFiltro(ctx.correos, filtro)
  if (hits.length === 0) return { error: 'no hay correos que cumplan eso' }
  return { correos: hits }
}

function aplicarFiltro(correos: CorreoLite[], f: FiltroCorreo): CorreoLite[] {
  const today = cancunYmd()
  const de = f.de ? normalizar(f.de) : null
  return correos.filter((c) => {
    if (f.tipo && c.tipo !== f.tipo) return false
    if (f.urgencia && c.urgencia !== f.urgencia) return false
    if (f.hoy && (!c.recibido_en || cancunYmd(new Date(c.recibido_en)) !== today)) return false
    if (de && !normalizar(`${c.de_nombre ?? ''} ${c.de_email ?? ''}`).includes(de)) return false
    return true
  })
}

/** Second pass over the resolved actions: which "crear" is really an open task. */
function emparejarCrear(acciones: AccionResuelta[], ctx: ContextoInterprete): AccionResuelta[] {
  const ocupadas = new Set(acciones.filter((a) => a.tipo !== 'crear' && a.tarea && !a.error).map((a) => a.tarea!.id))
  const crear = acciones.map((a, i) => (a.tipo === 'crear' ? i : -1)).filter((i) => i >= 0)
  const pares = emparejarParecidas(crear.map((i) => (acciones[i] as Extract<AccionResuelta, { tipo: 'crear' }>).titulo), ctx.abiertas, ocupadas)
  const fuera = new Set<number>()
  crear.forEach((i, k) => {
    const a = acciones[i] as Extract<AccionResuelta, { tipo: 'crear' }>
    const p = pares.get(k)
    if (p) {
      a.existente = { ...lite(p.tarea), motivo: p.motivo }
      a.tarea = lite(p.tarea)
      return
    }
    // The same task is already moved by ref in this message → said twice.
    const repetida = buscarParecida(a.titulo, ctx.abiertas.filter((t) => ocupadas.has(t.id)))
    if (repetida) fuera.add(i)
  })
  return acciones.filter((_, i) => !fuera.has(i))
}

// ── Rendering ───────────────────────────────────────────────────────────

const ICONO: Record<AccionLlm['tipo'], string> = {
  completar: '✅', cancelar: '🗑', borrar: '❌', posponer: '➡️', renombrar: '✏️', cambiar: '✏️', crear: '➕',
  nota_empresa: '📝', nota_tarea: '📎', alarma: '⏰', pregunta: '❓', que_sigue: '🎯', lista: '📋', calendar: '📅',
  pagos_listar: '💳', dividir: '🪜', siguiente_paso: '🪜', correo: '📧', esperar: '⏳', esperando: '⏳', tablero: '🖥', despues: '📦', correos_lista: '📧', evento: '📆', documentos: '📂', documento_nota: '🧠', desconocido: '🤷',
}

function fechaDicha(ymd: string, today: string): string {
  if (ymd === today) return 'para hoy'
  if (ymd === addDays(today, 1)) return 'a mañana'
  return `al ${formatVenceEs(ymd)}`
}

function describirCambios(a: Extract<AccionResuelta, { tipo: 'cambiar' }>): string {
  const out: string[] = []
  if (a.empresa_ref) out.push(a.empresa_ref.name.trim())
  if (a.prioridad) out.push(`${PRIORITY_LABELS[a.prioridad]}${a.prioridad === 'urgente' ? ' ★' : ''}`)
  if (a.fecha) out.push(a.hora ? `${formatVenceEs(a.fecha)} ${formatHoraEs(a.hora)}` : `vence ${formatVenceEs(a.fecha)}`)
  else if (a.hora) out.push(`a las ${formatHoraEs(a.hora)}`)
  return out.join(' · ')
}

/** The verb phrase of one action, without the task (so two on the same task can be joined with " y "). */
function frase(a: AccionResuelta, today: string, conTarea: boolean): string {
  const t = a.tarea ? ` «${corto(a.tarea.text)}»` : ''
  const tt = conTarea ? t : ''
  switch (a.tipo) {
    case 'completar': return `Completar${tt}`
    case 'cancelar': return `Cancelar${tt}${a.motivo ? ` (nota: ${a.motivo})` : ''}`
    case 'borrar': return `Borrar${tt} (se elimina)`
    case 'posponer': return `Pasar ${fechaDicha(a.fecha, today)}${tt}`
    case 'renombrar': return `Renombrar${tt} → «${a.titulo}»`
    case 'cambiar': return `Cambiar${tt} → ${[describirCambios(a), a.calendar ? '📅 calendar' : ''].filter(Boolean).join(' · ')}`
    case 'crear': {
      if (a.existente) {
        const cambios = [a.fecha ? (a.hora ? `${formatVenceEs(a.fecha)} ${formatHoraEs(a.hora)}` : fechaDicha(a.fecha, today).replace(/^a /, '')) : null, a.prioridad ? PRIORITY_LABELS[a.prioridad] + (a.importante ? ' ★' : '') : null].filter(Boolean)
        return `«${corto(a.existente.text)}» ya existía → ${cambios.join(' · ') || 'sin cambios'}`
      }
      const parts = [a.empresa_ref?.name.trim() ?? (a.empresa ? `empresa «${a.empresa}»?` : 'sin empresa'), PRIORITY_LABELS[a.prioridad ?? 'normal'] + (a.importante ? ' ★' : '')]
      if (a.fecha) parts.push(a.hora ? `${formatVenceEs(a.fecha)} ${formatHoraEs(a.hora)}` : `vence ${formatVenceEs(a.fecha)}`)
      if (a.calendar) parts.push(a.fecha ? `📅 calendar${a.hora ? '' : ' (todo el día)'}` : '📅 calendar (sin fecha: no se podrá)')
      return `Crear «${corto(a.titulo)}» · ${parts.join(' · ')}`
    }
    case 'nota_empresa': return `Nota de ${a.empresa_ref?.name.trim() ?? a.empresa} (${a.modo}): «${corto(a.texto, 60)}»`
    case 'nota_tarea': return `Nota en${tt}: «${corto(a.texto, 60)}»`
    case 'alarma': {
      // Fase 15: la línea dice dónde va a sonar — en su calendario, o por aquí si es un temporizador.
      const cuando = a.dispara_en ? formatFechaHoraEs(a.dispara_en) : `${a.fecha ? formatVenceEs(a.fecha) : 'hoy'} (sin hora → 9:00 am)`
      const rep = describirRepeticion(a.repetir, a.fecha ?? cancunYmd())
      return `Alarma «${corto(a.texto)}» · ${cuando}${rep ? ` · ${rep}` : ''}${a.en_minutos ? ' · por aquí' : ' · 📆 en tu calendario'}`
    }
    case 'pregunta': return `Responder «${corto(a.texto, 60)}»`
    case 'que_sigue': return `Qué sigue${a.empresa ? ` de ${a.empresa}` : ''}${a.solo_urgentes ? ' (solo urgentes)' : ''}${a.solo_vencer ? ' (por vencer)' : ''}`
    case 'lista': return a.lista === 'tarde' ? 'Mandar el cierre del día' : a.lista === 'pendientes' ? `Mandar todo lo pendiente de ${a.empresa_ref?.name.trim() ?? a.empresa ?? '?'}` : 'Mandar la lista completa de hoy'
    case 'calendar': return `Poner en calendar${tt}${a.hora ? ` a las ${formatHoraEs(a.hora)}` : a.todo_el_dia ? ' (todo el día)' : ''}`
    case 'evento': {
      // Fase 12b: "📆 Evento «Love on Hire» · jueves 2:00 pm los jueves hasta el 1 de dic · nota GL"
      const cuando = a.hora ? `${formatVenceEs(a.fecha)} ${formatHoraEs(a.hora)}` : `${formatVenceEs(a.fecha)} (todo el día)`
      const rep = describirRepeticion(a.repetir, a.fecha)
      return `Evento «${corto(a.titulo)}» · ${cuando}${rep ? ` · ${rep}` : ''}${a.nota ? ` · nota ${corto(a.nota, 30)}` : ''}`
    }
    case 'pagos_listar': return `Listar pagos${a.empresa_ref ? ` de ${a.empresa_ref.name.trim()}` : ''}${a.semana ? ' de esta semana' : ''}`
    case 'dividir': return `Dividir en pasos${tt}`
    case 'siguiente_paso': return `Siguiente paso${tt}`
    case 'correo': {
      const que = [a.accion ? CORREO_ACCION_LABELS[a.accion] : null, a.nivel ? `${NIVEL_REMITENTE_EMOJI[a.nivel]} remitente → ${NIVEL_REMITENTE_LABELS[a.nivel]}` : null].filter(Boolean).join(' + ')
      const cs = a.correos ?? []
      if (cs.length === 1) return `${que}: «${corto(cs[0].asunto ?? '(sin asunto)', 40)}» de ${quienCorto(cs[0])}`
      const filtro = a.filtro ? [a.filtro.tipo ? CORREO_TIPO_LABELS[a.filtro.tipo].toLowerCase() : null, a.filtro.urgencia, a.filtro.de ? `de ${a.filtro.de}` : null, a.filtro.hoy ? 'de hoy' : null].filter(Boolean).join(' ') : ''
      return `${que}: ${cs.length} correos${filtro ? ` (${filtro})` : ''}${cs.length > 0 ? ` — ${cs.slice(0, 3).map((c) => `«${corto(c.asunto ?? '', 25)}»`).join(', ')}${cs.length > 3 ? '…' : ''}` : ''}`
    }
    case 'esperar': return a.fin ? `Retomar${tt} (ya no espera)` : `Dejar esperando${tt}${a.quien ? ` a ${a.quien}` : ''}`
    case 'esperando': return 'Mandar la lista de ⏳ Esperando'
    case 'tablero': return 'Mandar la foto del tablero'
    case 'correos_lista': return `Mandar los correos${a.cuenta ? ` de ${a.cuenta}` : ''}${a.importante ? ' (lo importante)' : ''}`
    case 'despues': return `Pasar a Después (sin fecha)${tt}`
    case 'documentos': return `Buscar en el archivero «${corto(a.texto, 60)}»`
    case 'documento_nota': return `Archivar el dato «${corto(a.texto, 60)}»`
    case 'desconocido': return `No entendí «${corto(a.texto, 60)}»`
  }
}

/** True when an action adjacent to another on the same task reads well joined with " y ". */
function enlazable(a: AccionResuelta): boolean {
  return !!a.tarea && !a.error && ['posponer', 'renombrar', 'cambiar', 'completar', 'cancelar', 'borrar', 'nota_tarea', 'calendar', 'esperar', 'despues'].includes(a.tipo)
}

function fechaDeAccion(a: AccionResuelta): string | null | undefined {
  if (a.tipo === 'crear' || a.tipo === 'posponer' || a.tipo === 'cambiar') return a.fecha ?? null
  return undefined
}

/** Fase 7-G: a message that laid out several days — 2+ distinct dates across its items. */
export function esPlanSemana(acciones: AccionResuelta[]): boolean {
  const fechas = new Set(acciones.map(fechaDeAccion).filter((f): f is string => !!f))
  return fechas.size >= 2 && acciones.filter((a) => fechaDeAccion(a) !== undefined && !a.error).length >= 2
}

const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function cabeceraDia(ymd: string, today: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const corto = formatVenceEs(ymd)
  if (ymd === today) return `Hoy (${corto})`
  if (ymd === addDays(today, 1)) return `Mañana (${corto})`
  return `${DIAS_LARGOS[dow]} (${d})`
}

function simboloPlan(a: AccionResuelta): string {
  const pr = a.tipo === 'crear' || a.tipo === 'cambiar' ? a.prioridad : undefined
  const imp = a.tipo === 'crear' ? a.importante : false
  if (pr === 'urgente' || imp) return SIMBOLO.estrella
  if (pr === 'cuando') return SIMBOLO.cuando
  return SIMBOLO.normal
}

/** The task title a plan line is about (for matching corrections and alarms against it). */
export function tituloDe(a: AccionResuelta): string {
  if (a.tipo === 'crear') return a.existente ? a.existente.text : a.titulo
  if (a.tipo === 'evento') return a.titulo
  if (a.tipo === 'alarma') return a.texto
  if (a.tipo === 'correo') return (a.correos ?? []).map((c) => `${c.de_nombre ?? c.de_email ?? ''} ${c.asunto ?? ''}`).join(' · ')
  return a.tarea?.text ?? ('ref' in a && a.ref ? a.ref : '')
}

/** Every name a line answers to: the open task's title and, for a "crear", what she actually said. */
export function nombresDe(a: AccionResuelta): string[] {
  const out = [tituloDe(a)]
  if (a.tipo === 'crear' && a.existente) out.push(a.titulo)
  return out.filter(Boolean)
}

/** How much a phrase is about a plan line: the best of its names. */
export function afinidad(frase: string, a: AccionResuelta): number {
  return Math.max(0, ...nombresDe(a).map((n) => similitud(frase, n)))
}

/** The Cancún date an alarm fires on (null when it has none yet). */
function fechaDeAlarma(a: Extract<AccionResuelta, { tipo: 'alarma' }>): string | null {
  if (a.dispara_en) return cancunYmd(new Date(a.dispara_en))
  return a.fecha ?? null
}

/** "10:00" of an alarm, from its instant or the hour she said. */
function horaDeAlarma(a: Extract<AccionResuelta, { tipo: 'alarma' }>): string | null {
  if (a.dispara_en) return cancunHm(new Date(a.dispara_en))
  return a.hora ?? null
}

/**
 * An alarm about one of the plan's tasks ("el miércoles a las 10 lo de
 * marketing y recuérdamelo") belongs on that task's line: ⏰ 10:00 am there,
 * nothing repeated below. Returns alarm index → task-line index.
 */
export function emparejarAlarmas(acciones: AccionResuelta[]): Map<number, number> {
  const out = new Map<number, number>()
  const tomadas = new Set<number>()
  acciones.forEach((a, i) => {
    if (a.tipo !== 'alarma' || a.error) return
    const dia = fechaDeAlarma(a)
    let mejor: { j: number; s: number } | null = null
    acciones.forEach((b, j) => {
      if (tomadas.has(j) || b.error || (b.tipo !== 'crear' && b.tipo !== 'posponer' && b.tipo !== 'cambiar')) return
      const fb = fechaDeAccion(b)
      if (dia && fb && fb !== dia) return
      const s = afinidad(a.texto, b)
      if (s < 0.6 && !nombresDe(b).some((n) => claveComun(a.texto, n))) return
      if (!mejor || s > mejor.s) mejor = { j, s }
    })
    if (mejor) {
      out.set(i, (mejor as { j: number }).j)
      tomadas.add((mejor as { j: number }).j)
    }
  })
  return out
}

export interface OpcionesLinea {
  /** Put "· mié 4" in the line (a flat list without day headers). */
  conFecha?: boolean
  /** The alarm paired with this line, if any: its hour goes here as ⏰. */
  alarma?: Extract<AccionResuelta, { tipo: 'alarma' }> | null
  today?: string
}

/** 'mié 4' for a line inside a flat list. */
function diaCorto(ymd: string, today: string): string {
  if (ymd === today) return 'hoy'
  if (ymd === addDays(today, 1)) return 'mañana'
  return formatVenceEs(ymd).replace(/ \w+$/, '')
}

/**
 * One task line of a plan by days:
 *   ▫️ Marketing Team · DATAVIA · ⏰ 10:00 am (ya existía, la muevo)
 * With `conFecha`: "… · mié 4 · ⏰ 10:00 am".
 */
export function lineaSemana(a: AccionResuelta, opts: OpcionesLinea = {}): string {
  const today = opts.today ?? cancunYmd()
  const titulo = tituloDe(a) || '?'
  const empresa = a.tipo === 'crear' ? (a.existente?.company?.name ?? a.empresa_ref?.name.trim() ?? (a.empresa ? `${a.empresa}?` : 'sin empresa')) : a.tarea?.company?.name ?? 'sin empresa'
  const f = fechaDeAccion(a)
  const fecha = opts.conFecha ? (f ? ` · ${diaCorto(f, today)}` : ' · sin fecha') : ''
  const propia = (a.tipo === 'crear' || a.tipo === 'cambiar') && a.hora ? a.hora : null
  const alarma = opts.alarma ? horaDeAlarma(opts.alarma) : null
  const horas = [propia && propia !== alarma ? formatHoraEs(propia) : null, alarma ? `⏰ ${formatHoraEs(alarma)}` : null].filter(Boolean)
  const hora = horas.length > 0 ? ` · ${horas.join(' · ')}` : ''
  const nota = a.error ? ` ⚠️ ${a.error}` : a.tipo === 'crear' && a.existente ? ' (ya existía, la muevo)' : a.tipo === 'posponer' || a.tipo === 'cambiar' ? ' (la muevo)' : ''
  return `${simboloPlan(a)} ${corto(titulo, 50)} · ${empresa}${fecha}${hora}${nota}`
}

/**
 * The week, grouped by day instead of by action:
 *   Mañana (lun 2): ✴️ Correos de Chelsea · IM
 *   Miércoles (4):  ▫️ Armar equipo de marketing · DATAVIA · ⏰ 10:00 am
 * An item that matched an existing task says so ("ya existía"). An alarm
 * about one of these tasks shows as ⏰ on its line, not under "También".
 */
export function renderPlanSemana(acciones: AccionResuelta[], today: string = cancunYmd()): string {
  const porDia = new Map<string, string[]>()
  const otros: string[] = []
  const alarmas = emparejarAlarmas(acciones)
  const alarmaDe = new Map(Array.from(alarmas.entries()).map(([i, j]) => [j, acciones[i] as Extract<AccionResuelta, { tipo: 'alarma' }>]))
  acciones.forEach((a, i) => {
    if (alarmas.has(i)) return
    const f = fechaDeAccion(a)
    if (f === undefined) otros.push(`${ICONO[a.tipo]} ${frase(a, today, true)}`)
    else porDia.set(f ?? '', [...(porDia.get(f ?? '') ?? []), lineaSemana(a, { alarma: alarmaDe.get(i) ?? null, today })])
  })
  const dias = Array.from(porDia.keys()).sort((x, y) => (x === '' ? 1 : y === '' ? -1 : x.localeCompare(y)))
  const bloques = dias.map((f) => `${f ? cabeceraDia(f, today) : 'Sin fecha'}:\n${porDia.get(f)!.map((l) => `  ${l}`).join('\n')}`)
  return ['Así queda tu semana:', ...bloques, ...(otros.length > 0 ? ['También:', ...otros.map((o) => `  ${o}`)] : [])].join('\n')
}

const PIDE_ACOMODAR = /\b(?:acomoda|reacomoda|reorganiza|reordena|mueve)\s+(?:el\s+resto|lo\s+dem[aá]s|las\s+dem[aá]s|todo\s+lo\s+dem[aá]s)\b|\bacomoda\s+el\s+resto\b/i

/** Was this task named in the message (its title, a specific keyword of it — even misspelled — or its number)? */
function nombrada(a: AccionResuelta, mensaje: string): boolean {
  if (!a.tarea) return true
  if ('ref' in a && a.ref) {
    const num = a.ref.match(/^#?\s*(\d+)$/)
    if (num && new RegExp(`(^|[^0-9])${num[1]}([^0-9]|$)`).test(mensaje)) return true
  }
  return nombradaEn(a.tarea.text, mensaje)
}

/**
 * Fase 7-G rule: in a plan by days, ONLY tasks the message names are created
 * or moved. A posponer/cambiar on a task the message never mentioned is
 * dropped (shown as "no la nombraste"), unless she asked "acomoda el resto".
 */
export function soloLasNombradas(acciones: AccionResuelta[], mensaje: string): AccionResuelta[] {
  if (PIDE_ACOMODAR.test(mensaje)) return acciones
  return acciones.map((a) => {
    if ((a.tipo === 'posponer' || a.tipo === 'cambiar') && a.tarea && !a.error && !nombrada(a, mensaje)) {
      return { ...a, error: 'no la nombraste, no la toco (di "acomoda el resto" si quieres que la mueva)' }
    }
    return a
  })
}

/** The ONE line under a week plan: what is missing, if anything. */
export function sugerenciaPlanSemana(acciones: AccionResuelta[]): string | null {
  const nuevas = acciones.filter((a): a is Extract<AccionResuelta, { tipo: 'crear' }> => a.tipo === 'crear' && !a.existente && !a.error)
  const sinEmpresa = nuevas.find((a) => !a.empresa_ref)
  if (sinEmpresa) return `💡 A «${corto(sinEmpresa.titulo, 40)}» le falta empresa: dime "${corto(sinEmpresa.titulo, 25)} es de IM" y la apunto.`
  if (nuevas.length > 0 && nuevas.every((a) => !a.hora)) return '💡 Si alguna tiene hora, dímelo ("la de marketing a las 10") y, si quieres, la pongo en calendar.'
  return null
}

/**
 * "Entendí:\n1. ✅ Completar «…»\n2. 🗑 Cancelar «…» (nota: …)\n…". Adjacent
 * actions on the same task share a line ("Renombrar «…» → «…» y pasar mañana").
 */
export function renderPlan(acciones: AccionResuelta[], today: string = cancunYmd()): string {
  const lines: string[] = []
  // An alarm about a task of the plan rides on that task's line as ⏰.
  const alarmas = emparejarAlarmas(acciones)
  const alarmaDe = new Map(Array.from(alarmas.entries()).map(([i, j]) => [j, acciones[i] as Extract<AccionResuelta, { tipo: 'alarma' }>]))
  let i = 0
  while (i < acciones.length) {
    const a = acciones[i]
    if (alarmas.has(i)) {
      i += 1
      continue
    }
    if (a.error) {
      lines.push(`⚠️ ${frase(a, today, false)}: ${a.error} (no se hará)`)
      i += 1
      continue
    }
    let line = `${ICONO[a.tipo]} ${frase(a, today, true)}`
    const alarma = alarmaDe.get(i)
    const hora = alarma ? horaDeAlarma(alarma) : null
    if (hora) line += ` · ⏰ ${formatHoraEs(hora)}`
    let j = i + 1
    while (j < acciones.length && enlazable(a) && enlazable(acciones[j]) && acciones[j].tarea!.id === a.tarea!.id) {
      const f = frase(acciones[j], today, false)
      line += ` y ${f.charAt(0).toLowerCase()}${f.slice(1)}`
      j += 1
    }
    lines.push(line)
    i = j
  }
  return ['Entendí:', ...lines.map((l, n) => `${n + 1}. ${l}`)].join('\n')
}

/** A line of a plan as the corrected view shows it: by-days style with the date, or the numbered style. */
export function lineaCorreccion(a: AccionResuelta, semana: boolean, alarma: Extract<AccionResuelta, { tipo: 'alarma' }> | null, today: string = cancunYmd()): string {
  if (semana && fechaDeAccion(a) !== undefined) return lineaSemana(a, { conFecha: true, alarma, today })
  if (a.error) return `⚠️ ${frase(a, today, false)}: ${a.error} (no se hará)`
  const hora = alarma ? horaDeAlarma(alarma) : null
  return `${ICONO[a.tipo]} ${frase(a, today, true)}${hora ? ` · ⏰ ${formatHoraEs(hora)}` : ''}`
}

// ── Execution ───────────────────────────────────────────────────────────

/**
 * Fase 4 rule: the plan needs an OK when there are 2+ actions or any of them
 * cancels. A single "borrar" is not here: it goes through the classic
 * [Sí, borrar] [No] in the webhook instead.
 */
export function necesitaConfirmacion(acciones: AccionResuelta[]): boolean {
  const reales = acciones.filter((a) => a.tipo !== 'desconocido')
  // Fase 6: a decision over several mails at once ("archiva los de marketing") is shown first.
  return reales.length >= 2 || reales.some((a) => a.tipo === 'cancelar' || (a.tipo === 'correo' && (a.correos?.length ?? 0) >= 2))
}

/**
 * Ajuste 15b: a "plan" where no line can run — every one is an error ("no sé
 * cuál es la anterior"), a question or something not understood. It is not a
 * plan: showing it with [Hacer todo] and leaving it waiting only makes the
 * NEXT message be read as a correction of nothing.
 */
export function sinNadaQueHacer(acciones: AccionResuelta[]): boolean {
  return acciones.every((a) => !!a.error || a.tipo === 'pregunta' || a.tipo === 'desconocido')
}

function tareaDe(a: AccionResuelta): TareaRef {
  if (!a.tarea) throw new Error('acción sin tarea resuelta')
  return a.tarea
}

export function tareaParsedDe(a: Extract<AccionResuelta, { tipo: 'crear' }>): TareaParsed {
  return {
    text: a.titulo,
    priority: a.prioridad ?? null,
    company_id: a.empresa_ref?.id ?? null,
    company_name: a.empresa_ref?.name.trim() ?? null,
    importante: a.importante === true || a.prioridad === 'urgente',
    due_date: a.fecha ?? null,
    due_time: a.fecha && a.hora ? a.hora : null,
    calendar: a.calendar === true,
  }
}

/**
 * Runs ONE resolved action and returns its confirmation line(s). Inside a
 * plan a "crear" without company/priority saves as is (Sin empresa · Normal)
 * instead of asking — the plan was already shown and approved.
 */
export async function ejecutarUna(chatId: number, a: AccionResuelta): Promise<string> {
  if (a.error) return `⚠️ ${frase(a, cancunYmd(), false)}: ${a.error}`
  switch (a.tipo) {
    case 'completar':
      return ejecutarAccion({ accion: 'listo' }, [tareaDe(a).id])
    case 'cancelar':
      return cancelarTareas([tareaDe(a).id], a.motivo)
    case 'borrar':
      // Only reached from an approved plan (the "❌ Borrar" line was shown);
      // a single "bórralo" asks [Sí, borrar] [No] in the webhook first.
      return ejecutarAccion({ accion: 'borra' }, [tareaDe(a).id])
    case 'posponer': {
      const today = cancunYmd()
      if (a.fecha === addDays(today, 1)) return ejecutarAccion({ accion: 'pasa' }, [tareaDe(a).id])
      return ejecutarAccion({ accion: 'editar', cambios: { due_date: a.fecha } }, [tareaDe(a).id])
    }
    case 'renombrar':
      return renombrarTarea(tareaDe(a).id, a.titulo)
    case 'cambiar': {
      const cambios: Cambios = {}
      if (a.prioridad) {
        cambios.priority = a.prioridad
        if (a.prioridad === 'urgente') cambios.importante = true
      }
      if (a.fecha) cambios.due_date = a.fecha
      if (a.hora) cambios.due_time = a.hora
      if (a.calendar) cambios.calendar = true
      if (a.empresa_ref) {
        cambios.company_id = a.empresa_ref.id
        cambios.company_name = a.empresa_ref.name.trim()
      }
      return ejecutarAccion({ accion: 'editar', cambios }, [tareaDe(a).id])
    }
    case 'crear': {
      if (a.existente) {
        // Fase 7-G: the same thing already exists — move/raise it instead of duplicating.
        const cambios: Cambios = {}
        if (a.fecha) cambios.due_date = a.fecha
        if (a.hora) cambios.due_time = a.hora
        if (a.prioridad) {
          cambios.priority = a.prioridad
          if (a.prioridad === 'urgente' || a.importante) cambios.importante = true
        }
        if (a.calendar) cambios.calendar = true
        const r = Object.keys(cambios).length > 0 ? await ejecutarAccion({ accion: 'editar', cambios }, [a.existente.id]) : `«${a.existente.text}» ya existía; sin cambios.`
        return `«${a.existente.text}» ya existía: ${r.replace(/^✏️ /, '')}`
      }
      const t = tareaParsedDe(a)
      const g = await guardarTarea(t)
      // So the thread can refer to it ("la de marketing a las 10").
      a.tarea = { id: g.id, text: t.text, company: a.empresa_ref ? { name: a.empresa_ref.name } : null }
      // Inside an approved plan an event without an hour is all-day (the plan said so).
      const sync = g.faltaHora ? await agregarACalendar(g.id, { todoElDia: true }) : g.sync
      const linea = confirmacion(t, sync)
      return sync?.confirmacion ? `${linea}\n${sync.confirmacion}` : linea
    }
    case 'dividir':
      return dividirTarea(tareaDe(a).id)
    case 'siguiente_paso':
      return siguientePaso(tareaDe(a).id)
    case 'nota_empresa': {
      if (!a.empresa_ref) return `⚠️ No conozco la empresa «${a.empresa}»`
      return ejecutarNota({ company_id: a.empresa_ref.id, company_name: a.empresa_ref.name.trim(), modo: a.modo, texto: a.texto })
    }
    case 'nota_tarea':
      return ejecutarAccion({ accion: 'nota_tarea', texto: a.texto }, [tareaDe(a).id])
    case 'alarma': {
      // No hour inside an approved plan → 9:00 am (the plan said so).
      const cuando = a.dispara_en ?? instanteDe({ fecha: a.fecha, hora: '09:00' })!
      // Fase 15: con hora → Google Calendar (suena en el teléfono); "en 20 minutos" → por aquí.
      return crearAviso(chatId, { texto: a.texto, dispara_en: cuando, repetir: a.repetir ?? null, temporizador: !!a.en_minutos })
    }
    case 'pregunta': {
      // Fase 9c-D: the known questions get prose (no model); the rest, the LLM answer.
      const n = await responderNarrada(chatId, a.texto)
      return n ? n.texto : responderPregunta(chatId, a.texto)
    }
    case 'que_sigue':
      // Sent as its own HTML message, like the lists.
      await enviarQueSigue(chatId, { empresa: a.empresa, solo_urgentes: a.solo_urgentes, solo_vencer: a.solo_vencer })
      return '🎯 (enviado arriba)'
    case 'lista':
      // Sent as its own HTML message (same builder as the cron); nothing to add here.
      await enviarLista(chatId, a.lista, a.empresa_ref ?? null)
      return a.lista === 'tarde' ? '📋 (cierre enviado arriba)' : '📋 (lista enviada arriba)'
    case 'calendar': {
      // In a plan, no hour → all-day (a single action asks with buttons in the webhook).
      const r = await agregarACalendar(tareaDe(a).id, { hora: a.hora ?? null, todoElDia: !a.hora })
      return r.confirmacion ?? r.aviso ?? '📅 sin cambios'
    }
    case 'evento': {
      // Fase 12b: straight to Calendar, no task. A weekly repeat starts on the first matching weekday.
      const fecha = a.repetir?.cada === 'semana' && a.repetir.dias && a.repetir.dias.length > 0 ? primeraFechaEn(a.fecha, a.repetir.dias) : a.fecha
      try {
        const r = await crearEventoLibre({ titulo: a.titulo, fecha, hora: a.hora ?? null, duracion_min: a.duracion_min, nota: a.nota ?? null, repetir: a.repetir ?? null })
        const cuando = a.hora ? `${formatVenceEs(fecha)} ${formatHoraEs(a.hora)}` : `${formatVenceEs(fecha)} (todo el día)`
        const rep = describirRepeticion(a.repetir, fecha)
        return `📆 En Calendar: «${a.titulo}» · ${cuando}${rep ? ` · ${rep}` : ''}${a.nota ? ` · nota ${a.nota}` : ''}${r.link ? ` · <a href="${r.link}">abrir</a>` : ''}`
      } catch (err) {
        console.error(`[plan] evento: ${mensajeError(err)}`)
        return avisoCalendar(err)
      }
    }
    case 'pagos_listar':
      return textoListaPagos(a.empresa_ref?.id ?? null, a.empresa_ref?.name.trim() ?? null, { semana: a.semana === true })
    case 'correo': {
      const out: string[] = []
      const aprendidas = new Set<string>()
      for (const c of a.correos ?? []) {
        try {
          if (a.accion) out.push((await decidirCorreo(c.id, a.accion)).texto)
          if (a.nivel) {
            // Ajuste 6c: the sender goes on the list once, even if several of its mails were named.
            const r = await aprenderNivel(c.id, a.nivel)
            if (!r.clave || !aprendidas.has(r.clave)) out.push(r.texto)
            if (r.clave) aprendidas.add(r.clave)
          }
        } catch (err) {
          out.push(`⚠️ «${corto(c.asunto ?? '', 40)}»: ${mensajeError(err)}`)
        }
      }
      return out.join('\n') || '📧 ningún correo'
    }
    case 'esperar':
      // Fase 9: the same write the board's ⏳ column does.
      return a.fin ? dejarDeEsperar([tareaDe(a).id]) : moverTarea([tareaDe(a).id], 'esperando', { esperando_a: a.quien ?? null })
    case 'esperando':
      await enviarListaEsperando(chatId)
      return '⏳ (lista enviada arriba)'
    case 'tablero':
      // Fase 9c-B: the picture goes as its own message.
      await enviarTablero(chatId)
      return '🖥 (tablero enviado arriba)'
    case 'despues':
      return moverTarea([tareaDe(a).id], 'despues')
    case 'correos_lista': {
      // Ajuste 9c-1: the mailbox by partial name; several matches → say which, nothing sent.
      const hits = a.cuenta ? await cuentasPorTexto(a.cuenta) : []
      if (a.cuenta && hits.length !== 1) return hits.length === 0 ? `No tengo una cuenta de correo «${a.cuenta}».` : `«${a.cuenta}» puede ser ${hits.map((c) => c.nombre).join(' o ')}: dime cuál.`
      await enviarListaCorreos(chatId, hits[0] ?? null, { importante: a.importante === true })
      return '📧 (correos enviados arriba)'
    }
    case 'documentos': {
      // Fase 14/15: la respuesta trae su enlace firmado; el motor la manda como HTML seguro.
      const r = await responderDeDocumentos(a.texto)
      return r.texto
    }
    case 'documento_nota': {
      const s = await recibirNota(chatId, a.texto, await cargarEmpresas())
      return s.texto
    }
    case 'desconocido':
      return `🤷 No entendí «${corto(a.texto, 60)}»`
  }
}

/** Runs the whole plan in order; a failure in one line never stops the rest. */
export async function ejecutarPlan(chatId: number, acciones: AccionResuelta[]): Promise<string> {
  const lines: string[] = []
  for (const a of acciones) {
    try {
      lines.push(await ejecutarUna(chatId, a))
    } catch (err) {
      const motivo = mensajeError(err)
      console.error(`[plan] ${a.tipo} falló: ${motivo}`)
      lines.push(`⚠️ ${frase(a, cancunYmd(), true)}: falló (${motivo})`)
    }
  }
  return lines.join('\n')
}

/** For the log: the ids the message touched, so "la anterior" works next time. */
export function resumenParaLog(acciones: AccionResuelta[]): string {
  const ids = acciones.filter((a) => a.tarea && !a.error).map((a) => a.tarea!.id)
  const ultima = ids.length > 0 ? ids[ids.length - 1] : null
  return JSON.stringify({
    ultima_tarea_id: ultima,
    acciones: acciones.map((a) => ({
      ...a,
      tarea: a.tarea ? { id: a.tarea.id, text: a.tarea.text } : undefined,
      correos: a.correos ? a.correos.map((c) => ({ id: c.id, asunto: c.asunto })) : undefined,
      candidatos: undefined,
      empresa_ref: a.empresa_ref ? a.empresa_ref.name : undefined,
    })),
  })
}
