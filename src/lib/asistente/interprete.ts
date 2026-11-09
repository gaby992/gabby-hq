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
import { correosRecientes, quienCorto, type CorreoLite } from '@/lib/correo/pendientes'
import type { CorreoAccion, CorreoTipo, CorreoUrgencia, NivelRemitente } from '@/types'
import { esNivel } from '@/lib/correo/niveles'
import { mensajeError } from '@/lib/errores'
import type { DiaSemana, Repeticion } from '@/lib/google/calendar'

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
  /**
   * Fase 12b: a free Calendar event — not a task — once or repeating:
   * "ponme en el calendario Love on Hire los jueves a las 2 pm hasta el 1 de diciembre, nota GL".
   */
  | { tipo: 'evento'; titulo: string; fecha: string; hora?: string; duracion_min?: number; nota?: string; repetir?: Repeticion }
  | { tipo: 'pagos_listar'; empresa?: string; semana?: boolean }
  | { tipo: 'dividir'; ref: string }
  | { tipo: 'siguiente_paso'; ref?: string }
  | { tipo: 'nota_empresa'; empresa: string; texto: string; modo: NotaModoLlm }
  | { tipo: 'nota_tarea'; ref: string; texto: string }
  /**
   * Fase 15: con fecha/hora va a Google Calendar (y puede repetirse: "los días
   * 10 de cada mes"); con en_minutos es un temporizador que avisa por Telegram.
   */
  | { tipo: 'alarma'; texto: string; fecha?: string; hora?: string; en_minutos?: number; repetir?: Repeticion }
  | { tipo: 'pregunta'; texto: string }
  | { tipo: 'que_sigue'; empresa?: string; solo_urgentes?: boolean; solo_vencer?: boolean }
  | { tipo: 'lista'; lista: 'manana' | 'tarde' | 'pendientes'; empresa?: string }
  /**
   * Fase 6: a decision on mail — one ("el correo de Andrew lo hago yo") or a set ("archiva los de marketing de hoy").
   * Ajuste 6c: `nivel` learns the sender ("el 5 es silencio"); with `accion` too ("archiva el 5 y márcalo como silencio").
   */
  | { tipo: 'correo'; accion?: CorreoAccion; nivel?: NivelRemitente; ref?: string; filtro?: FiltroCorreo }
  /** Fase 9: "la de TOTT está esperando a Andrew" (quien) · "la de TOTT ya no espera" (fin). */
  | { tipo: 'esperar'; ref: string; quien?: string; fin?: boolean }
  /** Fase 9: "qué tengo esperando" → the ⏳ list. */
  | { tipo: 'esperando' }
  /** Fase 9c-B: "mándame el tablero" → the board as a picture. */
  | { tipo: 'tablero' }
  /** Ajuste 9c-1: any way of asking to SEE mail ("lo más importante del buzón de PD") → the narrated mail list. `cuenta` = the MAILBOX, never a company. */
  | { tipo: 'correos_lista'; cuenta?: string; importante?: boolean }
  /** Fase 9c-D: "deja X para después" / "quítale la fecha" → 📦 Después (no date). */
  | { tipo: 'despues'; ref: string }
  /**
   * Fase 14 (segundo cerebro): preguntar al archivero ("¿con quién tengo el
   * seguro del carro?", "mándame el contrato de Bonampak", "¿cuánto pago de alquiler?").
   */
  | { tipo: 'documentos'; texto: string }
  /** Fase 14: guardar un dato suelto, sin archivo ("el seguro del carro es con GNP, se paga en marzo"). */
  | { tipo: 'documento_nota'; texto: string }
  | { tipo: 'desconocido'; texto: string }

export interface FiltroCorreo {
  tipo?: CorreoTipo
  urgencia?: CorreoUrgencia
  /** Only today's. */
  hoy?: boolean
  /** A sender name/domain fragment. */
  de?: string
}

export type TipoAccionLlm = AccionLlm['tipo']

const TIPOS: TipoAccionLlm[] = [
  'completar', 'cancelar', 'borrar', 'posponer', 'renombrar', 'cambiar', 'crear',
  'nota_empresa', 'nota_tarea', 'alarma', 'pregunta', 'que_sigue', 'lista', 'calendar',
  'pagos_listar', 'dividir', 'siguiente_paso', 'correo', 'esperar', 'esperando', 'tablero', 'despues', 'correos_lista', 'evento',
  'documentos', 'documento_nota', 'desconocido',
]

const ACCIONES_CORREO: CorreoAccion[] = ['chelsea', 'yo', 'tarea', 'archivar']
const TIPOS_CORREO: CorreoTipo[] = ['necesita_respuesta', 'pedido_de_tarea', 'fyi', 'notificacion', 'marketing', 'reunion', 'pago']

/** A task as the interpreter and the plan see it: no notes. */
export type TareaLite = Pick<TaskRow, 'id' | 'text' | 'due_date' | 'due_time' | 'priority' | 'importante' | 'estado' | 'esperando_a' | 'company'>

export interface ContextoInterprete {
  text: string
  /** "#3" / "t12" → task, for the resolver. */
  porRef: Map<string, TareaLite>
  abiertas: TareaLite[]
  anterior: TareaLite | null
  /** Fase 6: recent mail ("c1"… and the "#n" of the 📧 section of the last list). */
  correos: CorreoLite[]
  porRefCorreo: Map<string, CorreoLite>
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
  // Fase 9: a waiting task says so before its date — the model must not treat it as overdue work.
  const espera = t.estado === 'esperando' ? `⏳ esperando${t.esperando_a ? ` a ${t.esperando_a}` : ''} · ` : ''
  if (!t.due_date) return `${espera}sin fecha`
  const hora = t.due_time ? ` ${t.due_time.slice(0, 5)}` : ''
  if (t.due_date < today) return `${espera}vencida (${t.due_date}${hora})`
  if (t.due_date === today) return `${espera}vence hoy${hora}`
  return `${espera}vence ${t.due_date}${hora}`
}

export async function construirContextoInterprete(
  chatId: number,
  companies: { id: string; name: string }[],
  now: Date = new Date()
): Promise<ContextoInterprete> {
  const today = cancunYmd(now)
  const db = createServerClient()
  const [openRes, alarma, anteriorLog, turnos, recientes, correos] = await Promise.all([
    db.from('tasks').select(COLS_SIN_NOTAS).eq('done', false).order('created_at', { ascending: false }),
    ultimaAlarma(),
    ultimaMencionada(chatId),
    historial(chatId, now),
    tareasRecientes(chatId),
    correosRecientes({ estados: ['nuevo', 'para_chelsea', 'lo_hago_yo', 'tarea'], dias: 7, max: 40 }),
  ])
  const correoById = new Map(correos.map((c) => [c.id, c]))
  const porRefCorreo = new Map<string, CorreoLite>()
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
    const que = alarma.tipo === 'manana' ? 'alarma 8:00 am'
      : alarma.tipo === 'tarde' ? 'alarma 6:00 pm (cierre del día)'
      : alarma.tipo === 'lista' ? 'lista pedida a mano'
      : alarma.tipo === 'correos' ? 'lista de CORREOS: todos sus números son correos, nunca tareas'
      : 'respuesta a "¿qué sigue?" (1 = "el primero", 2 = "el segundo"…)'
    lines.push(`ÚLTIMA LISTA NUMERADA (${que}, ${alarma.enviada_en.slice(0, 16).replace('T', ' ')} UTC) — sus números:`)
    for (const it of alarma.items) {
      if (it.correo_id) {
        const c = correoById.get(it.correo_id)
        if (c) {
          porRefCorreo.set(`#${it.n}`, c)
          lines.push(`[#${it.n}] 📧 correo de ${quienCorto(c)} · «${c.asunto ?? '(sin asunto)'}» · ${c.estado}`)
        } else lines.push(`[#${it.n}] (correo ya decidido)`)
        continue
      }
      const t = it.task_id ? byId.get(it.task_id) : undefined
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

  // Fase 6: the mail a decision can be about.
  if (correos.length > 0) {
    lines.push(`CORREOS RECIENTES (${correos.length}; "lo hago yo", "para Chelsea", "tarea", "archivar" se deciden con "correo"):`)
    correos.forEach((c, i) => {
      const ref = `c${i + 1}`
      porRefCorreo.set(ref, c)
      const fecha = c.recibido_en ? cancunYmd(new Date(c.recibido_en)) : ''
      lines.push(`[${ref}] de ${quienCorto(c)} <${c.de_email ?? ''}> · «${c.asunto ?? '(sin asunto)'}» · ${c.urgencia ?? '?'} · ${c.tipo ?? '?'} · ${c.estado}${fecha === today ? ' · hoy' : fecha ? ` · ${fecha}` : ''}`)
    })
    lines.push('')
  }

  lines.push(`EMPRESAS: ${companies.map((c) => c.name.trim()).join(', ')}`)
  lines.push(`HOY: ${today} (${formatDiaLargoEs(today)}) · hora actual ${cancunHm(now)} (Cancún) · mañana = ${addDays(today, 1)}`)

  // Fase 7: the recent thread, with each mentioned task's current ref.
  const refPorId = new Map(Array.from(porRef.entries()).map(([ref, t]) => [t.id, ref]))
  const hilo = renderHistorial(turnos, (id) => (refPorId.has(id) ? `[${refPorId.get(id)}]` : null))
  if (hilo) lines.push('', hilo)

  return { text: lines.join('\n'), porRef, abiertas, anterior, correos, porRefCorreo }
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
    '- {"tipo":"calendar","ref":REF,("hora":"HH:MM"),("todo_el_dia":true)}  → "pon en calendar la de TOTT", "agrega al calendario el 3", "la anterior al calendar": crear el evento de una tarea que YA EXISTE en la lista (ref obligatorio)',
    '- {"tipo":"evento","titulo":"…","fecha":"YYYY-MM-DD",("hora":"HH:MM"),("duracion_min":60),("nota":"…"),("repetir":{"cada":"dia|semana|mes",("dias":["LU","MA","MI","JU","VI","SA","DO"]),("hasta":"YYYY-MM-DD"),("veces":8)})}  → ' +
      'un EVENTO en Google Calendar que NO es una tarea de la lista: "ponme en el calendario X el jueves a las 2", "agrega a google calendar una alarma/evento para X", "evento los viernes a las 2 pm hasta el 1 de diciembre", ' +
      '"ocho sábados a las 2 pm" (repetir cada semana, dias ["SA"], veces 8), "todos los viernes hasta que te avise" (repetir cada semana, dias ["VI"], sin hasta ni veces), ' +
      '"desde el jueves 12 hasta dic 1" (fecha = ese jueves, repetir cada semana dias ["JU"] hasta 2026-12-01). "nota: GL" / "nota GL" → nota. ' +
      'Cada título distinto es SU PROPIA acción evento. Si la frase habla de "google calendar", "calendario" o "evento" y da un título nuevo, es evento, NUNCA crear ni calendar sobre una tarea existente, y NUNCA busques una tarea parecida',
    '- {"tipo":"pagos_listar",("empresa":"…"),("semana":true)}  → "pagos de IM", "qué pagos tengo", "qué pagos hay esta semana" (semana:true). ' +
      'Los pagos recurrentes solo se CONSULTAN por aquí; crearlos, cambiarlos o quitarlos se hace en la web (Settings): si lo pide, responde "desconocido" con texto "los pagos se administran en Settings → Pagos recurrentes"',
    '- {"tipo":"nota_empresa","empresa":"…","texto":"…","modo":"reemplazar|agregar"}  → "nota de IM: …", "apunta en PD que …" (agregar si dice agrega/suma/además)',
    '- {"tipo":"nota_tarea","ref":REF,"texto":"…"}  → un comentario sobre una tarea existente',
    '- {"tipo":"alarma","texto":"…",("fecha":"YYYY-MM-DD"),("hora":"HH:MM"),("repetir":{"cada":"dia|semana|mes",("dias":["LU",…]),("hasta":"YYYY-MM-DD"),("veces":8)})}  → alarma, recuérdame, avísame, ponme un recordatorio. ' +
      'Para "en 2 horas"/"en 30 minutos" usa "en_minutos":120 en vez de fecha/hora. Si no dijo hora, NO inventes una: omite "hora". ' +
      'texto = qué recordar, sin la fecha ni la hora. Una alarma NO es una tarea (salvo que diga "y agrégala como tarea": entonces también crear). ' +
      'ALARMAS QUE SE REPITEN: "cada mes", "mensual", "todos los meses", "los días 10 de cada mes" → "repetir":{"cada":"mes"} y fecha = el PRÓXIMO día con ese número (hoy incluido si la hora no ha pasado). ' +
      '"los días 10 y 20 de cada mes" son DOS acciones alarma, una por día, cada una con su fecha y repetir cada mes; "igual a las 10" / "también a las 10" = la misma hora. ' +
      '"todos los lunes a las 9" → repetir cada semana con dias ["LU"]; "todos los días a las 7" → repetir cada día. Si no dice que se repite, NO pongas repetir. ' +
      'NUNCA metas "(día 10)" ni la frecuencia en el texto: el texto es solo qué recordar ("pago Health Insurance PD")',
    '- {"tipo":"pregunta","texto":"…"}  → pregunta sobre sus tareas (qué tengo hoy, qué cerré ayer, cómo voy con IM)',
    '- {"tipo":"que_sigue",("empresa":"…"),("solo_urgentes":true),("solo_vencer":true)}  → "qué sigue", "qué hago primero", "qué es lo más urgente", "por dónde empiezo". ' +
      '"solo urgentes" → solo_urgentes; "qué vence / qué está por vencer esta semana" → solo_vencer; "qué sigue de IM" → empresa',
    '- {"tipo":"lista","lista":"manana|tarde|pendientes",("empresa":"…")}  → la LISTA COMPLETA numerada: "dame la lista", "la lista de la mañana", "lista completa", "todo lo pendiente", "mándame el /hoy" → manana; ' +
      '"cierre", "lista de la tarde", "el cierre del día" → tarde; "todo lo pendiente de IM", "qué tengo pendiente en PD", "pendientes de IM" → pendientes + empresa. ' +
      'Esto NO es que_sigue (que_sigue es corto y ordenado; lista es todo)',
    '- {"tipo":"dividir","ref":REF}  → "me da flojera X", "no sé por dónde empezar con X", "divide X", "paso a paso X": partir una tarea en pasos',
    '- {"tipo":"siguiente_paso",("ref":REF)}  → "siguiente paso", "el que sigue" (sin ref = la última tarea dividida)',
    '- {"tipo":"correo",("accion":"chelsea|yo|tarea|archivar"),("nivel":"silencio|solo_app|alerta"),("ref":"c3"|"#15"|"texto del remitente o asunto"),("filtro":{("tipo":"marketing|notificacion|fyi|necesita_respuesta|pedido_de_tarea|reunion|pago"),("urgencia":"alta|media|baja"),("hoy":true),("de":"…")})}  → ' +
      'decisiones sobre CORREOS (los de CORREOS RECIENTES o los "📧" numerados de la última lista): "el correo de Andrew lo hago yo" → accion yo, ref "Andrew"; "el 15 para Chelsea" → accion chelsea, ref "#15"; ' +
      '"archiva los de marketing de hoy" → accion archivar, filtro {tipo:"marketing", hoy:true}; "el de TOTT es tarea" → accion tarea. "lo hago yo"/"yo lo contesto" = yo; "pásaselo a Chelsea" = chelsea; "archívalo"/"bórralo" sobre un correo = archivar (un correo nunca se borra). ' +
      'Un número de la última lista que es "📧 correo" NUNCA es completar/posponer: es "correo". ' +
      'NIVEL = aprender el remitente para siempre (va con accion o solo): "el 5 es silencio"/"silencia a zoom"/"ese remitente es ruido" → nivel silencio; "el 5 es solo app"/"que no me avise, solo en la app" → nivel solo_app; "el 5 es alerta"/"ese remitente es VIP"/"avísame siempre de TOTT" → nivel alerta; ' +
      '"archiva el 5 y márcalo como silencio" → accion archivar + nivel silencio. Va al menos accion o nivel.',
    '- {"tipo":"esperar","ref":REF,("quien":"…"),("fin":true)}  → "la de TOTT está esperando a Andrew", "esa está en manos del cliente", "la 3 espera respuesta de Juan": la tarea queda en ⏳ Esperando (quien = de quién, corto, sin "a"). ' +
      '"la de TOTT ya no espera", "ya respondió Andrew, retomo la de TOTT", "la 2 vuelve a mí" → fin:true (vuelve a estar en sus manos). NO es completar ni posponer',
    '- {"tipo":"esperando"}  → "qué tengo esperando", "qué está en manos de otros", "qué espero de alguien", "lista de esperando": la lista ⏳',
    '- {"tipo":"tablero"}  → "mándame el tablero", "foto del tablero", "cómo se ve el tablero", "quiero ver el tablero": la imagen del tablero',
    '- {"tipo":"correos_lista",("cuenta":"…"),("importante":true)}  → cualquier forma de pedir VER correos: "mándame los correos de Chelsea", "qué llegó al buzón de PD", "lo más importante del correo de IM", "qué necesita respuesta en mi correo". ' +
      'OJO: ahí "Chelsea"/"PD"/"IM" es el BUZÓN (una cuenta de correo), NUNCA la empresa ni sus tareas; cuenta = ese nombre tal cual lo dijo. "lo más importante" / "urgentes" / "qué necesita respuesta" → importante:true. Esto NUNCA es "lista" (lista es de TAREAS)',
    '- {"tipo":"despues","ref":REF}  → "deja X para después", "X para después", "quítale la fecha a X", "pásala a Después", "esa no corre": la tarea queda sin fecha en 📦 Después. NO es cancelar ni posponer a un día',
    '- {"tipo":"documentos","texto":"…"}  → preguntas sobre sus PAPELES guardados (el archivero / segundo cerebro, que ella llama "Gabita": "Gabita, ¿…?" es siempre esto o documento_nota): ' +
      '"¿con quién tengo el seguro del carro?", "¿cuánto pago de alquiler?", "¿cuándo vence mi pasaporte?", "mándame el contrato de Bonampak", "¿qué dice la póliza de la cobertura?", ' +
      '"busca el recibo de la CFE de octubre", "¿tengo guardado el contrato de DATAVIA?", "qué documentos tengo de seguros". texto = la pregunta tal cual. ' +
      'OJO: esto es sobre CONTRATOS, PÓLIZAS, FACTURAS, RECIBOS, IDENTIFICACIONES y datos archivados, NUNCA sobre tareas (eso es "pregunta") ni correos (eso es "correos_lista")',
    '- {"tipo":"documento_nota","texto":"…"}  → guardar un DATO para siempre en el archivero, sin archivo: ' +
      '"el seguro del carro es con GNP y se paga en marzo", "guarda que la renta se paga el día 5", "apunta en el cerebro: el contador se llama Luis, tel 998…", "archiva este dato: …". ' +
      'texto = el dato completo tal cual lo dijo. Esto NO es una tarea ni una nota de empresa: es información que querrá consultar después',
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
      'REGLA ESTRICTA: en un plan por días SOLO se crean o mueven las tareas que el mensaje NOMBRA. Las demás tareas abiertas NO se tocan aunque tengan fecha de esos días o estén vencidas: ' +
      'que diga "mañana" no significa mover nada a mañana. Solo si pide explícitamente "acomoda el resto" / "reacomoda lo demás" puedes proponer posponer las no nombradas. ' +
      'Un verbo dentro de la frase ("cancelar Jobescape") que describe la TAREA a hacer ese día sigue siendo crear ("Cancelar Jobescape"), salvo que esa tarea ya exista en la lista.',
    'CORRECCIÓN DE UN PLAN: si tu último turno fue un plan que espera su OK ("Así queda tu semana:" / "Entendí:") y ella corrige algo ' +
      '("la de marketing a las 10", "lo de WSH mejor el viernes", "la de Chelsea es de IM"), devuelve SOLO la acción corregida: "cambiar"/"posponer" con el ref de esa tarea si existe, ' +
      'o "crear" con el MISMO título del plan y solo el campo nuevo si era tarea nueva. No repitas las demás líneas ni las alarmas del plan. ' +
      'NUNCA devuelvas "borrar", "cancelar" ni "completar" por "quita X", "esa no", "déjala", "sin X": eso solo saca la línea del plan.',
    'PLAN MAL ENTENDIDO: si tu último turno fue un plan y ella dice que entendiste mal ("no hablé de X", "eso no era", "no, me refería a…") y vuelve a decir lo que quiere, ' +
      'devuelve SOLO las acciones de lo que dice AHORA, completas, como si fuera un mensaje nuevo (el plan anterior se descarta solo). No mezcles nada del plan anterior.',
    'PREGUNTAS SOBRE TI: "¿cómo que está sin autorización?", "explícame", "¿por qué falló?", "¿qué quisiste decir?", "¿y eso?" tras un aviso ⚠️ tuyo → "pregunta" con el texto tal cual (NO "desconocido"): ella pregunta por algo que TÚ dijiste.',
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

const DIAS_SEMANA: DiaSemana[] = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']
const DIA_POR_NOMBRE: Record<string, DiaSemana> = {
  lunes: 'LU', lu: 'LU', mo: 'LU', monday: 'LU',
  martes: 'MA', ma: 'MA', tu: 'MA', tuesday: 'MA',
  miercoles: 'MI', mi: 'MI', we: 'MI', wednesday: 'MI',
  jueves: 'JU', ju: 'JU', th: 'JU', thursday: 'JU',
  viernes: 'VI', vi: 'VI', fr: 'VI', friday: 'VI',
  sabado: 'SA', sabados: 'SA', sa: 'SA', saturday: 'SA',
  domingo: 'DO', domingos: 'DO', do: 'DO', su: 'DO', sunday: 'DO',
}

/** Fase 12b: the model's "repetir" → a clean Repeticion (or undefined when it is not one). */
export function repeticion(v: unknown): Repeticion | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as Record<string, unknown>
  const cadaRaw = str(r.cada)?.toLowerCase() ?? ''
  const cada: Repeticion['cada'] | null = /^d[ií]a|daily/.test(cadaRaw) ? 'dia' : /^sem|week/.test(cadaRaw) ? 'semana' : /^mes|month/.test(cadaRaw) ? 'mes' : null
  if (!cada) return undefined
  const dias = Array.isArray(r.dias)
    ? (r.dias.map((d) => DIA_POR_NOMBRE[normalizar(String(d)).replace(/[^a-z]/g, '')]).filter((d): d is DiaSemana => !!d && DIAS_SEMANA.includes(d)))
    : []
  const hasta = fecha(r.hasta)
  const veces = typeof r.veces === 'number' && r.veces > 0 ? Math.min(Math.round(r.veces), 400) : undefined
  return { cada, dias: dias.length > 0 ? Array.from(new Set(dias)) : undefined, hasta: veces ? undefined : hasta, veces }
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
      case 'evento': {
        const titulo = str(a.titulo) ?? str(a.texto)
        const f = fecha(a.fecha)
        if (!titulo || !f) {
          out.push({ tipo: 'desconocido', texto: titulo ? `evento «${titulo}»: no sé qué día` : 'evento sin título' })
          break
        }
        const rep = repeticion(a.repetir)
        const dur = typeof a.duracion_min === 'number' && a.duracion_min >= 5 && a.duracion_min <= 1440 ? Math.round(a.duracion_min) : undefined
        out.push({ tipo, titulo, fecha: f, hora: hora(a.hora), duracion_min: dur, nota: str(a.nota), repetir: rep })
        break
      }
      case 'pagos_listar':
        out.push({ tipo, empresa: str(a.empresa), semana: a.semana === true })
        break
      case 'dividir':
        if (ref) out.push({ tipo, ref })
        break
      case 'siguiente_paso':
        out.push({ tipo, ref })
        break
      case 'correo': {
        const accion = str(a.accion)?.toLowerCase() as CorreoAccion
        const f = (a.filtro ?? {}) as Record<string, unknown>
        const tipoF = str(f.tipo)?.toLowerCase() as CorreoTipo | undefined
        const urg = str(f.urgencia)?.toLowerCase() as CorreoUrgencia | undefined
        const filtro: FiltroCorreo = {
          tipo: tipoF && TIPOS_CORREO.includes(tipoF) ? tipoF : undefined,
          urgencia: urg && ['alta', 'media', 'baja'].includes(urg) ? urg : undefined,
          hoy: f.hoy === true || undefined,
          de: str(f.de),
        }
        const hayFiltro = Object.values(filtro).some((v) => v !== undefined)
        const nivelRaw = str(a.nivel)?.toLowerCase().replace(/[\s-]+/g, '_')
        const nivel = esNivel(nivelRaw) ? nivelRaw : undefined
        const accionOk = ACCIONES_CORREO.includes(accion) ? accion : undefined
        if ((accionOk || nivel) && (ref || hayFiltro)) out.push({ tipo, accion: accionOk, nivel, ref, filtro: hayFiltro ? filtro : undefined })
        else out.push({ tipo: 'desconocido', texto: texto || 'correo: no sé cuál' })
        break
      }
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
        // Fase 15: un temporizador ("en 20 minutos") no se repite; una alarma con fecha sí puede.
        if (t) out.push({ tipo, texto: t, fecha: fecha(a.fecha), hora: hora(a.hora), en_minutos: min, repetir: min ? undefined : repeticion(a.repetir) })
        break
      }
      case 'esperar': {
        const quien = str(a.quien)?.replace(/^(?:a|de)\s+/i, '')
        if (ref) out.push({ tipo, ref, quien: a.fin === true ? undefined : quien, fin: a.fin === true || undefined })
        break
      }
      case 'esperando':
      case 'tablero':
        out.push({ tipo })
        break
      case 'correos_lista':
        out.push({ tipo, cuenta: str(a.cuenta), importante: a.importante === true || undefined })
        break
      case 'despues':
        if (ref) out.push({ tipo, ref })
        break
      case 'documentos':
      case 'documento_nota':
        // Fase 14: sin texto no hay ni pregunta ni dato que archivar.
        if (texto) out.push({ tipo, texto })
        else out.push({ tipo: 'desconocido', texto: 'no entendí qué buscar en el archivero' })
        break
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
    const motivo = mensajeError(err)
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
