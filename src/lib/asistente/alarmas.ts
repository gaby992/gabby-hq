// The two daily alarms: "☀️ Hoy" at 8:00 and "🌙 Cierre del día" at 6:00 pm
// (Cancún). Both build one HTML message from the GabbyHQ Supabase, send it to
// every chat in ALLOWED_CHAT_IDS and record the numbering in `bot_alarmas` so
// that "pasa 2,5" can resolve those numbers later, whatever the list looks
// like by then.

import { createServerClient } from '@/lib/supabase-server'
import { createInboxClient } from '@/lib/supabase-inboxim'
import type { Company, NotaEmpresa, Task } from '@/types'
import { CHELSEA_COMPANY_NAME } from '@/lib/chelsea'
import { NOTA_FRESCA_DIAS } from '@/lib/notas'
import { daysSince } from '@/lib/dates'
import { cancunDayBounds, cancunYmd, daysBetween, formatCortoEs, formatDiaLargoEs, formatHoraEs } from './cancun'
import { allowedChatIds, escapeHtml, sendTelegram } from './telegram'

/** 'que_sigue' (fase 4b) is the numbered "¿qué sigue?" answer, recorded like an alarm. */
export type AlarmaTipo = 'manana' | 'tarde' | 'que_sigue'

/** One numbered line of an alarm: `n` is what Gabby types in "pasa n". */
export interface AlarmaItem {
  n: number
  task_id: string
}

/** Fixed display order. Anything else comes after, alphabetically. */
const EMPRESAS_ORDEN = ['IM', 'DATAVIA', 'PD', 'Personal', CHELSEA_COMPANY_NAME]
const SIN_EMPRESA = 'Sin empresa'

const RETRY_DELAY_MS = 30_000

type Bucket = 'vencida' | 'hoy' | 'estrella'
const BUCKET_ORDER: Bucket[] = ['vencida', 'hoy', 'estrella']
const PRIORITY_RANK = { urgente: 0, normal: 1, cuando: 2 } as const

interface Numbered {
  n: number
  task: Task
  bucket: Bucket
}

interface Grupo {
  name: string
  nota: string | null
  items: Numbered[]
  isChelsea: boolean
}

interface Mensaje {
  text: string
  items: AlarmaItem[]
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

// ── Data ─────────────────────────────────────────────────────────────────

async function loadOpenTasks(): Promise<{ tasks: Task[]; companies: Company[]; notas: NotaEmpresa[] }> {
  const db = createServerClient()
  const [tasksRes, companiesRes, notasRes] = await Promise.all([
    db.from('tasks').select('*').eq('done', false).order('created_at', { ascending: true }),
    db.from('companies').select('*'),
    db.from('notas_empresa').select('*'),
  ])
  if (tasksRes.error) throw new Error(`Supabase tasks: ${tasksRes.error.message}`)
  if (companiesRes.error) throw new Error(`Supabase companies: ${companiesRes.error.message}`)
  if (notasRes.error) throw new Error(`Supabase notas_empresa: ${notasRes.error.message}`)
  return {
    tasks: (tasksRes.data as Task[]) ?? [],
    companies: (companiesRes.data as Company[]) ?? [],
    notas: (notasRes.data as NotaEmpresa[]) ?? [],
  }
}

async function loadDoneToday(today: string): Promise<{ tasks: Task[]; companies: Company[] }> {
  const db = createServerClient()
  const { startIso, endIso } = cancunDayBounds(today)
  const [tasksRes, companiesRes] = await Promise.all([
    db
      .from('tasks')
      .select('*')
      .eq('done', true)
      .gte('completed_at', startIso)
      .lt('completed_at', endIso)
      .order('completed_at', { ascending: true }),
    db.from('companies').select('*'),
  ])
  if (tasksRes.error) throw new Error(`Supabase tasks (hechas): ${tasksRes.error.message}`)
  if (companiesRes.error) throw new Error(`Supabase companies: ${companiesRes.error.message}`)
  return { tasks: (tasksRes.data as Task[]) ?? [], companies: (companiesRes.data as Company[]) ?? [] }
}

/**
 * Mail waiting on Chelsea, read from the inbox-IM project. READ-ONLY: the same
 * service client and the same status filter `/api/inbox?status=pasado_a_chelsea`
 * uses — the cron has no session cookie, so it cannot go through that route.
 * Returns null when inbox-IM is unreachable; the alarm still goes out.
 */
export async function countChelseaMail(): Promise<number | null> {
  try {
    const inbox = createInboxClient()
    const { count, error } = await inbox
      .from('im_triaje')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pasado_a_chelsea')
    if (error) throw error
    return count ?? 0
  } catch (err) {
    console.error(`[alarma] inbox-IM no disponible: ${errorMessage(err)}`)
    return null
  }
}

// ── Grouping ─────────────────────────────────────────────────────────────

function isChelsea(name: string): boolean {
  return name.trim().toLowerCase() === CHELSEA_COMPANY_NAME.toLowerCase()
}

function companiesInOrder(companies: Company[]): Company[] {
  const fixed: Company[] = []
  for (const wanted of EMPRESAS_ORDEN) {
    const c = companies.find((x) => x.name.trim().toLowerCase() === wanted.toLowerCase())
    if (c) fixed.push(c)
  }
  const rest = companies
    .filter((c) => !fixed.includes(c))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return [...fixed, ...rest]
}

function bucketFor(t: Task, today: string): Bucket | null {
  if (t.due_date) {
    if (t.due_date < today) return 'vencida'
    if (t.due_date === today) return 'hoy'
  }
  if (t.priority === 'urgente' || t.importante) return 'estrella'
  return null
}

function compareInBucket(a: Task, b: Task): number {
  // Dated first (soonest), then by priority, then oldest first.
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
  if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1
  const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (pr !== 0) return pr
  return a.created_at < b.created_at ? -1 : 1
}

/**
 * The numbered list both alarms share: per company (fixed order), the open
 * tasks that are overdue, due today, or urgente/★. Numbers run 1..N across
 * the whole message. A company with neither a note nor such tasks is omitted.
 */
function buildGrupos(
  tasks: Task[],
  companies: Company[],
  notas: NotaEmpresa[],
  today: string
): { grupos: Grupo[]; items: AlarmaItem[] } {
  const grupos: Grupo[] = []
  const items: AlarmaItem[] = []
  let n = 0

  const sections: { name: string; nota: string | null; tasks: Task[]; isChelsea: boolean }[] =
    companiesInOrder(companies).map((c) => ({
      name: c.name.trim(),
      nota: notas.find((x) => x.company_id === c.id)?.nota?.trim() || null,
      tasks: tasks.filter((t) => t.company_id === c.id),
      isChelsea: isChelsea(c.name),
    }))
  // Tasks created by the Inbox-IM "I'll handle it" button carry no company;
  // without this block an overdue one would silently vanish from the alarm.
  sections.push({ name: SIN_EMPRESA, nota: null, tasks: tasks.filter((t) => !t.company_id), isChelsea: false })

  for (const s of sections) {
    const picked = s.tasks
      .map((task) => ({ task, bucket: bucketFor(task, today) }))
      .filter((x): x is { task: Task; bucket: Bucket } => x.bucket !== null)
      .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || compareInBucket(a.task, b.task))

    if (!s.nota && picked.length === 0) continue

    const numbered: Numbered[] = picked.map((x) => {
      n += 1
      items.push({ n, task_id: x.task.id })
      return { n, task: x.task, bucket: x.bucket }
    })
    grupos.push({ name: s.name, nota: s.nota, items: numbered, isChelsea: s.isChelsea })
  }

  return { grupos, items }
}

// ── Rendering (Telegram HTML) ────────────────────────────────────────────

function lineFor(item: Numbered, today: string): string {
  const text = escapeHtml(item.task.text)
  // Fase 5: tasks with an hour show it ("· 3:00 pm 📅" when they have a Calendar event).
  const hora = item.task.due_time ? ` · ${formatHoraEs(item.task.due_time.slice(0, 5))}${item.task.gcal_event_id ? ' 📅' : ''}` : ''
  switch (item.bucket) {
    case 'vencida': {
      const d = daysBetween(item.task.due_date!, today)
      return `🔴 ${item.n}. ${text} · hace ${d} ${d === 1 ? 'día' : 'días'}`
    }
    case 'hoy':
      return `🟡 ${item.n}. ${text}${hora}`
    case 'estrella':
      return `⭐ ${item.n}. ${text}${item.task.due_date ? ` · ${formatCortoEs(item.task.due_date)}` : ''}${hora}`
  }
}

function chelseaMailLine(count: number | null): string {
  if (count === null) return '📬 Correos: no se pudo consultar inbox-IM'
  if (count === 0) return '📬 Sin correos pendientes'
  return `📬 ${count} ${count === 1 ? 'correo pendiente' : 'correos pendientes'} → <a href="${appUrl()}/inbox">/inbox</a>`
}

function renderGrupo(g: Grupo, today: string, opts: { notas: boolean; chelseaMail?: number | null }): string[] {
  const lines = [`<b>${escapeHtml(g.name)}</b>`]
  if (opts.notas && g.nota) lines.push(`📝 ${escapeHtml(g.nota)}`)
  for (const item of g.items) lines.push(lineFor(item, today))
  if (g.isChelsea && opts.chelseaMail !== undefined) lines.push(chelseaMailLine(opts.chelseaMail))
  return lines
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export async function buildManana(today: string = cancunYmd()): Promise<Mensaje> {
  const [{ tasks, companies, notas }, chelseaMail] = await Promise.all([loadOpenTasks(), countChelseaMail()])
  // Fase 4b: only notes of the last 3 days are "por dónde iba"; older ones stay in /hoy, greyed.
  const frescas = notas.filter((n) => daysSince(n.updated_at) <= NOTA_FRESCA_DIAS)
  const { grupos, items } = buildGrupos(tasks, companies, frescas, today)

  // Chelsea's block also exists when the only thing to say is her mail count
  // (or that inbox-IM could not be read) — even if the company has no tasks.
  const hasChelsea = grupos.some((g) => g.isChelsea)
  const chelseaCompany = companies.find((c) => isChelsea(c.name))
  if (!hasChelsea && (chelseaMail === null || chelseaMail > 0)) {
    grupos.push({ name: chelseaCompany?.name.trim() ?? CHELSEA_COMPANY_NAME, nota: null, items: [], isChelsea: true })
  }

  const link = `<a href="${appUrl()}/hoy">abrir GabbyHQ</a>`
  if (grupos.length === 0) {
    return { text: `☀️ Hoy no tienes nada urgente. Revisa Construir en GabbyHQ.\n${link}`, items: [] }
  }

  const blocks: string[] = [`☀️ <b>Hoy, ${formatDiaLargoEs(today)}</b>`]
  for (const g of grupos) blocks.push(renderGrupo(g, today, { notas: true, chelseaMail }).join('\n'))
  blocks.push(`Total: ${plural(items.length, 'tarea', 'tareas')} · ${link}`)
  return { text: blocks.join('\n\n'), items }
}

export async function buildTarde(today: string = cancunYmd()): Promise<Mensaje> {
  const [{ tasks, companies }, done] = await Promise.all([loadOpenTasks(), loadDoneToday(today)])
  const { grupos, items } = buildGrupos(tasks, companies, [], today)

  const blocks: string[] = [`🌙 <b>Cierre del día</b> · ${formatDiaLargoEs(today)}`]

  // ✅ Hecho hoy — by company, same fixed order, not numbered (nothing to "pasa").
  const doneLines: string[] = []
  const ordered = companiesInOrder(done.companies)
  const doneSections = [
    ...ordered.map((c) => ({ name: c.name.trim(), tasks: done.tasks.filter((t) => t.company_id === c.id) })),
    { name: SIN_EMPRESA, tasks: done.tasks.filter((t) => !t.company_id) },
  ]
  for (const s of doneSections) {
    if (s.tasks.length === 0) continue
    doneLines.push(`<b>${escapeHtml(s.name)}</b>`)
    for (const t of s.tasks) doneLines.push(`• ${escapeHtml(t.text)}`)
  }
  blocks.push(
    doneLines.length > 0
      ? [`✅ <b>Hecho hoy (${done.tasks.length})</b>`, ...doneLines].join('\n')
      : '✅ <b>Hecho hoy (0)</b> · nada registrado'
  )

  // ⏳ Sigue pendiente — the morning selection, recomputed now and renumbered.
  if (items.length > 0) {
    const pendLines = [`⏳ <b>Sigue pendiente (${items.length})</b>`]
    for (const g of grupos) pendLines.push(...renderGrupo(g, today, { notas: false }))
    blocks.push(pendLines.join('\n'))
  } else {
    blocks.push('⏳ <b>Sigue pendiente (0)</b> · nada de la lista de hoy 🎉')
  }

  // ❌ Due today and still open — same numbers as above.
  const vencidasHoy = grupos.flatMap((g) => g.items.filter((i) => i.bucket === 'hoy'))
  if (vencidasHoy.length > 0) {
    const lines = [`❌ <b>Vencidas hoy sin cerrar (${vencidasHoy.length})</b>`]
    for (const i of vencidasHoy) lines.push(`• ${i.n}. ${escapeHtml(i.task.text)}`)
    blocks.push(lines.join('\n'))
  }

  if (items.length > 0) {
    blocks.push('¿Qué pasa a mañana? Responde: <code>pasa 2,5</code> (o <code>pasa todo</code>)')
  }

  return { text: blocks.join('\n\n'), items }
}

// ── Sending, recording, retrying ─────────────────────────────────────────

export async function guardarAlarma(tipo: AlarmaTipo, items: AlarmaItem[]): Promise<void> {
  const db = createServerClient()
  const { error } = await db
    .from('bot_alarmas')
    .insert({ tipo, items, enviada_en: new Date().toISOString() })
  if (error) throw new Error(`Supabase bot_alarmas: ${error.message}`)
}

/**
 * Fase 4c: the same list, on demand ("/hoy", "dame la lista", "cierre"),
 * sent to ONE chat and recorded like the cron's, so "listo 3" works on it.
 */
export async function enviarLista(chatId: number, tipo: 'manana' | 'tarde'): Promise<number> {
  const built = tipo === 'manana' ? await buildManana() : await buildTarde()
  await sendTelegram(chatId, built.text, { html: true, tag: `lista-${tipo}` })
  await guardarAlarma(tipo, built.items)
  return built.items.length
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface AlarmaResultado {
  tipo: AlarmaTipo
  chats: number
  items: number
  intentos: number
}

/**
 * Run one alarm end to end. On any failure (Supabase, Telegram) wait 30 s and
 * try once more; if that fails too, tell Telegram "⚠️ La alarma … falló" with
 * the reason (no list) and rethrow so the route answers 500 and Vercel logs
 * the cron run as failed. Silence is never an option.
 */
export async function ejecutarAlarma(tipo: AlarmaTipo, opts: { test?: boolean } = {}): Promise<AlarmaResultado> {
  const tag = `alarma-${tipo}`
  const hora = tipo === 'manana' ? '8:00' : '6:00 pm'
  const chats = allowedChatIds()
  if (chats.length === 0) {
    throw new Error('ALLOWED_CHAT_IDS está vacío: no hay a quién mandar la alarma')
  }

  const attempt = async (): Promise<AlarmaItem[]> => {
    const built = tipo === 'manana' ? await buildManana() : await buildTarde()
    const text = (opts.test ? '🧪 <i>prueba manual</i>\n' : '') + built.text
    for (const chat of chats) await sendTelegram(chat, text, { html: true, tag })
    await guardarAlarma(tipo, built.items)
    return built.items
  }

  try {
    const items = await attempt()
    console.log(`[${tag}] enviada · ${items.length} tareas · ${chats.length} chat(s) · intento 1`)
    return { tipo, chats: chats.length, items: items.length, intentos: 1 }
  } catch (err1) {
    console.error(`[${tag}] intento 1 falló: ${errorMessage(err1)} — reintento en ${RETRY_DELAY_MS / 1000}s`)
    await sleep(RETRY_DELAY_MS)
    try {
      const items = await attempt()
      console.log(`[${tag}] enviada · ${items.length} tareas · ${chats.length} chat(s) · intento 2`)
      return { tipo, chats: chats.length, items: items.length, intentos: 2 }
    } catch (err2) {
      const motivo = errorMessage(err2)
      console.error(`[${tag}] intento 2 falló: ${motivo}`)
      for (const chat of chats) {
        try {
          await sendTelegram(chat, `⚠️ La alarma de las ${hora} falló: ${motivo}`, { tag: `${tag}-aviso` })
        } catch (err3) {
          console.error(`[${tag}] ni el aviso de fallo pudo enviarse: ${errorMessage(err3)}`)
        }
      }
      throw err2
    }
  }
}
