'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// Fase 9c-E: the 💬 chat in /hoy. A floating button opens a side panel that
// talks to POST /api/asistente/chat — the bot's own engine, same memory,
// same plans and buttons as Telegram. Text only. After every answer the
// board refetches (onChanged), so a confirmed action moves the card at once.

interface Boton {
  text: string
  data?: string
  url?: string
}

interface Mensaje {
  rol: 'user' | 'assistant'
  texto: string
  html?: boolean
  botones?: Boton[][]
  imagen?: string
  /** Buttons already used (or superseded by a later message) are shown greyed. */
  usado?: boolean
  canal?: 'telegram' | 'web'
}

interface BotonMenu {
  texto: string
  frase: string
}

const ABIERTO_KEY = 'hoy.chat'

/** Telegram HTML (b, i, code, s, a) → React, with everything else escaped by React itself. */
function renderHtml(texto: string): ReactNode {
  const partes = texto.split(/(<\/?(?:b|i|code|s|a)(?:\s+href="[^"]*")?>)/i)
  const pila: { tag: string; href?: string; hijos: ReactNode[] }[] = [{ tag: '', hijos: [] }]
  const des = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  partes.forEach((p, i) => {
    const m = p.match(/^<(\/?)(b|i|code|s|a)(?:\s+href="([^"]*)")?>$/i)
    if (!m) {
      if (p) pila[pila.length - 1].hijos.push(des(p))
      return
    }
    const [, cierre, tagRaw, href] = m
    const tag = tagRaw.toLowerCase()
    if (!cierre) {
      pila.push({ tag, href, hijos: [] })
      return
    }
    const top = pila.pop()
    if (!top || top.tag !== tag) {
      if (top) pila[pila.length - 1].hijos.push(...top.hijos)
      return
    }
    const key = `n${i}`
    const nodo =
      tag === 'b' ? <strong key={key} className="font-semibold text-[#e8e8e8]">{top.hijos}</strong>
      : tag === 'i' ? <em key={key} className="text-[#888888]">{top.hijos}</em>
      : tag === 'code' ? <code key={key} className="px-1 rounded bg-[#2a2a2a] text-[11px]">{top.hijos}</code>
      : tag === 's' ? <s key={key} className="text-[#666666]">{top.hijos}</s>
      : <a key={key} href={top.href} target="_blank" rel="noreferrer" className="text-[#7F77DD] underline">{top.hijos}</a>
    pila[pila.length - 1].hijos.push(nodo)
  })
  while (pila.length > 1) {
    const top = pila.pop()!
    pila[pila.length - 1].hijos.push(...top.hijos)
  }
  return <>{pila[0].hijos}</>
}

/** Plain text with the URLs clickable. */
function renderPlano(texto: string): ReactNode {
  const partes = texto.split(/(https?:\/\/[^\s)»]+)/g)
  return (
    <>
      {partes.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="text-[#7F77DD] underline break-all">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

export interface ChatPanelProps {
  /** The board refetches after every answer. */
  onChanged: () => void
}

export default function ChatPanel({ onChanged }: ChatPanelProps) {
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [menu, setMenu] = useState<BotonMenu[]>([])
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargado, setCargado] = useState(false)
  const fondo = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      if (localStorage.getItem(ABIERTO_KEY) === '1') setAbierto(true)
    } catch {
      /* private mode */
    }
  }, [])

  function abrir(v: boolean) {
    setAbierto(v)
    try {
      localStorage.setItem(ABIERTO_KEY, v ? '1' : '0')
    } catch {
      /* private mode */
    }
  }

  const cargarHistorial = useCallback(async () => {
    try {
      const res = await fetch('/api/asistente/chat')
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      const turnos: Mensaje[] = (json?.turnos ?? []).map((t: { rol: 'user' | 'assistant'; texto: string; canal?: 'telegram' | 'web' }) => ({ rol: t.rol, texto: t.texto, canal: t.canal }))
      setMensajes(turnos)
      setMenu(json?.menu ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCargado(true)
    }
  }, [])

  useEffect(() => {
    if (abierto && !cargado) void cargarHistorial()
  }, [abierto, cargado, cargarHistorial])

  useEffect(() => {
    if (!abierto) return
    const el = fondo.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensajes, abierto, ocupado])

  async function enviar(body: { texto?: string; boton?: string }, eco: string | null) {
    if (ocupado) return
    setError(null)
    setOcupado(true)
    // The buttons of earlier answers no longer apply once she sends something else.
    setMensajes((prev) => [...prev.map((m) => (m.botones?.length ? { ...m, usado: true } : m)), ...(eco ? [{ rol: 'user' as const, texto: eco, canal: 'web' as const }] : [])])
    try {
      const res = await fetch('/api/asistente/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      const nuevos: Mensaje[] = (json?.mensajes ?? []).map((m: { texto: string; html: boolean; botones: Boton[][]; imagen?: string }) => ({ rol: 'assistant' as const, texto: m.texto, html: m.html, botones: m.botones, imagen: m.imagen, canal: 'web' as const }))
      setMensajes((prev) => [...prev, ...nuevos])
      // A confirmed action changed something on the server: the board follows.
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupado(false)
      input.current?.focus()
    }
  }

  function enviarTexto(t: string) {
    const limpio = t.trim()
    if (!limpio) return
    setTexto('')
    void enviar({ texto: limpio }, limpio)
  }

  function tocar(b: Boton, idx: number) {
    if (b.url) {
      window.open(b.url, '_blank', 'noreferrer')
      return
    }
    if (!b.data) return
    setMensajes((prev) => prev.map((m, i) => (i === idx ? { ...m, usado: true } : m)))
    void enviar({ boton: b.data }, `[${b.text}]`)
  }

  if (!abierto) {
    return (
      <button
        onClick={() => abrir(true)}
        title="Hablar con el asistente"
        className="fixed bottom-5 right-5 z-30 w-12 h-12 rounded-full bg-[#7F77DD] text-white text-xl shadow-lg hover:bg-[#6b62d0] transition-colors flex items-center justify-center"
      >
        💬
      </button>
    )
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full sm:w-[420px] bg-[#111111] border-l border-[#2a2a2a] shadow-2xl flex flex-col">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-[#2a2a2a]">
        <span className="text-sm font-semibold text-[#e8e8e8]">💬 Asistente</span>
        <span className="text-[11px] text-[#555555]">la misma conversación que en Telegram</span>
        <button onClick={() => abrir(false)} title="Cerrar" className="ml-auto text-xs text-[#888888] hover:text-[#e8e8e8] px-2 py-1">✕</button>
      </header>

      <div ref={fondo} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {!cargado && <p className="text-xs text-[#555555]">Cargando…</p>}
        {cargado && mensajes.length === 0 && (
          <p className="text-xs text-[#555555]">Pregúntame «¿qué tengo hoy?», «¿cómo va IM?» o dime «pásame Marketing Team al viernes».</p>
        )}
        {mensajes.map((m, i) => (
          <div key={i} className={`flex ${m.rol === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-lg px-3 py-2 text-xs leading-5 whitespace-pre-wrap break-words ${m.rol === 'user' ? 'bg-[#7F77DD]/25 text-[#e8e8e8]' : 'bg-[#1c1c1c] border border-[#2a2a2a] text-[#d8d8d8]'}`}>
              {m.imagen && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.imagen} alt="Tablero" className="rounded mb-1 w-full" />
              )}
              {m.texto && (m.html ? renderHtml(m.texto) : renderPlano(m.texto))}
              {m.botones && m.botones.length > 0 && (
                <div className="mt-2 space-y-1">
                  {m.botones.map((fila, f) => (
                    <div key={f} className="flex flex-wrap gap-1">
                      {fila.map((b, k) => (
                        <button
                          key={k}
                          disabled={ocupado || (m.usado && !b.url)}
                          onClick={() => tocar(b, i)}
                          className="px-2 py-1 rounded border border-[#7F77DD]/50 text-[11px] text-[#7F77DD] hover:bg-[#7F77DD]/15 disabled:opacity-40 disabled:cursor-default transition-colors"
                        >
                          {b.text}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {m.rol === 'user' && m.canal === 'telegram' && <span className="block text-[10px] text-[#555555] mt-0.5">desde Telegram</span>}
            </div>
          </div>
        ))}
        {ocupado && <p className="text-xs text-[#555555] px-1">pensando…</p>}
        {error && <p className="text-xs text-red-400 px-1">{error}</p>}
      </div>

      {menu.length > 0 && (
        <div className="px-3 pb-1 flex flex-wrap gap-1">
          {menu.map((b) => (
            <button
              key={b.texto}
              disabled={ocupado}
              onClick={() => enviarTexto(b.frase)}
              className="px-2 py-0.5 rounded-full border border-[#2a2a2a] text-[11px] text-[#888888] hover:text-[#e8e8e8] hover:border-[#555555] disabled:opacity-40 transition-colors"
            >
              {b.texto}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); enviarTexto(texto) }}
        className="flex gap-2 px-3 py-3 border-t border-[#2a2a2a]"
      >
        <input
          ref={input}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Dime qué hacemos…"
          maxLength={4000}
          disabled={ocupado}
          autoFocus
          className="min-w-0 flex-1 text-sm bg-[#0f0f0f] border border-[#2a2a2a] rounded-md px-3 py-2 text-[#e8e8e8] placeholder:text-[#444444] focus:outline-none focus:border-[#7F77DD] disabled:opacity-60"
        />
        <button type="submit" disabled={ocupado || !texto.trim()} className="px-3 py-2 text-sm rounded-md bg-[#7F77DD] text-white hover:bg-[#6b62d0] disabled:opacity-40 transition-colors">
          Enviar
        </button>
      </form>
    </aside>
  )
}
