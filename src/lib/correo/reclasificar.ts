// Ajuste 6c (3 nov 2026): "🤖 Reclasificar sin modelo".
//
// The mails ingested while the classifier was down (2 nov) carry
// confianza 0 and resumen = asunto; "Reaplicar reglas" never touches them
// because it only reads the lists. This runs them through rules + model
// again as if they had just arrived and updates urgencia / tipo / categoria
// / resumen / razon / confianza (and the state when a list or rule settles
// it, e.g. 🔇 silencio → registrado). Never a Telegram alert: they are old.
// A mail with a task (decided by hand) is left alone.

import { createServerClient } from '@/lib/supabase-server'
import type { Correo, CuentaCorreo } from '@/types'
import { mensajeError } from '@/lib/errores'
import { clasificar } from './clasificar'
import { cargarCuentas, cuentaPorId } from './cuentas'
import { resumenesDelHilo } from './ingesta'

export interface ResumenReclasificar {
  cuenta: string
  /** Rows the model (or a rule) classified again. */
  reclasificados: number
  /** Rows that still have no classification: the model failed again. */
  sin_modelo: number
  revisados: number
  error?: string
}

export function textoReclasificar(r: ResumenReclasificar): string {
  return `${r.reclasificados} reclasificados${r.sin_modelo ? ` · ${r.sin_modelo} sin modelo` : ''}`
}

const DIAS = 30
const MAX = 200
const LOTE = 4
/** Stop taking rows after this; what is left goes in the next click. */
const PRESUPUESTO_MS = 80_000

/** A row that never got a real classification: confianza 0 (or none) or an empty reason. */
export function necesitaReclasificar(c: Pick<Correo, 'confianza' | 'razon' | 'task_id'>): boolean {
  if (c.task_id) return false
  const conf = Number(c.confianza ?? 0)
  return !(conf > 0) || !(c.razon ?? '').trim()
}

/** The states a rule may leave behind here (the rest would create tasks or alerts). */
const ESTADOS_SIN_EFECTOS = new Set(['registrado', 'archivado', 'para_chelsea'])

async function reclasificarUno(cuenta: CuentaCorreo, c: Correo, now: Date): Promise<'ok' | 'sin_modelo'> {
  const db = createServerClient()
  const hilo = await resumenesDelHilo(cuenta.id, c.gmail_thread_id ?? '', c.recibido_en ?? c.created_at)
  const r = await clasificar({ de_nombre: c.de_nombre, de_email: c.de_email, asunto: c.asunto, cuerpo_texto: c.cuerpo_texto, recibido_en: c.recibido_en, hilo_previo: hilo }, cuenta)
  // The model failed again: the row keeps what it has, nothing to write.
  if (!r.modelo && /clasificador no disponible/.test(r.clas.razon)) return 'sin_modelo'
  const update: Record<string, unknown> = {
    urgencia: r.clas.urgencia,
    tipo: r.clas.tipo,
    categoria: r.clas.categoria,
    confianza: r.clas.confianza,
    resumen: r.clas.resumen,
    razon: r.clas.razon,
    vip: r.vip,
  }
  if (r.estado !== 'nuevo' && r.estado !== c.estado && ESTADOS_SIN_EFECTOS.has(r.estado)) {
    update.estado = r.estado
    update.decidido_en = now.toISOString()
  }
  let { error } = await db.from('correos').update(update).eq('id', c.id)
  if (error && /vip/.test(error.message)) {
    delete update.vip
    ;({ error } = await db.from('correos').update(update).eq('id', c.id))
  }
  if (error) throw new Error(`Supabase correos: ${error.message}`)
  if (r.modelo) {
    // Same log as the ingestion, so Settings → Asistente counts its cost.
    void db.from('bot_preguntas').insert({ chat_id: 0, pregunta: `[correo·reclasificar] ${(c.asunto ?? '').slice(0, 120)}`, respuesta: JSON.stringify(r.clas), modelo: `correo:${r.modelo}`, tokens_in: r.tokensIn, tokens_out: r.tokensOut, ms: r.ms })
  }
  if (update.estado === 'registrado') {
    const { tacharCorreoEnLista } = await import('./listas')
    await tacharCorreoEnLista(c.id, '🔇')
  }
  return 'ok'
}

/** Every pending mail of the account that never got classified, through rules + model again. Never throws. */
export async function reclasificarCuenta(cuenta: CuentaCorreo, opts: { now?: Date } = {}): Promise<ResumenReclasificar> {
  const now = opts.now ?? new Date()
  const t0 = Date.now()
  const out: ResumenReclasificar = { cuenta: cuenta.nombre, reclasificados: 0, sin_modelo: 0, revisados: 0 }
  try {
    const desde = new Date(now.getTime() - DIAS * 86_400_000).toISOString()
    const { data, error } = await createServerClient()
      .from('correos')
      .select('*')
      .eq('cuenta_id', cuenta.id)
      .in('estado', ['nuevo', 'para_chelsea'])
      .gte('recibido_en', desde)
      .or('confianza.eq.0,confianza.is.null,razon.is.null')
      .order('recibido_en', { ascending: true })
      .limit(MAX)
    if (error) throw new Error(`Supabase correos: ${error.message}`)
    const filas = (((data as Correo[]) ?? [])).filter(necesitaReclasificar)
    out.revisados = filas.length
    for (let i = 0; i < filas.length; i += LOTE) {
      if (Date.now() - t0 > PRESUPUESTO_MS) {
        console.warn(`[correo] ${cuenta.nombre}: reclasificar sin presupuesto, quedan ${filas.length - i}`)
        break
      }
      const lote = filas.slice(i, i + LOTE)
      const results = await Promise.allSettled(lote.map((c) => reclasificarUno(cuenta, c, now)))
      results.forEach((r, k) => {
        if (r.status === 'rejected') {
          console.error(`[correo] reclasificar «${lote[k].asunto}»: ${mensajeError(r.reason)}`)
          out.sin_modelo += 1
          return
        }
        if (r.value === 'ok') out.reclasificados += 1
        else out.sin_modelo += 1
      })
    }
  } catch (err) {
    out.error = mensajeError(err)
  }
  return out
}

/** One account by id, or every account. */
export async function reclasificarTodo(cuentaId: string | null): Promise<ResumenReclasificar[]> {
  const cuentas = cuentaId ? [await cuentaPorId(cuentaId)].filter((c): c is CuentaCorreo => !!c) : await cargarCuentas()
  const out: ResumenReclasificar[] = []
  for (const c of cuentas) out.push(await reclasificarCuenta(c))
  return out
}
