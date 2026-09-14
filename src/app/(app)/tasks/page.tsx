'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Task, Company, Priority, NotaEmpresa } from '@/types'
import { supabase } from '@/lib/supabase'
import AddTaskForm from '@/components/AddTaskForm'
import TaskCard from '@/components/TaskCard'
import CopyButton from '@/components/CopyButton'
import CompanyNotePanel from '@/components/CompanyNotePanel'
import { todayYmd } from '@/lib/dates'

const PRIORITY_ORDER: Priority[] = ['urgente', 'normal', 'cuando']
const PRIORITY_LABELS: Record<Priority, string> = {
  urgente: 'Urgente',
  normal: 'Normal',
  cuando: 'Cuando pueda',
}

function TasksPageContent() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const searchParams = useSearchParams()
  // The "+N más" links in the Hoy view deep-link here as /tasks?company=<id>.
  const [filter, setFilter] = useState<string>(searchParams.get('company') ?? 'all')
  const [sortMode, setSortMode] = useState<'priority' | 'due'>('priority')
  const [loading, setLoading] = useState(true)
  const [notas, setNotas] = useState<NotaEmpresa[]>([])
  const [noteOpen, setNoteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const today = todayYmd()

  const fetchData = useCallback(async () => {
    const [{ data: tasksData }, { data: companiesData }, { data: notasData }] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, company:companies(*), subtasks(*)')
        .order('created_at', { ascending: false }),
      supabase.from('companies').select('*').order('name'),
      supabase.from('notas_empresa').select('*'),
    ])
    setTasks(tasksData ?? [])
    setCompanies(companiesData ?? [])
    setNotas((notasData as NotaEmpresa[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'all') return !t.done
    if (filter === 'completadas') return t.done
    if (filter === 'urgente' || filter === 'normal' || filter === 'cuando')
      return !t.done && t.priority === filter
    // company filter
    return !t.done && t.company_id === filter
  })

  const pendingTasks = tasks.filter((t) => !t.done)
  const completedTasks = tasks.filter((t) => t.done)

  const filterButtons = [
    { id: 'all', label: 'Todas' },
    { id: 'urgente', label: 'Urgente' },
    ...companies.map((c) => ({ id: c.id, label: c.name })),
    { id: 'completadas', label: 'Completadas' },
  ]

  function groupByPriority(taskList: Task[]) {
    return PRIORITY_ORDER.map((p) => ({
      priority: p,
      tasks: taskList.filter((t) => t.priority === p),
    })).filter((g) => g.tasks.length > 0)
  }

  // Ascending by due_date; tasks without a due date sink to the bottom.
  function sortByDue(taskList: Task[]) {
    return [...taskList].sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
    })
  }

  // Plain-text pending list grouped by priority, for pasting elsewhere.
  function buildPendingText(): string {
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const lines: string[] = [`GABBY'S PENDING — ${today}`]
    for (const p of PRIORITY_ORDER) {
      const bucket = pendingTasks.filter((t) => t.priority === p)
      if (bucket.length === 0) continue
      lines.push('', `${PRIORITY_LABELS[p].toUpperCase()}:`)
      for (const t of bucket) {
        const company = t.company ? ` (${t.company.name})` : ''
        const due = t.due_date
          ? ` — due ${new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : ''
        lines.push(`- ${t.text}${company}${due}`)
      }
    }
    return lines.join('\n')
  }

  if (loading) {
    return <div className="text-sm text-[#888888] py-8 text-center">Loading...</div>
  }

  const isShowingCompleted = filter === 'completadas'
  const displayTasks = filteredTasks

  return (
    <div className="space-y-6">
      {noteOpen ? (
        <CompanyNotePanel
          companies={companies}
          notas={notas}
          // 4e: when the company filter is active, start on that company.
          initialCompanyId={companies.find((c) => c.id === filter)?.id}
          onSaved={(nota) =>
            setNotas((prev) => [...prev.filter((n) => n.company_id !== nota.company_id), nota])
          }
          onClose={() => setNoteOpen(false)}
        />
      ) : (
        <div className="flex gap-2 items-start">
          <div className="flex-1 min-w-0">
            <AddTaskForm companies={companies} onAdded={fetchData} onOpenChange={setAddOpen} />
          </div>
          {!addOpen && companies.length > 0 && (
            <button
              onClick={() => setNoteOpen(true)}
              className="flex-shrink-0 flex items-center gap-2 p-4 bg-[#1c1c1c] border border-dashed border-[#2a2a2a] rounded-lg text-sm text-[#888888] hover:border-[#555555] hover:text-[#e8e8e8] transition-colors whitespace-nowrap"
            >
              📝 Por dónde voy
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-1.5">
        {filterButtons.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === id
                ? 'bg-[#7F77DD] text-white'
                : 'bg-[#1c1c1c] border border-[#2a2a2a] text-[#888888] hover:border-[#555555] hover:text-[#e8e8e8]'
            }`}
          >
            {label}
            {id === 'all' && pendingTasks.length > 0 && (
              <span className="ml-1.5 text-[10px] opacity-60">{pendingTasks.length}</span>
            )}
            {id === 'completadas' && completedTasks.length > 0 && (
              <span className="ml-1.5 text-[10px] opacity-60">{completedTasks.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Sort + copy controls */}
      {!isShowingCompleted && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {(['priority', 'due'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  sortMode === mode
                    ? 'bg-[#2a2a2a] text-[#e8e8e8]'
                    : 'text-[#555555] hover:text-[#888888]'
                }`}
              >
                {mode === 'priority' ? 'By priority' : 'By due date'}
              </button>
            ))}
          </div>
          {pendingTasks.length > 0 && <CopyButton text={buildPendingText} label="Copy pending" />}
        </div>
      )}

      {/* Task list */}
      {displayTasks.length === 0 && (
        <div className="text-sm text-[#888888] text-center py-12">
          {isShowingCompleted ? 'No completed tasks yet.' : 'No tasks. Add one above.'}
        </div>
      )}

      {isShowingCompleted || sortMode === 'due' ? (
        <div className="space-y-2">
          {(sortMode === 'due' && !isShowingCompleted ? sortByDue(displayTasks) : displayTasks).map((task) => (
            <TaskCard key={task.id} task={task} companies={companies} onUpdate={fetchData} today={today} />
          ))}
        </div>
      ) : (
        groupByPriority(displayTasks).map(({ priority, tasks: group }) => (
          <div key={priority}>
            <h2 className="text-xs font-semibold text-[#888888] uppercase tracking-wider mb-2">
              {PRIORITY_LABELS[priority]}
            </h2>
            <div className="space-y-2">
              {group.map((task) => (
                <TaskCard key={task.id} task={task} companies={companies} onUpdate={fetchData} today={today} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="text-sm text-[#888888] py-8 text-center">Loading...</div>}>
      <TasksPageContent />
    </Suspense>
  )
}
