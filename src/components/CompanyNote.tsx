'use client'

import { useEffect, useRef, useState } from 'react'
import { NotaEmpresa } from '@/types'
import { archivarNota, edadNota, saveNota } from '@/lib/notas'
import { daysSince, relativeDaysEs } from '@/lib/dates'

interface Props {
  companyId: string
  nota: NotaEmpresa | null
  onSaved: (nota: NotaEmpresa) => void
  /** Fase 4b: the old note went to notas_historial and the live one is gone. */
  onArchived?: (companyId: string) => void
}

const MIN_ROWS = 4

/**
 * The "por dónde iba" note of a company block. Fase 4b shows it by age:
 *   ≤ 3 días  → accent colour (it is also in C1 and the 8:00 alarm)
 *   4–14 días → grey, "escrita hace N días"
 *   > 14 días → one line "📝 nota de hace N días — ver / archivar"
 * Clicking the text edits in place; saving a new text over an old note sends
 * the old one to notas_historial by itself (see saveNota).
 */
export default function CompanyNote({ companyId, nota, onSaved, onArchived }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(nota?.nota ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verVieja, setVerVieja] = useState(false)
  const [archivando, setArchivando] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Escape cancels; it also fires blur, which would otherwise save on the way out.
  const cancelledRef = useRef(false)

  const text = nota?.nota?.trim() ?? ''
  const hasNote = text.length > 0
  const edad = hasNote && nota ? edadNota(nota) : 'fresca'
  const dias = nota ? daysSince(nota.updated_at) : 0

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

  async function archivar() {
    setArchivando(true)
    const { error: err } = await archivarNota(companyId)
    setArchivando(false)
    if (err) {
      setError(err.message)
      return
    }
    setVerVieja(false)
    onArchived?.(companyId)
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

  // > 14 días: collapsed to one line until "ver"; "archivar" moves it to the history.
  if (hasNote && edad === 'vieja' && !verVieja) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6a6a6a] px-1">
        <span>📝 nota de hace {dias} días —</span>
        <button onClick={() => setVerVieja(true)} className="text-[#888888] hover:text-[#e8e8e8] underline-offset-2 hover:underline transition-colors">
          ver
        </button>
        <span>/</span>
        <button
          onClick={archivar}
          disabled={archivando}
          className="text-[#888888] hover:text-[#e8e8e8] underline-offset-2 hover:underline disabled:opacity-40 transition-colors"
        >
          {archivando ? 'archivando…' : 'archivar'}
        </button>
        {error && <span className="text-red-400">{error}</span>}
      </div>
    )
  }

  const textColor = edad === 'fresca' ? 'text-[#7F77DD]' : 'text-[#8a8a8a]'

  return (
    <div className="space-y-1">
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
            <p className={`flex-1 text-sm leading-6 whitespace-pre-wrap ${textColor}`}>{text}</p>
          ) : (
            <p className="flex-1 text-sm leading-6 text-[#444444] group-hover:text-[#666666] transition-colors">
              ¿Por dónde ibas?
            </p>
          )}
        </div>
        {hasNote && nota && (
          <p className={`text-[11px] pl-6 mt-0.5 ${edad === 'fresca' ? 'text-[#555555]' : 'text-[#6a6a6a]'}`}>
            escrita {relativeDaysEs(nota.updated_at)}
          </p>
        )}
      </div>
      {hasNote && edad !== 'fresca' && (
        <div className="flex items-center gap-2 text-[11px] text-[#555555] pl-6">
          {edad === 'vieja' && (
            <button onClick={() => setVerVieja(false)} className="hover:text-[#e8e8e8] transition-colors">ocultar</button>
          )}
          <button
            onClick={archivar}
            disabled={archivando}
            className="hover:text-[#e8e8e8] disabled:opacity-40 transition-colors"
            title="Guardarla en el historial y dejar la nota vacía"
          >
            {archivando ? 'archivando…' : 'archivar'}
          </button>
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}
    </div>
  )
}
