// Fase 6-B: one mail account = one row of `cuentas_correo`, tied to a Google
// connection (the token) and carrying what the classifier needs to decide
// without a model: the three sender levels (ajuste 6c: 🔇 silencio = `ruido`,
// 📋 solo app = `solo_app`, 🔔 alerta = `vip`), the rules imported from n8n,
// and where/when to alert in Telegram.

import { createServerClient } from '@/lib/supabase-server'
import type { CuentaCorreo, NivelRemitente, ReglaCorreo, ReglaCorreoAccion } from '@/types'
import { cancunHm } from '@/lib/asistente/cancun'

const COLS = '*, conexion:conexiones_google(email, usa_gmail, activa, company_id)'

const ACCIONES: ReglaCorreoAccion[] = ['vip', 'ruido', 'solo_app', 'para_chelsea', 'lo_hago_yo', 'archivar', 'registrar']

function fila(r: Record<string, unknown>): CuentaCorreo {
  return {
    ...(r as unknown as CuentaCorreo),
    vip: normalizarLista(Array.isArray(r.vip) ? (r.vip as string[]) : []),
    ruido: normalizarLista(Array.isArray(r.ruido) ? (r.ruido as string[]) : []),
    solo_app: normalizarLista(Array.isArray(r.solo_app) ? (r.solo_app as string[]) : []),
    reglas: normalizarReglas(Array.isArray(r.reglas) ? (r.reglas as unknown[]) : []),
    horario_alertas: typeof r.horario_alertas === 'string' && r.horario_alertas ? r.horario_alertas : '07:00-21:00',
  }
}

/** Every account, with its connection's email and flags. */
export async function cargarCuentas(): Promise<CuentaCorreo[]> {
  const { data, error } = await createServerClient().from('cuentas_correo').select(COLS).order('created_at')
  if (error) throw new Error(`Supabase cuentas_correo: ${error.message}`)
  return ((data as Record<string, unknown>[]) ?? []).map(fila)
}

/** The accounts the cron reads: active here AND `usa_gmail` on the connection. */
export async function cuentasActivas(): Promise<CuentaCorreo[]> {
  return (await cargarCuentas()).filter((c) => c.activa && c.conexion?.usa_gmail && c.conexion?.activa)
}

export async function cuentaPorId(id: string): Promise<CuentaCorreo | null> {
  const { data, error } = await createServerClient().from('cuentas_correo').select(COLS).eq('id', id).maybeSingle<Record<string, unknown>>()
  if (error) throw new Error(`Supabase cuentas_correo: ${error.message}`)
  return data ? fila(data) : null
}

export type CambiosCuenta = Partial<Pick<CuentaCorreo, 'nombre' | 'duena' | 'activa' | 'vip' | 'ruido' | 'solo_app' | 'reglas' | 'chat_id_alertas' | 'alertar' | 'horario_alertas' | 'ultimo_history_id'>>

export async function guardarCuenta(id: string, cambios: CambiosCuenta): Promise<void> {
  const update: Record<string, unknown> = { ...cambios }
  if (cambios.vip) update.vip = normalizarLista(cambios.vip)
  if (cambios.ruido) update.ruido = normalizarLista(cambios.ruido)
  if (cambios.solo_app) update.solo_app = normalizarLista(cambios.solo_app)
  if (cambios.reglas) update.reglas = normalizarReglas(cambios.reglas)
  if (cambios.horario_alertas !== undefined && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(cambios.horario_alertas)) update.horario_alertas = '07:00-21:00'
  let { error } = await createServerClient().from('cuentas_correo').update(update).eq('id', id)
  if (error && update.solo_app !== undefined && /solo_app/.test(error.message)) {
    // Before sql/2026-11-asistente-fase6c-niveles.sql: the column is not there yet.
    console.warn(`[cuentas_correo] sin migración 6c (${error.message}); guardo sin solo_app`)
    delete update.solo_app
    ;({ error } = await createServerClient().from('cuentas_correo').update(update).eq('id', id))
  }
  if (error) throw new Error(`Supabase cuentas_correo: ${error.message}`)
}

/** Creates the account row for a connection that has none yet (Settings → Correo "Crear"). */
export async function crearCuenta(conexionId: string, nombre: string, duena: string | null): Promise<CuentaCorreo> {
  const { data, error } = await createServerClient()
    .from('cuentas_correo')
    .insert({ conexion_id: conexionId, nombre, duena, activa: false })
    .select(COLS)
    .single<Record<string, unknown>>()
  if (error) throw new Error(`Supabase cuentas_correo: ${error.message}`)
  return fila(data)
}

// ── Lists and rules ──────────────────────────────────────────────────────

/** One email or domain per line (or array item): lowercase, trimmed, no duplicates, no "@" prefix on domains. */
export function normalizarLista(entrada: string | string[]): string[] {
  const items = Array.isArray(entrada) ? entrada : entrada.split(/[\n,;]+/)
  const out = new Set<string>()
  for (const raw of items) {
    const s = String(raw ?? '').trim().toLowerCase().replace(/^@/, '').replace(/^<|>$/g, '')
    if (s) out.add(s)
  }
  return Array.from(out)
}

export function normalizarReglas(entrada: unknown[]): ReglaCorreo[] {
  const out: ReglaCorreo[] = []
  for (const raw of entrada) {
    const r = (raw ?? {}) as Record<string, unknown>
    const match = String(r.match ?? '').trim().toLowerCase()
    const accion = String(r.accion ?? '').trim().toLowerCase() as ReglaCorreoAccion
    if (!match || !ACCIONES.includes(accion)) continue
    out.push({ match, accion, alerta: r.alerta === true })
  }
  return out
}

/** The list entry an address matches: the exact email, or its domain (or a parent domain). */
export function coincideLista(lista: string[], email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return null
  const dominio = e.split('@')[1] ?? ''
  for (const item of lista) {
    if (item.includes('@')) {
      if (item === e) return item
    } else if (dominio === item || dominio.endsWith(`.${item}`)) {
      return item
    }
  }
  return null
}

/** The level a sender is on, in evaluation order: silencio > alerta > solo app. Null → the model decides. */
export function nivelDe(cuenta: Pick<CuentaCorreo, 'vip' | 'ruido' | 'solo_app'>, email: string | null | undefined): { nivel: NivelRemitente; match: string } | null {
  const silencio = coincideLista(cuenta.ruido, email)
  if (silencio) return { nivel: 'silencio', match: silencio }
  const alerta = coincideLista(cuenta.vip, email)
  if (alerta) return { nivel: 'alerta', match: alerta }
  const soloApp = coincideLista(cuenta.solo_app, email)
  if (soloApp) return { nivel: 'solo_app', match: soloApp }
  return null
}

/** The three lists by level (the columns keep their old names). */
export const COLUMNA_DE_NIVEL: Record<NivelRemitente, 'ruido' | 'solo_app' | 'vip'> = { silencio: 'ruido', solo_app: 'solo_app', alerta: 'vip' }

/** Mailboxes anyone can have: there the whole domain says nothing, so the exact email is what gets listed. */
const DOMINIOS_GENERICOS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'mail.com'])

/** What goes on a list when learning from one mail: the domain, or the full address on a generic mailbox. Null when there is no sender. */
export function claveDeRemitente(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  const dominio = e.split('@')[1] ?? ''
  if (!dominio) return null
  return DOMINIOS_GENERICOS.has(dominio) ? e : dominio
}

/**
 * Ajuste 6c: puts `clave` on ONE level of the account, removing it from
 * the other two. Returns the new lists and where the key was before.
 */
export function moverANivel(cuenta: Pick<CuentaCorreo, 'vip' | 'ruido' | 'solo_app'>, clave: string, nivel: NivelRemitente): { listas: Pick<CuentaCorreo, 'vip' | 'ruido' | 'solo_app'>; anterior: NivelRemitente | null; yaEstaba: boolean } {
  const k = normalizarLista([clave])[0]
  const listas = { vip: [...cuenta.vip], ruido: [...cuenta.ruido], solo_app: [...cuenta.solo_app] }
  let anterior: NivelRemitente | null = null
  for (const n of ['silencio', 'solo_app', 'alerta'] as NivelRemitente[]) {
    const col = COLUMNA_DE_NIVEL[n]
    if (listas[col].includes(k)) {
      if (n === nivel) return { listas, anterior: null, yaEstaba: true }
      anterior = n
      listas[col] = listas[col].filter((x) => x !== k)
    }
  }
  listas[COLUMNA_DE_NIVEL[nivel]].push(k)
  return { listas, anterior, yaEstaba: false }
}

/** The first rule that applies: by sender (email/domain) or by a piece of the subject (`^accepted:` = the subject starts with it). */
export function reglaQueAplica(reglas: ReglaCorreo[], correo: { de_email: string | null; asunto: string | null }): ReglaCorreo | null {
  const asunto = (correo.asunto ?? '').trim().toLowerCase()
  for (const r of reglas) {
    if (r.match.includes('@') || /^[a-z0-9.-]+\.[a-z]{2,}$/.test(r.match)) {
      if (coincideLista([r.match], correo.de_email)) return r
    } else if (r.match.startsWith('^')) {
      if (r.match.length > 1 && asunto.startsWith(r.match.slice(1).trimStart())) return r
    } else if (asunto.includes(r.match)) {
      return r
    }
  }
  return null
}

/** "07:00-21:00" → is the Cancún wall clock inside it? A window that wraps midnight ("22:00-06:00") works too. */
export function dentroDeHorario(horario: string, now: Date = new Date()): boolean {
  const m = horario.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/)
  if (!m) return true
  const desde = `${m[1]}:${m[2]}`
  const hasta = `${m[3]}:${m[4]}`
  const hm = cancunHm(now)
  if (desde <= hasta) return hm >= desde && hm < hasta
  return hm >= desde || hm < hasta
}
