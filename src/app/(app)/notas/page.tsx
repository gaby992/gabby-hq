'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { COMPANY_COLORS, type Company, type NotaEmpresa, type NotaHistorial } from '@/types'
import CompanyNote from '@/components/CompanyNote'
import { relativeDaysEs } from '@/lib/dates'

// Fase 12: the 📝 Notas screen — the live "por dónde iba" note of every
// company (same editor as the board; the bot's "nota IM: …" writes the same
// row) and, below each, what it replaced (notas_historial). Reads with the
// browser client like /tasks and /hoy do; nothing new in the database.

const ORDEN = ['IM', 'DATAVIA', 'PD', 'Personal', 'Chelsea']

function ordenEmpresas(companies: Company[]): Company[] {
  const idx = (c: Company) => {
    const i = ORDEN.findIndex((n) => n.toLowerCase() === c.name.trim().toLowerCase())
    return i === -1 ? 99 : i
  }
  return [...companies].sort((a, b) => idx(a) - idx(b) || a.name.localeCompare(b.name, 'es'))
}

export default function NotasPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [notas, setNotas] = useState<NotaEmpresa[]>([])
  const [historial, setHistorial] = useState<NotaHistorial[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargado, setCargado] = useState(false)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())

  const cargar = useCallback(async () => {
    const [c, n, h] = await Promise.all([
      supabase.from('companies').select('*').order('name'),
      supabase.from('notas_empresa').select('*'),
      supabase.from('notas_historial').select('*').order('archivada_en', { ascending: false }).limit(300),
    ])
    if (c.error) setError(c.error.message)
    else setCompanies((c.data as Company[]) ?? [])
    if (!n.error) setNotas((n.data as NotaEmpresa[]) ?? [])
    // The history table is optional: an unrun migration must not blank the page.
    if (!h.error) setHistorial((h.data as NotaHistorial[]) ?? [])
    setCargado(true)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  function upsertNota(nota: NotaEmpresa) {
    setNotas((prev) => [...prev.filter((x) => x.company_id !== nota.company_id), nota])
    void cargar()
  }

  function removeNota(companyId: string) {
    setNotas((prev) => prev.filter((x) => x.company_id !== companyId))
    void cargar()
  }

  if (!cargado) return <div className="text-sm text-[#888888] py-8 text-center">Loading...</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[#e8e8e8]">📝 Notas · por dónde iba</h1>
        <p className="text-sm text-[#888888] mt-1">
          Una nota viva por empresa. Escríbela antes de cerrar la compu para saber por dónde arrancar mañana; por Telegram es «nota IM: …» o «nota IM + una línea más».
          Las de los últimos 3 días salen en la alarma de las 8.
        </p>
      </div>
      {error && <p className="text-xs text-red-400">No se pudo cargar: {error}</p>}

      <div className="space-y-5">
        {ordenEmpresas(companies).map((c) => {
          const color = COMPANY_COLORS[c.color] ?? '#888780'
          const nota = notas.find((n) => n.company_id === c.id) ?? null
          const viejas = historial.filter((h) => h.company_id === c.id)
          const abierto = abiertos.has(c.id)
          return (
            <section key={c.id} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-3 space-y-2">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <h2 className="text-base font-semibold tracking-tight" style={{ color }}>{c.name}</h2>
                {viejas.length > 0 && (
                  <button
                    onClick={() => setAbiertos((prev) => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
                    className="ml-auto text-xs text-[#888888] hover:text-[#e8e8e8] transition-colors"
                  >
                    {abierto ? 'ocultar historial' : `historial · ${viejas.length}`}
                  </button>
                )}
              </div>
              <CompanyNote companyId={c.id} nota={nota} onSaved={upsertNota} onArchived={removeNota} />
              {abierto && (
                <ul className="mt-2 pl-3 border-l border-[#2a2a2a] space-y-2">
                  {viejas.slice(0, 20).map((h) => (
                    <li key={h.id} className="text-xs leading-5">
                      <span className="text-[#555555]">{h.escrita_en ? `escrita ${relativeDaysEs(h.escrita_en)} · ` : ''}archivada {relativeDaysEs(h.archivada_en)}</span>
                      <p className="text-[#a8a8a8] whitespace-pre-wrap">{h.nota}</p>
                    </li>
                  ))}
                  {viejas.length > 20 && <li className="text-[10px] text-[#555555]">+{viejas.length - 20} más antiguas</li>}
                </ul>
              )}
            </section>
          )
        })}
        {companies.length === 0 && <p className="text-sm text-[#888888] text-center py-12">No hay empresas todavía. Créalas en Settings.</p>}
      </div>
    </div>
  )
}
