import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const PRIORITIES = ['urgente', 'normal', 'cuando'] as const
type Priority = (typeof PRIORITIES)[number]

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

export async function POST(request: Request) {
  const update = await request.json()
  const message = update?.message
  if (!message?.text || !message?.chat?.id) {
    return NextResponse.json({ ok: true })
  }

  const chatId: number = message.chat.id
  const text: string = message.text.trim()
  const words = text.split(/\s+/)
  const first = words[0].toLowerCase()

  try {
    if (first === 'radar') {
      const titulo = words.slice(1).join(' ')
      if (!titulo) {
        await sendMessage(chatId, 'Uso: radar <descripción>')
        return NextResponse.json({ ok: true })
      }
      const { error } = await supabase.from('radar').insert({ titulo, estado: 'idea' })
      if (error) throw error
      await sendMessage(chatId, `✓ Radar: "${titulo}"`)

    } else if ((PRIORITIES as readonly string[]).includes(first)) {
      const priority = first as Priority

      const { data: companies } = await supabase.from('companies').select('id, name')
      const companyMatch = companies?.find(
        (c) => c.name.toLowerCase() === words[1]?.toLowerCase()
      )
      const taskText = words.slice(companyMatch ? 2 : 1).join(' ')

      if (!taskText) {
        await sendMessage(chatId, `Uso: ${priority} [empresa] <descripción>`)
        return NextResponse.json({ ok: true })
      }

      const { error } = await supabase.from('tasks').insert({
        text: taskText,
        priority,
        company_id: companyMatch?.id ?? null,
        done: false,
      })
      if (error) throw error

      const label = companyMatch ? ` · ${companyMatch.name}` : ''
      await sendMessage(chatId, `✓ ${priority}${label}: "${taskText}"`)

    } else {
      await sendMessage(
        chatId,
        'Formato:\n  urgente/normal/cuando [empresa] tarea\n  radar descripción\n\nEmpresas: IM · DATAVIA · PD · Personal'
      )
    }
  } catch (err) {
    console.error('Telegram bot error:', err)
    await sendMessage(chatId, 'Error al guardar. Intenta de nuevo.')
  }

  return NextResponse.json({ ok: true })
}
