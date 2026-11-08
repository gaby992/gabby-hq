'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { COMPANY_COLORS, CORREO_ACCION_LABELS, CORREO_URGENCIA_EMOJI, type CorreoAccion } from '@/types'
import type { Resumen, ItemAgenda, Prioridad, CorreoResumen } from '@/lib/asistente/resumen'
import { relativeDaysEs } from '@/lib/dates'
import ChatPanel from '@/components/ChatPanel'
import { CLARO } from '@/components/Fondo'

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

function Empresa({ empresa }: { empresa: { name: string; color: string } | null }) {
  if (!empresa) return null
  const color = COMPANY_COLORS[empresa.color] ?? '#888780'
  return (
    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: color + '1f', color }}>
      {empresa.name}
    </span>
  )
}

/** A white card of the light palette (the reference's panels). */
function Tarjeta({ titulo, children, accion, className = '' }: { titulo: string; children: React.ReactNode; accion?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl ${className}`} style={{ backgroundColor: CLARO.tarjeta, border: `1px solid ${CLARO.borde}` }}>
      <header className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
        <h2 className="text-[13px] font-semibold" style={{ color: CLARO.texto }}>{titulo}</h2>
        {accion}
      </header>
      <div className="px-5 pb-4">{children}</div>
    </section>
  )
}

function Enlace({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs font-medium hover:underline" style={{ color: CLARO.acento }}>
      {children}
    </Link>
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

  if (!datos && !error) return <div className="text-sm py-8 text-center" style={{ color: CLARO.textoSuave }}>Loading...</div>
  if (!datos) return <p className="text-xs text-red-400">No se pudo cargar: {error}</p>

  const kpis = [
    { emoji: '🔥', label: 'Hoy sí o sí', n: datos.kpis.hoy, color: '#f87171', href: '/hoy#col-hoy' },
    { emoji: '🔺', label: 'Vencidas', n: datos.kpis.vencidas, color: '#f87171', href: '/hoy#col-hoy' },
    { emoji: '⏳', label: 'Esperando', n: datos.kpis.esperando, color: CLARO.acento, href: '/hoy#col-esperando' },
    { emoji: '📧', label: 'Correos', n: datos.kpis.correos, color: '#1D9E75', href: '/hoy#col-correos' },
  ]

  const renderItem = (it: ItemAgenda) => (
    <li key={`${it.tipo}-${it.id}`} className="flex items-start gap-3 py-2">
      <span className="w-[4.5rem] flex-shrink-0 text-xs tabular-nums pt-0.5" style={{ color: CLARO.textoSuave }}>
        {it.hora ? hora12(it.hora) : it.tipo === 'evento' ? 'todo el día' : '—'}
      </span>
      <span className="flex-shrink-0 text-sm leading-5">{it.tipo === 'pago' ? '💳' : it.tipo === 'evento' ? '📆' : it.importante ? '★' : '•'}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 truncate" style={{ color: CLARO.texto }}>
          {it.link ? <a href={it.link} target="_blank" rel="noreferrer" className="hover:underline">{it.titulo}</a> : it.titulo}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Empresa empresa={it.empresa} />
          {it.detalle && <span className="text-[10px]" style={{ color: CLARO.textoSuave }}>{it.detalle}</span>}
          {it.fin && it.hora && <span className="text-[10px]" style={{ color: CLARO.textoApagado }}>hasta {hora12(it.fin)}</span>}
          {it.tipo === 'evento' && <span className="text-[10px]" style={{ color: CLARO.textoApagado }}>Google Calendar</span>}
        </div>
      </div>
    </li>
  )

  const renderPrioridad = (p: Prioridad) => {
    const busy = ocupadas.has(p.id)
    return (
      <li key={p.id} className="flex items-start gap-3 py-2">
        <button
          onClick={() => void completar(p.id)}
          disabled={busy}
          title="Completar"
          className="mt-0.5 flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 transition-colors disabled:opacity-40 hover:bg-[#262626]"
          style={{ borderColor: busy ? CLARO.acento : '#555555', backgroundColor: busy ? CLARO.acento : 'transparent' }}
        />
        <div className={`min-w-0 flex-1 ${busy ? 'opacity-50' : ''}`}>
          <p className="text-[13px] leading-5" style={{ color: CLARO.texto }}>{p.text}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Empresa empresa={p.empresa} />
            {p.importante && <span className="text-[10px] text-[#EF9F27]">★</span>}
            {p.porque && <span className="text-[10px]" style={{ color: CLARO.textoSuave }}>{p.porque}</span>}
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Cabecera ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: CLARO.texto }}>
            Hola, {datos.nombre} ☀️
          </h1>
          <p className="text-sm capitalize" style={{ color: CLARO.textoSuave }}>{datos.fecha_larga}</p>
        </div>
        <button
          onClick={() => (diario === null ? void pedirDiario(false) : setDiario(null))}
          disabled={diarioCargando}
          className="px-4 py-2 text-[13px] font-semibold rounded-lg text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: CLARO.acento }}
        >
          {diarioCargando ? 'Armando…' : diario === null ? 'Resumen diario' : 'Cerrar resumen'}
        </button>
      </div>

      {(error || mensaje) && <p className={`text-xs ${error ? 'text-red-400' : 'text-emerald-400'}`}>{error ?? mensaje}</p>}

      {/* ── Resumen diario: the same text the 8:00 alarm sends, on demand ── */}
      {diario !== null && (
        <section className="rounded-xl px-5 py-4 space-y-3 shadow-sm" style={{ backgroundColor: CLARO.acentoSuave, border: `1px solid ${CLARO.acento}66` }}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold" style={{ color: CLARO.acento }}>Resumen diario</h2>
            <div className="flex items-center gap-2">
              {diarioEnviado && <span className="text-[11px] text-emerald-400">{diarioEnviado}</span>}
              <button
                onClick={() => void pedirDiario(true)}
                disabled={diarioCargando}
                className="px-3 py-1 text-xs font-medium rounded-md text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: CLARO.acento }}
              >
                Enviar a Telegram
              </button>
            </div>
          </div>
          <p className="text-[13px] leading-6 whitespace-pre-wrap" style={{ color: CLARO.texto }}>{diario || 'Nada pendiente 🎉'}</p>
        </section>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="rounded-xl px-4 py-3 hover:border-[#555555] transition-colors" style={{ backgroundColor: CLARO.tarjeta, border: `1px solid ${CLARO.borde}` }}>
            <p className="text-[11px] font-medium" style={{ color: CLARO.textoSuave }}>{k.emoji} {k.label}</p>
            <p className="text-2xl font-bold leading-tight" style={{ color: k.n === 0 ? CLARO.textoApagado : k.color }}>{k.n}</p>
          </Link>
        ))}
      </div>

      {/* ── Agenda · Prioridades ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Tarjeta titulo="Agenda de hoy" className="lg:col-span-3" accion={<Enlace href="/calendario">Ver calendario</Enlace>}>
          {datos.agenda.length === 0 && datos.sin_hora.length === 0 ? (
            <p className="text-sm" style={{ color: CLARO.textoApagado }}>Nada con hora hoy{datos.calendar_fallo ? ' (no pude leer Google Calendar)' : ''}.</p>
          ) : (
            <>
              <ul className="divide-y divide-[#2a2a2a]">{datos.agenda.map(renderItem)}</ul>
              {datos.sin_hora.length > 0 && (
                <>
                  <p className="mt-2 pt-2 border-t border-[#2a2a2a] text-[10px] uppercase tracking-wide" style={{ color: CLARO.textoApagado }}>Sin hora</p>
                  <ul className="divide-y divide-[#2a2a2a]">{datos.sin_hora.map(renderItem)}</ul>
                </>
              )}
              {datos.calendar_fallo && <p className="mt-2 text-[11px]" style={{ color: CLARO.textoApagado }}>No pude leer Google Calendar ahora; la agenda muestra solo tareas y pagos.</p>}
            </>
          )}
        </Tarjeta>

        <Tarjeta titulo="Prioridades principales" className="lg:col-span-2" accion={<Enlace href="/hoy">Ver tablero</Enlace>}>
          {datos.prioridades.length === 0 ? (
            <p className="text-sm" style={{ color: CLARO.textoApagado }}>Nada vencido ni urgente 🎉</p>
          ) : (
            <ul className="divide-y divide-[#2a2a2a]">{datos.prioridades.map(renderPrioridad)}</ul>
          )}
        </Tarjeta>
      </div>

      {/* ── Correos · Por dónde iba ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Tarjeta titulo="Correos que piden respuesta" accion={<Enlace href="/correo">Ver todos</Enlace>}>
          {datos.correos.length === 0 ? (
            <p className="text-sm" style={{ color: CLARO.textoApagado }}>Nadie espera respuesta ✨</p>
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
                        <p className="truncate text-[13px] leading-5" style={{ color: CLARO.texto }}>{c.quien}</p>
                        <p className="truncate text-xs leading-4" style={{ color: CLARO.textoSuave }}>{c.asunto ?? '(sin asunto)'}</p>
                        <p className="text-[10px]" style={{ color: CLARO.textoApagado }}>{c.cuenta} · {c.hace}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {ACCIONES_CORREO.map((a) => (
                          <button
                            key={a}
                            onClick={() => void decidirCorreo(c, a)}
                            disabled={busy}
                            title={CORREO_ACCION_LABELS[a]}
                            className="w-7 h-7 text-[12px] rounded-md disabled:opacity-40 transition-colors hover:bg-[#262626]"
                            style={{ backgroundColor: CLARO.hover, border: `1px solid ${CLARO.borde}` }}
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

        <Tarjeta titulo="Por dónde iba" accion={<Enlace href="/notas">Editar notas</Enlace>}>
          {datos.notas.length === 0 ? (
            <p className="text-sm" style={{ color: CLARO.textoApagado }}>Sin notas. Escríbelas en Notas o dile al bot «nota IM: …».</p>
          ) : (
            <ul className="space-y-2.5">
              {datos.notas.map((n) => {
                const color = COMPANY_COLORS[n.color] ?? '#888780'
                return (
                  <li key={n.company_id} className="text-[13px] leading-5">
                    <span className="font-semibold mr-1.5" style={{ color }}>{n.empresa}</span>
                    <span style={{ color: CLARO.texto }}>{n.nota.trim().split('\n')[0]}</span>
                    <span className="ml-1.5 text-[10px]" style={{ color: CLARO.textoApagado }}>{relativeDaysEs(n.updated_at)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Tarjeta>
      </div>

      {/* ── Herramientas conectadas ── */}
      <Tarjeta titulo="Herramientas conectadas" accion={<Enlace href="/settings/conexiones">+ Agregar</Enlace>}>
        <div className="flex flex-wrap gap-2">
          {datos.conexiones.cuentas.map((c) => (
            <span
              key={c.email}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
              style={{ border: `1px solid ${CLARO.borde}`, color: c.activa ? CLARO.texto : CLARO.textoApagado, backgroundColor: CLARO.chip }}
              title={c.email}
            >
              <span className="text-base leading-none">{c.calendar && c.correo ? '📅✉️' : c.calendar ? '📅' : c.correo ? '✉️' : '○'}</span>
              <span>
                <span className="block font-medium leading-tight">{c.calendar && c.correo ? 'Calendar + Gmail' : c.calendar ? 'Google Calendar' : c.correo ? 'Gmail' : 'Google'}</span>
                <span className="block text-[10px] leading-tight" style={{ color: CLARO.textoApagado }}>{c.email}</span>
              </span>
            </span>
          ))}
          <span className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ border: `1px solid ${CLARO.borde}`, color: datos.conexiones.telegram ? CLARO.texto : CLARO.textoApagado, backgroundColor: CLARO.chip }}>
            <span className="text-base leading-none">📲</span>
            <span>
              <span className="block font-medium leading-tight">Telegram</span>
              <span className="block text-[10px] leading-tight" style={{ color: CLARO.textoApagado }}>{datos.conexiones.telegram ? 'asistente activo' : 'sin configurar'}</span>
            </span>
          </span>
          {!datos.conexiones.google_configurado && <span className="text-[11px] self-center" style={{ color: CLARO.textoApagado }}>Google sin configurar en Vercel</span>}
        </div>
      </Tarjeta>

      {/* The same 💬 chat as the board: the bot's engine, in a side panel. */}
      <ChatPanel onChanged={cargar} />
    </div>
  )
}
