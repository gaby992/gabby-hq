'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CORREO_TIPO_LABELS,
  CORREO_URGENCIA_EMOJI,
  CORREO_URGENCIA_ORDER,
  type Correo,
  type CorreoEvaluacion,
  type CorreoTipo,
  type CorreoUrgencia,
  type CorreoVeredicto,
  type CuentaCorreo,
} from '@/types'

interface Acierto {
  modelo: string
  comparados: number
  urgencia_ok: number
  tipo_ok: number
  ambos_ok: number
}

interface Tabla {
  correos: Correo[]
  evaluaciones: CorreoEvaluacion[]
  veredictos: CorreoVeredicto[]
  modelos: string[]
  aciertos: Acierto[]
  modelo_actual: string | null
  dias: number
}

const TIPOS = Object.keys(CORREO_TIPO_LABELS) as CorreoTipo[]

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${Math.round((n / d) * 100)}%`
}

/**
 * /correo/evaluar (fase 6-E): every mail of the window, how production and
 * each evaluated model classified it, and Gabby's verdict per row. The
 * accuracy per model at the top decides gpt-5-mini vs JEV vs Claude with
 * real data. Running a model here never changes a mail's state.
 */
export default function EvaluarPage() {
  const [tabla, setTabla] = useState<Tabla | null>(null)
  const [cuentas, setCuentas] = useState<CuentaCorreo[]>([])
  const [cuenta, setCuenta] = useState('')
  const [dias, setDias] = useState(7)
  const [modelo, setModelo] = useState('')
  const [corriendo, setCorriendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [soloSinVeredicto, setSoloSinVeredicto] = useState(false)

  useEffect(() => {
    fetch('/api/correo/cuentas').then((r) => r.json()).then((j) => setCuentas(j?.cuentas ?? [])).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setError(null)
    const p = new URLSearchParams({ dias: String(dias) })
    if (cuenta) p.set('cuenta', cuenta)
    try {
      const res = await fetch(`/api/correo/evaluar?${p.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setTabla(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [dias, cuenta])

  useEffect(() => { load() }, [load])

  async function correr() {
    if (!modelo.trim()) return
    setCorriendo(true)
    setAviso(null)
    setError(null)
    const p = new URLSearchParams({ dias: String(dias), modelo: modelo.trim() })
    if (cuenta) p.set('cuenta', cuenta)
    try {
      const res = await fetch(`/api/correo/evaluar?${p.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setAviso(`${json.modelo}: ${json.evaluados} evaluados · ${json.fallidos} fallidos${json.pendientes ? ` · ${json.pendientes} pendientes (vuelve a correr)` : ''} · ${json.tokensIn + json.tokensOut} tokens · ${Math.round(json.ms / 1000)} s`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCorriendo(false)
    }
  }

  async function veredicto(c: Correo, v: { urgencia: CorreoUrgencia; tipo: CorreoTipo }) {
    setError(null)
    const res = await fetch('/api/correo/veredictos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo_id: c.id, ...v }) })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      setError(json?.error ?? `HTTP ${res.status}`)
      return
    }
    setTabla((t) => t ? { ...t, veredictos: [...t.veredictos.filter((x) => x.correo_id !== c.id), { id: c.id, correo_id: c.id, urgencia: v.urgencia, tipo: v.tipo, created_at: new Date().toISOString() }] } : t)
  }

  const porCorreo = useMemo(() => {
    const m = new Map<string, Map<string, CorreoEvaluacion>>()
    for (const e of tabla?.evaluaciones ?? []) {
      if (!m.has(e.correo_id)) m.set(e.correo_id, new Map())
      m.get(e.correo_id)!.set(e.modelo, e)
    }
    return m
  }, [tabla])
  const veredictos = useMemo(() => new Map((tabla?.veredictos ?? []).map((v) => [v.correo_id, v])), [tabla])
  const filas = useMemo(() => (tabla?.correos ?? []).filter((c) => !soloSinVeredicto || !veredictos.has(c.id)), [tabla, soloSinVeredicto, veredictos])

  const sel = 'bg-[#111111] border border-[#2a2a2a] rounded-md px-2 py-1 text-xs text-[#e8e8e8]'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/correo" className="text-sm text-[#888888] hover:text-[#e8e8e8]">← Correo</Link>
          <h1 className="text-lg font-semibold text-[#e8e8e8]">Evaluar modelos</h1>
        </div>
        <span className="text-xs text-[#888888]">en producción: <code className="text-[#e8e8e8]">{tabla?.modelo_actual ?? '—'}</code></span>
      </div>
      <p className="text-sm text-[#888888]">
        Reclasifica los correos de estos días con otro modelo sin cambiar nada, y marca en cada fila qué debió ser. El % de acierto por modelo
        se calcula solo sobre las filas con veredicto. Modelo: <code>openai:gpt-5-mini</code>, <code>anthropic:claude-haiku-5-5</code> o{' '}
        <code>compatible:&lt;modelo JEV&gt;</code> (usa LLM_CORREO_BASE_URL / LLM_CORREO_API_KEY).
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={sel}>
          <option value="">Todas las cuentas</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className={sel}>
          {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} días</option>)}
        </select>
        <input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="openai:gpt-5-mini" className={`${sel} w-56`} />
        <button onClick={correr} disabled={corriendo || !modelo.trim()} className="px-3 py-1 text-xs font-medium rounded-md bg-[#7F77DD]/15 text-[#7F77DD] hover:bg-[#7F77DD]/25 disabled:opacity-50">
          {corriendo ? 'Evaluando…' : 'Evaluar con este modelo'}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-[#888888] cursor-pointer">
          <input type="checkbox" checked={soloSinVeredicto} onChange={(e) => setSoloSinVeredicto(e.target.checked)} className="accent-[#7F77DD]" /> solo sin veredicto
        </label>
      </div>

      {aviso && <p className="text-xs text-emerald-400">{aviso}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {tabla && tabla.aciertos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tabla.aciertos.map((a) => (
            <div key={a.modelo} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs">
              <div className="font-semibold text-[#e8e8e8]">{a.modelo === 'produccion' ? `producción (${tabla.modelo_actual ?? '?'})` : a.modelo}</div>
              <div className="text-[#888888]">
                urgencia {pct(a.urgencia_ok, a.comparados)} · tipo {pct(a.tipo_ok, a.comparados)} · ambos <span className="text-[#e8e8e8]">{pct(a.ambos_ok, a.comparados)}</span> · {a.comparados} con veredicto
              </div>
            </div>
          ))}
        </div>
      )}

      {!tabla ? (
        <p className="text-sm text-[#555555]">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="text-sm text-[#555555] text-center py-10">Sin correos en esta ventana.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[#888888] border-b border-[#2a2a2a]">
                <th className="py-2 pr-3">Correo</th>
                <th className="py-2 pr-3">producción</th>
                {tabla.modelos.map((m) => <th key={m} className="py-2 pr-3">{m}</th>)}
                <th className="py-2">Veredicto</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => {
                const v = veredictos.get(c.id)
                const evs = porCorreo.get(c.id)
                const celda = (u: CorreoUrgencia | null, t: CorreoTipo | null, razon?: string | null) => (
                  <span title={razon ?? ''} className={v && (u !== v.urgencia || t !== v.tipo) ? 'text-amber-400' : v ? 'text-emerald-400' : 'text-[#e8e8e8]'}>
                    {u ? `${CORREO_URGENCIA_EMOJI[u]} ${u}` : '—'} · {t ? CORREO_TIPO_LABELS[t] : '—'}
                  </span>
                )
                return (
                  <tr key={c.id} className="border-b border-[#2a2a2a] align-top">
                    <td className="py-2 pr-3 max-w-xs">
                      <div className="text-[#e8e8e8] font-medium truncate">{c.de_nombre || c.de_email}</div>
                      <div className="text-[#888888] truncate" title={c.asunto ?? ''}>{c.asunto}</div>
                      {c.resumen && <div className="text-[#555555] truncate" title={c.resumen}>{c.resumen}</div>}
                    </td>
                    <td className="py-2 pr-3">{celda(c.urgencia, c.tipo, c.razon)}</td>
                    {tabla.modelos.map((m) => {
                      const e = evs?.get(m)
                      return <td key={m} className="py-2 pr-3">{e ? celda(e.urgencia, e.tipo, e.razon) : <span className="text-[#555555]">—</span>}</td>
                    })}
                    <td className="py-2">
                      {v ? (
                        <span className="text-[#e8e8e8]">{CORREO_URGENCIA_EMOJI[v.urgencia]} {v.urgencia} · {CORREO_TIPO_LABELS[v.tipo]}</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1">
                          {c.urgencia && c.tipo && (
                            <button onClick={() => veredicto(c, { urgencia: c.urgencia!, tipo: c.tipo! })} className="px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/70">✓ correcto</button>
                          )}
                          <span className="text-[#555555]">debió ser:</span>
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              const [u, t] = e.target.value.split('|')
                              if (u && t) veredicto(c, { urgencia: u as CorreoUrgencia, tipo: t as CorreoTipo })
                            }}
                            className={sel}
                          >
                            <option value="">urgencia · tipo</option>
                            {CORREO_URGENCIA_ORDER.flatMap((u) => TIPOS.map((t) => (
                              <option key={`${u}|${t}`} value={`${u}|${t}`}>{u} · {CORREO_TIPO_LABELS[t]}</option>
                            )))}
                          </select>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
