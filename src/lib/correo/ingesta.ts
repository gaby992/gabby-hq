// Fase 6-C: the cron every 15 minutes. For each active account:
//   1. new Gmail messages since the cursor (first time: the last 3 days),
//      at most 50 per run, oldest first so a thread's summaries build up;
//   2. one row per message in `correos`, then the classifier (rules → LLM);
//   3. an alert in Telegram when it deserves one and the account's hours
//      allow it — outside them it stays `nuevo` and the 8:00 list shows it;
//   4. the autoresolver: a SENT reply in the thread → `respondido`
//      (+ respondido_en), the alert edited to "✅ Chelsea respondió" with
//      [Lo hago yo] [Tarea] still there, and its line struck in the last list.
// A failure in one message never stops the rest; the cursor only advances
// when the whole batch was processed.

import { createServerClient } from '@/lib/supabase-server'
import type { Correo, CuentaCorreo } from '@/types'
import { conexionPorId, type ConexionRow } from '@/lib/google/oauth'
import { mensajeError } from '@/lib/errores'
import { enviarAlerta, marcarRespondidoEnTelegram } from './alertas'
import { clasificar, mereceAlerta } from './clasificar'
import { cuentasActivas, dentroDeHorario, guardarCuenta } from './cuentas'
import { hiloRespondido, listarNuevos, obtenerMensaje } from './gmail'
import { tacharCorreoEnLista } from './listas'

export const DIAS_BACKLOG = 3
export const MAX_POR_CORRIDA = 50
/** Stop taking new messages after this; whatever is left comes in the next run. */
const PRESUPUESTO_MS = 80_000
const LOTE = 4
const MAX_AUTORESOLVER = 25

export interface ResumenIngesta {
  cuenta: string
  nuevos: number
  alertados: number
  respondidos: number
  reinicio: boolean
  error?: string
}

const errorMessage = mensajeError

/** Summaries of the earlier mails of the same thread, oldest first (the differential summary needs them). */
async function resumenesDelHilo(cuentaId: string, threadId: string, antesDe: string): Promise<string[]> {
  if (!threadId) return []
  const { data } = await createServerClient()
    .from('correos')
    .select('resumen, asunto, recibido_en')
    .eq('cuenta_id', cuentaId)
    .eq('gmail_thread_id', threadId)
    .lt('recibido_en', antesDe)
    .order('recibido_en', { ascending: true })
    .limit(6)
  return ((data as { resumen: string | null; asunto: string | null }[]) ?? []).map((r) => r.resumen || r.asunto || '').filter(Boolean)
}

/** One message end to end: row → classification → alert. Returns the row or null when skipped. */
async function procesarMensaje(cuenta: CuentaCorreo, conn: ConexionRow, id: string, now: Date): Promise<{ correo: Correo; alertado: boolean } | null> {
  const db = createServerClient()
  const m = await obtenerMensaje(conn, id)
  if (!m) return null
  // Something this account sent (a copy to itself, a CC) is not mail to triage.
  if (m.de_email && m.de_email === conn.email.toLowerCase()) return null

  const { data: inserted, error } = await db
    .from('correos')
    .insert({
      cuenta_id: cuenta.id,
      gmail_message_id: m.id,
      gmail_thread_id: m.threadId || null,
      de_nombre: m.de_nombre,
      de_email: m.de_email,
      asunto: m.asunto,
      cuerpo_texto: m.cuerpo_texto,
      recibido_en: m.recibido_en,
      estado: 'nuevo',
    })
    .select('*')
    .single<Correo>()
  if (error) {
    // Unique violation = already there (a previous run that got cut): nothing to do.
    if (error.code === '23505') return null
    throw new Error(`Supabase correos: ${error.message}`)
  }

  const hilo = await resumenesDelHilo(cuenta.id, m.threadId, m.recibido_en)
  const r = await clasificar({ de_nombre: m.de_nombre, de_email: m.de_email, asunto: m.asunto, cuerpo_texto: m.cuerpo_texto, recibido_en: m.recibido_en, hilo_previo: hilo }, cuenta)
  const update: Partial<Correo> = {
    urgencia: r.clas.urgencia,
    tipo: r.clas.tipo,
    categoria: r.clas.categoria,
    confianza: r.clas.confianza,
    resumen: r.clas.resumen,
    razon: r.clas.razon,
    estado: r.estado,
    decidido_en: r.estado === 'nuevo' ? null : now.toISOString(),
    vip: r.vip,
  }
  let { data: correo, error: e2 } = await db.from('correos').update(update).eq('id', inserted.id).select('*').single<Correo>()
  if (e2 && /vip/.test(e2.message)) {
    // Before sql/2026-11-asistente-fase6b-ajustes.sql: the column is not there yet.
    delete update.vip
    ;({ data: correo, error: e2 } = await db.from('correos').update(update).eq('id', inserted.id).select('*').single<Correo>())
  }
  if (e2 || !correo) throw new Error(`Supabase correos: ${e2?.message ?? 'sin fila'}`)
  if (r.modelo) {
    // Same log as every other model call, so Settings → Asistente counts its cost.
    void db.from('bot_preguntas').insert({ chat_id: 0, pregunta: `[correo] ${m.asunto.slice(0, 120)}`, respuesta: JSON.stringify(r.clas), modelo: `correo:${r.modelo}`, tokens_in: r.tokensIn, tokens_out: r.tokensOut, ms: r.ms })
  }
  // A rule that sends it to Gabby creates the task right away (same as pressing the button).
  if (r.estado === 'lo_hago_yo') {
    const { decidirCorreo } = await import('./decisiones')
    await decidirCorreo(correo.id, 'yo')
  }

  let alertado = false
  if (cuenta.alertar && mereceAlerta(r) && dentroDeHorario(cuenta.horario_alertas, now)) {
    alertado = await enviarAlerta(correo, cuenta)
  }
  return { correo, alertado }
}

/** Mails still waiting on a reply: did one go out? */
export async function autoresolver(cuenta: CuentaCorreo, conn: ConexionRow): Promise<number> {
  const db = createServerClient()
  const hace7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data, error } = await db
    .from('correos')
    .select('*')
    .eq('cuenta_id', cuenta.id)
    .in('estado', ['nuevo', 'para_chelsea', 'lo_hago_yo', 'tarea'])
    .not('gmail_thread_id', 'is', null)
    .gte('recibido_en', hace7)
    .or('alertado.eq.true,tipo.in.(necesita_respuesta,pedido_de_tarea)')
    .order('recibido_en', { ascending: false })
    .limit(MAX_AUTORESOLVER)
  if (error) throw new Error(`Supabase correos: ${error.message}`)
  let n = 0
  for (const c of (data as Correo[]) ?? []) {
    try {
      if (!(await hiloRespondido(conn, c.gmail_thread_id!, c.recibido_en ?? c.created_at))) continue
      const ahora = new Date().toISOString()
      let { error: e } = await db.from('correos').update({ estado: 'respondido', decidido_en: ahora, respondido_en: ahora }).eq('id', c.id)
      if (e && /respondido_en/.test(e.message)) ({ error: e } = await db.from('correos').update({ estado: 'respondido', decidido_en: ahora }).eq('id', c.id))
      if (e) throw new Error(e.message)
      await marcarRespondidoEnTelegram(c, cuenta)
      await tacharCorreoEnLista(c.id, '✅')
      n += 1
    } catch (err) {
      console.error(`[correo] autoresolver «${c.asunto}»: ${errorMessage(err)}`)
    }
  }
  return n
}

export async function ingestarCuenta(cuenta: CuentaCorreo, opts: { max?: number; now?: Date } = {}): Promise<ResumenIngesta> {
  const now = opts.now ?? new Date()
  const t0 = Date.now()
  const out: ResumenIngesta = { cuenta: cuenta.nombre, nuevos: 0, alertados: 0, respondidos: 0, reinicio: false }
  const conn = await conexionPorId(cuenta.conexion_id)
  if (!conn) return { ...out, error: 'la conexión de Google ya no existe' }

  const { ids, historyId, reinicio } = await listarNuevos(conn, { desdeHistoryId: cuenta.ultimo_history_id, dias: DIAS_BACKLOG, max: opts.max ?? MAX_POR_CORRIDA })
  out.reinicio = reinicio

  // Already known (a run that got cut, or the first backlog twice): skip without fetching.
  let pendientes = ids
  if (ids.length > 0) {
    const { data } = await createServerClient().from('correos').select('gmail_message_id').in('gmail_message_id', ids)
    const vistos = new Set(((data as { gmail_message_id: string }[]) ?? []).map((r) => r.gmail_message_id))
    pendientes = ids.filter((id) => !vistos.has(id))
  }

  // Oldest first (the ids come newest first), in small parallel batches.
  pendientes = [...pendientes].reverse()
  let completo = true
  for (let i = 0; i < pendientes.length; i += LOTE) {
    if (Date.now() - t0 > PRESUPUESTO_MS) {
      completo = false
      console.warn(`[correo] ${cuenta.nombre}: presupuesto agotado, quedan ${pendientes.length - i} para la próxima corrida`)
      break
    }
    const lote = pendientes.slice(i, i + LOTE)
    const results = await Promise.allSettled(lote.map((id) => procesarMensaje(cuenta, conn, id, now)))
    results.forEach((r, k) => {
      if (r.status === 'rejected') {
        console.error(`[correo] ${cuenta.nombre} mensaje ${lote[k]}: ${errorMessage(r.reason)}`)
        completo = false
        return
      }
      if (r.value) {
        out.nuevos += 1
        if (r.value.alertado) out.alertados += 1
      }
    })
  }
  // The cursor moves only when nothing was left behind; otherwise the next run re-lists (dedup by id).
  if (completo && historyId && historyId !== cuenta.ultimo_history_id) await guardarCuenta(cuenta.id, { ultimo_history_id: historyId })

  try {
    out.respondidos = await autoresolver(cuenta, conn)
  } catch (err) {
    console.error(`[correo] ${cuenta.nombre} autoresolver: ${errorMessage(err)}`)
  }
  return out
}

/** Every active account, one after the other. Never throws: each account reports its own error. */
export async function ingestarTodo(opts: { max?: number } = {}): Promise<ResumenIngesta[]> {
  const cuentas = await cuentasActivas()
  const out: ResumenIngesta[] = []
  for (const cuenta of cuentas) {
    try {
      out.push(await ingestarCuenta(cuenta, opts))
    } catch (err) {
      console.error(`[correo] ${cuenta.nombre}: ${errorMessage(err)}`)
      out.push({ cuenta: cuenta.nombre, nuevos: 0, alertados: 0, respondidos: 0, reinicio: false, error: errorMessage(err) })
    }
  }
  return out
}
