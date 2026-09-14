'use client'

import { useEffect, useRef, useState } from 'react'
import { NotaEmpresa } from '@/types'
import { saveNota } from '@/lib/notas'
import { daysSince, relativeDaysEs } from '@/lib/dates'

interface Props {
  companyId: string
  nota: NotaEmpresa | null
  onSaved: (nota: NotaEmpresa) => void
}

/** Past this many days the note is probably stale advice, not a starting point. */
const STALE_AFTER_DAYS = 3
const MIN_ROWS = 4

export default function CompanyNote({ companyId, nota, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(nota?.nota ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Escape cancels; it also fires blur, which would otherwise save on the way out.
  const cancelledRef = useRef(false)

  const text = nota?.nota?.trim() ?? ''
  const hasNote = text.length > 0
  const age = nota ? daysSince(nota.updated_at) : 0
  const isStale = hasNote && age > STALE_AFTER_DAYS

  function autoGrow() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => {
    if (editing) autoGrow()
  }, [editing])

  function startEditing() {
    setDraft(nota?.nota ?? '')
    setError(null)
    cancelledRef.current = false
    setEditing(true)
  }

  async function save() {
    if (cancelledRef.current) {
      cancelledRef.current = false
      setEditing(false)
      return
    }
    // No write when nothing changed. Bumping updated_at on a stray click would
    // reset the age counter and wipe out the "nota vieja" signal.
    if (draft === (nota?.nota ?? '')) {
      setEditing(false)
      return
    }

    setSaving(true)
    setError(null)
    const { data, error: err } = await saveNota(companyId, draft)
    setSaving(false)

    if (err) {
      // Keep the textarea open so the text she just typed is never lost.
      setError(err.message)
      return
    }
    setEditing(false)
    if (data) onSaved(data)
  }

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <span className="text-sm leading-6 flex-shrink-0">📝</span>
          <textarea
            ref={textareaRef}
            autoFocus
            rows={MIN_ROWS}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); autoGrow() }}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                cancelledRef.current = true
                e.currentTarget.blur()
              }
            }}
            placeholder="¿Por dónde ibas?"
            className="flex-1 text-sm leading-6 rounded px-2.5 py-1.5 bg-[#0f0f0f] text-[#e8e8e8] border border-[#7F77DD] focus:outline-none placeholder:text-[#444444] resize-none overflow-hidden"
            // Floor of MIN_ROWS lines (line-height 1.5rem) + vertical padding;
            // autoGrow takes it from there. `resize-none` because a manual drag
            // would just be undone by the next keystroke's autoGrow.
            style={{ minHeight: `calc(${MIN_ROWS} * 1.5rem + 0.75rem)` }}
          />
        </div>
        <p className="text-[11px] text-[#555555] pl-6">
          {saving ? 'Guardando...' : 'Se guarda al salir del campo · Esc para cancelar'}
        </p>
        {error && <p className="text-[11px] text-red-400 pl-6">{error}</p>}
      </div>
    )
  }

  return (
    <div
      onClick={startEditing}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditing() } }}
      className="group cursor-text rounded px-2.5 py-1.5 -mx-2.5 hover:bg-[#0f0f0f]/60 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span className="text-sm leading-6 flex-shrink-0">📝</span>
        {hasNote ? (
          // whitespace-pre-wrap: she writes paragraphs with dashed bullets.
          <p className={`flex-1 text-sm leading-6 whitespace-pre-wrap ${isStale ? 'text-[#6a6a6a]' : 'text-[#7F77DD]'}`}>
            {text}
          </p>
        ) : (
          <p className="flex-1 text-sm leading-6 text-[#444444] group-hover:text-[#666666] transition-colors">
            ¿Por dónde ibas?
          </p>
        )}
      </div>
      {hasNote && nota && (
        <p className={`text-[11px] pl-6 mt-0.5 ${isStale ? 'text-[#6a6a6a]' : 'text-[#555555]'}`}>
          {isStale && <span className="mr-1">⚠ nota vieja ·</span>}
          escrita {relativeDaysEs(nota.updated_at)}
        </p>
      )}
    </div>
  )
}
