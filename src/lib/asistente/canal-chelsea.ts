// Fase 18: lo que va al canal de Chelsea. Gabby es quien lo lee: es su
// chat aparte para todo lo de Chelsea (alertas de sus correos al momento,
// y cada mañana un resumen de lo que Chelsea tiene abierto), para poder
// recordárselo sin que se mezcle con su propio día.
//
// El resumen NO guarda números de lista ("listo 3"): esos son de la lista
// de Gabita en su chat. Aquí se decide con los botones de cada alerta.

import type { CuentaCorreo } from '@/types'
import { esCuentaDeChelsea, esEmpresaDeChelsea } from './de-chelsea'
import { cargarCuentas } from '@/lib/correo/cuentas'
import { correosPendientes, grupoDe, quienCorto, type CorreoLite } from '@/lib/correo/pendientes'
import { mensajeError } from '@/lib/errores'
import { cancunYmd, formatCortoEs, formatDiaLargoEs } from './cancun'
import { cargarPanorama } from './narracion'
import { chelseaChatId, escapeHtml, sendTelegram } from './telegram'

export { esCuentaDeChelsea, esEmpresaDeChelsea }

function hace(iso: string | null, hoy: string): string {
  if (!iso) return ''
  const dia = cancunYmd(new Date(iso))
  const dias = Math.round((Date.parse(hoy) - Date.parse(dia)) / 86_400_000)
  return dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`
}

const MAX_LINEAS = 12

function lineasCorreo(correos: CorreoLite[], hoy: string): string[] {
  const out = correos.slice(0, MAX_LINEAS).map((c) => `• ${c.urgencia === 'alta' ? '🔺 ' : ''}<b>${escapeHtml(quienCorto(c))}</b> — ${escapeHtml(c.asunto ?? '(sin asunto)')} · ${hace(c.recibido_en, hoy)}`)
  if (correos.length > MAX_LINEAS) out.push(`(+${correos.length - MAX_LINEAS} más en GabbyHQ → Correos)`)
  return out
}

export interface ResumenChelsea {
  texto: string
  correos: number
  paraChelsea: number
  tareas: number
}

/** The morning summary of Chelsea's channel. Pure over what it is given, so it can be tested. */
export function armarResumenChelsea(
  d: { nuevos: CorreoLite[]; paraChelsea: CorreoLite[]; tareas: { text: string; due_date: string | null }[] },
  hoy: string
): ResumenChelsea {
  const partes: string[] = [`📋 <b>Chelsea · ${formatDiaLargoEs(hoy)}</b>`]
  if (d.paraChelsea.length > 0) partes.push([`📨 <b>Le pasaste y no ha contestado (${d.paraChelsea.length})</b>`, ...lineasCorreo(d.paraChelsea, hoy)].join('\n'))
  // Ajuste 18a: solo lo que pide algo (urgente, o alguien espera respuesta). Facturas, boletines y avisos
  // se cuentan en una línea: están en GabbyHQ → Correos, no hace falta leerlos uno por uno aquí.
  const importan = d.nuevos.filter((c) => grupoDe(c) !== 'resto' || c.vip)
  const ruido = d.nuevos.length - importan.length
  if (importan.length > 0) partes.push([`📧 <b>Correos suyos que piden algo (${importan.length})</b>`, ...lineasCorreo(importan, hoy)].join('\n'))
  if (ruido > 0) partes.push(`📭 Y ${ruido} ${ruido === 1 ? 'aviso o boletín' : 'avisos y boletines'} sin decidir (GabbyHQ → Correos).`)
  if (d.tareas.length > 0) {
    const lineas = d.tareas.slice(0, MAX_LINEAS).map((t) => {
      const vencida = !!t.due_date && t.due_date < hoy
      return `• ${vencida ? '🔺 ' : ''}${escapeHtml(t.text)}${t.due_date ? ` · ${vencida ? 'vencida ' : ''}${formatCortoEs(t.due_date)}` : ''}`
    })
    if (d.tareas.length > MAX_LINEAS) lineas.push(`(+${d.tareas.length - MAX_LINEAS} más en el tablero)`)
    partes.push([`✅ <b>Tareas de Chelsea (${d.tareas.length})</b>`, ...lineas].join('\n'))
  }
  if (partes.length === 1) partes.push('Nada pendiente de Chelsea hoy 🎉')
  return { texto: partes.join('\n\n'), correos: importan.length, paraChelsea: d.paraChelsea.length, tareas: d.tareas.length }
}

export async function construirResumenChelsea(hoy: string = cancunYmd()): Promise<ResumenChelsea> {
  const [cuentas, panorama] = await Promise.all([cargarCuentas().catch(() => [] as CuentaCorreo[]), cargarPanorama(hoy)])
  const suyas = cuentas.filter(esCuentaDeChelsea)
  const pendientes = (await Promise.all(suyas.map((c) => correosPendientes({ cuentaId: c.id })))).flat()
  const empresas = new Set(panorama.companies.filter(esEmpresaDeChelsea).map((c) => c.id))
  const tareas = panorama.tasks
    .filter((t) => t.company_id && empresas.has(t.company_id))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .map((t) => ({ text: t.text, due_date: t.due_date }))
  return armarResumenChelsea({ nuevos: pendientes.filter((c) => c.estado === 'nuevo'), paraChelsea: pendientes.filter((c) => c.estado === 'para_chelsea'), tareas }, hoy)
}

/**
 * Sends the summary to Chelsea's channel. Returns null (and sends nothing)
 * when the channel is not configured. Never throws: the morning alarm of
 * Gabby must not fail because of this.
 */
export async function enviarResumenChelsea(opts: { test?: boolean } = {}): Promise<ResumenChelsea | null> {
  const chat = chelseaChatId()
  if (chat === null) return null
  try {
    const r = await construirResumenChelsea()
    await sendTelegram(chat, (opts.test ? '🧪 <i>prueba manual</i>\n' : '') + r.texto, { html: true, tag: 'canal-chelsea' })
    return r
  } catch (err) {
    console.error(`[canal-chelsea] resumen: ${mensajeError(err)}`)
    return null
  }
}
