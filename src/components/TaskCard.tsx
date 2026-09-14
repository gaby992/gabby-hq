'use client'

import { useState } from 'react'
import { Task, Subtask, Company, Priority, PRIORITY_LABELS } from '@/types'
import CompanyBadge from './CompanyBadge'
import PriorityBadge from './PriorityBadge'
import DueDateLabel from './DueDateLabel'
import { supabase } from '@/lib/supabase'

interface Props {
  task: Task
  companies: Company[]
  onUpdate: () => void
  /** Current 'YYYY-MM-DD', passed down so a whole list agrees on "today". */
  today?: string
}

const PRIORITIES: Priority[] = ['urgente', 'normal', 'cuando']

// n8n's bidirectional dedup keys off this line inside `notes`. If Gabby edits
// the notes of an inbox-sourced task and drops it, put it back — losing it
// would make the workflow re-import the same email as a new task.
const GMAIL_REF = /^Ref: gmail:\S+$/m

function preserveGmailRef(original: string | null, edited: string): string {
  const ref = original?.match(GMAIL_REF)?.[0]
  if (!ref || edited.includes(ref)) return edited
  return edited.trimEnd() ? `${edited.trimEnd()}\n\n${ref}` : ref
}

export default function TaskCard({ task, companies, onUpdate, today }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [newSubtask, setNewSubtask] = useState('')
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Inline edit
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(task.text)
  const [companyId, setCompanyId] = useState(task.company_id ?? '')
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [dueDate, setDueDate] = useState(task.due_date ?? '')
  const [notes, setNotes] = useState(task.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subtasks = task.subtasks ?? []
  const completedCount = subtasks.filter((s) => s.done).length
  const isCompleted = task.done
  const fromInbox = GMAIL_REF.test(task.notes ?? '')

  function startEditing() {
    setText(task.text)
    setCompanyId(task.company_id ?? '')
    setPriority(task.priority)
    setDueDate(task.due_date ?? '')
    setNotes(task.notes ?? '')
    setError(null)
    setEditing(true)
  }

  async function saveEdits() {
    if (!text.trim()) {
      setError('El título no puede quedar vacío.')
      return
    }
    setSaving(true)
    setError(null)
    const nextNotes = preserveGmailRef(task.notes, notes)
    const { error: err } = await supabase
      .from('tasks')
      .update({
        text: text.trim(),
        company_id: companyId || null,
        priority,
        due_date: dueDate || null, // empty input clears the date
        notes: nextNotes.trim() || null,
      })
      .eq('id', task.id)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setEditing(false)
    onUpdate()
  }

  async function toggleDone() {
    await supabase.from('tasks').update({ done: !task.done }).eq('id', task.id)
    onUpdate()
  }

  async function deleteTask() {
    await supabase.from('tasks').delete().eq('id', task.id)
    onUpdate()
  }

  async function toggleSubtask(subtask: Subtask) {
    await supabase.from('subtasks').update({ done: !subtask.done }).eq('id', subtask.id)
    onUpdate()
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault()
    if (!newSubtask.trim()) return
    setAddingSubtask(true)
    await supabase.from('subtasks').insert({ task_id: task.id, text: newSubtask.trim(), done: false })
    setNewSubtask('')
    setAddingSubtask(false)
    onUpdate()
  }

  async function deleteSubtask(id: string) {
    await supabase.from('subtasks').delete().eq('id', id)
    onUpdate()
  }

  const fieldClass =
    'w-full text-xs border border-[#2a2a2a] rounded px-2.5 py-1.5 text-[#e8e8e8] bg-[#0f0f0f] focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444]'
  const labelClass = 'text-[10px] text-[#555555] uppercase tracking-wide block mb-1'

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
              {task.text}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {task.company && <CompanyBadge company={task.company} size="xs" />}
            <PriorityBadge priority={task.priority} />
            <DueDateLabel date={task.due_date} today={today} />
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
          {/* ── Details: read-only, or the inline edit form ── */}
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Título</label>
                <input
                  autoFocus
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className={`${fieldClass} text-sm font-medium`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className={labelClass}>Empresa</label>
                  <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">Sin empresa</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Prioridad</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Priority)}
                    className={fieldClass}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Fecha límite</label>
                  <div className="flex gap-1">
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className={fieldClass}
                    />
                    {dueDate && (
                      <button
                        type="button"
                        onClick={() => setDueDate('')}
                        title="Quitar fecha"
                        className="px-2 text-xs text-[#555555] hover:text-red-400 transition-colors"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className={labelClass}>Notas</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Notas (opcional)"
                  className={`${fieldClass} resize-y text-[#888888]`}
                />
                {fromInbox && (
                  <p className="text-[10px] text-[#555555] mt-1">
                    Tarea creada desde Inbox IM — la línea <code className="text-[#888888]">Ref: gmail:…</code> se conserva automáticamente.
                  </p>
                )}
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={saveEdits}
                  disabled={saving}
                  className="px-4 py-1.5 bg-[#7F77DD] text-white text-sm rounded hover:bg-[#6b62d0] disabled:opacity-40 transition-colors"
                >
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button
                  onClick={() => { setEditing(false); setError(null) }}
                  className="px-4 py-1.5 text-sm text-[#888888] hover:text-[#e8e8e8] transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
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

              <button
                onClick={startEditing}
                className="text-xs text-[#7F77DD] hover:text-[#9b95e8] font-medium transition-colors"
              >
                Editar detalles
              </button>
            </>
          )}

          {/* Subtasks */}
          {subtasks.length > 0 && (
            <div className="space-y-1">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 group">
                  <button
                    onClick={() => toggleSubtask(s)}
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      s.done ? 'bg-[#7F77DD] border-[#7F77DD]' : 'border-[#2a2a2a] hover:border-[#888888]'
                    }`}
                  >
                    {s.done && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className={`text-sm flex-1 ${s.done ? 'line-through text-[#555555]' : 'text-[#888888]'}`}>
                    {s.text}
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
