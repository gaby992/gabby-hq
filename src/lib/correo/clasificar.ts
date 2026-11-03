// Fase 6-D: the classifier v2 — where the n8n triage failed.
//
//   1. Deterministic rules first, no model (ajuste 6c, in this order):
//      🔇 silencio → registrado, never shown; 🔔 alerta → alta + Telegram;
//      📋 solo app → the model classifies it but it never alerts; a rule
//      imported from n8n → its action; failed payment / AMEX → alta + pago.
//   2. The LLM only for what the rules did not settle: urgency, type,
//      category, confidence, a ONE-line summary (in a thread: only what is
//      new, the previous summaries are given) and the reason.
//
// Input: the mail's fields (sender, subject, body capped at 3000 chars).
// Output: { urgencia, tipo, categoria, confianza, resumen, razon } plus the
// state the rules decided (if any) and whether the alert is forced.

import type { CorreoEstado, CorreoTipo, CorreoUrgencia, CuentaCorreo } from '@/types'
import { llamarLlm, llmConfigCorreo, nombreModelo, type LlmTarget } from '@/lib/asistente/llm'
import { nivelDe, reglaQueAplica } from './cuentas'
import { mensajeError } from '@/lib/errores'

export interface EntradaCorreo {
  de_nombre: string | null
  de_email: string | null
  asunto: string | null
  cuerpo_texto: string | null
  recibido_en: string | null
  /** Summaries of the earlier mails of the same thread, oldest first (for the differential summary). */
  hilo_previo?: string[]
}

export interface Clasificacion {
  urgencia: CorreoUrgencia
  tipo: CorreoTipo
  categoria: string
  confianza: number
  resumen: string
  razon: string
}

export interface Resultado {
  clas: Clasificacion
  /** The state the rules decided; 'nuevo' when the mail waits for a decision. */
  estado: CorreoEstado
  /** VIP or a rule with `alerta`: alert whatever the urgency says. */
  alertaForzada: boolean
  /** Ajuste 6-6: the sender is on the 🔔 alerta list (or a VIP rule) — stored on the row, the lists keep its "respondido" 48 h. */
  vip: boolean
  /** Ajuste 6c: the sender is on the 📋 solo app list — never a Telegram alert, whatever the urgency. */
  soloApp: boolean
  /** Which model answered, or null when no model was needed. */
  modelo: string | null
  tokensIn: number
  tokensOut: number
  ms: number
}

export const TIPOS: CorreoTipo[] = ['necesita_respuesta', 'pedido_de_tarea', 'fyi', 'notificacion', 'marketing', 'reunion', 'pago']
export const URGENCIAS: CorreoUrgencia[] = ['alta', 'media', 'baja']
export const CATEGORIAS = ['cliente', 'facturacion_pagos', 'operativo', 'plataformas', 'informativo', 'promocional', 'personal']

export const MAX_TOKENS = 350
export const TIMEOUT_MS = 20_000

const RE_PAGO_FALLIDO = /(payment|pago|cobro|cargo|charge|invoice|factura)[^.\n]{0,40}(failed|fail|declin|rechaz|unsuccessful|could not|no se pudo|vencid|past due|overdue)|(declined|rechazad[ao]|fallid[ao])[^.\n]{0,30}(payment|pago|card|tarjeta)|past due|overdue|american\s*express|\bamex\b/i

interface Regla {
  fija: Partial<Clasificacion>
  estado?: CorreoEstado
  sinLlm: boolean
  alerta: boolean
  razon: string
  vip?: boolean
  soloApp?: boolean
}

/** What the lists and rules decide before any model. Null → nothing deterministic. */
export function clasificarPorReglas(c: EntradaCorreo, cuenta: Pick<CuentaCorreo, 'vip' | 'ruido' | 'solo_app' | 'reglas'>): Regla | null {
  const nivel = nivelDe(cuenta, c.de_email)
  if (nivel?.nivel === 'silencio') return { fija: { urgencia: 'baja', tipo: 'notificacion', categoria: 'informativo', confianza: 1 }, estado: 'registrado', sinLlm: true, alerta: false, razon: `silencio: ${nivel.match}` }
  if (nivel?.nivel === 'alerta') return { fija: { urgencia: 'alta', confianza: 1 }, sinLlm: false, alerta: true, vip: true, razon: `alerta: ${nivel.match}` }
  if (nivel?.nivel === 'solo_app') return { fija: {}, sinLlm: false, alerta: false, soloApp: true, razon: `solo app: ${nivel.match}` }
  const regla = reglaQueAplica(cuenta.reglas, { de_email: c.de_email, asunto: c.asunto })
  if (regla) {
    switch (regla.accion) {
      case 'vip':
        return { fija: { urgencia: 'alta', confianza: 1 }, sinLlm: false, alerta: true, vip: true, razon: `regla VIP: ${regla.match}` }
      case 'ruido':
        return { fija: { urgencia: 'baja', tipo: 'notificacion', categoria: 'informativo', confianza: 1 }, estado: 'registrado', sinLlm: true, alerta: false, razon: `regla ruido: ${regla.match}` }
      case 'para_chelsea':
        return { fija: { urgencia: 'media', tipo: 'fyi', categoria: 'operativo', confianza: 1 }, estado: 'para_chelsea', sinLlm: true, alerta: regla.alerta === true, razon: `regla → Chelsea: ${regla.match}` }
      case 'lo_hago_yo':
        return { fija: { urgencia: 'media', tipo: 'pedido_de_tarea', categoria: 'operativo', confianza: 1 }, estado: 'lo_hago_yo', sinLlm: true, alerta: regla.alerta === true, razon: `regla → Gabby: ${regla.match}` }
      case 'archivar':
        return { fija: { urgencia: 'baja', tipo: 'notificacion', categoria: 'informativo', confianza: 1 }, estado: 'archivado', sinLlm: true, alerta: false, razon: `regla archivar: ${regla.match}` }
      case 'registrar':
        return { fija: { urgencia: 'baja', tipo: 'fyi', categoria: 'informativo', confianza: 1 }, estado: 'registrado', sinLlm: true, alerta: false, razon: `regla registrar: ${regla.match}` }
    }
  }
  const texto = `${c.asunto ?? ''}\n${(c.cuerpo_texto ?? '').slice(0, 600)}`
  if (RE_PAGO_FALLIDO.test(texto)) return { fija: { urgencia: 'alta', tipo: 'pago', categoria: 'facturacion_pagos', confianza: 0.9 }, sinLlm: true, alerta: false, razon: 'pago fallido / AMEX (regla)' }
  return null
}

// ── LLM ──────────────────────────────────────────────────────────────────

export function systemPromptClasificador(): string {
  return [
    'Eres el clasificador de correo de una agencia de marketing (Interactive Marketing, Cancún) que atiende clientes en EE. UU. Lees UN correo y respondes SOLO un JSON, nada más.',
    '',
    'JSON: {"urgencia":"alta|media|baja","tipo":"necesita_respuesta|pedido_de_tarea|fyi|notificacion|marketing|reunion|pago","categoria":"cliente|facturacion_pagos|operativo|plataformas|informativo|promocional|personal","confianza":0.0-1.0,"resumen":"…","razon":"…"}',
    '',
    'URGENCIA (lo que más importa acertar):',
    '- alta: un cliente o socio pide algo con fecha cercana o está esperando respuesta; un pago fallido, una cuenta suspendida, un dominio/sitio caído, una queja; algo que si no se atiende HOY o mañana cuesta dinero o un cliente.',
    '- media: pide algo sin prisa, propone reunión, manda información que hay que leer y responder esta semana.',
    '- baja: no requiere acción (notificación automática, newsletter, promoción, recibo de pago exitoso, confirmación).',
    'Un correo automático (noreply, notificaciones de plataformas, "your report is ready") NUNCA es alta salvo que anuncie un fallo, un cobro rechazado o una suspensión.',
    '',
    'TIPO: necesita_respuesta = una persona espera contestación; pedido_de_tarea = pide hacer algo concreto (cambiar, crear, enviar, revisar); reunion = propone/confirma una cita o llamada; pago = factura, cobro, recibo, pago fallido; marketing = promoción/newsletter; notificacion = automático de una plataforma; fyi = informa, no pide nada.',
    'CATEGORIA: cliente (de un cliente de la agencia), facturacion_pagos, operativo (proveedores, equipo, logística), plataformas (Google Ads, Meta, SEO, hosting, dominios, herramientas), informativo, promocional, personal.',
    '',
    'RESUMEN: UNA línea en español, máximo 25 palabras, concreta: quién quiere qué y para cuándo. Si recibes "RESÚMENES PREVIOS DEL HILO", resume SOLO lo nuevo de este correo (qué cambió, qué pide ahora), sin repetir lo anterior.',
    'RAZON: una frase corta de por qué esa urgencia y ese tipo.',
    'CONFIANZA: 0.9+ si es obvio; 0.5 o menos si dudas entre dos opciones.',
    'No inventes nada que no esté en el correo.',
  ].join('\n')
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function extraerJson(text: string): Record<string, unknown> {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a < 0 || b <= a) throw new Error('la respuesta no trae JSON')
    return JSON.parse(t.slice(a, b + 1))
  }
}

/** Takes the model's JSON and keeps only valid values. */
export function validarClasificacion(raw: Record<string, unknown>, asunto: string): Clasificacion {
  const u = str(raw.urgencia).toLowerCase() as CorreoUrgencia
  const t = str(raw.tipo).toLowerCase() as CorreoTipo
  const cat = str(raw.categoria).toLowerCase()
  const conf = Number(raw.confianza)
  return {
    urgencia: URGENCIAS.includes(u) ? u : 'media',
    tipo: TIPOS.includes(t) ? t : 'fyi',
    categoria: CATEGORIAS.includes(cat) ? cat : 'informativo',
    confianza: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
    resumen: (str(raw.resumen) || asunto).replace(/\s+/g, ' ').slice(0, 240),
    razon: str(raw.razon).slice(0, 240),
  }
}

export function userPromptClasificador(c: EntradaCorreo): string {
  const lines = [
    `DE: ${c.de_nombre ?? ''} <${c.de_email ?? ''}>`,
    `ASUNTO: ${c.asunto ?? '(sin asunto)'}`,
    `RECIBIDO: ${c.recibido_en ?? ''}`,
  ]
  if (c.hilo_previo && c.hilo_previo.length > 0) {
    lines.push('', 'RESÚMENES PREVIOS DEL HILO (de más viejo a más nuevo):', ...c.hilo_previo.map((r) => `- ${r}`))
  }
  lines.push('', 'CUERPO:', (c.cuerpo_texto ?? '').slice(0, 3000) || '(vacío)')
  return lines.join('\n')
}

export async function clasificarConLlm(c: EntradaCorreo, target: LlmTarget = llmConfigCorreo()): Promise<Clasificacion & { modelo: string; tokensIn: number; tokensOut: number; ms: number }> {
  const r = await llamarLlm(target, systemPromptClasificador(), userPromptClasificador(c), { maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS, json: true })
  const clas = validarClasificacion(extraerJson(r.text), c.asunto ?? '(sin asunto)')
  return { ...clas, modelo: nombreModelo(target), tokensIn: r.tokensIn, tokensOut: r.tokensOut, ms: r.ms }
}

/**
 * Rules, then the model only if needed. Never throws: a model failure
 * yields urgencia media / fyi with the failure in `razon`, so the mail
 * still shows up in the feed (and a VIP still alerts).
 */
export async function clasificar(c: EntradaCorreo, cuenta: Pick<CuentaCorreo, 'vip' | 'ruido' | 'solo_app' | 'reglas'>, target?: LlmTarget): Promise<Resultado> {
  const asunto = c.asunto ?? '(sin asunto)'
  const regla = clasificarPorReglas(c, cuenta)
  const base: Clasificacion = { urgencia: 'media', tipo: 'fyi', categoria: 'informativo', confianza: 0, resumen: asunto, razon: '' }
  const vip = regla?.vip === true
  const soloApp = regla?.soloApp === true
  if (regla?.sinLlm) {
    return { clas: { ...base, ...regla.fija, razon: regla.razon }, estado: regla.estado ?? 'nuevo', alertaForzada: regla.alerta, vip, soloApp, modelo: null, tokensIn: 0, tokensOut: 0, ms: 0 }
  }
  try {
    const llm = await clasificarConLlm(c, target)
    const { modelo, tokensIn, tokensOut, ms, ...clas } = llm
    const final: Clasificacion = regla ? { ...clas, ...regla.fija, razon: `${regla.razon} · ${clas.razon}` } : clas
    return { clas: final, estado: regla?.estado ?? 'nuevo', alertaForzada: regla?.alerta ?? false, vip, soloApp, modelo, tokensIn, tokensOut, ms }
  } catch (err) {
    // Ajuste 6-1: the row (and the alert built from it) gets a generic
    // reason by KIND, never the provider's text — a key once travelled that way.
    console.error(`[correo] clasificar falló (${asunto.slice(0, 40)}): ${mensajeError(err)}`)
    const final: Clasificacion = { ...base, ...(regla?.fija ?? {}), razon: `${regla ? `${regla.razon} · ` : ''}⚠️ clasificador no disponible (${tipoDeFallo(err)})` }
    return { clas: final, estado: regla?.estado ?? 'nuevo', alertaForzada: regla?.alerta ?? false, vip, soloApp, modelo: null, tokensIn: 0, tokensOut: 0, ms: 0 }
  }
}

/** "config" (env vars), "timeout", "respuesta" (no JSON) or "proveedor" (HTTP error) — nothing else leaves the server. */
export function tipoDeFallo(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  if (/no está definida|inválid[oa]/i.test(m)) return 'config'
  if (/timeout/i.test(m)) return 'timeout'
  if (/JSON/i.test(m)) return 'respuesta'
  return 'proveedor'
}

/**
 * Fase 6-F / ajuste 6-4: an individual alert ONLY for 🔔 alerta (or a rule
 * that asks for it) and urgencia alta. Everything else waits in the lists
 * ("correos", the 8:00 and the 6:00 pm). Within the account's hours.
 * Ajuste 6c: a 📋 solo app sender never alerts, even when the model says alta.
 */
export function mereceAlerta(r: Pick<Resultado, 'clas' | 'alertaForzada' | 'estado'> & { soloApp?: boolean }): boolean {
  if (r.estado === 'registrado' || r.estado === 'archivado') return false
  if (r.soloApp) return false
  if (r.alertaForzada) return true
  return r.clas.urgencia === 'alta'
}
