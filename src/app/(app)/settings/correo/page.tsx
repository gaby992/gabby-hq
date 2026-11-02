'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { REGLA_CORREO_ACCION_LABELS, type ConexionGoogle, type CuentaCorreo, type ReglaCorreo, type ReglaCorreoAccion } from '@/types'

/**
 * Settings → Correo (fase 6-B): one card per mail account with its VIP and
 * noise lists (one email or domain per line), the rules, the chat and hours
 * of the alerts, and "Importar de n8n" (paste the JSON). Nothing here
 * touches Gmail; it only decides how the classifier and the alerts behave.
 */
export default function CorreoSettingsPage() {
  const [cuentas, setCuentas] = useState<CuentaCorreo[]>([])
  const [sinCuenta, setSinCuenta] = useState<ConexionGoogle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/correo/cuentas')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setCuentas(json.cuentas ?? [])
      setSinCuenta(json.sin_cuenta ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function crear(c: ConexionGoogle) {
    setError(null)
    const res = await fetch('/api/correo/cuentas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conexion_id: c.id, nombre: `IM ${c.duena ?? c.email.split('@')[0]}`, duena: c.duena ?? null }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      setError(json?.error ?? `HTTP ${res.status}`)
      return
    }
    load()
  }

  async function leerAhora() {
    setLeyendo(true)
    setAviso(null)
    setError(null)
    try {
      const res = await fetch('/api/correo/ingesta?max=20')
      const json = await res.json()
      if (!res.ok && !json?.cuentas) throw new Error(json?.error ?? `HTTP ${res.status}`)
      const partes = (json.cuentas as { cuenta: string; nuevos: number; alertados: number; respondidos: number; error?: string }[]).map(
        (x) => `${x.cuenta}: ${x.error ? `error (${x.error})` : `${x.nuevos} nuevos · ${x.alertados} alertas · ${x.respondidos} respondidos`}`
      )
      setAviso(partes.length > 0 ? partes.join(' · ') : 'No hay cuentas activas con 📧 Correo encendido.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLeyendo(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/settings" className="text-sm text-[#888888] hover:text-[#e8e8e8] transition-colors">← Settings</Link>
          <h1 className="text-lg font-semibold text-[#e8e8e8]">Correo</h1>
        </div>
        <button
          onClick={leerAhora}
          disabled={leyendo}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-[#7F77DD]/15 text-[#7F77DD] hover:bg-[#7F77DD]/25 transition-colors disabled:opacity-50"
        >
          {leyendo ? 'Leyendo…' : '📥 Leer ahora'}
        </button>
      </div>
      <p className="text-sm text-[#888888]">
        Cada 15 minutos el asistente lee el Gmail de las cuentas con 📧 Correo encendido en{' '}
        <Link href="/settings/conexiones" className="text-[#7F77DD] hover:underline">Conexiones</Link>, clasifica cada correo
        (primero reglas, luego el modelo) y avisa por Telegram solo lo que importa: urgencia alta, VIP, necesita respuesta o pide una tarea.
      </p>

      {aviso && <p className="text-sm text-emerald-400">{aviso}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-[#555555]">Cargando…</p>
      ) : (
        <>
          {cuentas.map((c) => (
            <TarjetaCuenta key={c.id} cuenta={c} onSaved={load} onError={setError} onAviso={setAviso} />
          ))}
          {sinCuenta.length > 0 && (
            <section className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-5 space-y-2">
              <h2 className="text-sm font-semibold text-[#888888] uppercase tracking-wider">Cuentas conectadas sin configuración de correo</h2>
              {sinCuenta.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[#e8e8e8]">{c.email}{c.duena ? ` · ${c.duena}` : ''}</span>
                  <button onClick={() => crear(c)} className="px-2.5 py-1 text-xs rounded-md bg-[#2a2a2a] text-[#e8e8e8] hover:bg-[#333333]">Crear configuración</button>
                </div>
              ))}
            </section>
          )}
          {cuentas.length === 0 && sinCuenta.length === 0 && (
            <p className="text-sm text-[#555555]">Ninguna cuenta de Google conectada. Conéctala en Settings → Conexiones.</p>
          )}
        </>
      )}
    </div>
  )
}

const ACCIONES = Object.keys(REGLA_CORREO_ACCION_LABELS) as ReglaCorreoAccion[]

function TarjetaCuenta({ cuenta, onSaved, onError, onAviso }: { cuenta: CuentaCorreo; onSaved: () => void; onError: (e: string | null) => void; onAviso: (a: string | null) => void }) {
  const [nombre, setNombre] = useState(cuenta.nombre)
  const [duena, setDuena] = useState(cuenta.duena ?? '')
  const [activa, setActiva] = useState(cuenta.activa)
  const [alertar, setAlertar] = useState(cuenta.alertar)
  const [vip, setVip] = useState(cuenta.vip.join('\n'))
  const [ruido, setRuido] = useState(cuenta.ruido.join('\n'))
  const [reglas, setReglas] = useState<ReglaCorreo[]>(cuenta.reglas)
  const [chat, setChat] = useState(cuenta.chat_id_alertas ? String(cuenta.chat_id_alertas) : '')
  const [horario, setHorario] = useState(cuenta.horario_alertas)
  const [json, setJson] = useState('')
  const [importando, setImportando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nuevaRegla, setNuevaRegla] = useState<ReglaCorreo>({ match: '', accion: 'vip', alerta: false })

  useEffect(() => {
    setVip(cuenta.vip.join('\n'))
    setRuido(cuenta.ruido.join('\n'))
    setReglas(cuenta.reglas)
  }, [cuenta])

  async function guardar(extra: Record<string, unknown> = {}) {
    setSaving(true)
    onError(null)
    try {
      const res = await fetch('/api/correo/cuentas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cuenta.id, nombre, duena, activa, alertar, vip, ruido, reglas, chat_id_alertas: chat.trim() || null, horario_alertas: horario, ...extra }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      onAviso(`Guardado: ${nombre}`)
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function importar() {
    if (!json.trim()) return
    setImportando(true)
    onError(null)
    try {
      const res = await fetch('/api/correo/cuentas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cuenta.id, json }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      onAviso(`Importado en ${cuenta.nombre}: ${j.importado.vip} VIP · ${j.importado.ruido} ruido · ${j.importado.reglas} reglas${j.importado.ignoradas ? ` · ${j.importado.ignoradas} ignoradas` : ''}`)
      setJson('')
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportando(false)
    }
  }

  function agregarRegla() {
    const match = nuevaRegla.match.trim().toLowerCase()
    if (!match) return
    setReglas((r) => [...r, { ...nuevaRegla, match }])
    setNuevaRegla({ match: '', accion: 'vip', alerta: false })
  }

  const inputCls = 'bg-[#111111] border border-[#2a2a2a] rounded-md px-2.5 py-1.5 text-sm text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD]'

  return (
    <section className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={`${inputCls} w-40 font-semibold`} />
          <select value={duena} onChange={(e) => setDuena(e.target.value)} className={inputCls}>
            <option value="">¿De quién?</option>
            <option value="Gabby">Gabby</option>
            <option value="Chelsea">Chelsea</option>
          </select>
          <span className="text-xs text-[#888888]">{cuenta.conexion?.email ?? 'sin conexión'}</span>
          {!cuenta.conexion?.usa_gmail && <span className="text-xs text-amber-400">📧 Correo está apagado en Conexiones</span>}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-[#888888] cursor-pointer">
            <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} className="accent-[#7F77DD]" /> Activa
          </label>
          <label className="flex items-center gap-1.5 text-[#888888] cursor-pointer">
            <input type="checkbox" checked={alertar} onChange={(e) => setAlertar(e.target.checked)} className="accent-[#7F77DD]" /> Alertar por Telegram
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-[#888888] uppercase tracking-wider">VIP (alta + alerta)</span>
          <textarea value={vip} onChange={(e) => setVip(e.target.value)} rows={6} placeholder={'un email o dominio por línea\ntottatl.com\nm@blessoproperties.com'} className={`${inputCls} w-full font-mono text-xs`} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-[#888888] uppercase tracking-wider">Ruido (se registra, sin IA ni alerta)</span>
          <textarea value={ruido} onChange={(e) => setRuido(e.target.value)} rows={6} placeholder={'un email o dominio por línea\nbankofamerica.com'} className={`${inputCls} w-full font-mono text-xs`} />
        </label>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-semibold text-[#888888] uppercase tracking-wider">Reglas</span>
        {reglas.length === 0 && <p className="text-xs text-[#555555]">Sin reglas. Las de n8n se importan abajo; las de VIP y ruido ya están en las listas.</p>}
        {reglas.map((r, i) => (
          <div key={`${r.match}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
            <code className="text-[#e8e8e8] bg-[#111111] px-2 py-1 rounded">{r.match}</code>
            <span className="text-[#888888]">→ {REGLA_CORREO_ACCION_LABELS[r.accion]}{r.alerta ? ' · alerta' : ''}</span>
            <button onClick={() => setReglas((rs) => rs.filter((_, k) => k !== i))} className="text-[#555555] hover:text-red-400">quitar</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <input value={nuevaRegla.match} onChange={(e) => setNuevaRegla({ ...nuevaRegla, match: e.target.value })} placeholder="email, dominio o texto del asunto" className={`${inputCls} w-64`} />
          <select value={nuevaRegla.accion} onChange={(e) => setNuevaRegla({ ...nuevaRegla, accion: e.target.value as ReglaCorreoAccion })} className={inputCls}>
            {ACCIONES.map((a) => <option key={a} value={a}>{REGLA_CORREO_ACCION_LABELS[a]}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-[#888888]">
            <input type="checkbox" checked={nuevaRegla.alerta === true} onChange={(e) => setNuevaRegla({ ...nuevaRegla, alerta: e.target.checked })} className="accent-[#7F77DD]" /> alerta
          </label>
          <button onClick={agregarRegla} className="px-2.5 py-1 text-xs rounded-md bg-[#2a2a2a] text-[#e8e8e8] hover:bg-[#333333]">Agregar</button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-[#888888] uppercase tracking-wider">Chat de alertas (Telegram)</span>
          <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="vacío = los chats del bot (ALLOWED_CHAT_IDS)" className={`${inputCls} w-full`} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-[#888888] uppercase tracking-wider">Horario de alertas (Cancún)</span>
          <input value={horario} onChange={(e) => setHorario(e.target.value)} placeholder="07:00-21:00" className={`${inputCls} w-full`} />
          <span className="text-[11px] text-[#555555]">Fuera del horario no suena nada: esos correos salen en la lista de las 8.</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => guardar()} disabled={saving} className="px-3 py-1.5 text-sm font-medium rounded-md bg-[#7F77DD] text-white hover:bg-[#6c64d0] transition-colors disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={() => guardar({ reiniciar_cursor: true })} disabled={saving} title="La próxima lectura trae los últimos 3 días otra vez (no duplica)" className="px-3 py-1.5 text-xs rounded-md text-[#888888] hover:text-[#e8e8e8] hover:bg-[#2a2a2a]">
          Reiniciar cursor de Gmail
        </button>
        <span className="text-[11px] text-[#555555]">cursor: {cuenta.ultimo_history_id ?? 'sin leer todavía'}</span>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-[#888888] hover:text-[#e8e8e8]">Importar de n8n (pegar JSON)</summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-[#555555]">
            Exporta las filas de <code>im_reglas</code> (o un objeto {'{ vip: [...], ruido: [...], reglas: [...] }'}) y pégalo aquí. Se suma a lo que ya hay;
            nada se borra. auto_chelsea → Para Chelsea · auto_gabby → Gabby · auto_archivar → archivar · solo_registrar → registrar; remitentes con alerta → VIP.
          </p>
          <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={6} placeholder='[{"match_tipo":"dominio","match_valor":"tottatl.com","accion":"auto_gabby","alerta":true}]' className={`${inputCls} w-full font-mono text-xs`} />
          <button onClick={importar} disabled={importando || !json.trim()} className="px-3 py-1.5 text-sm rounded-md bg-[#2a2a2a] text-[#e8e8e8] hover:bg-[#333333] disabled:opacity-50">
            {importando ? 'Importando…' : 'Importar'}
          </button>
        </div>
      </details>
    </section>
  )
}
