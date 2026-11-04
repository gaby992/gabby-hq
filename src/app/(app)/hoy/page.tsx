'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Task, Company, NotaEmpresa, RadarItem, COMPANY_COLORS } from '@/types'
import type { CorreoLite } from '@/lib/correo/pendientes'
import TaskCard from '@/components/TaskCard'
import CompanyNote from '@/components/CompanyNote'
import EisenhowerMatrix from '@/components/EisenhowerMatrix'
import QueSigueCard from '@/components/QueSigueCard'
import Tablero, { idColumna, type Columna } from '@/components/Tablero'
import Calendario, { type ModoCalendario, type PagoCalendario } from '@/components/Calendario'
import { daysSince, relativeDaysEs, todayYmd } from '@/lib/dates'
import { edadNota } from '@/lib/notas'
import { findChelseaCompany } from '@/lib/chelsea'
import { columnaCorreo, estaEsperando, horizonteDe } from '@/lib/horizonte'

const MAX_TASKS_PER_BLOCK = 5

/** Fase 9: the three ways to look at the same data. The last one used is remembered. */
type Vista = 'tablero' | 'prioridad' | 'empresas' | 'calendario'
const VISTAS: { id: Vista; label: string }[] = [
  { id: 'tablero', label: 'Tablero' },
  { id: 'prioridad', label: 'Prioridad' },
  { id: 'empresas', label: 'Empresas' },
  { id: 'calendario', label: 'Calendario' },
]
const VISTA_KEY = 'hoy.vista'
/** Fase 9b: Semana | Mes inside the Calendario view, remembered next to the view. */
const MODO_CAL_KEY = 'hoy.calendario'

interface CuentaLite {
  id: string
  nombre: string
  duena: string | null
  activa: boolean
  company_id: string | null
}

interface Datos {
  tasks: Task[]
  companies: Company[]
  notas: NotaEmpresa[]
  radar: RadarItem[]
  notas_error: string | null
  correos: CorreoLite[]
  cuentas: CuentaLite[]
  pagos: PagoCalendario[]
}

interface Block {
  id: string | null
  name: string
  color: string
  openCount: number
  focus: Task[]
  nota: NotaEmpresa | null
}

function leerVista(): Vista {
  try {
    const v = localStorage.getItem(VISTA_KEY)
    if (v === 'tablero' || v === 'prioridad' || v === 'empresas' || v === 'calendario') return v
  } catch {
    /* private mode */
  }
  return 'tablero'
}

function leerModoCalendario(): ModoCalendario {
  try {
    if (localStorage.getItem(MODO_CAL_KEY) === 'mes') return 'mes'
  } catch {
    /* private mode */
  }
  return 'semana'
}

/**
 * /hoy (fase 9): the board by horizon is the entry screen. "Prioridad" is
 * the Eisenhower matrix (fase 4b) and "Empresas" the company blocks with the
 * "por dónde iba" notes — both unchanged underneath, now one tab each.
 */
export default function HoyPage() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inboxCount, setInboxCount] = useState<number | null>(null)
  const [vista, setVista] = useState<Vista>('tablero')
  const [modoCal, setModoCal] = useState<ModoCalendario>('semana')
  // Fase 9b: the column a KPI click points at, for a moment.
  const [resaltada, setResaltada] = useState<Columna | null>(null)
  const [filtro, setFiltro] = useState<string>('all')
  const [notasAbiertas, setNotasAbiertas] = useState<Set<string>>(new Set())
  const [franjaAbierta, setFranjaAbierta] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  // 5c: blocks the user manually expanded from their collapsed one-liner.
  const [forceOpen, setForceOpen] = useState<Set<string>>(new Set())

  const today = todayYmd()

  useEffect(() => { setVista(leerVista()); setModoCal(leerModoCalendario()) }, [])

  function cambiarVista(v: Vista) {
    setVista(v)
    try {
      localStorage.setItem(VISTA_KEY, v)
    } catch {
      /* private mode */
    }
  }

  function cambiarModoCal(m: ModoCalendario) {
    setModoCal(m)
    try {
      localStorage.setItem(MODO_CAL_KEY, m)
    } catch {
      /* private mode */
    }
  }

  /** A KPI click: the board, scrolled to that column, with a ring for a moment. */
  function irAColumna(col: Columna) {
    cambiarVista('tablero')
    setResaltada(col)
    requestAnimationFrame(() => {
      document.getElementById(idColumna(col))?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    })
    window.setTimeout(() => setResaltada((r) => (r === col ? null : r)), 1600)
  }

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/hoy')
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setDatos(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Read-only count of mail still awaiting a decision in inbox-IM (the matrix's C3 line).
  const fetchInboxCount = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox')
      if (!res.ok) return
      const rows = await res.json()
      if (Array.isArray(rows)) setInboxCount(rows.length)
    } catch {
      // Inbox-IM unreachable — just omit that part of the summary strip.
    }
  }, [])

  useEffect(() => { fetchData(); fetchInboxCount() }, [fetchData, fetchInboxCount])

  const tasks = useMemo(() => datos?.tasks ?? [], [datos])
  const companies = useMemo(() => datos?.companies ?? [], [datos])
  const notas = useMemo(() => datos?.notas ?? [], [datos])
  const radar = datos?.radar ?? []
  const chelseaId = findChelseaCompany(companies)?.id ?? null

  // ── Company chips: tasks by company; mail by the company of its account ──
  const tareasFiltradas = useMemo(
    () => (filtro === 'all' ? tasks : filtro === 'none' ? tasks.filter((t) => !t.company_id) : tasks.filter((t) => t.company_id === filtro)),
    [tasks, filtro]
  )
  const correosFiltrados = useMemo(() => {
    const correos = datos?.correos ?? []
    if (filtro === 'all') return correos
    const cuentas = new Set((datos?.cuentas ?? []).filter((c) => (filtro === 'none' ? !c.company_id : c.company_id === filtro)).map((c) => c.id))
    return correos.filter((c) => cuentas.has(c.cuenta_id))
  }, [datos, filtro])

  const chips = [
    { id: 'all', label: 'Todas' },
    ...companies.map((c) => ({ id: c.id, label: c.name })),
    ...(tasks.some((t) => !t.company_id) ? [{ id: 'none', label: 'Sin empresa' }] : []),
  ]

  /**
   * 7/C2: clicking a "por dónde iba" note in the matrix jumps to that
   * company's block (now the Empresas view).
   */
  function revealCompany(companyId: string) {
    cambiarVista('empresas')
    setForceOpen((prev) => new Set(prev).add(companyId))
    requestAnimationFrame(() => {
      document.getElementById(`block-${companyId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function upsertNota(nota: NotaEmpresa) {
    setDatos((d) => (d ? { ...d, notas: [...d.notas.filter((n) => n.company_id !== nota.company_id), nota] } : d))
  }

  function removeNota(companyId: string) {
    setDatos((d) => (d ? { ...d, notas: d.notas.filter((n) => n.company_id !== companyId) } : d))
  }

  // Fase 4b: C1 only shows notes of the last 3 days.
  const notasFrescas = notas.filter((n) => edadNota(n) === 'fresca')

  /** Overdue (oldest first) → due today → urgent with no date. Waiting tasks stay out. */
  function focusFor(open: Task[]): Task[] {
    const activas = open.filter((t) => !estaEsperando(t))
    const overdue = activas.filter((t) => t.due_date && t.due_date < today).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
    const dueToday = activas.filter((t) => t.due_date === today)
    const urgentNoDate = activas.filter((t) => !t.due_date && t.priority === 'urgente')
    return [...overdue, ...dueToday, ...urgentNoDate]
  }

  const blocks: Block[] = companies.map((c) => {
    const open = tasks.filter((t) => t.company_id === c.id)
    return {
      id: c.id,
      name: c.name,
      color: COMPANY_COLORS[c.color] ?? '#888780',
      openCount: open.length,
      focus: focusFor(open),
      nota: notas.find((n) => n.company_id === c.id) ?? null,
    }
  })
  const orphans = tasks.filter((t) => !t.company_id)
  if (orphans.length > 0) {
    blocks.push({ id: null, name: 'Sin empresa', color: '#888780', openCount: orphans.length, focus: focusFor(orphans), nota: null })
  }

  // 11c: Chelsea's tasks are delegated and fase 9's waiting tasks are in
  // someone else's hands — neither is Gabby's own work for the matrix.
  const matrixTasks = tareasFiltradas.filter((t) => !estaEsperando(t) && (!chelseaId || t.company_id !== chelseaId))

  const totalOverdue = tasks.filter((t) => !estaEsperando(t) && t.due_date && t.due_date < today).length
  const totalToday = tasks.filter((t) => !estaEsperando(t) && t.due_date === today).length

  const tareaAbierta = abierta ? tasks.find((t) => t.id === abierta) ?? null : null

  // ── Fase 9b: the four numbers, under the chips, on the filtered data ──
  const kpis = useMemo(() => {
    let hoy = 0
    let vencidas = 0
    let esperando = 0
    for (const t of tareasFiltradas) {
      const h = horizonteDe(t, today, chelseaId)
      if (h === 'hoy') {
        hoy += 1
        if (t.due_date && t.due_date < today) vencidas += 1
      } else if (h === 'esperando') esperando += 1
    }
    let correos = 0
    for (const c of correosFiltrados) {
      const col = columnaCorreo(c)
      if (col === 'correos') correos += 1
      else if (col === 'esperando') esperando += 1
    }
    return [
      { col: 'hoy' as Columna, emoji: '🔥', label: 'Hoy sí o sí', n: hoy, color: 'text-red-400' },
      { col: 'hoy' as Columna, emoji: '🔺', label: 'Vencidas', n: vencidas, color: vencidas > 0 ? 'text-red-400' : 'text-[#888888]' },
      { col: 'esperando' as Columna, emoji: '⏳', label: 'Esperando', n: esperando, color: 'text-[#7F77DD]' },
      { col: 'correos' as Columna, emoji: '📧', label: 'Correos', n: correos, color: 'text-[#1D9E75]' },
    ]
  }, [tareasFiltradas, correosFiltrados, today, chelseaId])

  if (!datos && !error) {
    return <div className="text-sm text-[#888888] py-8 text-center">Loading...</div>
  }

  // Fase 9b: EVERY non-empty note shows, in company order; only an active
  // company chip narrows it. Never hidden by age, view or refetch.
  const orden = new Map(companies.map((c, i) => [c.id, i]))
  const notasConTexto = notas
    .filter((n) => n.nota.trim().length > 0 && (filtro === 'all' || n.company_id === filtro))
    .map((nota) => ({ nota, company: companies.find((c) => c.id === nota.company_id) ?? null }))
    .sort((a, b) => (orden.get(a.nota.company_id) ?? 99) - (orden.get(b.nota.company_id) ?? 99))

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-400">No se pudo cargar: {error}</p>}

      {/* ── Top bar: chips · ¿Qué sigue? · view toggle ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
          {chips.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setFiltro(id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filtro === id ? 'bg-[#7F77DD] text-white' : 'bg-[#1c1c1c] border border-[#2a2a2a] text-[#888888] hover:border-[#555555] hover:text-[#e8e8e8]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border border-[#2a2a2a] bg-[#1c1c1c] p-0.5">
          {VISTAS.map((v) => (
            <button
              key={v.id}
              onClick={() => cambiarVista(v.id)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${vista === v.id ? 'bg-[#7F77DD]/20 text-[#7F77DD] font-medium' : 'text-[#888888] hover:text-[#e8e8e8]'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Fase 9b: KPIs — the filtered numbers; click = that column on the board ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {kpis.map((k) => (
          <button
            key={k.label}
            onClick={() => irAColumna(k.col)}
            title={`Ir a ${k.label}`}
            className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-3 py-2 text-left hover:border-[#555555] transition-colors"
          >
            <p className="text-[11px] text-[#888888]">{k.emoji} {k.label}</p>
            <p className={`text-2xl font-semibold leading-tight ${k.n === 0 ? 'text-[#555555]' : k.color}`}>{k.n}</p>
          </button>
        ))}
      </div>

      {/* ── Fase 4b: "¿Qué sigue?" — the one thing to do now, on demand ── */}
      <QueSigueCard />

      {/* ── Fase 9: "por dónde iba" as a folding strip — one line per company, click to open ── */}
      {notasConTexto.length > 0 && (
        <section className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-2.5">
          <button onClick={() => setFranjaAbierta((v) => !v)} className="flex items-center gap-2 text-xs text-[#888888] hover:text-[#e8e8e8] transition-colors">
            <span className={`transition-transform ${franjaAbierta ? 'rotate-90' : ''}`}>▸</span>
            📝 Por dónde iba · {notasConTexto.length}
          </button>
          {franjaAbierta && (
            <div className="mt-2 space-y-1">
              {notasConTexto.map(({ company, nota }) => {
                const color = company ? COMPANY_COLORS[company.color] ?? '#888780' : '#888780'
                const edad = edadNota(nota)
                const cid = nota.company_id
                const open = notasAbiertas.has(cid)
                const primera = nota.nota.trim().split('\n')[0]
                return (
                  <div key={cid}>
                    <button
                      onClick={() => setNotasAbiertas((prev) => { const n = new Set(prev); if (n.has(cid)) n.delete(cid); else n.add(cid); return n })}
                      className="w-full flex items-center gap-2 text-left text-xs leading-5 hover:bg-[#222222] rounded px-1 -mx-1 transition-colors"
                      title={`escrita ${relativeDaysEs(nota.updated_at)}`}
                    >
                      <span className="flex-shrink-0 font-semibold" style={{ color }}>{company?.name ?? '(empresa borrada)'}</span>
                      {!open && <span className={`min-w-0 flex-1 truncate ${edad === 'fresca' ? 'text-[#7F77DD]' : 'text-[#6a6a6a]'}`}>{primera}</span>}
                      {!open && edad !== 'fresca' && <span className="flex-shrink-0 text-[10px] text-[#555555]">{daysSince(nota.updated_at)} d</span>}
                    </button>
                    {open && (
                      <div className="pl-3 pb-2">
                        <CompanyNote companyId={cid} nota={nota} onSaved={upsertNota} onArchived={removeNota} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {datos?.notas_error && <p className="text-xs text-red-400">No se pudieron cargar las notas: {datos.notas_error}</p>}

      {/* ── Tablero ── */}
      {vista === 'tablero' && datos && (
        // Wider than the page column: six lanes need the room on a big screen.
        <div className="relative md:left-1/2 md:-translate-x-1/2 md:w-[min(100vw_-_3rem,1500px)]">
          <Tablero
            tasks={tareasFiltradas}
            companies={companies}
            correos={correosFiltrados}
            today={today}
            onChanged={fetchData}
            onOpenTask={(t) => setAbierta(t.id)}
            resaltada={resaltada}
          />
        </div>
      )}

      {/* ── Fase 9b: Calendario — week lanes or the month grid; payments on their day ── */}
      {vista === 'calendario' && datos && (
        <div className="relative md:left-1/2 md:-translate-x-1/2 md:w-[min(100vw_-_3rem,1500px)]">
          <Calendario
            tasks={tareasFiltradas}
            companies={companies}
            pagos={(datos.pagos ?? []).filter((p) => filtro === 'all' || p.company_id === filtro)}
            today={today}
            modo={modoCal}
            onModo={cambiarModoCal}
            onChanged={fetchData}
            onOpenTask={(t) => setAbierta(t.id)}
          />
        </div>
      )}

      {/* ── Prioridad: the Eisenhower matrix + the summary strip ── */}
      {vista === 'prioridad' && datos && (
        <div className="space-y-4">
          <EisenhowerMatrix
            tasks={matrixTasks}
            companies={companies}
            notas={notasFrescas}
            radar={radar}
            inboxCount={inboxCount}
            today={today}
            onUpdate={fetchData}
            onRevealCompany={revealCompany}
          />
          <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className={totalOverdue > 0 ? 'text-red-400 font-medium' : 'text-[#555555]'}>
              {totalOverdue} {totalOverdue === 1 ? 'vencida' : 'vencidas'}
            </span>
            <span className="text-[#2a2a2a]">·</span>
            <span className={totalToday > 0 ? 'text-amber-400 font-medium' : 'text-[#555555]'}>
              {totalToday} {totalToday === 1 ? 'vence hoy' : 'vencen hoy'}
            </span>
            {inboxCount !== null && (
              <>
                <span className="text-[#2a2a2a]">·</span>
                <Link href="/inbox" className={`hover:underline ${inboxCount > 0 ? 'text-[#7F77DD] font-medium' : 'text-[#555555]'}`}>
                  {inboxCount} {inboxCount === 1 ? 'correo esperando decisión' : 'correos esperando decisión'}
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Empresas: one block per company (note first, then the tasks) ── */}
      {vista === 'empresas' && datos && (
        <div className="space-y-8 pt-2">
          {blocks.length === 0 && (
            <p className="text-sm text-[#888888] text-center py-12">No hay empresas todavía. Créalas en Settings.</p>
          )}
          {blocks
            .filter((b) => filtro === 'all' || (filtro === 'none' ? b.id === null : b.id === filtro))
            .map((block) => {
              const key = block.id ?? 'none'
              const hasNote = (block.nota?.nota?.trim().length ?? 0) > 0
              const collapsed = !hasNote && block.openCount === 0 && !forceOpen.has(key)
              const shown = block.focus.slice(0, MAX_TASKS_PER_BLOCK)
              const more = block.focus.length - shown.length

              if (collapsed) {
                return (
                  <div id={`block-${key}`} key={key} className="flex items-center gap-2 px-1 text-xs text-[#555555]">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: block.color }} />
                    <button onClick={() => setForceOpen((prev) => new Set(prev).add(key))} className="hover:text-[#e8e8e8] transition-colors">
                      {block.name}
                    </button>
                    <span className="text-[#444444]">— sin pendientes</span>
                  </div>
                )
              }

              return (
                <section id={`block-${key}`} key={key} className="space-y-3 scroll-mt-20">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: block.color }} />
                    <h2 className="text-lg font-semibold tracking-tight" style={{ color: block.color }}>{block.name}</h2>
                    {block.openCount > 0 ? (
                      <Link href={block.id ? `/tasks?company=${block.id}` : '/tasks'} className="text-xs text-[#555555] hover:text-[#7F77DD] hover:underline transition-colors">
                        {block.openCount} {block.openCount === 1 ? 'pendiente' : 'pendientes'}
                      </Link>
                    ) : (
                      <span className="text-xs text-[#555555]">sin pendientes</span>
                    )}
                  </div>

                  {block.id && <CompanyNote companyId={block.id} nota={block.nota} onSaved={upsertNota} onArchived={removeNota} />}

                  {shown.length > 0 ? (
                    <div className="space-y-2 pt-1">
                      {shown.map((task) => (
                        <TaskCard key={task.id} task={task} companies={companies} onUpdate={fetchData} today={today} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#555555] pl-1">Nada vencido ni urgente para hoy.</p>
                  )}

                  {more > 0 && (
                    <Link href={block.id ? `/tasks?company=${block.id}` : '/tasks'} className="inline-block text-xs text-[#7F77DD] hover:text-[#9b95e8] font-medium">
                      +{more} más
                    </Link>
                  )}
                </section>
              )
            })}
        </div>
      )}

      {/* ── Fase 9: click on a board card → the existing edit panel, as an overlay ── */}
      {tareaAbierta && (
        <div className="fixed inset-0 z-30 bg-black/60 flex items-start justify-center p-4 pt-16 overflow-y-auto" onClick={() => setAbierta(null)}>
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-1">
              <button onClick={() => setAbierta(null)} className="text-xs text-[#888888] hover:text-[#e8e8e8] px-2 py-1">✕ cerrar</button>
            </div>
            <TaskCard
              key={tareaAbierta.id}
              task={tareaAbierta}
              companies={companies}
              onUpdate={fetchData}
              today={today}
              defaultExpanded
              defaultEditing
            />
          </div>
        </div>
      )}
    </div>
  )
}
