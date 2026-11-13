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
  texto: string
  fecha: string
  vencida: boolean
}

export interface ModeloChelsea {
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

const dia = (ymd: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`))
const corta = (ymd: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`))

/** Is something still to be done with this mail, and by whom? */
export function estadoVip(c: Pick<CorreoVip, 'estado' | 'respondido_en'>): { estado: EstadoFila; etiqueta: string } {
  if (c.respondido_en || c.estado === 'respondido') return { estado: 'listo', etiqueta: 'Replied' }
  switch (c.estado) {
    case 'nuevo':
      return { estado: 'pendiente', etiqueta: 'Needs action' }
    case 'para_chelsea':
      return { estado: 'esperando', etiqueta: 'Waiting on Chelsea' }
    case 'lo_hago_yo':
      return { estado: 'esperando', etiqueta: 'Gabby is on it' }
    case 'tarea':
      return { estado: 'esperando', etiqueta: 'Now a task' }
    default:
      return { estado: 'listo', etiqueta: 'Nothing to do' }
  }
}

const ORDEN: Record<EstadoFila, number> = { pendiente: 0, esperando: 1, listo: 2 }

function quien(c: Pick<CorreoVip, 'de_nombre' | 'de_email'>): string {
  return (c.de_nombre || c.de_email || '(no sender)').trim()
}

function hace(iso: string | null, hoy: string, ymdDe: (d: Date) => string): string {
  if (!iso) return ''
  const dias = Math.round((Date.parse(hoy) - Date.parse(ymdDe(new Date(iso)))) / 86_400_000)
  return dias <= 0 ? 'today' : dias === 1 ? 'yesterday' : `${dias} days ago`
}

/** Renglones que ocupa un texto a `porRenglon` letras (cálculo holgado: sobra aire, nunca se corta). */
export function renglones(texto: string, porRenglon: number): number {
  return Math.max(1, Math.ceil(texto.length / porRenglon))
}

export const MEDIDAS = { margen: 56, cabecera: 150, seccion: 84, filaVip: 44, renglonVip: 34, filaTarea: 26, renglonTarea: 36, vacio: 60, deMas: 44, pie: 70, letrasVip: 62, letrasTarea: 58 }

export function modeloChelsea(
  d: { vip: CorreoVip[]; tareas: { text: string; due_date: string | null }[] },
  hoy: string,
  ymdDe: (d: Date) => string = (x) => x.toISOString().slice(0, 10)
): ModeloChelsea {
  const todas = d.vip
    .map((c) => ({ c, e: estadoVip(c) }))
    .sort((a, b) => ORDEN[a.e.estado] - ORDEN[b.e.estado] || (b.c.recibido_en ?? '').localeCompare(a.c.recibido_en ?? ''))
  const vip: FilaVip[] = todas.slice(0, MAX_VIP).map(({ c, e }) => ({ quien: quien(c), asunto: (c.asunto ?? '(no subject)').trim(), cuando: hace(c.recibido_en, hoy, ymdDe), ...e }))
  const orden = [...d.tareas].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
  const tareas: FilaTarea[] = orden.slice(0, MAX_TAREAS).map((t) => ({ texto: t.text.trim(), fecha: t.due_date ? corta(t.due_date) : '', vencida: !!t.due_date && t.due_date < hoy }))
  const m = MEDIDAS
  let alto = m.margen + m.cabecera
  alto += m.seccion + (vip.length === 0 ? m.vacio : vip.reduce((s, f) => s + m.filaVip + m.renglonVip * renglones(`${f.quien} — ${f.asunto}`, m.letrasVip), 0))
  if (todas.length > vip.length) alto += m.deMas
  alto += m.seccion + (tareas.length === 0 ? m.vacio : tareas.reduce((s, f) => s + m.filaTarea + m.renglonTarea * renglones(f.texto, m.letrasTarea), 0))
  if (orden.length > tareas.length) alto += m.deMas
  alto += m.pie
  return {
    titulo: `Chelsea — ${dia(hoy)}`,
    vip,
    vipDeMas: todas.length - vip.length,
    vipPendientes: todas.filter((x) => x.e.estado === 'pendiente').length,
    tareas,
    tareasDeMas: orden.length - tareas.length,
    tareasVencidas: orden.filter((t) => !!t.due_date && t.due_date < hoy).length,
    alto: Math.min(ALTO_MAX_CHELSEA, Math.max(520, alto)),
  }
}
