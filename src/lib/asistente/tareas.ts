// From a parsed task to a saved row, with the two questions the bot can ask
// in between and the one-line confirmation at the end.

import { createServerClient } from '@/lib/supabase-server'
import { PRIORITY_LABELS } from '@/types'
import type { Company, Priority } from '@/types'
import type { Faltante, TareaParsed } from '@/lib/parser'
import { formatVenceEs } from './cancun'
import { inlineKeyboard, type InlineButton } from './telegram'

/** Button order for the company question. Other companies follow, alphabetically. */
const EMPRESAS_BOTONES = ['IM', 'DATAVIA', 'PD', 'Personal', 'Chelsea']
const PRIORIDADES: Priority[] = ['urgente', 'normal', 'cuando']

type CompanyRef = Pick<Company, 'id' | 'name'>

function companiesForButtons(companies: CompanyRef[]): CompanyRef[] {
  const fixed: CompanyRef[] = []
  for (const wanted of EMPRESAS_BOTONES) {
    const c = companies.find((x) => x.name.trim().toLowerCase() === wanted.toLowerCase())
    if (c) fixed.push(c)
  }
  const rest = companies.filter((c) => !fixed.includes(c)).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return [...fixed, ...rest]
}

function rows(buttons: InlineButton[], perRow: number): InlineButton[][] {
  const out: InlineButton[][] = []
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow))
  return out
}

/**
 * The question for the first missing piece. callback_data is
 * "e:<nonce>:<company_id>" or "p:<nonce>:<priority>" — under Telegram's 64 bytes.
 */
export function pregunta(falta: Faltante, nonce: string, companies: CompanyRef[]): { text: string; replyMarkup: unknown } {
  if (falta === 'empresa') {
    const buttons = companiesForButtons(companies).map((c) => ({
      text: c.name.trim(),
      callback_data: `e:${nonce}:${c.id}`,
    }))
    return { text: '¿Para qué empresa?', replyMarkup: inlineKeyboard(rows(buttons, 3)) }
  }
  const buttons = PRIORIDADES.map((p) => ({ text: PRIORITY_LABELS[p], callback_data: `p:${nonce}:${p}` }))
  return { text: '¿Qué urgencia?', replyMarkup: inlineKeyboard([buttons]) }
}

/** "✅ IM · Urgente ★ · «Llamar a Juan» · vence vie 1 nov" */
export function confirmacion(t: TareaParsed): string {
  const parts = [
    t.company_name ?? 'Sin empresa',
    `${PRIORITY_LABELS[t.priority ?? 'normal']}${t.importante ? ' ★' : ''}`,
    `«${t.text}»`,
  ]
  if (t.due_date) parts.push(`vence ${formatVenceEs(t.due_date)}`)
  return `✅ ${parts.join(' · ')}`
}

export async function guardarTarea(t: TareaParsed): Promise<void> {
  const db = createServerClient()
  const { error } = await db.from('tasks').insert({
    text: t.text,
    priority: t.priority ?? 'normal',
    importante: t.importante,
    company_id: t.company_id,
    due_date: t.due_date,
    done: false,
  })
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
}

export async function cargarEmpresas(): Promise<CompanyRef[]> {
  const db = createServerClient()
  const { data, error } = await db.from('companies').select('id, name')
  if (error) throw new Error(`Supabase companies: ${error.message}`)
  return (data as CompanyRef[]) ?? []
}
