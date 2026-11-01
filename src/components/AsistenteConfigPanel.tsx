'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AsistenteConfigRow } from '@/types'

interface Costo {
  mes: string
  turnos: number
  porTipo: Record<string, number>
  tokens_in: number
  tokens_out: number
  usd: number
  error?: string
}

/**
 * Settings → Asistente (fase 7): what is personalised per person — her
 * name, the bot's name, the tone, and whether the bot proposes things or
 * only obeys — plus this month's LLM cost.
 */
export default function AsistenteConfigPanel() {
  const [cfg, setCfg] = useState<AsistenteConfigRow | null>(null)
  const [costo, setCosto] = useState<Costo | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/asistente/config')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setCfg(json.config)
      setCosto(json.costo)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!cfg) return
    setSaving(true)
    setMsg(null)
    setError(null)
    try {
      const res = await fetch('/api/asistente/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setCfg(json.config)
      setMsg('Guardado. El bot lo usa desde el próximo mensaje.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const field = 'bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-sm text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] w-full'
  const label = 'block text-[11px] text-[#555555] mb-1'

  if (!cfg) return <p className="text-sm text-[#555555]">{error ?? 'Cargando…'}</p>

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label}>Tu nombre (así te llama)</label>
          <input value={cfg.nombre_persona} onChange={(e) => setCfg({ ...cfg, nombre_persona: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label}>Nombre del bot</label>
          <input value={cfg.nombre_bot} onChange={(e) => setCfg({ ...cfg, nombre_bot: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label}>Tono</label>
          <select value={cfg.tono} onChange={(e) => setCfg({ ...cfg, tono: e.target.value as 'informal' | 'formal' })} className={field}>
            <option value="informal">Informal (tuteo, cálido)</option>
            <option value="formal">Formal (usted, sobrio)</option>
          </select>
        </div>
        <div>
          <label className={label}>Sugerencias</label>
          <select value={cfg.sugerencias ? 'si' : 'no'} onChange={(e) => setCfg({ ...cfg, sugerencias: e.target.value === 'si' })} className={field}>
            <option value="si">Propone cosas (¿para cuándo?, ¿seguimos con…?, ojo con…)</option>
            <option value="no">Solo obedece (modo menú)</option>
          </select>
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button type="submit" disabled={saving} className="px-4 py-1.5 bg-[#7F77DD] text-white text-sm rounded hover:bg-[#6b62d0] disabled:opacity-40 transition-colors">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          {msg && <span className="text-xs text-emerald-400">{msg}</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </form>

      <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-3 text-sm">
        {costo?.error ? (
          <span className="text-[#888888]">Costo del mes: no disponible ({costo.error})</span>
        ) : costo ? (
          <span className="text-[#888888]">
            Costo del LLM en {costo.mes}: <span className="text-[#e8e8e8] font-medium">${costo.usd.toFixed(4)} USD</span>
            {' · '}{costo.turnos} turnos ({Object.entries(costo.porTipo).map(([k, v]) => `${v} ${k}`).join(', ') || 'ninguno'})
            {' · '}{costo.tokens_in.toLocaleString()} tokens de entrada, {costo.tokens_out.toLocaleString()} de salida
            <span className="text-[#555555]"> · precio de lista de gpt-5-mini</span>
          </span>
        ) : (
          <span className="text-[#555555]">Cargando costo…</span>
        )}
      </div>
    </div>
  )
}
