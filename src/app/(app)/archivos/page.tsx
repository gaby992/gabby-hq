'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Fase 14 (segundo cerebro): la pantalla Archivos. Todo lo que el bot
// archivó por Telegram vive aquí, más la subida por la web (la que sirve
// cuando el archivo pasa de 20 MB y Telegram no lo deja bajar).
// Buscar · filtrar · ver · editar · descargar · borrar, y el historial de
// las versiones que una renovación reemplazó.

interface Doc {
  id: string
  titulo: string
  categoria: string
  company_id: string | null
  ruta: string | null
  tipo: string | null
  paginas: number | null
  resumen: string | null
  fecha_documento: string | null
  vence: string | null
  monto: number | null
  moneda: string | null
  se_renueva: boolean
  notas: string | null
  reemplaza_a: string | null
  historial: boolean
  origen: string
  creado: string
  url: string | null
}

interface Empresa {
  id: string
  name: string
}

const EMOJI: Record<string, string> = {
  'Contratos': '📜',
  'Alquiler': '🏠',
  'Seguros': '🛡',
  'Finanzas': '💰',
  'Facturas y recibos': '🧾',
  'Salud': '🩺',
  'Documentos e IDs': '🪪',
  'Otros': '📄',
}

const MONEDAS = ['', 'MXN', 'USD', 'EUR', 'VES', 'COP']

function dias(hoy: string, ymd: string): number {
  return Math.round((Date.parse(`${ymd}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86_400_000)
}

function fechaCorta(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${Number(d)} ${meses[Number(m) - 1]} ${y}`
}

function montoTexto(monto: number | null, moneda: string | null): string | null {
  if (monto === null || monto === undefined) return null
  return `$${Number(monto).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${moneda ? ` ${moneda}` : ''}`
}

export default function ArchivosPage() {
  const [filas, setFilas] = useState<Doc[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [hoy, setHoy] = useState('')
  const [q, setQ] = useState('')
  const [categoria, setCategoria] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [historial, setHistorial] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const [juntos, setJuntos] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const p = new URLSearchParams()
      if (q.trim()) p.set('q', q.trim())
      if (categoria) p.set('categoria', categoria)
      if (empresa) p.set('empresa', empresa)
      if (historial) p.set('historial', '1')
      const res = await fetch(`/api/documentos?${p}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      setFilas(j.filas ?? [])
      setEmpresas(j.empresas ?? [])
      setCategorias(j.categorias ?? [])
      setHoy(j.hoy ?? '')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCargando(false)
    }
  }, [q, categoria, empresa, historial])

  useEffect(() => {
    const t = setTimeout(() => { void cargar() }, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [cargar, q])

  const porEmpresa = useMemo(() => new Map(empresas.map((e) => [e.id, e.name])), [empresas])

  async function subir() {
    const files = fileRef.current?.files
    if ((!files || files.length === 0) && nota.trim().length < 8) {
      setAviso('Elige un archivo o escribe el dato que quieres guardar.')
      return
    }
    setSubiendo(true)
    setAviso(null)
    try {
      const fd = new FormData()
      for (const f of Array.from(files ?? [])) fd.append('archivos', f)
      if (nota.trim()) fd.append('nota', nota.trim())
      if (juntos) fd.append('juntos', '1')
      const res = await fetch('/api/documentos', { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      const n = (j.documentos ?? []).length
      setAviso(`✓ Guardado${n > 1 ? `s ${n}` : ''}. Revisa la ficha: la llené leyendo el documento.`)
      setNota('')
      setJuntos(false)
      if (fileRef.current) fileRef.current.value = ''
      await cargar()
    } catch (err) {
      setAviso(`No se pudo guardar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubiendo(false)
    }
  }

  async function guardarCambios(id: string, cambios: Record<string, unknown>) {
    const res = await fetch(`/api/documentos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      setAviso(`No se pudo guardar: ${j?.error ?? res.status}`)
      return
    }
    setEditando(null)
    await cargar()
  }

  async function borrar(d: Doc) {
    if (!confirm(`¿Borrar «${d.titulo}»? Se va el archivo también y no hay vuelta atrás.`)) return
    const res = await fetch(`/api/documentos/${d.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setAviso(`No se pudo borrar: ${j?.error ?? res.status}`)
      return
    }
    await cargar()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[#e8e8e8]">📂 Archivos · tu segundo cerebro</h1>
        <p className="text-sm text-[#888888] mt-1">
          Contratos, pólizas, recibos e identificaciones, con su vencimiento. Lo normal es mandárselos al bot por Telegram
          (él los lee y te propone la ficha); aquí los subes cuando pasan de 20 MB y los corriges. Pregúntale lo que
          quieras: «¿con quién tengo el seguro del carro?».
        </p>
      </div>

      {/* ── Subir ── */}
      <section className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/*"
            className="text-xs text-[#a8a8a8] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-[#2a2a2a] file:text-[#e8e8e8] hover:file:bg-[#333333]"
          />
          <label className="flex items-center gap-1.5 text-xs text-[#888888]">
            <input type="checkbox" checked={juntos} onChange={(e) => setJuntos(e.target.checked)} className="accent-[#7F77DD]" />
            son páginas de un mismo documento
          </label>
        </div>
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Qué es, o un dato sin archivo: «el seguro del carro es con GNP, se paga en marzo»"
          className="w-full bg-[#161616] border border-[#2a2a2a] rounded-md px-3 py-2 text-sm text-[#e8e8e8] placeholder:text-[#555555] focus:outline-none focus:border-[#7F77DD]"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={subir}
            disabled={subiendo}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-[#7F77DD] text-white hover:bg-[#6C5CE7] disabled:opacity-50"
          >
            {subiendo ? 'Leyendo y archivando…' : 'Archivar'}
          </button>
          {aviso && <p className="text-xs text-[#a8a8a8]">{aviso}</p>}
        </div>
      </section>

      {/* ── Filtros ── */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar en todo lo guardado (incluye el texto de los PDF)"
            className="flex-1 min-w-[220px] bg-[#161616] border border-[#2a2a2a] rounded-md px-3 py-2 text-sm text-[#e8e8e8] placeholder:text-[#555555] focus:outline-none focus:border-[#7F77DD]"
          />
          <select
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            className="bg-[#161616] border border-[#2a2a2a] rounded-md px-2.5 py-2 text-sm text-[#e8e8e8] focus:outline-none focus:border-[#7F77DD]"
          >
            <option value="">Todas las empresas</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button
            onClick={() => setHistorial((v) => !v)}
            className={`text-xs px-2.5 py-2 rounded-md border transition-colors ${historial ? 'bg-[#1f1d33] border-[#7F77DD] text-[#e8e8e8]' : 'bg-[#161616] border-[#2a2a2a] text-[#888888] hover:text-[#e8e8e8]'}`}
          >
            {historial ? 'viendo historial' : 'historial'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip activo={categoria === ''} onClick={() => setCategoria('')}>Todo</Chip>
          {categorias.map((c) => (
            <Chip key={c} activo={categoria === c} onClick={() => setCategoria(categoria === c ? '' : c)}>
              {EMOJI[c] ?? '📄'} {c}
            </Chip>
          ))}
        </div>
      </section>

      {error && <p className="text-xs text-red-400">No se pudo cargar: {error}</p>}
      {cargando && <p className="text-sm text-[#666666] py-6 text-center">Cargando…</p>}

      {!cargando && filas.length === 0 && (
        <p className="text-sm text-[#888888] text-center py-10">
          {historial ? 'No hay versiones viejas todavía.' : q || categoria || empresa ? 'Nada con esos filtros.' : 'Todavía no hay nada guardado. Mándale un PDF o una foto al bot por Telegram y te propone la ficha.'}
        </p>
      )}

      <div className="space-y-2.5">
        {filas.map((d) => (
          <article key={d.id} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-3">
            {editando === d.id ? (
              <Editor
                doc={d}
                empresas={empresas}
                categorias={categorias}
                onCancelar={() => setEditando(null)}
                onGuardar={(cambios) => guardarCambios(d.id, cambios)}
              />
            ) : (
              <>
                <div className="flex items-start gap-2.5">
                  <span className="text-base leading-6">{EMOJI[d.categoria] ?? '📄'}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-[#e8e8e8] leading-5">{d.titulo}</h2>
                    <p className="text-xs text-[#888888] mt-0.5">
                      {d.categoria}
                      {d.company_id && porEmpresa.get(d.company_id) ? ` · ${porEmpresa.get(d.company_id)}` : ''}
                      {d.paginas && d.paginas > 1 ? ` · ${d.paginas} páginas` : ''}
                      {!d.ruta ? ' · nota sin archivo' : ''}
                      {d.historial ? ' · versión vieja' : ''}
                    </p>
                  </div>
                  {d.vence && hoy && <Vence vence={d.vence} dias={dias(hoy, d.vence)} />}
                </div>

                {d.resumen && <p className="text-xs text-[#a8a8a8] mt-2 leading-5">{d.resumen}</p>}
                <p className="text-xs text-[#666666] mt-1.5 space-x-2">
                  {d.fecha_documento && <span>del {fechaCorta(d.fecha_documento)}</span>}
                  {montoTexto(d.monto, d.moneda) && <span>{montoTexto(d.monto, d.moneda)}</span>}
                  {d.se_renueva && <span>se renueva</span>}
                </p>
                {d.notas && <p className="text-xs text-[#888888] mt-1 whitespace-pre-wrap">{d.notas.replace(/^Páginas: .*$/m, '').trim()}</p>}

                <div className="flex flex-wrap items-center gap-3 mt-2.5 text-xs">
                  {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-[#7F77DD] hover:underline">ver</a>}
                  {d.url && <a href={d.url} download className="text-[#7F77DD] hover:underline">descargar</a>}
                  <button onClick={() => setEditando(d.id)} className="text-[#888888] hover:text-[#e8e8e8]">editar</button>
                  <button
                    onClick={() => guardarCambios(d.id, { historial: !d.historial })}
                    className="text-[#888888] hover:text-[#e8e8e8]"
                  >
                    {d.historial ? 'volver a vigente' : 'al historial'}
                  </button>
                  <button onClick={() => borrar(d)} className="text-[#888888] hover:text-red-400 ml-auto">borrar</button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${activo ? 'bg-[#1f1d33] border-[#7F77DD] text-[#e8e8e8]' : 'bg-[#161616] border-[#2a2a2a] text-[#888888] hover:text-[#e8e8e8]'}`}
    >
      {children}
    </button>
  )
}

function Vence({ vence, dias: d }: { vence: string; dias: number }) {
  const color = d < 0 ? '#f87171' : d <= 7 ? '#fb923c' : d <= 30 ? '#facc15' : '#888888'
  const texto = d < 0 ? `venció hace ${Math.abs(d)} d` : d === 0 ? 'vence hoy' : d === 1 ? 'vence mañana' : `vence en ${d} d`
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 whitespace-nowrap" style={{ color, borderColor: `${color}55` }}>
      {texto} · {fechaCorta(vence)}
    </span>
  )
}

function Editor({
  doc,
  empresas,
  categorias,
  onCancelar,
  onGuardar,
}: {
  doc: Doc
  empresas: Empresa[]
  categorias: string[]
  onCancelar: () => void
  onGuardar: (cambios: Record<string, unknown>) => void
}) {
  const [titulo, setTitulo] = useState(doc.titulo)
  const [categoria, setCategoria] = useState(doc.categoria)
  const [empresaId, setEmpresaId] = useState(doc.company_id ?? '')
  const [vence, setVence] = useState(doc.vence ?? '')
  const [fechaDoc, setFechaDoc] = useState(doc.fecha_documento ?? '')
  const [monto, setMonto] = useState(doc.monto === null ? '' : String(doc.monto))
  const [moneda, setMoneda] = useState(doc.moneda ?? '')
  const [seRenueva, setSeRenueva] = useState(doc.se_renueva)
  const [resumen, setResumen] = useState(doc.resumen ?? '')
  const [notas, setNotas] = useState(doc.notas ?? '')

  const campo = 'w-full bg-[#161616] border border-[#2a2a2a] rounded-md px-2.5 py-1.5 text-sm text-[#e8e8e8] placeholder:text-[#555555] focus:outline-none focus:border-[#7F77DD]'

  return (
    <div className="space-y-2">
      <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={campo} placeholder="Título" />
      <div className="grid grid-cols-2 gap-2">
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={campo}>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className={campo}>
          <option value="">Sin empresa</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-[#666666] space-y-1">
          <span className="block">Vence</span>
          <input type="date" value={vence} onChange={(e) => setVence(e.target.value)} className={campo} />
        </label>
        <label className="text-[10px] text-[#666666] space-y-1">
          <span className="block">Fecha del documento</span>
          <input type="date" value={fechaDoc} onChange={(e) => setFechaDoc(e.target.value)} className={campo} />
        </label>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
        <input value={monto} onChange={(e) => setMonto(e.target.value)} className={campo} placeholder="Monto" inputMode="decimal" />
        <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className={campo}>
          {MONEDAS.map((m) => <option key={m} value={m}>{m || '—'}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-[#888888] whitespace-nowrap">
          <input type="checkbox" checked={seRenueva} onChange={(e) => setSeRenueva(e.target.checked)} className="accent-[#7F77DD]" />
          se renueva
        </label>
      </div>
      <textarea value={resumen} onChange={(e) => setResumen(e.target.value)} rows={2} className={campo} placeholder="Resumen" />
      <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={campo} placeholder="Notas (número de póliza, dirección, teléfono…)" />
      <div className="flex items-center gap-3 text-xs">
        <button
          onClick={() =>
            onGuardar({
              titulo,
              categoria,
              empresa_id: empresaId || null,
              vence: vence || null,
              fecha_documento: fechaDoc || null,
              monto: monto.trim() === '' ? null : monto,
              moneda: moneda || null,
              se_renueva: seRenueva,
              resumen,
              notas,
            })
          }
          className="font-medium px-3 py-1.5 rounded-md bg-[#7F77DD] text-white hover:bg-[#6C5CE7]"
        >
          Guardar
        </button>
        <button onClick={onCancelar} className="text-[#888888] hover:text-[#e8e8e8]">cancelar</button>
      </div>
    </div>
  )
}
