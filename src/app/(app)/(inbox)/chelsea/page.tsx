'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { URGENCIA_EMOJI, URGENCIA_LABELS } from '@/types'
import type { ImTriaje, Company, Task } from '@/types'
import CopyButton from '@/components/CopyButton'
import TaskCard from '@/components/TaskCard'
import { supabase } from '@/lib/supabase'
import { formatShortEs } from '@/lib/dates'
import { CHELSEA_MISSING_HINT, findChelseaCompany } from '@/lib/chelsea'

const TZ = 'America/Cancun'

// Day bucket key (YYYY-MM-DD) and a human label, both in Cancun time.
function dayKey(iso: string | null): string {
  if (!iso) return 'unknown'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}
function dayLabel(iso: string | null): string {
  if (!iso) return 'No date'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, month: 'short', day: 'numeric',
  }).format(new Date(iso))
}
/** Today as 'YYYY-MM-DD' in Cancun, so the whole page agrees on "today". */
function todayKey(): string {
  return dayKey(new Date().toISOString())
}

export default function ChelseaPage() {
  const [items, setItems] = useState<ImTriaje[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // 11a: the manual half of Chelsea's list — normal tasks whose company is
  // "Chelsea". `companies` is the full list so the TaskCard edit form can still
  // move a task to another company.
  const [companies, setCompanies] = useState<Company[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const today = todayKey()

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Pending is defined by status alone (auto-routed items may have no asignado_a).
    // Resolved history is scoped to Chelsea so Gabby's own resolved items don't leak in.
    const reqs = [fetch('/api/inbox?status=pasado_a_chelsea')]
    if (showResolved) reqs.push(fetch('/api/inbox?status=resuelto&asignado=Chelsea'))
    const results = await Promise.all(reqs)
    if (results.some((r) => !r.ok)) {
      setError('Could not load Chelsea list.')
      setItems([])
      setLoading(false)
      return
    }
    const lists = await Promise.all(results.map((r) => r.json() as Promise<ImTriaje[]>))
    setItems(lists.flat())
    setLoading(false)
  }, [showResolved])

  // Reads the GabbyHQ project (tasks/companies) — never the inbox-IM schema.
  const fetchTasks = useCallback(async () => {
    setTasksLoading(true)
    setTasksError(null)
    const { data: companiesData, error: cErr } = await supabase
      .from('companies')
      .select('*')
      .order('name')
    const list = (companiesData as Company[]) ?? []
    setCompanies(list)

    const chelsea = findChelseaCompany(list)
    if (!chelsea) {
      // 11d handles the message; there is nothing to query without the company.
      setTasks([])
      setTasksError(cErr?.message ?? null)
      setTasksLoading(false)
      return
    }

    let query = supabase
      .from('tasks')
      .select('*, company:companies(*), subtasks(*)')
      .eq('company_id', chelsea.id)
      .order('created_at', { ascending: false })
    // The one "Show resolved" toggle drives both sections: done = true here.
    if (!showResolved) query = query.eq('done', false)

    const { data, error: tErr } = await query
    setTasks((data as Task[]) ?? [])
    setTasksError(tErr?.message ?? null)
    setTasksLoading(false)
  }, [showResolved])

  useEffect(() => { fetchItems() }, [fetchItems])
  useEffect(() => { fetchTasks() }, [fetchTasks])

  const pending = useMemo(() => items.filter((i) => i.status === 'pasado_a_chelsea'), [items])
  const chelseaCompany = useMemo(() => findChelseaCompany(companies), [companies])
  // Open tasks first (soonest due date up top, undated last), done ones after.
  const sortedTasks = useMemo(() => {
    const byDue = (a: Task, b: Task) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
    }
    return [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || byDue(a, b))
  }, [tasks])

  // Same order the list shows, so the copied text reads the way the page does.
  const openTasks = useMemo(() => sortedTasks.filter((t) => !t.done), [sortedTasks])

  async function markDone(id: string) {
    const prev = items
    setItems((is) => is.map((i) => (i.id === id ? { ...i, status: 'resuelto' } : i)))
    if (!showResolved) setItems((is) => is.filter((i) => i.id !== id))
    const res = await fetch('/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], action: 'done' }),
    })
    if (!res.ok) {
      setItems(prev)
      setError('Could not update — reverted.')
    }
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Group by day of decidido_at, most recent first.
  const groups = useMemo(() => {
    const map = new Map<string, ImTriaje[]>()
    for (const item of items) {
      const key = dayKey(item.decidido_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, list]) => ({
        key,
        label: dayLabel(list[0].decidido_at),
        items: list,
      }))
  }, [items])

  // 11b: one message with both sections, ready to paste into Telegram. An
  // empty section is left out entirely rather than shown with no rows.
  function buildPendingText(): string {
    const lines: string[] = [`Pendientes Chelsea — ${formatShortEs(today)}`]

    if (pending.length > 0) {
      lines.push('Correos:')
      for (const i of pending) {
        lines.push(`- ${i.remitente || '(sin remitente)'}: ${i.asunto || '(sin asunto)'}`)
      }
    }

    if (openTasks.length > 0) {
      lines.push('Tareas:')
      for (const t of openTasks) {
        const due = t.due_date ? ` (vence ${formatShortEs(t.due_date)})` : ''
        lines.push(`- ${t.text}${due}`)
      }
    }

    return lines.join('\n')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#e8e8e8]">Chelsea</h1>
          <p className="text-sm text-[#888888] mt-0.5">
            {loading || tasksLoading
              ? 'Loading…'
              : `${pending.length} pending · ${openTasks.length} ${openTasks.length === 1 ? 'task' : 'tasks'}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[#888888] cursor-pointer">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="accent-[#7F77DD]"
            />
            Show resolved
          </label>
          {(pending.length > 0 || openTasks.length > 0) && (
            <CopyButton text={buildPendingText} label="Copy pending list" />
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* With no Chelsea company the Tareas section below carries the message. */}
      {!loading && !tasksLoading && chelseaCompany && pending.length === 0 &&
        openTasks.length === 0 && !showResolved && (
        <div className="text-sm text-[#888888] text-center py-12">Nothing pending ✨</div>
      )}

      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <h2 className="text-xs font-semibold text-[#888888] uppercase tracking-wider">{group.label}</h2>
          <div className="space-y-1.5">
            {group.items.map((i) => {
              const resolved = i.status === 'resuelto'
              const isExpanded = expanded.has(i.id)
              return (
                <div
                  key={i.id}
                  className={`bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-3 py-2.5 ${resolved ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => !resolved && markDone(i.id)}
                      disabled={resolved}
                      title={resolved ? 'Resolved' : 'Mark resolved'}
                      className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        resolved ? 'bg-[#7F77DD] border-[#7F77DD]' : 'border-[#2a2a2a] hover:border-[#888888]'
                      }`}
                    >
                      {resolved && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <div className="flex-1 min-w-0" onClick={() => i.resumen_ia && toggleExpand(i.id)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span title={i.urgencia ? URGENCIA_LABELS[i.urgencia] : ''}>
                          {i.urgencia ? URGENCIA_EMOJI[i.urgencia] : '⚪'}
                        </span>
                        <span className={`text-sm font-medium ${resolved ? 'line-through text-[#555555]' : 'text-[#e8e8e8]'}`}>
                          {i.remitente || '(no sender)'}
                        </span>
                        <span className={`text-sm ${resolved ? 'text-[#555555]' : 'text-[#888888]'} truncate`}>
                          {i.asunto || '(no subject)'}
                        </span>
                      </div>
                      {i.resumen_ia && (
                        <p className={`text-xs text-[#888888] mt-0.5 cursor-pointer ${isExpanded ? '' : 'truncate'}`}>
                          {i.resumen_ia}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* ── 11a: Tareas — the manual half, under the mail ── */}
      <div className="space-y-2 pt-1">
        <h2 className="text-xs font-semibold text-[#888888] uppercase tracking-wider">Tareas</h2>

        {tasksError && <p className="text-xs text-red-400">{tasksError}</p>}

        {/* Loading is checked first: `companies` is empty until it resolves, so
            the 11d hint would otherwise flash on every page load. */}
        {tasksLoading ? (
          <p className="text-xs text-[#555555]">Loading…</p>
        ) : !chelseaCompany ? (
          // 11d
          <p className="text-sm text-[#888888]">{CHELSEA_MISSING_HINT}</p>
        ) : sortedTasks.length === 0 ? (
          <p className="text-xs text-[#555555]">
            Sin tareas — agrégalas desde Tasks con la empresa Chelsea.
          </p>
        ) : (
          <div className="space-y-2">
            {sortedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                companies={companies}
                onUpdate={fetchTasks}
                today={today}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
