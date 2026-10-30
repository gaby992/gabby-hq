import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  answerCallbackQuery,
  downloadTelegramFile,
  isAllowedChat,
  removeInlineKeyboard,
  sendTelegram,
} from '@/lib/asistente/telegram'
import { esComandoPasa, manejarPasa } from '@/lib/asistente/pasa'
import { AYUDA, faltantes, parseMensaje, type TareaParsed } from '@/lib/parser'
import { cancunYmd } from '@/lib/asistente/cancun'
import { MAX_AUDIO_SECONDS, transcribirAudio } from '@/lib/asistente/whisper'
import {
  actualizarBorrador,
  borradorVigente,
  borrarBorrador,
  crearBorrador,
  nonceDe,
} from '@/lib/asistente/borradores'
import { cargarEmpresas, confirmacion, guardarTarea, pregunta } from '@/lib/asistente/tareas'
import { responderPregunta } from '@/lib/asistente/pregunta'
import type { Priority } from '@/types'

// Telegram → here (webhook). Text, voice notes and inline-button taps all end
// up in the same place: parseMensaje() → save, or ask for what is missing.
// A voice note needs a round trip to Whisper, and a question one to the LLM
// (20 s cap), so give the function some room.
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

async function handleText(chatId: number, text: string, prefix: string | null) {
  if (!text) {
    await reply(chatId, joinLines(prefix, 'No entendí nada. ¿Me lo repites?'))
    return
  }
  if (esComandoPasa(text)) {
    await reply(chatId, joinLines(prefix, await manejarPasa(text)))
    return
  }

  const parsed = parseMensaje(text, await cargarEmpresas(), cancunYmd())
  switch (parsed.kind) {
    case 'ayuda':
      await reply(chatId, AYUDA)
      return
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
    case 'tarea': {
      if (!parsed.tarea.text) {
        await reply(chatId, joinLines(prefix, 'Falta la tarea. Ejemplo: urgente IM llamar a Juan mañana'))
        return
      }
      await guardarOPreguntar(chatId, text, parsed.tarea, prefix)
    }
  }
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

  // "e:<nonce>:<company_id>" | "p:<nonce>:<priority>"
  const m = String(cq.data ?? '').match(/^([ep]):([0-9a-f]{8}):(.+)$/)
  if (!m) return
  const [, kind, nonce, value] = m

  try {
    await removeInlineKeyboard(chatId, messageId)
    const borrador = await borradorVigente(chatId)
    if (!borrador || nonceDe(borrador.id) !== nonce) {
      await reply(chatId, 'Ese borrador ya expiró (10 min). Mándame la tarea otra vez.')
      return
    }

    const tarea: TareaParsed = { ...borrador.parsed }
    const companies = await cargarEmpresas()
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
