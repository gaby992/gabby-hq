import { createServerClient } from '@/lib/supabase-server'
import { cancunYmd, formatCortoEs } from '@/lib/asistente/cancun'

// Series: Gabby's mini-dramas, read straight from her "Serie: …" tasks (one task
// per episode, with the release day and a 10:30 alarm). No table of its own: the
// episode tasks ARE the data, and marking one "visto" is completing the task.
//
// Title shapes the connector writes:
//   "Serie: Oxytocin (Netflix) — cap 3 de 10"
//   "Serie: Love Me to Hurt Me (iQIYI) — cap 8 de 8, final"
//   "Serie: Loves Bound — sale cap nuevo"      (episode count not known yet)
//   "Serie: My Boss I Love You — estreno"

export interface CapSerie {
  id: string
  fecha: string | null
  fecha_txt: string
  hora: string | null
  cap: number | null
  etiqueta: string
  visto: boolean
}

export interface Serie {
  nombre: string
  plataforma: string | null
  total: number | null
  voy_en: number | null
  dia: string | null
  proximo: CapSerie | null
  terminada: boolean
  caps: CapSerie[]
}

const TITULO = /^serie:\s*(.+?)\s*(?:\(([^)]+)\))?\s*[—–-]\s*(.*)$/i
const CAP = /cap(?:[ií]tulo)?\s+(\d+)\s+de\s+(\d+)/i
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function diaSemana(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

export async function cargarSeries(): Promise<Serie[]> {
  const { data, error } = await createServerClient()
    .from('tasks')
    .select('id, text, done, due_date, due_time')
    .ilike('text', 'serie:%')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(500)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const hoy = cancunYmd()

  const porSerie = new Map<string, { nombre: string; plataforma: string | null; caps: CapSerie[]; total: number | null }>()
  for (const t of (data ?? []) as { id: string; text: string; done: boolean; due_date: string | null; due_time: string | null }[]) {
    const m = TITULO.exec(t.text.trim())
    if (!m) continue
    const nombre = m[1].trim()
    const clave = nombre.toLowerCase()
    const c = CAP.exec(m[3])
    const s = porSerie.get(clave) ?? { nombre, plataforma: null, caps: [], total: null }
    if (m[2] && !s.plataforma) s.plataforma = m[2].trim()
    if (c) s.total = Math.max(s.total ?? 0, Number(c[2]))
    s.caps.push({
      id: t.id,
      fecha: t.due_date,
      fecha_txt: t.due_date ? `${diaSemana(t.due_date).slice(0, 3)} ${formatCortoEs(t.due_date)}` : 'sin fecha',
      hora: t.due_time ? t.due_time.slice(0, 5) : null,
      cap: c ? Number(c[1]) : null,
      etiqueta: m[3].trim(),
      visto: t.done,
    })
    porSerie.set(clave, s)
  }

  const series: Serie[] = []
  for (const s of Array.from(porSerie.values())) {
    s.caps.sort((a, b) => (a.fecha ?? '9999').localeCompare(b.fecha ?? '9999'))
    const numerados = s.caps.filter((x) => x.cap !== null)
    // What she has seen: the highest episode marked visto; the episodes before the
    // first one we track were already seen when she gave us the series.
    const primero = numerados.length ? Math.min(...numerados.map((x) => x.cap as number)) - 1 : null
    const maxVisto = numerados.filter((x) => x.visto).reduce((n, x) => Math.max(n, x.cap as number), 0)
    const voyEn = primero === null ? null : Math.max(primero, maxVisto)
    const pendientes = s.caps.filter((x) => !x.visto)
    const proximo = pendientes.find((x) => x.fecha && x.fecha >= hoy) ?? pendientes[0] ?? null
    series.push({
      nombre: s.nombre,
      plataforma: s.plataforma,
      total: s.total,
      voy_en: voyEn,
      dia: proximo?.fecha ? diaSemana(proximo.fecha) : null,
      proximo,
      // Done only when nothing is left AND she reached the last episode (if we know it).
      terminada: pendientes.length === 0 && (s.total === null || (voyEn ?? 0) >= s.total),
      caps: s.caps,
    })
  }
  // Still airing first, by next episode; finished ones at the end.
  return series.sort((a, b) => Number(a.terminada) - Number(b.terminada) || (a.proximo?.fecha ?? '9999').localeCompare(b.proximo?.fecha ?? '9999'))
}

// "En fila": series she wants to watch next, one task each, titled
//   "Para ver: Taming the Husband (Viki) — Cdrama · 26 caps, van 8"
// Starting it = completing that task (then the "Serie: …" episode tasks take over).
export interface EnFila {
  id: string
  nombre: string
  plataforma: string | null
  detalle: string
}

const FILA = /^para ver:\s*(.+?)\s*(?:\(([^)]+)\))?\s*(?:[—–-]\s*(.*))?$/i

export async function cargarEnFila(): Promise<EnFila[]> {
  const { data, error } = await createServerClient()
    .from('tasks')
    .select('id, text, created_at')
    .ilike('text', 'para ver:%')
    .eq('done', false)
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const out: EnFila[] = []
  for (const t of (data ?? []) as { id: string; text: string }[]) {
    const m = FILA.exec(t.text.trim())
    if (!m) continue
    out.push({ id: t.id, nombre: m[1].trim(), plataforma: m[2]?.trim() || null, detalle: (m[3] ?? '').trim() })
  }
  return out
}
