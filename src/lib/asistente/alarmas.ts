// The two daily alarms: "☀️ Hoy" at 8:00 and "🌙 Cierre del día" at 7:30 pm (fase 16: when her last block ends)
// (Cancún). Both build one HTML message from the GabbyHQ Supabase, send it to
// every chat in ALLOWED_CHAT_IDS and record the numbering in `bot_alarmas` so
// that "pasa 2,5" can resolve those numbers later, whatever the list looks
// like by then.

import { avisosConexiones } from '@/lib/google/oauth'
import { createServerClient } from '@/lib/supabase-server'
import type { Company, NotaEmpresa, Task } from '@/types'
import { CHELSEA_COMPANY_NAME } from '@/lib/chelsea'
import { NOTA_FRESCA_DIAS } from '@/lib/notas'
import { daysSince } from '@/lib/dates'
import { HORIZONTES, HORIZONTE_EMOJI, HORIZONTE_LABELS, compararEnColumna, horizonteDe, type Horizonte } from '@/lib/horizonte'
import { cancunDayBounds, cancunHm, cancunYmd, daysBetween, formatCortoEs, formatDiaLargoEs, formatHoraEs } from './cancun'
import { SIMBOLO, bucketFor, type Bucket } from './simbolos'
import { allowedChatIds, escapeHtml, sendTelegram } from './telegram'
import { cargarConfig } from './config'
import { seccionCorreosDiaria } from '@/lib/correo/listas'
import { guardarAlarma, type AlarmaItem, type AlarmaTipo } from './registro-listas'
import { mensajeError } from '@/lib/errores'
import { cargarPanorama, resumenManana, resumenTarde } from './narracion'
import { enviarTablero } from './tablero-imagen'
import { tecladoMenu } from './menu'
import { avisoVencimientos, tituloRenovar } from '@/lib/documentos/vencimientos'
import type { Documento as DocumentoVence } from '@/lib/documentos/tipos'
import { inlineKeyboard } from './telegram'
import { hoyTeToca, textoHoyTeToca } from './bloques'

// The numbering record (bot_alarmas) lives in registro-listas.ts; re-exported so the old imports keep working.
export { guardarAlarma, ultimaAlarma, type AlarmaItem, type AlarmaTipo } from './registro-listas'

/** Fixed display order. Anything else comes after, alphabetically. */
const EMPRESAS_ORDEN = ['IM', 'DATAVIA', 'PD', 'Personal', CHELSEA_COMPANY_NAME]
const SIN_EMPRESA = 'Sin empresa'

const RETRY_DELAY_MS = 30_000

// Telegram cannot colour text, so the symbols are emoji (simbolos.ts); re-exported so the old imports keep working.
export { SIMBOLO, bucketFor, simboloDe, type Bucket } from './simbolos'

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
  /** Fase 14: the documents whose vencimiento the message warned about, for the "renovar" buttons. */
  vencimientos?: DocumentoVence[]
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

const errorMessage = mensajeError

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

function renderGrupo(g: Grupo, today: string, opts: { notas: boolean; header?: boolean }): string[] {
  const lines = opts.header === false ? [] : [`<b>${escapeHtml(g.name)}</b>`]
  if (opts.notas && g.nota) lines.push(`📝 ${escapeHtml(g.nota)}`)
  for (const item of g.items) lines.push(lineFor(item, today))
  if (g.extra > 0) lines.push(masLine(g))
  return lines
}

/**
 * Fase 6-F / ajuste 6-0: "📧" — the pending mails of the `correos` table
 * (nuevo / para_chelsea), per account, numbered after the tasks so "el 15
 * lo hago yo" works like "listo 3"; 5 per account, then "+N más → correos".
 * Never inbox-IM. Never throws: a failure becomes one line.
 */
async function seccionCorreos(desde: number, items: AlarmaItem[]): Promise<string> {
  try {
    return await seccionCorreosDiaria(desde, items)
  } catch (err) {
    console.error(`[alarma] sección de correos: ${errorMessage(err)}`)
    return '📧 Correos: no se pudieron consultar ahora'
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// ── Fase 9: the lists mirror the board ───────────────────────────────────
//   🔥 Hoy sí o sí → 📅 Mañana (titles only) → ⏳ Esperando → 📧 Correos.
//   "Esta semana" and "Después" stay in the app (only their counts travel).

/** Numbered lines per section before "+N más en GabbyHQ". */
const MAX_HOY = 15
const MAX_MANANA = 10
const MAX_ESPERANDO = 10

interface Seccion {
  horizonte: Horizonte
  tasks: Task[]
}

/** The board's columns from the open tasks, each already in column order. Chelsea's tasks sit in ⏳. */
function columnas(tasks: Task[], companies: Company[], today: string): Record<Horizonte, Task[]> {
  const chelseaId = companies.find((c) => isChelsea(c.name))?.id ?? null
  const out: Record<Horizonte, Task[]> = { hoy: [], manana: [], semana: [], esperando: [], despues: [] }
  for (const t of tasks) out[horizonteDe(t, today, chelseaId)].push(t)
  for (const h of HORIZONTES) out[h].sort((a, b) => compararEnColumna(a, b, today))
  return out
}

/**
 * One line of a board section. 🔥 keeps the list symbols and the "why"
 * (hace N días · hora · urgente ★); 📅 is title + company (and hour);
 * ⏳ adds who it waits for.
 */
function lineaTablero(n: number, t: Task, h: Horizonte, companies: Company[], today: string): string {
  const text = escapeHtml(t.text)
  const empresa = escapeHtml(companies.find((c) => c.id === t.company_id)?.name.trim() ?? SIN_EMPRESA)
  const hora = t.due_time ? `${formatHoraEs(t.due_time.slice(0, 5))}${t.gcal_event_id ? ' 📅' : ''}` : ''
  if (h === 'esperando') {
    const partes = [text, empresa]
    if (t.esperando_a) partes.push(escapeHtml(t.esperando_a))
    else if (t.due_date) partes.push(formatCortoEs(t.due_date))
    return `⏳ ${n}. ${partes.join(' · ')}`
  }
  if (h === 'manana') return `${SIMBOLO[bucketFor(t, today)]} ${n}. ${[text, empresa, hora].filter(Boolean).join(' · ')}`
  // 🔥
  const bucket = bucketFor(t, today)
  const porque =
    bucket === 'vencida' ? (() => { const d = daysBetween(t.due_date!, today); return `hace ${d} ${d === 1 ? 'día' : 'días'}` })()
    : bucket === 'hoy' ? hora
    : t.importante ? 'urgente ★' : 'urgente'
  return `${SIMBOLO[bucket]} ${n}. ${[text, empresa, porque].filter(Boolean).join(' · ')}`
}

function masTablero(extra: number): string {
  return `· +${extra} más en <a href="${appUrl()}/hoy">GabbyHQ</a>`
}

/** Renders one section, numbering from items.length + 1 and recording each line. */
function renderSeccion(s: Seccion, max: number, companies: Company[], today: string, items: AlarmaItem[], opts: { vacio?: string } = {}): string | null {
  const titulo = `${HORIZONTE_EMOJI[s.horizonte]} <b>${HORIZONTE_LABELS[s.horizonte]} (${s.tasks.length})</b>`
  if (s.tasks.length === 0) return opts.vacio ? `${titulo}\n${opts.vacio}` : null
  const lines = [titulo]
  for (const t of s.tasks.slice(0, max)) {
    items.push({ n: items.length + 1, task_id: t.id })
    lines.push(lineaTablero(items.length, t, s.horizonte, companies, today))
  }
  if (s.tasks.length > max) lines.push(masTablero(s.tasks.length - max))
  return lines.join('\n')
}

/** 🔥 → 📅 → ⏳ (the alarm's order), then the counts of what stays in the app. */
function seccionesTablero(tasks: Task[], companies: Company[], today: string, items: AlarmaItem[], opts: { vacioHoy: string }): { bloques: string[]; semana: number; despues: number } {
  const col = columnas(tasks, companies, today)
  const bloques = [
    renderSeccion({ horizonte: 'hoy', tasks: col.hoy }, MAX_HOY, companies, today, items, { vacio: opts.vacioHoy }),
    renderSeccion({ horizonte: 'manana', tasks: col.manana }, MAX_MANANA, companies, today, items),
    renderSeccion({ horizonte: 'esperando', tasks: col.esperando }, MAX_ESPERANDO, companies, today, items),
  ].filter((b): b is string => !!b)
  return { bloques, semana: col.semana.length, despues: col.despues.length }
}

function pieTotales(tasks: Task[], semana: number, despues: number): string {
  const resto = [semana > 0 ? `${semana} esta semana` : null, despues > 0 ? `${despues} después` : null].filter(Boolean).join(' · ')
  return `Total: ${plural(tasks.length, 'tarea abierta', 'tareas abiertas')}${resto ? ` (${resto}, en la app)` : ''} · <a href="${appUrl()}/hoy">abrir GabbyHQ</a>`
}

export async function buildManana(today: string = cancunYmd()): Promise<Mensaje> {
  // Fase 9c-C: the same rows feed the paragraph and the list, so they never disagree.
  const [panorama, cfg] = await Promise.all([cargarPanorama(today), cargarConfig()])
  const { tasks, companies, notas } = panorama
  const items: AlarmaItem[] = []
  const link = `<a href="${appUrl()}/hoy">abrir GabbyHQ</a>`
  if (tasks.length === 0) {
    const correos = await seccionCorreos(0, items)
    return { text: `☀️ No tienes tareas pendientes. Revisa Después en GabbyHQ.\n${link}\n\n${correos}`, items }
  }

  // Fase 9c-C (ajuste 9c-2): the summary in lines first — greeting, one line per horizon
  // (vencidas · para hoy · urgentes · mañana · esperando · correos), one 👉 — then the list.
  const saludo = await resumenManana(cfg, panorama)
  const blocks: string[] = [`☀️ <b>Hoy, ${formatDiaLargoEs(today)}</b>\n${escapeHtml(saludo)}`]

  // Fase 16: qué bloque le toca de aquí en adelante (lo de antes de esta hora ya pasó).
  // Sin el SQL de la fase 16 no hay plantilla y este bloque simplemente no sale.
  try {
    const teToca = textoHoyTeToca((await hoyTeToca(tasks, companies, today)).bloques, today === cancunYmd() ? cancunHm() : '00:00')
    if (teToca) blocks.push(teToca)
  } catch (err) {
    console.warn(`[manana] hoy te toca: ${mensajeError(err)}`)
  }

  // Fase 4b: only notes of the last 3 days are "por dónde iba"; older ones stay in /hoy, greyed.
  const frescas = companiesInOrder(companies)
    .map((c) => ({ c, nota: notas.find((n) => n.company_id === c.id)?.nota?.trim() }))
    .filter((x): x is { c: Company; nota: string } => !!x.nota && daysSince(notas.find((n) => n.company_id === x.c.id)!.updated_at) <= NOTA_FRESCA_DIAS)
  if (frescas.length > 0) blocks.push(['📝 <b>Por dónde ibas</b>', ...frescas.map((x) => `📝 ${escapeHtml(x.c.name.trim())}: ${escapeHtml(x.nota)}`)].join('\n'))

  const { bloques, semana, despues } = seccionesTablero(tasks, companies, today, items, { vacioHoy: '— nada vencido ni urgente 🎉' })
  blocks.push(...bloques)
  blocks.push(await seccionCorreos(items.length, items))
  // Fase 14: lo que vence (30 / 7 / 1 día, y todos los días si ya se pasó) va ANTES del pie,
  // porque renovar un seguro vencido pesa más que el total de tareas.
  const vence = await avisoVencimientos(today)
  if (vence) blocks.push(vence.texto)
  blocks.push(pieTotales(tasks, semana, despues))
  // Fase 12b: if Google refuses a connection, the morning says so with the fix — before anything silently stops.
  const conexiones = await avisosConexiones()
  if (conexiones.length > 0) blocks.push(conexiones.join('\n'))
  return { text: blocks.join('\n\n'), items, vencimientos: vence?.documentos ?? [] }
}

/**
 * Fase 14: under the morning list, one button per vencimiento so the warning
 * can become a task in one tap. Best effort: a failure here never costs the
 * alarm.
 */
async function enviarBotonesVencimientos(chatId: number, docs: DocumentoVence[] | undefined, tag: string): Promise<void> {
  if (!docs || docs.length === 0) return
  try {
    const filas = docs.slice(0, 4).map((d) => [{ text: `➕ ${tituloRenovar(d).slice(0, 40)}`, callback_data: `dv:${d.id}` }])
    await sendTelegram(chatId, '¿Lo convierto en tarea?', { tag: `${tag}-vencimientos`, replyMarkup: inlineKeyboard(filas) })
  } catch (err) {
    console.error(`[${tag}] botones de vencimientos: ${mensajeError(err)}`)
  }
}

export async function buildTarde(today: string = cancunYmd()): Promise<Mensaje> {
  const [panorama, done, cfg] = await Promise.all([cargarPanorama(today), loadDoneToday(today), cargarConfig()])
  const { tasks, companies } = panorama
  const items: AlarmaItem[] = []

  // Fase 9c-C (ajuste 9c-2): the summary in lines first — what got done, what is left per horizon, one 👉 — then the list.
  const balance = await resumenTarde(cfg, panorama, done.tasks)
  const blocks: string[] = [`🌙 <b>Cierre del día</b> · ${formatDiaLargoEs(today)}\n${escapeHtml(balance)}`]

  // ✅ Hecho hoy — on top, by company, same fixed order, not numbered (nothing to "pasa").
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

  // Fase 9: then the board as it stands now — 🔥 still open is what "¿Qué pasa a mañana?" asks about.
  const { bloques, semana, despues } = seccionesTablero(tasks, companies, today, items, { vacioHoy: '— nada de hoy sin cerrar 🎉' })
  blocks.push(...bloques)
  blocks.push(await seccionCorreos(items.length, items))
  blocks.push(pieTotales(tasks, semana, despues))

  if (items.some((i) => i.task_id)) {
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

/**
 * Fase 4c: the same list, on demand ("/hoy", "dame la lista", "cierre"),
 * sent to ONE chat and recorded (tipo 'lista', with the message) so
 * "listo 3" works on it and a mail line can be struck through later.
 */
export async function enviarLista(chatId: number, tipo: 'manana' | 'tarde' | 'pendientes', company?: Pick<Company, 'id' | 'name'> | null): Promise<number> {
  const built = tipo === 'tarde' ? await buildTarde() : tipo === 'pendientes' && company ? await buildPendientes(company) : await buildManana()
  const messageId = await sendTelegram(chatId, built.text, { html: true, tag: `lista-${tipo}` })
  await guardarAlarma('lista', built.items, { chat_id: chatId, message_id: messageId, texto: built.text })
  await enviarBotonesVencimientos(chatId, built.vencimientos, `lista-${tipo}`)
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
  const hora = tipo === 'manana' ? '8:00' : '7:30 pm'
  const chats = allowedChatIds()
  if (chats.length === 0) {
    throw new Error('ALLOWED_CHAT_IDS está vacío: no hay a quién mandar la alarma')
  }

  const attempt = async (): Promise<AlarmaItem[]> => {
    const built = tipo === 'manana' ? await buildManana() : await buildTarde()
    const text = (opts.test ? '🧪 <i>prueba manual</i>\n' : '') + built.text
    let primero: { chat_id: number; message_id: number | null } | null = null
    for (const chat of chats) {
      // Fase 9c-B: the board as a picture BEFORE the text. Best effort: a failure is a log line, never a missing alarm.
      try {
        await enviarTablero(chat, { tag: `${tag}-tablero` })
      } catch (err) {
        console.error(`[${tag}] foto del tablero: ${errorMessage(err)}`)
      }
      // Fase 9c-A: the persistent menu rides on the alarm, so it is always there.
      const id = await sendTelegram(chat, text, { html: true, tag, replyMarkup: tecladoMenu() })
      if (!primero) primero = { chat_id: chat, message_id: id }
      // Fase 14: los vencimientos del día, con su botón para hacerlos tarea.
      await enviarBotonesVencimientos(chat, built.vencimientos, tag)
    }
    // Ajuste 6-7: the close records its numbers like the morning (and where it went, for in-place strikes).
    await guardarAlarma(tipo, built.items, primero ? { ...primero, texto: text } : null)
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
