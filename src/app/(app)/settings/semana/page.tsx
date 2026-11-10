'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

// Fase 16: Settings → Mi semana. La plantilla de bloques que alimenta "Hoy
// te toca", el mensaje de la mañana y las propuestas de Gabita. Un día a la
// vez; cada bloque se edita en su sitio. Abajo, lo que cambia según el día
// del mes (inicio de mes, mitad de mes).

interface Bloque {
  id?: string
  dia: number
  inicio: string
  fin: string
  nombre: string
  tema: string
  company_id: string | null
  palabras: string[]
  fijas: string[]
  toma_tareas: boolean
  bloqueado: boolean
  activo: boolean
}

interface Regla {
  id?: string
  desde: number
  hasta: number
  inicio: string
  tema: string
  rotacion: string[]
  fijas: string[]
  activo: boolean
}

interface Empresa {
  id: string
  name: string
}

const DIAS = [
  { n: 1, corto: 'Lun' },
  { n: 2, corto: 'Mar' },
  { n: 3, corto: 'Mié' },
  { n: 4, corto: 'Jue' },
  { n: 5, corto: 'Vie' },
  { n: 6, corto: 'Sáb' },
  { n: 0, corto: 'Dom' },
]

const campo = 'bg-[#161616] border border-[#2a2a2a] rounded-md px-2.5 py-1.5 text-sm text-[#e8e8e8] placeholder:text-[#555555] focus:outline-none focus:border-[#7F77DD]'

function hm(t: string): string {
  return String(t ?? '').slice(0, 5)
}

function hora12(t: string): string {
  const [h, m] = hm(t).split(':').map(Number)
  if (Number.isNaN(h)) return t
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

export default function SemanaPage() {
  const [bloques, setBloques] = useState<Bloque[]>([])
  const [reglas, setReglas] = useState<Regla[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [dia, setDia] = useState<number>(() => new Date().getDay())
  const [editando, setEditando] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [reglaEditando, setReglaEditando] = useState<string | null>(null)
  const [reglaNueva, setReglaNueva] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/semana', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      setBloques((j.bloques ?? []).map((b: Bloque) => ({ ...b, inicio: hm(b.inicio), fin: hm(b.fin), palabras: b.palabras ?? [], fijas: b.fijas ?? [] })))
      setReglas((j.reglas ?? []).map((r: Regla) => ({ ...r, inicio: hm(r.inicio), rotacion: r.rotacion ?? [], fijas: r.fijas ?? [] })))
      setEmpresas(j.empresas ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  async function guardar(cuerpo: Record<string, unknown>) {
    const res = await fetch('/api/semana', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(j?.error ?? `HTTP ${res.status}`)
      return false
    }
    setError(null)
    await cargar()
    return true
  }

  async function borrar(id: string, tipo: 'bloque' | 'regla') {
    if (!confirm(tipo === 'bloque' ? '¿Quitar este bloque de tu semana?' : '¿Quitar esta regla del mes?')) return
    const res = await fetch(`/api/semana?id=${id}&tipo=${tipo}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j?.error ?? `HTTP ${res.status}`)
      return
    }
    await cargar()
  }

  const delDia = bloques.filter((b) => b.dia === dia).sort((a, b) => a.inicio.localeCompare(b.inicio))
  const empresaDe = (id: string | null) => (id ? empresas.find((e) => e.id === id)?.name ?? null : null)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings" className="text-xs text-[#888888] hover:text-[#e8e8e8]">← Settings</Link>
        <h1 className="text-xl font-semibold tracking-tight text-[#e8e8e8] mt-1">Mi semana</h1>
        <p className="text-sm text-[#888888] mt-1">
          Tus bloques de cada día. De aquí sale «Hoy te toca» en el Resumen, el mensaje de la mañana y lo que Gabita
          usa para proponerte cuándo hacer algo. Lo que cambies aquí cuenta desde ya.
        </p>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {cargando && <p className="text-sm text-[#666666]">Cargando…</p>}

      <section className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {DIAS.map((d) => (
            <button
              key={d.n}
              onClick={() => { setDia(d.n); setEditando(null); setNuevo(false) }}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${dia === d.n ? 'bg-[#1f1d33] border-[#7F77DD] text-[#e8e8e8]' : 'bg-[#161616] border-[#2a2a2a] text-[#888888] hover:text-[#e8e8e8]'}`}
            >
              {d.corto}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {delDia.map((b) =>
            editando === b.id ? (
              <EditorBloque
                key={b.id}
                bloque={b}
                empresas={empresas}
                onCancelar={() => setEditando(null)}
                onGuardar={async (c) => { if (await guardar({ ...c, id: b.id, dia })) setEditando(null) }}
                onBorrar={() => borrar(b.id!, 'bloque')}
              />
            ) : (
              <button
                key={b.id}
                onClick={() => { setEditando(b.id ?? null); setNuevo(false) }}
                className={`w-full text-left bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-2.5 hover:border-[#3a3a3a] transition-colors ${b.activo ? '' : 'opacity-40'}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="w-36 flex-shrink-0 text-xs tabular-nums text-[#888888]">{hora12(b.inicio)} – {hora12(b.fin)}</span>
                  <span className="text-sm font-medium text-[#e8e8e8]">{b.nombre}</span>
                  <span className="text-sm text-[#a8a8a8]">{b.tema}</span>
                  <span className="ml-auto text-[10px] text-[#666666]">
                    {b.bloqueado ? 'no disponible' : !b.toma_tareas ? 'rutina' : empresaDe(b.company_id) ?? (b.palabras.length > 0 ? 'por palabras' : 'lo que sobre')}
                  </span>
                </div>
                {b.fijas.length > 0 && <p className="text-xs text-[#666666] mt-1 sm:pl-[9.75rem]">↻ {b.fijas.join(' · ')}</p>}
              </button>
            )
          )}
          {!cargando && delDia.length === 0 && <p className="text-sm text-[#666666] py-3">Este día no tiene bloques.</p>}
        </div>

        {nuevo ? (
          <EditorBloque
            bloque={{ dia, inicio: '08:15', fin: '10:15', nombre: '', tema: '', company_id: null, palabras: [], fijas: [], toma_tareas: true, bloqueado: false, activo: true }}
            empresas={empresas}
            onCancelar={() => setNuevo(false)}
            onGuardar={async (c) => { if (await guardar({ ...c, dia })) setNuevo(false) }}
          />
        ) : (
          <button onClick={() => { setNuevo(true); setEditando(null) }} className="text-xs text-[#7F77DD] hover:underline">+ Agregar bloque</button>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[#888888] uppercase tracking-wider">Lo que cambia según el día del mes</h2>
          <p className="text-xs text-[#666666] mt-1">
            En los días hábiles de ese rango, el bloque que empieza a esa hora cambia de tema. Con una lista de turnos, cada
            día toma el siguiente (un cliente por día) y la regla termina cuando la lista se acaba.
          </p>
        </div>
        <div className="space-y-2">
          {reglas.map((r) =>
            reglaEditando === r.id ? (
              <EditorRegla
                key={r.id}
                regla={r}
                onCancelar={() => setReglaEditando(null)}
                onGuardar={async (c) => { if (await guardar({ ...c, tipo: 'regla', id: r.id })) setReglaEditando(null) }}
                onBorrar={() => borrar(r.id!, 'regla')}
              />
            ) : (
              <button
                key={r.id}
                onClick={() => { setReglaEditando(r.id ?? null); setReglaNueva(false) }}
                className={`w-full text-left bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-2.5 hover:border-[#3a3a3a] transition-colors ${r.activo ? '' : 'opacity-40'}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="w-36 flex-shrink-0 text-xs text-[#888888]">del {r.desde} al {r.hasta} · {hora12(r.inicio)}</span>
                  <span className="text-sm text-[#e8e8e8]">{r.tema}</span>
                </div>
                {r.rotacion.length > 0 && <p className="text-xs text-[#666666] mt-1 sm:pl-[9.75rem]">Turnos: {r.rotacion.join(' → ')}</p>}
              </button>
            )
          )}
        </div>
        {reglaNueva ? (
          <EditorRegla
            regla={{ desde: 1, hasta: 5, inicio: '10:30', tema: '', rotacion: [], fijas: [], activo: true }}
            onCancelar={() => setReglaNueva(false)}
            onGuardar={async (c) => { if (await guardar({ ...c, tipo: 'regla' })) setReglaNueva(false) }}
          />
        ) : (
          <button onClick={() => { setReglaNueva(true); setReglaEditando(null) }} className="text-xs text-[#7F77DD] hover:underline">+ Agregar regla del mes</button>
        )}
      </section>
    </div>
  )
}

function EditorBloque({
  bloque,
  empresas,
  onCancelar,
  onGuardar,
  onBorrar,
}: {
  bloque: Bloque
  empresas: Empresa[]
  onCancelar: () => void
  onGuardar: (c: Record<string, unknown>) => void
  onBorrar?: () => void
}) {
  const [inicio, setInicio] = useState(bloque.inicio)
  const [fin, setFin] = useState(bloque.fin)
  const [nombre, setNombre] = useState(bloque.nombre)
  const [tema, setTema] = useState(bloque.tema)
  const [empresa, setEmpresa] = useState(bloque.company_id ?? '')
  const [palabras, setPalabras] = useState(bloque.palabras.join(', '))
  const [fijas, setFijas] = useState(bloque.fijas.join('\n'))
  const [tomaTareas, setTomaTareas] = useState(bloque.toma_tareas)
  const [bloqueado, setBloqueado] = useState(bloque.bloqueado)
  const [activo, setActivo] = useState(bloque.activo)

  return (
    <div className="bg-[#1c1c1c] border border-[#7F77DD] rounded-lg px-4 py-3 space-y-2">
      <div className="grid grid-cols-[auto_auto_1fr] gap-2 items-center">
        <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className={campo} />
        <input type="time" value={fin} onChange={(e) => setFin(e.target.value)} className={campo} />
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre: Bloque A, Estudio, Tarde…" className={campo} />
      </div>
      <input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="De qué es: PD: cierre de la semana" className={`${campo} w-full`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[10px] text-[#666666] space-y-1">
          <span className="block">Le caen las tareas de</span>
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={`${campo} w-full`}>
            <option value="">Cualquier empresa</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-[#666666] space-y-1">
          <span className="block">Solo las que traigan estas palabras (separadas por coma)</span>
          <input value={palabras} onChange={(e) => setPalabras(e.target.value)} placeholder="ghl, quickbooks…" className={`${campo} w-full`} />
        </label>
      </div>
      <label className="text-[10px] text-[#666666] space-y-1 block">
        <span className="block">Lo fijo de este bloque, una cosa por línea</span>
        <textarea value={fijas} onChange={(e) => setFijas(e.target.value)} rows={3} className={`${campo} w-full`} />
      </label>
      <div className="flex flex-wrap items-center gap-4 text-xs text-[#888888]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={tomaTareas} onChange={(e) => setTomaTareas(e.target.checked)} className="accent-[#7F77DD]" /> recibe tareas</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={bloqueado} onChange={(e) => setBloqueado(e.target.checked)} className="accent-[#7F77DD]" /> no disponible (no es de trabajo)</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="accent-[#7F77DD]" /> activo</label>
      </div>
      <div className="flex items-center gap-3 text-xs pt-1">
        <button
          onClick={() => onGuardar({ inicio, fin, nombre, tema, company_id: empresa || null, palabras, fijas, toma_tareas: tomaTareas, bloqueado, activo })}
          className="font-medium px-3 py-1.5 rounded-md bg-[#7F77DD] text-white hover:bg-[#6C5CE7]"
        >
          Guardar
        </button>
        <button onClick={onCancelar} className="text-[#888888] hover:text-[#e8e8e8]">cancelar</button>
        {onBorrar && <button onClick={onBorrar} className="text-[#888888] hover:text-red-400 ml-auto">quitar</button>}
      </div>
    </div>
  )
}

function EditorRegla({
  regla,
  onCancelar,
  onGuardar,
  onBorrar,
}: {
  regla: Regla
  onCancelar: () => void
  onGuardar: (c: Record<string, unknown>) => void
  onBorrar?: () => void
}) {
  const [desde, setDesde] = useState(String(regla.desde))
  const [hasta, setHasta] = useState(String(regla.hasta))
  const [inicio, setInicio] = useState(regla.inicio)
  const [tema, setTema] = useState(regla.tema)
  const [rotacion, setRotacion] = useState(regla.rotacion.join(', '))
  const [fijas, setFijas] = useState(regla.fijas.join('\n'))
  const [activo, setActivo] = useState(regla.activo)

  return (
    <div className="bg-[#1c1c1c] border border-[#7F77DD] rounded-lg px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#888888]">
        <span>Del día</span>
        <input value={desde} onChange={(e) => setDesde(e.target.value)} inputMode="numeric" className={`${campo} w-16`} />
        <span>al</span>
        <input value={hasta} onChange={(e) => setHasta(e.target.value)} inputMode="numeric" className={`${campo} w-16`} />
        <span>cambia el bloque de las</span>
        <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className={campo} />
      </div>
      <input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="De qué es: SEO/GEO del mes" className={`${campo} w-full`} />
      <label className="text-[10px] text-[#666666] space-y-1 block">
        <span className="block">Turnos, uno por día hábil (separados por coma). Vacío = igual todos los días del rango</span>
        <input value={rotacion} onChange={(e) => setRotacion(e.target.value)} placeholder="Shift, TOTT, PTHO…" className={`${campo} w-full`} />
      </label>
      <label className="text-[10px] text-[#666666] space-y-1 block">
        <span className="block">Lo fijo de esos días, una cosa por línea</span>
        <textarea value={fijas} onChange={(e) => setFijas(e.target.value)} rows={3} className={`${campo} w-full`} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-[#888888]"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="accent-[#7F77DD]" /> activa</label>
      <div className="flex items-center gap-3 text-xs pt-1">
        <button
          onClick={() => onGuardar({ desde: Number(desde), hasta: Number(hasta), inicio, tema, rotacion, fijas, activo })}
          className="font-medium px-3 py-1.5 rounded-md bg-[#7F77DD] text-white hover:bg-[#6C5CE7]"
        >
          Guardar
        </button>
        <button onClick={onCancelar} className="text-[#888888] hover:text-[#e8e8e8]">cancelar</button>
        {onBorrar && <button onClick={onBorrar} className="text-[#888888] hover:text-red-400 ml-auto">quitar</button>}
      </div>
    </div>
  )
}
