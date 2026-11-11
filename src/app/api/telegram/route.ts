import { NextResponse } from 'next/server'
import { esChatChelsea, isAllowedChat } from '@/lib/asistente/telegram'
import { enviarResumenChelsea } from '@/lib/asistente/canal-chelsea'
import { conCanal } from '@/lib/asistente/canal'
import { ERROR_GENERICO, handleCallback, handleDocumento, handleText, handleVoice, reply, type TelegramAudio } from '@/lib/asistente/motor'
import { fotoMasGrande } from '@/lib/documentos/entrada'

// Telegram → here (webhook). The engine lives in src/lib/asistente/motor.ts
// (fase 9c: the web chat shares it); this file only reads the update and
// wraps the work in the Telegram channel, so replies go back to the chat.
// A voice note needs a round trip to Whisper, and the interpreter one to the
// LLM (20 s cap), so give the function some room.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const update = await request.json().catch(() => null)
  if (!update) return NextResponse.json({ ok: true })

  // Fase 18: the second bot (Chelsea's channel) posts here with ?bot=chelsea, so the answers go out through it.
  const esChelsea = new URL(request.url).searchParams.get('bot') === 'chelsea'
  if (esChelsea) {
    const chat: number | undefined = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id
    // That bot only works in its one chat: anything else is ignored without a word.
    if (!esChatChelsea(chat)) return NextResponse.json({ ok: true })
    if (update.callback_query) {
      await conCanal({ tipo: 'telegram', bot: 'chelsea' }, () => handleCallback(update.callback_query))
    } else if (typeof update.message?.text === 'string' && /^\/(start|help|ayuda|resumen|chelsea)\b/i.test(update.message.text.trim())) {
      // Text is not Gabita here (her numbered lists live in Gabby's own chat): only the summary on demand.
      await conCanal({ tipo: 'telegram', bot: 'chelsea' }, async () => {
        await enviarResumenChelsea()
      })
    }
    return NextResponse.json({ ok: true })
  }

  if (update.callback_query) {
    await conCanal({ tipo: 'telegram' }, () => handleCallback(update.callback_query))
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
    await conCanal({ tipo: 'telegram' }, () => reply(chatId, 'No autorizado'))
    return NextResponse.json({ ok: true })
  }

  await conCanal({ tipo: 'telegram' }, async () => {
    try {
      const audio: TelegramAudio | undefined = message.voice ?? message.audio
      // Fase 14 (segundo cerebro): a PDF or a photo goes to the archivero.
      const foto = fotoMasGrande(message.photo ?? [])
      if (message.document?.file_id) {
        await handleDocumento(chatId, message.document, { caption: message.caption ?? null })
      } else if (foto) {
        await handleDocumento(chatId, foto, { caption: message.caption ?? null, esFoto: true })
      } else if (audio?.file_id) {
        await handleVoice(chatId, audio)
      } else if (typeof message.text === 'string') {
        await handleText(chatId, message.text.trim(), null)
      }
    } catch (err) {
      console.error('[bot] error:', err)
      await reply(chatId, ERROR_GENERICO)
    }
  })

  return NextResponse.json({ ok: true })
}
