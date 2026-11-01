'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Company, PagoRecurrente } from '@/types'

interface Props {
  companies: Company[]
}

/**
 * Settings → Pagos recurrentes (fase 5-C): one tab per company, an editable
 * table and the Calendar button. Everything goes through /api/pagos so the
 * recurring event follows every change. Payments are not tasks.
 */
export default function PagosRecurrentes({ companies }: Props) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [pagos, setPagos] = useState<PagoRecurrente[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // New row
  const [nombre, setNombre] = useState('')
  const [dia, setDia] = useState('')
  const [monto, setMonto] = useState('')
  const [saving, setSaving] = useState(false)
  // Inline edit
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ nombre: '', dia: '', monto: '' })
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId && companies[0]) setCompanyId(companies[0].id)
  }, [companies, companyId])

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pagos?company=${encodeURIComponent(companyId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setPagos(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

  async function llamar(method: string, body: unknown): Promise<boolean> {
    setError(null)
    setAviso(null)
    const res = await fetch('/api/pagos', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      setError(json?.error ?? `HTTP ${res.status}`)
      return false
    }
    if (json?.mensaje) setAviso(String(json.mensaje))
    await load()
    return true
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault()
    const d = Number(dia)
    if (!nombre.trim() || !Number.isInteger(d) || d < 1 || d > 31) {
      setError('Nombre y día (1–31) son obligatorios.')
      return
    }
    setSaving(true)
    const ok = await llamar('POST', { company_id: companyId, nombre, dia_del_mes: d, monto_texto: monto || null })
    setSaving(false)
    if (ok) { setNombre(''); setDia(''); setMonto('') }
  }

  function startEdit(p: PagoRecurrente) {
    setEditId(p.id)
    setEdit({ nombre: p.nombre, dia: String(p.dia_del_mes), monto: p.monto_texto ?? '' })
  }

  async function saveEdit(id: string) {
    const d = Number(edit.dia)
    if (!edit.nombre.trim() || !Number.isInteger(d) || d < 1 || d > 31) {
      setError('Nombre y día (1–31) son obligatorios.')
      return
    }
    setBusy(id)
    const ok = await llamar('PATCH', { id, nombre: edit.nombre, dia_del_mes: d, monto_texto: edit.monto || null })
    setBusy(null)
    if (ok) setEditId(null)
  }

  async function calendar(id: string) {
    setBusy(id)
    await llamar('PATCH', { id, calendar: true })
    setBusy(null)
  }

  async function quitar(id: string) {
    if (!confirm('¿Quitar este pago y su evento de Calendar?')) return
    setBusy(id)
    await llamar('DELETE', { id })
    setBusy(null)
  }

  const field = 'bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1 text-sm text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD]'

  if (companies.length === 0) return <p className="text-sm text-[#555555]">Crea una empresa primero.</p>

  return (
    <div className="space-y-3">
      {/* Company tabs */}
      <div className="flex flex-wrap gap-1">
        {companies.map((c) => (
          <button
            key={c.id}
            onClick={() => setCompanyId(c.id)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              c.id === companyId ? 'bg-[#7F77DD]/20 text-[#7F77DD] font-medium' : 'text-[#888888] hover:text-[#e8e8e8] hover:bg-[#2a2a2a]'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-[#555555] border-b border-[#2a2a2a]">
              <th className="text-left px-4 py-2 font-medium">Pago</th>
              <th className="text-left px-2 py-2 font-medium">Día</th>
              <th className="text-left px-2 py-2 font-medium">Monto</th>
              <th className="text-left px-2 py-2 font-medium">Calendar</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2a2a]">
            {loading && pagos.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-3 text-[#555555]">Cargando…</td></tr>
            )}
            {!loading && pagos.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-3 text-[#555555]">Sin pagos recurrentes. Agrega uno abajo, o por el bot: &quot;pago IM Vercel el 15 de cada mes&quot;.</td></tr>
            )}
            {pagos.map((p) => (
              <tr key={p.id} className="align-middle">
                {editId === p.id ? (
                  <>
                    <td className="px-4 py-2"><input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} className={`${field} w-full`} /></td>
                    <td className="px-2 py-2"><input value={edit.dia} onChange={(e) => setEdit({ ...edit, dia: e.target.value })} type="number" min={1} max={31} className={`${field} w-16`} /></td>
                    <td className="px-2 py-2"><input value={edit.monto} onChange={(e) => setEdit({ ...edit, monto: e.target.value })} placeholder="$20" className={`${field} w-24`} /></td>
                    <td className="px-2 py-2 text-xs text-[#888888]">{p.gcal_event_id ? '📅 sí' : '—'}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <button onClick={() => saveEdit(p.id)} disabled={busy === p.id} className="text-xs text-[#7F77DD] hover:text-[#9b95e8] mr-2 disabled:opacity-40">Guardar</button>
                      <button onClick={() => setEditId(null)} className="text-xs text-[#888888] hover:text-[#e8e8e8]">Cancelar</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2 text-[#e8e8e8]">💳 {p.nombre}</td>
                    <td className="px-2 py-2 text-[#888888]">el {p.dia_del_mes}</td>
                    <td className="px-2 py-2 text-[#888888]">{p.monto_texto ?? '—'}</td>
                    <td className="px-2 py-2 text-xs">
                      {p.gcal_event_id ? (
                        <span className="text-emerald-400">📅 en Calendar</span>
                      ) : (
                        <button onClick={() => calendar(p.id)} disabled={busy === p.id} className="text-[#7F77DD] hover:text-[#9b95e8] disabled:opacity-40">
                          📅 Agregar a Calendar
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(p)} className="text-xs text-[#888888] hover:text-[#e8e8e8] mr-2">Edit</button>
                      <button onClick={() => quitar(p.id)} disabled={busy === p.id} className="text-xs text-[#888888] hover:text-red-400 disabled:opacity-40">Quitar</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={agregar} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-4 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] text-[#555555] mb-1">Pago</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Vercel" className={`${field} w-full`} />
        </div>
        <div>
          <label className="block text-[11px] text-[#555555] mb-1">Día del mes</label>
          <input value={dia} onChange={(e) => setDia(e.target.value)} type="number" min={1} max={31} placeholder="15" className={`${field} w-20`} />
        </div>
        <div>
          <label className="block text-[11px] text-[#555555] mb-1">Monto (texto)</label>
          <input value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$20 USD" className={`${field} w-28`} />
        </div>
        <button type="submit" disabled={saving} className="px-4 py-1.5 bg-[#7F77DD] text-white text-sm rounded hover:bg-[#6b62d0] disabled:opacity-40 transition-colors">
          {saving ? 'Guardando…' : 'Agregar'}
        </button>
      </form>

      {aviso && <p className="text-xs text-[#888888] whitespace-pre-wrap">{aviso}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-[11px] text-[#555555]">
        Cada pago crea un evento mensual en Calendar (9:00–9:30 am) con avisos 7 días antes, 3 días antes y ese día. Los pagos no son tareas: no salen en Hoy.
      </p>
    </div>
  )
}
