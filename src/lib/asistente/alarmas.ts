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
import { cargarConfig, personaPrompt, type AsistenteConfig } from './config'
import { preguntarLlm, llmConfig } from './llm'
import { formatHoraEs as horaEs } from './cancun'

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

/** What the symbol says about a task. Shared by every list and "¿qué sigue?". */
export type Bucket = 'vencida' | 'hoy' | 'estrella' | 'normal' | 'cuando'

/**
 * Telegram cannot colour text, so the symbols are emoji — the smallest ones:
 *   🔺 vencida · 🔸 vence hoy · ✴️ urgente o ★ · ▫️ normal · ▪️ cuando pueda
 */
export const SIMBOLO: Record<Bucket, string> = { vencida: '🔺', hoy: '🔸', estrella: '✴️', normal: '▫️', cuando: '▪️' }

/** Open tasks shown per company before "+N más en GabbyHQ". */
export const MAX_POR_EMPRESA = 12
const PRIORITY_RANK = { urgente: 0, normal: 1, cuando: 2 } as const

interface Numbered {
  n: number
  task: Task
  bucket: Bucket
}

interface Grupo {
  id: string | null
  name: string
  nota: string | null
  items: Numbered[]
  /** Open tasks of the company beyond MAX_POR_EMPRESA (not numbered, not shown). */
  extra: number
  isChelsea: boolean
}

interface Mensaje {
  text: string
  items: AlarmaItem[]
  /** Evening only: how many were closed today (fase 7-E decides "día difícil"). */
  cerradas?: number
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

/** Which symbol a task gets. Every open task has one (fase 4d: the lists show everything). */
export function bucketFor(t: Task, today: string): Bucket {
  if (t.due_date) {
    if (t.due_date < today) return 'vencida'
    if (t.due_date === today) return 'hoy'
  }
  if (t.priority === 'urgente' || t.importante) return 'estrella'
  if (t.priority === 'normal') return 'normal'
  return 'cuando'
}

export function simboloDe(t: Pick<Task, 'due_date' | 'priority' | 'importante'>, today: string): string {
  return SIMBOLO[bucketFor(t as Task, today)]
}

/**
 * Order inside a company: vencidas (oldest first) → vence hoy → urgente★ →
 * urgente → ★ → normal con fecha (soonest) → normal sin fecha → cuando pueda.
 */
function rango(t: Task, today: string): number {
  if (t.due_date && t.due_date < today) return 0
  if (t.due_date === today) return 1
  if (t.priority === 'urgente' && t.importante) return 2
  if (t.priority === 'urgente') return 3
  if (t.importante) return 4
  if (t.priority === 'normal') return t.due_date ? 5 : 6
  return 7
}

function compareTasks(a: Task, b: Task, today: string): number {
  const r = rango(a, today) - rango(b, today)
  if (r !== 0) return r
  // Dated first (soonest), then by priority, then oldest first.
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
  if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1
  const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (pr !== 0) return pr
  return a.created_at < b.created_at ? -1 : 1
}

/**
 * The numbered list every message shares: per company (fixed order), ALL
 * its open tasks in `rango` order, at most MAX_POR_EMPRESA each (the rest
 * becomes "+N más en GabbyHQ"). Numbers run 1..N across the whole message.
 * A company with neither a note nor open tasks is omitted.
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

  const sections: { id: string | null; name: string; nota: string | null; tasks: Task[]; isChelsea: boolean }[] =
    companiesInOrder(companies).map((c) => ({
      id: c.id,
      name: c.name.trim(),
      nota: notas.find((x) => x.company_id === c.id)?.nota?.trim() || null,
      tasks: tasks.filter((t) => t.company_id === c.id),
      isChelsea: isChelsea(c.name),
    }))
  // Tasks created by the Inbox-IM "I'll handle it" button carry no company;
  // without this block an overdue one would silently vanish from the alarm.
  sections.push({ id: null, name: SIN_EMPRESA, nota: null, tasks: tasks.filter((t) => !t.company_id), isChelsea: false })

  for (const s of sections) {
    const ordered = [...s.tasks].sort((a, b) => compareTasks(a, b, today))
    if (!s.nota && ordered.length === 0) continue

    const shown = ordered.slice(0, MAX_POR_EMPRESA)
    const numbered: Numbered[] = shown.map((task) => {
      n += 1
      items.push({ n, task_id: task.id })
      return { n, task, bucket: bucketFor(task, today) }
    })
    grupos.push({ id: s.id, name: s.name, nota: s.nota, items: numbered, extra: ordered.length - shown.length, isChelsea: s.isChelsea })
  }

  return { grupos, items }
}

// ── Rendering (Telegram HTML) ────────────────────────────────────────────

function lineFor(item: Numbered, today: string): string {
  const text = escapeHtml(item.task.text)
  const sym = SIMBOLO[item.bucket]
  // Tasks with an hour show it ("· 3:00 pm 📅" when they have a Calendar event).
  const hora = item.task.due_time ? ` · ${formatHoraEs(item.task.due_time.slice(0, 5))}${item.task.gcal_event_id ? ' 📅' : ''}` : ''
  switch (item.bucket) {
    case 'vencida': {
      const d = daysBetween(item.task.due_date!, today)
      return `${sym} ${item.n}. ${text} · hace ${d} ${d === 1 ? 'día' : 'días'}`
    }
    case 'hoy':
      return `${sym} ${item.n}. ${text}${hora}`
    default:
      return `${sym} ${item.n}. ${text}${item.task.due_date ? ` · ${formatCortoEs(item.task.due_date)}` : ''}${hora}`
  }
}

function masLine(g: Grupo): string {
  const url = g.id ? `${appUrl()}/tasks?company=${g.id}` : `${appUrl()}/tasks`
  return `· +${g.extra} más en <a href="${url}">GabbyHQ</a>`
}

function chelseaMailLine(count: number | null): string {
  if (count === null) return '📬 Correos: no se pudo consultar inbox-IM'
  if (count === 0) return '📬 Sin correos pendientes'
  return `📬 ${count} ${count === 1 ? 'correo pendiente' : 'correos pendientes'} → <a href="${appUrl()}/inbox">/inbox</a>`
}

function renderGrupo(g: Grupo, today: string, opts: { notas: boolean; chelseaMail?: number | null; header?: boolean }): string[] {
  const lines = opts.header === false ? [] : [`<b>${escapeHtml(g.name)}</b>`]
  if (opts.notas && g.nota) lines.push(`📝 ${escapeHtml(g.nota)}`)
  for (const item of g.items) lines.push(lineFor(item, today))
  if (g.extra > 0) lines.push(masLine(g))
  if (g.isChelsea && opts.chelseaMail !== undefined) lines.push(chelseaMailLine(opts.chelseaMail))
  return lines
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Fase 7-E: the opening line of the morning message, generated by the LLM
 * from the day's numbers (never invents: it only gets counts and titles).
 * Falls back to a fixed sentence in 8 s or on any error.
 */
async function lineaBuenosDias(cfg: AsistenteConfig, tasks: Task[], today: string): Promise<string> {
  const vencenHoy = tasks.filter((t) => t.due_date === today)
  const vencidas = tasks.filter((t) => t.due_date && t.due_date < today)
  const conHora = vencenHoy.filter((t) => t.due_time).sort((a, b) => a.due_time!.localeCompare(b.due_time!))
  const importante = [...vencidas].sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0]
    ?? vencenHoy[0]
    ?? tasks.find((t) => t.priority === 'urgente' && t.importante)
    ?? tasks.find((t) => t.priority === 'urgente')
  const datos = [
    `vencen hoy: ${vencenHoy.length}`,
    `vencidas de antes: ${vencidas.length}`,
    conHora.length > 0 ? `con hora hoy: ${conHora.map((t) => `«${t.text}» a las ${horaEs(t.due_time!.slice(0, 5))}`).join(', ')}` : 'con hora hoy: ninguna',
    importante ? `lo más importante: «${importante.text}»` : 'lo más importante: nada urgente',
  ].join(' · ')
  const fijo = `Buenos días, ${cfg.nombre_persona}. Hoy ${vencenHoy.length === 1 ? 'vence 1 cosa' : `vencen ${vencenHoy.length} cosas`}${vencidas.length > 0 ? ` y ${vencidas.length === 1 ? 'hay 1 vencida' : `hay ${vencidas.length} vencidas`}` : ''}${conHora.length > 0 ? ` · ${conHora.length === 1 ? 'una con hora' : `${conHora.length} con hora`}` : ''}.${importante ? ` Lo más importante: «${importante.text}».` : ''}`
  try {
    llmConfig()
    const r = await preguntarLlm(
      personaPrompt(cfg) + '\n\nEscribe SOLO la primera línea del mensaje de la mañana: un saludo breve con estos datos, máximo 30 palabras, sin lista, sin emojis salvo uno al final si quieres. No agregues nada que no esté en los datos.',
      `DATOS: ${datos}`,
      { maxTokens: 80, timeoutMs: 8_000 }
    )
    const linea = r.text.split('\n')[0].trim()
    return linea.length > 10 && linea.length < 260 ? linea : fijo
  } catch (err) {
    console.warn(`[alarma-manana] línea del día: ${errorMessage(err)} — uso la fija`)
    return fijo
  }
}

export async function buildManana(today: string = cancunYmd()): Promise<Mensaje> {
  const [{ tasks, companies, notas }, chelseaMail, cfg] = await Promise.all([loadOpenTasks(), countChelseaMail(), cargarConfig()])
  // Fase 4b: only notes of the last 3 days are "por dónde iba"; older ones stay in /hoy, greyed.
  const frescas = notas.filter((n) => daysSince(n.updated_at) <= NOTA_FRESCA_DIAS)
  const { grupos, items } = buildGrupos(tasks, companies, frescas, today)

  // Chelsea's block also exists when the only thing to say is her mail count
  // (or that inbox-IM could not be read) — even if the company has no tasks.
  const hasChelsea = grupos.some((g) => g.isChelsea)
  const chelseaCompany = companies.find((c) => isChelsea(c.name))
  if (!hasChelsea && (chelseaMail === null || chelseaMail > 0)) {
    grupos.push({ id: chelseaCompany?.id ?? null, name: chelseaCompany?.name.trim() ?? CHELSEA_COMPANY_NAME, nota: null, items: [], extra: 0, isChelsea: true })
  }

  const link = `<a href="${appUrl()}/hoy">abrir GabbyHQ</a>`
  if (grupos.length === 0) {
    return { text: `☀️ No tienes nada pendiente. Revisa Construir en GabbyHQ.\n${link}`, items: [] }
  }

  const saludo = await lineaBuenosDias(cfg, tasks.filter((t) => !isChelsea(companies.find((c) => c.id === t.company_id)?.name ?? '')), today)
  const blocks: string[] = [`☀️ <b>Hoy, ${formatDiaLargoEs(today)}</b>\n${escapeHtml(saludo)}`]
  for (const g of grupos) blocks.push(renderGrupo(g, today, { notas: true, chelseaMail }).join('\n'))
  const total = grupos.reduce((acc, g) => acc + g.items.length + g.extra, 0)
  blocks.push(`Total: ${plural(total, 'tarea abierta', 'tareas abiertas')} · ${link}`)
  return { text: blocks.join('\n\n'), items }
}

export async function buildTarde(today: string = cancunYmd()): Promise<Mensaje> {
  const [{ tasks, companies }, done] = await Promise.all([loadOpenTasks(), loadDoneToday(today)])
  const { grupos, items } = buildGrupos(tasks, companies, [], today)

  // Fase 7-E: the balance first. "de N" = closed today + still open.
  const vencidas = tasks.filter((t) => t.due_date && t.due_date < today).length
  const balance = done.tasks.length > 0
    ? `Cerraste ${done.tasks.length} de ${done.tasks.length + tasks.length} 👏.${vencidas > 0 ? ` ${vencidas === 1 ? 'Queda 1 vencida' : `Quedan ${vencidas} vencidas`}.` : ''}`
    : tasks.length > 0 ? `Hoy no se cerró nada.${vencidas > 0 ? ` ${vencidas === 1 ? 'Hay 1 vencida' : `Hay ${vencidas} vencidas`}.` : ''}` : 'Nada abierto 🎉'
  const blocks: string[] = [`🌙 <b>Cierre del día</b> · ${formatDiaLargoEs(today)}\n${balance}`]

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

  // ⏳ Sigue pendiente — every open task, recomputed now and renumbered.
  const abiertas = grupos.reduce((acc, g) => acc + g.items.length + g.extra, 0)
  if (items.length > 0) {
    const pendLines = [`⏳ <b>Sigue pendiente (${abiertas})</b>`]
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

  return { text: blocks.join('\n\n'), items, cerradas: done.tasks.length }
}

/**
 * Fase 4d: "/pendientes IM" / "todo lo pendiente de IM" — the same full list
 * for ONE company: "📋 Pendiente · IM (5)", numbered like the morning.
 */
export async function buildPendientes(company: Pick<Company, 'id' | 'name'>, today: string = cancunYmd()): Promise<Mensaje> {
  const { tasks } = await loadOpenTasks()
  const mine = tasks.filter((t) => t.company_id === company.id)
  const { grupos, items } = buildGrupos(mine, [company as Company], [], today)
  const name = escapeHtml(company.name.trim())
  const link = `<a href="${appUrl()}/tasks?company=${company.id}">abrir en GabbyHQ</a>`
  if (mine.length === 0) return { text: `📋 <b>Pendiente · ${name} (0)</b>\nNada abierto 🎉 · ${link}`, items: [] }
  const blocks = [`📋 <b>Pendiente · ${name} (${mine.length})</b>`]
  for (const g of grupos) blocks.push(renderGrupo(g, today, { notas: false, header: false }).join('\n'))
  blocks.push(`Para cerrar o mover: <code>listo 2</code> · <code>pasa 3</code> · ${link}`)
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
export async function enviarLista(chatId: number, tipo: 'manana' | 'tarde' | 'pendientes', company?: Pick<Company, 'id' | 'name'> | null): Promise<number> {
  const built = tipo === 'tarde' ? await buildTarde() : tipo === 'pendientes' && company ? await buildPendientes(company) : await buildManana()
  await sendTelegram(chatId, built.text, { html: true, tag: `lista-${tipo}` })
  // A per-company list is numbered like the morning one; bot_alarmas keeps the numbers under 'manana'.
  await guardarAlarma(tipo === 'tarde' ? 'tarde' : 'manana', built.items)
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
    // Fase 7-E: nothing closed and things still open → offer a clean start (one draft per chat).
    if (tipo === 'tarde' && built.cerradas === 0 && built.items.length > 0 && (await cargarConfig()).sugerencias) {
      const { diaDificil, botonesDe } = await import('./sugerencias')
      const { crearBorrador, nonceDe } = await import('./borradores')
      for (const chat of chats) {
        try {
          const s = diaDificil()
          const b = await crearBorrador(chat, 'cierre', s.draft)
          await sendTelegram(chat, s.texto, { tag: `${tag}-sugerencia`, replyMarkup: botonesDe(s, nonceDe(b.id)) })
        } catch (err) {
          console.error(`[${tag}] sugerencia: ${errorMessage(err)}`)
        }
      }
    }
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
