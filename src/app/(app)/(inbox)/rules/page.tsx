'use client'

import { useCallback, useEffect, useState } from 'react'
import { IM_REGLA_MATCH_LABELS, IM_REGLA_ACCION_LABELS } from '@/types'
import type { ImRegla } from '@/types'
import CreateRuleModal from '@/components/CreateRuleModal'

export default function RulesPage() {
  const [rules, setRules] = useState<ImRegla[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ImRegla | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const fetchRules = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/rules')
    if (!res.ok) {
      setError('Could not load rules.')
      setRules([])
      setLoading(false)
      return
    }
    setRules(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchRules() }, [fetchRules])

  async function patchRule(id: string, patch: Partial<ImRegla>) {
    const prev = rules
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    const res = await fetch(`/api/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      setRules(prev)
      setError('Update failed — reverted.')
    }
  }

  async function deleteRule(id: string) {
    const prev = rules
    setRules((rs) => rs.filter((r) => r.id !== id))
    setConfirmDelete(null)
    const res = await fetch(`/api/rules/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setRules(prev)
      setError('Delete failed — reverted.')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[#e8e8e8]">Rules</h1>
          <p className="text-sm text-[#888888] mt-0.5">
            {loading ? 'Loading…' : `${rules.length} rule${rules.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7F77DD] text-white text-sm rounded hover:bg-[#6b62d0] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add rule
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {!loading && rules.length === 0 && (
        <div className="text-sm text-[#888888] text-center py-12">No rules yet. Add one above.</div>
      )}

      <div className="space-y-2">
        {rules.map((r) => (
          <div
            key={r.id}
            className={`bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-3 flex flex-wrap items-center gap-3 ${
              r.activa ? '' : 'opacity-50'
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[#555555]">{IM_REGLA_MATCH_LABELS[r.match_tipo]}</span>
                <span className="text-sm font-medium text-[#e8e8e8] font-mono">{r.match_valor}</span>
                {r.alerta && <span title="Sends alert">⚡</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <span className="text-xs px-1.5 py-0.5 rounded bg-[#1e1a3d] text-[#7F77DD]">
                  {IM_REGLA_ACCION_LABELS[r.accion]}
                </span>
                <span className="text-xs text-[#555555]">{r.inbox}</span>
                <span className="text-xs text-[#555555]">
                  {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            </div>

            <label className="flex items-center gap-1.5 text-xs text-[#888888] cursor-pointer">
              <input
                type="checkbox"
                checked={r.activa}
                onChange={(e) => patchRule(r.id, { activa: e.target.checked })}
                className="accent-[#7F77DD]"
              />
              {r.activa ? 'Active' : 'Off'}
            </label>

            <button
              onClick={() => setEditing(r)}
              className="text-xs text-[#888888] hover:text-[#e8e8e8] transition-colors"
            >
              Edit
            </button>

            {confirmDelete === r.id ? (
              <div className="flex items-center gap-1.5">
                <button onClick={() => deleteRule(r.id)} className="text-xs text-red-500 hover:text-red-400 font-medium">Delete</button>
                <button onClick={() => setConfirmDelete(null)} className="text-xs text-[#555555] hover:text-[#888888]">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(r.id)}
                className="text-[#555555] hover:text-red-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {creating && (
        <CreateRuleModal onClose={() => setCreating(false)} onSaved={fetchRules} />
      )}
      {editing && (
        <CreateRuleModal
          editId={editing.id}
          initialMatchTipo={editing.match_tipo}
          initialMatchValor={editing.match_valor}
          initialInbox={editing.inbox}
          initialAccion={editing.accion}
          initialAlerta={editing.alerta}
          onClose={() => setEditing(null)}
          onSaved={fetchRules}
        />
      )}
    </div>
  )
}
