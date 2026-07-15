'use client'

import { useState } from 'react'
import {
  IM_REGLA_MATCH_LABELS,
  IM_REGLA_ACCION_LABELS,
} from '@/types'
import type { ImReglaMatchTipo, ImReglaAccion } from '@/types'

interface Props {
  // When editId is set the modal edits (PATCH) that rule; otherwise it creates.
  editId?: string
  initialMatchTipo?: ImReglaMatchTipo
  initialMatchValor?: string
  initialInbox?: string
  initialAccion?: ImReglaAccion
  initialAlerta?: boolean
  onClose: () => void
  onSaved: () => void
}

export default function CreateRuleModal({
  editId,
  initialMatchTipo = 'dominio',
  initialMatchValor = '',
  initialInbox = 'chelsea',
  initialAccion = 'auto_chelsea',
  initialAlerta = false,
  onClose,
  onSaved,
}: Props) {
  const [inbox, setInbox] = useState(initialInbox)
  const [matchTipo, setMatchTipo] = useState<ImReglaMatchTipo>(initialMatchTipo)
  const [matchValor, setMatchValor] = useState(initialMatchValor)
  const [accion, setAccion] = useState<ImReglaAccion>(initialAccion)
  const [alerta, setAlerta] = useState(initialAlerta)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!matchValor.trim()) return
    setSaving(true)
    setError(null)
    const res = await fetch(editId ? `/api/rules/${editId}` : '/api/rules', {
      method: editId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inbox: inbox.trim() || 'chelsea',
        match_tipo: matchTipo,
        match_valor: matchValor.trim(),
        accion,
        alerta,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      setError('Could not save rule.')
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="w-full max-w-md bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-5 space-y-4"
      >
        <h2 className="text-sm font-semibold text-[#e8e8e8]">{editId ? 'Edit rule' : 'Create rule'}</h2>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-[#888888] space-y-1">
            <span className="block">Match on</span>
            <select
              value={matchTipo}
              onChange={(e) => setMatchTipo(e.target.value as ImReglaMatchTipo)}
              className="w-full text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]"
            >
              {(Object.keys(IM_REGLA_MATCH_LABELS) as ImReglaMatchTipo[]).map((k) => (
                <option key={k} value={k}>{IM_REGLA_MATCH_LABELS[k]}</option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[#888888] space-y-1">
            <span className="block">Inbox</span>
            <input
              type="text"
              value={inbox}
              onChange={(e) => setInbox(e.target.value)}
              placeholder="chelsea"
              className="w-full text-xs border border-[#2a2a2a] rounded px-2.5 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444] bg-[#0f0f0f]"
            />
          </label>
        </div>

        <label className="text-xs text-[#888888] space-y-1 block">
          <span className="block">Value</span>
          <input
            autoFocus
            type="text"
            value={matchValor}
            onChange={(e) => setMatchValor(e.target.value)}
            placeholder="e.g. gmail.com"
            className="w-full text-sm border border-[#2a2a2a] rounded px-2.5 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444] bg-[#0f0f0f]"
          />
        </label>

        <label className="text-xs text-[#888888] space-y-1 block">
          <span className="block">Action</span>
          <select
            value={accion}
            onChange={(e) => setAccion(e.target.value as ImReglaAccion)}
            className="w-full text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]"
          >
            {(Object.keys(IM_REGLA_ACCION_LABELS) as ImReglaAccion[]).map((k) => (
              <option key={k} value={k}>{IM_REGLA_ACCION_LABELS[k]}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-[#888888] cursor-pointer">
          <input
            type="checkbox"
            checked={alerta}
            onChange={(e) => setAlerta(e.target.checked)}
            className="accent-[#7F77DD]"
          />
          Send alert ⚡ when this rule matches
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving || !matchValor.trim()}
            className="px-4 py-1.5 bg-[#7F77DD] text-white text-sm rounded hover:bg-[#6b62d0] disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving...' : editId ? 'Save' : 'Create rule'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-[#888888] hover:text-[#e8e8e8] transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
