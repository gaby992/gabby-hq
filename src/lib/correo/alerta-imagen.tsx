// Ajuste 18h: la alerta de un correo como FICHA (imagen), con el mismo estilo del resumen de
// Chelsea: quién escribe, el asunto, qué pide y por qué avisa. Es una sola ficha corta, así que en
// el teléfono se lee bien. Los botones van debajo, como siempre. Clara en el canal de Chelsea,
// oscura en el chat de Gabby. Sin emoji (Satori los baja de un CDN) y con la letra Inter embebida.

import { ImageResponse } from 'next/og'
import { fuentesInter } from '@/lib/asistente/fuentes-inter'

export interface FichaAlerta {
  cuenta: string
  /** "HIGH" / "ALTA" — ya en el idioma de la cuenta. */
  urgencia: string
  alta: boolean
  tipo: string | null
  vip: boolean
  quien: string
  asunto: string
  resumen: string | null
  razon: string | null
}

export const ANCHO_ALERTA = 1200

const PALETA = {
  claro: { fondo: '#FFFFFF', titulo: '#16275C', texto: '#1F2433', gris: '#6B7385', linea: '#E3E6EC', rojo: '#C8322B', rojoFondo: '#FBE9E7', chip: '#16275C', chipFondo: '#E8ECF7' },
  oscuro: { fondo: '#12121C', titulo: '#A99BFF', texto: '#E9E9F1', gris: '#9090A6', linea: '#2A2A3C', rojo: '#FF8A80', rojoFondo: '#3A1D1F', chip: '#C9C1FF', chipFondo: '#2A2550' },
}

const renglones = (t: string, porRenglon: number) => Math.max(1, Math.ceil(t.length / porRenglon))
const recortar = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`)

/** Alto holgado: sobra aire, nunca se corta. */
export function altoAlerta(f: FichaAlerta): number {
  let alto = 56 + 60 + 24 + 66 * renglones(f.quien, 34) + 50 * renglones(f.asunto, 48)
  if (f.resumen) alto += 24 + 40 * renglones(f.resumen, 62)
  if (f.razon) alto += 22 + 32 * renglones(f.razon, 76)
  return Math.min(1500, Math.max(420, alto + 56))
}

export function limpiarFicha(f: FichaAlerta): FichaAlerta {
  return { ...f, quien: recortar(f.quien.trim(), 80), asunto: recortar(f.asunto.trim(), 160), resumen: f.resumen && f.resumen.trim() !== f.asunto.trim() ? recortar(f.resumen.trim(), 320) : null, razon: f.razon ? recortar(f.razon.trim(), 220) : null }
}

export async function generarAlertaPng(ficha: FichaAlerta, tema: 'claro' | 'oscuro'): Promise<Uint8Array> {
  const f = limpiarFicha(ficha)
  const p = PALETA[tema]
  const alto = altoAlerta(f)
  const chip = (texto: string, color: string, fondo: string) => (
    <span style={{ fontSize: 22, fontWeight: 700, color, background: fondo, borderRadius: 6, padding: '6px 14px', marginLeft: 12, letterSpacing: 1 }}>{texto}</span>
  )
  const res = new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: ANCHO_ALERTA, height: alto, background: p.fondo, color: p.texto, padding: '50px 56px', fontFamily: 'Inter' }}>
        <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 14, borderBottom: `3px solid ${p.titulo}` }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: p.titulo, letterSpacing: 2 }}>{f.cuenta.toUpperCase()}</span>
          <div style={{ display: 'flex', marginLeft: 'auto' }}>
            {f.vip && chip('VIP', p.chip, p.chipFondo)}
            {f.tipo && chip(f.tipo.toUpperCase(), p.chip, p.chipFondo)}
            {chip(f.urgencia.toUpperCase(), f.alta ? p.rojo : p.chip, f.alta ? p.rojoFondo : p.chipFondo)}
          </div>
        </div>
        <span style={{ fontSize: 50, fontWeight: 700, lineHeight: 1.25, color: p.titulo, marginTop: 24 }}>{f.quien}</span>
        <span style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.3, marginTop: 6 }}>{f.asunto}</span>
        {f.resumen && <span style={{ fontSize: 30, lineHeight: 1.35, marginTop: 22 }}>{f.resumen}</span>}
        {f.razon && <span style={{ fontSize: 24, lineHeight: 1.35, color: p.gris, marginTop: 18 }}>{f.razon}</span>}
      </div>
    ),
    { width: ANCHO_ALERTA, height: alto, fonts: fuentesInter() }
  )
  return new Uint8Array(await res.arrayBuffer())
}
