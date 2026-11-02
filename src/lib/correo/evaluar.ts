// Fase 6-E: deciding the model with real mail. Re-classifies the mails of
// the last N days with a given model WITHOUT touching their state, keeps
// each answer in `correo_evaluaciones` (one row per mail × model), and
// compares every model against Gabby's verdicts (`correo_veredictos`).

import { createServerClient } from '@/lib/supabase-server'
import type { Correo, CorreoEvaluacion, CorreoTipo, CorreoUrgencia, CorreoVeredicto } from '@/types'
import { parsearModelo, nombreModelo } from '@/lib/asistente/llm'
import { clasificarConLlm } from './clasificar'

const LOTE = 4
const PRESUPUESTO_MS = 100_000

export interface ResultadoEvaluacion {
  modelo: string
  evaluados: number
  fallidos: number
  pendientes: number
  tokensIn: number
  tokensOut: number
  ms: number
}

/** The mails of the window: the ones a model should see (noise excluded). */
export async function correosParaEvaluar(opts: { cuentaId?: string | null; dias: number }): Promise<Correo[]> {
  const desde = new Date(Date.now() - opts.dias * 86_400_000).toISOString()
  let q = createServerClient().from('correos').select('*').gte('recibido_en', desde).neq('estado', 'registrado').order('recibido_en', { ascending: false }).limit(300)
  if (opts.cuentaId) q = q.eq('cuenta_id', opts.cuentaId)
  const { data, error } = await q
  if (error) throw new Error(`Supabase correos: ${error.message}`)
  return (data as Correo[]) ?? []
}

/** Runs `modelo` over the window; mails it already judged are skipped unless `rehacer`. */
export async function evaluar(opts: { cuentaId?: string | null; dias: number; modelo: string; rehacer?: boolean }): Promise<ResultadoEvaluacion> {
  const target = parsearModelo(opts.modelo)
  const nombre = nombreModelo(target)
  const db = createServerClient()
  const correos = await correosParaEvaluar(opts)
  const { data: hechas } = await db.from('correo_evaluaciones').select('correo_id').eq('modelo', nombre)
  const ya = new Set(((hechas as { correo_id: string }[]) ?? []).map((r) => r.correo_id))
  const lista = opts.rehacer ? correos : correos.filter((c) => !ya.has(c.id))
  const out: ResultadoEvaluacion = { modelo: nombre, evaluados: 0, fallidos: 0, pendientes: 0, tokensIn: 0, tokensOut: 0, ms: 0 }
  const t0 = Date.now()
  for (let i = 0; i < lista.length; i += LOTE) {
    if (Date.now() - t0 > PRESUPUESTO_MS) {
      out.pendientes = lista.length - i
      break
    }
    const lote = lista.slice(i, i + LOTE)
    const results = await Promise.allSettled(lote.map((c) => clasificarConLlm({ de_nombre: c.de_nombre, de_email: c.de_email, asunto: c.asunto, cuerpo_texto: c.cuerpo_texto, recibido_en: c.recibido_en }, target)))
    for (let k = 0; k < lote.length; k++) {
      const r = results[k]
      if (r.status === 'rejected') {
        out.fallidos += 1
        console.error(`[correo-evaluar] ${nombre} «${lote[k].asunto}»: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
        continue
      }
      const { error } = await db
        .from('correo_evaluaciones')
        .upsert({ correo_id: lote[k].id, modelo: nombre, urgencia: r.value.urgencia, tipo: r.value.tipo, razon: `${r.value.resumen} — ${r.value.razon}`.slice(0, 400), created_at: new Date().toISOString() }, { onConflict: 'correo_id,modelo' })
      if (error) {
        out.fallidos += 1
        console.error(`[correo-evaluar] upsert: ${error.message}`)
        continue
      }
      out.evaluados += 1
      out.tokensIn += r.value.tokensIn
      out.tokensOut += r.value.tokensOut
    }
  }
  out.ms = Date.now() - t0
  return out
}

export interface Acierto {
  modelo: string
  comparados: number
  urgencia_ok: number
  tipo_ok: number
  ambos_ok: number
}

export interface TablaEvaluacion {
  correos: Correo[]
  evaluaciones: CorreoEvaluacion[]
  veredictos: CorreoVeredicto[]
  modelos: string[]
  aciertos: Acierto[]
}

/**
 * What /correo/evaluar shows: the window's mails, every model's answer and
 * Gabby's verdicts. The production classification counts as a model too
 * ("produccion"), so the live model is compared like the others.
 */
export async function tablaEvaluacion(opts: { cuentaId?: string | null; dias: number }): Promise<TablaEvaluacion> {
  const db = createServerClient()
  const correos = await correosParaEvaluar(opts)
  const ids = correos.map((c) => c.id)
  if (ids.length === 0) return { correos, evaluaciones: [], veredictos: [], modelos: [], aciertos: [] }
  const [evRes, veRes] = await Promise.all([
    db.from('correo_evaluaciones').select('*').in('correo_id', ids),
    db.from('correo_veredictos').select('*').in('correo_id', ids),
  ])
  if (evRes.error) throw new Error(`Supabase correo_evaluaciones: ${evRes.error.message}`)
  if (veRes.error) throw new Error(`Supabase correo_veredictos: ${veRes.error.message}`)
  const evaluaciones = (evRes.data as CorreoEvaluacion[]) ?? []
  const veredictos = (veRes.data as CorreoVeredicto[]) ?? []
  const modelos = Array.from(new Set(evaluaciones.map((e) => e.modelo))).sort()
  const porCorreo = new Map(veredictos.map((v) => [v.correo_id, v]))

  const aciertos: Acierto[] = []
  const contar = (modelo: string, juicio: (c: Correo) => { urgencia: CorreoUrgencia | null; tipo: CorreoTipo | null } | null) => {
    const a: Acierto = { modelo, comparados: 0, urgencia_ok: 0, tipo_ok: 0, ambos_ok: 0 }
    for (const c of correos) {
      const v = porCorreo.get(c.id)
      const j = v ? juicio(c) : null
      if (!v || !j) continue
      a.comparados += 1
      const u = j.urgencia === v.urgencia
      const t = j.tipo === v.tipo
      if (u) a.urgencia_ok += 1
      if (t) a.tipo_ok += 1
      if (u && t) a.ambos_ok += 1
    }
    return a
  }
  aciertos.push(contar('produccion', (c) => ({ urgencia: c.urgencia, tipo: c.tipo })))
  for (const m of modelos) {
    const mias = new Map(evaluaciones.filter((e) => e.modelo === m).map((e) => [e.correo_id, e]))
    aciertos.push(contar(m, (c) => {
      const e = mias.get(c.id)
      return e ? { urgencia: e.urgencia, tipo: e.tipo } : null
    }))
  }
  return { correos, evaluaciones, veredictos, modelos, aciertos }
}

/** Gabby's verdict: "✓ correcto" stores the production values; "debió ser" stores what she picked. */
export async function guardarVeredicto(correoId: string, v: { urgencia: CorreoUrgencia; tipo: CorreoTipo }): Promise<void> {
  const { error } = await createServerClient()
    .from('correo_veredictos')
    .upsert({ correo_id: correoId, urgencia: v.urgencia, tipo: v.tipo, created_at: new Date().toISOString() }, { onConflict: 'correo_id' })
  if (error) throw new Error(`Supabase correo_veredictos: ${error.message}`)
}
