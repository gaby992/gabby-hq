// Ajuste 18c: el resumen de Chelsea como IMAGEN. Gabby pidió que lleve solo dos cosas:
//   1. los correos de remitentes VIP, cada uno con si falta hacer algo o no, y
//   2. TODAS las tareas de Chelsea.
// Nada más (ni facturas, ni boletines, ni el conteo de avisos).
//
// Este archivo es el modelo, puro: qué filas salen, con qué etiqueta y qué alto lleva la
// imagen. El dibujo está en chelsea-imagen.tsx. Va en INGLÉS, como todo el canal de Chelsea.

import type { CorreoEstado } from '@/types'

export const ANCHO_CHELSEA = 1200
/** Telegram rechaza fotos demasiado altas; con este tope la proporción queda holgada. */
export const ALTO_MAX_CHELSEA = 3600
export const MAX_VIP = 14
export const MAX_TAREAS = 30

export type EstadoFila = 'pendiente' | 'esperando' | 'listo'

export interface FilaVip {
  quien: string
  asunto: string
  cuando: string
  estado: EstadoFila
  etiqueta: string
}

export interface FilaTarea {
  /** Ajuste 18d: la empresa, en el resumen de Gabby (el de Chelsea no la lleva). */
  empresa?: string
  texto: string
  fecha: string
  vencida: boolean
}

/** Ajuste 18d: el mismo resumen para Gabby — en español y en oscuro. */
export type IdiomaResumen = 'en' | 'es'
export type TemaResumen = 'claro' | 'oscuro'

export interface TextosResumen {
  subtitulo: string
  seccionVip: string
  notaVip: string
  sinVip: string
  vipDeMas: string
  seccionTareas: string
  notaTareas: string
  sinTareas: string
  tareasDeMas: string
  vencida: string
}

export interface ModeloChelsea {
  tema: TemaResumen
  textos: TextosResumen
  titulo: string
  vip: FilaVip[]
  vipDeMas: number
  vipPendientes: number
  tareas: FilaTarea[]
  tareasDeMas: number
  tareasVencidas: number
  alto: number
}

export interface CorreoVip {
  de_nombre: string | null
  de_email: string | null
  asunto: string | null
  recibido_en: string | null
  estado: CorreoEstado
  respondido_en: string | null
}

const LOCAL: Record<IdiomaResumen, string> = { en: 'en-US', es: 'es-MX' }
const dia = (ymd: string, i: IdiomaResumen = 'en') => new Intl.DateTimeFormat(LOCAL[i], { timeZone: 'UTC', weekday: 'long', month: i === 'es' ? 'long' : 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`))
const corta = (ymd: string, i: IdiomaResumen = 'en') => new Intl.DateTimeFormat(LOCAL[i], { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`)).replace('.', '')

const ETIQUETA: Record<IdiomaResumen, Record<'respondido' | 'nuevo' | 'chelsea' | 'yo' | 'tarea' | 'nada', string>> = {
  en: { respondido: 'Replied', nuevo: 'Needs action', chelsea: 'Waiting on Chelsea', yo: 'Gabby is on it', tarea: 'Now a task', nada: 'Nothing to do' },
  es: { respondido: 'Respondido', nuevo: 'Falta hacer algo', chelsea: 'Esperando a Chelsea', yo: 'Lo hago yo', tarea: 'Ya es tarea', nada: 'Nada que hacer' },
}

/** Is something still to be done with this mail, and by whom? */
export function estadoVip(c: Pick<CorreoVip, 'estado' | 'respondido_en'>, idioma: IdiomaResumen = 'en'): { estado: EstadoFila; etiqueta: string } {
  const e = ETIQUETA[idioma]
  if (c.respondido_en || c.estado === 'respondido') return { estado: 'listo', etiqueta: e.respondido }
  switch (c.estado) {
    case 'nuevo':
      return { estado: 'pendiente', etiqueta: e.nuevo }
    case 'para_chelsea':
      return { estado: 'esperando', etiqueta: e.chelsea }
    case 'lo_hago_yo':
      // En el resumen de Gabby "lo hago yo" es SU pendiente; en el de Chelsea, alguien ya lo tiene.
      return { estado: idioma === 'es' ? 'pendiente' : 'esperando', etiqueta: e.yo }
    case 'tarea':
      return { estado: 'esperando', etiqueta: e.tarea }
    default:
      return { estado: 'listo', etiqueta: e.nada }
  }
}

const ORDEN: Record<EstadoFila, number> = { pendiente: 0, esperando: 1, listo: 2 }

function quien(c: Pick<CorreoVip, 'de_nombre' | 'de_email'>, i: IdiomaResumen): string {
  return (c.de_nombre || c.de_email || (i === 'es' ? '(sin remitente)' : '(no sender)')).trim()
}

function hace(iso: string | null, hoy: string, ymdDe: (d: Date) => string, i: IdiomaResumen): string {
  if (!iso) return ''
  const dias = Math.round((Date.parse(hoy) - Date.parse(ymdDe(new Date(iso)))) / 86_400_000)
  if (i === 'es') return dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`
  return dias <= 0 ? 'today' : dias === 1 ? 'yesterday' : `${dias} days ago`
}

/** Renglones que ocupa un texto a `porRenglon` letras (cálculo holgado: sobra aire, nunca se corta). */
export function renglones(texto: string, porRenglon: number): number {
  return Math.max(1, Math.ceil(texto.length / porRenglon))
}

export const MEDIDAS = { margen: 56, cabecera: 150, seccion: 84, filaVip: 44, renglonVip: 34, filaTarea: 26, renglonTarea: 36, vacio: 60, deMas: 44, pie: 70, letrasVip: 62, letrasTarea: 58 }

export interface OpcionesResumen {
  /** Whose summary it is: the name in the title. Default "Chelsea". */
  nombre?: string
  idioma?: IdiomaResumen
  tema?: TemaResumen
  /** The title of the tasks section when it is not "all her tasks" (Gabby's: today and overdue). */
  seccionTareas?: string
}

export function modeloChelsea(
  d: { vip: CorreoVip[]; tareas: { text: string; due_date: string | null; empresa?: string | null }[] },
  hoy: string,
  ymdDe: (d: Date) => string = (x) => x.toISOString().slice(0, 10),
  opts: OpcionesResumen = {}
): ModeloChelsea {
  const i = opts.idioma ?? 'en'
  const es = i === 'es'
  const todas = d.vip
    .map((c) => ({ c, e: estadoVip(c, i) }))
    .sort((a, b) => ORDEN[a.e.estado] - ORDEN[b.e.estado] || (b.c.recibido_en ?? '').localeCompare(a.c.recibido_en ?? ''))
  const vip: FilaVip[] = todas.slice(0, MAX_VIP).map(({ c, e }) => ({ quien: quien(c, i), asunto: (c.asunto ?? (es ? '(sin asunto)' : '(no subject)')).trim(), cuando: hace(c.recibido_en, hoy, ymdDe, i), ...e }))
  const orden = [...d.tareas].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (a.empresa ?? '').localeCompare(b.empresa ?? ''))
  const tareas: FilaTarea[] = orden.slice(0, MAX_TAREAS).map((t) => ({ ...(t.empresa ? { empresa: t.empresa } : {}), texto: t.text.trim(), fecha: t.due_date ? corta(t.due_date, i) : '', vencida: !!t.due_date && t.due_date < hoy }))
  const m = MEDIDAS
  let alto = m.margen + m.cabecera
  alto += m.seccion + (vip.length === 0 ? m.vacio : vip.reduce((s, f) => s + m.filaVip + m.renglonVip * renglones(`${f.quien} — ${f.asunto}`, m.letrasVip), 0))
  if (todas.length > vip.length) alto += m.deMas
  alto += m.seccion + (tareas.length === 0 ? m.vacio : tareas.reduce((s, f) => s + m.filaTarea + m.renglonTarea * renglones(`${f.empresa ? `${f.empresa}  ` : ''}${f.texto}`, m.letrasTarea - (f.empresa ? 6 : 0)), 0))
  if (orden.length > tareas.length) alto += m.deMas
  alto += m.pie
  const vipPendientes = todas.filter((x) => x.e.estado === 'pendiente').length
  const tareasVencidas = orden.filter((t) => !!t.due_date && t.due_date < hoy).length
  const nombre = opts.nombre ?? 'Chelsea'
  const textos: TextosResumen = es
    ? {
        subtitulo: 'Resumen del día · correos VIP y tareas',
        seccionVip: 'CORREOS VIP',
        notaVip: vip.length === 0 ? '' : vipPendientes === 0 ? 'todo atendido' : `${vipPendientes} ${vipPendientes === 1 ? 'pide' : 'piden'} algo`,
        sinVip: 'Sin correos VIP en los últimos 7 días.',
        vipDeMas: `+${todas.length - vip.length} más en GabbyHQ`,
        seccionTareas: opts.seccionTareas ?? 'TUS TAREAS',
        notaTareas: orden.length === 0 ? '' : `${orden.length} ${orden.length === 1 ? 'abierta' : 'abiertas'}${tareasVencidas > 0 ? ` · ${tareasVencidas} ${tareasVencidas === 1 ? 'vencida' : 'vencidas'}` : ''}`,
        sinTareas: 'Nada pendiente.',
        tareasDeMas: `+${orden.length - tareas.length} más en el tablero`,
        vencida: 'vencida',
      }
    : {
        subtitulo: 'Daily summary · VIP emails and tasks',
        seccionVip: 'VIP EMAILS',
        notaVip: vip.length === 0 ? '' : vipPendientes === 0 ? 'all handled' : `${vipPendientes} need action`,
        sinVip: 'No VIP emails in the last 7 days.',
        vipDeMas: `+${todas.length - vip.length} more in GabbyHQ`,
        seccionTareas: opts.seccionTareas ?? `${nombre.toUpperCase()}'S TASKS`,
        notaTareas: orden.length === 0 ? '' : `${orden.length} open${tareasVencidas > 0 ? ` · ${tareasVencidas} overdue` : ''}`,
        sinTareas: 'No open tasks.',
        tareasDeMas: `+${orden.length - tareas.length} more on the board`,
        vencida: 'overdue',
      }
  const fecha = dia(hoy, i)
  return {
    tema: opts.tema ?? 'claro',
    textos,
    titulo: `${nombre} — ${es ? fecha.charAt(0).toUpperCase() + fecha.slice(1) : fecha}`,
    vip,
    vipDeMas: todas.length - vip.length,
    vipPendientes,
    tareas,
    tareasDeMas: orden.length - tareas.length,
    tareasVencidas,
    alto: Math.min(ALTO_MAX_CHELSEA, Math.max(520, alto)),
  }
}
