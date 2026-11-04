'use client'

import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { COMPANY_COLORS, type Company, type PagoRecurrente, type Task } from '@/types'
import { estaEsperando, diaSemana } from '@/lib/horizonte'
import { addDays } from '@/lib/asistente/cancun'
import { formatShortEs } from '@/lib/dates'
import CompanyBadge from './CompanyBadge'

export type ModoCalendario = 'semana' | 'mes'

/** A recurring payment as GET /api/hoy sends it (with its company's name). */
export type PagoCalendario = Pick<PagoRecurrente, 'id' | 'company_id' | 'nombre' | 'dia_del_mes' | 'monto_texto'> & { company?: { name: string } | null }

const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** Chips per day in the month grid before "+N". */
const MAX_MES = 3

function lunesDe(ymd: string): string {
  const dow = diaSemana(ymd) // 0 = Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow)
}

function primeroDe(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`
}

function ultimoDiaDe(ymd: string): number {
  const [y, m] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function mesLabel(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number)
  return `${MESES[m - 1]} ${y}`
}

function hora12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

function leerArrastre(e: DragEvent): string | null {
  try {
    const j = JSON.parse(e.dataTransfer.getData('application/x-gabbyhq'))
    return j?.kind === 'task' && typeof j.id === 'string' ? j.id : null
  } catch {
    return null
  }
}

export interface CalendarioProps {
  /** Open tasks only, already filtered by the chips. */
  tasks: Task[]
  companies: Company[]
  pagos: PagoCalendario[]
  today: string
  modo: ModoCalendario
  onModo: (m: ModoCalendario) => void
  onChanged: () => void
  onOpenTask: (task: Task) => void
}

/**
 * Fase 9b: the calendar view — a week (7 lanes, Monday first) or a month
 * grid. Tasks sit on their due_date; a drop on another day changes the date
 * and keeps the hour (POST /api/hoy, accion 'fecha'). Recurring payments
 * are painted on their day as 💳 chips (not draggable). Google Calendar
 * events are NOT read here: Calendar is on request only (fase 5).
 */
export default function Calendario({ tasks, companies, pagos, today, modo, onModo, onChanged, onOpenTask }: CalendarioProps) {
  const [ancla, setAncla] = useState(today)
  const [sobre, setSobre] = useState<string | null>(null)
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set())
  const [sinFechaAbierto, setSinFechaAbierto] = useState(false)
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null)
  // The task whose date picker is open ("Mover a…" on a phone).
  const [picker, setPicker] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const porDia = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.due_date) continue
      m.set(t.due_date, [...(m.get(t.due_date) ?? []), t])
    }
    for (const [, lista] of Array.from(m.entries())) {
      lista.sort((a, b) => {
        if (!!a.due_time !== !!b.due_time) return a.due_time ? -1 : 1
        if (a.due_time && b.due_time && a.due_time !== b.due_time) return a.due_time < b.due_time ? -1 : 1
        return 0
      })
    }
    return m
  }, [tasks])

  const sinFecha = useMemo(() => tasks.filter((t) => !t.due_date), [tasks])

  /** Payments due on a given day: day N of each month, clamped to short months. */
  function pagosDe(ymd: string): PagoCalendario[] {
    const dia = Number(ymd.slice(8, 10))
    const ultimo = ultimoDiaDe(ymd)
    return pagos.filter((p) => Math.min(p.dia_del_mes, ultimo) === dia)
  }

  function ocupar(id: string, v: boolean) {
    setOcupadas((prev) => {
      const next = new Set(prev)
      if (v) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function fechar(taskId: string, fecha: string) {
    setPicker(null)
    setError(null)
    setMensaje(null)
    ocupar(taskId, true)
    try {
      const res = await fetch('/api/hoy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'fecha', task_id: taskId, fecha }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setMensaje(typeof json?.texto === 'string' ? json.texto.split('\n')[0] : 'Hecho')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      ocupar(taskId, false)
    }
  }

  // ── Drag & drop (native): a task onto a day ──
  function onDragStart(e: DragEvent, t: Task) {
    e.dataTransfer.setData('application/x-gabbyhq', JSON.stringify({ kind: 'task', id: t.id }))
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(e: DragEvent, ymd: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (sobre !== ymd) setSobre(ymd)
  }
  function onDrop(e: DragEvent, ymd: string) {
    e.preventDefault()
    setSobre(null)
    const id = leerArrastre(e)
    if (!id) return
    const t = tasks.find((x) => x.id === id)
    if (t?.due_date === ymd) return
    void fechar(id, ymd)
  }

  // ── Navigation ──
  const lunes = lunesDe(ancla)
  const primero = primeroDe(ancla)
  function mover(n: number) {
    if (modo === 'semana') setAncla(addDays(lunes, 7 * n))
    else {
      const [y, m] = primero.split('-').map(Number)
      const d = new Date(Date.UTC(y, m - 1 + n, 1))
      setAncla(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`)
    }
  }
  const titulo = modo === 'semana' ? `${formatShortEs(lunes)} – ${formatShortEs(addDays(lunes, 6))}` : mesLabel(primero)

  // ── Pieces ──
  function renderTarea(t: Task, opts: { compacta?: boolean } = {}) {
    const busy = ocupadas.has(t.id)
    const espera = estaEsperando(t)
    const vencida = t.due_date && t.due_date < today
    const pickerAbierto = picker === t.id
    return (
      <div
        key={t.id}
        draggable={!busy}
        onDragStart={(e) => onDragStart(e, t)}
        onClick={(e) => { e.stopPropagation(); if (!busy) onOpenTask(t) }}
        title={`${t.text}${t.esperando_a ? ` · ⏳ ${t.esperando_a}` : ''}`}
        className={`relative rounded border px-1.5 py-1 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-[#222222] ${
          busy ? 'opacity-40' : espera ? 'opacity-50' : ''
        } ${vencida && !espera ? 'border-red-900/60 bg-[#1c1414]' : 'border-[#2a2a2a] bg-[#1c1c1c]'}`}
      >
        <div className="flex items-start gap-1">
          <p className={`min-w-0 flex-1 text-[11px] leading-4 ${opts.compacta ? 'truncate' : 'line-clamp-2'} text-[#e8e8e8]`}>
            {espera && '⏳ '}
            {t.due_time && <span className="text-[#888888]">{hora12(t.due_time.slice(0, 5))} </span>}
            {t.text}
            {t.importante && <span className="text-[#EF9F27]"> ★</span>}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); setPicker(pickerAbierto ? null : t.id) }}
            title="Mover a otro día"
            className="flex-shrink-0 -mr-0.5 px-0.5 text-[#555555] hover:text-[#e8e8e8] text-[11px] leading-4"
          >
            ⋯
          </button>
        </div>
        {!opts.compacta && t.company && (
          <div className="mt-0.5">
            <CompanyBadge company={t.company} size="xs" />
          </div>
        )}
        {pickerAbierto && (
          <div className="absolute left-0 top-full z-20 mt-1 rounded-md border border-[#333333] bg-[#111111] p-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[10px] uppercase tracking-wide text-[#555555] mb-1">Mover a…</p>
            <input
              type="date"
              autoFocus
              defaultValue={t.due_date ?? today}
              onChange={(e) => { if (e.target.value) void fechar(t.id, e.target.value) }}
              className="text-xs border border-[#2a2a2a] rounded px-2 py-1 text-[#e8e8e8] bg-[#0f0f0f] focus:outline-none focus:border-[#7F77DD]"
            />
          </div>
        )}
      </div>
    )
  }

  function renderPago(p: PagoCalendario) {
    const c = companies.find((x) => x.id === p.company_id)
    const color = c ? COMPANY_COLORS[c.color] ?? '#888780' : '#888780'
    return (
      <div
        key={p.id}
        title={`Pago recurrente · día ${p.dia_del_mes} de cada mes (Settings → Pagos recurrentes)`}
        className="rounded border border-dashed border-[#1D9E75]/50 bg-[#1D9E75]/10 px-1.5 py-1 text-[11px] leading-4 text-[#1D9E75] truncate"
      >
        💳 <span style={{ color }}>[{c?.name?.trim() ?? p.company?.name?.trim() ?? '?'}]</span> {p.nombre}{p.monto_texto ? ` ${p.monto_texto}` : ''}
      </div>
    )
  }

  function renderDia(ymd: string, opts: { mes?: boolean }) {
    const esHoy = ymd === today
    const enMes = !opts.mes || ymd.slice(0, 7) === primero.slice(0, 7)
    const tareas = porDia.get(ymd) ?? []
    const pagosDia = pagosDe(ymd)
    const total = tareas.length + pagosDia.length
    const visibles = opts.mes ? tareas.slice(0, MAX_MES) : tareas
    const pagosVisibles = opts.mes ? pagosDia.slice(0, Math.max(0, MAX_MES - visibles.length)) : pagosDia
    const ocultas = total - visibles.length - pagosVisibles.length
    const dow = diaSemana(ymd)
    return (
      <div
        key={ymd}
        onDragOver={(e) => onDragOver(e, ymd)}
        onDragLeave={() => { if (sobre === ymd) setSobre(null) }}
        onDrop={(e) => onDrop(e, ymd)}
        onClick={() => { if (opts.mes) setDiaAbierto(ymd) }}
        className={`flex flex-col rounded-lg border p-1.5 transition-colors ${opts.mes ? 'min-h-[88px] cursor-pointer' : 'min-h-[160px]'} ${
          sobre === ymd ? 'ring-2 ring-[#7F77DD]/60 bg-[#1e1e1e]' : ''
        } ${esHoy ? 'border-[#7F77DD]/60 bg-[#17162a]' : enMes ? 'border-[#2a2a2a] bg-[#161616]' : 'border-[#1f1f1f] bg-[#121212] opacity-50'}`}
      >
        <div className="flex items-baseline justify-between mb-1">
          <span className={`text-[11px] font-semibold ${esHoy ? 'text-[#7F77DD]' : dow === 0 || dow === 6 ? 'text-[#666666]' : 'text-[#888888]'}`}>
            {opts.mes ? ymd.slice(8, 10).replace(/^0/, '') : `${DIAS[(dow + 6) % 7]} ${ymd.slice(8, 10).replace(/^0/, '')}`}
          </span>
          {total > 0 && <span className="text-[10px] text-[#555555]">{total}</span>}
        </div>
        <div className="space-y-1">
          {visibles.map((t) => renderTarea(t, { compacta: !!opts.mes }))}
          {pagosVisibles.map(renderPago)}
          {ocultas > 0 && <p className="text-[10px] text-[#7F77DD]">+{ocultas}</p>}
        </div>
      </div>
    )
  }

  const diasSemana = Array.from({ length: 7 }, (_, i) => addDays(lunes, i))
  const diasMes = useMemo(() => {
    const inicio = lunesDe(primero)
    const n = ultimoDiaDe(primero)
    const fin = addDays(primero, n - 1)
    const out: string[] = []
    for (let d = inicio; d <= fin || out.length % 7 !== 0; d = addDays(d, 1)) out.push(d)
    return out
  }, [primero])

  const diaPanel = diaAbierto ? { tareas: porDia.get(diaAbierto) ?? [], pagos: pagosDe(diaAbierto) } : null

  return (
    <div className="space-y-3">
      {/* ── Toolbar: Semana | Mes · ‹ hoy › · title ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-[#2a2a2a] bg-[#1c1c1c] p-0.5">
          {(['semana', 'mes'] as ModoCalendario[]).map((m) => (
            <button
              key={m}
              onClick={() => onModo(m)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${modo === m ? 'bg-[#7F77DD]/20 text-[#7F77DD] font-medium' : 'text-[#888888] hover:text-[#e8e8e8]'}`}
            >
              {m === 'semana' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => mover(-1)} className="px-2 py-1 text-xs rounded bg-[#1c1c1c] border border-[#2a2a2a] text-[#888888] hover:text-[#e8e8e8]">‹</button>
          <button onClick={() => setAncla(today)} className="px-2 py-1 text-xs rounded bg-[#1c1c1c] border border-[#2a2a2a] text-[#888888] hover:text-[#e8e8e8]">hoy</button>
          <button onClick={() => mover(1)} className="px-2 py-1 text-xs rounded bg-[#1c1c1c] border border-[#2a2a2a] text-[#888888] hover:text-[#e8e8e8]">›</button>
        </div>
        <span className="text-sm font-semibold text-[#e8e8e8] capitalize">{titulo}</span>
        {(mensaje || error) && <span className={`text-xs ${error ? 'text-red-400' : 'text-emerald-400'}`}>{error ?? mensaje}</span>}
      </div>

      {/* ── "Sin fecha": folded, with the count; open = the undated tasks, draggable onto a day ── */}
      <section className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-3 py-2">
        <button onClick={() => setSinFechaAbierto((v) => !v)} className="flex items-center gap-2 text-xs text-[#888888] hover:text-[#e8e8e8] transition-colors">
          <span className={`transition-transform ${sinFechaAbierto ? 'rotate-90' : ''}`}>▸</span>
          📦 Sin fecha · {sinFecha.length}
          {!sinFechaAbierto && sinFecha.length > 0 && <span className="text-[#555555]">— abre y arrastra una a su día</span>}
        </button>
        {sinFechaAbierto && (
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-1.5">
            {sinFecha.length === 0 && <p className="text-xs text-[#444444]">— nada sin fecha</p>}
            {sinFecha.map((t) => renderTarea(t))}
          </div>
        )}
      </section>

      {modo === 'semana' ? (
        // Phone: the 7 lanes scroll sideways; md+: all seven side by side.
        <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-7 md:overflow-visible">
          {diasSemana.map((d) => (
            <div key={d} className="snap-start flex-shrink-0 w-[70vw] sm:w-[260px] md:w-auto">{renderDia(d, {})}</div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-7 gap-1 px-1">
            {DIAS.map((d) => <span key={d} className="text-[10px] uppercase tracking-wide text-[#555555]">{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">{diasMes.map((d) => renderDia(d, { mes: true }))}</div>
        </div>
      )}

      {/* ── Month: click on a day → its list, as a side panel ── */}
      {diaAbierto && diaPanel && (
        <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setDiaAbierto(null)}>
          <aside
            onClick={(e) => e.stopPropagation()}
            onDragOver={(e) => onDragOver(e, diaAbierto)}
            onDrop={(e) => onDrop(e, diaAbierto)}
            className="absolute right-0 top-0 h-full w-full sm:w-[380px] bg-[#161616] border-l border-[#2a2a2a] p-4 overflow-y-auto space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#e8e8e8] capitalize">
                {DIAS[(diaSemana(diaAbierto) + 6) % 7]} {formatShortEs(diaAbierto)}{diaAbierto === today ? ' · hoy' : ''}
              </h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setDiaAbierto(addDays(diaAbierto, -1))} className="px-2 py-0.5 text-xs text-[#888888] hover:text-[#e8e8e8]">‹</button>
                <button onClick={() => setDiaAbierto(addDays(diaAbierto, 1))} className="px-2 py-0.5 text-xs text-[#888888] hover:text-[#e8e8e8]">›</button>
                <button onClick={() => setDiaAbierto(null)} className="px-2 py-0.5 text-xs text-[#888888] hover:text-[#e8e8e8]">✕</button>
              </div>
            </div>
            {diaPanel.tareas.length === 0 && diaPanel.pagos.length === 0 && <p className="text-xs text-[#555555]">— nada ese día (suelta aquí una tarea)</p>}
            <div className="space-y-1.5">
              {diaPanel.tareas.map((t) => renderTarea(t))}
              {diaPanel.pagos.map(renderPago)}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
