'use client'

import { useState } from 'react'
import { Company, Priority } from '@/types'
import { supabase } from '@/lib/supabase'
import { toggleCalendar } from '@/lib/calendar-client'
import ImportanteCheckbox from './ImportanteCheckbox'

interface Props {
  companies: Company[]
  onAdded: () => void
  /** Lets /tasks hide the "Por dónde voy" button while this form is expanded. */
  onOpenChange?: (open: boolean) => void
}

export default function AddTaskForm({ companies, onAdded, onOpenChange }: Props) {
  const [open, setOpenState] = useState(false)

  function setOpen(v: boolean) {
    setOpenState(v)
    onOpenChange?.(v)
  }
  const [title, setTitle] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [importante, setImportante] = useState(false)
  const [dueDate, setDueDate] = useState('')
  // Fase 5-D: hour + "add to Calendar" at creation. The event is created by the server.
  const [dueTime, setDueTime] = useState('')
  const [calendar, setCalendar] = useState(false)
  const [calMsg, setCalMsg] = useState<string | null>(null)
  const [startDate, setStartDate] = useState('')
  const [notes, setNotes] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 8: picking Urgente ticks ★ on its own — if it's on fire it almost always
  // matters too. Only ever turns it on, so Gabby can untick it right after and
  // it stays unticked.
  function changePriority(next: Priority) {
    setPriority(next)
    if (next === 'urgente') setImportante(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    const { data: creada, error: err } = await supabase
      .from('tasks')
      .insert({
        text: title.trim(),
        company_id: companyId || null,
        priority,
        importante,
        due_date: dueDate || null,
        due_time: dueDate && dueTime ? dueTime : null,
        start_date: startDate || null,
        notes: notes.trim() || null,
        link_url: linkUrl.trim() || null,
        link_label: linkLabel.trim() || null,
        done: false,
      })
      .select('id')
      .single<{ id: string }>()
    // Surface failures instead of clearing the form on a silent error — a
    // missing column or an RLS rule would otherwise just look like "nothing
    // saved".
    if (err) {
      setSaving(false)
      setError(err.message)
      return
    }
    setCalMsg(null)
    if (calendar && creada?.id) {
      const r = await toggleCalendar(creada.id, false, !dueTime)
      setCalMsg(r.mensaje)
    }
    setTitle('')
    setDueTime('')
    setCalendar(false)
    setCompanyId('')
    setPriority('normal')
    setImportante(false)
    setDueDate('')
    setStartDate('')
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
          onChange={(e) => changePriority(e.target.value as Priority)}
          className="text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]"
        >
          <option value="urgente">Urgente</option>
          <option value="normal">Normal</option>
          <option value="cuando">Cuando pueda</option>
        </select>

        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-[#555555] uppercase tracking-wide">Due</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]"
          />
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-[#555555] uppercase tracking-wide">Hora</span>
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            disabled={!dueDate}
            title={dueDate ? '' : 'Pon una fecha primero'}
            className="text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c] disabled:opacity-40"
          />
        </label>

        <label className={`flex items-center gap-1.5 text-xs self-end py-1.5 ${dueDate ? 'text-[#7F77DD] cursor-pointer' : 'text-[#555555]'}`} title={dueDate ? 'Crea también el evento en Google Calendar' : 'Pon una fecha primero'}>
          <input type="checkbox" checked={calendar} disabled={!dueDate} onChange={(e) => setCalendar(e.target.checked)} className="accent-[#7F77DD]" />
          📅 Calendar
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-[#555555] uppercase tracking-wide">Start</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]"
          />
        </label>
      </div>

      {/* Sits directly under the priority selector: the second axis, not a
          fifth priority level. */}
      <ImportanteCheckbox
        checked={importante}
        onChange={setImportante}
        hint="— construye a largo plazo"
      />

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

      {error && <p className="text-xs text-red-400">{error}</p>}
      {calMsg && <p className="text-xs text-[#888888]">{calMsg}</p>}

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
