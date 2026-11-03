// Fase 6-F: the four decisions on a mail — the Telegram buttons, the row on
// /correo and "el correo de Andrew lo hago yo" all end up here.
//   chelsea  → estado para_chelsea (the alert keeps [Lo hago yo] 48 h)
//   yo       → estado lo_hago_yo + a task (notes: De / resumen / Ref: gmail:id)
//   tarea    → estado tarea + the same task
//   archivar → estado archivado + INBOX removed in Gmail (the only Gmail write)
// Tasks are deduped by the "Ref: gmail:…" line, like the inbox-IM button did.
// Ajuste 6-3: the newest list that numbers the mail gets its line struck
// through in place; the alert is edited, never re-sent.

import { createServerClient } from '@/lib/supabase-server'
import type { Correo, CorreoAccion, CuentaCorreo } from '@/types'
import { conexionPorId } from '@/lib/google/oauth'
import { escapeHtml } from '@/lib/asistente/telegram'
import { mensajeError } from '@/lib/errores'
import { cuentaPorId } from './cuentas'
import { quitarDeInbox } from './gmail'

const ESTADO: Record<CorreoAccion, Correo['estado']> = { chelsea: 'para_chelsea', yo: 'lo_hago_yo', tarea: 'tarea', archivar: 'archivado' }
/** What the struck-through list line gets after it (ajuste 6-3). */
export const MARCA: Record<CorreoAccion, string> = { chelsea: '📨 Chelsea', yo: '🙋', tarea: '➕', archivar: '🗄' }

export async function correoPorId(id: string): Promise<Correo | null> {
  const { data, error } = await createServerClient().from('correos').select('*').eq('id', id).maybeSingle<Correo>()
  if (error) throw new Error(`Supabase correos: ${error.message}`)
  return data ?? null
}

/** "Andrew (TOTT)" / "andrew@tottatl.com" — who it is from, short. */
export function remitenteCorto(c: Pick<Correo, 'de_nombre' | 'de_email'>): string {
  const dominio = c.de_email?.split('@')[1]?.split('.')[0]
  if (c.de_nombre) return dominio && !c.de_nombre.toLowerCase().includes(dominio.toLowerCase()) ? `${c.de_nombre} (${dominio.toUpperCase()})` : c.de_nombre
  return c.de_email ?? '(sin remitente)'
}

/** The task created for "Lo hago yo" / "Tarea": one per mail, found again by its Ref line. */
async function crearTareaDeCorreo(c: Correo, cuenta: CuentaCorreo | null): Promise<string> {
  const db = createServerClient()
  const ref = `gmail:${c.gmail_message_id}`
  const { data: existing } = await db.from('tasks').select('id').ilike('notes', `%Ref: ${ref}%`).limit(1)
  if (existing && existing.length > 0) return existing[0].id as string
  const notes = [`De: ${c.de_nombre ? `${c.de_nombre} <${c.de_email ?? ''}>` : c.de_email ?? '(sin remitente)'}`, c.resumen || c.asunto || '', `Ref: ${ref}`]
    .filter(Boolean)
    .join('\n\n')
  const { data, error } = await db
    .from('tasks')
    .insert({
      text: c.asunto || '(sin asunto)',
      priority: c.urgencia === 'alta' ? 'urgente' : 'normal',
      importante: c.urgencia === 'alta',
      company_id: cuenta?.conexion?.company_id ?? null,
      notes,
      done: false,
    })
    .select('id')
    .single<{ id: string }>()
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  return data.id
}

export interface Decision {
  correo: Correo
  /** One line for Telegram / the web. */
  texto: string
}

const HORAS_BOTON = 48

/**
 * Applies the decision and returns the confirmation. Idempotent on the
 * state; the task is never duplicated. `desdeBoton`: the leftover buttons
 * of an answered / handed-over alert are valid 48 h (ajuste 6-6).
 */
export async function decidirCorreo(correoId: string, accion: CorreoAccion, opts: { desdeBoton?: boolean } = {}): Promise<Decision> {
  const c = await correoPorId(correoId)
  if (!c) throw new Error('ese correo ya no existe')
  const eraRespondido = c.estado === 'respondido'
  if (opts.desdeBoton && (eraRespondido || c.estado === 'para_chelsea')) {
    const desde = (eraRespondido ? c.respondido_en : null) ?? c.decidido_en ?? c.created_at
    if (Date.now() - new Date(desde).getTime() > HORAS_BOTON * 3_600_000) throw new Error(`ese botón ya caducó (${HORAS_BOTON} h); decídelo en /correo`)
  }
  const cuenta = await cuentaPorId(c.cuenta_id)
  const update: Record<string, unknown> = { estado: ESTADO[accion], decidido_en: new Date().toISOString() }
  let aviso = ''
  if (accion === 'yo' || accion === 'tarea') {
    update.task_id = await crearTareaDeCorreo(c, cuenta)
  }
  if (accion === 'archivar' && cuenta) {
    try {
      const conn = await conexionPorId(cuenta.conexion_id)
      if (conn) await quitarDeInbox(conn, c.gmail_message_id)
    } catch (err) {
      aviso = ` ⚠️ no pude sacarlo del inbox de Gmail (${mensajeError(err)})`
    }
  }
  const { data, error } = await createServerClient().from('correos').update(update).eq('id', c.id).select('*').single<Correo>()
  if (error) throw new Error(`Supabase correos: ${error.message}`)
  // The alert is rewritten in place and the last list strikes its line (both best-effort, in the background).
  void (async () => {
    const { editarAlertaTrasDecision } = await import('./alertas')
    const { tacharCorreoEnLista } = await import('./listas')
    await editarAlertaTrasDecision(data, accion, { eraRespondido, duena: cuenta?.duena ?? null })
    await tacharCorreoEnLista(c.id, eraRespondido ? `✅ ${MARCA[accion]}` : MARCA[accion])
  })().catch((err) => console.error(`[correo] tras decidir: ${mensajeError(err)}`))
  const quien = remitenteCorto(c)
  const asunto = c.asunto ?? '(sin asunto)'
  const tareaCreada = eraRespondido ? `✅ Respondido · 📝 tarea creada: «${asunto}» de ${quien}` : null
  const texto = {
    chelsea: `📨 Para Chelsea: «${asunto}» de ${quien}`,
    yo: tareaCreada ?? `🙋 Lo haces tú: «${asunto}» de ${quien} → tarea creada`,
    tarea: tareaCreada ?? `➕ Tarea creada: «${asunto}» de ${quien}`,
    archivar: `🗄 Archivado: «${asunto}» de ${quien}${aviso}`,
  }[accion]
  return { correo: data, texto }
}

/** Telegram HTML version of the same line. */
export function textoDecisionHtml(d: Decision): string {
  return escapeHtml(d.texto)
}
