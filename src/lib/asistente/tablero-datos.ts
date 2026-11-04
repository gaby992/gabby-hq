// Fase 9c-B: the MODEL of the board picture — what goes in each of the
// four columns (Hoy sí o sí · Mañana · Esperando · Correos), at most 6
// cards each, the KPI numbers — as plain data. The drawing lives in
// tablero-imagen.tsx; keeping the model here (no JSX) lets it be tested
// and reused without a renderer.
//
// Same column rule as the web board and the lists (horizonteDe /
// columnaCorreo), so the picture never disagrees with them. No mail body
// or address ever gets here: a mail card is the sender's short name and
// the subject, nothing else.

import { createServerClient } from '@/lib/supabase-server'
import { COMPANY_COLORS, type Company, type Task } from '@/types'
import { columnaCorreo, compararEnColumna, horizonteDe, type Horizonte } from '@/lib/horizonte'
import { correosRecientes, quienCorto, type CorreoLite } from '@/lib/correo/pendientes'
import { cargarCuentas } from '@/lib/correo/cuentas'
import { isChelseaName } from '@/lib/chelsea'
import { cancunYmd, formatCortoEs, formatHoraEs } from './cancun'
import { mensajeError } from '@/lib/errores'

/** Cards per column in the picture before "ver N más". */
export const MAX_TARJETAS = 6

export type ColumnaImagen = 'hoy' | 'manana' | 'esperando' | 'correos'

export interface TarjetaImagen {
  titulo: string
  /** Company badge (or account name on a mail card); null = "sin empresa". */
  badge: { texto: string; color: string } | null
  estrella: boolean
  /** The small grey/red/purple text at the right: "vencida 1 nov", "3:00 pm", "Andrew (TOTT)". */
  nota: { texto: string; color: string } | null
}

export interface ColumnaDatos {
  id: ColumnaImagen
  titulo: string
  total: number
  tarjetas: TarjetaImagen[]
}

export interface TableroDatos {
  today: string
  kpis: { hoy: number; vencidas: number; esperando: number; correos: number }
  columnas: ColumnaDatos[]
}

export const COLOR: Record<ColumnaImagen, string> = { hoy: '#f87171', manana: '#fbbf24', esperando: '#7F77DD', correos: '#1D9E75' }
const TITULO: Record<ColumnaImagen, string> = { hoy: 'HOY SÍ O SÍ', manana: 'MAÑANA', esperando: 'ESPERANDO', correos: 'CORREOS' }
export const GRIS = '#888888'

function corto(s: string, max: number): string {
  const una = s.replace(/\s+/g, ' ').trim()
  return una.length > max ? una.slice(0, max - 1) + '…' : una
}

type TareaConEmpresa = Task & { company?: Pick<Company, 'name' | 'color'> | null }

function badgeDe(t: TareaConEmpresa): TarjetaImagen['badge'] {
  if (!t.company) return null
  return { texto: corto(t.company.name.trim(), 14), color: COMPANY_COLORS[t.company.color] ?? '#888780' }
}

// ── Data ─────────────────────────────────────────────────────────────────

/** The same reads /api/hoy does, reduced to what the picture shows. */
export async function datosTablero(today: string = cancunYmd()): Promise<TableroDatos> {
  const db = createServerClient()
  const [tasksRes, companiesRes, cuentas, correos] = await Promise.all([
    db.from('tasks').select('*, company:companies(name, color)').eq('done', false),
    db.from('companies').select('*'),
    cargarCuentas().catch((err) => {
      console.error(`[tablero-imagen] cuentas: ${mensajeError(err)}`)
      return []
    }),
    correosRecientes({ estados: ['nuevo', 'para_chelsea'], dias: 14, max: 200 }),
  ])
  if (tasksRes.error) throw new Error(`Supabase tasks: ${tasksRes.error.message}`)
  if (companiesRes.error) throw new Error(`Supabase companies: ${companiesRes.error.message}`)
  const tasks = (tasksRes.data as TareaConEmpresa[]) ?? []
  const companies = (companiesRes.data as Company[]) ?? []
  const chelseaId = companies.find((c) => isChelseaName(c.name))?.id ?? null
  const activas = new Set(cuentas.filter((c) => c.activa).map((c) => c.id))
  const mails = correos.filter((c) => activas.has(c.cuenta_id))
  return armarTablero(tasks, mails, chelseaId, today)
}

/** Pure: tasks + pending mail → the picture's model. */
export function armarTablero(tasks: TareaConEmpresa[], correos: CorreoLite[], chelseaId: string | null, today: string): TableroDatos {
  const col: Record<Horizonte, TareaConEmpresa[]> = { hoy: [], manana: [], semana: [], esperando: [], despues: [] }
  for (const t of tasks) col[horizonteDe(t, today, chelseaId)].push(t)
  for (const h of Object.keys(col) as Horizonte[]) col[h].sort((a, b) => compararEnColumna(a, b, today))
  const mailsCorreos = correos.filter((c) => columnaCorreo(c) === 'correos')
  const mailsEsperando = correos.filter((c) => columnaCorreo(c) === 'esperando')

  const tarjetaTarea = (t: TareaConEmpresa, h: ColumnaImagen): TarjetaImagen => {
    let nota: TarjetaImagen['nota'] = null
    if (h === 'hoy' && t.due_date && t.due_date < today) nota = { texto: `vencida ${formatCortoEs(t.due_date)}`, color: COLOR.hoy }
    else if (h === 'esperando') nota = { texto: corto(t.esperando_a ?? (chelseaId && t.company_id === chelseaId ? 'Chelsea' : '¿de quién?'), 18), color: COLOR.esperando }
    else if (t.due_time) nota = { texto: formatHoraEs(t.due_time.slice(0, 5)), color: GRIS }
    return { titulo: corto(t.text, 44), badge: badgeDe(t), estrella: !!t.importante, nota }
  }
  const tarjetaCorreo = (c: CorreoLite, h: ColumnaImagen): TarjetaImagen => ({
    titulo: corto(c.asunto ?? '(sin asunto)', 44),
    badge: { texto: corto(quienCorto(c), 16), color: COLOR.correos },
    estrella: c.urgencia === 'alta',
    nota: { texto: h === 'esperando' ? 'Chelsea' : corto(c.cuenta, 14), color: h === 'esperando' ? COLOR.esperando : GRIS },
  })

  const columna = (id: ColumnaImagen, tareas: TareaConEmpresa[], mails: CorreoLite[]): ColumnaDatos => {
    const todas: TarjetaImagen[] = [...tareas.map((t) => tarjetaTarea(t, id)), ...mails.map((c) => tarjetaCorreo(c, id))]
    return { id, titulo: TITULO[id], total: todas.length, tarjetas: todas.slice(0, MAX_TARJETAS) }
  }

  const vencidas = col.hoy.filter((t) => t.due_date && t.due_date < today).length
  return {
    today,
    kpis: { hoy: col.hoy.length, vencidas, esperando: col.esperando.length + mailsEsperando.length, correos: mailsCorreos.length },
    columnas: [
      columna('hoy', col.hoy, []),
      columna('manana', col.manana, []),
      columna('esperando', col.esperando, mailsEsperando),
      columna('correos', [], mailsCorreos),
    ],
  }
}
