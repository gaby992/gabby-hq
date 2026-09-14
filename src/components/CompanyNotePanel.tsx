'use client'

import { useEffect, useRef, useState } from 'react'
import { Company, NotaEmpresa } from '@/types'
import { saveNota, notaFor } from '@/lib/notas'
import { relativeDaysEs } from '@/lib/dates'

interface Props {
  companies: Company[]
  notas: NotaEmpresa[]
  /** Preselected company — the active /tasks filter, when it is a company. */
  initialCompanyId?: string
  onSaved: (nota: NotaEmpresa) => void
  onClose: () => void
}

const MIN_ROWS = 4

/**
 * "Por dónde voy" panel for /tasks. Writes the SAME row that /hoy shows —
 * same table, same upsert, keyed by company_id. No duplicate records.
 */
export default function CompanyNotePanel({
  companies,
  notas,
  initialCompanyId,
  onSaved,
  onClose,
}: Props) {
  const firstId = initialCompanyId || companies[0]?.id || ''
  const [companyId, setCompanyId] = useState(firstId)
  const [draft, setDraft] = useState(notaFor(notas, firstId)?.nota ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // What was loaded from the DB for the current company; anything else is dirty.
  const loadedRef = useRef(draft)
  const [movedDirtyText, setMovedDirtyText] = useState(false)

  const existing = notaFor(notas, companyId)
  const dirty = draft !== loadedRef.current

  function autoGrow() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => { autoGrow() }, [])

  function selectCompany(id: string) {
    // If she already typed something, the text follows her to the newly picked
    // company instead of being wiped — the usual reason to switch mid-note is
    // having picked the wrong company in the first place. Nothing is written
    // to the company she is leaving.
    if (dirty) {
      setMovedDirtyText(true)
    } else {
      const next = notaFor(notas, id)?.nota ?? ''
      setDraft(next)
      loadedRef.current = next
      setMovedDirtyText(false)
    }
    setCompanyId(id)
    requestAnimationFrame(autoGrow)
  }

  async function handleSave() {
    if (!companyId) {
      setError('Escoge una empresa.')
      return
    }
    setSaving(true)
    setError(null)
    const { data, error: err } = await saveNota(companyId, draft)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    if (data) onSaved(data)
    onClose()
  }

  const selectedName = companies.find((c) => c.id === companyId)?.name ?? ''

  return (
    <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm">📝</span>
        <span className="text-sm font-medium text-[#e8e8e8]">Por dónde voy</span>
      </div>

      <select
        value={companyId}
        onChange={(e) => selectCompany(e.target.value)}
        className="text-xs border border-[#2a2a2a] rounded px-2 py-1.5 text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] bg-[#1c1c1c]"
      >
        {companies.length === 0 && <option value="">No hay empresas</option>}
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <textarea
        ref={textareaRef}
        autoFocus
        rows={MIN_ROWS}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); autoGrow() }}
        placeholder="¿Por dónde ibas?"
        className="w-full text-sm leading-6 rounded px-2.5 py-1.5 bg-[#0f0f0f] text-[#e8e8e8] border border-[#2a2a2a] focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444] resize-none overflow-hidden"
        style={{ minHeight: `calc(${MIN_ROWS} * 1.5rem + 0.75rem)` }}
      />

      {movedDirtyText && dirty ? (
        <p className="text-[11px] text-amber-400">
          Este texto se guardará en {selectedName}.
        </p>
      ) : (
        existing && (
          <p className="text-[11px] text-[#555555]">
            escrita {relativeDaysEs(existing.updated_at)}
          </p>
        )
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !companyId}
          className="px-4 py-1.5 bg-[#7F77DD] text-white text-sm rounded hover:bg-[#6b62d0] disabled:opacity-40 transition-colors"
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-sm text-[#888888] hover:text-[#e8e8e8] transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
