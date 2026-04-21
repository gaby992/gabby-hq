'use client'

import { useState } from 'react'
import { Task, Subtask } from '@/types'
import CompanyBadge from './CompanyBadge'
import PriorityBadge from './PriorityBadge'
import DueDateLabel from './DueDateLabel'
import { supabase } from '@/lib/supabase'

interface Props {
  task: Task
  onUpdate: () => void
}

export default function TaskCard({ task, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [newSubtask, setNewSubtask] = useState('')
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const subtasks = task.subtasks ?? []
  const completedCount = subtasks.filter((s) => s.completed).length

  async function toggleDone() {
    await supabase
      .from('tasks')
      .update({ status: task.status === 'completed' ? 'pending' : 'completed' })
      .eq('id', task.id)
    onUpdate()
  }

  async function deleteTask() {
    await supabase.from('tasks').delete().eq('id', task.id)
    onUpdate()
  }

  async function toggleSubtask(subtask: Subtask) {
    await supabase
      .from('subtasks')
      .update({ completed: !subtask.completed })
      .eq('id', subtask.id)
    onUpdate()
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault()
    if (!newSubtask.trim()) return
    setAddingSubtask(true)
    await supabase.from('subtasks').insert({ task_id: task.id, title: newSubtask.trim(), completed: false })
    setNewSubtask('')
    setAddingSubtask(false)
    onUpdate()
  }

  async function deleteSubtask(id: string) {
    await supabase.from('subtasks').delete().eq('id', id)
    onUpdate()
  }

  const isCompleted = task.status === 'completed'

  return (
    <div className={`bg-[#1c1c1c] border rounded-lg transition-all ${isCompleted ? 'border-[#2a2a2a] opacity-60' : 'border-[#2a2a2a]'}`}>
      <div
        className="flex items-start gap-3 p-4 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleDone() }}
          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isCompleted ? 'bg-[#7F77DD] border-[#7F77DD]' : 'border-[#2a2a2a] hover:border-[#888888]'
          }`}
        >
          {isCompleted && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`text-sm font-medium ${isCompleted ? 'line-through text-[#555555]' : 'text-[#e8e8e8]'}`}>
              {task.title}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {task.company && <CompanyBadge company={task.company} size="xs" />}
            <PriorityBadge priority={task.priority} />
            <DueDateLabel date={task.due_date} />
            {subtasks.length > 0 && (
              <span className="text-xs text-[#888888]">{completedCount}/{subtasks.length} subtasks</span>
            )}
          </div>
        </div>

        {/* Expand indicator */}
        <svg
          className={`w-4 h-4 text-[#555555] flex-shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[#2a2a2a] px-4 pb-4 pt-3 space-y-3">
          {task.notes && (
            <p className="text-sm text-[#888888] whitespace-pre-wrap">{task.notes}</p>
          )}

          {task.link_url && (
            <a
              href={task.link_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-xs text-[#7F77DD] hover:text-[#9b95e8] font-medium"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {task.link_label || task.link_url}
            </a>
          )}

          {/* Subtasks */}
          {subtasks.length > 0 && (
            <div className="space-y-1">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 group">
                  <button
                    onClick={() => toggleSubtask(s)}
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      s.completed ? 'bg-[#7F77DD] border-[#7F77DD]' : 'border-[#2a2a2a] hover:border-[#888888]'
                    }`}
                  >
                    {s.completed && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className={`text-sm flex-1 ${s.completed ? 'line-through text-[#555555]' : 'text-[#888888]'}`}>
                    {s.title}
                  </span>
                  <button
                    onClick={() => deleteSubtask(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-[#555555] hover:text-red-400 transition-opacity text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add subtask */}
          <form onSubmit={addSubtask} className="flex gap-2">
            <input
              type="text"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              placeholder="Add subtask..."
              className="flex-1 text-sm border border-[#2a2a2a] bg-[#0f0f0f] text-[#e8e8e8] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444]"
            />
            <button
              type="submit"
              disabled={addingSubtask || !newSubtask.trim()}
              className="text-xs px-3 py-1.5 bg-[#2a2a2a] hover:bg-[#333333] rounded text-[#888888] disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </form>

          {/* Delete */}
          <div className="flex justify-end pt-1">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#888888]">Delete this task?</span>
                <button onClick={deleteTask} className="text-xs text-red-500 hover:text-red-400 font-medium">Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-[#555555] hover:text-[#888888]">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-[#555555] hover:text-red-400 transition-colors"
              >
                Delete task
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
