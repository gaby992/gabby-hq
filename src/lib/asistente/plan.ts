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
import { addDays, cancunYmd, formatFechaHoraEs, formatHoraEs, formatVenceEs } from './cancun'
import { buscarEnAbiertas, type AccionLlm, type ContextoInterprete, type TareaLite } from './interprete'
import { ejecutarNota } from './notas-bot'
import { responderPregunta } from './pregunta'
import { enviarQueSigue } from './que-sigue'
import { confirmacionAlarma, crearRecordatorio, instanteDe } from './recordatorios'
import { confirmacion, guardarTarea } from './tareas'
import { agregarACalendar, cuandoDe } from '@/lib/google/sync'
import { textoListaPagos } from './pagos'

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
    return t ? { tarea: lite(t) } : { error: `no encontré ${key.startsWith('#') ? `el ${key.slice(1)} en la última alarma` : `la tarea ${key}`}` }
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
 */
export function resolverAcciones(acciones: AccionLlm[], ctx: ContextoInterprete, companies: EmpresaRef[]): AccionResuelta[] {
  let anterior: TareaRef | null = ctx.anterior ? lite(ctx.anterior) : null
  const out: AccionResuelta[] = []
  for (const a of acciones) {
    const r: AccionResuelta = { ...a }
    if ('ref' in a) {
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
    if ((a.tipo === 'cambiar' || a.tipo === 'crear' || a.tipo === 'nota_empresa' || a.tipo === 'pagos_listar') && a.empresa) {
      const e = resolverEmpresa(a.empresa, companies)
      if (e) r.empresa_ref = e
      else if (a.tipo !== 'crear') r.error = r.error ?? `no conozco la empresa «${a.empresa}»`
    }
    if (a.tipo === 'cambiar' && !a.prioridad && !a.fecha && !a.empresa && !a.hora && !a.calendar) r.error = r.error ?? 'no dijiste qué cambiar'
    if (a.tipo === 'alarma') {
      const cuando = instanteDe(a)
      if (cuando) r.dispara_en = cuando
    }
    out.push(r)
  }
  return out
}

// ── Rendering ───────────────────────────────────────────────────────────

const ICONO: Record<AccionLlm['tipo'], string> = {
  completar: '✅', cancelar: '🗑', borrar: '❌', posponer: '➡️', renombrar: '✏️', cambiar: '✏️', crear: '➕',
  nota_empresa: '📝', nota_tarea: '📎', alarma: '⏰', pregunta: '❓', que_sigue: '🎯', lista: '📋', calendar: '📅',
  pagos_listar: '💳', desconocido: '🤷',
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
      const parts = [a.empresa_ref?.name.trim() ?? (a.empresa ? `empresa «${a.empresa}»?` : 'sin empresa'), PRIORITY_LABELS[a.prioridad ?? 'normal'] + (a.importante ? ' ★' : '')]
      if (a.fecha) parts.push(a.hora ? `${formatVenceEs(a.fecha)} ${formatHoraEs(a.hora)}` : `vence ${formatVenceEs(a.fecha)}`)
      if (a.calendar) parts.push(a.fecha ? `📅 calendar${a.hora ? '' : ' (todo el día)'}` : '📅 calendar (sin fecha: no se podrá)')
      return `Crear «${corto(a.titulo)}» · ${parts.join(' · ')}`
    }
    case 'nota_empresa': return `Nota de ${a.empresa_ref?.name.trim() ?? a.empresa} (${a.modo}): «${corto(a.texto, 60)}»`
    case 'nota_tarea': return `Nota en${tt}: «${corto(a.texto, 60)}»`
    case 'alarma': return `Alarma «${corto(a.texto)}» · ${a.dispara_en ? formatFechaHoraEs(a.dispara_en) : `${a.fecha ? formatVenceEs(a.fecha) : 'hoy'} (sin hora → 9:00 am)`}`
    case 'pregunta': return `Responder «${corto(a.texto, 60)}»`
    case 'que_sigue': return `Qué sigue${a.empresa ? ` de ${a.empresa}` : ''}${a.solo_urgentes ? ' (solo urgentes)' : ''}${a.solo_vencer ? ' (por vencer)' : ''}`
    case 'lista': return a.lista === 'tarde' ? 'Mandar el cierre del día' : 'Mandar la lista completa de hoy'
    case 'calendar': return `Poner en calendar${tt}${a.hora ? ` a las ${formatHoraEs(a.hora)}` : a.todo_el_dia ? ' (todo el día)' : ''}`
    case 'pagos_listar': return `Listar pagos${a.empresa_ref ? ` de ${a.empresa_ref.name.trim()}` : ''}${a.semana ? ' de esta semana' : ''}`
    case 'desconocido': return `No entendí «${corto(a.texto, 60)}»`
  }
}

/** True when an action adjacent to another on the same task reads well joined with " y ". */
function enlazable(a: AccionResuelta): boolean {
  return !!a.tarea && !a.error && ['posponer', 'renombrar', 'cambiar', 'completar', 'cancelar', 'borrar', 'nota_tarea', 'calendar'].includes(a.tipo)
}

/**
 * "Entendí:\n1. ✅ Completar «…»\n2. 🗑 Cancelar «…» (nota: …)\n…". Adjacent
 * actions on the same task share a line ("Renombrar «…» → «…» y pasar mañana").
 */
export function renderPlan(acciones: AccionResuelta[], today: string = cancunYmd()): string {
  const lines: string[] = []
  let i = 0
  while (i < acciones.length) {
    const a = acciones[i]
    if (a.error) {
      lines.push(`⚠️ ${frase(a, today, false)}: ${a.error} (no se hará)`)
      i += 1
      continue
    }
    let line = `${ICONO[a.tipo]} ${frase(a, today, true)}`
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

// ── Execution ───────────────────────────────────────────────────────────

/**
 * Fase 4 rule: the plan needs an OK when there are 2+ actions or any of them
 * cancels. A single "borrar" is not here: it goes through the classic
 * [Sí, borrar] [No] in the webhook instead.
 */
export function necesitaConfirmacion(acciones: AccionResuelta[]): boolean {
  const reales = acciones.filter((a) => a.tipo !== 'desconocido')
  return reales.length >= 2 || reales.some((a) => a.tipo === 'cancelar')
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
      const t = tareaParsedDe(a)
      const g = await guardarTarea(t)
      // Inside an approved plan an event without an hour is all-day (the plan said so).
      const sync = g.faltaHora ? await agregarACalendar(g.id, { todoElDia: true }) : g.sync
      const linea = confirmacion(t, sync)
      return sync?.confirmacion ? `${linea}\n${sync.confirmacion}` : linea
    }
    case 'nota_empresa': {
      if (!a.empresa_ref) return `⚠️ No conozco la empresa «${a.empresa}»`
      return ejecutarNota({ company_id: a.empresa_ref.id, company_name: a.empresa_ref.name.trim(), modo: a.modo, texto: a.texto })
    }
    case 'nota_tarea':
      return ejecutarAccion({ accion: 'nota_tarea', texto: a.texto }, [tareaDe(a).id])
    case 'alarma': {
      // No hour inside an approved plan → 9:00 am (the plan said so).
      const cuando = a.dispara_en ?? instanteDe({ fecha: a.fecha, hora: '09:00' })!
      const r = await crearRecordatorio(chatId, a.texto, cuando)
      return confirmacionAlarma(r)
    }
    case 'pregunta':
      return responderPregunta(chatId, a.texto)
    case 'que_sigue':
      // Sent as its own HTML message, like the lists.
      await enviarQueSigue(chatId, { empresa: a.empresa, solo_urgentes: a.solo_urgentes, solo_vencer: a.solo_vencer })
      return '🎯 (enviado arriba)'
    case 'lista':
      // Sent as its own HTML message (same builder as the cron); nothing to add here.
      await enviarLista(chatId, a.lista)
      return a.lista === 'tarde' ? '📋 (cierre enviado arriba)' : '📋 (lista enviada arriba)'
    case 'calendar': {
      // In a plan, no hour → all-day (a single action asks with buttons in the webhook).
      const r = await agregarACalendar(tareaDe(a).id, { hora: a.hora ?? null, todoElDia: !a.hora })
      return r.confirmacion ?? r.aviso ?? '📅 sin cambios'
    }
    case 'pagos_listar':
      return textoListaPagos(a.empresa_ref?.id ?? null, a.empresa_ref?.name.trim() ?? null, { semana: a.semana === true })
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
      const motivo = err instanceof Error ? err.message : String(err)
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
      candidatos: undefined,
      empresa_ref: a.empresa_ref ? a.empresa_ref.name : undefined,
    })),
  })
}
