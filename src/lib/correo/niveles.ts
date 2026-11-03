// Ajuste 6c: the three sender levels applied AFTER ingestion.
//
//   reaplicarReglas(cuenta)  — "Reaplicar reglas" in Settings → Correo and
//     /api/correo/reaplicar-reglas: every mail still pending (nuevo /
//     para_chelsea) whose sender is on a list gets the level's effect:
//     🔇 silencio → registrado · 🔔 alerta → urgencia alta · 📋 solo app →
//     alertado off. Decided by hand (a task created) is never touched.
//   aprenderNivel(correo, nivel) — "el 5 es silencio": the sender's domain
//     (or address, on a generic mailbox) goes on that list of the mail's
//     account, leaving any other list, and the mail itself gets the effect.

import { createServerClient } from '@/lib/supabase-server'
import { NIVEL_REMITENTE_EMOJI, NIVEL_REMITENTE_LABELS, type Correo, type CuentaCorreo, type NivelRemitente } from '@/types'
import { mensajeError } from '@/lib/errores'
import { cargarCuentas, claveDeRemitente, cuentaPorId, guardarCuenta, moverANivel, nivelDe } from './cuentas'

export const NIVELES: NivelRemitente[] = ['silencio', 'solo_app', 'alerta']

export function esNivel(v: unknown): v is NivelRemitente {
  return typeof v === 'string' && (NIVELES as string[]).includes(v)
}

/** "silencio: zoom.us · <what the model said>" — the level replaces any earlier list/rule prefix. */
function razonCon(nivel: NivelRemitente, match: string, razon: string | null): string {
  const resto = (razon ?? '').replace(/^(VIP|regla VIP|ruido|regla ruido|silencio|alerta|solo app):\s*[^·]*(·\s*)?/i, '').trim()
  const prefijo = `${nivel === 'solo_app' ? 'solo app' : nivel}: ${match}`
  return resto ? `${prefijo} · ${resto}`.slice(0, 240) : prefijo
}

/** The update a level means for one mail row. */
export function cambioDeNivel(c: Pick<Correo, 'razon'>, nivel: NivelRemitente, match: string): Record<string, unknown> {
  const razon = razonCon(nivel, match, c.razon)
  switch (nivel) {
    case 'silencio':
      return { estado: 'registrado', decidido_en: new Date().toISOString(), urgencia: 'baja', razon, vip: false }
    case 'alerta':
      return { urgencia: 'alta', vip: true, razon }
    case 'solo_app':
      return { alertado: false, vip: false, razon }
  }
}

async function aplicarAlCorreo(c: Correo, nivel: NivelRemitente, match: string): Promise<void> {
  const db = createServerClient()
  const update = cambioDeNivel(c, nivel, match)
  let { error } = await db.from('correos').update(update).eq('id', c.id)
  if (error && /vip/.test(error.message)) {
    delete update.vip
    ;({ error } = await db.from('correos').update(update).eq('id', c.id))
  }
  if (error) throw new Error(`Supabase correos: ${error.message}`)
  if (nivel === 'silencio') {
    // Its line in the last list, if any, gets struck (best-effort, like a decision).
    const { tacharCorreoEnLista } = await import('./listas')
    await tacharCorreoEnLista(c.id, NIVEL_REMITENTE_EMOJI.silencio)
  }
}

export interface ResumenReaplicar {
  cuenta: string
  silencio: number
  alerta: number
  solo_app: number
  revisados: number
  error?: string
}

export function textoReaplicar(r: ResumenReaplicar): string {
  return `${r.silencio} a silencio · ${r.alerta} a alerta · ${r.solo_app} a solo app`
}

const DIAS = 30
const MAX = 500

/** Re-reads the lists against what is already ingested and still pending. Never throws: the error goes in the summary. */
export async function reaplicarReglas(cuenta: CuentaCorreo): Promise<ResumenReaplicar> {
  const out: ResumenReaplicar = { cuenta: cuenta.nombre, silencio: 0, alerta: 0, solo_app: 0, revisados: 0 }
  try {
    const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString()
    const { data, error } = await createServerClient()
      .from('correos')
      .select('*')
      .eq('cuenta_id', cuenta.id)
      .in('estado', ['nuevo', 'para_chelsea'])
      .gte('recibido_en', desde)
      .order('recibido_en', { ascending: false })
      .limit(MAX)
    if (error) throw new Error(`Supabase correos: ${error.message}`)
    for (const c of (data as Correo[]) ?? []) {
      out.revisados += 1
      if (c.task_id) continue // decided by hand
      const n = nivelDe(cuenta, c.de_email)
      if (!n) continue
      // Already as the level wants it: nothing to count.
      if (n.nivel === 'alerta' && c.urgencia === 'alta' && c.vip) continue
      if (n.nivel === 'solo_app' && !c.alertado && !c.vip) continue
      try {
        await aplicarAlCorreo(c, n.nivel, n.match)
        out[n.nivel] += 1
      } catch (err) {
        console.error(`[correo] reaplicar «${c.asunto}»: ${mensajeError(err)}`)
      }
    }
  } catch (err) {
    out.error = mensajeError(err)
  }
  return out
}

/** One account by id, or every account. */
export async function reaplicarTodo(cuentaId: string | null): Promise<ResumenReaplicar[]> {
  const cuentas = cuentaId ? [await cuentaPorId(cuentaId)].filter((c): c is CuentaCorreo => !!c) : await cargarCuentas()
  const out: ResumenReaplicar[] = []
  for (const c of cuentas) out.push(await reaplicarReglas(c))
  return out
}

/**
 * "el 5 es silencio" / "… solo app" / "… alerta": learns the sender and
 * applies the level to that mail. Returns the confirmation line, e.g.
 * "🔇 zoom.us → Silencio en IM Chelsea (estaba en Alerta)".
 */
export async function aprenderNivel(correoId: string, nivel: NivelRemitente): Promise<{ texto: string; clave: string | null }> {
  const { data, error } = await createServerClient().from('correos').select('*').eq('id', correoId).maybeSingle<Correo>()
  if (error) throw new Error(`Supabase correos: ${error.message}`)
  if (!data) throw new Error('ese correo ya no existe')
  const cuenta = await cuentaPorId(data.cuenta_id)
  if (!cuenta) throw new Error('la cuenta de ese correo ya no existe')
  const clave = claveDeRemitente(data.de_email)
  if (!clave) throw new Error('ese correo no trae remitente')
  const mov = moverANivel(cuenta, clave, nivel)
  if (!mov.yaEstaba) await guardarCuenta(cuenta.id, mov.listas)
  await aplicarAlCorreo(data, nivel, clave)
  const estaba = mov.anterior ? ` (estaba en ${NIVEL_REMITENTE_LABELS[mov.anterior]})` : mov.yaEstaba ? ' (ya estaba)' : ''
  return { texto: `${NIVEL_REMITENTE_EMOJI[nivel]} ${clave} → ${NIVEL_REMITENTE_LABELS[nivel]} en ${cuenta.nombre}${estaba}`, clave }
}
