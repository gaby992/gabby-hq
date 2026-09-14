'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Task, Company, NotaEmpresa, RadarItem } from '@/types'
import { supabase } from '@/lib/supabase'
import CompanyBadge from './CompanyBadge'
import DueDateLabel from './DueDateLabel'
import ImportantBadge from './ImportantBadge'
import { addDays } from '@/lib/dates'

/** Items shown before the "+N más" link takes over. */
const MAX_ITEMS = 5
/** "Los próximos 7 días" — the C3/C4 line for un-starred `normal` tasks. */
const SOON_DAYS = 7

type QuadrantId = 1 | 2 | 3 | 4

/**
 * One row of a quadrant. A discriminated union rather than three parallel
 * lists, because "hasta 5 ítems / +N más" has to count notes, tasks and radar
 * entries as one sequence.
 */
type Item =
  | { kind: 'task'; key: string; task: Task }
  | { kind: 'nota'; key: string; company: Company; line: string }
  | { kind: 'radar'; key: string; radar: RadarItem }

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
 * wins, so every task lands in exactly one. The branches below are ordered to
 * match that, and between them they cover every priority/star/date combination.
 */
export function quadrantFor(task: Task, today: string, soonCutoff: string): QuadrantId {
  const due = task.due_date

  // C1 takes anything already on fire, starred or not.
  if (due && due <= today) return 1
  if (task.priority === 'urgente' && task.importante) return 1

  // C2 takes the rest of what's starred — future date or no date at all.
  if (task.importante) return 2

  if (task.priority === 'urgente') return 3
  // An un-starred `normal` task is an interruption until its date is far off.
  // This is deliberate: it's the nudge to go star what actually builds.
  if (task.priority === 'normal') return due && due > soonCutoff ? 4 : 3

  return 4 // 'cuando', un-starred
}

/** Ascending by due_date; undated tasks sink to the bottom. */
function byDueAsc(a: Task, b: Task): number {
  if (!a.due_date && !b.due_date) return 0
  if (!a.due_date) return 1
  if (!b.due_date) return -1
  return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
}

function asItems(tasks: Task[]): Item[] {
  return tasks.map((task) => ({ kind: 'task' as const, key: `task-${task.id}`, task }))
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

  const soonCutoff = addDays(today, SOON_DAYS)

  const buckets: Record<QuadrantId, Task[]> = { 1: [], 2: [], 3: [], 4: [] }
  for (const task of tasks) buckets[quadrantFor(task, today, soonCutoff)].push(task)

  // ── C1: vencidas más viejas primero, luego hoy, luego urgentes ──
  const c1 = [
    ...buckets[1].filter((t) => t.due_date && t.due_date < today).sort(byDueAsc),
    ...buckets[1].filter((t) => t.due_date === today),
    ...buckets[1].filter((t) => !t.due_date || t.due_date > today),
  ]

  // ── C2: the notes come first, always — they're the point of this quadrant ──
  const notaItems: Item[] = companies.flatMap((company) => {
    const nota = notas.find((n) => n.company_id === company.id)
    const line = nota?.nota?.trim().split('\n')[0]?.trim()
    if (!line) return []
    return [{ kind: 'nota' as const, key: `nota-${company.id}`, company, line }]
  })
  // Con fecha primero, más cercana arriba; luego las sin fecha.
  const c2 = [...buckets[2]].sort(byDueAsc)

  // ── C3: urgentes primero, luego las normales ──
  const c3 = [
    ...buckets[3].filter((t) => t.priority === 'urgente').sort(byDueAsc),
    ...buckets[3].filter((t) => t.priority !== 'urgente').sort(byDueAsc),
  ]

  // ── C4: "cuando pueda" primero, luego las normales lejanas, luego Radar ──
  const c4 = [
    ...buckets[4].filter((t) => t.priority === 'cuando').sort(byDueAsc),
    ...buckets[4].filter((t) => t.priority !== 'cuando').sort(byDueAsc),
  ]
  // Every radar row, whatever its `estado` — nothing is filtered out by type.
  const radarItems: Item[] = radar.map((r) => ({ kind: 'radar' as const, key: `radar-${r.id}`, radar: r }))

  async function completeTask(task: Task) {
    setCompleting((prev) => new Set(prev).add(task.id))
    await supabase.from('tasks').update({ done: true }).eq('id', task.id)
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
        <button
          key={item.key}
          onClick={() => onRevealCompany(item.company.id)}
          className="group w-full text-left flex items-start gap-2"
          title="Ir al bloque de esta empresa"
        >
          <span className="text-xs leading-5 flex-shrink-0">📝</span>
          <span className="min-w-0 flex-1">
            <CompanyBadge company={item.company} size="xs" />
            <span className="block text-xs leading-5 text-[#7F77DD] group-hover:text-[#9b95e8] truncate transition-colors">
              {item.line}
            </span>
          </span>
        </button>
      )
    }

    if (item.kind === 'radar') {
      return (
        <Link
          key={item.key}
          href="/radar"
          className="flex items-start gap-2 text-xs leading-5 text-[#888888] hover:text-[#e8e8e8] transition-colors"
        >
          <span className="flex-shrink-0 text-[#555555]">📡</span>
          <span className="min-w-0 flex-1 truncate">{item.radar.titulo}</span>
        </Link>
      )
    }

    const { task } = item
    const busy = completing.has(task.id)

    return (
      <div key={item.key} className="flex items-start gap-2">
        <button
          onClick={() => completeTask(task)}
          disabled={busy}
          title="Completar"
          className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 border-[#2a2a2a] hover:border-[#888888] disabled:opacity-40 transition-colors"
        />
        <div className="min-w-0 flex-1">
          <p className={`text-xs leading-5 ${busy ? 'text-[#555555] line-through' : 'text-[#e8e8e8]'}`}>
            {task.text}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {task.company && <CompanyBadge company={task.company} size="xs" />}
            <ImportantBadge importante={task.importante} />
            <DueDateLabel date={task.due_date} today={today} />
          </div>
        </div>
      </div>
    )
  }

  return (
    // 1-2-3-4 stacked on mobile, 2×2 from md up.
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Quadrant
        id={1}
        title="Hoy sí o sí"
        subtitle="Urgente e importante"
        items={asItems(c1)}
        render={renderItem}
      />

      <Quadrant
        id={2}
        title="Construir"
        subtitle="Importante, no urgente — aquí se vive"
        items={[...notaItems, ...asItems(c2)]}
        render={renderItem}
      />

      <Quadrant
        id={3}
        title="Interrupciones"
        subtitle="Urgente, no importante — ¿se puede delegar?"
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
      />
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
}

function Quadrant({ id, title, subtitle, items, render, head, foot }: QuadrantProps) {
  const [expanded, setExpanded] = useState(false)
  const style = STYLES[id]

  const shown = expanded ? items : items.slice(0, MAX_ITEMS)
  const more = items.length - shown.length

  return (
    // The 2×2 shape holds even when a quadrant has nothing in it: no collapsing.
    <section className={`bg-[#1c1c1c] border rounded-lg p-4 space-y-2.5 ${style.border}`}>
      <div>
        <div className="flex items-center gap-2">
          <h2 className={`text-sm font-semibold ${style.title}`}>{title}</h2>
          {items.length > 0 && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${style.count}`}>
              {items.length}
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#555555] mt-0.5">{subtitle}</p>
      </div>

      {head}

      {items.length === 0 ? (
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
      {foot && items.length > 0 && <p className="text-[11px] text-[#555555] pt-0.5">{foot}</p>}
    </section>
  )
}
