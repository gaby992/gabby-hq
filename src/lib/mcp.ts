// Fase 19: GabbyHQ como conector de Claude (MCP remoto).
//
// Gabby le habla a Claude en cualquier chat ("ponme en el HQ los statements
// de IM para mañana") y Claude lo crea aquí con estas herramientas: tareas,
// proyectos con sus pasos, la semana por bloques. Son las MISMAS funciones
// que usan Gabita y la web, así que los tres nunca discrepan.
//
// Sin sesión ni OAuth: la llave va en la URL (/api/mcp/<llave>) y sale de un
// secreto del servidor. Quien no tiene la URL completa no entra.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServerClient } from '@/lib/supabase-server'
import { ejecutarAccion } from '@/lib/asistente/acciones'
import { cargarPlantilla, hoyTeToca, semanaParaPrompt, textoHoyTeToca } from '@/lib/asistente/bloques'
import { addDays, cancunYmd, formatDiaLargoEs } from '@/lib/asistente/cancun'
import { cargarPanorama } from '@/lib/asistente/narracion'
import { cargarEmpresas, guardarTarea } from '@/lib/asistente/tareas'
import { elegirProyecto, guardarProyecto, listarProyectos, textoProyecto, type ProyectoEstado } from '@/lib/proyectos'
import { mensajeError } from '@/lib/errores'
import { agregarACalendar, sincronizarTarea, type ResultadoSync } from '@/lib/google/sync'
import type { Cambios } from '@/lib/parser'
import type { Priority } from '@/types'
import { sinHtml } from '@/lib/asistente/html'

// ── La llave ─────────────────────────────────────────────────────────────

/** The key of the connector URL, or null when the server has no secret to derive it from. */
export function llaveMcp(): string | null {
  const secreto = process.env.MCP_SECRET || process.env.API_SECRET_SEED || process.env.CRON_SECRET
  if (!secreto) return null
  return createHmac('sha256', secreto).update('gabbyhq-mcp-v1').digest('hex').slice(0, 40)
}

export function llaveValida(dada: string | undefined | null): boolean {
  const buena = llaveMcp()
  if (!buena || !dada || dada.length !== buena.length) return false
  return timingSafeEqual(Buffer.from(dada), Buffer.from(buena))
}

// ── Las herramientas ─────────────────────────────────────────────────────

type Args = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const ymd = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined)
const hhmm = (v: unknown): string | undefined => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : undefined)
const minutos = (v: unknown): number | undefined => (typeof v === 'number' && v >= 5 && v <= 6000 ? Math.round(v) : undefined)
const prioridad = (v: unknown): Priority | undefined => (v === 'urgente' || v === 'normal' || v === 'cuando' ? v : undefined)

const plano = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

async function empresaDe(nombre: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!nombre) return null
  const empresas = await cargarEmpresas()
  const n = plano(nombre)
  const e = empresas.find((c) => plano(c.name) === n) ?? empresas.find((c) => plano(c.name).includes(n) || n.includes(plano(c.name)))
  if (!e) throw new Error(`no existe la empresa «${nombre}». Las que hay: ${empresas.map((c) => c.name.trim()).join(', ')}`)
  return { id: e.id, name: e.name.trim() }
}

interface FilaTarea {
  id: string
  text: string
  done: boolean
  priority: string | null
  importante: boolean | null
  due_date: string | null
  due_time: string | null
  company_id: string | null
  proyecto_id: string | null
  minutos_estimados: number | null
  estado: string | null
  notes: string | null
}

const COLS = 'id, text, done, priority, importante, due_date, due_time, company_id, proyecto_id, minutos_estimados, estado, notes'

function lineaTarea(t: FilaTarea, empresas: Map<string, string>, proyectos: Map<string, string>, hoy: string): string {
  const partes = [`[${t.id}]`, t.text]
  if (t.company_id && empresas.has(t.company_id)) partes.push(`· ${empresas.get(t.company_id)}`)
  if (t.due_date) partes.push(`· ${t.due_date < hoy ? 'VENCIDA ' : ''}${t.due_date}${t.due_time ? ` ${t.due_time.slice(0, 5)}` : ''}`)
  else partes.push('· sin fecha')
  if (t.priority && t.priority !== 'normal') partes.push(`· ${t.priority}`)
  if (t.importante) partes.push('· ★')
  if (t.minutos_estimados) partes.push(`· ${t.minutos_estimados} min`)
  if (t.estado === 'esperando') partes.push('· esperando')
  if (t.proyecto_id && proyectos.has(t.proyecto_id)) partes.push(`· proyecto «${proyectos.get(t.proyecto_id)}»`)
  return partes.join(' ')
}

/** Finds ONE open task: by its id, or by words of its title. Throws with the candidates when it is not clear. */
async function unaTarea(a: Args): Promise<FilaTarea> {
  const db = createServerClient()
  const id = str(a.id)
  if (id) {
    const { data, error } = await db.from('tasks').select(COLS).eq('id', id).maybeSingle<FilaTarea>()
    if (error) throw new Error(error.message)
    if (!data) throw new Error(`no hay ninguna tarea con el id ${id}`)
    return data
  }
  const buscar = str(a.buscar)
  if (!buscar) throw new Error('dime el id de la tarea, o "buscar" con palabras de su título')
  const { data, error } = await db.from('tasks').select(COLS).eq('done', false)
  if (error) throw new Error(error.message)
  const palabras = plano(buscar).split(/\s+/).filter((w) => w.length >= 2)
  const hits = ((data as FilaTarea[] | null) ?? []).filter((t) => palabras.every((w) => plano(t.text).includes(w)))
  if (hits.length === 1) return hits[0]
  if (hits.length === 0) throw new Error(`no encontré ninguna tarea abierta con «${buscar}». Usa listar_tareas para ver los títulos exactos.`)
  throw new Error(`«${buscar}» coincide con ${hits.length} tareas; dime cuál por su id:\n${hits.slice(0, 10).map((t) => `[${t.id}] ${t.text}${t.due_date ? ` · ${t.due_date}` : ''}`).join('\n')}`)
}

async function mapas() {
  const db = createServerClient()
  const [empresas, proy] = await Promise.all([cargarEmpresas(), db.from('proyectos').select('id, nombre')])
  return {
    empresas: new Map(empresas.map((c) => [c.id, c.name.trim()])),
    proyectos: new Map((((proy.data as { id: string; nombre: string }[] | null) ?? [])).map((p) => [p.id, p.nombre])),
  }
}

export interface Herramienta {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Read-only tools say so (Claude shows them differently from the ones that change things). */
  soloLectura: boolean
  run: (a: Args) => Promise<string>
}

const FECHA = { type: 'string', description: 'Fecha YYYY-MM-DD (hora de Cancún). Calcula tú la fecha exacta; nunca mandes "mañana" ni "viernes".' }

export const HERRAMIENTAS: Herramienta[] = [
  {
    name: 'hoy',
    description: 'Lo que Gabby tiene HOY en GabbyHQ: la fecha de hoy en Cancún, sus bloques del día con las tareas que caen en cada uno, las vencidas, lo que no cabe en ningún bloque y sus proyectos activos. Úsala primero cuando pregunte qué tiene hoy, por dónde empezar, o antes de calcular fechas.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    soloLectura: true,
    run: async () => {
      const hoy = cancunYmd()
      const p = await cargarPanorama(hoy)
      const t = await hoyTeToca(p.tasks, p.companies, hoy).catch(() => ({ bloques: [], sin_bloque: [] as { id: string; text: string }[] }))
      const vencidas = p.tasks.filter((x) => x.due_date && x.due_date < hoy)
      const proyectos = (await listarProyectos(hoy).catch(() => [])).filter((x) => x.estado === 'activo')
      const partes = [`HOY es ${formatDiaLargoEs(hoy)} (${hoy}), hora de Cancún.`]
      const bloques = t.bloques.length > 0 ? textoHoyTeToca(t.bloques) : null
      partes.push(bloques ? `BLOQUES DE HOY:\n${sinHtml(bloques)}` : 'No hay bloques para hoy.')
      if (t.sin_bloque.length > 0) partes.push(`HOY, SIN BLOQUE:\n${t.sin_bloque.map((x) => `[${x.id}] ${x.text}`).join('\n')}`)
      if (vencidas.length > 0) partes.push(`VENCIDAS (${vencidas.length}):\n${vencidas.slice(0, 25).map((x) => `[${x.id}] ${x.text} · ${x.due_date}`).join('\n')}`)
      if (proyectos.length > 0) partes.push(`PROYECTOS ACTIVOS:\n${proyectos.map((x) => textoProyecto(x, { pasos: false })).join('\n')}`)
      return partes.join('\n\n')
    },
  },
  {
    name: 'listar_tareas',
    description: 'Las tareas ABIERTAS de GabbyHQ, cada una con su id entre corchetes. Filtra por empresa (IM, PD, DATAVIA, Personal, Chelsea…), por cuándo, o por palabras del título. Úsala antes de cambiar, completar o borrar una tarea, para tener su id.',
    inputSchema: {
      type: 'object',
      properties: {
        empresa: { type: 'string', description: 'Nombre de la empresa, p. ej. "IM".' },
        cuando: { type: 'string', enum: ['hoy', 'semana', 'vencidas', 'sin_fecha', 'todas'], description: 'hoy = vence hoy o antes · semana = próximos 7 días y vencidas · todas (por defecto).' },
        texto: { type: 'string', description: 'Palabras que debe tener el título.' },
      },
      additionalProperties: false,
    },
    soloLectura: true,
    run: async (a) => {
      const hoy = cancunYmd()
      const db = createServerClient()
      const e = await empresaDe(str(a.empresa))
      let q = db.from('tasks').select(COLS).eq('done', false)
      if (e) q = q.eq('company_id', e.id)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      let filas = ((data as FilaTarea[] | null) ?? []).filter((t) => t.estado !== 'cancelada')
      const cuando = str(a.cuando) ?? 'todas'
      if (cuando === 'hoy') filas = filas.filter((t) => t.due_date && t.due_date <= hoy)
      else if (cuando === 'semana') filas = filas.filter((t) => t.due_date && t.due_date <= addDays(hoy, 7))
      else if (cuando === 'vencidas') filas = filas.filter((t) => t.due_date && t.due_date < hoy)
      else if (cuando === 'sin_fecha') filas = filas.filter((t) => !t.due_date)
      const texto = str(a.texto)
      if (texto) {
        const palabras = plano(texto).split(/\s+/).filter(Boolean)
        filas = filas.filter((t) => palabras.every((w) => plano(t.text).includes(w)))
      }
      filas.sort((x, y) => (x.due_date ?? '9999').localeCompare(y.due_date ?? '9999') || x.text.localeCompare(y.text))
      if (filas.length === 0) return 'No hay tareas abiertas con ese filtro.'
      const m = await mapas()
      const max = 80
      return [`${filas.length} tareas abiertas${e ? ` de ${e.name}` : ''} (hoy es ${hoy}):`, ...filas.slice(0, max).map((t) => lineaTarea(t, m.empresas, m.proyectos, hoy)), ...(filas.length > max ? [`(+${filas.length - max} más: afina el filtro)`] : [])].join('\n')
    },
  },
  {
    name: 'crear_tareas',
    description: 'Crea una o varias tareas en GabbyHQ. Cada una debe llevar empresa y, si Gabby dio una, su fecha exacta. Una tarea con fecha aparece ese día en su lista y en su bloque. Si además lleva HORA puntual, se crea sola su cita en Google Calendar (sin hora, nunca va al calendario). No inventes fechas, tiempos ni tareas que ella no dijo.',
    inputSchema: {
      type: 'object',
      properties: {
        tareas: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'Solo lo que hay que hacer. Sin la empresa, la fecha ni el bloque.' },
              empresa: { type: 'string', description: 'IM, PD, DATAVIA, Personal, Chelsea…' },
              fecha: FECHA,
              hora: { type: 'string', description: 'HH:MM en 24 h, solo si tiene hora puntual (entonces también va a Google Calendar).' },
              prioridad: { type: 'string', enum: ['urgente', 'normal', 'cuando'] },
              importante: { type: 'boolean', description: 'true = con estrella ★ (lo primero del día).' },
              minutos: { type: 'number', description: 'Cuánto tarda, solo si ella lo dijo.' },
              proyecto: { type: 'string', description: 'Nombre de un proyecto existente, si es un paso de ese proyecto.' },
            },
            required: ['titulo'],
            additionalProperties: false,
          },
        },
      },
      required: ['tareas'],
      additionalProperties: false,
    },
    soloLectura: false,
    run: async (a) => {
      const lista = Array.isArray(a.tareas) ? (a.tareas as Args[]) : []
      if (lista.length === 0) throw new Error('manda al menos una tarea')
      const db = createServerClient()
      const proyectos = await listarProyectos().catch(() => [])
      const out: string[] = []
      for (const t of lista.slice(0, 30)) {
        const titulo = str(t.titulo)
        if (!titulo) {
          out.push('⚠️ una tarea sin título no se creó')
          continue
        }
        try {
          const e = await empresaDe(str(t.empresa))
          const fecha = ymd(t.fecha)
          if (t.fecha !== undefined && !fecha) throw new Error(`la fecha «${String(t.fecha)}» no es YYYY-MM-DD`)
          const p = prioridad(t.prioridad) ?? 'normal'
          const g = await guardarTarea({
            text: titulo.slice(0, 300),
            priority: p,
            company_id: e?.id ?? null,
            company_name: e?.name ?? null,
            importante: t.importante === true || p === 'urgente',
            due_date: fecha ?? null,
            due_time: fecha ? (hhmm(t.hora) ?? null) : null,
          })
          const extra: Record<string, unknown> = {}
          const min = minutos(t.minutos)
          if (min) extra.minutos_estimados = min
          const nombreProyecto = str(t.proyecto)
          const proy = nombreProyecto ? elegirProyecto(nombreProyecto, proyectos.filter((x) => x.estado !== 'terminado')) : null
          if (nombreProyecto && !proy) out.push(`⚠️ no encontré el proyecto «${nombreProyecto}»: la tarea quedó suelta`)
          if (proy) extra.proyecto_id = proy.id
          if (Object.keys(extra).length > 0) await db.from('tasks').update(extra).eq('id', g.id)
          // Connector rule: an hour means Calendar too (no hour → task only, never an event).
          const cal = fecha && hhmm(t.hora) ? await agregarACalendar(g.id).catch((err): ResultadoSync => ({ estado: 'error', aviso: `⚠️ sin evento en Calendar: ${mensajeError(err)}` })) : null
          out.push(`✅ [${g.id}] ${titulo}${e ? ` · ${e.name}` : ' · SIN EMPRESA'}${fecha ? ` · ${fecha}${hhmm(t.hora) ? ` ${hhmm(t.hora)}` : ''}` : ' · sin fecha'}${t.importante === true ? ' · ★' : ''}${proy ? ` · proyecto «${proy.nombre}»` : ''}${cal?.confirmacion ? ' · 📅 en Calendar' : ''}`)
          if (cal?.aviso) out.push(`   ${cal.aviso}`)
        } catch (err) {
          out.push(`⚠️ «${titulo}» no se creó: ${mensajeError(err)}`)
        }
      }
      return out.join('\n')
    },
  },
  {
    name: 'actualizar_tarea',
    description: 'Cambia UNA tarea existente: moverla de fecha, ponerle hora, prioridad, estrella, empresa, tiempo, renombrarla, marcarla hecha o borrarla. Identifícala con "id" (de listar_tareas) o con "buscar" (palabras de su título). Borrar no se puede deshacer: hazlo solo si Gabby lo pidió.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        buscar: { type: 'string', description: 'Palabras del título, si no tienes el id.' },
        titulo: { type: 'string', description: 'Nombre nuevo.' },
        fecha: { ...FECHA, description: 'Fecha nueva YYYY-MM-DD.' },
        quitar_fecha: { type: 'boolean' },
        hora: { type: 'string', description: 'HH:MM en 24 h. Con hora, la tarea también queda en Google Calendar.' },
        prioridad: { type: 'string', enum: ['urgente', 'normal', 'cuando'] },
        importante: { type: 'boolean' },
        empresa: { type: 'string' },
        minutos: { type: 'number' },
        hecha: { type: 'boolean', description: 'true = completarla.' },
        borrar: { type: 'boolean', description: 'true = eliminarla para siempre.' },
      },
      additionalProperties: false,
    },
    soloLectura: false,
    run: async (a) => {
      const t = await unaTarea(a)
      if (a.borrar === true) return await ejecutarAccion({ accion: 'borra' }, [t.id])
      if (a.hecha === true) return await ejecutarAccion({ accion: 'listo' }, [t.id])
      const db = createServerClient()
      const hechos: string[] = []
      const cambios: Cambios = {}
      const fecha = ymd(a.fecha)
      if (a.fecha !== undefined && !fecha) throw new Error(`la fecha «${String(a.fecha)}» no es YYYY-MM-DD`)
      if (fecha) cambios.due_date = fecha
      const hora = hhmm(a.hora)
      if (hora) {
        cambios.due_time = hora
        cambios.calendar = true // connector rule: an hour means Calendar too
      }
      const p = prioridad(a.prioridad)
      if (p) cambios.priority = p
      if (typeof a.importante === 'boolean') cambios.importante = a.importante
      const e = await empresaDe(str(a.empresa))
      if (e) {
        cambios.company_id = e.id
        cambios.company_name = e.name
      }
      if (Object.keys(cambios).length > 0) hechos.push(await ejecutarAccion({ accion: 'editar', cambios }, [t.id]))
      const directo: Record<string, unknown> = {}
      const titulo = str(a.titulo)
      if (titulo) directo.text = titulo.slice(0, 300)
      const min = minutos(a.minutos)
      if (min) directo.minutos_estimados = min
      if (a.quitar_fecha === true && !fecha) {
        directo.due_date = null
        directo.due_time = null
      }
      if (Object.keys(directo).length > 0) {
        const { error } = await db.from('tasks').update(directo).eq('id', t.id)
        if (error) throw new Error(error.message)
        hechos.push(`✏️ «${titulo ?? t.text}»${min ? ` · ${min} min` : ''}${directo.due_date === null ? ' · sin fecha' : ''}`)
        // Keep an existing Calendar event in step (new title, or no date → event removed).
        if (directo.text !== undefined || directo.due_date === null) {
          const r = await sincronizarTarea(t.id)
          if (r.aviso) hechos.push(r.aviso)
        }
      }
      if (hechos.length === 0) throw new Error('no me dijiste qué cambiar')
      return hechos.join('\n')
    },
  },
  {
    name: 'listar_proyectos',
    description: 'Los proyectos de GabbyHQ con sus 4 definiciones (qué es terminado, producción, pruebas, salida), cuántos días faltan, sus pasos pendientes y lo que falta definir.',
    inputSchema: { type: 'object', properties: { incluir_terminados: { type: 'boolean' } }, additionalProperties: false },
    soloLectura: true,
    run: async (a) => {
      const todos = await listarProyectos()
      const ps = todos.filter((p) => a.incluir_terminados === true || p.estado !== 'terminado')
      if (ps.length === 0) return 'No hay proyectos todavía.'
      return ps.map((p) => `${textoProyecto(p)}${p.estado !== 'activo' ? `\n   (${p.estado})` : ''}\n   pasos con id: ${p.pasos.filter((s) => !s.done).map((s) => `[${s.id}] ${s.text}`).join(' · ') || '—'}`).join('\n\n')
    },
  },
  {
    name: 'guardar_proyecto',
    description: 'Crea un proyecto, o completa uno que ya existe con ese nombre (fechas, qué es terminado, estado, pasos nuevos). Regla de Gabby: todo proyecto lleva qué es "terminado" (la versión mínima), producción, pruebas y fecha de salida. Manda solo lo que ella definió: lo que falte queda marcado en rojo en GabbyHQ y se lo preguntas. Los pasos son tareas: aparecen en sus bloques el día de su fecha.',
    inputSchema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        empresa: { type: 'string' },
        terminado: { type: 'string', description: 'Qué tiene que existir para decir "ya está", en palabras de Gabby.' },
        produccion_desde: FECHA,
        produccion_hasta: FECHA,
        pruebas_desde: FECHA,
        pruebas_hasta: FECHA,
        salida: FECHA,
        estado: { type: 'string', enum: ['activo', 'pausado', 'terminado'] },
        pasos: {
          type: 'array',
          maxItems: 30,
          items: {
            type: 'object',
            properties: { titulo: { type: 'string' }, fecha: FECHA, minutos: { type: 'number' } },
            required: ['titulo'],
            additionalProperties: false,
          },
        },
      },
      required: ['nombre'],
      additionalProperties: false,
    },
    soloLectura: false,
    run: async (a) => {
      const nombre = str(a.nombre)
      if (!nombre) throw new Error('el proyecto necesita un nombre')
      const e = await empresaDe(str(a.empresa))
      const fechas: Record<string, string> = {}
      for (const k of ['produccion_desde', 'produccion_hasta', 'pruebas_desde', 'pruebas_hasta', 'salida'] as const) {
        if (a[k] === undefined) continue
        const f = ymd(a[k])
        if (!f) throw new Error(`${k} «${String(a[k])}» no es YYYY-MM-DD`)
        fechas[k] = f
      }
      const estado = a.estado === 'activo' || a.estado === 'pausado' || a.estado === 'terminado' ? (a.estado as ProyectoEstado) : undefined
      const pasos = (Array.isArray(a.pasos) ? (a.pasos as Args[]) : []).map((p) => ({ titulo: str(p.titulo) ?? '', fecha: ymd(p.fecha) ?? null, minutos: minutos(p.minutos) ?? null })).filter((p) => p.titulo)
      const r = await guardarProyecto({ nombre, ...(e ? { company_id: e.id } : {}), ...(str(a.terminado) ? { terminado: str(a.terminado) } : {}), ...fechas, ...(estado ? { estado } : {}) }, pasos)
      const p = (await listarProyectos()).find((x) => x.id === r.proyecto.id)
      return `${r.nuevo ? 'Proyecto creado' : 'Proyecto actualizado'}${r.pasos > 0 ? ` (+${r.pasos} pasos)` : ''}:\n${p ? textoProyecto(p) : r.proyecto.nombre}`
    },
  },
  {
    name: 'semana_por_bloques',
    description: 'La semana de Gabby por BLOQUES (su horario fijo por empresa: PD, IM, DATAVIA, estudio…) con lo que ya tiene cada bloque y cuánto tiempo le queda libre. Úsala para proponer en qué día y bloque poner un trabajo, respetando de qué empresa es cada bloque.',
    inputSchema: { type: 'object', properties: { dias: { type: 'number', description: 'Cuántos días a partir de hoy (por defecto 7, máximo 14).' } }, additionalProperties: false },
    soloLectura: true,
    run: async (a) => {
      const hoy = cancunYmd()
      const dias = typeof a.dias === 'number' ? Math.min(14, Math.max(1, Math.round(a.dias))) : 7
      const [plantilla, p] = await Promise.all([cargarPlantilla(), cargarPanorama(hoy)])
      return `Hoy es ${formatDiaLargoEs(hoy)} (${hoy}).\n${semanaParaPrompt(plantilla, hoy, dias, p.tasks, p.companies, hoy)}`
    },
  },
]

// ── JSON-RPC ─────────────────────────────────────────────────────────────

const VERSIONES = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCCIONES =
  'GabbyHQ es el sistema de Gabby para sus tareas, proyectos y su semana por bloques (empresas: IM, PD, DATAVIA, Personal, Chelsea). ' +
  'Cuando te pida anotar, mover o revisar algo, hazlo aquí. Llama a "hoy" para saber la fecha en Cancún antes de calcular fechas. ' +
  'Sus reglas: toda tarea lleva empresa; lo que tiene HORA puntual va a su calendario, lo demás es tarea con fecha; todo proyecto lleva qué es "terminado", producción, pruebas y salida. ' +
  'No inventes tareas, pasos, fechas ni tiempos que ella no dijo: pregúntale. Después de cambiar algo, dile en una línea qué quedó.'

interface Peticion {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

/** Answers one JSON-RPC message. Null = a notification (no answer). */
export async function atender(m: Peticion): Promise<Record<string, unknown> | null> {
  const id = m.id
  const esNotificacion = id === undefined || id === null
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const fallo = (code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fallo(-32600, 'Invalid Request')

  switch (m.method) {
    case 'initialize': {
      const pedida = typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : ''
      return ok({
        protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gabbyhq', title: 'GabbyHQ', version: '1.0.0' },
        instructions: INSTRUCCIONES,
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({
        tools: HERRAMIENTAS.map((h) => ({
          name: h.name,
          title: h.name.replace(/_/g, ' '),
          description: h.description,
          inputSchema: h.inputSchema,
          annotations: { readOnlyHint: h.soloLectura, destructiveHint: h.name === 'actualizar_tarea', openWorldHint: false },
        })),
      })
    case 'tools/call': {
      const nombre = typeof m.params?.name === 'string' ? m.params.name : ''
      const h = HERRAMIENTAS.find((x) => x.name === nombre)
      if (!h) return fallo(-32602, `Unknown tool: ${nombre}`)
      const args = (m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {}) as Args
      try {
        return ok({ content: [{ type: 'text', text: await h.run(args) }], isError: false })
      } catch (err) {
        // A tool that fails is a RESULT the model can read and fix, not a protocol error.
        console.warn(`[mcp] ${nombre}: ${mensajeError(err)}`)
        return ok({ content: [{ type: 'text', text: `No se pudo: ${mensajeError(err)}` }], isError: true })
      }
    }
    case 'resources/list':
      return ok({ resources: [] })
    case 'prompts/list':
      return ok({ prompts: [] })
    default:
      if (esNotificacion || m.method.startsWith('notifications/')) return null
      return fallo(-32601, `Method not found: ${m.method}`)
  }
}
