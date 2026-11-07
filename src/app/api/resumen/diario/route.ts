import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { buildManana, enviarLista } from '@/lib/asistente/alarmas'
import { sinHtml } from '@/lib/asistente/resumen'
import { chatIdWeb } from '@/lib/asistente/telegram'
import { mensajeError } from '@/lib/errores'

// Fase 12: the "Resumen diario" button. POST {} returns the SAME text the
// 8:00 alarm builds (summary lines + the numbered list), without Telegram
// tags; POST {"enviar": true} also sends it to Telegram as an on-demand
// list (tipo 'lista', so "la 3 lista" works on it there).
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  const enviar = b?.enviar === true
  try {
    if (enviar) {
      const chat = chatIdWeb()
      if (!chat) return NextResponse.json({ error: 'ALLOWED_CHAT_IDS está vacío: no hay a quién mandarlo' }, { status: 400 })
      const n = await enviarLista(chat, 'manana')
      return NextResponse.json({ ok: true, enviado: true, items: n })
    }
    const built = await buildManana()
    return NextResponse.json({ ok: true, texto: sinHtml(built.text) })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[resumen] diario: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
