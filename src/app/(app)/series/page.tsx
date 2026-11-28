'use client'

import { useCallback, useEffect, useState } from 'react'
import { CLARO } from '@/components/Fondo'
import type { EnFila, Serie } from '@/lib/series'

// 🍿 Series — what Gabby is watching, which episode she's on and when the next one
// drops. Built from her "Serie: …" episode tasks; ✓ Visto completes the task.

export default function SeriesPage() {
  const [series, setSeries] = useState<Serie[] | null>(null)
  const [enFila, setEnFila] = useState<EnFila[]>([])
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/series', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'No pude cargar las series')
      setSeries(j.series)
      setEnFila(j.enFila ?? [])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function marcar(id: string, visto: boolean, empezar = false) {
    setOcupado(id)
    try {
      const res = await fetch('/api/series', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: id, visto, empezar }) })
      if (!res.ok) throw new Error((await res.json()).error ?? 'No se pudo guardar')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(null)
    }
  }

  function alternar(nombre: string) {
    setAbiertas((prev) => {
      const n = new Set(prev)
      if (n.has(nombre)) n.delete(nombre)
      else n.add(nombre)
      return n
    })
  }

  const viendo = (series ?? []).filter((s) => !s.terminada)
  const terminadas = (series ?? []).filter((s) => s.terminada)

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold" style={{ color: CLARO.texto }}>🍿 Series</h1>
        <p className="text-sm" style={{ color: CLARO.textoSuave }}>Lo que estás viendo, por qué capítulo vas y cuándo sale el siguiente.</p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {series === null && !error && <p className="text-sm" style={{ color: CLARO.textoApagado }}>Cargando…</p>}
      {series?.length === 0 && (
        <p className="text-sm" style={{ color: CLARO.textoApagado }}>Todavía no hay series. Dile a Clau «la serie X sale los sábados, voy en el cap 3 de 10» y aparece aquí.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {viendo.map((s) => (
          <TarjetaSerie key={s.nombre} s={s} abierta={abiertas.has(s.nombre)} onAlternar={() => alternar(s.nombre)} onMarcar={marcar} ocupado={ocupado} />
        ))}
      </div>

      {enFila.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: CLARO.textoSuave }}>🎬 En fila para ver</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {enFila.map((f) => (
              <article key={f.id} className="rounded-xl p-4 space-y-2" style={{ backgroundColor: CLARO.tarjeta, border: `1px dashed ${CLARO.borde}` }}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-semibold leading-tight" style={{ color: CLARO.texto }}>{f.nombre}</h3>
                  {f.plataforma && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: CLARO.acentoSuave, color: CLARO.acento }}>{f.plataforma}</span>}
                </div>
                {f.detalle && <p className="text-xs" style={{ color: CLARO.textoSuave }}>{f.detalle}</p>}
                <button
                  onClick={() => marcar(f.id, true, true)}
                  disabled={ocupado === f.id}
                  className="text-xs px-3 py-1 rounded-md disabled:opacity-50"
                  style={{ backgroundColor: CLARO.acentoSuave, color: CLARO.acento }}
                >
                  ▶ Ya la empecé
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {terminadas.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: CLARO.textoSuave }}>✅ Terminadas</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {terminadas.map((s) => (
              <TarjetaSerie key={s.nombre} s={s} abierta={abiertas.has(s.nombre)} onAlternar={() => alternar(s.nombre)} onMarcar={marcar} ocupado={ocupado} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function TarjetaSerie({ s, abierta, onAlternar, onMarcar, ocupado }: {
  s: Serie
  abierta: boolean
  onAlternar: () => void
  onMarcar: (id: string, visto: boolean) => void
  ocupado: string | null
}) {
  const pct = s.total && s.voy_en !== null ? Math.round((s.voy_en / s.total) * 100) : null
  return (
    <article className="rounded-xl p-4 space-y-3" style={{ backgroundColor: CLARO.tarjeta, border: `1px solid ${CLARO.borde}`, opacity: s.terminada ? 0.7 : 1 }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold leading-tight" style={{ color: CLARO.texto }}>{s.nombre}</h3>
          <p className="text-xs mt-0.5" style={{ color: CLARO.textoSuave }}>
            {s.plataforma ?? 'plataforma por definir'}{s.dia ? ` · sale los ${s.dia}` : ''}
          </p>
        </div>
        {s.plataforma && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: CLARO.acentoSuave, color: CLARO.acento }}>{s.plataforma}</span>}
      </div>

      <div>
        <p className="text-sm" style={{ color: CLARO.texto }}>
          {s.voy_en !== null ? <>Voy en el cap <b>{s.voy_en}</b>{s.total ? <> de {s.total}</> : null}</> : 'Capítulos por definir'}
        </p>
        {pct !== null && (
          <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: CLARO.chip }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: CLARO.acento }} />
          </div>
        )}
      </div>

      {s.proximo && !s.terminada && (
        <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: CLARO.chip, border: `1px solid ${CLARO.borde}` }}>
          <div className="text-[13px]" style={{ color: CLARO.texto }}>
            <span style={{ color: CLARO.textoSuave }}>Próximo:</span> {s.proximo.cap ? `cap ${s.proximo.cap}` : s.proximo.etiqueta}
            <span className="block text-xs" style={{ color: CLARO.textoSuave }}>{s.proximo.fecha_txt}{s.proximo.hora ? ` · ${s.proximo.hora}` : ''}</span>
          </div>
          <button
            onClick={() => onMarcar(s.proximo!.id, true)}
            disabled={ocupado === s.proximo.id}
            className="text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
            style={{ backgroundColor: CLARO.acento, color: '#fff' }}
          >
            ✓ Visto
          </button>
        </div>
      )}

      <button onClick={onAlternar} className="text-xs hover:underline" style={{ color: CLARO.acento }}>
        {abierta ? 'Ocultar capítulos' : `Ver capítulos (${s.caps.length})`}
      </button>
      {abierta && (
        <ul className="space-y-1">
          {s.caps.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={c.visto}
                disabled={ocupado === c.id}
                onChange={(e) => onMarcar(c.id, e.target.checked)}
                className="accent-[#7F77DD]"
              />
              <span style={{ color: c.visto ? CLARO.textoApagado : CLARO.texto, textDecoration: c.visto ? 'line-through' : 'none' }}>
                {c.cap ? `Cap ${c.cap}` : c.etiqueta}
              </span>
              <span className="ml-auto text-xs" style={{ color: CLARO.textoApagado }}>{c.fecha_txt}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
