// Ajuste 7-G: correcting a plan that is waiting for [✅ Así queda].
//
// A correction never deletes or completes a task — it only changes the plan:
//   "quita el X repetido"      → one line of X stays, the extra one goes
//   "quita X" / "sin X"        → X's line leaves the plan (the task is untouched)
//   "déjala donde estaba"      → the line that moved an existing task leaves the plan
//   "olvida lo anterior" / "no" → the whole pending plan is discarded
// Anything else ("la de marketing a las 10", "lo de WSH el viernes") goes
// through the interpreter and is MERGED into the pending plan: the line it
// names changes, the rest stays as it was. The corrected plan shows only
// what changed. When a correction could mean two things, the bot asks with
// buttons; "borra X" on a pending plan is one of those.

import { normalizar } from './acciones'
import { cancunYmd } from './cancun'
import { afinidad, emparejarAlarmas, esPlanSemana, lineaCorreccion, nombresDe, tituloDe, type AccionResuelta, type EmpresaRef } from './plan'
import { instanteDe } from './recordatorios'
import { claveComun, similitud } from './similitud'

export type Correccion =
  | { tipo: 'descartar'; limpiarHilo: boolean }
  | { tipo: 'quitar'; termino: string; repetida: boolean; verbo: 'quitar' | 'borrar' }
  | { tipo: 'dejar'; termino: string | null }

const RE_DESCARTAR =
  /^(?:(?:mejor\s+)?no|nada|no,?\s*nada|asi\s+no|no\s+hagas\s+nada|no\s+lo\s+hagas|olvida(?:lo|te)?(?:\s+(?:de\s+)?(?:lo\s+)?(?:anterior|todo|eso|el\s+plan))?|olvidalo|cancela(?:r|lo)?(?:\s+(?:el|ese|todo\s+el)\s+plan)?|descarta(?:lo)?(?:\s+(?:el|ese)\s+plan)?|(?:borra|quita|elimina)(?:lo)?\s+(?:el|ese|todo\s+el)\s+plan|empezamos\s+de\s+cero|empecemos\s+de\s+nuevo|empezamos\s+de\s+nuevo|borron\s+y\s+cuenta\s+nueva)$/
const RE_QUITAR = /^(?:quita(?:me|le|lo|la)?|saca(?:me|lo|la)?|elimina(?:me|lo|la)?|borra(?:me|lo|la)?|sin)\s+(.+)$/
const RE_REPETIDA_SUFIJO = /^(.+?)\s+(?:(?:que\s+)?(?:esta|sale|aparece|viene)\s+)?(?:repetid[oa]s?|duplicad[oa]s?|dos\s+veces|doble)$/
const RE_REPETIDA_PREFIJO = /^(?:el|la|lo)\s+(?:repetid[oa]|duplicad[oa])\s+(?:de\s+)?(.+)$/
const RE_SALE_REPETIDA = /^(?:(?:el|la|lo|los|las)\s+)?(.+?)\s+(?:esta|sale|aparece|viene)\s+(?:repetid[oa]s?|duplicad[oa]s?|dos\s+veces|doble)$/
const RE_DEJAR = /^(?:(?:a\s+)?(.+?)\s+)?(?:dejala|dejalo|dejalas|dejalos|deja(?:me)?(?:\s+(?:la|lo|esa|ese|esta|este|a))?)\s+(?:donde|como)\s+(?:estaba|esta|estaban|estan)$/
const RE_NO_MOVER = /^(?:no\s+(?:la|lo|las|los)\s+(?:muevas|toques)|no\s+muevas\s+(?:la|lo|el|a|las|los)?\s*(.+)|(.+?)\s+no\s+(?:se\s+mueve|la\s+muevas|lo\s+muevas|se\s+toca|la\s+toques|lo\s+toques)|(.+?)\s+se\s+queda(?:\s+(?:donde|como)\s+(?:esta|estaba))?)$/

function limpiarTermino(t: string): string {
  return t
    .replace(/\s+(?:del\s+plan|de\s+la\s+lista|de\s+ahi|de\s+aqui|de\s+la\s+semana|de\s+arriba)$/, '')
    .replace(/^(?:la\s+tarea\s+de|la\s+tarea|el\s+de|la\s+de|lo\s+de|los\s+de|las\s+de|el|la|lo|los|las|al|a|de|que)\s+/, '')
    .replace(/^(?:el\s+de|la\s+de|lo\s+de|el|la|lo)\s+/, '')
    .trim()
}

/** The rule-based corrections. Null → let the interpreter read it. */
export function leerCorreccion(texto: string): Correccion | null {
  const n = normalizar(texto).replace(/[.!¡¿?,;:]+$/, '').replace(/\s+/g, ' ').trim()
  if (!n) return null
  if (RE_DESCARTAR.test(n)) return { tipo: 'descartar', limpiarHilo: /^(?:olvida|empe|borron)/.test(n) }

  const d = n.match(RE_DEJAR)
  if (d) return { tipo: 'dejar', termino: d[1] ? limpiarTermino(d[1]) || null : null }
  const nm = n.match(RE_NO_MOVER)
  if (nm) {
    const t = nm[1] ?? nm[2] ?? nm[3]
    return { tipo: 'dejar', termino: t ? limpiarTermino(t) || null : null }
  }

  const q = n.match(RE_QUITAR)
  if (q) {
    const verbo = /^(?:borra|elimina)/.test(n) ? 'borrar' : 'quitar'
    let rest = q[1].replace(/\s+(?:del\s+plan|de\s+la\s+lista|de\s+ahi|de\s+aqui)$/, '')
    let repetida = false
    const suf = rest.match(RE_REPETIDA_SUFIJO)
    const pre = rest.match(RE_REPETIDA_PREFIJO)
    if (pre) {
      rest = pre[1]
      repetida = true
    } else if (suf) {
      rest = suf[1]
      repetida = true
    }
    const termino = limpiarTermino(rest)
    if (!termino) return { tipo: 'dejar', termino: null }
    return { tipo: 'quitar', termino, repetida, verbo }
  }
  const sr = n.match(RE_SALE_REPETIDA)
  if (sr) return { tipo: 'quitar', termino: limpiarTermino(sr[1]), repetida: true, verbo: 'quitar' }
  return null
}

// ── Which lines ──────────────────────────────────────────────────────────

/** Is this plan line about `termino` (title, keyword, or near enough)? */
function trata(a: AccionResuelta, termino: string): boolean {
  const t = normalizar(termino)
  if (/^(?:la\s+)?alarmas?$/.test(t)) return a.tipo === 'alarma'
  return nombresDe(a).some((nombre) => {
    const titulo = normalizar(nombre)
    if (titulo.includes(t) || (t.length >= 4 && t.includes(titulo))) return true
    if (claveComun(t, titulo)) return true
    return similitud(t, titulo) >= 0.6
  })
}

/** Indexes of the plan lines about `termino`. An alarm riding on a task line is not a line of its own. */
export function lineasCon(acciones: AccionResuelta[], termino: string): number[] {
  const montadas = /^(?:la\s+)?alarmas?$/.test(normalizar(termino)) ? new Set<number>() : new Set(emparejarAlarmas(acciones).keys())
  return acciones.map((a, i) => (!montadas.has(i) && trata(a, termino) ? i : -1)).filter((i) => i >= 0)
}

/** Lines that move or change a task that already exists (what "déjala donde estaba" is about). */
function mueveExistente(a: AccionResuelta): boolean {
  if (a.error) return false
  return (a.tipo === 'crear' && !!a.existente) || a.tipo === 'posponer' || a.tipo === 'cambiar' || a.tipo === 'calendar'
}

// ── Results ──────────────────────────────────────────────────────────────

export interface ResultadoPlan {
  tipo: 'plan'
  acciones: AccionResuelta[]
  quitadas: AccionResuelta[]
  cambiadas: AccionResuelta[]
  agregadas: AccionResuelta[]
}

export interface OpcionDuda {
  texto: string
  resultado: ResultadoPlan | { tipo: 'igual'; texto: string }
  /** Run this for real before continuing with the plan (she chose it by button). */
  ejecutar?: AccionResuelta
}

export type Resultado =
  | ResultadoPlan
  | { tipo: 'duda'; pregunta: string; opciones: OpcionDuda[] }
  | { tipo: 'igual'; texto: string }
  | { tipo: 'descartar'; limpiarHilo: boolean }

export const MAX_OPCIONES = 5

function corto(s: string, max = 28): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Drops the given lines; an alarm that rode on one of them goes too unless another line of the plan takes it. */
function sinLineas(plan: AccionResuelta[], fuera: number[]): ResultadoPlan {
  const quitar = new Set(fuera)
  const antes = emparejarAlarmas(plan)
  const quedan = plan.filter((_, i) => !quitar.has(i))
  const despues = new Set(Array.from(emparejarAlarmas(quedan).keys()).map((i) => quedan[i]))
  for (const [i, j] of Array.from(antes.entries())) if (quitar.has(j) && !despues.has(plan[i])) quitar.add(i)
  return {
    tipo: 'plan',
    acciones: plan.filter((_, i) => !quitar.has(i)),
    quitadas: plan.filter((_, i) => quitar.has(i)),
    cambiadas: [],
    agregadas: [],
  }
}

const DEJAR_IGUAL: OpcionDuda = { texto: '↩️ Dejar el plan como está', resultado: { tipo: 'igual', texto: 'Ok, el plan sigue igual.' } }

/** Among several lines about the same task, the one to keep: the one that touches the existing task, else the first. */
function cualConservar(plan: AccionResuelta[], idx: number[]): number {
  return idx.find((i) => plan[i].tarea && !plan[i].error) ?? idx[0]
}

/** Applies a rule-based correction to the pending plan. */
export function aplicarCorreccion(plan: AccionResuelta[], c: Correccion): Resultado {
  if (c.tipo === 'descartar') return { tipo: 'descartar', limpiarHilo: c.limpiarHilo }

  if (c.tipo === 'quitar') {
    const idx = lineasCon(plan, c.termino)
    if (idx.length === 0) return { tipo: 'igual', texto: `No veo «${c.termino}» en el plan. Dímelo como aparece arriba.` }
    if (c.repetida) {
      // One stays (the one that moves the existing task); with a single line, that line IS the duplicate of a task that already exists.
      if (idx.length === 1) return sinLineas(plan, idx)
      const conservar = cualConservar(plan, idx)
      return sinLineas(plan, idx.filter((i) => i !== conservar))
    }
    if (idx.length === 1) {
      const a = plan[idx[0]]
      if (c.verbo === 'borrar' && a.tarea && a.tipo !== 'alarma') {
        // "borra X" while a plan waits: out of the plan, or really deleted? Never guess.
        return {
          tipo: 'duda',
          pregunta: `¿Quito «${a.tarea.text}» del plan, o de verdad borro la tarea?`,
          opciones: [
            { texto: '✂️ Solo quitarla del plan', resultado: sinLineas(plan, idx) },
            { texto: '❌ Borrar la tarea de verdad', resultado: sinLineas(plan, idx), ejecutar: { tipo: 'borrar', ref: a.tarea.id, tarea: a.tarea } },
            DEJAR_IGUAL,
          ],
        }
      }
      return sinLineas(plan, idx)
    }
    const conservar = cualConservar(plan, idx)
    return {
      tipo: 'duda',
      pregunta: `«${c.termino}» está en ${idx.length} líneas del plan. ¿Cuáles quito?`,
      opciones: [
        { texto: '✂️ Solo la repetida', resultado: sinLineas(plan, idx.filter((i) => i !== conservar)) },
        { texto: `✂️ Las ${idx.length}`, resultado: sinLineas(plan, idx) },
        DEJAR_IGUAL,
      ],
    }
  }

  // dejar
  const idx = c.termino ? lineasCon(plan, c.termino) : plan.map((a, i) => (mueveExistente(a) ? i : -1)).filter((i) => i >= 0)
  if (idx.length === 0) {
    return {
      tipo: 'igual',
      texto: c.termino ? `No veo «${c.termino}» en el plan. Dímelo como aparece arriba.` : 'Nada del plan mueve una tarea que ya existía; dime cuál dejo como está.',
    }
  }
  if (idx.length === 1) return sinLineas(plan, idx)
  return {
    tipo: 'duda',
    pregunta: '¿Cuál dejo donde estaba?',
    opciones: [
      ...idx.slice(0, MAX_OPCIONES - 1).map((i) => ({ texto: `↩️ ${corto(tituloDe(plan[i]))}`, resultado: sinLineas(plan, [i]) })),
      { texto: `↩️ Todas (${idx.length})`, resultado: sinLineas(plan, idx) },
    ],
  }
}

// ── Merging what the interpreter understood into the pending plan ────────

type Crear = Extract<AccionResuelta, { tipo: 'crear' }>
type Cambiar = Extract<AccionResuelta, { tipo: 'cambiar' }>

/** The plan line the new action is about, by task id first, then by title. */
function lineaDe(plan: AccionResuelta[], n: AccionResuelta): number {
  if (n.tarea) {
    const i = plan.findIndex((a) => a.tarea?.id === n.tarea!.id)
    if (i >= 0) return i
  }
  const nombres = [n.tipo === 'crear' ? n.titulo : null, 'ref' in n ? n.ref : null, n.tarea?.text ?? null].filter((s): s is string => !!s)
  for (const nombre of nombres) {
    const idx = lineasCon(plan, nombre).filter((i) => plan[i].tipo !== 'alarma')
    if (idx.length === 1) return idx[0]
    if (idx.length > 1) return idx.sort((x, y) => afinidad(nombre, plan[y]) - afinidad(nombre, plan[x]))[0]
  }
  return -1
}

/** What a new action brings to a line: date, hour, priority, company, calendar, title. */
function camposDe(n: AccionResuelta): Partial<Pick<Crear, 'fecha' | 'hora' | 'prioridad' | 'empresa' | 'calendar' | 'importante'>> & { empresa_ref?: EmpresaRef; titulo?: string } {
  switch (n.tipo) {
    case 'crear':
      return { fecha: n.fecha, hora: n.hora, prioridad: n.prioridad, empresa: n.empresa, empresa_ref: n.empresa_ref, calendar: n.calendar, importante: n.importante }
    case 'cambiar':
      return { fecha: n.fecha, hora: n.hora, prioridad: n.prioridad, empresa: n.empresa, empresa_ref: n.empresa_ref, calendar: n.calendar }
    case 'posponer':
      return { fecha: n.fecha }
    case 'calendar':
      return { calendar: true, hora: n.hora }
    case 'renombrar':
      return { titulo: n.titulo }
    default:
      return {}
  }
}

/** The line with the new action folded in, or null when they do not combine. */
function mezclar(p: AccionResuelta, n: AccionResuelta): AccionResuelta | null {
  const c = camposDe(n)
  const trae = Object.values(c).some((v) => v !== undefined)
  if (!trae) return null
  if (p.tipo === 'crear') {
    const out: Crear = { ...p, error: undefined }
    if (c.titulo && !p.existente) out.titulo = c.titulo
    if (c.fecha) out.fecha = c.fecha
    if (c.hora) out.hora = c.hora
    if (c.prioridad) {
      out.prioridad = c.prioridad
      if (c.prioridad === 'urgente') out.importante = true
    }
    if (c.importante) out.importante = true
    if (c.empresa) out.empresa = c.empresa
    if (c.empresa_ref) out.empresa_ref = c.empresa_ref
    if (c.calendar) out.calendar = true
    return out
  }
  if ((p.tipo === 'posponer' || p.tipo === 'cambiar') && p.tarea && !c.titulo) {
    const base: Cambiar = p.tipo === 'cambiar' ? { ...p } : { tipo: 'cambiar', ref: p.ref, tarea: p.tarea, fecha: p.fecha }
    const out: Cambiar = { ...base, error: undefined }
    if (c.fecha) out.fecha = c.fecha
    if (c.hora) out.hora = c.hora
    if (c.prioridad) out.prioridad = c.prioridad
    if (c.empresa) out.empresa = c.empresa
    if (c.empresa_ref) out.empresa_ref = c.empresa_ref
    if (c.calendar) out.calendar = true
    // Only a date → it is still a plain "posponer".
    if (!out.hora && !out.prioridad && !out.empresa && !out.calendar && out.fecha) return { tipo: 'posponer', ref: out.ref, tarea: out.tarea, fecha: out.fecha }
    return out
  }
  return null
}

const AJENAS = new Set<AccionResuelta['tipo']>(['pregunta', 'que_sigue', 'lista', 'pagos_listar', 'dividir', 'siguiente_paso', 'desconocido', 'nota_empresa', 'correo', 'conversar', 'documentos', 'documento_nota', 'proyectos'])

const VERBO_DESTRUCTIVO: Record<'borrar' | 'cancelar' | 'completar', { pregunta: string; boton: string }> = {
  borrar: { pregunta: 'de verdad borro la tarea', boton: '❌ Borrar la tarea de verdad' },
  cancelar: { pregunta: 'de verdad cancelo la tarea', boton: '🗑 Cancelar la tarea de verdad' },
  completar: { pregunta: 'la marco como hecha', boton: '✅ Marcarla hecha' },
}

/**
 * The interpreter's reading of a message sent while a plan waits, folded
 * into that plan. "ajena" = it was not about the plan (a question, an order
 * on another task): the caller handles it as any other message.
 */
export function fusionarCorreccion(plan: AccionResuelta[], nuevas: AccionResuelta[]): Resultado | { tipo: 'ajena' } {
  const acciones: AccionResuelta[] = JSON.parse(JSON.stringify(plan))
  const cambiadas: AccionResuelta[] = []
  const agregadas: AccionResuelta[] = []
  // Ajuste 15b: an alarm of the message replaces an alarm THE PLAN ALREADY HAD
  // with that text, once. Two alarms of the same message with the same text
  // ("pago del seguro" el 10 y el 20) are two alarms, not one overwriting the other.
  const alarmasTomadas = new Set<number>()
  for (const n of nuevas) {
    if (AJENAS.has(n.tipo)) continue
    if (n.tipo === 'borrar' || n.tipo === 'cancelar' || n.tipo === 'completar') {
      const i = lineaDe(acciones, n)
      if (i < 0) continue
      const a = acciones[i]
      // A correction never deletes or completes: ask.
      const v = VERBO_DESTRUCTIVO[n.tipo]
      const opciones: OpcionDuda[] = [{ texto: '✂️ Solo quitarla del plan', resultado: sinLineas(acciones, [i]) }]
      if (a.tarea) opciones.push({ texto: v.boton, resultado: sinLineas(acciones, [i]), ejecutar: { ...n, tarea: a.tarea, error: undefined, candidatos: undefined } })
      opciones.push(DEJAR_IGUAL)
      return { tipo: 'duda', pregunta: `¿Quito «${corto(tituloDe(a), 40)}» del plan, o ${v.pregunta}?`, opciones }
    }
    if (n.tipo === 'alarma') {
      const j = acciones.findIndex((a, k) => k < plan.length && !alarmasTomadas.has(k) && a.tipo === 'alarma' && normalizar(a.texto) === normalizar(n.texto))
      if (j >= 0) {
        alarmasTomadas.add(j)
        acciones[j] = n
        cambiadas.push(n)
      } else {
        acciones.push(n)
        agregadas.push(n)
      }
      continue
    }
    const i = lineaDe(acciones, n)
    const mezcla = i >= 0 ? mezclar(acciones[i], n) : null
    if (mezcla) {
      // The alarm riding on that line moves with it ("la de marketing a las 11").
      const c = camposDe(n)
      const k = Array.from(emparejarAlarmas(acciones).entries()).find(([, j]) => j === i)?.[0]
      if (k !== undefined && (c.fecha || c.hora)) {
        const alarma = acciones[k] as Extract<AccionResuelta, { tipo: 'alarma' }>
        const fecha = c.fecha ?? alarma.fecha
        const hora = c.hora ?? alarma.hora
        acciones[k] = { ...alarma, fecha, hora, en_minutos: undefined, dispara_en: instanteDe({ fecha, hora }) ?? undefined }
      }
      acciones[i] = mezcla
      cambiadas.push(mezcla)
      continue
    }
    if (n.tipo === 'crear' || n.tipo === 'posponer' || n.tipo === 'cambiar' || n.tipo === 'calendar' || n.tipo === 'renombrar' || n.tipo === 'nota_tarea') {
      acciones.push(n)
      agregadas.push(n)
    }
  }
  if (cambiadas.length === 0 && agregadas.length === 0) return { tipo: 'ajena' }
  return { tipo: 'plan', acciones, quitadas: [], cambiadas, agregadas }
}

// ── Rendering: only what changed ─────────────────────────────────────────

/**
 *   Corregido:
 *     ✂️ Quito «Marketing Team» (la repetida)
 *     ▫️ Marketing Team · DATAVIA · mié 4 · ⏰ 10:00 am (ya existía, la muevo)
 *   Lo demás (3 líneas) queda igual.
 */
export function renderCorreccion(r: ResultadoPlan, today: string = cancunYmd()): string {
  const semana = esPlanSemana(r.acciones)
  const alarmas = emparejarAlarmas(r.acciones)
  const alarmaDe = new Map(Array.from(alarmas.entries()).map(([i, j]) => [j, r.acciones[i] as Extract<AccionResuelta, { tipo: 'alarma' }>]))
  const lineaDeAlarma = new Map(Array.from(alarmas.entries()).map(([i, j]) => [i, j]))
  const lines: string[] = []
  for (const a of r.quitadas) lines.push(a.tipo === 'alarma' ? `✂️ Quito la alarma «${corto(a.texto, 40)}»` : `✂️ Quito «${corto(tituloDe(a), 40)}»${a.tipo === 'crear' && !a.existente ? ' (no la creo)' : ' (se queda como estaba)'}`)
  const mostradas = new Set<number>()
  for (const a of [...r.cambiadas, ...r.agregadas]) {
    let i = r.acciones.indexOf(a)
    if (i >= 0 && lineaDeAlarma.has(i)) i = lineaDeAlarma.get(i)!
    if (i >= 0 && mostradas.has(i)) continue
    if (i >= 0) mostradas.add(i)
    const linea = i >= 0 ? r.acciones[i] : a
    lines.push(lineaCorreccion(linea, semana, i >= 0 ? (alarmaDe.get(i) ?? null) : null, today))
  }
  // Lines of the plan = actions minus the alarms that ride on a task line.
  const resto = r.acciones.length - lineaDeAlarma.size - mostradas.size
  const pie = r.acciones.length === 0 ? 'No queda nada en el plan.' : resto > 0 ? `Lo demás (${resto} ${resto === 1 ? 'línea' : 'líneas'}) queda igual.` : null
  return ['Corregido:', ...lines.map((l) => `  ${l}`), ...(pie ? [pie] : [])].join('\n')
}
