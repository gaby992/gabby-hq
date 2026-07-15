'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { URGENCIA_EMOJI, URGENCIA_ORDER, URGENCIA_LABELS } from '@/types'
import type { ImTriaje, ImUrgencia } from '@/types'
import CopyButton from '@/components/CopyButton'

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
function todayLabel(): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })
    .format(new Date())
}

function oneLine(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

export default function ChelseaPage() {
  const [items, setItems] = useState<ImTriaje[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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

  useEffect(() => { fetchItems() }, [fetchItems])

  const pending = useMemo(() => items.filter((i) => i.status === 'pasado_a_chelsea'), [items])

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

  // Plain-text pending list, grouped by urgency, in English.
  function buildPendingText(): string {
    const lines: string[] = [`CHELSEA'S PENDING — ${todayLabel()}`]
    const headers: Record<ImUrgencia, string> = { alta: 'HIGH', media: 'MEDIUM', baja: 'LOW' }
    for (const u of URGENCIA_ORDER) {
      const bucket = pending.filter((i) => i.urgencia === u)
      if (bucket.length === 0) continue
      lines.push('', `${headers[u]}:`)
      for (const i of bucket) {
        const summary = oneLine(i.resumen_ia)
        lines.push(`- ${i.remitente || '(no sender)'} — ${i.asunto || '(no subject)'}${summary ? `: ${summary}` : ''}`)
      }
    }
    const noUrg = pending.filter((i) => !i.urgencia)
    if (noUrg.length) {
      lines.push('', 'OTHER:')
      for (const i of noUrg) {
        const summary = oneLine(i.resumen_ia)
        lines.push(`- ${i.remitente || '(no sender)'} — ${i.asunto || '(no subject)'}${summary ? `: ${summary}` : ''}`)
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
            {loading ? 'Loading…' : `${pending.length} pending`}
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
          {pending.length > 0 && (
            <CopyButton text={buildPendingText} label="Copy pending list" />
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {!loading && pending.length === 0 && !showResolved && (
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
    </div>
  )
}
