// Fase 17: proyectos. A project is something with an END: it carries the
// four definitions she asks for before starting anything ("terminado",
// production, tests, release — with dates) and groups its steps, which are
// ordinary tasks (tasks.proyecto_id). The steps fall in her blocks like any
// other task; the project is seen whole in /proyectos, in the Resumen and
// when she asks Gabita.

import { createServerClient } from '@/lib/supabase-server'
import { cancunYmd, formatCortoEs } from '@/lib/asistente/cancun'
import { similitud } from '@/lib/asistente/similitud'
import { normalizar } from '@/lib/asistente/acciones'

export type ProyectoEstado = 'activo' | 'pausado' | 'terminado'

export interface Proyecto {
  id: string
  nombre: string
  company_id: string | null
  terminado: string
  produccion_desde: string | null
  produccion_hasta: string | null
  pruebas_desde: string | null
  pruebas_hasta: string | null
  salida: string | null
  estado: ProyectoEstado
  notas: string
  creado: string
  actualizado: string
}

export interface PasoProyecto {
  id: string
  text: string
  done: boolean
  due_date: string | null
  minutos_estimados: number | null
}

export interface ProyectoConPasos extends Proyecto {
  empresa: string | null
  pasos: PasoProyecto[]
  hechos: number
  /** Days until `salida` (negative = late). Null without a date. */
  dias: number | null
  /** Which of the four definitions are missing, in her words. */
  falta: string[]
}

/** What Gabita or the web may send to create or change a project. */
export interface ProyectoEntrada {
  nombre?: string
  company_id?: string | null
  terminado?: string
  produccion_desde?: string | null
  produccion_hasta?: string | null
  pruebas_desde?: string | null
  pruebas_hasta?: string | null
  salida?: string | null
  estado?: ProyectoEstado
  notas?: string
}

export interface PasoEntrada {
  titulo: string
  fecha?: string | null
  minutos?: number | null
}

const FALTA_SQL = 'Todavía no existe la tabla de proyectos (falta correr el SQL de la fase 17 en Supabase).'

export function explicarProyectos(mensaje: string): string {
  return /proyectos|proyecto_id/.test(mensaje) && /does not exist|schema cache|could not find/i.test(mensaje) ? FALTA_SQL : mensaje
}

function ymd(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

/** The four definitions that are still empty, in the order she asks them. */
export function loQueFalta(p: Pick<Proyecto, 'terminado' | 'produccion_hasta' | 'produccion_desde' | 'pruebas_desde' | 'pruebas_hasta' | 'salida'>): string[] {
  const out: string[] = []
  if (!p.terminado.trim()) out.push('qué es «terminado»')
  if (!p.produccion_desde && !p.produccion_hasta) out.push('fechas de producción')
  if (!p.pruebas_desde && !p.pruebas_hasta) out.push('fechas de pruebas')
  if (!p.salida) out.push('fecha de salida')
  return out
}

/** Only the fields that came, cleaned. Dates that are not YYYY-MM-DD are dropped, never guessed. */
export function limpiarEntrada(e: ProyectoEntrada): Partial<Proyecto> {
  const out: Partial<Proyecto> = {}
  if (typeof e.nombre === 'string' && e.nombre.trim()) out.nombre = e.nombre.trim().slice(0, 120)
  if (e.company_id !== undefined) out.company_id = e.company_id || null
  if (typeof e.terminado === 'string') out.terminado = e.terminado.trim().slice(0, 1000)
  for (const k of ['produccion_desde', 'produccion_hasta', 'pruebas_desde', 'pruebas_hasta', 'salida'] as const) {
    if (e[k] !== undefined) out[k] = ymd(e[k])
  }
  if (e.estado === 'activo' || e.estado === 'pausado' || e.estado === 'terminado') out.estado = e.estado
  if (typeof e.notas === 'string') out.notas = e.notas.trim().slice(0, 4000)
  return out
}

function armar(p: Proyecto, pasos: PasoProyecto[], empresa: string | null, hoy: string): ProyectoConPasos {
  const orden = [...pasos].sort((a, b) => Number(a.done) - Number(b.done) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
  return {
    ...p,
    empresa,
    pasos: orden,
    hechos: pasos.filter((x) => x.done).length,
    dias: p.salida ? diasEntre(hoy, p.salida) : null,
    falta: loQueFalta(p),
  }
}

/** Every project with its steps: active first, the nearest release on top. */
export async function listarProyectos(hoy: string = cancunYmd()): Promise<ProyectoConPasos[]> {
  const db = createServerClient()
  const { data, error } = await db.from('proyectos').select('*, company:companies(name)')
  if (error) throw new Error(explicarProyectos(error.message))
  const filas = (data as (Proyecto & { company: { name: string } | null })[] | null) ?? []
  if (filas.length === 0) return []
  const t = await db.from('tasks').select('id, text, done, due_date, minutos_estimados, proyecto_id').in('proyecto_id', filas.map((p) => p.id))
  if (t.error) throw new Error(explicarProyectos(t.error.message))
  const pasos = (t.data as (PasoProyecto & { proyecto_id: string })[] | null) ?? []
  const peso: Record<ProyectoEstado, number> = { activo: 0, pausado: 1, terminado: 2 }
  return filas
    .map(({ company, ...p }) => armar(p, pasos.filter((x) => x.proyecto_id === p.id), company?.name.trim() ?? null, hoy))
    .sort((a, b) => peso[a.estado] - peso[b.estado] || (a.salida ?? '9999').localeCompare(b.salida ?? '9999') || a.nombre.localeCompare(b.nombre))
}

/** Never throws: the Resumen and Gabita's prompt simply show no projects without the SQL. */
export async function proyectosActivos(hoy: string = cancunYmd()): Promise<ProyectoConPasos[]> {
  try {
    return (await listarProyectos(hoy)).filter((p) => p.estado === 'activo')
  } catch {
    return []
  }
}

/** The project she means by name: exact, contained, or clearly the most similar. */
export function elegirProyecto<T extends { nombre: string }>(nombre: string, proyectos: T[]): T | null {
  const n = normalizar(nombre).trim()
  if (!n) return null
  const exacto = proyectos.find((p) => normalizar(p.nombre).trim() === n)
  if (exacto) return exacto
  const dentro = proyectos.filter((p) => normalizar(p.nombre).includes(n) || n.includes(normalizar(p.nombre).trim()))
  if (dentro.length === 1) return dentro[0]
  const parecidos = proyectos.map((p) => ({ p, s: similitud(nombre, p.nombre) })).filter((x) => x.s >= 0.7).sort((a, b) => b.s - a.s)
  return parecidos[0]?.p ?? null
}

export async function agregarPasos(proyecto: Pick<Proyecto, 'id' | 'company_id'>, pasos: PasoEntrada[]): Promise<number> {
  const filas = pasos
    .map((p) => ({ titulo: (p.titulo ?? '').trim().slice(0, 300), fecha: ymd(p.fecha), minutos: typeof p.minutos === 'number' && p.minutos >= 5 && p.minutos <= 6000 ? Math.round(p.minutos) : null }))
    .filter((p) => p.titulo)
  if (filas.length === 0) return 0
  const { error } = await createServerClient().from('tasks').insert(
    filas.map((p) => ({
      text: p.titulo,
      priority: 'normal',
      importante: false,
      company_id: proyecto.company_id,
      due_date: p.fecha,
      done: false,
      minutos_estimados: p.minutos,
      proyecto_id: proyecto.id,
    }))
  )
  if (error) throw new Error(explicarProyectos(`Supabase tasks: ${error.message}`))
  return filas.length
}

export interface ResultadoProyecto {
  proyecto: Proyecto
  nuevo: boolean
  pasos: number
}

/**
 * Creates the project, or — when one with that name already exists — fills
 * in what came ("el proyecto CPT sale el 30") and adds the new steps.
 */
export async function guardarProyecto(entrada: ProyectoEntrada, pasos: PasoEntrada[] = []): Promise<ResultadoProyecto> {
  const db = createServerClient()
  const limpio = limpiarEntrada(entrada)
  if (!limpio.nombre) throw new Error('el proyecto necesita un nombre')
  const ex = await db.from('proyectos').select('*').neq('estado', 'terminado')
  if (ex.error) throw new Error(explicarProyectos(ex.error.message))
  const existente = elegirProyecto(limpio.nombre, (ex.data as Proyecto[] | null) ?? [])
  let proyecto: Proyecto
  if (existente) {
    // The name she used to find it is not a rename.
    const { nombre: _n, ...cambios } = limpio
    void _n
    const { data, error } = await db.from('proyectos').update({ ...cambios, actualizado: new Date().toISOString() }).eq('id', existente.id).select('*').single<Proyecto>()
    if (error) throw new Error(explicarProyectos(error.message))
    proyecto = data
  } else {
    const { data, error } = await db.from('proyectos').insert(limpio).select('*').single<Proyecto>()
    if (error) throw new Error(explicarProyectos(error.message))
    proyecto = data
  }
  const n = await agregarPasos(proyecto, pasos)
  return { proyecto, nuevo: !existente, pasos: n }
}

function rango(desde: string | null, hasta: string | null): string | null {
  if (desde && hasta) return desde === hasta ? formatCortoEs(desde) : `${formatCortoEs(desde)} → ${formatCortoEs(hasta)}`
  const una = desde ?? hasta
  return una ? formatCortoEs(una) : null
}

/** "sale en 11 días" · "sale HOY" · "salía hace 3 días". */
export function cuentaRegresiva(dias: number | null): string {
  if (dias === null) return 'sin fecha de salida'
  if (dias === 0) return 'sale HOY'
  if (dias === 1) return 'sale mañana'
  return dias > 0 ? `sale en ${dias} días` : `salía hace ${-dias} ${dias === -1 ? 'día' : 'días'}`
}

/** One project as plain text (Telegram, Gabita's prompt). */
export function textoProyecto(p: ProyectoConPasos, opts: { pasos?: boolean } = {}): string {
  const lineas = [`📁 ${p.nombre}${p.empresa ? ` · ${p.empresa}` : ''} — ${cuentaRegresiva(p.dias)}${p.salida ? ` (${formatCortoEs(p.salida)})` : ''}`]
  if (p.terminado) lineas.push(`   Terminado = ${p.terminado}`)
  const prod = rango(p.produccion_desde, p.produccion_hasta)
  const pru = rango(p.pruebas_desde, p.pruebas_hasta)
  if (prod || pru) lineas.push(`   ${[prod ? `Producción: ${prod}` : null, pru ? `Pruebas: ${pru}` : null].filter(Boolean).join(' · ')}`)
  if (p.pasos.length > 0) lineas.push(`   Pasos: ${p.hechos} de ${p.pasos.length} hechos`)
  if (opts.pasos !== false) {
    for (const s of p.pasos.filter((x) => !x.done).slice(0, 8)) lineas.push(`   ▫️ ${s.text}${s.due_date ? ` · ${formatCortoEs(s.due_date)}` : ''}`)
  }
  if (p.falta.length > 0) lineas.push(`   ⚠️ Falta definir: ${p.falta.join(', ')}`)
  return lineas.join('\n')
}

/** "¿cómo van mis proyectos?" */
export function textoProyectos(ps: ProyectoConPasos[]): string {
  const activos = ps.filter((p) => p.estado === 'activo')
  if (activos.length === 0) return 'No tienes proyectos activos. Para abrir uno: «proyecto nuevo: agente de CPT, DATAVIA, sale el 30».'
  return activos.map((p) => textoProyecto(p)).join('\n\n')
}
