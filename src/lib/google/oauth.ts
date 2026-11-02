// Google OAuth for the account connected in Settings → Conexiones (fase 5).
// What belongs to the APP (client id / secret, encryption key) is in Vercel;
// what belongs to ONE ACCOUNT (its refresh token, its email) is a row in
// `conexiones_google`, token encrypted. Adding Chelsea's account later is
// one more "Conectar", no env var changes.

import { createServerClient } from '@/lib/supabase-server'
import { cifrar, descifrar } from './crypto'

/** Calendar now; Gmail already granted so fase 6 does not ask again. */
export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
]

export class GoogleError extends Error {}

export interface ConexionRow {
  id: string
  email: string
  refresh_token_enc: string
  scopes: string
  conectado_en: string
  ultimo_uso: string | null
  activa: boolean
  /** Fase 6 roles (null before the fase 6 SQL runs). */
  usa_calendar?: boolean | null
  usa_gmail?: boolean | null
  duena?: string | null
  company_id?: string | null
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

export function redirectUri(): string {
  return `${appUrl()}/api/google/oauth/callback`
}

function credenciales(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID?.trim()
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!id || !secret) throw new GoogleError('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET no están definidas')
  return { id, secret }
}

export function googleConfigurado(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_ENCRYPTION_KEY)
}

/** The consent-screen URL. `state` ties the callback to the browser that started it. */
export function urlDeAutorizacion(state: string): string {
  const { id } = credenciales()
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Without this Google only sends the refresh token the first time.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  id_token?: string
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = credenciales()
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }).toString(),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.access_token) {
    throw new GoogleError(json?.error_description ?? json?.error ?? `Google token HTTP ${res.status}`)
  }
  return json as TokenResponse
}

/** Code → tokens → email → encrypted row (upsert by email). Returns the email. */
export async function conectarConCodigo(code: string): Promise<string> {
  const tokens = await tokenRequest({ code, redirect_uri: redirectUri(), grant_type: 'authorization_code' })
  if (!tokens.refresh_token) {
    throw new GoogleError('Google no devolvió refresh_token. Quita el acceso en myaccount.google.com/permissions y vuelve a conectar.')
  }
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const perfil = await info.json().catch(() => null)
  const email = String(perfil?.email ?? '').trim().toLowerCase()
  if (!email) throw new GoogleError('no pude leer el email de la cuenta')

  const { error } = await createServerClient()
    .from('conexiones_google')
    .upsert(
      {
        email,
        refresh_token_enc: cifrar(tokens.refresh_token),
        scopes: tokens.scope ?? SCOPES.join(' '),
        conectado_en: new Date().toISOString(),
        activa: true,
      },
      { onConflict: 'email' }
    )
  if (error) throw new GoogleError(`Supabase conexiones_google: ${error.message}`)
  return email
}

/**
 * The account Calendar writes to (fase 6-A): the one with `usa_calendar`
 * on — there is at most one. Before the fase 6 SQL runs (no flags yet),
 * the most recently connected active account, as in fase 5.
 */
export async function conexionActiva(): Promise<ConexionRow | null> {
  const { data, error } = await createServerClient()
    .from('conexiones_google')
    .select('*')
    .eq('activa', true)
    .order('conectado_en', { ascending: false })
  if (error) throw new GoogleError(`Supabase conexiones_google: ${error.message}`)
  const rows = (data as ConexionRow[]) ?? []
  return rows.find((r) => r.usa_calendar === true) ?? (rows.some((r) => r.usa_calendar === false) ? null : rows[0] ?? null)
}

/** The accounts whose mail the assistant reads (fase 6): `usa_gmail` on. */
export async function conexionesGmail(): Promise<ConexionRow[]> {
  const { data, error } = await createServerClient()
    .from('conexiones_google')
    .select('*')
    .eq('activa', true)
    .eq('usa_gmail', true)
  if (error) throw new GoogleError(`Supabase conexiones_google: ${error.message}`)
  return (data as ConexionRow[]) ?? []
}

export async function conexionPorId(id: string): Promise<ConexionRow | null> {
  const { data, error } = await createServerClient().from('conexiones_google').select('*').eq('id', id).maybeSingle<ConexionRow>()
  if (error) throw new GoogleError(`Supabase conexiones_google: ${error.message}`)
  return data ?? null
}

/**
 * Settings → Conexiones toggles. Calendar on one account turns it off on
 * every other (the partial unique index enforces it in the DB too).
 */
export async function cambiarRoles(id: string, roles: { usa_calendar?: boolean; usa_gmail?: boolean; duena?: string | null; company_id?: string | null }): Promise<void> {
  const db = createServerClient()
  if (roles.usa_calendar === true) {
    const { error } = await db.from('conexiones_google').update({ usa_calendar: false }).neq('id', id).eq('usa_calendar', true)
    if (error) throw new GoogleError(`Supabase conexiones_google: ${error.message}`)
  }
  const { error } = await db.from('conexiones_google').update(roles).eq('id', id)
  if (error) throw new GoogleError(`Supabase conexiones_google: ${error.message}`)
}

// Access tokens last an hour; a warm function reuses one across calls.
const cache = new Map<string, { token: string; expira: number }>()

export async function accessToken(conn: ConexionRow): Promise<string> {
  const hit = cache.get(conn.id)
  if (hit && hit.expira > Date.now() + 60_000) return hit.token
  const t = await tokenRequest({ refresh_token: descifrar(conn.refresh_token_enc), grant_type: 'refresh_token' })
  cache.set(conn.id, { token: t.access_token, expira: Date.now() + t.expires_in * 1000 })
  // Best-effort "último uso" for the Settings card.
  void createServerClient().from('conexiones_google').update({ ultimo_uso: new Date().toISOString() }).eq('id', conn.id)
  return t.access_token
}

/** "Desconectar": revoke at Google (best-effort) and drop the row. */
export async function desconectar(id: string): Promise<void> {
  const db = createServerClient()
  const { data } = await db.from('conexiones_google').select('*').eq('id', id).maybeSingle<ConexionRow>()
  if (data) {
    try {
      const token = descifrar(data.refresh_token_enc)
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
    } catch (err) {
      console.warn(`[google] revoke falló: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  cache.delete(id)
  const { error } = await db.from('conexiones_google').delete().eq('id', id)
  if (error) throw new GoogleError(`Supabase conexiones_google: ${error.message}`)
}
