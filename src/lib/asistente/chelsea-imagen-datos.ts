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
  /** Ajuste 18e: what the mail asks, in one line — only while it is not replied. */
  detalle?: string
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
  /** Ajuste 18g: el cierre de la tarde lleva además lo que se hizo hoy. */
  seccionHechas: string
  notaHechas: string
  sinHechas: string
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
  /** Ajuste 18g: solo en el cierre. `null` = esta imagen no lleva la sección. */
  hechas: FilaTarea[] | null
  hechasDeMas: number
  alto: number
}

export interface CorreoVip {
  de_nombre: string | null
  de_email: string | null
  asunto: string | null
  recibido_en: string | null
  estado: CorreoEstado
  respondido_en: string | null
  /** Ajuste 18e: does it expect an answer? Notices and FYIs do not. */
  tipo?: string | null
  resumen?: string | null
  gmail_thread_id?: string | null
}

const LOCAL: Record<IdiomaResumen, string> = { en: 'en-US', es: 'es-MX' }
const dia = (ymd: string, i: IdiomaResumen = 'en') => new Intl.DateTimeFormat(LOCAL[i], { timeZone: 'UTC', weekday: 'long', month: i === 'es' ? 'long' : 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`))
const corta = (ymd: string, i: IdiomaResumen = 'en') => new Intl.DateTimeFormat(LOCAL[i], { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`)).replace('.', '')

const ETIQUETA: Record<IdiomaResumen, Record<'respondido' | 'nuevo' | 'chelsea' | 'yo' | 'tarea' | 'nada' | 'aviso', string>> = {
  en: { respondido: 'Replied', nuevo: 'Needs reply', chelsea: 'Waiting on Chelsea', yo: 'Gabby is on it', tarea: 'Now a task', nada: 'Closed · no reply', aviso: 'No reply needed' },
  es: { respondido: 'Respondido', nuevo: 'Falta responder', chelsea: 'Esperando a Chelsea', yo: 'Lo hago yo', tarea: 'Ya es tarea', nada: 'Cerrado sin responder', aviso: 'No pide respuesta' },
}

/** Ajuste 18e: a mail waits for an answer unless the model read it as a notice or an FYI. With no type, it waits (safer). */
export function esperaRespuesta(tipo: string | null | undefined): boolean {
  return !tipo || tipo === 'necesita_respuesta' || tipo === 'pedido_de_tarea'
}

/** Is something still to be done with this mail, and by whom? */
export function estadoVip(c: Pick<CorreoVip, 'estado' | 'respondido_en' | 'tipo'>, idioma: IdiomaResumen = 'en'): { estado: EstadoFila; etiqueta: string } {
  const e = ETIQUETA[idioma]
  if (c.respondido_en || c.estado === 'respondido') return { estado: 'listo', etiqueta: e.respondido }
  switch (c.estado) {
    case 'nuevo':
      return esperaRespuesta(c.tipo) ? { estado: 'pendiente', etiqueta: e.nuevo } : { estado: 'listo', etiqueta: e.aviso }
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

function recortar(t: string, max: number): string {
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** Renglones que ocupa un texto a `porRenglon` letras (cálculo holgado: sobra aire, nunca se corta). */
export function renglones(texto: string, porRenglon: number): number {
  return Math.max(1, Math.ceil(texto.length / porRenglon))
}

export const MEDIDAS = { margen: 56, cabecera: 150, seccion: 84, filaVip: 44, renglonVip: 34, filaTarea: 26, renglonTarea: 36, vacio: 60, deMas: 44, pie: 70, letrasVip: 62, letrasTarea: 58, renglonDetalle: 30, letrasDetalle: 78 }

export interface OpcionesResumen {
  /** Whose summary it is: the name in the title. Default "Chelsea". */
  nombre?: string
  idioma?: IdiomaResumen
  tema?: TemaResumen
  /** The title of the tasks section when it is not "all her tasks" (Gabby's: today and overdue). */
  seccionTareas?: string
  subtitulo?: string
}

/** "13:00" → "1:00 pm" */
export function hora12(hm: string): string {
  const [h, m] = hm.slice(0, 5).split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

export function modeloChelsea(
  d: { vip: CorreoVip[]; tareas: { text: string; due_date: string | null; due_time?: string | null; empresa?: string | null }[]; hechas?: { text: string; empresa?: string | null }[] },
  hoy: string,
  ymdDe: (d: Date) => string = (x) => x.toISOString().slice(0, 10),
  opts: OpcionesResumen = {}
): ModeloChelsea {
  const i = opts.idioma ?? 'en'
  const es = i === 'es'
  // Ajuste 18e: one row per thread — the newest mail of each conversation speaks for it.
  const vistos = new Set<string>()
  const porHilo = [...d.vip]
    .sort((a, b) => (b.recibido_en ?? '').localeCompare(a.recibido_en ?? ''))
    .filter((c) => {
      if (!c.gmail_thread_id) return true
      if (vistos.has(c.gmail_thread_id)) return false
      vistos.add(c.gmail_thread_id)
      return true
    })
  const todas = porHilo
    .map((c) => ({ c, e: estadoVip(c, i) }))
    .sort((a, b) => ORDEN[a.e.estado] - ORDEN[b.e.estado] || (b.c.recibido_en ?? '').localeCompare(a.c.recibido_en ?? ''))
  const vip: FilaVip[] = todas.slice(0, MAX_VIP).map(({ c, e }) => ({ ...(e.estado !== 'listo' && c.resumen?.trim() ? { detalle: recortar(c.resumen.trim(), 170) } : {}), quien: quien(c, i), asunto: (c.asunto ?? (es ? '(sin asunto)' : '(no subject)')).trim(), cuando: hace(c.recibido_en, hoy, ymdDe, i), ...e }))
  // Ajuste 18g: lo de HOY con hora sale primero dentro de su día y muestra la hora en vez de la fecha.
  const orden = [...d.tareas].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (a.due_time ?? '99').localeCompare(b.due_time ?? '99') || (a.empresa ?? '').localeCompare(b.empresa ?? ''))
  const tareas: FilaTarea[] = orden.slice(0, MAX_TAREAS).map((t) => ({ ...(t.empresa ? { empresa: t.empresa } : {}), texto: t.text.trim(), fecha: t.due_date ? (t.due_date === hoy && t.due_time ? hora12(t.due_time) : corta(t.due_date, i)) : '', vencida: !!t.due_date && t.due_date < hoy }))
  const hechasTodas = d.hechas ?? null
  const hechas: FilaTarea[] | null = hechasTodas ? hechasTodas.slice(0, MAX_TAREAS).map((t) => ({ ...(t.empresa ? { empresa: t.empresa } : {}), texto: t.text.trim(), fecha: '', vencida: false })) : null
  const m = MEDIDAS
  let alto = m.margen + m.cabecera
  alto += m.seccion + (vip.length === 0 ? m.vacio : vip.reduce((s, f) => s + m.filaVip + m.renglonVip * renglones(`${f.quien} — ${f.asunto}`, m.letrasVip) + (f.detalle ? m.renglonDetalle * renglones(f.detalle, m.letrasDetalle) + 6 : 0), 0))
  if (todas.length > vip.length) alto += m.deMas
  alto += m.seccion + (tareas.length === 0 ? m.vacio : tareas.reduce((s, f) => s + m.filaTarea + m.renglonTarea * renglones(`${f.empresa ? `${f.empresa}  ` : ''}${f.texto}`, m.letrasTarea - (f.empresa ? 6 : 0)), 0))
  if (orden.length > tareas.length) alto += m.deMas
  if (hechas) {
    alto += m.seccion + (hechas.length === 0 ? m.vacio : hechas.reduce((s, f) => s + m.filaTarea + m.renglonTarea * renglones(`${f.empresa ? `${f.empresa}  ` : ''}${f.texto}`, m.letrasTarea - (f.empresa ? 6 : 0)), 0))
    if (hechasTodas!.length > hechas.length) alto += m.deMas
  }
  alto += m.pie
  const vipPendientes = todas.filter((x) => x.e.estado === 'pendiente').length
  const tareasVencidas = orden.filter((t) => !!t.due_date && t.due_date < hoy).length
  const nombre = opts.nombre ?? 'Chelsea'
  const textos: TextosResumen = es
    ? {
        subtitulo: opts.subtitulo ?? 'Resumen del día · correos VIP y tareas',
        seccionHechas: 'HECHO HOY',
        notaHechas: hechasTodas ? `${hechasTodas.length} ${hechasTodas.length === 1 ? 'cerrada' : 'cerradas'}` : '',
        sinHechas: 'Nada cerrado hoy todavía.',
        seccionVip: 'CORREOS VIP',
        notaVip: vip.length === 0 ? '' : vipPendientes === 0 ? 'nada por responder' : `${vipPendientes} por responder`,
        sinVip: 'Sin correos VIP en los últimos 7 días.',
        vipDeMas: `+${todas.length - vip.length} más en GabbyHQ`,
        seccionTareas: opts.seccionTareas ?? 'TUS TAREAS',
        notaTareas: orden.length === 0 ? '' : `${orden.length} ${orden.length === 1 ? 'abierta' : 'abiertas'}${tareasVencidas > 0 ? ` · ${tareasVencidas} ${tareasVencidas === 1 ? 'vencida' : 'vencidas'}` : ''}`,
        sinTareas: 'Nada pendiente.',
        tareasDeMas: `+${orden.length - tareas.length} más en el tablero`,
        vencida: 'vencida',
      }
    : {
        subtitulo: opts.subtitulo ?? 'Daily summary · VIP emails and tasks',
        seccionHechas: 'DONE TODAY',
        notaHechas: hechasTodas ? `${hechasTodas.length} closed` : '',
        sinHechas: 'Nothing closed today yet.',
        seccionVip: 'VIP EMAILS',
        notaVip: vip.length === 0 ? '' : vipPendientes === 0 ? 'nothing to reply' : `${vipPendientes} ${vipPendientes === 1 ? 'needs' : 'need'} reply`,
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
    hechas,
    hechasDeMas: hechasTodas && hechas ? hechasTodas.length - hechas.length : 0,
    alto: Math.min(ALTO_MAX_CHELSEA, Math.max(520, alto)),
  }
}
