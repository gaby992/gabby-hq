'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import CopyButton from '@/components/CopyButton'
import {
  CORREO_ACCION_LABELS,
  CORREO_ESTADO_LABELS,
  CORREO_TIPO_LABELS,
  CORREO_URGENCIA_EMOJI,
  CORREO_URGENCIA_LABELS,
  CORREO_URGENCIA_ORDER,
  type Correo,
  type CorreoAccion,
  type CorreoEstado,
  type CorreoTipo,
  type CorreoUrgencia,
  type CuentaCorreo,
} from '@/types'

const TZ = 'America/Cancun'

function cuando(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso))
}

/** "7 nov" + how old it is, big enough to clean the inbox by date. */
function fechaCorta(iso: string | null): { dia: string; hace: string } | null {
  if (!iso) return null
  const d = new Date(iso)
  const dia = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d)
  const ymd = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(x)
  const dias = Math.round((Date.parse(ymd(new Date())) - Date.parse(ymd(d))) / 86_400_000)
  const hace = dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`
  return { dia, hace }
}

function todayLabel(): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date())
}

function remitente(c: Correo): string {
  return c.de_nombre || c.de_email || '(sin remitente)'
}

const ESTADOS: (CorreoEstado | 'all')[] = ['nuevo', 'para_chelsea', 'lo_hago_yo', 'tarea', 'respondido', 'archivado', 'registrado', 'all']
const TIPOS = Object.keys(CORREO_TIPO_LABELS) as CorreoTipo[]
const ACCIONES: CorreoAccion[] = ['chelsea', 'yo', 'tarea', 'archivar']
const ICONO: Record<CorreoAccion, string> = { chelsea: '📨', yo: '🙋', tarea: '➕', archivar: '🗄' }

/**
 * /correo (fase 6-G): the mail feed with the same four decisions as the
 * Telegram buttons, filters by account / state / urgency / type, and
 * "Copy pending" — Chelsea's list in the English format she already gets.
 */
export default function CorreoPage() {
  const [items, setItems] = useState<Correo[]>([])
  const [cuentas, setCuentas] = useState<CuentaCorreo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState<CorreoEstado | 'all'>('nuevo')
  const [cuenta, setCuenta] = useState('')
  const [urgencia, setUrgencia] = useState<CorreoUrgencia | ''>('')
  const [tipo, setTipo] = useState<CorreoTipo | ''>('')
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState<Set<string>>(new Set())
  const [cuerpos, setCuerpos] = useState<Record<string, string>>({})
  const [mensaje, setMensaje] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/correo/cuentas').then((r) => r.json()).then((j) => setCuentas(j?.cuentas ?? [])).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams()
    p.set('estado', estado)
    if (cuenta) p.set('cuenta', cuenta)
    if (urgencia) p.set('urgencia', urgencia)
    if (tipo) p.set('tipo', tipo)
    if (q.trim()) p.set('q', q.trim())
    try {
      const res = await fetch(`/api/correo?${p.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setItems(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [estado, cuenta, urgencia, tipo, q])

  useEffect(() => { load() }, [load])

  async function decidir(id: string, accion: CorreoAccion) {
    setMensaje(null)
    const prev = items
    setItems((is) => is.filter((i) => i.id !== id || estado === 'all'))
    const res = await fetch('/api/correo', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id], accion }) })
    const json = await res.json().catch(() => null)
    if (!res.ok || json?.[0]?.error) {
      setItems(prev)
      setError(json?.[0]?.error ?? json?.error ?? `HTTP ${res.status}`)
      return
    }
    setMensaje(json[0]?.texto ?? 'Hecho')
    if (estado === 'all') load()
  }

  async function toggle(id: string) {
    setAbierto((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (!cuerpos[id]) {
      const res = await fetch(`/api/correo?id=${id}`)
      const json = await res.json().catch(() => null)
      if (res.ok && json) setCuerpos((c) => ({ ...c, [id]: json.cuerpo_texto ?? '' }))
    }
  }

  const nombreCuenta = useMemo(() => new Map(cuentas.map((c) => [c.id, c.nombre])), [cuentas])

  // Chelsea's pending list, same English format as /chelsea.
  const paraChelsea = useMemo(() => items.filter((i) => i.estado === 'para_chelsea'), [items])
  function buildPendingText(): string {
    const lines: string[] = [`CHELSEA'S PENDING — ${todayLabel()}`]
    const headers: Record<CorreoUrgencia, string> = { alta: 'HIGH', media: 'MEDIUM', baja: 'LOW' }
    const emoji: Record<CorreoUrgencia, string> = { alta: '🔴', media: '🟡', baja: '🟢' }
    for (const u of CORREO_URGENCIA_ORDER) {
      const bucket = paraChelsea.filter((i) => i.urgencia === u)
      if (bucket.length === 0) continue
      lines.push('', `${emoji[u]} ${headers[u]}:`)
      for (const i of bucket) lines.push(`- ${remitente(i)} — ${i.asunto || '(no subject)'}${i.resumen ? `: ${i.resumen}` : ''}`)
    }
    return lines.join('\n')
  }

  const sel = 'bg-[#111111] border border-[#2a2a2a] rounded-md px-2 py-1 text-xs text-[#e8e8e8]'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#e8e8e8]">Correo</h1>
          <p className="text-sm text-[#888888] mt-0.5">{loading ? 'Cargando…' : `${items.length} ${items.length === 1 ? 'correo' : 'correos'}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/correo/evaluar" className="px-2.5 py-1 text-xs rounded-md text-[#888888] hover:text-[#e8e8e8] hover:bg-[#2a2a2a]">Evaluar modelos →</Link>
          <Link href="/settings/correo" className="px-2.5 py-1 text-xs rounded-md text-[#888888] hover:text-[#e8e8e8] hover:bg-[#2a2a2a]">Configurar →</Link>
          {(estado === 'para_chelsea' || estado === 'all') && paraChelsea.length > 0 && <CopyButton text={buildPendingText} label="Copy pending (Chelsea)" />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={estado} onChange={(e) => setEstado(e.target.value as CorreoEstado | 'all')} className={sel}>
          {ESTADOS.map((e) => <option key={e} value={e}>{e === 'all' ? 'Todos (sin silencio)' : CORREO_ESTADO_LABELS[e]}</option>)}
        </select>
        <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={sel}>
          <option value="">Todas las cuentas</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={urgencia} onChange={(e) => setUrgencia(e.target.value as CorreoUrgencia | '')} className={sel}>
          <option value="">Toda urgencia</option>
          {CORREO_URGENCIA_ORDER.map((u) => <option key={u} value={u}>{CORREO_URGENCIA_EMOJI[u]} {CORREO_URGENCIA_LABELS[u]}</option>)}
        </select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as CorreoTipo | '')} className={sel}>
          <option value="">Todo tipo</option>
          {TIPOS.map((t) => <option key={t} value={t}>{CORREO_TIPO_LABELS[t]}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar remitente o asunto" className={`${sel} w-48`} />
      </div>

      {mensaje && <p className="text-xs text-emerald-400">{mensaje}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {!loading && items.length === 0 && <div className="text-sm text-[#888888] text-center py-12">Nada aquí ✨</div>}

      <div className="space-y-1.5">
        {items.map((c) => {
          const open = abierto.has(c.id)
          const u = c.urgencia ?? 'media'
          const f = fechaCorta(c.recibido_en)
          return (
            <div key={c.id} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-3 py-2.5">
              <div className="flex items-start gap-3">
                <span title={CORREO_URGENCIA_LABELS[u]} className="mt-0.5">{CORREO_URGENCIA_EMOJI[u]}</span>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggle(c.id)}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {f && (
                      <span className="text-xs font-medium text-[#c9a227] bg-[#2a2410] rounded px-1.5 py-0.5 whitespace-nowrap" title={cuando(c.recibido_en)}>
                        {f.dia} · {f.hace}
                      </span>
                    )}
                    <span className="text-sm font-medium text-[#e8e8e8]">{remitente(c)}</span>
                    <span className="text-sm text-[#888888] truncate">{c.asunto || '(sin asunto)'}</span>
                  </div>
                  {c.resumen && <p className={`text-xs text-[#888888] mt-0.5 ${open ? '' : 'truncate'}`}>{c.resumen}</p>}
                  <p className="text-[11px] text-[#555555] mt-0.5">
                    {nombreCuenta.get(c.cuenta_id) ?? 'cuenta'} · {c.tipo ? CORREO_TIPO_LABELS[c.tipo] : '—'}{c.categoria ? ` · ${c.categoria}` : ''} · {cuando(c.recibido_en)}
                    {c.estado !== 'nuevo' ? ` · ${CORREO_ESTADO_LABELS[c.estado]}` : ''}{c.alertado ? ' · 🔔' : ''}
                    {typeof c.confianza === 'number' ? ` · ${Math.round(c.confianza * 100)}%` : ''}
                  </p>
                  {open && (
                    <div className="mt-2 space-y-1 text-xs">
                      {c.razon && <p className="text-[#888888] italic">{c.razon}</p>}
                      <p className="text-[#555555]">{c.de_email}</p>
                      <pre className="whitespace-pre-wrap font-sans text-[#aaaaaa] bg-[#111111] rounded p-2 max-h-72 overflow-auto">{cuerpos[c.id] ?? 'Cargando…'}</pre>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 justify-end">
                  {ACCIONES.map((a) => (
                    <button
                      key={a}
                      onClick={() => decidir(c.id, a)}
                      title={CORREO_ACCION_LABELS[a]}
                      className="px-2 py-1 text-xs rounded bg-[#2a2a2a] hover:bg-[#333333] text-[#888888] hover:text-[#e8e8e8] transition-colors"
                    >
                      {ICONO[a]} <span className="hidden sm:inline">{CORREO_ACCION_LABELS[a]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
