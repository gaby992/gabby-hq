'use client'

import { useState } from 'react'
import { Company, Priority } from '@/types'
import { supabase } from '@/lib/supabase'

interface Props {
  companies: Company[]
  onAdded: () => void
}

export default function AddTaskForm({ companies, onAdded }: Props) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    await supabase.from('tasks').insert({
      text: title.trim(),
      company_id: companyId || null,
      priority,
      due_date: dueDate || null,
      notes: notes.trim() || null,
      link_url: linkUrl.trim() || null,
      link_label: linkLabel.trim() || null,
      done: false,
    })
    setTitle('')
    setCompanyId('')
    setPriority('normal')
    setDueDate('')
    setNotes('')
    setLinkUrl('')
    setLinkLabel('')
    setOpen(false)
    setSaving(false)
    onAdded()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 p-4 bg-[#1c1c1c] border border-dashed border-[#2a2a2a] rounded-lg text-sm text-[#888888] hover:border-[#555555] hover:text-[#e8e8e8] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add task
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-4 space-y-3"
    >
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className="w-full text-sm font-medium border-0 outline-none placeholder:text-[#444444] text-[#e8e8e8] bg-transparent"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]"
        >
          <option value="">No company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className="text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]"
        >
          <option value="urgente">Urgente</option>
          <option value="normal">Normal</option>
          <option value="cuando">Cuando pueda</option>
        </select>

        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]"
        />
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="w-full text-xs border border-[#2a2a2a] rounded px-2.5 py-1.5 text-[#888888] focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444] resize-none bg-[#0f0f0f]"
      />

      <div className="grid grid-cols-2 gap-2">
        <input
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Link URL (optional)"
          className="text-xs border border-[#2a2a2a] rounded px-2.5 py-1.5 text-[#888888] focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444] bg-[#0f0f0f]"
        />
        <input
          type="text"
          value={linkLabel}
          onChange={(e) => setLinkLabel(e.target.value)}
          placeholder="Link label"
          className="text-xs border border-[#2a2a2a] rounded px-2.5 py-1.5 text-[#888888] focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444] bg-[#0f0f0f]"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="px-4 py-1.5 bg-[#7F77DD] text-white text-sm rounded hover:bg-[#6b62d0] disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving...' : 'Add task'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-4 py-1.5 text-sm text-[#888888] hover:text-[#e8e8e8] transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
