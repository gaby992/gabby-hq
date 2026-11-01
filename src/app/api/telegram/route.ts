import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  answerCallbackQuery,
  downloadTelegramFile,
  inlineKeyboard,
  isAllowedChat,
  removeInlineKeyboard,
  sendTelegram,
} from '@/lib/asistente/telegram'
import { botonesElegir, conIds, ejecutarAccion, manejarAccion, manejarPorTitulo, type AccionParams, type Respuesta } from '@/lib/asistente/acciones'
import { interpretar, registrarInterpretacion, type Interpretacion } from '@/lib/asistente/interprete'
import {
  ejecutarPlan,
  ejecutarUna,
  necesitaConfirmacion,
  renderPlan,
  resolverAcciones,
  resumenParaLog,
  tareaParsedDe,
  type AccionResuelta,
} from '@/lib/asistente/plan'
import {
  HORAS_BOTONES,
  confirmacionAlarma,
  crearRecordatorio,
  instanteDe,
  listarRecordatorios,
  quitarRecordatorio,
  responderRecordatorio,
  type RespuestaRecordatorio,
} from '@/lib/asistente/recordatorios'
import { ejecutarNota, USO_NOTA } from '@/lib/asistente/notas-bot'
import { llmConfig } from '@/lib/asistente/llm'
import { ayuda, faltantes, parseMensaje, type Parsed, type TareaParsed } from '@/lib/parser'
import { cancunYmd, formatHoraEs, formatVenceEs } from '@/lib/asistente/cancun'
import { MAX_AUDIO_SECONDS, transcribirAudio } from '@/lib/asistente/whisper'
import {
  actualizarBorrador,
  borradorVigente,
  borrarBorrador,
  crearBorrador,
  nonceDe,
  type BorradorParsed,
} from '@/lib/asistente/borradores'
import { cargarEmpresas, confirmacion, guardarTarea, pregunta } from '@/lib/asistente/tareas'
import { responderPregunta } from '@/lib/asistente/pregunta'
import { responderQueSigue } from '@/lib/asistente/que-sigue'
import type { Priority } from '@/types'

// Telegram → here (webhook). Text, voice notes and inline-button taps all end
// up in the same place: parseMensaje() for the exact commands; everything
// else (fase 4) goes through the LLM interpreter → plan → execute, falling
// back to the classic parser when the model fails.
// A voice note needs a round trip to Whisper, and the interpreter one to the
// LLM (20 s cap), so give the function some room.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const ERROR_GENERICO = 'Error al procesar. Intenta de nuevo.'

// Plain-text reply. The shared helper throws on a Telegram error (the alarms
// need that to retry); here a failed reply is only worth a log line.
async function reply(chatId: number, text: string, replyMarkup?: unknown) {
  try {
    await sendTelegram(chatId, text, { tag: 'bot', replyMarkup })
  } catch {
    /* already logged by sendTelegram */
  }
}

function joinLines(...lines: (string | null | undefined)[]): string {
  return lines.filter(Boolean).join('\n')
}

function modeloActual(): string {
  try {
    const c = llmConfig()
    return `${c.model} (${c.provider})`
  } catch {
    return process.env.LLM_MODEL ?? 'gpt-5-mini'
  }
}

/** A draft always starts with a fresh id; the nonce goes into the buttons. */
async function borradorConNonce(chatId: number, texto: string, parsed: BorradorParsed): Promise<string> {
  const b = await crearBorrador(chatId, texto, parsed)
  return nonceDe(b.id)
}

// ── Tasks: save, or ask ──────────────────────────────────────────────────

/**
 * Either saves the task and confirms in one line, or stores a draft and asks
 * the first missing question with buttons. `prefix` is the "🎤 Entendí: «…»"
 * line for voice notes — it goes in the same message as the answer.
 */
async function guardarOPreguntar(chatId: number, texto: string, tarea: TareaParsed, prefix: string | null) {
  const falta = faltantes(tarea)
  if (falta.length === 0) {
    await guardarTarea(tarea)
    await reply(chatId, joinLines(prefix, confirmacion(tarea)))
    return
  }
  const borrador = await crearBorrador(chatId, texto, tarea)
  const q = pregunta(falta[0], nonceDe(borrador.id), await cargarEmpresas())
  await reply(chatId, joinLines(prefix, q.text), q.replyMarkup)
}

/**
 * Shared tail of every action: mint a draft (its nonce goes into any buttons),
 * run the resolver, then keep the draft only if buttons are waiting on it.
 * Returns false when the resolver had nothing to say (edit with no match).
 */
async function responderAccion(
  chatId: number,
  text: string,
  params: AccionParams,
  resolver: (nonce: string) => Promise<Respuesta | null>,
  prefix: string | null
): Promise<boolean> {
  const borrador = await crearBorrador(chatId, text, { tipo: 'accion', params, candidatos: [] })
  const r = await resolver(nonceDe(borrador.id))
  if (!r) {
    await borrarBorrador(borrador.id)
    return false
  }
  if (r.candidatos && r.candidatos.length > 0) {
    await actualizarBorrador(borrador.id, { tipo: 'accion', params, candidatos: r.candidatos })
  } else if (r.confirmar && r.confirmar.length > 0) {
    await actualizarBorrador(borrador.id, { tipo: 'confirmar', params, ids: r.confirmar })
  } else {
    await borrarBorrador(borrador.id)
  }
  await reply(chatId, joinLines(prefix, r.text), r.replyMarkup)
  return true
}

async function handleText(chatId: number, text: string, prefix: string | null) {
  if (!text) {
    await reply(chatId, joinLines(prefix, 'No entendí nada. ¿Me lo repites?'))
    return
  }
  const companies = await cargarEmpresas()
  const parsed = parseMensaje(text, companies, cancunYmd())
  switch (parsed.kind) {
    case 'ayuda':
      await reply(chatId, ayuda(modeloActual()))
      return
    case 'accion': {
      // "listo …" / "pasa …" / "borra …": by alarm number, "todo", or a word
      // of the title.
      await responderAccion(chatId, text, { accion: parsed.accion }, (nonce) =>
        manejarAccion({ accion: parsed.accion }, parsed.arg, nonce), prefix)
      return
    }
    case 'nota_tarea': {
      if (!parsed.texto) {
        await reply(chatId, joinLines(prefix, 'Formato: nota en paypal: texto que quieres agregar'))
        return
      }
      const params: AccionParams = { accion: 'nota_tarea', texto: parsed.texto }
      await responderAccion(chatId, text, params, (nonce) => manejarPorTitulo(params, parsed.termino, nonce), prefix)
      return
    }
    case 'nota': {
      const n = parsed.nota
      if (n.modo !== 'borrar' && !n.texto) {
        await reply(chatId, joinLines(prefix, USO_NOTA))
        return
      }
      if (!n.company_id) {
        const nonce = await borradorConNonce(chatId, text, { tipo: 'nota', nota: n })
        const q = pregunta('empresa', nonce, companies)
        await reply(chatId, joinLines(prefix, '¿Nota de qué empresa?'), q.replyMarkup)
        return
      }
      await reply(chatId, joinLines(prefix, await ejecutarNota(n)))
      return
    }
    case 'pregunta':
      // Fase 3: context + LLM, ≤5 lines, logged in bot_preguntas.
      await reply(chatId, joinLines(prefix, await responderPregunta(chatId, parsed.texto)))
      return
    case 'radar': {
      if (!parsed.titulo) {
        await reply(chatId, joinLines(prefix, 'Uso: radar <descripción>'))
        return
      }
      const { error } = await createServerClient().from('radar').insert({ titulo: parsed.titulo, estado: 'idea' })
      if (error) throw new Error(`Supabase radar: ${error.message}`)
      await reply(chatId, joinLines(prefix, `✓ Radar: "${parsed.titulo}"`))
      return
    }
    case 'que_sigue':
      // Fase 4b: ordered in code, worded by the LLM, numbered like an alarm.
      await reply(chatId, joinLines(prefix, await responderQueSigue(chatId, parsed.opts)))
      return
    case 'alarmas':
      await reply(chatId, joinLines(prefix, await listarRecordatorios(chatId)))
      return
    case 'quitar_alarma':
      await reply(chatId, joinLines(prefix, await quitarRecordatorio(chatId, parsed.arg)))
      return
    case 'edicion':
    case 'tarea':
      // Free text: the interpreter first (fase 4); the classic result is the fallback.
      await handleLibre(chatId, text, parsed, prefix)
      return
  }
}

// ── Classic fallback (what every free text did before fase 4) ────────────

async function handleClasico(chatId: number, text: string, parsed: Parsed, prefix: string | null) {
  switch (parsed.kind) {
    case 'edicion': {
      // "paypal urgente": an edit if some open task matches «paypal»;
      // otherwise it was a new task all along.
      const params: AccionParams = { accion: 'editar', cambios: parsed.cambios }
      const handled = await responderAccion(chatId, text, params, (nonce) => manejarPorTitulo(params, parsed.termino, nonce), prefix)
      if (!handled) await guardarOPreguntar(chatId, text, parsed.fallback, prefix)
      return
    }
    case 'tarea': {
      if (!parsed.tarea.text) {
        await reply(chatId, joinLines(prefix, 'Falta la tarea. Ejemplo: urgente IM llamar a Juan mañana'))
        return
      }
      await guardarOPreguntar(chatId, text, parsed.tarea, prefix)
      return
    }
    default:
      await handleText(chatId, text, prefix)
  }
}

/** The classic parser found something explicit (a modifier, a company, a date): worth saving without asking. */
function clasicoEstructurado(parsed: Parsed): boolean {
  if (parsed.kind === 'edicion') return true
  if (parsed.kind !== 'tarea') return true
  const t = parsed.tarea
  return !!t.text && (!!t.company_id || !!t.priority || !!t.due_date || t.importante)
}

const PISTA_ORDEN = 'Es una ORDEN sobre una tarea existente (completar, cancelar, posponer, renombrar, cambiar o nota). Busca la tarea más parecida.'
const PISTA_ALARMA = 'Es una ALARMA (recordatorio): devuelve una acción "alarma" con texto, fecha y hora.'

function botonesAclarar(nonce: string) {
  return inlineKeyboard([[
    { text: '➕ Tarea nueva', callback_data: `q:${nonce}:tarea` },
    { text: '🔧 Orden', callback_data: `q:${nonce}:orden` },
    { text: '⏰ Alarma', callback_data: `q:${nonce}:alarma` },
  ]])
}

async function preguntarQueEs(chatId: number, text: string, prefix: string | null) {
  const nonce = await borradorConNonce(chatId, text, { tipo: 'aclarar', texto: text })
  await reply(chatId, joinLines(prefix, 'No te entendí. ¿Es una tarea nueva, una orden sobre una tarea, o una alarma?'), botonesAclarar(nonce))
}

// ── Fase 4: free text → interpreter → plan ───────────────────────────────

/**
 * Logs the interpreted message with what came out of it, so the prompt can
 * be tuned later and "la anterior" knows which task was last mentioned.
 */
async function registrar(chatId: number, text: string, r: Interpretacion, acciones: AccionResuelta[]) {
  await registrarInterpretacion({
    chat_id: chatId,
    pregunta: text,
    respuesta: resumenParaLog(acciones),
    modelo: r.modelo,
    tokens_in: r.tokensIn,
    tokens_out: r.tokensOut,
    ms: r.ms,
  })
}

function botonesPlan(nonce: string) {
  return inlineKeyboard([[
    { text: '✅ Hacer todo', callback_data: `k:${nonce}:1` },
    { text: '✏️ No, corrijo', callback_data: `k:${nonce}:0` },
  ]])
}

function botonesHora(nonce: string) {
  return inlineKeyboard([HORAS_BOTONES.map((h) => ({ text: formatHoraEs(`${h}:00`), callback_data: `h:${nonce}:${h}` }))])
}

/**
 * Everything that is not an exact command. `pista` comes from the
 * [Orden] / [Alarma] buttons on a second try.
 */
async function handleLibre(chatId: number, text: string, parsed: Parsed, prefix: string | null, pista?: string) {
  const companies = await cargarEmpresas()
  const r = await interpretar(chatId, text, companies, pista)

  if (!r) {
    // The model is down or answered garbage: the bot keeps working as it did
    // before fase 4, except for alarms, which the classic parser cannot read.
    if (/^(?:alarma|recu[eé]rdame|av[ií]same|recordatorio)\b/i.test(text)) {
      await reply(chatId, joinLines(prefix, 'No pude interpretar la alarma ahora (el modelo falló). Inténtalo otra vez en un momento.'))
      return
    }
    await handleClasico(chatId, text, parsed, prefix)
    return
  }

  const utiles = r.acciones.filter((a) => a.tipo !== 'desconocido')
  if (utiles.length === 0) {
    await registrar(chatId, text, r, resolverAcciones(r.acciones, r.contexto, companies))
    if (pista) {
      await reply(chatId, joinLines(prefix, 'Sigo sin entender. Dime por ejemplo "listo 3", "pasa el 3 al lunes" o "alarma mañana 9am revisar X".'))
      return
    }
    if (clasicoEstructurado(parsed)) {
      await handleClasico(chatId, text, parsed, prefix)
      return
    }
    await preguntarQueEs(chatId, text, prefix)
    return
  }

  const acciones = resolverAcciones(utiles, r.contexto, companies)
  await registrar(chatId, text, r, acciones)

  // ── Several actions, or anything that cancels: show the plan, ask OK ──
  if (necesitaConfirmacion(acciones)) {
    const nonce = await borradorConNonce(chatId, text, { tipo: 'plan', acciones })
    await reply(chatId, joinLines(prefix, renderPlan(acciones)), botonesPlan(nonce))
    return
  }

  // ── One action: run it now ──
  const a = acciones[0]
  if (a.candidatos && a.candidatos.length > 0) {
    const nonce = await borradorConNonce(chatId, text, { tipo: 'elegir', accion: a, candidatos: a.candidatos.map((t) => t.id) })
    await reply(chatId, joinLines(prefix, '¿Cuál?'), inlineKeyboard(botonesElegir(a.candidatos, nonce).map((b) => [b])))
    return
  }
  if (a.error) {
    await reply(chatId, joinLines(prefix, `⚠️ ${a.error.charAt(0).toUpperCase()}${a.error.slice(1)}.`))
    return
  }
  if (a.tipo === 'crear') {
    // Same flow as a typed task: ask company / urgency with buttons if missing.
    await guardarOPreguntar(chatId, text, tareaParsedDe(a), prefix)
    return
  }
  if (a.tipo === 'borrar') {
    // "bórralo": the same [Sí, borrar] [No] as "borra 3". Never without it.
    const params: AccionParams = { accion: 'borra' }
    await responderAccion(chatId, text, params, (nonce) => conIds(params, [a.tarea!.id], nonce), prefix)
    return
  }
  if (a.tipo === 'alarma' && !a.dispara_en) {
    const nonce = await borradorConNonce(chatId, text, { tipo: 'alarma_hora', texto: a.texto, fecha: a.fecha ?? null })
    const dia = a.fecha ? `el ${formatVenceEs(a.fecha)}` : 'hoy'
    await reply(chatId, joinLines(prefix, `¿A qué hora te aviso «${a.texto}» ${dia}?`), botonesHora(nonce))
    return
  }
  await reply(chatId, joinLines(prefix, await ejecutarUna(chatId, a)))
}

// ── Voice notes ──────────────────────────────────────────────────────────

interface TelegramAudio {
  file_id: string
  duration?: number
  mime_type?: string
}

async function handleVoice(chatId: number, audio: TelegramAudio) {
  const duration = audio.duration ?? 0
  if (duration > MAX_AUDIO_SECONDS) {
    await reply(chatId, `Mándame un audio más corto (máx ${MAX_AUDIO_SECONDS / 60} min).`)
    return
  }
  const { bytes, path } = await downloadTelegramFile(audio.file_id)
  const filename = path.split('/').pop() || 'voice.ogg'
  const texto = await transcribirAudio(bytes, filename)
  if (!texto) {
    await reply(chatId, 'No entendí el audio. ¿Me lo repites?')
    return
  }
  // 2c: the transcription always goes back first, in the same message as the
  // confirmation or the question.
  await handleText(chatId, texto, `🎤 Entendí: «${texto}»`)
}

// ── Inline buttons ───────────────────────────────────────────────────────

interface CallbackQuery {
  id: string
  data?: string
  message?: { message_id: number; chat?: { id: number } }
}

async function handleCallback(cq: CallbackQuery) {
  await answerCallbackQuery(cq.id)
  const chatId = cq.message?.chat?.id
  const messageId = cq.message?.message_id
  if (!chatId || !messageId) return
  if (!isAllowedChat(chatId)) {
    console.warn(`[bot] callback de chat no autorizado: ${chatId}`)
    return
  }

  const data = String(cq.data ?? '')

  // ── A sent reminder: [✅ Listo] [⏰ +1h] [📅 Mañana] — no draft involved ──
  const rm = data.match(/^r:([0-9a-f-]{36}):(ok|1h|man)$/)
  if (rm) {
    try {
      await removeInlineKeyboard(chatId, messageId)
      await reply(chatId, await responderRecordatorio(chatId, rm[1], rm[2] as RespuestaRecordatorio))
    } catch (err) {
      console.error('[bot] callback recordatorio error:', err)
      await reply(chatId, ERROR_GENERICO)
    }
    return
  }

  // "e:<nonce>:<company_id>" | "p:<nonce>:<priority>" | "t:<nonce>:<task_id>" | "y:<nonce>:1|0"
  // fase 4: "k:<nonce>:1|0" (plan) | "h:<nonce>:09|12|15|18" (alarm hour) | "q:<nonce>:tarea|orden|alarma"
  const m = data.match(/^([eptykhq]):([0-9a-f]{8}):(.+)$/)
  if (!m) return
  const [, kind, nonce, value] = m

  try {
    await removeInlineKeyboard(chatId, messageId)
    const borrador = await borradorVigente(chatId)
    if (!borrador || nonceDe(borrador.id) !== nonce) {
      await reply(chatId, 'Ese borrador ya expiró (10 min). Mándamelo otra vez.')
      return
    }
    const companies = await cargarEmpresas()
    const parsed = borrador.parsed

    // ── "listo paypal" etc. with several matches: the chosen task ──
    if (parsed.tipo === 'accion') {
      if (kind !== 't' || !parsed.candidatos.includes(value)) return
      const r = await conIds(parsed.params, [value], nonce)
      if (r.confirmar && r.confirmar.length > 0) {
        // borra: one more step — the same draft now waits for the yes/no.
        await actualizarBorrador(borrador.id, { tipo: 'confirmar', params: parsed.params, ids: r.confirmar })
      } else {
        await borrarBorrador(borrador.id)
      }
      await reply(chatId, r.text, r.replyMarkup)
      return
    }

    // ── [Sí, borrar] [No] ──
    if (parsed.tipo === 'confirmar') {
      if (kind !== 'y') return
      await borrarBorrador(borrador.id)
      if (value !== '1') {
        await reply(chatId, 'Ok, no borré nada.')
        return
      }
      await reply(chatId, await ejecutarAccion(parsed.params, parsed.ids))
      return
    }

    // ── Fase 4: [✅ Hacer todo] [✏️ No, corrijo] ──
    if (parsed.tipo === 'plan') {
      if (kind !== 'k') return
      await borrarBorrador(borrador.id)
      if (value !== '1') {
        await reply(chatId, 'Ok, no hice nada. Dímelo otra vez como quieras.')
        return
      }
      await reply(chatId, await ejecutarPlan(chatId, parsed.acciones))
      return
    }

    // ── Fase 4: one interpreted action, several title matches ──
    if (parsed.tipo === 'elegir') {
      if (kind !== 't' || !parsed.candidatos.includes(value)) return
      await borrarBorrador(borrador.id)
      const elegida = parsed.accion.candidatos?.find((t) => t.id === value)
      if (!elegida) return
      if (parsed.accion.tipo === 'borrar') {
        // Chosen, but still a delete: ask [Sí, borrar] [No] on a fresh draft.
        const params: AccionParams = { accion: 'borra' }
        await responderAccion(chatId, borrador.texto, params, (n) => conIds(params, [elegida.id], n), null)
        return
      }
      const accion: AccionResuelta = { ...parsed.accion, tarea: elegida, candidatos: undefined, error: undefined }
      await reply(chatId, await ejecutarUna(chatId, accion))
      return
    }

    // ── Fase 4: "alarma …" without an hour ──
    if (parsed.tipo === 'alarma_hora') {
      if (kind !== 'h' || !(HORAS_BOTONES as readonly string[]).includes(value)) return
      await borrarBorrador(borrador.id)
      const cuando = instanteDe({ fecha: parsed.fecha, hora: `${value}:00` })!
      const r = await crearRecordatorio(chatId, parsed.texto, cuando)
      await reply(chatId, confirmacionAlarma(r))
      return
    }

    // ── Fase 4: "No te entendí" → [Tarea nueva] [Orden] [Alarma] ──
    if (parsed.tipo === 'aclarar') {
      if (kind !== 'q') return
      await borrarBorrador(borrador.id)
      const texto = parsed.texto
      const clasico = parseMensaje(texto, companies, cancunYmd())
      if (value === 'tarea') {
        const tarea = clasico.kind === 'edicion' ? clasico.fallback : clasico.kind === 'tarea' ? clasico.tarea : null
        if (!tarea || !tarea.text) {
          await reply(chatId, 'Mándame la tarea otra vez, por ejemplo: urgente IM llamar a Juan mañana')
          return
        }
        await guardarOPreguntar(chatId, texto, tarea, null)
        return
      }
      await handleLibre(chatId, texto, clasico, null, value === 'alarma' ? PISTA_ALARMA : PISTA_ORDEN)
      return
    }

    // ── "nota: …" without a company: the chosen company ──
    if (parsed.tipo === 'nota') {
      if (kind !== 'e') return
      const c = companies.find((x) => x.id === value)
      if (!c) {
        await reply(chatId, 'Esa empresa ya no existe. Mándame la nota otra vez.')
        return
      }
      await borrarBorrador(borrador.id)
      await reply(chatId, await ejecutarNota({ ...parsed.nota, company_id: c.id, company_name: c.name.trim() }))
      return
    }

    // ── A task missing company and/or priority ──
    if (kind !== 'e' && kind !== 'p') return
    const tarea: TareaParsed = { ...parsed }
    if (kind === 'e') {
      const c = companies.find((x) => x.id === value)
      if (!c) {
        await reply(chatId, 'Esa empresa ya no existe. Mándame la tarea otra vez.')
        return
      }
      tarea.company_id = c.id
      tarea.company_name = c.name.trim()
    } else {
      if (!['urgente', 'normal', 'cuando'].includes(value)) return
      tarea.priority = value as Priority
      if (value === 'urgente') tarea.importante = true
    }

    const falta = faltantes(tarea)
    if (falta.length > 0) {
      await actualizarBorrador(borrador.id, tarea)
      const q = pregunta(falta[0], nonce, companies)
      await reply(chatId, q.text, q.replyMarkup)
      return
    }
    await guardarTarea(tarea)
    await borrarBorrador(borrador.id)
    await reply(chatId, confirmacion(tarea))
  } catch (err) {
    console.error('[bot] callback error:', err)
    await reply(chatId, ERROR_GENERICO)
  }
}

// ── Webhook ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const update = await request.json().catch(() => null)
  if (!update) return NextResponse.json({ ok: true })

  if (update.callback_query) {
    await handleCallback(update.callback_query)
    return NextResponse.json({ ok: true })
  }

  const message = update.message
  const chatId: number | undefined = message?.chat?.id
  if (!chatId) return NextResponse.json({ ok: true })

  // The bot obeys only the chats listed in ALLOWED_CHAT_IDS. Anyone else gets
  // a one-liner and nothing is read or written — this is what makes the same
  // deployment safe to point a second bot (Chelsea's) at later.
  if (!isAllowedChat(chatId)) {
    console.warn(`[bot] chat no autorizado: ${chatId}`)
    await reply(chatId, 'No autorizado')
    return NextResponse.json({ ok: true })
  }

  try {
    const audio: TelegramAudio | undefined = message.voice ?? message.audio
    if (audio?.file_id) {
      await handleVoice(chatId, audio)
    } else if (typeof message.text === 'string') {
      await handleText(chatId, message.text.trim(), null)
    }
  } catch (err) {
    console.error('[bot] error:', err)
    await reply(chatId, ERROR_GENERICO)
  }

  return NextResponse.json({ ok: true })
}
