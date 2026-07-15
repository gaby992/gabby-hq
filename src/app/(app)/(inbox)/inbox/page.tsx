'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  URGENCIA_EMOJI,
  IM_TIPO_LABELS,
  IM_CATEGORIA_LABELS,
  IM_STATUS_LABELS,
  URGENCIA_LABELS,
} from '@/types'
import type {
  ImTriaje,
  ImStatus,
  ImUrgencia,
  ImTipo,
  ImCategoria,
  InboxAction,
} from '@/types'
import CopyButton from '@/components/CopyButton'
import CreateRuleModal from '@/components/CreateRuleModal'

const ACTION_RESULT: Record<InboxAction, ImStatus> = {
  for_chelsea: 'pasado_a_chelsea',
  ill_handle: 'lo_resuelvo_yo',
  archive: 'archivado',
  done: 'resuelto',
}

const ACTIONS: { key: InboxAction; label: string; tone: string }[] = [
  { key: 'for_chelsea', label: 'For Chelsea', tone: 'bg-[#1e1a3d] text-[#7F77DD] hover:bg-[#282150]' },
  { key: 'ill_handle', label: "I'll handle it", tone: 'bg-[#0d2110] text-green-400 hover:bg-[#123018]' },
  { key: 'archive', label: 'Archive', tone: 'bg-[#2a2a2a] text-[#888888] hover:bg-[#333333]' },
  { key: 'done', label: 'Done', tone: 'bg-[#2d1f00] text-amber-400 hover:bg-[#3a2800]' },
]

// "pendientes" is the default view (nuevo + registrado).
const STATUS_FILTERS: { value: string; label: string; param: string }[] = [
  { value: 'pendientes', label: 'Pending', param: 'nuevo,registrado' },
  { value: 'all', label: 'All', param: 'all' },
  { value: 'nuevo', label: 'Nuevo', param: 'nuevo' },
  { value: 'registrado', label: 'Registrado', param: 'registrado' },
  { value: 'pasado_a_chelsea', label: 'For Chelsea', param: 'pasado_a_chelsea' },
  { value: 'lo_resuelvo_yo', label: "I'll handle it", param: 'lo_resuelvo_yo' },
  { value: 'archivado', label: 'Archived', param: 'archivado' },
  { value: 'resuelto', label: 'Resolved', param: 'resuelto' },
]

function senderDomain(remitente: string | null): string {
  if (!remitente) return ''
  const match = remitente.match(/[<\s]([^<>@\s]+@[^<>@\s]+)/) ?? remitente.match(/([^<>@\s]+@[^<>@\s]+)/)
  const email = match?.[1] ?? remitente
  const at = email.indexOf('@')
  return at >= 0 ? email.slice(at + 1).replace(/>$/, '') : email
}

const inputCls =
  'text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]'

export default function InboxPage() {
  const [rows, setRows] = useState<ImTriaje[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState('pendientes')
  const [urgencia, setUrgencia] = useState('')
  const [tipo, setTipo] = useState('')
  const [categoria, setCategoria] = useState('')
  const [inbox, setInbox] = useState('')
  const [search, setSearch] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [ruleSeed, setRuleSeed] = useState<string | null>(null)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    params.set('status', STATUS_FILTERS.find((s) => s.value === statusFilter)?.param ?? 'nuevo,registrado')
    if (urgencia) params.set('urgencia', urgencia)
    if (tipo) params.set('tipo', tipo)
    if (categoria) params.set('categoria', categoria)
    if (inbox) params.set('inbox', inbox)
    if (search.trim()) params.set('search', search.trim())

    const res = await fetch(`/api/inbox?${params.toString()}`)
    if (!res.ok) {
      setError('Could not load inbox.')
      setRows([])
      setLoading(false)
      return
    }
    setRows(await res.json())
    setSelected(new Set())
    setLoading(false)
  }, [statusFilter, urgencia, tipo, categoria, inbox, search])

  useEffect(() => { fetchRows() }, [fetchRows])

  const inboxes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.inbox).filter(Boolean))).sort(),
    [rows]
  )

  function statusInFilter(status: ImStatus): boolean {
    if (statusFilter === 'all') return true
    if (statusFilter === 'pendientes') return status === 'nuevo' || status === 'registrado'
    return status === statusFilter
  }

  async function applyAction(ids: string[], action: InboxAction) {
    if (ids.length === 0) return
    const newStatus = ACTION_RESULT[action]
    const prev = rows
    // Optimistic: update status locally, then drop rows that no longer match the filter.
    setRows((rs) =>
      rs
        .map((r) => (ids.includes(r.id) ? { ...r, status: newStatus } : r))
        .filter((r) => statusInFilter(r.status))
    )
    setSelected(new Set())

    const res = await fetch('/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action }),
    })
    if (!res.ok) {
      setRows(prev) // roll back
      setError('Action failed — reverted.')
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = rows.length > 0 && selected.size === rows.length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[#e8e8e8]">Inbox triage</h1>
          <p className="text-sm text-[#888888] mt-0.5">
            {loading ? 'Loading…' : `${rows.length} message${rows.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select value={urgencia} onChange={(e) => setUrgencia(e.target.value)} className={inputCls}>
          <option value="">Urgency</option>
          {(Object.keys(URGENCIA_LABELS) as ImUrgencia[]).map((u) => (
            <option key={u} value={u}>{URGENCIA_EMOJI[u]} {URGENCIA_LABELS[u]}</option>
          ))}
        </select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
          <option value="">Type</option>
          {(Object.keys(IM_TIPO_LABELS) as ImTipo[]).map((t) => (
            <option key={t} value={t}>{IM_TIPO_LABELS[t]}</option>
          ))}
        </select>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={inputCls}>
          <option value="">Category</option>
          {(Object.keys(IM_CATEGORIA_LABELS) as ImCategoria[]).map((c) => (
            <option key={c} value={c}>{IM_CATEGORIA_LABELS[c]}</option>
          ))}
        </select>
        {inboxes.length > 1 && (
          <select value={inbox} onChange={(e) => setInbox(e.target.value)} className={inputCls}>
            <option value="">All inboxes</option>
            {inboxes.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sender / subject…"
          className={`${inputCls} flex-1 min-w-40 placeholder:text-[#444444]`}
        />
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-12 z-10 flex flex-wrap items-center gap-2 bg-[#1c1c1c] border border-[#7F77DD]/40 rounded-lg px-3 py-2">
          <label className="flex items-center gap-2 text-xs text-[#888888] cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              className="accent-[#7F77DD]"
            />
            {selected.size} selected
          </label>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {ACTIONS.map((a) => (
              <button
                key={a.key}
                onClick={() => applyAction(Array.from(selected), a.key)}
                className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${a.tone}`}
              >
                {a.label}
              </button>
            ))}
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs px-2 py-1 text-[#555555] hover:text-[#888888]"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Rows */}
      {!loading && rows.length === 0 && (
        <div className="text-sm text-[#888888] text-center py-12">Nothing here ✨</div>
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const isExpanded = expanded.has(r.id)
          const isSelected = selected.has(r.id)
          const domain = senderDomain(r.remitente)
          return (
            <div
              key={r.id}
              className={`bg-[#1c1c1c] border rounded-lg transition-colors ${
                isSelected ? 'border-[#7F77DD]/60' : 'border-[#2a2a2a]'
              }`}
            >
              <div className="flex items-start gap-3 p-4">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(r.id)}
                  className="mt-1 accent-[#7F77DD] flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span title={r.urgencia ?? ''}>{r.urgencia ? URGENCIA_EMOJI[r.urgencia] : '⚪'}</span>
                    {r.tipo && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#0f0f0f] text-[#888888] uppercase tracking-wide">
                        {IM_TIPO_LABELS[r.tipo]}
                      </span>
                    )}
                    <span className="text-sm font-medium text-[#e8e8e8] truncate max-w-[60%]">
                      {r.remitente || '(no sender)'}
                    </span>
                    {r.status !== 'nuevo' && r.status !== 'registrado' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2a2a] text-[#888888]">
                        {IM_STATUS_LABELS[r.status]}
                      </span>
                    )}
                    {r.inbox && inboxes.length > 1 && (
                      <span className="text-[10px] text-[#555555]">{r.inbox}</span>
                    )}
                  </div>
                  <p className="text-sm text-[#e8e8e8]">{r.asunto || '(no subject)'}</p>
                  {r.resumen_ia && (
                    <p
                      className={`text-xs text-[#888888] mt-1 cursor-pointer ${isExpanded ? '' : 'line-clamp-2'}`}
                      onClick={() => toggleExpand(r.id)}
                    >
                      {r.resumen_ia}
                    </p>
                  )}

                  {isExpanded && r.borrador_respuesta && (
                    <div className="mt-2 bg-[#0f0f0f] border border-[#2a2a2a] rounded p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wide text-[#555555]">Draft reply</span>
                        <CopyButton text={r.borrador_respuesta} />
                      </div>
                      <p className="text-xs text-[#888888] whitespace-pre-wrap">{r.borrador_respuesta}</p>
                    </div>
                  )}

                  {/* Row actions */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    {ACTIONS.map((a) => (
                      <button
                        key={a.key}
                        onClick={() => applyAction([r.id], a.key)}
                        className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${a.tone}`}
                      >
                        {a.label}
                      </button>
                    ))}
                    <button
                      onClick={() => setRuleSeed(domain)}
                      className="text-xs px-2.5 py-1 rounded text-[#555555] hover:text-[#e8e8e8] transition-colors"
                    >
                      Create rule…
                    </button>
                    {(r.resumen_ia || r.borrador_respuesta) && (
                      <button
                        onClick={() => toggleExpand(r.id)}
                        className="text-xs px-2 py-1 text-[#555555] hover:text-[#888888] ml-auto"
                      >
                        {isExpanded ? 'Less' : 'More'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {ruleSeed !== null && (
        <CreateRuleModal
          initialMatchTipo="dominio"
          initialMatchValor={ruleSeed}
          onClose={() => setRuleSeed(null)}
          onSaved={() => {}}
        />
      )}
    </div>
  )
}
