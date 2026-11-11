'use client'

import { useCallback, useEffect, useState } from 'react'
import { CLARO } from '@/components/Fondo'
import type { ProyectoConPasos, ProyectoEstado } from '@/lib/proyectos'

// Fase 17: /proyectos. Every project whole: what "terminado" means, the
// three date ranges, the countdown to the release and its steps. The steps
// are ordinary tasks, so ticking one here is completing it on the board.

const TZ = 'America/Cancun'

function corta(ymd: string | null): string {
  if (!ymd) return '—'
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${ymd}T12:00:00Z`))
}

function rango(a: string | null, b: string | null): string {
  if (a && b) return a === b ? corta(a) : `${corta(a)} → ${corta(b)}`
  return corta(a ?? b)
}

function cuenta(dias: number | null): { texto: string; color: string } {
  if (dias === null) return { texto: 'sin fecha de salida', color: '#f87171' }
  if (dias < 0) return { texto: `atrasado ${-dias} ${dias === -1 ? 'día' : 'días'}`, color: '#f87171' }
  if (dias === 0) return { texto: 'sale HOY', color: '#fb923c' }
  if (dias === 1) return { texto: 'sale mañana', color: '#fb923c' }
  return { texto: `faltan ${dias} días`, color: dias <= 7 ? '#fb923c' : '#1D9E75' }
}

const VACIO = { nombre: '', company_id: '', terminado: '', produccion_desde: '', produccion_hasta: '', pruebas_desde: '', pruebas_hasta: '', salida: '' }
type Forma = typeof VACIO

const campo = 'bg-[#161616] border border-[#2a2a2a] rounded-md px-2 py-1.5 text-sm text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD] [color-scheme:dark]'
const etiqueta = 'block text-[11px] mb-1 text-[#9a9a9a]'

function Formulario({ forma, setForma, empresas, onGuardar, onCancelar, guardando, titulo }: {
  forma: Forma
  setForma: (f: Forma) => void
  empresas: { id: string; name: string }[]
  onGuardar: () => void
  onCancelar: () => void
  guardando: boolean
  titulo: string
}) {
  const set = (k: keyof Forma) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForma({ ...forma, [k]: e.target.value })
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: CLARO.tarjeta, border: `1px solid ${CLARO.acento}` }}>
      <p className="text-sm font-medium" style={{ color: CLARO.texto }}>{titulo}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className={etiqueta}>Nombre del proyecto</label>
          <input value={forma.nombre} onChange={set('nombre')} placeholder="Ej.: Web de DATAVIA" className={`${campo} w-full`} />
        </div>
        <div>
          <label className={etiqueta}>Empresa</label>
          <select value={forma.company_id} onChange={set('company_id')} className={`${campo} w-full`}>
            <option value="">Sin empresa</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={etiqueta}>1 · ¿Qué es «terminado»? (la versión mínima)</label>
        <textarea value={forma.terminado} onChange={set('terminado')} rows={2} placeholder="Escribe aquí qué tiene que existir para decir «ya está». Ej.: la web publicada con sus 5 páginas y el formulario funcionando." className={`${campo} w-full`} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div><label className={etiqueta}>2 · Producción desde</label><input type="date" value={forma.produccion_desde} onChange={set('produccion_desde')} className={`${campo} w-full`} /></div>
        <div><label className={etiqueta}>hasta</label><input type="date" value={forma.produccion_hasta} onChange={set('produccion_hasta')} className={`${campo} w-full`} /></div>
        <div><label className={etiqueta}>3 · Pruebas desde</label><input type="date" value={forma.pruebas_desde} onChange={set('pruebas_desde')} className={`${campo} w-full`} /></div>
        <div><label className={etiqueta}>hasta</label><input type="date" value={forma.pruebas_hasta} onChange={set('pruebas_hasta')} className={`${campo} w-full`} /></div>
        <div><label className={etiqueta}>4 · Salida</label><input type="date" value={forma.salida} onChange={set('salida')} className={`${campo} w-full`} /></div>
      </div>
      <div className="flex gap-2">
        <button onClick={onGuardar} disabled={guardando || !forma.nombre.trim()} className="px-3 py-1.5 rounded-md text-sm font-medium text-white disabled:opacity-40" style={{ backgroundColor: CLARO.acento }}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={onCancelar} className="px-3 py-1.5 rounded-md text-sm" style={{ color: CLARO.textoSuave }}>Cancelar</button>
      </div>
    </div>
  )
}

export default function ProyectosPage() {
  const [proyectos, setProyectos] = useState<ProyectoConPasos[]>([])
  const [empresas, setEmpresas] = useState<{ id: string; name: string }[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null) // id, 'nuevo' or null
  const [forma, setForma] = useState<Forma>(VACIO)
  const [guardando, setGuardando] = useState(false)
  const [pasoNuevo, setPasoNuevo] = useState<Record<string, { titulo: string; fecha: string }>>({})
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set())
  const [verTerminados, setVerTerminados] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/proyectos')
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setProyectos(json.proyectos ?? [])
      setEmpresas(json.empresas ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  async function enviar(body: Record<string, unknown>): Promise<boolean> {
    setError(null)
    try {
      const res = await fetch('/api/proyectos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      await cargar()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  async function guardar() {
    setGuardando(true)
    const body: Record<string, unknown> = {
      nombre: forma.nombre,
      company_id: forma.company_id || null,
      terminado: forma.terminado,
      produccion_desde: forma.produccion_desde || null,
      produccion_hasta: forma.produccion_hasta || null,
      pruebas_desde: forma.pruebas_desde || null,
      pruebas_hasta: forma.pruebas_hasta || null,
      salida: forma.salida || null,
    }
    if (editando && editando !== 'nuevo') body.id = editando
    if (await enviar(body)) {
      setEditando(null)
      setForma(VACIO)
    }
    setGuardando(false)
  }

  function abrirEdicion(p: ProyectoConPasos) {
    setEditando(p.id)
    setForma({
      nombre: p.nombre,
      company_id: p.company_id ?? '',
      terminado: p.terminado,
      produccion_desde: p.produccion_desde ?? '',
      produccion_hasta: p.produccion_hasta ?? '',
      pruebas_desde: p.pruebas_desde ?? '',
      pruebas_hasta: p.pruebas_hasta ?? '',
      salida: p.salida ?? '',
    })
  }

  async function agregarPaso(p: ProyectoConPasos) {
    const n = pasoNuevo[p.id]
    if (!n?.titulo.trim()) return
    if (await enviar({ tipo: 'paso', id: p.id, titulo: n.titulo, fecha: n.fecha || null })) {
      setPasoNuevo((prev) => ({ ...prev, [p.id]: { titulo: '', fecha: '' } }))
    }
  }

  async function completarPaso(id: string) {
    setOcupadas((prev) => new Set(prev).add(id))
    try {
      const res = await fetch('/api/hoy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'completar', task_id: id }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupadas((prev) => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  async function borrar(p: ProyectoConPasos) {
    if (!window.confirm(`¿Borrar el proyecto «${p.nombre}»? Sus pasos se quedan como tareas en el tablero.`)) return
    setError(null)
    const res = await fetch(`/api/proyectos?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    if (!res.ok) setError((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
    await cargar()
  }

  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
  const visibles = proyectos.filter((p) => verTerminados || p.estado !== 'terminado')
  const terminados = proyectos.filter((p) => p.estado === 'terminado').length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: CLARO.texto }}>Proyectos</h1>
          <p className="text-sm mt-1" style={{ color: CLARO.textoSuave }}>Lo que tiene un final: qué es «terminado», cuándo se produce, cuándo se prueba y cuándo sale.</p>
        </div>
        {editando === null && (
          <button onClick={() => { setEditando('nuevo'); setForma(VACIO) }} className="px-3 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: CLARO.acento }}>
            + Proyecto nuevo
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {editando === 'nuevo' && (
        <Formulario forma={forma} setForma={setForma} empresas={empresas} onGuardar={() => void guardar()} onCancelar={() => setEditando(null)} guardando={guardando} titulo="Proyecto nuevo" />
      )}

      {!cargando && proyectos.length === 0 && editando !== 'nuevo' && !error && (
        <div className="rounded-xl p-6 text-sm" style={{ backgroundColor: CLARO.tarjeta, border: `1px solid ${CLARO.borde}`, color: CLARO.textoSuave }}>
          Todavía no hay proyectos. Crea uno aquí, o dile a Gabita: <span style={{ color: CLARO.texto }}>«proyecto nuevo: agente de CPT, DATAVIA, sale el 30 de noviembre»</span>.
        </div>
      )}

      <div className="space-y-4">
        {visibles.map((p) => {
          if (editando === p.id) {
            return <Formulario key={p.id} forma={forma} setForma={setForma} empresas={empresas} onGuardar={() => void guardar()} onCancelar={() => setEditando(null)} guardando={guardando} titulo={`Editar · ${p.nombre}`} />
          }
          const c = cuenta(p.dias)
          const pct = p.pasos.length > 0 ? Math.round((p.hechos / p.pasos.length) * 100) : 0
          const n = pasoNuevo[p.id] ?? { titulo: '', fecha: '' }
          const apagado = p.estado !== 'activo'
          return (
            <div key={p.id} className="rounded-xl p-4" style={{ backgroundColor: CLARO.tarjeta, border: `1px solid ${CLARO.borde}`, opacity: apagado ? 0.6 : 1 }}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-base font-semibold" style={{ color: CLARO.texto }}>{p.nombre}</h2>
                {p.empresa && <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: CLARO.chip, color: CLARO.textoSuave }}>{p.empresa}</span>}
                {p.estado !== 'activo' && <span className="text-[11px]" style={{ color: CLARO.textoSuave }}>{p.estado === 'pausado' ? '⏸ en pausa' : '✅ terminado'}</span>}
                {p.estado === 'activo' && <span className="text-xs font-semibold" style={{ color: c.color }}>{c.texto}</span>}
                <span className="ml-auto flex gap-3 text-[11px]" style={{ color: CLARO.textoSuave }}>
                  <button onClick={() => abrirEdicion(p)} className="hover:underline">Editar</button>
                  {p.estado === 'activo' && <button onClick={() => void enviar({ id: p.id, estado: 'terminado' as ProyectoEstado })} className="hover:underline">Marcar terminado</button>}
                  {p.estado === 'activo' && <button onClick={() => void enviar({ id: p.id, estado: 'pausado' as ProyectoEstado })} className="hover:underline">Pausar</button>}
                  {p.estado !== 'activo' && <button onClick={() => void enviar({ id: p.id, estado: 'activo' as ProyectoEstado })} className="hover:underline">Reactivar</button>}
                  <button onClick={() => void borrar(p)} className="hover:underline text-red-400">Borrar</button>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-3">
                <div className="sm:col-span-4 rounded-lg px-3 py-2" style={{ backgroundColor: CLARO.chip }}>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: CLARO.textoApagado }}>Terminado es</p>
                  <p className="text-sm mt-0.5" style={{ color: p.terminado ? CLARO.texto : '#f87171' }}>{p.terminado || 'Falta definir qué es «terminado»'}</p>
                </div>
                {[
                  { t: 'Producción', v: rango(p.produccion_desde, p.produccion_hasta), ok: !!(p.produccion_desde || p.produccion_hasta) },
                  { t: 'Pruebas', v: rango(p.pruebas_desde, p.pruebas_hasta), ok: !!(p.pruebas_desde || p.pruebas_hasta) },
                  { t: 'Salida', v: corta(p.salida), ok: !!p.salida },
                ].map((x) => (
                  <div key={x.t} className="rounded-lg px-3 py-2" style={{ backgroundColor: CLARO.chip }}>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: CLARO.textoApagado }}>{x.t}</p>
                    <p className="text-sm mt-0.5" style={{ color: x.ok ? CLARO.texto : '#f87171' }}>{x.ok ? x.v : 'falta la fecha'}</p>
                  </div>
                ))}
                <div className="rounded-lg px-3 py-2" style={{ backgroundColor: CLARO.chip }}>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: CLARO.textoApagado }}>Avance</p>
                  <p className="text-sm mt-0.5" style={{ color: CLARO.texto }}>{p.pasos.length === 0 ? 'sin pasos' : `${p.hechos} de ${p.pasos.length} · ${pct}%`}</p>
                  {p.pasos.length > 0 && (
                    <div className="h-1 rounded mt-1.5" style={{ backgroundColor: CLARO.borde }}>
                      <div className="h-1 rounded" style={{ width: `${pct}%`, backgroundColor: CLARO.acento }} />
                    </div>
                  )}
                </div>
              </div>

              <ul className="mt-3 divide-y" style={{ borderColor: CLARO.borde }}>
                {p.pasos.map((s) => {
                  const tarde = !s.done && !!s.due_date && s.due_date < hoy
                  const busy = ocupadas.has(s.id)
                  return (
                    <li key={s.id} className="flex items-center gap-3 py-1.5" style={{ borderColor: CLARO.borde }}>
                      <button
                        onClick={() => { if (!s.done) void completarPaso(s.id) }}
                        disabled={busy || s.done}
                        title={s.done ? 'Hecho' : 'Completar'}
                        className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 text-[11px] leading-[14px] text-white"
                        style={{ borderColor: s.done || busy ? CLARO.acento : '#555555', backgroundColor: s.done || busy ? CLARO.acento : 'transparent' }}
                      >
                        {s.done ? '✓' : ''}
                      </button>
                      <span className={`text-[13px] flex-1 min-w-0 ${s.done ? 'line-through opacity-45' : ''}`} style={{ color: CLARO.texto }}>{s.text}</span>
                      <span className="text-[11px] whitespace-nowrap" style={{ color: tarde ? '#f87171' : CLARO.textoSuave }}>
                        {s.due_date ? corta(s.due_date) : 'sin fecha'}{tarde ? ' · vencido' : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>

              {p.estado === 'activo' && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <input
                    value={n.titulo}
                    onChange={(e) => setPasoNuevo((prev) => ({ ...prev, [p.id]: { ...n, titulo: e.target.value } }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') void agregarPaso(p) }}
                    placeholder="Agregar un paso…"
                    className={`${campo} flex-1 min-w-[12rem]`}
                  />
                  <input type="date" value={n.fecha} onChange={(e) => setPasoNuevo((prev) => ({ ...prev, [p.id]: { ...n, fecha: e.target.value } }))} className={campo} />
                  <button onClick={() => void agregarPaso(p)} disabled={!n.titulo.trim()} className="px-3 py-1.5 rounded-md text-sm disabled:opacity-40" style={{ backgroundColor: CLARO.hover, color: CLARO.texto }}>Agregar</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {terminados > 0 && (
        <button onClick={() => setVerTerminados((v) => !v)} className="text-xs hover:underline" style={{ color: CLARO.textoSuave }}>
          {verTerminados ? 'Ocultar terminados' : `Ver terminados (${terminados})`}
        </button>
      )}
    </div>
  )
}
