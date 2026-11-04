import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { conCanal, type MensajeWeb } from '@/lib/asistente/canal'
import { ERROR_GENERICO, handleText, procesarBoton, reply } from '@/lib/asistente/motor'
import { chatIdWeb } from '@/lib/asistente/telegram'
import { turnosRecientes } from '@/lib/asistente/conversacion'
import { botonesMenuWeb } from '@/lib/asistente/menu'
import { mensajeError } from '@/lib/errores'

// Fase 9c-E: the 💬 chat in /hoy. EXACTLY the bot's engine (motor.ts):
// the same parser, interpreter, conversation memory (bot_conversacion),
// drafts and plan confirmation. The request runs inside the "web" channel,
// so every message the engine sends is collected and returned here instead
// of going to Telegram; a button tap posts its callback_data back as
// `boton`. Text only — no voice for now.
//
// The web chat is Gabby's own thread: it uses the first chat id of
// ALLOWED_CHAT_IDS, so what she says here and in Telegram is ONE
// conversation ("sí", "la segunda" work across both), and an alarm set from
// the web rings in Telegram. Session-guarded (the middleware lets /api/* through).
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET() {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const chatId = chatIdWeb()
    const turnos = await turnosRecientes(chatId, 40)
    return NextResponse.json({
      chat_id: chatId,
      turnos: turnos.map((t) => ({ rol: t.rol, texto: t.texto, canal: t.canal ?? 'telegram', created_at: t.created_at })),
      menu: botonesMenuWeb(),
    })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[chat] GET: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  const texto = typeof b?.texto === 'string' ? b.texto.trim().slice(0, 4000) : ''
  const boton = typeof b?.boton === 'string' ? b.boton.trim().slice(0, 64) : ''
  if (!texto && !boton) return NextResponse.json({ error: 'texto o boton requerido' }, { status: 400 })
  const chatId = chatIdWeb()
  const mensajes: MensajeWeb[] = []
  await conCanal({ tipo: 'web', mensajes }, async () => {
    try {
      if (boton) await procesarBoton(chatId, null, boton)
      else await handleText(chatId, texto, null)
    } catch (err) {
      console.error(`[chat] error: ${mensajeError(err)}`)
      await reply(chatId, ERROR_GENERICO)
    }
  })
  return NextResponse.json({ ok: true, mensajes })
}
