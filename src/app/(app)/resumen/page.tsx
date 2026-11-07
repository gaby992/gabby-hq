'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { COMPANY_COLORS, CORREO_ACCION_LABELS, CORREO_URGENCIA_EMOJI, type CorreoAccion } from '@/types'
import type { Resumen, ItemAgenda, Prioridad, CorreoResumen } from '@/lib/asistente/resumen'
import { relativeDaysEs } from '@/lib/dates'
import ChatPanel from '@/components/ChatPanel'

// Fase 12: the Dashboard de vida. One page that gathers the day — agenda by
// hour (tasks, payments, the connected Google Calendar in read-only),
// priorities with a checkbox, the mail that waits for an answer, the "por
// dónde iba" notes, the KPIs and the connections. Everything comes from GET
// /api/resumen (the bot's own functions); every action goes through the
// same routes the board uses (POST /api/hoy, PATCH /api/correo).

const ICONO_ACCION: Record<CorreoAccion, string> = { chelsea: '📨', yo: '🙋', tarea: '➕', archivar: '🗄' }
const ACCIONES_CORREO: CorreoAccion[] = ['chelsea', 'yo', 'tarea', 'archivar']

function hora12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

function saludoDelDia(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function Empresa({ empresa }: { empresa: { name: string; color: string } | null }) {
  if (!empresa) return null
  const color = COMPANY_COLORS[empresa.color] ?? '#888780'
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: color + '22', color }}>
      {empresa.name}
    </span>
  )
}

function Tarjeta({ titulo, children, accion, className = '' }: { titulo: string; children: React.ReactNode; accion?: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg ${className}`}>
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[#2a2a2a]">
        <h2 className="text-sm font-semibold text-[#e8e8e8]">{titulo}</h2>
        {accion}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

export default function ResumenPage() {
  const [datos, setDatos] = useState<Resumen | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set())
  const [mensaje, setMensaje] = useState<string | null>(null)
  // The "Resumen diario" panel.
  const [diario, setDiario] = useState<string | null>(null)
  const [diarioCargando, setDiarioCargando] = useState(false)
  const [diarioEnviado, setDiarioEnviado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/resumen')
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setDatos(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  function ocupar(id: string, v: boolean) {
    setOcupadas((prev) => {
      const n = new Set(prev)
      if (v) n.add(id)
      else n.delete(id)
      return n
    })
  }

  async function completar(id: string) {
    ocupar(id, true)
    setMensaje(null)
    try {
      const res = await fetch('/api/hoy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'completar', task_id: id }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setMensaje(typeof json?.texto === 'string' ? json.texto.split('\n')[0] : 'Hecho 👏')
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      ocupar(id, false)
    }
  }

  async function decidirCorreo(c: CorreoResumen, accion: CorreoAccion) {
    ocupar(c.id, true)
    setMensaje(null)
    try {
      const res = await fetch('/api/correo', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [c.id], accion }) })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.[0]?.error) throw new Error(json?.[0]?.error ?? json?.error ?? `HTTP ${res.status}`)
      setMensaje(json?.[0]?.texto ?? 'Hecho')
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      ocupar(c.id, false)
    }
  }

  async function pedirDiario(enviar: boolean) {
    setDiarioCargando(true)
    setDiarioEnviado(null)
    try {
      const res = await fetch('/api/resumen/diario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enviar }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      if (enviar) setDiarioEnviado(`Enviado a Telegram · ${json?.items ?? 0} líneas numeradas`)
      else setDiario(String(json?.texto ?? ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiarioCargando(false)
    }
  }

  if (!datos && !error) return <div className="text-sm text-[#888888] py-8 text-center">Loading...</div>
  if (!datos) return <p className="text-xs text-red-400">No se pudo cargar: {error}</p>

  const kpis = [
    { emoji: '🔥', label: 'Hoy sí o sí', n: datos.kpis.hoy, color: 'text-red-400', href: '/hoy#col-hoy' },
    { emoji: '🔺', label: 'Vencidas', n: datos.kpis.vencidas, color: 'text-red-400', href: '/hoy#col-hoy' },
    { emoji: '⏳', label: 'Esperando', n: datos.kpis.esperando, color: 'text-[#7F77DD]', href: '/hoy#col-esperando' },
    { emoji: '📧', label: 'Correos', n: datos.kpis.correos, color: 'text-[#1D9E75]', href: '/hoy#col-correos' },
  ]

  const renderItem = (it: ItemAgenda) => (
    <li key={`${it.tipo}-${it.id}`} className="flex items-start gap-3 py-1.5">
      <span className="w-16 flex-shrink-0 text-xs text-[#888888] tabular-nums pt-0.5">{it.hora ? hora12(it.hora) : it.tipo === 'evento' ? 'todo el día' : '—'}</span>
      <span className="flex-shrink-0 text-sm leading-5">{it.tipo === 'pago' ? '💳' : it.tipo === 'evento' ? '📆' : it.importante ? '★' : '▫️'}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-5 truncate ${it.tipo === 'evento' ? 'text-[#9bb7e8]' : 'text-[#e8e8e8]'}`}>
          {it.link ? <a href={it.link} target="_blank" rel="noreferrer" className="hover:underline">{it.titulo}</a> : it.titulo}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Empresa empresa={it.empresa} />
          {it.detalle && <span className="text-[10px] text-[#888888]">{it.detalle}</span>}
          {it.fin && it.hora && <span className="text-[10px] text-[#555555]">hasta {hora12(it.fin)}</span>}
          {it.tipo === 'evento' && <span className="text-[10px] text-[#555555]">Google Calendar</span>}
        </div>
      </div>
    </li>
  )

  const renderPrioridad = (p: Prioridad) => {
    const busy = ocupadas.has(p.id)
    return (
      <li key={p.id} className="flex items-start gap-2.5 py-1.5">
        <button
          onClick={() => void completar(p.id)}
          disabled={busy}
          title="Completar"
          className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 border-[#555555] hover:border-[#1D9E75] disabled:opacity-40 transition-colors"
        />
        <div className={`min-w-0 flex-1 ${busy ? 'opacity-50' : ''}`}>
          <p className="text-sm leading-5 text-[#e8e8e8]">{p.text}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Empresa empresa={p.empresa} />
            {p.importante && <span className="text-[10px] text-[#EF9F27]">★</span>}
            {p.porque && <span className="text-[10px] text-[#888888]">{p.porque}</span>}
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Cabecera ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#e8e8e8]">
            {saludoDelDia()}, {datos.nombre} ☀️
          </h1>
          <p className="text-sm text-[#888888] capitalize">{datos.fecha_larga}</p>
        </div>
        <button
          onClick={() => (diario === null ? void pedirDiario(false) : setDiario(null))}
          disabled={diarioCargando}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-[#7F77DD] text-white hover:bg-[#6b62d0] disabled:opacity-50 transition-colors"
        >
          {diarioCargando ? 'Armando…' : diario === null ? '📋 Resumen diario' : 'Cerrar resumen'}
        </button>
      </div>

      {(error || mensaje) && <p className={`text-xs ${error ? 'text-red-400' : 'text-emerald-400'}`}>{error ?? mensaje}</p>}

      {/* ── Resumen diario: the same text the 8:00 alarm sends, on demand ── */}
      {diario !== null && (
        <section className="bg-[#222222] border border-[#7F77DD]/50 rounded-lg px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#7F77DD]">📋 Resumen diario</h2>
            <div className="flex items-center gap-2">
              {diarioEnviado && <span className="text-[11px] text-emerald-400">{diarioEnviado}</span>}
              <button
                onClick={() => void pedirDiario(true)}
                disabled={diarioCargando}
                className="px-2.5 py-1 text-xs rounded-md bg-[#7F77DD]/15 text-[#7F77DD] hover:bg-[#7F77DD]/25 disabled:opacity-50 transition-colors"
              >
                📲 Enviar a Telegram
              </button>
            </div>
          </div>
          <p className="text-sm leading-6 text-[#e8e8e8] whitespace-pre-wrap">{diario || 'Nada pendiente 🎉'}</p>
        </section>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-3 py-2 hover:border-[#555555] transition-colors">
            <p className="text-[11px] text-[#888888]">{k.emoji} {k.label}</p>
            <p className={`text-2xl font-semibold leading-tight ${k.n === 0 ? 'text-[#555555]' : k.color}`}>{k.n}</p>
          </Link>
        ))}
      </div>

      {/* ── Agenda · Prioridades ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Tarjeta
          titulo="Agenda de hoy"
          className="lg:col-span-3"
          accion={<Link href="/calendario" className="text-xs text-[#7F77DD] hover:underline">Ver calendario</Link>}
        >
          {datos.agenda.length === 0 && datos.sin_hora.length === 0 ? (
            <p className="text-sm text-[#555555]">Nada con hora hoy{datos.calendar_fallo ? ' (no pude leer Google Calendar)' : ''}.</p>
          ) : (
            <>
              <ul className="divide-y divide-[#2a2a2a]">{datos.agenda.map(renderItem)}</ul>
              {datos.sin_hora.length > 0 && (
                <>
                  <p className="mt-2 pt-2 border-t border-[#2a2a2a] text-[10px] uppercase tracking-wide text-[#555555]">Sin hora</p>
                  <ul className="divide-y divide-[#2a2a2a]">{datos.sin_hora.map(renderItem)}</ul>
                </>
              )}
              {datos.calendar_fallo && <p className="mt-2 text-[11px] text-[#555555]">No pude leer Google Calendar ahora; la agenda muestra solo tareas y pagos.</p>}
            </>
          )}
        </Tarjeta>

        <Tarjeta
          titulo="Prioridades principales"
          className="lg:col-span-2"
          accion={<Link href="/hoy" className="text-xs text-[#7F77DD] hover:underline">Ver tablero</Link>}
        >
          {datos.prioridades.length === 0 ? (
            <p className="text-sm text-[#555555]">Nada vencido ni urgente 🎉</p>
          ) : (
            <ul className="divide-y divide-[#2a2a2a]">{datos.prioridades.map(renderPrioridad)}</ul>
          )}
        </Tarjeta>
      </div>

      {/* ── Correos · Por dónde iba ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Tarjeta
          titulo="Correos que piden respuesta"
          accion={<Link href="/correo" className="text-xs text-[#7F77DD] hover:underline">Ver todos</Link>}
        >
          {datos.correos.length === 0 ? (
            <p className="text-sm text-[#555555]">Nadie espera respuesta ✨</p>
          ) : (
            <ul className="divide-y divide-[#2a2a2a]">
              {datos.correos.map((c) => {
                const busy = ocupadas.has(c.id)
                const u = c.urgencia ?? 'media'
                return (
                  <li key={c.id} className={`py-2 ${busy ? 'opacity-50' : ''}`}>
                    <div className="flex items-start gap-2">
                      <span className="flex-shrink-0 text-xs leading-5" title={u}>{CORREO_URGENCIA_EMOJI[u]}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm leading-5 text-[#e8e8e8]">{c.quien}</p>
                        <p className="truncate text-xs leading-4 text-[#888888]">{c.asunto ?? '(sin asunto)'}</p>
                        <p className="text-[10px] text-[#555555]">{c.cuenta} · {c.hace}</p>
                      </div>
                      <div className="flex gap-0.5 flex-shrink-0">
                        {ACCIONES_CORREO.map((a) => (
                          <button
                            key={a}
                            onClick={() => void decidirCorreo(c, a)}
                            disabled={busy}
                            title={CORREO_ACCION_LABELS[a]}
                            className="px-1.5 py-0.5 text-[11px] rounded bg-[#2a2a2a] hover:bg-[#333333] disabled:opacity-40 transition-colors"
                          >
                            {ICONO_ACCION[a]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta
          titulo="📝 Por dónde iba"
          accion={<Link href="/notas" className="text-xs text-[#7F77DD] hover:underline">Editar notas</Link>}
        >
          {datos.notas.length === 0 ? (
            <p className="text-sm text-[#555555]">Sin notas. Escríbelas en Notas o dile al bot «nota IM: …».</p>
          ) : (
            <ul className="space-y-2">
              {datos.notas.map((n) => {
                const color = COMPANY_COLORS[n.color] ?? '#888780'
                return (
                  <li key={n.company_id} className="text-sm leading-5">
                    <span className="font-semibold mr-1.5" style={{ color }}>{n.empresa}</span>
                    <span className="text-[#c8c8c8]">{n.nota.trim().split('\n')[0]}</span>
                    <span className="ml-1.5 text-[10px] text-[#555555]">{relativeDaysEs(n.updated_at)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Tarjeta>
      </div>

      {/* ── Conexiones ── */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-[#555555]">Conexiones:</span>
        {datos.conexiones.cuentas.map((c) => (
          <span key={c.email} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${c.activa ? 'border-[#2a2a2a] text-[#c8c8c8]' : 'border-[#2a2a2a] text-[#555555]'}`} title={c.email}>
            {c.calendar && '📅'}{c.correo && '📧'}{!c.calendar && !c.correo && '○'} {c.email}
          </span>
        ))}
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${datos.conexiones.telegram ? 'border-[#2a2a2a] text-[#c8c8c8]' : 'border-[#2a2a2a] text-[#555555]'}`}>
          📲 Telegram{datos.conexiones.telegram ? '' : ' (sin configurar)'}
        </span>
        {!datos.conexiones.google_configurado && <span className="text-[#555555]">Google sin configurar en Vercel</span>}
        <Link href="/settings/conexiones" className="text-[#7F77DD] hover:underline">Settings → Conexiones</Link>
      </div>

      {/* The same 💬 chat as the board: the bot's engine, in a side panel. */}
      <ChatPanel onChanged={cargar} />
    </div>
  )
}
