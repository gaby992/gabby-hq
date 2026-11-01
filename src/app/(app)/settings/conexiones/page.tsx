'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { ConexionGoogle } from '@/types'
import { relativeDaysEs } from '@/lib/dates'

/**
 * Settings → Conexiones (fase 5). One card per external account. The token
 * never reaches the browser: this page only sees email + dates.
 */
export default function ConexionesPage() {
  const [conexiones, setConexiones] = useState<ConexionGoogle[]>([])
  const [configurado, setConfigurado] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // ?conectado=email / ?error=… come from the OAuth callback. Read on the
  // client only, so the page can still be prerendered.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('error')) setError(q.get('error'))
    if (q.get('conectado')) setAviso(`Conectado: ${q.get('conectado')}`)
  }, [])
  const [confirmando, setConfirmando] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/google/conexiones')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setConexiones(json.conexiones ?? [])
      setConfigurado(json.configurado !== false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function desconectar(id: string) {
    setConfirmando(null)
    const res = await fetch('/api/google/conexiones', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      setError(json?.error ?? `HTTP ${res.status}`)
      return
    }
    setAviso('Cuenta desconectada')
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-[#888888] hover:text-[#e8e8e8] transition-colors">← Settings</Link>
        <h1 className="text-lg font-semibold text-[#e8e8e8]">Conexiones</h1>
      </div>
      <p className="text-sm text-[#888888]">
        Lo que es de la app (tokens del bot, Supabase, OpenAI, llaves de Google) vive en Vercel. Lo que es de
        una cuenta (su acceso a Google) vive aquí, cifrado. Así se agregan cuentas sin tocar Vercel.
      </p>

      {aviso && <p className="text-sm text-emerald-400">{aviso}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <section className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#e8e8e8]">Google</h2>
            <p className="text-xs text-[#888888] mt-0.5">Calendar (eventos de tareas con fecha y hora) · Gmail (fase 6)</p>
          </div>
          {configurado ? (
            <a
              href="/api/google/oauth/start"
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-[#7F77DD]/15 text-[#7F77DD] hover:bg-[#7F77DD]/25 transition-colors"
            >
              {conexiones.length > 0 ? 'Conectar otra cuenta' : 'Conectar'}
            </a>
          ) : (
            <span className="text-xs text-amber-400">Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / APP_ENCRYPTION_KEY en Vercel</span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-[#555555]">Cargando…</p>
        ) : conexiones.length === 0 ? (
          <p className="text-sm text-[#555555]">Ninguna cuenta conectada.</p>
        ) : (
          <ul className="divide-y divide-[#2a2a2a]">
            {conexiones.map((c) => (
              <li key={c.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="text-emerald-400 font-medium">Conectado ✓</span>
                  <span className="text-[#2a2a2a] mx-2">·</span>
                  <span className="text-[#e8e8e8]">{c.email}</span>
                  <span className="text-[#2a2a2a] mx-2">·</span>
                  <span className="text-[#888888]">
                    conectada {relativeDaysEs(c.conectado_en)}
                    {c.ultimo_uso ? ` · usada ${relativeDaysEs(c.ultimo_uso)}` : ' · sin usar todavía'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <a href="/api/google/oauth/start" className="px-2.5 py-1 rounded-md text-[#888888] hover:text-[#e8e8e8] hover:bg-[#2a2a2a] transition-colors">
                    Reconectar
                  </a>
                  {confirmando === c.id ? (
                    <>
                      <button onClick={() => desconectar(c.id)} className="px-2.5 py-1 rounded-md bg-red-950/60 text-red-400 hover:bg-red-950 transition-colors">
                        Sí, desconectar
                      </button>
                      <button onClick={() => setConfirmando(null)} className="px-2.5 py-1 rounded-md text-[#888888] hover:text-[#e8e8e8] transition-colors">
                        No
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmando(c.id)} className="px-2.5 py-1 rounded-md text-[#888888] hover:text-red-400 hover:bg-[#2a2a2a] transition-colors">
                      Desconectar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-[#555555]">
          El asistente usa la cuenta activa más reciente. Los eventos van a su calendario principal.
        </p>
      </section>
    </div>
  )
}
