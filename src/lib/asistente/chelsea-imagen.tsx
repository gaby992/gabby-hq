// Ajuste 18c: el dibujo del resumen de Chelsea (el modelo está en chelsea-imagen-datos.ts).
// Fondo blanco, título azul marino, secciones con línea y lo pendiente en rojo: el estilo
// de las tarjetas que Gabby le manda a Chelsea. Sin emoji (Satori los baja de un CDN) y con
// la letra Inter embebida, así la imagen no depende de la red.

import { ImageResponse } from 'next/og'
import { ANCHO_CHELSEA, type EstadoFila, type FilaTarea, type FilaVip, type ModeloChelsea } from './chelsea-imagen-datos'
import { fuentesInter } from './fuentes-inter'

const AZUL = '#16275C'
const TEXTO = '#1F2433'
const GRIS = '#6B7385'
const LINEA = '#E3E6EC'
const ROJO = '#C8322B'
const AMBAR = '#A8660A'
const VERDE = '#1E7B4B'

const TONO: Record<EstadoFila, { color: string; fondo: string }> = {
  pendiente: { color: ROJO, fondo: '#FBE9E7' },
  esperando: { color: AMBAR, fondo: '#FCF1DC' },
  listo: { color: VERDE, fondo: '#E4F4EB' },
}

function Seccion({ titulo, nota }: { titulo: string; nota: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 30, paddingBottom: 10, borderBottom: `3px solid ${AZUL}` }}>
      <span style={{ fontSize: 24, fontWeight: 700, color: AZUL, letterSpacing: 2 }}>{titulo}</span>
      <span style={{ fontSize: 20, color: GRIS, marginLeft: 'auto' }}>{nota}</span>
    </div>
  )
}

function Vip({ f }: { f: FilaVip }) {
  const t = TONO[f.estado]
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', padding: '15px 4px', borderBottom: `1px solid ${LINEA}` }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingRight: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: 26, lineHeight: 1.3, color: f.estado === 'listo' ? GRIS : TEXTO }}>
          <span style={{ fontWeight: 700, marginRight: 10 }}>{f.quien}</span>
          <span>{`— ${f.asunto}`}</span>
        </div>
        {f.cuando && <span style={{ fontSize: 19, color: GRIS, marginTop: 3 }}>{f.cuando}</span>}
      </div>
      <span style={{ fontSize: 19, fontWeight: 700, color: t.color, background: t.fondo, borderRadius: 6, padding: '6px 12px', marginTop: 2, whiteSpace: 'nowrap' }}>{f.etiqueta}</span>
    </div>
  )
}

function Tarea({ f }: { f: FilaTarea }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', padding: '12px 4px', borderBottom: `1px solid ${LINEA}` }}>
      <div style={{ display: 'flex', width: 12, height: 12, borderRadius: 6, background: f.vencida ? ROJO : '#B9BFCC', marginTop: 12, marginRight: 16 }} />
      <span style={{ flex: 1, fontSize: 26, lineHeight: 1.35, color: TEXTO, paddingRight: 20 }}>{f.texto}</span>
      {f.fecha && <span style={{ fontSize: 22, fontWeight: f.vencida ? 700 : 400, color: f.vencida ? ROJO : GRIS, marginTop: 4, whiteSpace: 'nowrap' }}>{f.vencida ? `overdue · ${f.fecha}` : f.fecha}</span>}
    </div>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <span style={{ fontSize: 24, color: GRIS, padding: '16px 4px' }}>{texto}</span>
}

export function ChelseaImagen({ m }: { m: ModeloChelsea }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: ANCHO_CHELSEA, height: m.alto, background: '#FFFFFF', color: TEXTO, padding: '50px 56px', fontFamily: 'Inter' }}>
      <span style={{ fontSize: 46, fontWeight: 700, color: AZUL }}>{m.titulo}</span>
      <span style={{ fontSize: 23, color: GRIS, marginTop: 6 }}>Daily summary · VIP emails and tasks</span>
      <Seccion titulo="VIP EMAILS" nota={m.vip.length === 0 ? '' : m.vipPendientes === 0 ? 'all handled' : `${m.vipPendientes} need action`} />
      {m.vip.length === 0 && <Vacio texto="No VIP emails in the last 7 days." />}
      {m.vip.map((f, i) => (
        <Vip key={i} f={f} />
      ))}
      {m.vipDeMas > 0 && <Vacio texto={`+${m.vipDeMas} more in GabbyHQ`} />}
      <Seccion titulo="CHELSEA'S TASKS" nota={m.tareas.length === 0 ? '' : `${m.tareas.length + m.tareasDeMas} open${m.tareasVencidas > 0 ? ` · ${m.tareasVencidas} overdue` : ''}`} />
      {m.tareas.length === 0 && <Vacio texto="No open tasks." />}
      {m.tareas.map((f, i) => (
        <Tarea key={i} f={f} />
      ))}
      {m.tareasDeMas > 0 && <Vacio texto={`+${m.tareasDeMas} more on the board`} />}
    </div>
  )
}

/** The PNG bytes of Chelsea's summary. */
export async function generarChelseaPng(m: ModeloChelsea): Promise<Uint8Array> {
  const res = new ImageResponse(<ChelseaImagen m={m} />, { width: ANCHO_CHELSEA, height: m.alto, fonts: fuentesInter() })
  return new Uint8Array(await res.arrayBuffer())
}
