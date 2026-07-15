import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const PRIORITIES = ['urgente', 'normal', 'cuando'] as const
type Priority = (typeof PRIORITIES)[number]

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Weekday tokens (en + es) → day-of-week index (Sun = 0).
const WEEKDAYS: Record<string, number> = {
  sunday: 0, domingo: 0,
  monday: 1, lunes: 1,
  tuesday: 2, martes: 2,
  wednesday: 3, miercoles: 3, 'miércoles': 3,
  thursday: 4, jueves: 4,
  friday: 5, viernes: 5,
  saturday: 6, sabado: 6, 'sábado': 6,
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Best-effort: pull an optional due date out of the task text.
// Understands "due <weekday>", "para (el) <weekday>", tomorrow/mañana, today/hoy.
function extractDueDate(text: string): { dueDate: string | null; cleaned: string } {
  const rel = text.match(/\b(?:due|para(?:\s+el)?)\s+(tomorrow|mañana|manana|today|hoy|[a-zápéíóúäëïöü]+)\b/i)
  if (!rel) return { dueDate: null, cleaned: text }

  const token = rel[1].toLowerCase()
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  let due: Date | null = null

  if (token === 'today' || token === 'hoy') {
    due = base
  } else if (token === 'tomorrow' || token === 'mañana' || token === 'manana') {
    due = new Date(base)
    due.setDate(base.getDate() + 1)
  } else if (token in WEEKDAYS) {
    const diff = (WEEKDAYS[token] - base.getDay() + 7) % 7
    due = new Date(base)
    due.setDate(base.getDate() + diff)
  }

  if (!due) return { dueDate: null, cleaned: text }
  const cleaned = text.replace(rel[0], '').replace(/\s{2,}/g, ' ').trim()
  return { dueDate: ymd(due), cleaned }
}

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
      const rawText = words.slice(companyMatch ? 2 : 1).join(' ')
      const { dueDate, cleaned: taskText } = extractDueDate(rawText)

      if (!taskText) {
        await sendMessage(chatId, `Uso: ${priority} [empresa] <descripción>`)
        return NextResponse.json({ ok: true })
      }

      const { error } = await supabase.from('tasks').insert({
        text: taskText,
        priority,
        company_id: companyMatch?.id ?? null,
        due_date: dueDate,
        done: false,
      })
      if (error) throw error

      const label = companyMatch ? ` · ${companyMatch.name}` : ''
      const dueLabel = dueDate ? ` · due ${dueDate}` : ''
      await sendMessage(chatId, `✓ ${priority}${label}${dueLabel}: "${taskText}"`)

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
