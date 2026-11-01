'use client'

import { useState } from 'react'

/**
 * Fase 4b: the "¿Qué sigue?" button at the top of /hoy. Same answer the bot
 * gives (GET /api/asistente/que-sigue): one task for now, up to three after,
 * up to three due this week, the notes of the last 3 days. Closable.
 */
export default function QueSigueCard() {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/asistente/que-sigue')
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setText(String(json?.text ?? ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (text === null && !loading && !error) {
    return (
      <div className="flex justify-end">
        <button
          onClick={load}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-[#7F77DD]/15 text-[#7F77DD] hover:bg-[#7F77DD]/25 transition-colors"
        >
          🎯 ¿Qué sigue?
        </button>
      </div>
    )
  }

  return (
    <section className="bg-[#222222] border border-[#7F77DD]/50 rounded-lg px-6 py-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[#7F77DD]">🎯 ¿Qué sigue?</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="text-xs text-[#888888] hover:text-[#e8e8e8] disabled:opacity-40 transition-colors"
          >
            actualizar
          </button>
          <button
            onClick={() => { setText(null); setError(null) }}
            title="Cerrar"
            className="text-xs text-[#888888] hover:text-[#e8e8e8] transition-colors px-1"
          >
            ✕
          </button>
        </div>
      </div>
      {loading && <p className="text-sm text-[#888888]">Pensando…</p>}
      {error && <p className="text-sm text-red-400">No se pudo: {error}</p>}
      {text !== null && !loading && (
        // whitespace-pre-wrap: the answer is the same multi-line text the bot sends.
        <p className="text-sm leading-6 text-[#e8e8e8] whitespace-pre-wrap">{text || 'Nada pendiente 🎉'}</p>
      )}
    </section>
  )
}
