'use client'

import { useEffect, useState, useCallback } from 'react'
import { Task, Company, Priority } from '@/types'
import { supabase } from '@/lib/supabase'
import AddTaskForm from '@/components/AddTaskForm'
import TaskCard from '@/components/TaskCard'

const PRIORITY_ORDER: Priority[] = ['urgente', 'normal', 'cuando']
const PRIORITY_LABELS: Record<Priority, string> = {
  urgente: 'Urgente',
  normal: 'Normal',
  cuando: 'Cuando pueda',
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const [{ data: tasksData }, { data: companiesData }] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, company:companies(*), subtasks(*)')
        .order('created_at', { ascending: false }),
      supabase.from('companies').select('*').order('name'),
    ])
    setTasks(tasksData ?? [])
    setCompanies(companiesData ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'all') return t.status !== 'completed'
    if (filter === 'completadas') return t.status === 'completed'
    if (filter === 'urgente' || filter === 'normal' || filter === 'cuando')
      return t.status !== 'completed' && t.priority === filter
    // company filter
    return t.status !== 'completed' && t.company_id === filter
  })

  const pendingTasks = tasks.filter((t) => t.status !== 'completed')
  const completedTasks = tasks.filter((t) => t.status === 'completed')

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

  if (loading) {
    return <div className="text-sm text-gray-400 py-8 text-center">Loading...</div>
  }

  const isShowingCompleted = filter === 'completadas'
  const displayTasks = filteredTasks

  return (
    <div className="space-y-6">
      <AddTaskForm companies={companies} onAdded={fetchData} />

      {/* Filter bar */}
      <div className="flex flex-wrap gap-1.5">
        {filterButtons.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === id
                ? 'bg-gray-900 text-white'
                : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
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

      {/* Task list */}
      {displayTasks.length === 0 && (
        <div className="text-sm text-gray-400 text-center py-12">
          {isShowingCompleted ? 'No completed tasks yet.' : 'No tasks. Add one above.'}
        </div>
      )}

      {isShowingCompleted ? (
        <div className="space-y-2">
          {displayTasks.map((task) => (
            <TaskCard key={task.id} task={task} onUpdate={fetchData} />
          ))}
        </div>
      ) : (
        groupByPriority(displayTasks).map(({ priority, tasks: group }) => (
          <div key={priority}>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {PRIORITY_LABELS[priority]}
            </h2>
            <div className="space-y-2">
              {group.map((task) => (
                <TaskCard key={task.id} task={task} onUpdate={fetchData} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
