'use client'

import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { CORREO_ACCION_LABELS, CORREO_URGENCIA_EMOJI, type Company, type CorreoAccion, type Task } from '@/types'
import type { CorreoLite } from '@/lib/correo/pendientes'
import {
  HORIZONTES,
  HORIZONTE_EMOJI,
  HORIZONTE_LABELS,
  columnaCorreo,
  compararEnColumna,
  edadTarjeta,
  fechaSemana,
  horizonteDe,
  type Horizonte,
} from '@/lib/horizonte'
import { daysSince, formatShortEs } from '@/lib/dates'
import { addDays } from '@/lib/asistente/cancun'
import { findChelseaCompany } from '@/lib/chelsea'
import CompanyBadge from './CompanyBadge'

/** Cards shown per column before "ver N más". */
const MAX_VISIBLES = 8

export type Columna = Horizonte | 'correos'
const COLUMNAS: Columna[] = [...HORIZONTES, 'correos']

/** DOM id of a column, so the KPI strip can scroll to it. */
export function idColumna(col: Columna): string {
  return `col-${col}`
}

/** Where a task may be dropped, and where a mail may. */
const DESTINOS_TAREA: Horizonte[] = ['hoy', 'manana', 'semana', 'esperando', 'despues']
const DESTINOS_CORREO: Horizonte[] = ['hoy', 'manana', 'esperando']

const ICONO_ACCION: Record<CorreoAccion, string> = { chelsea: '📨', yo: '🙋', tarea: '➕', archivar: '🗄' }
const ACCIONES_CORREO: CorreoAccion[] = ['chelsea', 'yo', 'tarea', 'archivar']

const ESTILO: Record<Columna, { borde: string; titulo: string; cuenta: string }> = {
  hoy: { borde: 'border-red-900/60', titulo: 'text-red-400', cuenta: 'bg-red-950/60 text-red-400' },
  manana: { borde: 'border-amber-900/50', titulo: 'text-amber-400', cuenta: 'bg-amber-950/50 text-amber-400' },
  semana: { borde: 'border-[#378ADD]/40', titulo: 'text-[#378ADD]', cuenta: 'bg-[#378ADD]/15 text-[#378ADD]' },
  esperando: { borde: 'border-[#7F77DD]/40', titulo: 'text-[#7F77DD]', cuenta: 'bg-[#1e1a3d] text-[#7F77DD]' },
  despues: { borde: 'border-[#333333]', titulo: 'text-[#888888]', cuenta: 'bg-[#2a2a2a] text-[#888888]' },
  correos: { borde: 'border-[#1D9E75]/40', titulo: 'text-[#1D9E75]', cuenta: 'bg-[#1D9E75]/15 text-[#1D9E75]' },
}

/** What travels in a drag: the kind and the id. Mail cards cannot go everywhere. */
type Arrastre = { kind: 'task'; id: string } | { kind: 'correo'; id: string }

function leerArrastre(e: DragEvent): Arrastre | null {
  try {
    const raw = e.dataTransfer.getData('application/x-gabbyhq')
    if (!raw) return null
    const j = JSON.parse(raw)
    if ((j.kind === 'task' || j.kind === 'correo') && typeof j.id === 'string') return j
  } catch {
    /* not ours */
  }
  return null
}

function hora12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

function haceCorto(iso: string | null): string {
  if (!iso) return ''
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} d`
}

function quien(c: CorreoLite): string {
  const dominio = c.de_email?.split('@')[1]?.split('.')[0]
  if (c.de_nombre) return dominio && !c.de_nombre.toLowerCase().includes(dominio.toLowerCase()) ? `${c.de_nombre} (${dominio.toUpperCase()})` : c.de_nombre
  return c.de_email ?? '(sin remitente)'
}

export interface TableroProps {
  /** Open tasks only, already filtered by the company chips. */
  tasks: Task[]
  companies: Company[]
  /** Pending mail of the active accounts (nuevo / para_chelsea), already filtered by the chips. */
  correos: CorreoLite[]
  today: string
  /** Anything changed on the server: refetch. */
  onChanged: () => void
  /** Click on a task card → the edit panel. */
  onOpenTask: (task: Task) => void
  /** Fase 9b: the column a KPI click points at (a ring for a moment). */
  resaltada?: Columna | null
}

/**
 * Fase 9: the board — six columns, one horizon each. Native HTML5 drag &
 * drop (no library) with a "Mover a…" menu on every card as the touch
 * fallback. Every action goes through POST /api/hoy (the bot's functions),
 * never to Supabase from here.
 */
export default function Tablero({ tasks, companies, correos, today, onChanged, onOpenTask, resaltada = null }: TableroProps) {
  const [sobre, setSobre] = useState<Columna | null>(null)
  // Fase 9b: the card whose "sin empresa" badge is open as a selector.
  const [empresaDe, setEmpresaDe] = useState<string | null>(null)
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set())
  const [abiertas, setAbiertas] = useState<Set<Columna>>(new Set())
  const [menu, setMenu] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // "¿De quién?" after a drop on ⏳: the pending move until she answers (or skips).
  const [preguntaQuien, setPreguntaQuien] = useState<{ arrastre: Arrastre; texto: string } | null>(null)

  const chelseaId = findChelseaCompany(companies)?.id ?? null

  const columnas = useMemo(() => {
    const out: Record<Horizonte, Task[]> = { hoy: [], manana: [], semana: [], esperando: [], despues: [] }
    for (const t of tasks) out[horizonteDe(t, today, chelseaId)].push(t)
    for (const h of HORIZONTES) out[h].sort((a, b) => compararEnColumna(a, b, today))
    return out
  }, [tasks, today, chelseaId])

  const correosPorColumna = useMemo(() => {
    const out: { correos: CorreoLite[]; esperando: CorreoLite[] } = { correos: [], esperando: [] }
    for (const c of correos) {
      const col = columnaCorreo(c)
      if (col) out[col].push(c)
    }
    return out
  }, [correos])

  function ocupar(id: string, v: boolean) {
    setOcupadas((prev) => {
      const next = new Set(prev)
      if (v) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function post(body: Record<string, unknown>, id: string): Promise<boolean> {
    setError(null)
    setMensaje(null)
    ocupar(id, true)
    try {
      const res = await fetch('/api/hoy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setMensaje(typeof json?.texto === 'string' ? json.texto.split('\n')[0] : 'Hecho')
      onChanged()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      ocupar(id, false)
    }
  }

  /** The one entry point for a drop and for "Mover a…". */
  async function mover(a: Arrastre, destino: Horizonte, esperandoA?: string | null) {
    setMenu(null)
    if (a.kind === 'task') {
      if (destino === 'esperando' && esperandoA === undefined) {
        const t = tasks.find((x) => x.id === a.id)
        setPreguntaQuien({ arrastre: a, texto: t?.text ?? '' })
        return
      }
      await post({ accion: 'mover', task_id: a.id, destino, esperando_a: esperandoA ?? null }, a.id)
      return
    }
    if (!DESTINOS_CORREO.includes(destino)) {
      setError('Un correo solo puede ir a Hoy, Mañana (lo hago yo) o Esperando (para Chelsea).')
      return
    }
    await post({ accion: 'correo', correo_id: a.id, destino }, a.id)
  }

  async function completar(t: Task) {
    await post({ accion: 'completar', task_id: t.id }, t.id)
  }

  /** Fase 9b: the "sin empresa" badge → the same edit as "la 5 es de PD". */
  async function asignarEmpresa(t: Task, companyId: string) {
    setEmpresaDe(null)
    if (!companyId) return
    await post({ accion: 'empresa', task_id: t.id, company_id: companyId }, t.id)
  }

  async function decidirCorreo(c: CorreoLite, accion: CorreoAccion) {
    setError(null)
    ocupar(c.id, true)
    try {
      const res = await fetch('/api/correo', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [c.id], accion }) })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.[0]?.error) throw new Error(json?.[0]?.error ?? json?.error ?? `HTTP ${res.status}`)
      setMensaje(json?.[0]?.texto ?? 'Hecho')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      ocupar(c.id, false)
    }
  }

  // ── Drag & drop (native) ──
  function onDragStart(e: DragEvent, a: Arrastre) {
    e.dataTransfer.setData('application/x-gabbyhq', JSON.stringify(a))
    e.dataTransfer.effectAllowed = 'move'
    setMenu(null)
  }

  function onDragOver(e: DragEvent, col: Columna) {
    if (col === 'correos') return // nothing lands on the mail column
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (sobre !== col) setSobre(col)
  }

  function onDrop(e: DragEvent, col: Columna) {
    e.preventDefault()
    setSobre(null)
    if (col === 'correos') return
    const a = leerArrastre(e)
    if (!a) return
    void mover(a, col)
  }

  const fechaDe: Record<Horizonte, string | null> = {
    hoy: today,
    manana: addDays(today, 1),
    semana: fechaSemana(today),
    esperando: null,
    despues: null,
  }

  function etiquetaDestino(h: Horizonte): string {
    const f = fechaDe[h]
    return `${HORIZONTE_EMOJI[h]} ${HORIZONTE_LABELS[h]}${f ? ` · ${formatShortEs(f)}` : h === 'despues' ? ' · sin fecha' : ''}`
  }

  function renderMenu(a: Arrastre, actual: Columna) {
    const destinos = (a.kind === 'task' ? DESTINOS_TAREA : DESTINOS_CORREO).filter((h) => h !== actual)
    return (
      <div className="absolute right-0 top-6 z-20 w-52 rounded-md border border-[#333333] bg-[#111111] shadow-xl py-1" onClick={(e) => e.stopPropagation()}>
        <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-[#555555]">Mover a…</p>
        {destinos.map((h) => (
          <button
            key={h}
            onClick={() => void mover(a, h)}
            className="w-full text-left px-3 py-1.5 text-xs text-[#e8e8e8] hover:bg-[#2a2a2a] transition-colors"
          >
            {etiquetaDestino(h)}
          </button>
        ))}
      </div>
    )
  }

  function renderTarea(t: Task, col: Horizonte) {
    const busy = ocupadas.has(t.id)
    const dias = daysSince(t.created_at)
    const edad = edadTarjeta(dias)
    const vencida = col === 'hoy' && t.due_date && t.due_date < today
    const menuAbierto = menu === `t:${t.id}`
    return (
      <div
        key={t.id}
        draggable={!busy}
        onDragStart={(e) => onDragStart(e, { kind: 'task', id: t.id })}
        onClick={() => { if (!busy) onOpenTask(t) }}
        title={`${t.text}${t.notes ? `\n\n${t.notes.split('\n')[0]}` : ''}\n\ncreada hace ${dias} ${dias === 1 ? 'día' : 'días'}`}
        className={`relative group rounded-md border bg-[#1c1c1c] px-2.5 py-2 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-[#222222] ${
          busy ? 'opacity-50' : ''
        } ${edad === 'roja' ? 'border-red-900/70' : 'border-[#2a2a2a]'}`}
      >
        <div className="flex items-start gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); void completar(t) }}
            disabled={busy}
            title="Completar"
            className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 border-[#2a2a2a] hover:border-[#1D9E75] disabled:opacity-40 transition-colors"
          />
          <p className={`min-w-0 flex-1 truncate text-xs leading-5 ${edad === 'normal' ? 'text-[#e8e8e8]' : edad === 'gris' ? 'text-[#8a8a8a]' : 'text-red-300'}`}>
            {t.text}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); setMenu(menuAbierto ? null : `t:${t.id}`) }}
            title="Mover a…"
            className="flex-shrink-0 -mr-1 px-1 text-[#555555] hover:text-[#e8e8e8] transition-colors text-xs leading-5"
          >
            ⋯
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-6">
          {t.company ? (
            <CompanyBadge company={t.company} size="xs" />
          ) : empresaDe === t.id ? (
            <select
              autoFocus
              defaultValue=""
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => void asignarEmpresa(t, e.target.value)}
              onBlur={() => setEmpresaDe(null)}
              className="text-[10px] border border-[#7F77DD] rounded px-1 py-0.5 text-[#e8e8e8] bg-[#0f0f0f] focus:outline-none"
            >
              <option value="">¿de qué empresa?</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setEmpresaDe(t.id) }}
              title="Asignar empresa"
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#2a2a2a] text-[#888888] hover:text-[#e8e8e8] hover:bg-[#333333] transition-colors"
            >
              sin empresa
            </button>
          )}
          {t.due_time && <span className="text-[10px] text-[#888888]">{hora12(t.due_time.slice(0, 5))}</span>}
          {t.importante && <span className="text-[10px] text-[#EF9F27]" title="Importante">★</span>}
          {vencida && (
            <span className="text-[10px] text-red-400" title={t.due_date!}>
              vencida {formatShortEs(t.due_date!)}
            </span>
          )}
          {!vencida && t.due_date && (col === 'semana' || col === 'despues' || col === 'esperando') && (
            <span className="text-[10px] text-[#888888]" title={t.due_date}>{formatShortEs(t.due_date)}</span>
          )}
          {col === 'esperando' && (
            <span className="text-[10px] text-[#7F77DD]">⏳ {t.esperando_a ?? (chelseaId && t.company_id === chelseaId ? 'Chelsea' : '¿de quién?')}</span>
          )}
          {edad !== 'normal' && <span className={`text-[10px] ${edad === 'roja' ? 'text-red-400' : 'text-[#666666]'}`}>{dias} d</span>}
        </div>
        {menuAbierto && renderMenu({ kind: 'task', id: t.id }, col)}
      </div>
    )
  }

  function renderCorreo(c: CorreoLite, col: 'correos' | 'esperando') {
    const busy = ocupadas.has(c.id)
    const menuAbierto = menu === `c:${c.id}`
    const u = c.urgencia ?? 'media'
    return (
      <div
        key={c.id}
        draggable={!busy}
        onDragStart={(e) => onDragStart(e, { kind: 'correo', id: c.id })}
        title={`${quien(c)} · ${c.asunto ?? '(sin asunto)'}${c.resumen ? `\n\n${c.resumen}` : ''}`}
        className={`relative rounded-md border border-[#2a2a2a] bg-[#1c1c1c] px-2.5 py-2 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-[#222222] ${busy ? 'opacity-50' : ''}`}
      >
        <div className="flex items-start gap-2">
          <span className="flex-shrink-0 text-xs leading-5" title={u}>{CORREO_URGENCIA_EMOJI[u]}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs leading-5 text-[#e8e8e8]">{quien(c)}</p>
            <p className="truncate text-[11px] leading-4 text-[#888888]">{c.asunto ?? '(sin asunto)'}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setMenu(menuAbierto ? null : `c:${c.id}`) }}
            title="Mover a…"
            className="flex-shrink-0 -mr-1 px-1 text-[#555555] hover:text-[#e8e8e8] transition-colors text-xs leading-5"
          >
            ⋯
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-1 pl-6">
          <span className="text-[10px] text-[#555555] truncate">{c.cuenta} · {haceCorto(c.recibido_en)}{col === 'esperando' ? ' · 📨 Chelsea' : ''}</span>
          <div className="flex gap-0.5 flex-shrink-0">
            {ACCIONES_CORREO.filter((a) => !(col === 'esperando' && a === 'chelsea')).map((a) => (
              <button
                key={a}
                onClick={(e) => { e.stopPropagation(); void decidirCorreo(c, a) }}
                disabled={busy}
                title={CORREO_ACCION_LABELS[a]}
                className="px-1 py-0.5 text-[11px] rounded bg-[#2a2a2a] hover:bg-[#333333] disabled:opacity-40 transition-colors"
              >
                {ICONO_ACCION[a]}
              </button>
            ))}
          </div>
        </div>
        {menuAbierto && renderMenu({ kind: 'correo', id: c.id }, col)}
      </div>
    )
  }

  function renderColumna(col: Columna) {
    const tareas: Task[] = col === 'correos' ? [] : columnas[col]
    const mails: CorreoLite[] = col === 'correos' ? correosPorColumna.correos : col === 'esperando' ? correosPorColumna.esperando : []
    const total = tareas.length + mails.length
    const abierta = abiertas.has(col)
    // Tasks first, then the mail cards; the cut counts both.
    const visiblesTareas = abierta ? tareas : tareas.slice(0, MAX_VISIBLES)
    const cupoMails = abierta ? mails.length : Math.max(0, MAX_VISIBLES - visiblesTareas.length)
    const visiblesMails = mails.slice(0, cupoMails)
    const ocultas = total - visiblesTareas.length - visiblesMails.length
    const estilo = ESTILO[col]
    const esDestino = col !== 'correos'
    return (
      <section
        key={col}
        id={idColumna(col)}
        onDragOver={(e) => onDragOver(e, col)}
        onDragLeave={() => { if (sobre === col) setSobre(null) }}
        onDrop={(e) => onDrop(e, col)}
        className={`snap-start flex-shrink-0 w-[82vw] sm:w-[320px] md:w-auto flex flex-col rounded-lg border bg-[#161616] transition-all scroll-mt-20 ${estilo.borde} ${
          (sobre === col && esDestino) || resaltada === col ? 'bg-[#1e1e1e] ring-2 ring-[#7F77DD]/60' : ''
        }`}
      >
        <header className="flex items-center gap-2 px-3 py-2.5 border-b border-[#2a2a2a]">
          <h2 className={`text-sm font-semibold ${estilo.titulo}`}>
            {HORIZONTE_EMOJI[col]} {HORIZONTE_LABELS[col]}
          </h2>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${estilo.cuenta}`}>{total}</span>
          {col === 'semana' && <span className="ml-auto text-[10px] text-[#555555]" title="Una tarea soltada aquí cae en este día">→ {formatShortEs(fechaSemana(today))}</span>}
        </header>

        {col === 'esperando' && preguntaQuien && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const v = String(new FormData(e.currentTarget).get('quien') ?? '').trim()
              const a = preguntaQuien.arrastre
              setPreguntaQuien(null)
              void mover(a, 'esperando', v || null)
            }}
            className="px-3 py-2 border-b border-[#2a2a2a] space-y-1.5"
          >
            <p className="text-[11px] text-[#7F77DD] truncate">⏳ «{preguntaQuien.texto}» — ¿de quién?</p>
            <div className="flex gap-1">
              <input
                name="quien"
                autoFocus
                placeholder="Andrew (TOTT)"
                maxLength={60}
                className="min-w-0 flex-1 text-xs border border-[#2a2a2a] rounded px-2 py-1 text-[#e8e8e8] bg-[#0f0f0f] focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444]"
              />
              <button type="submit" className="px-2 py-1 text-xs rounded bg-[#7F77DD] text-white hover:bg-[#6b62d0]">OK</button>
              <button type="button" onClick={() => setPreguntaQuien(null)} className="px-1.5 py-1 text-xs text-[#555555] hover:text-[#e8e8e8]" title="Cancelar">✕</button>
            </div>
          </form>
        )}

        <div className="flex-1 min-h-[120px] max-h-[70vh] overflow-y-auto p-2 space-y-1.5">
          {total === 0 && (
            <p className="text-xs text-[#444444] px-1 py-2">{esDestino ? '— suelta aquí' : '— nada pendiente ✨'}</p>
          )}
          {visiblesTareas.map((t) => renderTarea(t, col as Horizonte))}
          {visiblesMails.map((c) => renderCorreo(c, col as 'correos' | 'esperando'))}
          {ocultas > 0 && (
            <button onClick={() => setAbiertas((prev) => new Set(prev).add(col))} className="w-full text-left px-1 py-1 text-xs text-[#7F77DD] hover:text-[#9b95e8] font-medium">
              ver {ocultas} más
            </button>
          )}
          {abierta && total > MAX_VISIBLES && (
            <button onClick={() => setAbiertas((prev) => { const n = new Set(prev); n.delete(col); return n })} className="w-full text-left px-1 py-1 text-xs text-[#555555] hover:text-[#888888]">
              ver menos
            </button>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-2" onClick={() => { if (menu) setMenu(null) }}>
      {(mensaje || error) && (
        <p className={`text-xs ${error ? 'text-red-400' : 'text-emerald-400'}`}>{error ?? mensaje}</p>
      )}
      {/* Phone: horizontal carousel with snap, 🔥 first. md+: a grid (3 per row, 6 on wide screens). */}
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-3 2xl:grid-cols-6 md:overflow-visible">
        {COLUMNAS.map(renderColumna)}
      </div>
    </div>
  )
}
