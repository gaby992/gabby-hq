// Fase 12: the "Dashboard de vida" — ONE page that gathers the day: the
// agenda by hour (tasks with an hour, recurring payments, the connected
// Google Calendar read-only), the top priorities (the same ranking as "¿qué
// sigue?"), the mail that waits for an answer, the "por dónde iba" notes, the
// KPIs of the board and the state of the connections. Everything is computed
// here, server side, from the same functions the bot and the board use, so
// the three never disagree. The page only renders.

import { createServerClient } from '@/lib/supabase-server'
import type { Company, NotaEmpresa } from '@/types'
import { columnaCorreo } from '@/lib/horizonte'
import { correosQueEsperan, haceCuanto, quienCorto, type CorreoLite } from '@/lib/correo/pendientes'
import { cargarCuentas } from '@/lib/correo/cuentas'
import { eventosDelDia, PAGO_HORA, type EventoDia } from '@/lib/google/calendar'
import { explicarErrorGoogle, googleConfigurado } from '@/lib/google/oauth'
import { mensajeError } from '@/lib/errores'
import { cancunYmd, formatDiaLargoEs } from './cancun'
import { cargarConfig } from './config'
import { cargarPanorama, type Panorama } from './narracion'
import { listarPagos } from './pagos'
import { calcularQueSigue } from './que-sigue'
import { allowedChatIds } from './telegram'
import { chipsVencimientos, type ChipVencimiento } from '@/lib/documentos/vencimientos'
import { hoyTeToca, type BloqueDelDia } from './bloques'

/** One line of the agenda. Sorted by `hora`; the ones without an hour go to "Sin hora". */
export interface ItemAgenda {
  tipo: 'tarea' | 'pago' | 'evento'
  id: string
  /** 'HH:MM' (24 h, Cancún) or null. */
  hora: string | null
  fin: string | null
  titulo: string
  empresa: { name: string; color: string } | null
  importante?: boolean
  /** Payment: "$20"; event: the Calendar link. */
  detalle: string | null
  link: string | null
  /** Ajuste 16b: she ticked it today (events and payments; a task is simply completed). */
  hecho?: boolean
}

export interface Prioridad {
  id: string
  text: string
  empresa: { name: string; color: string } | null
  importante: boolean
  /** "hace 9 días" · "hoy 9:00 am" · "urgente ★" */
  porque: string
}

export interface CorreoResumen extends CorreoLite {
  quien: string
  hace: string
  idioma: 'es' | 'en'
}

export interface Resumen {
  today: string
  fecha_larga: string
  nombre: string
  kpis: { hoy: number; vencidas: number; esperando: number; correos: number }
  agenda: ItemAgenda[]
  sin_hora: ItemAgenda[]
  /** True when the connected calendar could not be read (the section is simply shorter). */
  calendar_fallo: boolean
  /** Fase 12b: why, in plain words, and whether Reconectar fixes it. */
  calendar_error: { texto: string; reconectar: boolean; url?: string; urlTexto?: string } | null
  prioridades: Prioridad[]
  correos: CorreoResumen[]
  notas: { company_id: string; empresa: string; color: string; nota: string; updated_at: string }[]
  /** Fase 14: lo que vence en los próximos 45 días (contratos, pólizas, identificaciones). */
  vencimientos: ChipVencimiento[]
  /** Fase 16: los bloques de hoy con lo que cae en cada uno. Vacío sin plantilla. */
  bloques_hoy: BloqueDelDia[]
  /** Fase 16: tareas de hoy que no caen en ningún bloque. */
  sin_bloque: { id: string; text: string }[]
  conexiones: {
    google_configurado: boolean
    cuentas: { email: string; calendar: boolean; correo: boolean; activa: boolean }[]
    telegram: boolean
  }
}

/** What identifies an agenda line in agenda_hechos. */
export function claveAgenda(it: Pick<ItemAgenda, 'tipo' | 'id'>): string {
  return `${it.tipo}:${it.id}`
}

/** The agenda lines she ticked on `fecha`. Empty (never throws) without the 16b SQL. */
export async function agendaHechos(fecha: string): Promise<Set<string>> {
  try {
    const { data, error } = await createServerClient().from('agenda_hechos').select('clave').eq('fecha', fecha)
    if (error) return new Set()
    return new Set(((data as { clave: string }[] | null) ?? []).map((x) => x.clave))
  } catch {
    return new Set()
  }
}

/** Tick / untick one agenda line for `fecha`. Throws with a plain reason. */
export async function marcarAgenda(fecha: string, clave: string, hecho: boolean): Promise<void> {
  const db = createServerClient()
  const { error } = hecho
    ? await db.from('agenda_hechos').upsert({ fecha, clave }, { onConflict: 'fecha,clave' })
    : await db.from('agenda_hechos').delete().eq('fecha', fecha).eq('clave', clave)
  if (error) {
    throw new Error(/agenda_hechos/.test(error.message) && /exist|schema|find/i.test(error.message)
      ? 'Falta correr el SQL 2026-11-asistente-fase16b-agenda.sql en Supabase'
      : `Supabase agenda_hechos: ${error.message}`)
  }
}

const MAX_PRIORIDADES = 5
const MAX_CORREOS = 6

function empresaDe(companies: Company[], id: string | null | undefined): { name: string; color: string } | null {
  const c = id ? companies.find((x) => x.id === id) : null
  return c ? { name: c.name.trim(), color: c.color } : null
}

/** 'HH:MM' from a Postgres time ('HH:MM:SS'). */
function hm(t: string): string {
  return t.slice(0, 5)
}

/** Calendar's instance ids look like "<base>_20261107T140000Z": the base is what a task or payment stored. */
function baseId(id: string): string {
  return id.split('_')[0]
}

function kpisDe(p: Panorama): Resumen['kpis'] {
  let esperando = p.col.esperando.length
  let correos = 0
  for (const c of p.correos) {
    const col = columnaCorreo(c)
    if (col === 'correos') correos += 1
    else if (col === 'esperando') esperando += 1
  }
  return {
    hoy: p.col.hoy.length,
    vencidas: p.col.hoy.filter((t) => t.due_date && t.due_date < p.today).length,
    esperando,
    correos,
  }
}

export async function cargarResumen(today: string = cancunYmd()): Promise<Resumen> {
  const db = createServerClient()
  const [cfg, panorama, pagos, queSigue, cuentas, correosRaw, conexionesRes, vencimientos] = await Promise.all([
    cargarConfig(),
    cargarPanorama(today),
    listarPagos().catch((err) => {
      console.error(`[resumen] pagos: ${mensajeError(err)}`)
      return []
    }),
    calcularQueSigue({}).catch((err) => {
      console.error(`[resumen] que-sigue: ${mensajeError(err)}`)
      return null
    }),
    cargarCuentas().catch(() => []),
    correosQueEsperan({ max: MAX_CORREOS }),
    db.from('conexiones_google').select('email, activa, usa_calendar, usa_gmail').order('conectado_en', { ascending: false }),
    // Fase 14: sin el SQL de la fase 14 esto vuelve vacío y el Resumen sigue igual.
    chipsVencimientos(today),
  ])
  const { companies, tasks, notas } = panorama
  const hechos = await agendaHechos(today)
  // Fase 16: sin el SQL de la fase 16 esto vuelve vacío y el Resumen sigue igual.
  const teToca = await hoyTeToca(tasks, companies, today).catch((err) => {
    console.warn(`[resumen] bloques: ${mensajeError(err)}`)
    return { bloques: [] as BloqueDelDia[], sin_bloque: [] as { id: string; text: string }[] }
  })

  // ── Agenda: tasks with an hour today · payments due today · Calendar events (read-only) ──
  const agenda: ItemAgenda[] = []
  const sinHora: ItemAgenda[] = []
  const idsEventosPropios = new Set<string>()
  for (const t of tasks) {
    if (t.due_date !== today) continue
    if (t.gcal_event_id) idsEventosPropios.add(baseId(t.gcal_event_id))
    const item: ItemAgenda = {
      tipo: 'tarea',
      id: t.id,
      hora: t.due_time ? hm(t.due_time) : null,
      fin: null,
      titulo: t.text,
      empresa: empresaDe(companies, t.company_id),
      importante: !!t.importante,
      detalle: null,
      link: null,
    }
    if (item.hora) agenda.push(item)
    else sinHora.push(item)
  }
  const dia = Number(today.slice(8, 10))
  for (const p of pagos) {
    if (p.gcal_event_id) idsEventosPropios.add(baseId(p.gcal_event_id))
    if (p.dia_del_mes !== dia) continue
    agenda.push({
      tipo: 'pago',
      id: p.id,
      hora: PAGO_HORA,
      fin: null,
      titulo: p.nombre,
      empresa: empresaDe(companies, p.company_id),
      detalle: p.monto_texto,
      link: null,
    })
  }
  let calendarFallo = false
  let calendarError: Resumen['calendar_error'] = null
  if (googleConfigurado()) {
    try {
      const eventos: EventoDia[] = await eventosDelDia(today)
      for (const e of eventos) {
        // The task's and payment's own events are already on the list as themselves.
        if (idsEventosPropios.has(baseId(e.id))) continue
        const item: ItemAgenda = { tipo: 'evento', id: e.id, hora: e.hora, fin: e.fin, titulo: e.titulo, empresa: null, detalle: null, link: e.link }
        if (e.todoElDia) sinHora.push(item)
        else agenda.push(item)
      }
    } catch (err) {
      // No connection, token refused, Google down: the agenda simply has no events today.
      calendarFallo = true
      calendarError = explicarErrorGoogle(err)
      console.warn(`[resumen] calendar: ${mensajeError(err)}`)
    }
  }
  agenda.sort((a, b) => (a.hora ?? '').localeCompare(b.hora ?? ''))
  for (const it of [...agenda, ...sinHora]) if (it.tipo !== 'tarea') it.hecho = hechos.has(claveAgenda(it))

  // ── Priorities: the "¿qué sigue?" ranking — now, then after, then due this week ──
  const prioridades: Prioridad[] = []
  if (queSigue) {
    const push = (t: { id: string; text: string; company_id: string | null; importante: boolean }, porque: string) => {
      if (prioridades.length >= MAX_PRIORIDADES || prioridades.some((p) => p.id === t.id)) return
      prioridades.push({ id: t.id, text: t.text, empresa: empresaDe(companies, t.company_id), importante: !!t.importante, porque })
    }
    if (queSigue.ahora) push(queSigue.ahora.task, queSigue.ahora.porque)
    for (const d of queSigue.despues) push(d.task, d.porque)
    for (const t of queSigue.porVencer) push(t, t.due_date ? `vence ${t.due_date.slice(8, 10)}/${t.due_date.slice(5, 7)}` : '')
  }

  // ── Mail that waits for an answer, each line in its account's language ──
  const idiomaDe = new Map(cuentas.map((c) => [c.id, c.idioma === 'en' ? 'en' : 'es'] as const))
  const now = new Date()
  const correos: CorreoResumen[] = correosRaw.map((c) => {
    const idioma = idiomaDe.get(c.cuenta_id) ?? 'es'
    return { ...c, quien: quienCorto(c), hace: haceCuanto(c.recibido_en, now, idioma), idioma }
  })

  // ── Notes, in company order ──
  const orden = new Map(companies.map((c, i) => [c.id, i]))
  const notasOut = (notas as NotaEmpresa[])
    .filter((n) => n.nota.trim().length > 0)
    .sort((a, b) => (orden.get(a.company_id) ?? 99) - (orden.get(b.company_id) ?? 99))
    .map((n) => {
      const c = companies.find((x) => x.id === n.company_id)
      return { company_id: n.company_id, empresa: c?.name.trim() ?? '(empresa borrada)', color: c?.color ?? 'gray', nota: n.nota, updated_at: n.updated_at }
    })

  const conexiones = ((conexionesRes.data as { email: string; activa: boolean; usa_calendar: boolean | null; usa_gmail: boolean | null }[] | null) ?? []).map((c) => ({
    email: c.email,
    calendar: c.usa_calendar === true,
    correo: c.usa_gmail === true,
    activa: c.activa !== false,
  }))

  return {
    today,
    fecha_larga: formatDiaLargoEs(today),
    nombre: cfg.nombre_persona,
    kpis: kpisDe(panorama),
    agenda,
    sin_hora: sinHora,
    calendar_fallo: calendarFallo,
    calendar_error: calendarError,
    prioridades,
    correos,
    notas: notasOut,
    vencimientos,
    // Ajuste 16b: each working block carries its company's "por dónde iba".
    bloques_hoy: teToca.bloques.map((b) => {
      const n = b.company_id && b.toma_tareas ? (notas as NotaEmpresa[]).find((x) => x.company_id === b.company_id)?.nota.replace(/\s+/g, ' ').trim() : null
      return { ...b, nota: n || null }
    }),
    sin_bloque: teToca.sin_bloque,
    conexiones: {
      google_configurado: googleConfigurado(),
      cuentas: conexiones,
      // Only whether it is set up — never the token or the chat id.
      telegram: !!process.env.TELEGRAM_BOT_TOKEN && allowedChatIds().length > 0,
    },
  }
}

/** Telegram HTML → the same text without tags, for the web (fase 14: shared in html.ts). */
export { sinHtml } from './html'
