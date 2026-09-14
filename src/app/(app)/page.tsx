'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Task, Company, NotaEmpresa, RadarItem, COMPANY_COLORS } from '@/types'
import { supabase } from '@/lib/supabase'
import TaskCard from '@/components/TaskCard'
import CompanyNote from '@/components/CompanyNote'
import EisenhowerMatrix from '@/components/EisenhowerMatrix'
import { todayYmd } from '@/lib/dates'

const MAX_TASKS_PER_BLOCK = 5

interface Block {
  id: string | null
  name: string
  color: string
  openCount: number
  focus: Task[]
  nota: NotaEmpresa | null
}

export default function HoyPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [notas, setNotas] = useState<NotaEmpresa[]>([])
  const [radar, setRadar] = useState<RadarItem[]>([])
  const [notasError, setNotasError] = useState<string | null>(null)
  const [inboxCount, setInboxCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  // 5c: blocks the user manually expanded from their collapsed one-liner.
  const [forceOpen, setForceOpen] = useState<Set<string>>(new Set())

  const today = todayYmd()

  const fetchData = useCallback(async () => {
    const [{ data: tasksData }, { data: companiesData }, notasRes, { data: radarData }] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, company:companies(*), subtasks(*)')
        .eq('done', false)
        .order('created_at', { ascending: false }),
      supabase.from('companies').select('*').order('name'),
      supabase.from('notas_empresa').select('*'),
      // 7/C4 reads Radar as-is — every estado, no filtering by type.
      supabase.from('radar').select('*').order('created_at', { ascending: false }),
    ])

    setTasks(tasksData ?? [])
    setCompanies(companiesData ?? [])
    setNotas((notasRes.data as NotaEmpresa[]) ?? [])
    setRadar((radarData as RadarItem[]) ?? [])
    // Surface it rather than silently rendering every block noteless — the most
    // likely cause is that the notas_empresa migration hasn't been run yet.
    setNotasError(notasRes.error?.message ?? null)
    setLoading(false)
  }, [])

  // Read-only count of mail still awaiting a decision. Reuses GET /api/inbox so
  // this number can never drift from what /inbox itself shows. Never writes.
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

  /**
   * 7/C2: clicking a "por dónde iba" note in the matrix jumps to that
   * company's block below. A company with a note is never collapsed, but
   * forceOpen makes that independent of the collapse rule.
   */
  function revealCompany(companyId: string) {
    setForceOpen((prev) => new Set(prev).add(companyId))
    // Wait for the render that un-collapsed the block before measuring it.
    requestAnimationFrame(() => {
      document.getElementById(`block-${companyId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  function upsertNota(nota: NotaEmpresa) {
    setNotas((prev) => {
      const rest = prev.filter((n) => n.company_id !== nota.company_id)
      return [...rest, nota]
    })
  }

  /** Overdue (oldest first) → due today → urgent with no date. Capped later. */
  function focusFor(open: Task[]): Task[] {
    const overdue = open
      .filter((t) => t.due_date && t.due_date < today)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
    const dueToday = open.filter((t) => t.due_date === today)
    const urgentNoDate = open.filter((t) => !t.due_date && t.priority === 'urgente')
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

  // Tasks created by the Inbox-IM "I'll handle it" button carry no company.
  // Without this block they would be invisible here.
  const orphans = tasks.filter((t) => !t.company_id)
  if (orphans.length > 0) {
    blocks.push({
      id: null,
      name: 'Sin empresa',
      color: '#888780',
      openCount: orphans.length,
      focus: focusFor(orphans),
      nota: null,
    })
  }

  const totalOverdue = tasks.filter((t) => t.due_date && t.due_date < today).length
  const totalToday = tasks.filter((t) => t.due_date === today).length

  if (loading) {
    return <div className="text-sm text-[#888888] py-8 text-center">Loading...</div>
  }

  return (
    <div className="space-y-6">
      {/* ── Eisenhower matrix — above the strip and the company blocks ── */}
      <EisenhowerMatrix
        tasks={tasks}
        companies={companies}
        notas={notas}
        radar={radar}
        inboxCount={inboxCount}
        today={today}
        onUpdate={fetchData}
        onRevealCompany={revealCompany}
      />

      {/* ── Summary strip ── */}
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
            <Link
              href="/inbox"
              className={`hover:underline ${inboxCount > 0 ? 'text-[#7F77DD] font-medium' : 'text-[#555555]'}`}
            >
              {inboxCount} {inboxCount === 1 ? 'correo esperando decisión' : 'correos esperando decisión'}
            </Link>
          </>
        )}
      </div>

      {notasError && (
        <p className="text-xs text-red-400">
          No se pudieron cargar las notas: {notasError}
        </p>
      )}

      {blocks.length === 0 && (
        <p className="text-sm text-[#888888] text-center py-12">
          No hay empresas todavía. Créalas en Settings.
        </p>
      )}

      {/* ── One block per company ── */}
      {blocks.map((block) => {
        const key = block.id ?? 'none'
        const hasNote = (block.nota?.nota?.trim().length ?? 0) > 0
        // A block only collapses with NO note AND no pending tasks, so a note
        // can never be hidden behind an empty task list.
        const collapsed = !hasNote && block.openCount === 0 && !forceOpen.has(key)
        const shown = block.focus.slice(0, MAX_TASKS_PER_BLOCK)
        const more = block.focus.length - shown.length

        if (collapsed) {
          return (
            <div id={`block-${key}`} key={key} className="flex items-center gap-2 px-1 text-xs text-[#555555]">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: block.color }} />
              <button
                onClick={() => setForceOpen((prev) => new Set(prev).add(key))}
                className="hover:text-[#e8e8e8] transition-colors"
              >
                {block.name}
              </button>
              <span className="text-[#444444]">— sin pendientes</span>
            </div>
          )
        }

        return (
          // scroll-mt keeps the heading clear of the sticky nav when the
          // matrix scrolls us here.
          <section id={`block-${key}`} key={key} className="space-y-3 scroll-mt-20">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: block.color }} />
              <h2 className="text-sm font-semibold" style={{ color: block.color }}>{block.name}</h2>
              {block.openCount > 0 ? (
                <Link
                  href={block.id ? `/tasks?company=${block.id}` : '/tasks'}
                  className="text-xs text-[#555555] hover:text-[#7F77DD] hover:underline transition-colors"
                >
                  {block.openCount} {block.openCount === 1 ? 'pendiente' : 'pendientes'}
                </Link>
              ) : (
                <span className="text-xs text-[#555555]">sin pendientes</span>
              )}
            </div>

            {/* "Por dónde iba" — above everything else in the block. */}
            {block.id && (
              <CompanyNote companyId={block.id} nota={block.nota} onSaved={upsertNota} />
            )}

            {shown.length > 0 ? (
              <div className="space-y-2">
                {shown.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    companies={companies}
                    onUpdate={fetchData}
                    today={today}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#555555] pl-1">Nada vencido ni urgente para hoy.</p>
            )}

            {more > 0 && (
              <Link
                href={block.id ? `/tasks?company=${block.id}` : '/tasks'}
                className="inline-block text-xs text-[#7F77DD] hover:text-[#9b95e8] font-medium"
              >
                +{more} más
              </Link>
            )}
          </section>
        )
      })}
    </div>
  )
}
