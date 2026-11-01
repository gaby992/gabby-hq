// Fase 4: the bot understands how Gabby actually writes. Any message that is
// not an exact command goes through the LLM with a prompt that returns a JSON
// list of actions ("1 terminado / 9 cancelar no se va hacer / 11 se llama
// URo, pasar para mañana" → completar, cancelar, renombrar, posponer).
//
// The context carries the last alarm's numbers and the open tasks (title,
// company, date) — NEVER `tasks.notes`. Every interpreted message is logged
// in bot_preguntas (modelo "interprete:…") with the resulting actions, so the
// prompt can be tuned from real traffic.

import { createServerClient } from '@/lib/supabase-server'
import type { Priority } from '@/types'
import { COLS_SIN_NOTAS, normalizar, ultimaAlarma, type TaskRow } from './acciones'
import { extraerCalendar, extraerFecha, extraerHora } from '@/lib/parser'
import { addDays, cancunHm, cancunYmd, formatDiaLargoEs } from './cancun'
import { llmConfig, preguntarLlm } from './llm'
import { cargarConfig, personaPrompt, type AsistenteConfig } from './config'
import { historial, renderHistorial, tareasRecientes } from './conversacion'

export const MAX_TOKENS = 900
export const TIMEOUT_MS = 20_000
/** Open tasks sent to the model, at most. Alarm-numbered ones go first. */
const MAX_TAREAS = 80

export type NotaModoLlm = 'reemplazar' | 'agregar'

/** What the model may answer. `ref` is "#3" (last alarm), "t12" (open task), "anterior" or title text. */
export type AccionLlm =
  | { tipo: 'completar'; ref: string }
  | { tipo: 'cancelar'; ref: string; motivo?: string }
  | { tipo: 'borrar'; ref: string }
  | { tipo: 'posponer'; ref: string; fecha: string }
  | { tipo: 'renombrar'; ref: string; titulo: string }
  | { tipo: 'cambiar'; ref: string; prioridad?: Priority; empresa?: string; fecha?: string; hora?: string; calendar?: boolean }
  | { tipo: 'crear'; titulo: string; empresa?: string; prioridad?: Priority; fecha?: string; hora?: string; importante?: boolean; calendar?: boolean }
  | { tipo: 'calendar'; ref: string; hora?: string; todo_el_dia?: boolean }
  | { tipo: 'pagos_listar'; empresa?: string; semana?: boolean }
  | { tipo: 'dividir'; ref: string }
  | { tipo: 'siguiente_paso'; ref?: string }
  | { tipo: 'nota_empresa'; empresa: string; texto: string; modo: NotaModoLlm }
  | { tipo: 'nota_tarea'; ref: string; texto: string }
  | { tipo: 'alarma'; texto: string; fecha?: string; hora?: string; en_minutos?: number }
  | { tipo: 'pregunta'; texto: string }
  | { tipo: 'que_sigue'; empresa?: string; solo_urgentes?: boolean; solo_vencer?: boolean }
  | { tipo: 'lista'; lista: 'manana' | 'tarde' | 'pendientes'; empresa?: string }
  | { tipo: 'desconocido'; texto: string }

export type TipoAccionLlm = AccionLlm['tipo']

const TIPOS: TipoAccionLlm[] = [
  'completar', 'cancelar', 'borrar', 'posponer', 'renombrar', 'cambiar', 'crear',
  'nota_empresa', 'nota_tarea', 'alarma', 'pregunta', 'que_sigue', 'lista', 'calendar',
  'pagos_listar', 'dividir', 'siguiente_paso', 'desconocido',
]

/** A task as the interpreter and the plan see it: no notes. */
export type TareaLite = Pick<TaskRow, 'id' | 'text' | 'due_date' | 'due_time' | 'priority' | 'importante' | 'company'>

export interface ContextoInterprete {
  text: string
  /** "#3" / "t12" → task, for the resolver. */
  porRef: Map<string, TareaLite>
  abiertas: TareaLite[]
  anterior: TareaLite | null
}

// ── Context ──────────────────────────────────────────────────────────────

/** The task the last interpreted message of this chat touched (from the log). */
async function ultimaMencionada(chatId: number): Promise<string | null> {
  const { data, error } = await createServerClient()
    .from('bot_preguntas')
    .select('respuesta')
    .eq('chat_id', chatId)
    .like('modelo', 'interprete:%')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ respuesta: string }>()
  if (error || !data) return null
  try {
    const j = JSON.parse(data.respuesta)
    return typeof j?.ultima_tarea_id === 'string' ? j.ultima_tarea_id : null
  } catch {
    return null
  }
}

function fechaCorta(t: TareaLite, today: string): string {
  if (!t.due_date) return 'sin fecha'
  const hora = t.due_time ? ` ${t.due_time.slice(0, 5)}` : ''
  if (t.due_date < today) return `vencida (${t.due_date}${hora})`
  if (t.due_date === today) return `vence hoy${hora}`
  return `vence ${t.due_date}${hora}`
}

export async function construirContextoInterprete(
  chatId: number,
  companies: { id: string; name: string }[],
  now: Date = new Date()
): Promise<ContextoInterprete> {
  const today = cancunYmd(now)
  const db = createServerClient()
  const [openRes, alarma, anteriorLog, turnos, recientes] = await Promise.all([
    db.from('tasks').select(COLS_SIN_NOTAS).eq('done', false).order('created_at', { ascending: false }),
    ultimaAlarma(),
    ultimaMencionada(chatId),
    historial(chatId, now),
    tareasRecientes(chatId),
  ])
  // Fase 7: "la anterior" is the last task the thread talked about; the old log is the fallback.
  const anteriorId = recientes[0]?.id ?? anteriorLog
  if (openRes.error) throw new Error(`Supabase tasks: ${openRes.error.message}`)
  const abiertas = (openRes.data as unknown as TareaLite[]) ?? []
  const byId = new Map(abiertas.map((t) => [t.id, t]))

  const porRef = new Map<string, TareaLite>()
  const lines: string[] = []
  const usados = new Set<string>()

  // 1. The last alarm, in its own numbering — "el 9" means this.
  if (alarma) {
    const que = alarma.tipo === 'manana' ? 'alarma 8:00 am' : alarma.tipo === 'tarde' ? 'alarma 6:00 pm' : 'respuesta a "¿qué sigue?" (1 = "el primero", 2 = "el segundo"…)'
    lines.push(`ÚLTIMA LISTA NUMERADA (${que}, ${alarma.enviada_en.slice(0, 16).replace('T', ' ')} UTC) — sus números:`)
    for (const it of alarma.items) {
      const t = byId.get(it.task_id)
      if (!t) {
        lines.push(`[#${it.n}] (ya cerrada o borrada)`)
        continue
      }
      porRef.set(`#${it.n}`, t)
      usados.add(t.id)
      lines.push(`[#${it.n}] ${t.text} · ${t.company?.name ?? 'sin empresa'} · ${fechaCorta(t, today)}`)
    }
    lines.push('')
  } else {
    lines.push('ÚLTIMA ALARMA: ninguna todavía (no uses refs "#n").', '')
  }

  // 2. The other open tasks: dated first (soonest), then the rest, newest first.
  const resto = abiertas
    .filter((t) => !usados.has(t.id))
    .sort((a, b) => {
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
      if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1
      return 0
    })
  const cupo = Math.max(0, MAX_TAREAS - usados.size)
  lines.push(`OTRAS TAREAS ABIERTAS (${resto.length}):`)
  resto.slice(0, cupo).forEach((t, i) => {
    const ref = `t${i + 1}`
    porRef.set(ref, t)
    lines.push(`[${ref}] ${t.text} · ${t.company?.name ?? 'sin empresa'} · ${fechaCorta(t, today)} · ${t.priority}${t.importante ? ' ★' : ''}`)
  })
  if (resto.length > cupo) lines.push(`(+${resto.length - cupo} más que no caben; si no ves la tarea, pon el título como ref)`)
  lines.push('')

  const anterior = anteriorId ? byId.get(anteriorId) ?? null : null
  if (anterior) {
    const ref = Array.from(porRef.entries()).find(([, t]) => t.id === anterior.id)?.[0]
    lines.push(`ÚLTIMA TAREA MENCIONADA ("la anterior"): ${ref ? `[${ref}] ` : ''}${anterior.text}`, '')
  }

  lines.push(`EMPRESAS: ${companies.map((c) => c.name.trim()).join(', ')}`)
  lines.push(`HOY: ${today} (${formatDiaLargoEs(today)}) · hora actual ${cancunHm(now)} (Cancún) · mañana = ${addDays(today, 1)}`)

  // Fase 7: the recent thread, with each mentioned task's current ref.
  const refPorId = new Map(Array.from(porRef.entries()).map(([ref, t]) => [t.id, ref]))
  const hilo = renderHistorial(turnos, (id) => (refPorId.has(id) ? `[${refPorId.get(id)}]` : null))
  if (hilo) lines.push('', hilo)

  return { text: lines.join('\n'), porRef, abiertas, anterior }
}

// ── Prompt ───────────────────────────────────────────────────────────────

export function systemPrompt(today: string, cfg: AsistenteConfig = { nombre_persona: 'Gabby', nombre_bot: 'Asistente', tono: 'informal', sugerencias: true }): string {
  const manana = addDays(today, 1)
  return [
    personaPrompt(cfg),
    '',
    `Aquí actúas como INTÉRPRETE de órdenes de ${cfg.nombre_persona}. Recibes un CONTEXTO (fecha y hora en Cancún, sus empresas, ` +
      'sus tareas abiertas con un id entre corchetes y la última alarma numerada) y un MENSAJE escrito o dictado por voz. ' +
      'Respondes SOLO con un JSON {"acciones":[...]} con lo que Gabby quiere hacer, en el orden en que lo dijo. Nada fuera del JSON.',
    '',
    'Tipos de acción (campos entre paréntesis son opcionales):',
    '- {"tipo":"completar","ref":REF}  → terminado, terminada, hecho, listo, ya está, ya quedó, done',
    '- {"tipo":"cancelar","ref":REF,("motivo":"…")}  → SOLO cuando dice cancelar, no se va a hacer, ya no aplica. ' +
      '"motivo" = la razón, SOLO si la dio ("no se va a hacer", "el cliente se echó atrás"); NUNCA la orden en sí ("cancélalo", "pídelo cancelar"). Sin razón → sin "motivo"',
    '- {"tipo":"borrar","ref":REF}  → borra, elimina, bórralo, quítala de la lista. Se elimina de verdad (el bot pide confirmación)',
    '- {"tipo":"posponer","ref":REF,"fecha":"YYYY-MM-DD"}  → pasar/mover/dejar para otro día',
    '- {"tipo":"renombrar","ref":REF,"titulo":"…"}  → "se llama X", "cámbiale el nombre". Si solo corrige una palabra, devuelve el título completo corregido',
    '- {"tipo":"cambiar","ref":REF,("prioridad":"urgente|normal|cuando"),("empresa":"…"),("fecha":"YYYY-MM-DD"),("hora":"HH:MM"),("calendar":true)}  → solo lo que cambia; "y ponla en calendar" → calendar:true',
    '- {"tipo":"crear","titulo":"…",("empresa":"…"),("prioridad":"urgente|normal|cuando"),("fecha":"YYYY-MM-DD"),("hora":"HH:MM"),("importante":true)}  → tarea nueva. ' +
      'La fecha ("para el viernes", "el 15 de noviembre", "en 3 días", "mañana") y la hora ("3pm", "a las 10") NUNCA van en el título: van en fecha/hora. ' +
      'Si dice "y ponla en calendar" / "agrégala al calendario" / "en la agenda", pon "calendar":true y quítalo del título. Sin eso, la tarea NO va a Calendar aunque tenga hora',
    '- {"tipo":"calendar","ref":REF,("hora":"HH:MM"),("todo_el_dia":true)}  → "pon en calendar la de TOTT", "agrega al calendario el 3", "la anterior al calendar": crear el evento de una tarea que ya existe',
    '- {"tipo":"pagos_listar",("empresa":"…"),("semana":true)}  → "pagos de IM", "qué pagos tengo", "qué pagos hay esta semana" (semana:true). ' +
      'Los pagos recurrentes solo se CONSULTAN por aquí; crearlos, cambiarlos o quitarlos se hace en la web (Settings): si lo pide, responde "desconocido" con texto "los pagos se administran en Settings → Pagos recurrentes"',
    '- {"tipo":"nota_empresa","empresa":"…","texto":"…","modo":"reemplazar|agregar"}  → "nota de IM: …", "apunta en PD que …" (agregar si dice agrega/suma/además)',
    '- {"tipo":"nota_tarea","ref":REF,"texto":"…"}  → un comentario sobre una tarea existente',
    '- {"tipo":"alarma","texto":"…",("fecha":"YYYY-MM-DD"),("hora":"HH:MM")}  → alarma, recuérdame, avísame, ponme un recordatorio. ' +
      'Para "en 2 horas"/"en 30 minutos" usa "en_minutos":120 en vez de fecha/hora. Si no dijo hora, NO inventes una: omite "hora". ' +
      'texto = qué recordar, sin la fecha ni la hora. Una alarma NO es una tarea (salvo que diga "y agrégala como tarea": entonces también crear)',
    '- {"tipo":"pregunta","texto":"…"}  → pregunta sobre sus tareas (qué tengo hoy, qué cerré ayer, cómo voy con IM)',
    '- {"tipo":"que_sigue",("empresa":"…"),("solo_urgentes":true),("solo_vencer":true)}  → "qué sigue", "qué hago primero", "qué es lo más urgente", "por dónde empiezo". ' +
      '"solo urgentes" → solo_urgentes; "qué vence / qué está por vencer esta semana" → solo_vencer; "qué sigue de IM" → empresa',
    '- {"tipo":"lista","lista":"manana|tarde|pendientes",("empresa":"…")}  → la LISTA COMPLETA numerada: "dame la lista", "la lista de la mañana", "lista completa", "todo lo pendiente", "mándame el /hoy" → manana; ' +
      '"cierre", "lista de la tarde", "el cierre del día" → tarde; "todo lo pendiente de IM", "qué tengo pendiente en PD", "pendientes de IM" → pendientes + empresa. ' +
      'Esto NO es que_sigue (que_sigue es corto y ordenado; lista es todo)',
    '- {"tipo":"dividir","ref":REF}  → "me da flojera X", "no sé por dónde empezar con X", "divide X", "paso a paso X": partir una tarea en pasos',
    '- {"tipo":"siguiente_paso",("ref":REF)}  → "siguiente paso", "el que sigue" (sin ref = la última tarea dividida)',
    '- {"tipo":"desconocido","texto":"…"}  → saludos, comentarios o algo que no es ninguna de las anteriores',
    '',
    'REF = a qué tarea se refiere: el id entre corchetes del contexto ("#3" = número de la última alarma, "t12" = otra tarea abierta), ' +
      'o "anterior" (la última tarea mencionada), o un trozo del título si de verdad no la ves en la lista. ' +
      'Un número suelto ("1 terminado", "el 9 cancelar", "pasa el 5") o un ordinal ("listo el primero", "pasa el segundo") es el número de la ÚLTIMA LISTA NUMERADA → "#1", "#9", "#5", "#1", "#2". ' +
      'Gabby escribe rápido y con errores de dedo ("terminaso" = terminado, "URo" puede ser "Puro"): elige la tarea más parecida. ' +
      'Varias órdenes vienen separadas por "/", comas o saltos de línea: una acción por orden. ' +
      'Una orden con dos cosas ("11 se llama URo, pasar para mañana") son DOS acciones sobre el mismo ref.',
    'SEMANA: si el mensaje describe VARIOS días ("hoy…, mañana…, el miércoles…, el jueves…"), separa cada cosa mencionada en su propia acción "crear" con la fecha de ESE día ' +
      '(en orden). "prioridad", "lo importante", "lo más importante", "me voy a concentrar en" → esa tarea con prioridad "urgente" e "importante":true. ' +
      'Si una cosa mencionada es claramente una tarea que ya está en la lista (mismo tema: "lo de marketing", "Jobescape"), usa "posponer" o "cambiar" con su ref en vez de crear. ' +
      'Un verbo dentro de la frase ("cancelar Jobescape") que describe la TAREA a hacer ese día sigue siendo crear ("Cancelar Jobescape"), salvo que esa tarea ya exista en la lista.',
    'CONVERSACIÓN: si el mensaje es una respuesta corta a tu último turno ("sí", "dale", "la segunda", "esa no, la otra", "lo mismo para PD", "¿y lo de ayer?", "cambia la hora a las 4"), ' +
      'resuélvelo con la CONVERSACIÓN RECIENTE del contexto: "la segunda" = la 2ª tarea mencionada en tu último mensaje (ahí viene su ref); "esa no, la otra" = la otra tarea mencionada; ' +
      '"lo mismo para PD" = repite la última acción que ella pidió, con empresa PD; "cambia la hora a las 4" = cambiar hora de la última tarea creada o mencionada. ' +
      'Si tu último turno fue una pregunta y ella contesta "sí"/"no", ejecuta lo que preguntaste. Si no hay conversación reciente, trátalo como un mensaje nuevo.',
    '',
    `FECHAS: hoy es ${today}; "mañana" = ${manana}; "pasado mañana" = ${addDays(today, 2)}. ` +
      'Un día de la semana es el PRÓXIMO (si hoy es lunes, "el lunes" es dentro de 7 días). ' +
      'Horas en 24 h: "3pm" → "15:00", "9" o "9am" → "09:00", "a las 10" → "10:00" (o "22:00" si dice "de la noche"). ' +
      'Si la hora de una alarma ya pasó hoy y no dijo día, es mañana.',
    'PRIORIDAD: "urgente" implica importante. EMPRESA: usa el nombre exacto de la lista EMPRESAS.',
    'Una frase sin verbo de orden ni número ("llamar a Juan", "revisar pagos PD mañana", "urgente IM mandar propuesta") es "crear". ' +
      'PERO una frase que empieza por "por dónde iba", "nota:", "nota IM", "notas de PD" o parecido NUNCA es crear: es "nota_empresa" (texto = lo que sigue, modo reemplazar) con la empresa que mencione. ' +
      'En "crear", "hoy" / "mañana" / un día de la semana al final NO van en el título: van en "fecha". ' +
      'Si dicta los campos separados por comas ("Agregar un nuevo task, whatsapp, chelito, due date, mañana, compañía"), ' +
      'las palabras de campo (task, due date, compañía, prioridad) no son el título: titulo = "whatsapp chelito", fecha = mañana, y si dice "compañía" sin nombre, omite empresa.',
    '',
    'Ejemplo. MENSAJE: "1 terminado / 9 cancelar no se va hacer / 11 se llama URo, pasar para mañana / bórrame el 4 / alarma mañana 3pm revisar pagos de PD"',
    `→ {"acciones":[{"tipo":"completar","ref":"#1"},{"tipo":"cancelar","ref":"#9","motivo":"no se va a hacer"},` +
      `{"tipo":"borrar","ref":"#4"},` +
      `{"tipo":"renombrar","ref":"#11","titulo":"URo pendiente"},{"tipo":"posponer","ref":"#11","fecha":"${manana}"},` +
      `{"tipo":"alarma","texto":"revisar pagos de PD","fecha":"${manana}","hora":"15:00"}]}`,
  ].join('\n')
}

// ── JSON → actions ───────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function prioridad(v: unknown): Priority | undefined {
  const s = str(v)?.toLowerCase()
  if (!s) return undefined
  if (s.startsWith('urg')) return 'urgente'
  if (s.startsWith('cuando')) return 'cuando'
  if (s.startsWith('norm')) return 'normal'
  return undefined
}

function fecha(v: unknown): string | undefined {
  const s = str(v)
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined
}

function hora(v: unknown): string | undefined {
  const s = str(v)
  const m = s?.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return undefined
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return undefined
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/**
 * "Por dónde iba IM: …", "nota IM: …", "notas de PD: …" typed as a task title
 * → the nota_empresa action instead. Returns null when the title is not a note.
 */
const RE_POR_DONDE_IBA = /^por\s+d[oó]nde\s+(?:iba|voy|vamos|íbamos|ibamos)\b\s*(?:(?:con|de|en)\s+)?(?:([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\s*:\s*)?:?\s*([\s\S]*)$/i
// "nota: …", "nota IM: …", "notas de PD: …" — the colon is what makes it a note;
// "Notas de reunión con Juan" (no colon) stays a task.
const RE_NOTA = /^notas?(?:\s+de)?\b\s*(?::\s*|\s+([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\s*:\s*)([\s\S]*)$/i
export function comoNotaEmpresa(titulo: string, empresa?: string): AccionLlm | null {
  const m = titulo.match(RE_POR_DONDE_IBA) ?? titulo.match(RE_NOTA)
  if (!m) return null
  const texto = (m[2] ?? '').trim()
  return { tipo: 'nota_empresa', empresa: empresa ?? m[1] ?? '', texto: texto || titulo, modo: 'reemplazar' }
}

// Words that are the order itself, not a reason: "pídelo cancelar", "bórralo".
const PALABRAS_ORDEN = new Set([
  'cancelar', 'cancela', 'cancelalo', 'cancelala', 'cancelarla', 'cancelarlo', 'cancelada', 'cancelado',
  'borrar', 'borra', 'borralo', 'borrala', 'borrarla', 'borrarlo', 'eliminar', 'elimina', 'eliminalo', 'eliminala',
  'quitar', 'quita', 'quitalo', 'quitala', 'pidelo', 'pidela', 'pide', 'por', 'favor', 'porfa',
  'lo', 'la', 'el', 'esa', 'esta', 'ese', 'este', 'tarea', 'de', 'del', 'a', 'y',
])

/**
 * The cancel reason as it will be written in notes: only a real reason ("no
 * se va a hacer"), never the order itself ("pídelo cancelar", "bórralo").
 */
export function limpiarMotivo(v: unknown): string | undefined {
  const m = str(v)
  if (!m) return undefined
  // Drop the order words at the front ("cancelar, no se va hacer" → "no se va hacer").
  let texto = m
  for (;;) {
    const lead = texto.match(/^([^\s,.:;]+)[\s,.:;]+/)
    if (!lead) break
    const w = normalizar(lead[1])
    if (!PALABRAS_ORDEN.has(w) || /^(lo|la|el|esa|esta|ese|este)$/.test(w)) break
    texto = texto.slice(lead[0].length)
  }
  const palabras = normalizar(texto).replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(Boolean)
  const utiles = palabras.filter((w) => !PALABRAS_ORDEN.has(w))
  return utiles.length > 0 ? texto.replace(/[.!]+$/, '').trim() : undefined
}

/** Tolerates a fenced or chatty answer: takes the first {…} block. */
function extraerJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a < 0 || b <= a) throw new Error('la respuesta no trae JSON')
    return JSON.parse(t.slice(a, b + 1))
  }
}

/** Keeps only well-formed actions; a malformed one becomes "desconocido" so it is visible. */
export function validarAcciones(raw: unknown): AccionLlm[] {
  const lista = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { acciones?: unknown })?.acciones)
      ? ((raw as { acciones: unknown[] }).acciones)
      : null
  if (!lista) throw new Error('JSON sin "acciones"')

  const out: AccionLlm[] = []
  for (const item of lista) {
    const a = (item ?? {}) as Record<string, unknown>
    const tipo = str(a.tipo)?.toLowerCase() as TipoAccionLlm | undefined
    const ref = str(a.ref) ?? (typeof a.ref === 'number' ? `#${a.ref}` : undefined)
    const texto = str(a.texto) ?? str(a.titulo) ?? ''
    if (!tipo || !TIPOS.includes(tipo)) {
      out.push({ tipo: 'desconocido', texto: texto || JSON.stringify(a) })
      continue
    }
    switch (tipo) {
      case 'completar':
        if (ref) out.push({ tipo, ref })
        break
      case 'cancelar':
        if (ref) out.push({ tipo, ref, motivo: limpiarMotivo(a.motivo) })
        break
      case 'borrar':
        if (ref) out.push({ tipo, ref })
        break
      case 'posponer': {
        const f = fecha(a.fecha)
        if (ref && f) out.push({ tipo, ref, fecha: f })
        else if (ref) out.push({ tipo: 'cambiar', ref, fecha: f })
        break
      }
      case 'renombrar': {
        const titulo = str(a.titulo) ?? str(a.texto)
        if (ref && titulo) out.push({ tipo, ref, titulo })
        break
      }
      case 'cambiar':
        if (ref) out.push({ tipo, ref, prioridad: prioridad(a.prioridad), empresa: str(a.empresa), fecha: fecha(a.fecha), hora: hora(a.hora), calendar: a.calendar === true || undefined })
        break
      case 'crear': {
        const titulo = str(a.titulo) ?? str(a.texto)
        // Fase 4d: a "note" never becomes a task, whatever the model said.
        const nota = titulo ? comoNotaEmpresa(titulo, str(a.empresa)) : null
        if (nota) {
          out.push(nota)
          break
        }
        if (titulo) {
          const p = prioridad(a.prioridad)
          // The classic extractors run over the title the model returned: if it
          // left "para el viernes" or "3pm" inside, they come out here.
          const c = extraerCalendar(titulo)
          const h = extraerHora(c.text)
          const f = extraerFecha(h.text, cancunYmd())
          const text = f.text.replace(/\s{2,}/g, ' ').replace(/^[\s:,.\-–]+|[\s:,.\-–]+$/g, '').trim() || titulo
          const due = fecha(a.fecha) ?? f.due_date ?? undefined
          out.push({ tipo, titulo: text, empresa: str(a.empresa), prioridad: p, fecha: due, hora: due ? hora(a.hora) ?? h.due_time ?? undefined : undefined, importante: a.importante === true || p === 'urgente', calendar: a.calendar === true || c.calendar })
        }
        break
      }
      case 'que_sigue':
        out.push({ tipo, empresa: str(a.empresa), solo_urgentes: a.solo_urgentes === true, solo_vencer: a.solo_vencer === true })
        break
      case 'lista': {
        const l = str(a.lista)?.toLowerCase()
        const empresa = str(a.empresa)
        out.push({ tipo, lista: l === 'tarde' ? 'tarde' : l === 'pendientes' || empresa ? 'pendientes' : 'manana', empresa })
        break
      }
      case 'calendar':
        if (ref) out.push({ tipo, ref, hora: hora(a.hora), todo_el_dia: a.todo_el_dia === true })
        break
      case 'pagos_listar':
        out.push({ tipo, empresa: str(a.empresa), semana: a.semana === true })
        break
      case 'dividir':
        if (ref) out.push({ tipo, ref })
        break
      case 'siguiente_paso':
        out.push({ tipo, ref })
        break
      case 'nota_empresa': {
        const empresa = str(a.empresa)
        const t = str(a.texto)
        if (empresa && t) out.push({ tipo, empresa, texto: t, modo: str(a.modo)?.toLowerCase() === 'agregar' ? 'agregar' : 'reemplazar' })
        break
      }
      case 'nota_tarea': {
        const t = str(a.texto)
        if (ref && t) out.push({ tipo, ref, texto: t })
        break
      }
      case 'alarma': {
        const t = str(a.texto)
        const min = typeof a.en_minutos === 'number' && a.en_minutos > 0 ? Math.round(a.en_minutos) : undefined
        if (t) out.push({ tipo, texto: t, fecha: fecha(a.fecha), hora: hora(a.hora), en_minutos: min })
        break
      }
      case 'pregunta':
      case 'desconocido':
        out.push({ tipo, texto: texto || '…' })
        break
    }
  }
  return out
}

// ── Call + log ───────────────────────────────────────────────────────────

export interface Interpretacion {
  acciones: AccionLlm[]
  contexto: ContextoInterprete
  modelo: string
  tokensIn: number
  tokensOut: number
  ms: number
}

/**
 * Message → actions. Returns null when the model fails (timeout, key, bad
 * JSON): the caller then falls back to the classic parser. `pista` is the
 * hint from the [Tarea] [Orden] [Alarma] buttons when the first try was
 * "desconocido".
 */
export async function interpretar(
  chatId: number,
  mensaje: string,
  companies: { id: string; name: string }[],
  pista?: string
): Promise<Interpretacion | null> {
  const t0 = Date.now()
  let modelo = 'interprete:desconocido'
  try {
    const cfg = llmConfig()
    modelo = `interprete:${cfg.provider}:${cfg.model}`
    const [contexto, persona] = await Promise.all([construirContextoInterprete(chatId, companies), cargarConfig()])
    const user = `CONTEXTO:\n${contexto.text}\n\n${pista ? `PISTA: ${pista}\n\n` : ''}MENSAJE: ${mensaje}`
    const r = await preguntarLlm(systemPrompt(cancunYmd(), persona), user, { maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS, json: true })
    const acciones = validarAcciones(extraerJson(r.text))
    console.log(`[interprete] ok · ${modelo} · ${acciones.length} acciones · in ${r.tokensIn} · out ${r.tokensOut} · ${r.ms} ms`)
    return { acciones, contexto, modelo, tokensIn: r.tokensIn, tokensOut: r.tokensOut, ms: r.ms }
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err)
    const ms = Date.now() - t0
    console.error(`[interprete] error · ${modelo} · ${ms} ms · ${motivo}`)
    await registrarInterpretacion({ chat_id: chatId, pregunta: mensaje, respuesta: `ERROR: ${motivo}`, modelo, tokens_in: 0, tokens_out: 0, ms })
    return null
  }
}

export async function registrarInterpretacion(row: {
  chat_id: number
  pregunta: string
  respuesta: string
  modelo: string
  tokens_in: number
  tokens_out: number
  ms: number
}): Promise<void> {
  const { error } = await createServerClient().from('bot_preguntas').insert(row)
  if (error) console.error(`[interprete] bot_preguntas insert: ${error.message}`)
}

/** Title search over the open tasks already loaded (accents and case out). */
export function buscarEnAbiertas(abiertas: TareaLite[], termino: string): TareaLite[] {
  const needle = normalizar(termino)
  if (!needle) return []
  return abiertas.filter((t) => normalizar(t.text).includes(needle))
}
