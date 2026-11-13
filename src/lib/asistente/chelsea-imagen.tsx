// Ajuste 18c: el dibujo del resumen de Chelsea (el modelo está en chelsea-imagen-datos.ts).
// Fondo blanco, título azul marino, secciones con línea y lo pendiente en rojo: el estilo
// de las tarjetas que Gabby le manda a Chelsea. Sin emoji (Satori los baja de un CDN) y con
// la letra Inter embebida, así la imagen no depende de la red.
//
// Ajuste 18d: el mismo dibujo en OSCURO para el resumen de Gabby (el blanco le molesta la
// vista). Los textos vienen del modelo, así que aquí no hay idioma.

import { ImageResponse } from 'next/og'
import { ANCHO_CHELSEA, type EstadoFila, type FilaTarea, type FilaVip, type ModeloChelsea, type TemaResumen } from './chelsea-imagen-datos'
import { fuentesInter } from './fuentes-inter'

interface Paleta {
  fondo: string
  titulo: string
  texto: string
  gris: string
  linea: string
  punto: string
  rojo: string
  tono: Record<EstadoFila, { color: string; fondo: string }>
  chip: { color: string; fondo: string }
}

const PALETA: Record<TemaResumen, Paleta> = {
  claro: {
    fondo: '#FFFFFF',
    titulo: '#16275C',
    texto: '#1F2433',
    gris: '#6B7385',
    linea: '#E3E6EC',
    punto: '#B9BFCC',
    rojo: '#C8322B',
    tono: { pendiente: { color: '#C8322B', fondo: '#FBE9E7' }, esperando: { color: '#A8660A', fondo: '#FCF1DC' }, listo: { color: '#1E7B4B', fondo: '#E4F4EB' } },
    chip: { color: '#16275C', fondo: '#E8ECF7' },
  },
  oscuro: {
    fondo: '#12121C',
    titulo: '#A99BFF',
    texto: '#E9E9F1',
    gris: '#9090A6',
    linea: '#2A2A3C',
    punto: '#55556B',
    rojo: '#FF7A70',
    tono: { pendiente: { color: '#FF8A80', fondo: '#3A1D1F' }, esperando: { color: '#F2B85C', fondo: '#3A2E17' }, listo: { color: '#6FD49B', fondo: '#17332A' } },
    chip: { color: '#C9C1FF', fondo: '#2A2550' },
  },
}

function Seccion({ p, titulo, nota }: { p: Paleta; titulo: string; nota: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 30, paddingBottom: 10, borderBottom: `3px solid ${p.titulo}` }}>
      <span style={{ fontSize: 24, fontWeight: 700, color: p.titulo, letterSpacing: 2 }}>{titulo}</span>
      <span style={{ fontSize: 20, color: p.gris, marginLeft: 'auto' }}>{nota}</span>
    </div>
  )
}

function Vip({ p, f }: { p: Paleta; f: FilaVip }) {
  const t = p.tono[f.estado]
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', padding: '15px 4px', borderBottom: `1px solid ${p.linea}` }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingRight: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: 26, lineHeight: 1.3, color: f.estado === 'listo' ? p.gris : p.texto }}>
          <span style={{ fontWeight: 700, marginRight: 10 }}>{f.quien}</span>
          <span>{`— ${f.asunto}`}</span>
        </div>
        {f.cuando && <span style={{ fontSize: 19, color: p.gris, marginTop: 3 }}>{f.cuando}</span>}
      </div>
      <span style={{ fontSize: 19, fontWeight: 700, color: t.color, background: t.fondo, borderRadius: 6, padding: '6px 12px', marginTop: 2, whiteSpace: 'nowrap' }}>{f.etiqueta}</span>
    </div>
  )
}

function Tarea({ p, f, vencida }: { p: Paleta; f: FilaTarea; vencida: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', padding: '12px 4px', borderBottom: `1px solid ${p.linea}` }}>
      <div style={{ display: 'flex', width: 12, height: 12, borderRadius: 6, background: f.vencida ? p.rojo : p.punto, marginTop: 12, marginRight: 16 }} />
      {f.empresa && <span style={{ fontSize: 18, fontWeight: 700, color: p.chip.color, background: p.chip.fondo, borderRadius: 6, padding: '4px 10px', marginTop: 4, marginRight: 14, whiteSpace: 'nowrap' }}>{f.empresa}</span>}
      <span style={{ flex: 1, fontSize: 26, lineHeight: 1.35, color: p.texto, paddingRight: 20 }}>{f.texto}</span>
      {f.fecha && <span style={{ fontSize: 22, fontWeight: f.vencida ? 700 : 400, color: f.vencida ? p.rojo : p.gris, marginTop: 4, whiteSpace: 'nowrap' }}>{f.vencida ? `${vencida} · ${f.fecha}` : f.fecha}</span>}
    </div>
  )
}

function Vacio({ p, texto }: { p: Paleta; texto: string }) {
  return <span style={{ fontSize: 24, color: p.gris, padding: '16px 4px' }}>{texto}</span>
}

export function ChelseaImagen({ m }: { m: ModeloChelsea }) {
  const p = PALETA[m.tema]
  const t = m.textos
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: ANCHO_CHELSEA, height: m.alto, background: p.fondo, color: p.texto, padding: '50px 56px', fontFamily: 'Inter' }}>
      <span style={{ fontSize: 46, fontWeight: 700, color: p.titulo }}>{m.titulo}</span>
      <span style={{ fontSize: 23, color: p.gris, marginTop: 6 }}>{t.subtitulo}</span>
      <Seccion p={p} titulo={t.seccionVip} nota={t.notaVip} />
      {m.vip.length === 0 && <Vacio p={p} texto={t.sinVip} />}
      {m.vip.map((f, i) => (
        <Vip key={i} p={p} f={f} />
      ))}
      {m.vipDeMas > 0 && <Vacio p={p} texto={t.vipDeMas} />}
      <Seccion p={p} titulo={t.seccionTareas} nota={t.notaTareas} />
      {m.tareas.length === 0 && <Vacio p={p} texto={t.sinTareas} />}
      {m.tareas.map((f, i) => (
        <Tarea key={i} p={p} f={f} vencida={t.vencida} />
      ))}
      {m.tareasDeMas > 0 && <Vacio p={p} texto={t.tareasDeMas} />}
    </div>
  )
}

/** The PNG bytes of a summary (Chelsea's or Gabby's). */
export async function generarChelseaPng(m: ModeloChelsea): Promise<Uint8Array> {
  const res = new ImageResponse(<ChelseaImagen m={m} />, { width: ANCHO_CHELSEA, height: m.alto, fonts: fuentesInter() })
  return new Uint8Array(await res.arrayBuffer())
}
