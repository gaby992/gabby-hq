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
import { correosPendientes, correosVipRecientes, pideAlgo, quienCorto, type CorreoLite } from '@/lib/correo/pendientes'
import { mensajeError } from '@/lib/errores'
import { cancunYmd } from './cancun'
import { cargarPanorama } from './narracion'
import { modeloChelsea, type ModeloChelsea } from './chelsea-imagen-datos'
import { chelseaChatId, escapeHtml, sendPhoto, sendTelegram } from './telegram'

export { esCuentaDeChelsea, esEmpresaDeChelsea }

/** Ajuste 18b: el canal de Chelsea va en INGLÉS (es lo que Gabby le copia y le pega a ella). */
const T = {
  dia: (ymd: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`)),
  corta: (ymd: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`)),
  hace: (dias: number) => (dias <= 0 ? 'today' : dias === 1 ? 'yesterday' : `${dias} days ago`),
  sinAsunto: '(no subject)',
  masCorreos: (n: number) => `(+${n} more in GabbyHQ → Correos)`,
  masTareas: (n: number) => `(+${n} more on the board)`,
  pasados: (n: number) => `Passed to Chelsea, no reply yet (${n})`,
  importan: (n: number) => `Emails that need something (${n})`,
  ruido: (n: number) => `Plus ${n} ${n === 1 ? 'notification or newsletter' : 'notifications and newsletters'} still undecided (GabbyHQ → Correos).`,
  tareas: (n: number) => `Chelsea's tasks (${n})`,
  vencida: 'overdue ',
  nada: 'Nothing pending for Chelsea today 🎉',
}

function hace(iso: string | null, hoy: string): string {
  if (!iso) return ''
  const dia = cancunYmd(new Date(iso))
  return T.hace(Math.round((Date.parse(hoy) - Date.parse(dia)) / 86_400_000))
}

const MAX_LINEAS = 12

function lineasCorreo(correos: CorreoLite[], hoy: string): string[] {
  const out = correos.slice(0, MAX_LINEAS).map((c) => `• ${c.urgencia === 'alta' ? '🔺 ' : ''}<b>${escapeHtml(quienCorto(c))}</b> — ${escapeHtml(c.asunto ?? T.sinAsunto)} · ${hace(c.recibido_en, hoy)}`)
  if (correos.length > MAX_LINEAS) out.push(T.masCorreos(correos.length - MAX_LINEAS))
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
  const partes: string[] = [`📋 <b>Chelsea · ${T.dia(hoy)}</b>`]
  if (d.paraChelsea.length > 0) partes.push([`📨 <b>${T.pasados(d.paraChelsea.length)}</b>`, ...lineasCorreo(d.paraChelsea, hoy)].join('\n'))
  // Ajuste 18a: solo lo que pide algo (urgente, VIP, o alguien espera respuesta). Facturas, boletines y avisos
  // se cuentan en una línea: están en GabbyHQ → Correos, no hace falta leerlos uno por uno aquí.
  const importan = d.nuevos.filter(pideAlgo)
  const ruido = d.nuevos.length - importan.length
  if (importan.length > 0) partes.push([`📧 <b>${T.importan(importan.length)}</b>`, ...lineasCorreo(importan, hoy)].join('\n'))
  if (ruido > 0) partes.push(`📭 ${T.ruido(ruido)}`)
  if (d.tareas.length > 0) {
    const lineas = d.tareas.slice(0, MAX_LINEAS).map((t) => {
      const vencida = !!t.due_date && t.due_date < hoy
      return `• ${vencida ? '🔺 ' : ''}${escapeHtml(t.text)}${t.due_date ? ` · ${vencida ? T.vencida : ''}${T.corta(t.due_date)}` : ''}`
    })
    if (d.tareas.length > MAX_LINEAS) lineas.push(T.masTareas(d.tareas.length - MAX_LINEAS))
    partes.push([`✅ <b>${T.tareas(d.tareas.length)}</b>`, ...lineas].join('\n'))
  }
  if (partes.length === 1) partes.push(T.nada)
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

/** Ajuste 18c: what the PICTURE shows — the VIP mails of Chelsea's accounts (any state, 7 days) and all her open tasks. */
export async function construirModeloChelsea(hoy: string = cancunYmd()): Promise<ModeloChelsea> {
  const [cuentas, panorama] = await Promise.all([cargarCuentas().catch(() => [] as CuentaCorreo[]), cargarPanorama(hoy)])
  const vip = (await Promise.all(cuentas.filter(esCuentaDeChelsea).map((c) => correosVipRecientes({ cuenta: c })))).flat()
  const empresas = new Set(panorama.companies.filter(esEmpresaDeChelsea).map((c) => c.id))
  const tareas = panorama.tasks.filter((t) => t.company_id && empresas.has(t.company_id)).map((t) => ({ text: t.text, due_date: t.due_date }))
  return modeloChelsea({ vip, tareas }, hoy, (d) => cancunYmd(d))
}

/**
 * Ajuste 18d: the same picture for Gabby, in Spanish and dark — the VIP mails of HER accounts
 * (not Chelsea's) and her tasks of today plus what is overdue, each with its company.
 */
export async function construirModeloGabby(hoy: string = cancunYmd()): Promise<ModeloChelsea> {
  const [cuentas, panorama] = await Promise.all([cargarCuentas().catch(() => [] as CuentaCorreo[]), cargarPanorama(hoy, { sinChelsea: true })])
  const vip = (await Promise.all(cuentas.filter((c) => !esCuentaDeChelsea(c)).map((c) => correosVipRecientes({ cuenta: c })))).flat()
  const nombre = new Map(panorama.companies.map((c) => [c.id, c.name]))
  const tareas = panorama.tasks
    .filter((t) => !!t.due_date && t.due_date <= hoy)
    .map((t) => ({ text: t.text, due_date: t.due_date, empresa: t.company_id ? nombre.get(t.company_id) ?? null : null }))
  return modeloChelsea({ vip, tareas }, hoy, (d) => cancunYmd(d), { nombre: 'Gabby', idioma: 'es', tema: 'oscuro', seccionTareas: 'TUS TAREAS · HOY Y VENCIDAS' })
}

/** Sends Gabby's picture to her chat. Throws on failure: the command reports it. */
export async function enviarResumenGabby(chatId: number): Promise<void> {
  const m = await construirModeloGabby()
  const { generarChelseaPng } = await import('./chelsea-imagen')
  await sendPhoto(chatId, await generarChelseaPng(m), { tag: 'resumen-gabby' })
}

/**
 * Sends the summary to Chelsea's channel. Returns null (and sends nothing)
 * when the channel is not configured. Never throws: the morning alarm of
 * Gabby must not fail because of this.
 *
 * Ajuste 18c: it goes as a PICTURE (VIP mails with what is left to do + all
 * her tasks). If the picture cannot be drawn or sent, the text of before
 * goes instead: the summary never goes missing.
 */
export async function enviarResumenChelsea(opts: { test?: boolean } = {}): Promise<ResumenChelsea | null> {
  const chat = chelseaChatId()
  if (chat === null) return null
  try {
    const m = await construirModeloChelsea()
    const { generarChelseaPng } = await import('./chelsea-imagen')
    await sendPhoto(chat, await generarChelseaPng(m), { caption: opts.test ? 'test' : undefined, tag: 'canal-chelsea' })
    return { texto: m.titulo, correos: m.vipPendientes, paraChelsea: m.vip.filter((f) => f.etiqueta === 'Waiting on Chelsea').length, tareas: m.tareas.length + m.tareasDeMas }
  } catch (err) {
    console.error(`[canal-chelsea] imagen: ${mensajeError(err)} — va el texto`)
  }
  try {
    const r = await construirResumenChelsea()
    await sendTelegram(chat, (opts.test ? '🧪 <i>test</i>\n' : '') + r.texto, { html: true, tag: 'canal-chelsea' })
    return r
  } catch (err) {
    console.error(`[canal-chelsea] resumen: ${mensajeError(err)}`)
    return null
  }
}
