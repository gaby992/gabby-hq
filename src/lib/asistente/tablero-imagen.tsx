// Fase 9c-B: the board as ONE picture — the KPI strip and four columns
// (Hoy sí o sí · Mañana · Esperando · Correos), at most 6 cards each, with
// the title, the company badge and ★; "ver N más" at the foot. Rendered
// with next/og (Satori + resvg, bundled with Next 14): no browser, no
// external service. The 8:00 alarm and the 6:00 pm close send it BEFORE
// the text; "mándame el tablero" / 🖥 Tablero send it on demand.
//
// The model (which cards, which numbers) is tablero-datos.ts. Nothing from
// the environment and no mail body or address ever goes into the image.
//
// No emoji inside the picture on purpose: Satori fetches each emoji as an
// SVG from a CDN at render time, and the picture must never depend on
// that. ★ is an inline SVG path.

import { ImageResponse } from 'next/og'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cancunYmd, formatDiaLargoEs } from './cancun'
import { inlineKeyboard, sendPhoto } from './telegram'
import { COLOR, GRIS, datosTablero, type ColumnaDatos, type TableroDatos, type TarjetaImagen } from './tablero-datos'

export { armarTablero, datosTablero, MAX_TARJETAS, type ColumnaDatos, type ColumnaImagen, type TableroDatos, type TarjetaImagen } from './tablero-datos'

export const ANCHO = 1200
export const ALTO = 760

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

// ── Rendering ────────────────────────────────────────────────────────────

function Estrella() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24">
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="#EF9F27" />
    </svg>
  )
}

function Tarjeta({ t }: { t: TarjetaImagen }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#1c1c1c', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 17, color: '#e8e8e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 230 }}>{t.titulo}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 5 }}>
        {t.badge ? (
          <span style={{ fontSize: 12, color: t.badge.color, background: `${t.badge.color}22`, border: `1px solid ${t.badge.color}55`, borderRadius: 4, padding: '1px 6px' }}>{t.badge.texto}</span>
        ) : (
          <span style={{ fontSize: 12, color: GRIS, background: '#2a2a2a', borderRadius: 4, padding: '1px 6px' }}>sin empresa</span>
        )}
        {t.estrella && <span style={{ display: 'flex', marginLeft: 6 }}><Estrella /></span>}
        {t.nota && <span style={{ fontSize: 12, color: t.nota.color, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{t.nota.texto}</span>}
      </div>
    </div>
  )
}

function Columna({ c }: { c: ColumnaDatos }) {
  const color = COLOR[c.id]
  const resto = c.total - c.tarjetas.length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 276, background: '#161616', border: `1px solid ${color}55`, borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #2a2a2a' }}>
        <span style={{ fontSize: 15, color, letterSpacing: 1 }}>{c.titulo}</span>
        <span style={{ fontSize: 13, color, background: `${color}22`, borderRadius: 4, padding: '1px 7px', marginLeft: 8 }}>{String(c.total)}</span>
      </div>
      {c.tarjetas.length === 0 && <span style={{ fontSize: 14, color: '#444444', padding: '6px 2px' }}>— nada</span>}
      {c.tarjetas.map((t, i) => (
        <Tarjeta key={i} t={t} />
      ))}
      {resto > 0 && <span style={{ fontSize: 13, color: '#7F77DD', marginTop: 2 }}>ver {resto} más</span>}
    </div>
  )
}

function Kpi({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#1c1c1c', border: '1px solid #2a2a2a', borderRadius: 10, padding: '8px 14px', marginRight: 10 }}>
      <span style={{ fontSize: 13, color: GRIS }}>{label}</span>
      <span style={{ fontSize: 30, color: n === 0 ? '#555555' : color, lineHeight: 1.1 }}>{String(n)}</span>
    </div>
  )
}

export function TableroImagen({ d }: { d: TableroDatos }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: ANCHO, height: ALTO, background: '#0f0f0f', color: '#e8e8e8', padding: 22, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontSize: 24, color: '#e8e8e8' }}>GabbyHQ · Tablero</span>
        <span style={{ fontSize: 16, color: GRIS, marginLeft: 'auto' }}>{formatDiaLargoEs(d.today)}</span>
      </div>
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <Kpi label="Hoy sí o sí" n={d.kpis.hoy} color={COLOR.hoy} />
        <Kpi label="Vencidas" n={d.kpis.vencidas} color={COLOR.hoy} />
        <Kpi label="Esperando" n={d.kpis.esperando} color={COLOR.esperando} />
        <Kpi label="Correos" n={d.kpis.correos} color={COLOR.correos} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', flex: 1 }}>
        {d.columnas.map((c) => (
          <Columna key={c.id} c={c} />
        ))}
      </div>
      <div style={{ display: 'flex', marginTop: 8 }}>
        <span style={{ fontSize: 12, color: '#555555' }}>Esta semana y Después están en la app · {appUrl().replace(/^https?:\/\//, '')}/hoy</span>
      </div>
    </div>
  )
}

/** The PNG bytes of the board as it stands now. */
export async function generarTableroPng(today: string = cancunYmd()): Promise<Uint8Array> {
  const d = await datosTablero(today)
  const res = new ImageResponse(<TableroImagen d={d} />, { width: ANCHO, height: ALTO })
  return new Uint8Array(await res.arrayBuffer())
}

// ── Sending ──────────────────────────────────────────────────────────────

export function botonAbrirTablero() {
  return inlineKeyboard([[{ text: '🖥 Abrir tablero', url: `${appUrl()}/hoy` }]])
}

/**
 * Sends the picture to one chat with the "🖥 Abrir tablero" button. Throws
 * on failure: the on-demand command reports it; the alarms catch it and go
 * on with the text (the picture is a bonus, never a blocker).
 */
export async function enviarTablero(chatId: number, opts: { caption?: string; tag?: string } = {}): Promise<void> {
  const png = await generarTableroPng()
  await sendPhoto(chatId, png, { caption: opts.caption, replyMarkup: botonAbrirTablero(), tag: opts.tag ?? 'tablero' })
}

// ── Access to the PNG route ──────────────────────────────────────────────

/**
 * The internal signature that lets a URL of the day fetch the PNG without
 * the cron secret itself travelling in it: HMAC-SHA256(CRON_SECRET, day).
 */
export function firmaTablero(today: string = cancunYmd()): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return null
  return createHmac('sha256', secret).update(`tablero:${today}`).digest('hex').slice(0, 32)
}

export function firmaValida(firma: string | null, today: string = cancunYmd()): boolean {
  const esperada = firmaTablero(today)
  if (!firma || !esperada || firma.length !== esperada.length) return false
  return timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))
}
