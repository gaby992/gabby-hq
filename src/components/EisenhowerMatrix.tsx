'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Task, Company, NotaEmpresa, RadarItem, COMPANY_COLORS } from '@/types'
import { supabase } from '@/lib/supabase'
import { relativeDaysEs } from '@/lib/dates'
import { syncCalendar } from '@/lib/calendar-client'
import CompanyBadge from './CompanyBadge'
import DueDateLabel from './DueDateLabel'
import ImportantBadge from './ImportantBadge'

/** Items shown before the "+N más" link takes over. */
const MAX_ITEMS = 5

/**
 * Lines of a note shown in C1 before "ver más" takes over. Spelled out as a
 * whole class name — Tailwind scans the source as text, so a built-up
 * `line-clamp-${n}` would never make it into the CSS.
 */
const NOTE_CLAMP = 'line-clamp-6'

type QuadrantId = 1 | 2 | 3 | 4

/**
 * One row of a quadrant. A discriminated union rather than three parallel
 * lists, because "hasta 5 ítems / +N más" has to count notes, tasks and radar
 * entries as one sequence.
 */
type Item =
  | { kind: 'task'; key: string; task: Task; hideCompany?: boolean }
  | { kind: 'nota'; key: string; company: Company; nota: NotaEmpresa; text: string }
  | { kind: 'radar'; key: string; radar: RadarItem }
  /** Mini-header above a run of 2+ tasks of the same company (fase 4b). */
  | { kind: 'empresa'; key: string; company: Company }

/** Title truncation inside the matrix; the full text is the tooltip. */
const TITLE_MAX = 70

function truncate(s: string, max: number = TITLE_MAX): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s
}

interface Props {
  /** Open tasks only — the matrix never shows anything already done. */
  tasks: Task[]
  companies: Company[]
  notas: NotaEmpresa[]
  radar: RadarItem[]
  /** Same number the summary strip shows; null when Inbox-IM is unreachable. */
  inboxCount: number | null
  today: string
  onUpdate: () => void
  /** Scrolls to a company block further down the page and expands it. */
  onRevealCompany: (companyId: string) => void
}

/**
 * Which quadrant a task belongs to. Evaluated C1 → C2 → C3 → C4, first match
 * wins, so every task lands in exactly one. The branches are ordered to match
 * that, and between them they cover every priority/star/date combination.
 *
 * Note this is what resolves the overlaps: a "cuando pueda" task that is
 * starred is caught by C2 before C4 ever sees it.
 */
export function quadrantFor(task: Task, today: string): QuadrantId {
  // C1 is "lo que vence": overdue or due today, whatever its priority.
  if (task.due_date && task.due_date <= today) return 1
  if (task.priority === 'urgente' || task.importante) return 2
  if (task.priority === 'normal') return 3
  return 4 // 'cuando', un-starred
}

/** Ascending by due_date; undated tasks sink to the bottom. */
function byDueAsc(a: Task, b: Task): number {
  if (!a.due_date && !b.due_date) return 0
  if (!a.due_date) return 1
  if (!b.due_date) return -1
  return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
}

/**
 * Tasks as rows, with a company mini-header before every run of 2+ tasks of
 * the same company (those rows then drop their own badge). A lone task keeps
 * its badge inline.
 */
function asItems(tasks: Task[]): Item[] {
  const out: Item[] = []
  let i = 0
  while (i < tasks.length) {
    const t = tasks[i]
    let j = i + 1
    while (j < tasks.length && t.company_id && tasks[j].company_id === t.company_id) j += 1
    const run = tasks.slice(i, j)
    if (run.length >= 2 && t.company) {
      out.push({ kind: 'empresa', key: `empresa-${t.company_id}-${i}`, company: t.company })
      for (const task of run) out.push({ kind: 'task', key: `task-${task.id}`, task, hideCompany: true })
    } else {
      for (const task of run) out.push({ kind: 'task', key: `task-${task.id}`, task })
    }
    i = j
  }
  return out
}

const STYLES: Record<QuadrantId, { border: string; title: string; count: string }> = {
  1: { border: 'border-red-900/50', title: 'text-red-400', count: 'bg-red-950/60 text-red-400' },
  2: { border: 'border-[#7F77DD]/40', title: 'text-[#7F77DD]', count: 'bg-[#1e1a3d] text-[#7F77DD]' },
  3: { border: 'border-amber-900/50', title: 'text-amber-400', count: 'bg-amber-950/50 text-amber-400' },
  4: { border: 'border-[#333333]', title: 'text-[#888888]', count: 'bg-[#2a2a2a] text-[#888888]' },
}

export default function EisenhowerMatrix({
  tasks,
  companies,
  notas,
  radar,
  inboxCount,
  today,
  onUpdate,
  onRevealCompany,
}: Props) {
  // Ids being written to, so a double click can't fire two updates.
  const [completing, setCompleting] = useState<Set<string>>(new Set())

  const buckets: Record<QuadrantId, Task[]> = { 1: [], 2: [], 3: [], 4: [] }
  for (const task of tasks) buckets[quadrantFor(task, today)].push(task)

  // ── C1: the notes come first, always — that's where the last session left off ──
  const notaItems: Item[] = companies.flatMap((company) => {
    const nota = notas.find((n) => n.company_id === company.id)
    // Whole note, line breaks and all — the first line alone loses the "y luego
    // hay que…" that usually sits underneath it.
    const text = nota?.nota?.trim()
    if (!nota || !text) return []
    return [{ kind: 'nota' as const, key: `nota-${company.id}`, company, nota, text }]
  })
  // Then what's due: oldest overdue first, then today's.
  const c1 = [
    ...buckets[1].filter((t) => t.due_date! < today).sort(byDueAsc),
    ...buckets[1].filter((t) => t.due_date === today),
  ]

  // ── C2: urgentes+★ primero, luego urgentes, luego ★ ──
  const rank = (t: Task) => (t.priority === 'urgente' ? (t.importante ? 0 : 1) : 2)
  const c2 = [...buckets[2]].sort((a, b) => rank(a) - rank(b) || byDueAsc(a, b))

  const c3 = [...buckets[3]].sort(byDueAsc)

  // ── C4: "cuando pueda", luego Radar ──
  const c4 = [...buckets[4]].sort(byDueAsc)
  // Every radar row, whatever its `estado` — nothing is filtered out by type.
  const radarItems: Item[] = radar.map((r) => ({ kind: 'radar' as const, key: `radar-${r.id}`, radar: r }))

  async function completeTask(task: Task) {
    setCompleting((prev) => new Set(prev).add(task.id))
    await supabase.from('tasks').update({ done: true }).eq('id', task.id)
    // Fase 5-D: its Calendar event (if any) goes too.
    await syncCalendar(task)
    // The parent refetch drops the task from `tasks`, which re-runs every
    // quadrant above — that's the "se recalcula todo".
    onUpdate()
    setCompleting((prev) => {
      const next = new Set(prev)
      next.delete(task.id)
      return next
    })
  }

  function renderItem(item: Item) {
    if (item.kind === 'nota') {
      return (
        <MatrixNote
          key={item.key}
          company={item.company}
          nota={item.nota}
          text={item.text}
          onReveal={onRevealCompany}
        />
      )
    }

    if (item.kind === 'radar') {
      return (
        <Link
          key={item.key}
          href="/radar"
          className="flex items-center gap-2 text-xs leading-5 text-[#888888] hover:text-[#e8e8e8] transition-colors"
        >
          <span className="flex-shrink-0 text-[#555555]">📡</span>
          <span className="min-w-0 flex-1 truncate" title={item.radar.titulo}>{item.radar.titulo}</span>
        </Link>
      )
    }

    if (item.kind === 'empresa') {
      // 12px above the run (the list gap already gives 8), badge as the heading.
      return (
        <div key={item.key} className="pt-1">
          <CompanyBadge company={item.company} size="xs" />
        </div>
      )
    }

    const { task } = item
    const busy = completing.has(task.id)

    // One line: checkbox · title (truncated, full text on hover) · badges right.
    return (
      <div key={item.key} className={`flex items-center gap-2 ${item.hideCompany ? 'pl-2' : ''}`}>
        <button
          onClick={() => completeTask(task)}
          disabled={busy}
          title="Completar"
          className="flex-shrink-0 w-4 h-4 rounded border-2 border-[#2a2a2a] hover:border-[#888888] disabled:opacity-40 transition-colors"
        />
        <p
          title={task.text}
          className={`min-w-0 flex-1 truncate text-xs leading-5 ${busy ? 'text-[#555555] line-through' : 'text-[#e8e8e8]'}`}
        >
          {truncate(task.text)}
        </p>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          {!item.hideCompany && task.company && <CompanyBadge company={task.company} size="xs" />}
          <ImportantBadge importante={task.importante} />
          <DueDateLabel date={task.due_date} time={task.due_time} today={today} />
        </div>
      </div>
    )
  }

  return (
    // 1-2-3-4 stacked on mobile, 2×2 from md up.
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Quadrant
        id={1}
        title="Arranca por aquí"
        subtitle="Por dónde ibas + lo que vence"
        items={asItems(c1)}
        render={renderItem}
        // Fase 4b: the notes (≤ 3 days) are their own zone, above a subtle line.
        head={notaItems.length > 0 ? <div className="space-y-2">{notaItems.map(renderItem)}</div> : null}
      />

      <Quadrant
        id={2}
        title="Construir"
        subtitle="Urgente o importante"
        items={asItems(c2)}
        render={renderItem}
      />

      <Quadrant
        id={3}
        title="Lo demás"
        subtitle="Normal — ¿se puede delegar?"
        items={asItems(c3)}
        render={renderItem}
        // Fixed first line. Same number as the summary strip because both read
        // it from GET /api/inbox, so the two can never disagree.
        head={
          inboxCount !== null ? (
            <Link
              href="/inbox"
              className={`flex items-start gap-2 text-xs leading-5 transition-colors ${
                inboxCount > 0 ? 'text-amber-400 hover:text-amber-300 font-medium' : 'text-[#555555] hover:text-[#888888]'
              }`}
            >
              <span className="flex-shrink-0">✉️</span>
              <span>
                {inboxCount} {inboxCount === 1 ? 'correo esperando decisión' : 'correos esperando decisión'}
              </span>
            </Link>
          ) : null
        }
      />

      <Quadrant
        id={4}
        title="Algún día"
        subtitle="Ni urgente ni importante — estacionamiento"
        items={[...asItems(c4), ...radarItems]}
        render={renderItem}
        foot="¿Algo de aquí merece subir a Construir?"
        collapsibleOnMobile
      />
    </div>
  )
}

interface MatrixNoteProps {
  company: Company
  nota: NotaEmpresa
  text: string
  onReveal: (companyId: string) => void
}

/**
 * A "por dónde iba" note inside C1: the full text, clamped to six lines until
 * "ver más" opens it in place. Editing still happens in the company block
 * further down — the badge is the way there.
 */
function MatrixNote({ company, nota, text, onReveal }: MatrixNoteProps) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  // Whether the clamp actually hides anything depends on where the lines wrap,
  // so it has to be measured; counting '\n' would miss a long wrapped line.
  useEffect(() => {
    if (expanded) return
    const el = textRef.current
    if (!el) return

    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [text, expanded])

  const color = COMPANY_COLORS[company.color] ?? '#888780'

  return (
    // Fase 4b: its own surface (#222 on #1c1c1c) and the company as a heading.
    <div className="rounded-md bg-[#222222] px-3 py-2.5">
      <button
        onClick={() => onReveal(company.id)}
        title="Ir al bloque de esta empresa"
        className="flex items-center gap-1.5 text-xs font-semibold hover:opacity-80 transition-opacity"
        style={{ color }}
      >
        <span>📝</span>
        <span>{company.name}</span>
      </button>
      {/* whitespace-pre-wrap: she writes paragraphs with dashed bullets. */}
      <p
        ref={textRef}
        className={`mt-1 text-xs leading-5 text-[#7F77DD] whitespace-pre-wrap break-words ${
          expanded ? '' : NOTE_CLAMP
        }`}
      >
        {text}
      </p>
      {clamped && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-[#7F77DD] hover:text-[#9b95e8] font-medium transition-colors"
        >
          ver más
        </button>
      )}
      <p className="text-[10px] text-[#555555] mt-0.5">escrita {relativeDaysEs(nota.updated_at)}</p>
    </div>
  )
}

interface QuadrantProps {
  id: QuadrantId
  title: string
  subtitle: string
  items: Item[]
  render: (item: Item) => React.ReactNode
  /** Always-present first line, above the items (C3's inbox count). */
  head?: React.ReactNode
  /** Always-present closing line, below the items (C4's prompt). */
  foot?: string
  /** Fase 4b: on phones the quadrant starts folded (C4). From md up it is always open. */
  collapsibleOnMobile?: boolean
}

function Quadrant({ id, title, subtitle, items, render, head, foot, collapsibleOnMobile }: QuadrantProps) {
  const [expanded, setExpanded] = useState(false)
  const [openOnMobile, setOpenOnMobile] = useState(false)
  const style = STYLES[id]

  // Headers don't count as items for the "+N más" cut.
  const countable = items.filter((i) => i.kind !== 'empresa').length
  const shown = expanded ? items : items.slice(0, MAX_ITEMS + (items.slice(0, MAX_ITEMS).filter((i) => i.kind === 'empresa').length))
  const more = countable - shown.filter((i) => i.kind !== 'empresa').length
  const folded = collapsibleOnMobile && !openOnMobile

  return (
    // The 2×2 shape holds even when a quadrant has nothing in it: no collapsing.
    <section className={`bg-[#1c1c1c] border rounded-lg p-6 space-y-3 ${style.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className={`text-sm font-semibold ${style.title}`}>{title}</h2>
            {countable > 0 && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${style.count}`}>
                {countable}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#555555] mt-0.5">{subtitle}</p>
        </div>
        {collapsibleOnMobile && (
          <button
            onClick={() => setOpenOnMobile((v) => !v)}
            className="md:hidden text-xs text-[#888888] hover:text-[#e8e8e8] transition-colors"
          >
            {folded ? 'ver' : 'ocultar'}
          </button>
        )}
      </div>

      <div className={`space-y-3 ${folded ? 'hidden md:block' : ''}`}>
        {head}
        {/* A subtle line between the notes zone (or the inbox line) and the tasks. */}
        {head && countable > 0 && <div className="border-t border-[#2a2a2a]" />}

        {countable === 0 ? (
          // `head` already puts something on screen, so don't contradict it.
          !head && <p className="text-xs text-[#555555]">— nada aquí</p>
        ) : (
          <div className="space-y-2">{shown.map(render)}</div>
        )}

        {more > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-[#7F77DD] hover:text-[#9b95e8] font-medium transition-colors"
          >
            +{more} más
          </button>
        )}

        {/* Only worth asking when there's actually something parked here. */}
        {foot && countable > 0 && <p className="text-[11px] text-[#555555] pt-0.5">{foot}</p>}
      </div>
    </section>
  )
}
