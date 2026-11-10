// Fase 16: Gabita conversando.
//
// The interpreter turns a message into orders. That is right for "mañana
// llamar a Juan" and wrong for "necesito tiempo para CPT esta semana, no sé
// cuándo": there is no order in that, there is someone thinking out loud. The
// old answer was a question back ("¿cuántos días quieres bloquear?"), which
// hands her the problem again.
//
// Here the same message gets what a person would give: a concrete proposal
// built on HER week — the blocks of the plantilla, what is already in them,
// how much room is left, what is on her calendar — and one question to
// confirm. When she says yes, the interpreter (which reads the thread)
// creates the tasks.
//
// It runs on its own model (LLM_MODEL_CONVERSACION): this is the one place
// where a stronger model changes the answer. If that model fails or is not
// set, the usual one answers — a plainer answer beats none.

import { proyectosActivos, textoProyecto } from '@/lib/proyectos'
import { createServerClient } from '@/lib/supabase-server'
import { eventosEntre, type EventoConFecha } from '@/lib/google/calendar'
import { googleConfigurado } from '@/lib/google/oauth'
import { mensajeError } from '@/lib/errores'
import { cargarPlantilla, diaDeLaSemana, duracion, nombreDia, semanaParaPrompt } from './bloques'
import { addDays, cancunHm, cancunYmd, formatHoraEs } from './cancun'
import { cargarConfig, personaPrompt, type AsistenteConfig } from './config'
import { historial, renderHistorial } from './conversacion'
import { llamarLlm, llmConfig, parsearModelo, preguntarLlm, type LlmResult } from './llm'
import { cargarPanorama, type TareaN } from './narracion'

export const MAX_TOKENS = 1400
export const TIMEOUT_MS = 40_000
/** How far ahead Gabita looks when she proposes. */
export const DIAS_A_LA_VISTA = 9
/** The open tasks she sees: enough to know the load, not the whole backlog. */
const MAX_TAREAS = 60
export const RESPUESTA_TRABADA = 'Se me trabó pensando eso. Dímelo otra vez, o más corto.'

/** The model for conversation, or null when the usual one should answer. */
export function modeloConversacion(): string | null {
  const m = process.env.LLM_MODEL_CONVERSACION?.trim()
  return m ? m : null
}

export function systemPromptConversacion(cfg: AsistenteConfig): string {
  return [
    personaPrompt(cfg),
    '',
    'MODO CONVERSACIÓN. Ella está pensando en voz alta o te pide ayuda para organizarse. No eres un formulario: piensa con ella y decide con criterio, como una asistente que conoce su semana.',
    '',
    'Cómo respondes:',
    '- PROPÓN algo concreto: días, bloques y horas exactas tomadas de SU SEMANA. Nunca le devuelvas la pregunta ("¿cuántos días quieres?", "¿cuándo te gustaría?") si con lo que sabes puedes proponer.',
    '- Respeta su horario: NUNCA propongas nada en horas NO DISPONIBLE ni fuera de sus bloques. Cada cosa va en el bloque de su tema ' +
      '(CPT y todo lo de DATAVIA → la Tarde o el Bloque B de DATAVIA; PD → los bloques de PD; IM y QuickBooks de IM → los de IM; GHL → los de GHL; estudio → Estudio). ' +
      'Los bloques que dicen "no recibe tareas" son rutina fija: no metas nada ahí.',
    '- Usa el espacio "libre" de cada bloque. Si lo que pide no cabe antes de la fecha que dijo, dilo claro y di QUÉ habría que mover o soltar; no lo escondas.',
    '- No propongas nada en un momento que ya pasó hoy (mira la hora de HOY).',
    '- Si enumera pasos ("primero esto, luego esto"), repártelos en ese orden, con su tiempo. Si ella dijo cuánto tarda algo, usa ESE número; si no, estima tú y dilo ("calculo 1 h").',
    '- Si hay un evento en su calendario que choca con un bloque, tenlo en cuenta y menciónalo.',
    '- No inventes tareas, fechas, personas ni compromisos que no estén en el contexto o en lo que ella dijo.',
    '- Si solo comparte una idea o una reflexión y no pide organizar nada, responde breve y humana (2 a 4 líneas), con tu opinión si la pide y una razón. Puedes ofrecer guardarla: "¿La guardo en Gabita?"',
    '',
    'Formato (va a Telegram): texto plano, SIN markdown, sin asteriscos ni almohadillas. Máximo 12 líneas cortas.',
    'Cuando propones un reparto: una línea de entrada, luego UNA línea por cosa con este formato exacto:',
    '"• jue 12 nov · Tarde 6:00–7:30 pm · CPT: reunir la información (1 h 30)"',
    'Después, si algo no cabe, UNA línea que empiece con "Ojo:". Y cierra con UNA sola pregunta de confirmación: "¿Lo dejo así?"',
    'Si dice que sí, en el siguiente turno se crean esas tareas con esas fechas, así que cada línea debe traer el día con su número, el título de la tarea y su duración.',
  ].join('\n')
}

function lineaTarea(t: TareaN, hoy: string): string {
  const extra = t as TareaN & { minutos_estimados?: number | null; estado?: string | null; esperando_a?: string | null }
  const partes = [`«${t.text}»`, t.company?.name?.trim() ?? 'sin empresa']
  if (t.due_date) partes.push(t.due_date < hoy ? `VENCIDA desde ${t.due_date}` : `vence ${t.due_date}`)
  else partes.push('sin fecha')
  if (t.priority === 'urgente') partes.push('urgente')
  if (extra.minutos_estimados) partes.push(duracion(extra.minutos_estimados))
  if (extra.estado === 'esperando') partes.push(`esperando a ${extra.esperando_a ?? 'alguien'}`)
  return `- ${partes.join(' · ')}`
}

function lineaEvento(e: EventoConFecha): string {
  const cuando = e.todoElDia ? 'todo el día' : `${e.hora ? formatHoraEs(e.hora) : ''}${e.fin ? `–${formatHoraEs(e.fin)}` : ''}`
  return `- ${nombreDia(diaDeLaSemana(e.fecha))} ${e.fecha} · ${cuando} · ${e.titulo}`
}

/** Everything Gabita knows when she answers, as the text of the user turn. */
export async function contextoConversacion(chatId: number, mensaje: string, ahora: Date = new Date()): Promise<string> {
  const hoy = cancunYmd(ahora)
  const [panorama, plantilla, turnos, eventos, proyectos] = await Promise.all([
    cargarPanorama(hoy),
    cargarPlantilla(),
    historial(chatId, ahora),
    googleConfigurado()
      ? eventosEntre(hoy, addDays(hoy, DIAS_A_LA_VISTA)).catch((err) => {
          console.warn(`[conversar] calendar: ${mensajeError(err)}`)
          return null
        })
      : Promise.resolve(null),
    proyectosActivos(hoy),
  ])
  const tareas = panorama.tasks
  const partes: string[] = []
  partes.push(`HOY: ${nombreDia(diaDeLaSemana(hoy))} ${hoy}, son las ${formatHoraEs(cancunHm(ahora))} (hora de Cancún).`)
  partes.push(`SU SEMANA (bloques de los próximos ${DIAS_A_LA_VISTA} días; "libre" es lo que queda en cada bloque):\n${semanaParaPrompt(plantilla, hoy, DIAS_A_LA_VISTA, tareas, panorama.companies, hoy)}`)
  partes.push(
    `TAREAS ABIERTAS (${tareas.length}):\n${tareas.slice(0, MAX_TAREAS).map((t) => lineaTarea(t, hoy)).join('\n') || '(ninguna)'}${tareas.length > MAX_TAREAS ? `\n(+${tareas.length - MAX_TAREAS} más)` : ''}`
  )
  // Fase 17: lo que tiene un final, con su fecha de salida y lo que falta definir.
  if (proyectos.length > 0) partes.push(`SUS PROYECTOS ACTIVOS (cada uno con su fecha de salida; respeta esas fechas al proponer):\n${proyectos.map((p) => textoProyecto(p)).join('\n')}`)
  if (eventos === null) partes.push('SU CALENDARIO: no pude leerlo ahora; no asumas que está vacío.')
  else partes.push(`SU CALENDARIO (próximos ${DIAS_A_LA_VISTA} días; los que empiezan con ⏰ son recordatorios, no reuniones):\n${eventos.map(lineaEvento).join('\n') || '(nada agendado)'}`)
  const hilo = renderHistorial(turnos.slice(-8), () => null)
  if (hilo) partes.push(hilo)
  partes.push(`LO QUE ELLA DICE AHORA: ${mensaje}`)
  return partes.join('\n\n')
}

/** The model's text, cleaned for Telegram: no markdown marks, no blank walls. */
export function limpiarRespuesta(texto: string): string {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function registrar(row: { chat_id: number; pregunta: string; respuesta: string; modelo: string; tokens_in: number; tokens_out: number; ms: number }) {
  // The same log /pregunta uses, so the cost of conversation can be read next to it.
  const { error } = await createServerClient().from('bot_preguntas').insert(row)
  if (error) console.error(`[conversar] bot_preguntas insert: ${error.message}`)
}

/**
 * The whole turn: context → the conversation model (or the usual one) → the
 * cleaned answer. Never throws; a failure comes back as a line she can act on.
 */
export async function responderConversacion(chatId: number, mensaje: string): Promise<string> {
  const q = mensaje.trim()
  if (!q) return RESPUESTA_TRABADA
  const t0 = Date.now()
  let modelo = 'desconocido'
  try {
    const [cfg, user] = await Promise.all([cargarConfig(), contextoConversacion(chatId, q)])
    const system = systemPromptConversacion(cfg)
    const opts = { maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS }
    let r: LlmResult | null = null
    const propio = modeloConversacion()
    if (propio) {
      try {
        r = await llamarLlm(parsearModelo(propio), system, user, opts)
      } catch (err) {
        // A wrong model id or a provider hiccup must not leave her without an answer.
        console.error(`[conversar] ${propio} falló (${mensajeError(err)}); respondo con el modelo de siempre`)
      }
    }
    if (!r || !r.text) r = await preguntarLlm(system, user, opts)
    modelo = `${r.provider}:${r.model}`
    const respuesta = r.text ? limpiarRespuesta(r.text) : RESPUESTA_TRABADA
    console.log(`[conversar] ok · ${modelo} · ctx ${user.length} chars · in ${r.tokensIn} · out ${r.tokensOut} · ${r.ms} ms`)
    await registrar({ chat_id: chatId, pregunta: `[conversar] ${q}`, respuesta, modelo, tokens_in: r.tokensIn, tokens_out: r.tokensOut, ms: r.ms })
    return respuesta
  } catch (err) {
    const motivo = mensajeError(err)
    console.error(`[conversar] error · ${modelo} · ${Date.now() - t0} ms · ${motivo}`)
    try {
      modelo = modelo === 'desconocido' ? `${llmConfig().provider}:${llmConfig().model}` : modelo
    } catch {
      /* the env itself is wrong; the log line above already says so */
    }
    await registrar({ chat_id: chatId, pregunta: `[conversar] ${q}`, respuesta: `ERROR: ${motivo}`, modelo, tokens_in: 0, tokens_out: 0, ms: Date.now() - t0 })
    return RESPUESTA_TRABADA
  }
}

/**
 * "/modelo": which model answers in conversation, tried for real. The id in
 * LLM_MODEL_CONVERSACION is typed by hand in Vercel, and a typo there would
 * silently fall back to the usual model — this says so in one line.
 */
export async function probarModeloConversacion(): Promise<string> {
  let deSiempre = 'el modelo de siempre'
  try {
    const c = llmConfig()
    deSiempre = `${c.provider}:${c.model}`
  } catch {
    /* said below, if it matters */
  }
  const propio = modeloConversacion()
  if (!propio) {
    return `💬 Para conversar uso el modelo de siempre (${deSiempre}). Todavía no está la variable LLM_MODEL_CONVERSACION en Vercel, o falta volver a desplegar.`
  }
  try {
    const r = await llamarLlm(parsearModelo(propio), 'Responde solo con la palabra: listo', 'Di listo.', { maxTokens: 400, timeoutMs: 25_000 })
    if (!r.text) return `⚠️ ${propio} contestó vacío. Mientras tanto converso con ${deSiempre}.`
    return `✓ Para conversar uso ${r.provider}:${r.model} (respondió en ${r.ms} ms). Para todo lo demás, ${deSiempre}.`
  } catch (err) {
    return `⚠️ ${propio} no respondió: ${mensajeError(err)}. Mientras tanto converso con ${deSiempre}.`
  }
}
