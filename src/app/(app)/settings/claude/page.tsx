'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Fase 19: cómo conectar GabbyHQ a Claude. Muestra la URL del conector (con
// su llave) y los pasos. Esa URL es como una contraseña: no se comparte.

interface Datos {
  url: string
  herramientas: { nombre: string; que: string; cambia: boolean }[]
}

export default function ConectarClaudePage() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    fetch('/api/mcp-url')
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`)
        setDatos(j)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  async function copiar() {
    if (!datos) return
    try {
      await navigator.clipboard.writeText(datos.url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      setVisible(true)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[#e8e8e8]">Conectar a Claude</h1>
        <Link href="/settings" className="text-sm text-[#888888] hover:text-[#e8e8e8]">← Settings</Link>
      </div>

      <p className="text-sm text-[#888888]">
        Con esto le hablas a Claude en cualquier chat (&laquo;ponme en el HQ los statements de IM para mañana&raquo;) y Claude lo anota aquí directo: tareas, proyectos y tu semana por bloques.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {datos && (
        <>
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1c1c1c] p-4 space-y-3">
            <p className="text-sm font-medium text-[#e8e8e8]">1 · Copia tu enlace</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void copiar()} className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-[#7F77DD] hover:opacity-90">
                {copiado ? '✓ Copiado' : 'Copiar enlace'}
              </button>
              <button onClick={() => setVisible((v) => !v)} className="px-3 py-2 rounded-lg text-sm text-[#888888] hover:text-[#e8e8e8] hover:bg-[#2a2a2a]">
                {visible ? 'Ocultar' : 'Ver enlace'}
              </button>
            </div>
            {visible && <code className="block text-xs break-all text-[#c9a227] bg-[#161616] rounded-md p-2 select-all">{datos.url}</code>}
            <p className="text-xs text-[#f87171]">Este enlace es como una contraseña de tu HQ. No lo pegues en chats ni se lo pases a nadie.</p>
          </div>

          <div className="rounded-xl border border-[#2a2a2a] bg-[#1c1c1c] p-4 space-y-2">
            <p className="text-sm font-medium text-[#e8e8e8]">2 · Agrégalo en Claude</p>
            <ol className="text-sm text-[#b8b8b8] list-decimal pl-5 space-y-1">
              <li>En claude.ai abre <b>Configuración → Conectores</b>.</li>
              <li>Toca <b>Agregar conector personalizado</b>.</li>
              <li>Nombre: <b>GabbyHQ</b>. En la URL pega el enlace que copiaste.</li>
              <li>Guarda. Debe aparecer conectado, con sus herramientas.</li>
            </ol>
          </div>

          <div className="rounded-xl border border-[#2a2a2a] bg-[#1c1c1c] p-4 space-y-2">
            <p className="text-sm font-medium text-[#e8e8e8]">3 · Pruébalo</p>
            <p className="text-sm text-[#b8b8b8]">En un chat de Claude escribe: <span className="text-[#e8e8e8]">&laquo;¿Qué tengo hoy en mi HQ?&raquo;</span></p>
          </div>

          <div className="rounded-xl border border-[#2a2a2a] bg-[#1c1c1c] p-4">
            <p className="text-sm font-medium text-[#e8e8e8] mb-2">Lo que Claude puede hacer en tu HQ</p>
            <ul className="space-y-1">
              {datos.herramientas.map((h) => (
                <li key={h.nombre} className="text-xs text-[#b8b8b8]">
                  <span className="text-[#888888]">{h.cambia ? '✏️' : '👁'}</span> {h.que}.
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
