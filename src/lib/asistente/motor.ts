// Fase 9c: the bot's engine, out of the webhook file so the 💬 chat in /hoy
// (POST /api/asistente/chat) runs EXACTLY the same code: parser →
// interpreter → plan → drafts → buttons. Where the replies go is decided by
// the channel the request was wrapped in (canal.ts), not here.
//
// Telegram → /api/telegram → handleText / handleVoice / handleCallback.
// Web      → /api/asistente/chat → handleText / procesarBoton.

import { conectarCanalChelsea } from '@/lib/asistente/telegram'
import { enviarResumenChelsea } from '@/lib/asistente/canal-chelsea'
import { createServerClient } from '@/lib/supabase-server'
import {
  TelegramError,
  answerCallbackQuery,
  downloadTelegramFile,
  editMessageText,
  inlineKeyboard,
  isAllowedChat,
  removeInlineKeyboard,
  sendTelegram,
} from '@/lib/asistente/telegram'
import { pedirMenu } from '@/lib/asistente/canal'
import { quitarTeclado, tecladoMenu } from '@/lib/asistente/menu'
import { enviarTablero } from '@/lib/asistente/tablero-imagen'
import { responderNarrada, type Narrada } from '@/lib/asistente/narracion'
import { guardarAlarma } from '@/lib/asistente/registro-listas'
import { historial } from '@/lib/asistente/conversacion'
import { botonesElegir, conIds, ejecutarAccion, manejarAccion, manejarPorTitulo, type AccionParams, type Respuesta } from '@/lib/asistente/acciones'
import { interpretar, registrarInterpretacion, type Interpretacion } from '@/lib/asistente/interprete'
import {
  ejecutarPlan,
  ejecutarUna,
  esPlanSemana,
  necesitaConfirmacion,
  sinNadaQueHacer,
  renderPlan,
  renderPlanSemana,
  resolverAcciones,
  resumenParaLog,
  soloLasNombradas,
  sugerenciaPlanSemana,
  tareaParsedDe,
  type AccionResuelta,
} from '@/lib/asistente/plan'
import { dividirTarea, siguientePaso } from '@/lib/asistente/pasos'
import { aplicarCorreccion, fusionarCorreccion, leerCorreccion, renderCorreccion, type Resultado } from '@/lib/asistente/correcciones'
import { accionDeBoton } from '@/lib/correo/alertas'
import { decidirCorreo } from '@/lib/correo/decisiones'
import { cuentasPorTexto, enviarListaCorreos } from '@/lib/correo/listas'
import { leerRelectura, type Relectura } from '@/lib/asistente/relectura'
import type { CuentaCorreo } from '@/types'
import { cargarCuentas, cuentaPorId } from '@/lib/correo/cuentas'
import { ultimaAlarma } from '@/lib/asistente/registro-listas'
import { mensajeError, motivoParaUsuario } from '@/lib/errores'
import { tareasRecientes } from '@/lib/asistente/conversacion'
import {
  HORAS_BOTONES,
  instanteDe,
  listarRecordatorios,
  quitarRecordatorio,
  responderRecordatorio,
  type RespuestaRecordatorio,
} from '@/lib/asistente/recordatorios'
import { ejecutarNota, USO_NOTA } from '@/lib/asistente/notas-bot'
import { llmConfig } from '@/lib/asistente/llm'
import { ayuda, esOrdenDeAlarmas, faltantes, lineasConOrdenDeAlarmas, parseMensaje, pideRecordatorioDelDia, prioridadDicha, type Parsed, type TareaParsed } from '@/lib/parser'
import { cancunYmd, formatHoraEs, formatVenceEs } from '@/lib/asistente/cancun'
import { MAX_AUDIO_SECONDS, transcribirAudio } from '@/lib/asistente/whisper'
import {
  actualizarBorrador,
  borradorVigente,
  borrarBorrador,
  crearBorrador,
  nonceDe,
  type BorradorParsed,
} from '@/lib/asistente/borradores'
import { cargarEmpresas, confirmacion, guardarTarea, pregunta } from '@/lib/asistente/tareas'
import {
  TELEGRAM_MAX_BYTES,
  avisoDemasiadoGrande,
  borradorDocPorId,
  borradorDocVigente,
  corregir as corregirFicha,
  COMO_CORREGIR_DOC,
  guardar as guardarFicha,
  leerNotaCerebro,
  recibirArchivo,
  recibirNota,
  separarPaginas,
  unirPaginas,
  actualizarBorradorDoc,
  type Salida as SalidaDoc,
} from '@/lib/documentos/entrada'
import { documentoPorId } from '@/lib/documentos/ficha'
import { tituloRenovar } from '@/lib/documentos/vencimientos'
import { buscarDocumentos, pareceDeDocumentos, responderDeDocumentos } from '@/lib/documentos/buscar'
import { htmlSeguro, sinHtml } from '@/lib/asistente/html'
import { crearAviso, textoMudanza } from '@/lib/asistente/avisos'
import { probarModeloConversacion, responderConversacion } from '@/lib/asistente/conversar'
import { responderPregunta } from '@/lib/asistente/pregunta'
import { enviarQueSigue } from '@/lib/asistente/que-sigue'
import { enviarLista } from '@/lib/asistente/alarmas'
import { corregirFechas } from '@/lib/asistente/fechas-dichas'
import { enviarListaEsperando } from '@/lib/asistente/esperando'
import { guiaTelegram } from '@/lib/asistente/comandos'
import { cargarConfig, presentacion, type AsistenteConfig } from '@/lib/asistente/config'
import { guardarTurno, limpiarHilo, turnosRecientes } from '@/lib/asistente/conversacion'
import { botonesDe, resolverSugerencia, trasCompletar, trasCrear, trasPregunta, trasOrganizar, type Sugerencia } from '@/lib/asistente/sugerencias'
import { iniciarOrganizar, responderOrganizar, resumen as resumenOrganizar, tecladoOrganizar, type RespuestaOrganizar } from '@/lib/asistente/organizar'
import { agregarACalendar, type ResultadoSync } from '@/lib/google/sync'
import { buscarEnAbiertas } from '@/lib/asistente/interprete'
import { textoListaPagos } from '@/lib/asistente/pagos'
import { createServerClient as dbCliente } from '@/lib/supabase-server'
import { COLS_SIN_NOTAS, type TaskRow } from '@/lib/asistente/acciones'
import type { Priority } from '@/types'

// Text, voice notes and inline-button taps all end up in the same place:
// parseMensaje() for the exact commands; everything else (fase 4) goes
// through the LLM interpreter → plan → execute, falling back to the classic
// parser when the model fails.

export const ERROR_GENERICO = 'Error al procesar. Intenta de nuevo.'

// Plain-text reply. The shared helper throws on a Telegram error (the alarms
// need that to retry); here a failed reply is only worth a log line.
// Returns the Telegram message id (null in the web chat or on failure).
export async function reply(chatId: number, text: string, replyMarkup?: unknown, html = false): Promise<number | null> {
  let id: number | null = null
  try {
    id = await sendTelegram(chatId, text, { tag: 'bot', replyMarkup, html })
  } catch (err) {
    // Fase 15: if Telegram refuses the HTML (a stray "<" somewhere), the same
    // message goes out as plain text — an ugly link beats a silent bot.
    if (html && err instanceof TelegramError && err.status === 400) {
      try {
        id = await sendTelegram(chatId, sinHtml(text), { tag: 'bot-plano', replyMarkup })
      } catch {
        /* already logged by sendTelegram */
      }
    }
    /* otherwise already logged by sendTelegram */
  }
  // Fase 7: every answer is part of the thread the interpreter will read next.
  await guardarTurno(chatId, 'assistant', text)
  return id
}

/**
 * Fase 9c-D: a narrated answer — the paragraph, the compact numbered lines
 * (recorded as a list so "la 3 lista" works on them) and the proposal. When
 * the proposal means changes it comes as a plan on a fresh draft, with the
 * usual [✅ Hacer todo] [✏️ No, corrijo].
 */
async function responderNarradaEn(chatId: number, n: Narrada, prefix: string | null) {
  const id = await reply(chatId, joinLines(prefix, n.texto))
  if (n.items.length > 0) {
    try {
      await guardarAlarma('lista', n.items, { chat_id: chatId, message_id: id, texto: n.texto })
    } catch (err) {
      console.error(`[bot] narrada bot_alarmas: ${mensajeError(err)}`)
    }
  }
  if (n.plan && n.plan.length > 0) {
    const nonce = await borradorConNonce(chatId, n.texto.slice(0, 200), { tipo: 'plan', acciones: n.plan })
    await reply(chatId, renderPlan(n.plan), botonesPlan(nonce))
  }
}

/**
 * Fase 7-B: at most one suggestion after a message, as its own message with
 * buttons on a fresh draft. Nothing when a question is already pending.
 */
async function sugerir(chatId: number, s: Sugerencia | null) {
  if (!s) return
  // Fase 12b: no "Ojo: …" right after a warning or a "no entendí" — she is sorting that out, not the note.
  if (await ultimoTurnoFueTropiezo(chatId)) return
  if (s.botones.length === 0) {
    await reply(chatId, s.texto)
    return
  }
  const nonce = await borradorConNonce(chatId, s.texto, s.draft)
  await reply(chatId, s.texto, botonesDe(s, nonce))
}

/** True when the bot's last two answers in this thread carried a ⚠️ or a "no entendí". */
async function ultimoTurnoFueTropiezo(chatId: number): Promise<boolean> {
  try {
    const turnos = await turnosRecientes(chatId, 4)
    return turnos
      .filter((t) => t.rol === 'assistant')
      .slice(-2)
      .some((t) => /⚠️|no entend[ií]|no pude|se me trab[oó]/i.test(t.texto))
  } catch {
    return false
  }
}

function joinLines(...lines: (string | null | undefined)[]): string {
  return lines.filter(Boolean).join('\n')
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'https://gabby-hq.vercel.app').replace(/\/$/, '')
}

function modeloActual(): string {
  try {
    const c = llmConfig()
    return `${c.model} (${c.provider})`
  } catch {
    return process.env.LLM_MODEL ?? 'gpt-5-mini'
  }
}

/** A draft always starts with a fresh id; the nonce goes into the buttons. */
async function borradorConNonce(chatId: number, texto: string, parsed: BorradorParsed): Promise<string> {
  const b = await crearBorrador(chatId, texto, parsed)
  return nonceDe(b.id)
}

// ── Tasks: save, or ask ──────────────────────────────────────────────────

/**
 * Either saves the task and confirms in one line, or stores a draft and asks
 * the first missing question with buttons. `prefix` is the "🎤 Entendí: «…»"
 * line for voice notes — it goes in the same message as the answer.
 */
async function guardarOPreguntar(chatId: number, texto: string, tarea: TareaParsed, prefix: string | null) {
  const falta = faltantes(tarea)
  if (falta.length === 0) {
    await guardarYConfirmar(chatId, tarea, prefix)
    return
  }
  const borrador = await crearBorrador(chatId, texto, tarea)
  const q = pregunta(falta[0], nonceDe(borrador.id), await cargarEmpresas())
  await reply(chatId, joinLines(prefix, q.text), q.replyMarkup)
}

function botonesHoraCalendar(nonce: string) {
  return inlineKeyboard([
    HORAS_BOTONES.map((h) => ({ text: formatHoraEs(`${h}:00`), callback_data: `h:${nonce}:${h}` })),
    [{ text: '📆 Todo el día', callback_data: `h:${nonce}:dia` }],
  ])
}

/**
 * Saves and confirms. Fase 5-B: when she asked for Calendar and the task
 * has a date but no hour, the confirmation comes with the hour buttons.
 */
async function guardarYConfirmar(chatId: number, tarea: TareaParsed, prefix: string | null) {
  const g = await guardarTarea(tarea)
  const linea = confirmacion(tarea, g.sync)
  await guardarTurno(chatId, 'assistant', `[creada] ${tarea.text}`, { tareas: [{ id: g.id, text: tarea.text }] })
  if (g.faltaHora && tarea.todo_el_dia) {
    // Ajuste 16e: "recordatorio del día" → todo el día, sin preguntar la hora.
    const sync = await agregarACalendar(g.id, { todoElDia: true })
    await reply(chatId, joinLines(prefix, confirmacion(tarea, sync), sync.confirmacion))
    return
  }
  if (g.faltaHora) {
    const nonce = await borradorConNonce(chatId, tarea.text, { tipo: 'calendar_hora', task_id: g.id, texto: tarea.text })
    await reply(chatId, joinLines(prefix, linea, '📅 ¿A qué hora la pongo en calendar?'), botonesHoraCalendar(nonce))
    return
  }
  await reply(chatId, joinLines(prefix, linea, g.sync?.confirmacion))
  await sugerir(chatId, await trasCrear(await cargarConfig(), g.id, tarea))
}

/** "pon en calendar la de TOTT": the open task by title, then the event (or the hour question). */
async function ponerEnCalendar(chatId: number, termino: string, prefix: string | null) {
  const { data, error } = await dbCliente().from('tasks').select(COLS_SIN_NOTAS).eq('done', false)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const hits = buscarEnAbiertas((data as unknown as TaskRow[]) ?? [], termino)
  if (hits.length === 0) {
    // Ajuste 14b: no dejarla en un callejón — quizá no era una tarea, sino un evento nuevo.
    await reply(
      chatId,
      joinLines(
        prefix,
        `No encontré ninguna tarea abierta con «${termino}».`,
        'Si lo que quieres es un evento nuevo en el calendario, dímelo con su hora: «Love on Hire los jueves a las 2 pm hasta el 1 de diciembre».'
      )
    )
    return
  }
  if (hits.length > 1) {
    await reply(chatId, joinLines(prefix, `«${termino}» coincide con ${hits.length} tareas: ${hits.slice(0, 5).map((t) => `«${t.text}»`).join(', ')}. Dime algo más específico.`))
    return
  }
  const t = hits[0]
  if (!t.due_date) {
    await reply(chatId, joinLines(prefix, `«${t.text}» no tiene fecha. Ponle una ("${t.text.split(' ').slice(0, 2).join(' ')} para el viernes") y vuelve a pedirlo.`))
    return
  }
  if (!t.due_time) {
    const nonce = await borradorConNonce(chatId, termino, { tipo: 'calendar_hora', task_id: t.id, texto: t.text })
    await reply(chatId, joinLines(prefix, `📅 ¿A qué hora pongo «${t.text}» (${formatVenceEs(t.due_date)}) en calendar?`), botonesHoraCalendar(nonce))
    return
  }
  const r: ResultadoSync = await agregarACalendar(t.id)
  await reply(chatId, joinLines(prefix, r.confirmacion ?? r.aviso ?? '📅 sin cambios'))
}

/**
 * Shared tail of every action: mint a draft (its nonce goes into any buttons),
 * run the resolver, then keep the draft only if buttons are waiting on it.
 * Returns false when the resolver had nothing to say (edit with no match).
 */
async function responderAccion(
  chatId: number,
  text: string,
  params: AccionParams,
  resolver: (nonce: string) => Promise<Respuesta | null>,
  prefix: string | null
): Promise<Respuesta | null> {
  const borrador = await crearBorrador(chatId, text, { tipo: 'accion', params, candidatos: [] })
  const r = await resolver(nonceDe(borrador.id))
  if (!r) {
    await borrarBorrador(borrador.id)
    return null
  }
  if (r.candidatos && r.candidatos.length > 0) {
    await actualizarBorrador(borrador.id, { tipo: 'accion', params, candidatos: r.candidatos })
  } else if (r.confirmar && r.confirmar.length > 0) {
    await actualizarBorrador(borrador.id, { tipo: 'confirmar', params, ids: r.confirmar })
  } else {
    await borrarBorrador(borrador.id)
  }
  await reply(chatId, joinLines(prefix, r.text), r.replyMarkup)
  return r
}

/** "para" / "después" while organízame is running ends the session with its summary. */
async function salidaOrganizar(chatId: number, text: string): Promise<boolean> {
  if (!/^(?:para|basta|despu[eé]s|luego|stop|salir|ya|cancela|cancelar)\b/i.test(text.trim())) return false
  const b = await borradorVigente(chatId)
  if (!b || b.parsed.tipo !== 'organizar') return false
  await borrarBorrador(b.id)
  await reply(chatId, resumenOrganizar(b.parsed, await cargarConfig()))
  return true
}

/**
 * Ajuste 9c-1: "correos de X" — the MAILBOX X (never the company): one match
 * → the narrated list; none or several → the accounts as buttons (a typed
 * name works too while the question waits). `importante` narrows to urgent
 * + "someone waits".
 */
async function responderCorreos(chatId: number, pedido: { cuenta: string | null; importante: boolean; mio: boolean }, prefix: string | null) {
  if (!pedido.cuenta) {
    if (prefix) await reply(chatId, prefix)
    await enviarListaCorreos(chatId, null, { importante: pedido.importante })
    return
  }
  const cfg = await cargarConfig()
  const hits = await cuentasPorTexto(pedido.cuenta, { mio: pedido.mio, persona: cfg.nombre_persona })
  if (hits.length === 1) {
    if (prefix) await reply(chatId, prefix)
    await enviarListaCorreos(chatId, hits[0], { importante: pedido.importante })
    return
  }
  const todas = hits.length > 1 ? hits : await cargarCuentas().catch(() => [] as CuentaCorreo[])
  if (todas.length === 0) {
    await reply(chatId, joinLines(prefix, 'No hay cuentas de correo conectadas todavía (Settings → Correo).'))
    return
  }
  const nonce = await borradorConNonce(chatId, pedido.cuenta, { tipo: 'cuenta_correo', cuenta_ids: todas.map((c) => c.id), importante: pedido.importante })
  const pregunta = hits.length > 1
    ? `«${pedido.cuenta}» puede ser ${hits.map((c) => c.nombre).join(' o ')}. ¿Cuál?`
    : `No tengo una cuenta de correo «${pedido.cuenta}». ¿Cuál de estas?`
  await reply(chatId, joinLines(prefix, pregunta), inlineKeyboard(todas.map((c) => [{ text: `📧 ${c.nombre}${c.duena ? ` (${c.duena})` : ''}`, callback_data: `a:${nonce}:${c.id}` }])))
}

/** The last things she said before this message (newest first), for a re-reading. */
async function dichosAntes(chatId: number, actual: string): Promise<string[]> {
  const turnos = await historial(chatId)
  const textos = turnos.filter((t) => t.rol === 'user' && !t.texto.startsWith('[')).map((t) => t.texto).reverse()
  // The current message is already in the thread: skip it.
  if (textos[0] === actual) textos.shift()
  return textos.slice(0, 4)
}

/**
 * Ajuste 9c-1 (rule 4): she says the bot read her wrong. Admit it and
 * re-run the previous message with the other reading: mail ("eran correos")
 * → the mailbox list; tasks ("eran tareas") → the task list of that
 * company; "me refería a …" → that, as a new message.
 */
async function responderRelectura(chatId: number, r: Relectura, texto: string, prefix: string | null) {
  const antes = await dichosAntes(chatId, texto)
  const pista = r.resto ?? antes.join(' · ')
  if (r.lectura === 'correos') {
    const companies = await cargarEmpresas()
    const parsed = parseMensaje(`correos ${r.resto ?? ''}`.trim(), companies, cancunYmd())
    const importante = /importante|urgente|respuesta/i.test(pista)
    // The mailbox: what she named now, or any account mentioned in what she said before.
    let cuenta: string | null = parsed.kind === 'correos' ? parsed.cuenta : null
    if (!cuenta) {
      for (const dicho of antes) {
        const p = parseMensaje(`correos de ${dicho}`, companies, cancunYmd())
        const hint = p.kind === 'correos' ? p.cuenta : dicho
        if (hint && (await cuentasPorTexto(hint)).length >= 1) {
          cuenta = hint
          break
        }
      }
    }
    await responderCorreos(chatId, { cuenta, importante, mio: /\bmi\b/i.test(pista) }, joinLines(prefix, 'Tienes razón, lo leí mal: eran correos.'))
    return
  }
  if (r.lectura === 'tareas') {
    const companies = await cargarEmpresas()
    const n = pista.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const empresa = [...companies].sort((a, b) => b.name.length - a.name.length).find((c) => n.includes(c.name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())) ?? null
    await reply(chatId, joinLines(prefix, `Tienes razón, lo leí mal: eran tareas${empresa ? ` de ${empresa.name.trim()}` : ''}.`))
    await enviarLista(chatId, empresa ? 'pendientes' : 'manana', empresa)
    return
  }
  if (r.resto) {
    await handleText(chatId, r.resto, joinLines(prefix, 'Tienes razón, lo leí mal. Va de nuevo:'))
    return
  }
  await reply(chatId, joinLines(prefix, 'Perdón, lo leí mal. ¿Me lo dices otra vez completo?'))
}

/**
 * Fase 14: a question about her papers ("¿con quién tengo el seguro del
 * carro?") is answered from the archivero, with the signed link. Returns
 * false when it is not that kind of question or nothing is filed yet, and
 * the usual answer takes over.
 */
async function respuestaDelArchivero(chatId: number, texto: string, prefix: string | null): Promise<boolean> {
  if (!pareceDeDocumentos(texto)) return false
  try {
    const hits = await buscarDocumentos({ q: texto, max: 1 })
    if (hits.length === 0) return false
    if (prefix) await reply(chatId, prefix)
    const r = await responderDeDocumentos(texto)
    await reply(chatId, r.texto, undefined, true)
    return true
  } catch (err) {
    console.warn(`[bot] archivero: ${mensajeError(err)}`)
    return false
  }
}

/**
 * Fase 14: she tapped [✏️ Corregir] on a ficha — this message is the
 * correction ("el título es X", "vence el 15 de marzo"). "olvídalo" lets it
 * go. Returns true when the message was the correction.
 */
async function correccionDeFicha(chatId: number, text: string, prefix: string | null): Promise<boolean> {
  let b
  try {
    b = await borradorDocVigente(chatId)
  } catch {
    return false
  }
  if (!b || b.estado !== 'corrigiendo') return false
  // A correction is answered right away; after half an hour it is a new message.
  if (Date.now() - new Date(b.creado).getTime() > 30 * 60 * 1000) return false
  if (/^(?:olv[ií]dalo|olvidalo|d[eé]jalo|dejalo|cancela(?:lo)?|nada|despu[eé]s|luego)\b/i.test(text.trim())) {
    await actualizarBorradorDoc(b.id, { estado: 'propuesto' })
    await reply(chatId, joinLines(prefix, `Ok, lo dejo como estaba. La ficha de «${b.propuesta.titulo}» sigue esperando tu 💾 arriba.`))
    return true
  }
  try {
    if (prefix) await reply(chatId, prefix)
    await enviarSalidaDoc(chatId, await corregirFicha(b, text, await cargarEmpresas()))
  } catch (err) {
    console.error(`[bot] corregir ficha: ${mensajeError(err)}`)
    await reply(chatId, `⚠️ No pude aplicar la corrección: ${motivoParaUsuario(err)}`)
  }
  return true
}

export async function handleText(chatId: number, text: string, prefix: string | null) {
  if (!text) {
    await reply(chatId, joinLines(prefix, 'No entendí nada. ¿Me lo repites?'))
    return
  }
  // Fase 18: "/canal" conecta el bot de Chelsea a GabbyHQ, le manda su resumen y dice cómo quedó.
  if (/^\/canal\b/i.test(text.trim())) {
    const e = await conectarCanalChelsea(appUrl())
    if (e.ok) await enviarResumenChelsea({ test: true })
    await reply(chatId, `${e.ok ? '✅' : '⚠️'} ${e.detalle}${e.ok ? '\nTe acabo de mandar ahí el resumen de Chelsea como prueba.' : ''}`)
    return
  }
  // Fase 16: "/modelo" prueba de verdad el modelo de conversación y dice cuál contesta.
  if (/^\/modelo\b/i.test(text.trim())) {
    await reply(chatId, await probarModeloConversacion())
    return
  }
  // Ajuste 15a: varias órdenes de alarmas apiladas en un mensaje ("quita las alarmas de pago ⏎ pasa mis
  // alarmas al calendario ⏎ alarma: …") se atienden una por una, en orden, como si las hubiera mandado aparte.
  const apiladas = lineasConOrdenDeAlarmas(text)
  if (apiladas) {
    if (prefix) await reply(chatId, prefix)
    for (const linea of apiladas) await handleText(chatId, linea, null)
    return
  }
  // Fase 9c-A: the first message of a conversation (nothing in the last 30 min) installs the menu with its reply.
  if ((await historial(chatId)).length === 0) pedirMenu()
  // Fase 7: the thread remembers what she said (the transcription, for a voice note).
  await guardarTurno(chatId, 'user', text)
  if (await salidaOrganizar(chatId, text)) return
  // Fase 14: una ficha esperando corrección se lleva el siguiente mensaje.
  if (await correccionDeFicha(chatId, text, prefix)) return
  // Fase 14: "guarda: el seguro del carro es con GNP" → al cerebro, sin archivo.
  const dato = leerNotaCerebro(text)
  if (dato) {
    try {
      await enviarSalidaDoc(chatId, await recibirNota(chatId, dato, await cargarEmpresas()))
    } catch (err) {
      console.error(`[bot] nota cerebro: ${mensajeError(err)}`)
      await reply(chatId, `⚠️ No pude archivar el dato: ${motivoParaUsuario(err)}`)
    }
    return
  }
  // Ajuste 9c-1: "¿cuál cuenta?" is waiting and she types the name ("IM Chelsea") → that mailbox.
  const esperaCuenta = await borradorVigente(chatId)
  if (esperaCuenta && 'tipo' in esperaCuenta.parsed && esperaCuenta.parsed.tipo === 'cuenta_correo') {
    const hits = await cuentasPorTexto(text)
    if (hits.length === 1 && esperaCuenta.parsed.cuenta_ids.includes(hits[0].id)) {
      const importante = esperaCuenta.parsed.importante
      await borrarBorrador(esperaCuenta.id)
      if (prefix) await reply(chatId, prefix)
      await enviarListaCorreos(chatId, hits[0], { importante })
      return
    }
  }
  // Ajuste 9c-1: "eso no son correos, son tareas" / "no, me refería a…" corrects how the LAST message was read.
  const relectura = leerRelectura(text)
  if (relectura) {
    await responderRelectura(chatId, relectura, text, prefix)
    return
  }
  // Ajuste 7-G: while a plan waits for its OK, "quita X", "déjala donde
  // estaba" or "olvídalo" correct THAT plan; nothing is deleted or completed.
  const pendiente = await planPendiente(chatId)
  if (pendiente) {
    // Ajuste 15b: "quita las alarmas de pago" / "pasa mis alarmas al calendario" hablan de SUS alarmas,
    // no del plan — salvo que el plan tenga una alarma, y entonces sí puede ser de esa.
    const deSusAlarmas = esOrdenDeAlarmas(text) && !pendiente.acciones.some((a) => a.tipo === 'alarma')
    const c = deSusAlarmas ? null : leerCorreccion(text)
    if (c) {
      await responderCorreccion(chatId, pendiente, aplicarCorreccion(pendiente.acciones, c), prefix)
      return
    }
  }
  const companies = await cargarEmpresas()
  const parsed = parseMensaje(text, companies, cancunYmd())
  switch (parsed.kind) {
    case 'dividir': {
      // Fase 7-H: by title, then 3–5 subtasks and the first step.
      await ponerPasos(chatId, parsed.termino, prefix)
      return
    }
    case 'siguiente_paso': {
      const ultima = (await tareasRecientes(chatId))[0]
      await reply(chatId, joinLines(prefix, ultima ? await siguientePaso(ultima.id) : 'No sé de qué tarea: dime "siguiente paso de X".'))
      return
    }
    case 'olvidar':
      await limpiarHilo(chatId)
      await reply(chatId, joinLines(prefix, 'Listo, empezamos de cero.'))
      return
    case 'organizar': {
      const cfg = await cargarConfig()
      const o = await iniciarOrganizar(cfg)
      if (!o) {
        await reply(chatId, joinLines(prefix, `Nada que ordenar, ${cfg.nombre_persona}: no hay vencidas, ni sin fecha, ni urgentes 🎉`))
        return
      }
      const nonce = await borradorConNonce(chatId, text, o.draft)
      await reply(chatId, joinLines(prefix, o.texto), tecladoOrganizar(nonce))
      return
    }
    case 'inicio':
      // The presentation carries the menu (fase 9c-A).
      await reply(chatId, joinLines(prefix, presentacion(await cargarConfig())), tecladoMenu())
      return
    case 'menu':
      await reply(chatId, joinLines(prefix, 'Listo, ahí tienes el menú. Cada botón es una pregunta: tócalo o escríbela, da igual. «/ocultar» lo quita.'), tecladoMenu())
      return
    case 'ocultar':
      await reply(chatId, joinLines(prefix, 'Menú oculto. «/menu» lo trae de vuelta.'), quitarTeclado())
      return
    case 'tablero':
      // Fase 9c-B: the board as a picture, with the button to open it.
      if (prefix) await reply(chatId, prefix)
      try {
        await enviarTablero(chatId)
      } catch (err) {
        console.error(`[bot] tablero: ${mensajeError(err)}`)
        await reply(chatId, `No pude armar la imagen del tablero ahora (${motivoParaUsuario(err)}). Lo tienes en ${appUrl()}/hoy.`)
      }
      return
    case 'ayuda':
      if (parsed.larga) {
        // The same guide as docs/comandos.md, in 2–3 HTML messages.
        for (const parte of guiaTelegram()) await reply(chatId, parte, undefined, true)
        return
      }
      await reply(chatId, ayuda(modeloActual()))
      return
    case 'accion': {
      // "listo …" / "pasa …" / "borra …": by alarm number, "todo", or a word
      // of the title.
      const params: AccionParams = { accion: parsed.accion, cambios: parsed.cambios }
      const r = await responderAccion(chatId, text, params, (nonce) => manejarAccion(params, parsed.arg, nonce), prefix)
      // Fase 7-B: after closing ONE task directly, propose the next one.
      if (parsed.accion === 'listo' && r && !r.candidatos?.length && !r.confirmar?.length && /^[\d\s,;]+$/.test(parsed.arg.trim()) && !parsed.arg.includes(',')) {
        const id = r.text.startsWith('✅') ? await idDeNumero(parsed.arg.trim()) : null
        if (id) await sugerir(chatId, await trasCompletar(chatId, await cargarConfig(), id))
      }
      return
    }
    case 'nota_tarea': {
      if (!parsed.texto) {
        await reply(chatId, joinLines(prefix, 'Formato: nota en paypal: texto que quieres agregar'))
        return
      }
      const params: AccionParams = { accion: 'nota_tarea', texto: parsed.texto }
      await responderAccion(chatId, text, params, (nonce) => manejarPorTitulo(params, parsed.termino, nonce), prefix)
      return
    }
    case 'nota': {
      const n = parsed.nota
      if (n.modo !== 'borrar' && !n.texto) {
        await reply(chatId, joinLines(prefix, USO_NOTA))
        return
      }
      if (!n.company_id) {
        const nonce = await borradorConNonce(chatId, text, { tipo: 'nota', nota: n })
        const q = pregunta('empresa', nonce, companies)
        await reply(chatId, joinLines(prefix, '¿Nota de qué empresa?'), q.replyMarkup)
        return
      }
      await reply(chatId, joinLines(prefix, await ejecutarNota(n)))
      return
    }
    case 'pregunta': {
      // Fase 14: si la pregunta huele a papeles, el archivero va primero (si no hay nada, sigue el camino normal).
      if (await respuestaDelArchivero(chatId, parsed.texto, prefix)) return
      // Fase 9c-D: the known questions ("¿qué tengo hoy?", "¿cómo va IM?", "¿qué tengo estancado?"…) get prose + a short list + a proposal, no model.
      const narrada = await responderNarrada(chatId, parsed.texto)
      if (narrada) {
        await responderNarradaEn(chatId, narrada, prefix)
        return
      }
      // Fase 3: context + LLM, ≤5 lines, logged in bot_preguntas. Fase 7-B: one "ojo" if the data shows a problem.
      await reply(chatId, joinLines(prefix, await responderPregunta(chatId, parsed.texto)))
      await sugerir(chatId, await trasPregunta(chatId, await cargarConfig()))
      return
    }
    case 'radar': {
      if (!parsed.titulo) {
        await reply(chatId, joinLines(prefix, 'Uso: radar <descripción>'))
        return
      }
      const { error } = await createServerClient().from('radar').insert({ titulo: parsed.titulo, estado: 'idea' })
      if (error) throw new Error(`Supabase radar: ${error.message}`)
      await reply(chatId, joinLines(prefix, `✓ Radar: "${parsed.titulo}"`))
      return
    }
    case 'calendar':
      // Fase 5-B: Calendar only on request.
      await ponerEnCalendar(chatId, parsed.termino, prefix)
      return
    case 'pagos':
      // Fase 5-C: read-only here; payments are managed in /settings.
      await reply(chatId, joinLines(prefix, await textoListaPagos(parsed.empresa?.id ?? null, parsed.empresa?.name.trim() ?? null, { semana: parsed.semana })))
      return
    case 'pagos_web':
      await reply(chatId, joinLines(prefix, 'Los pagos recurrentes se agregan, cambian y quitan en GabbyHQ → Settings → Pagos recurrentes. Por aquí solo los consulto: "pagos de IM", "qué pagos hay esta semana".'))
      return
    case 'lista':
      // Fase 4c: the 8:00 / 6:00 pm message, now, recorded like the cron's; 4d: one company.
      if (prefix) await reply(chatId, prefix)
      await enviarLista(chatId, parsed.tipo, parsed.empresa ?? null)
      return
    case 'correos':
      // Ajuste 6-2 / 9c-1: the live mail list of one mailbox (or all), narrated, numbered and recorded (tipo 'correos').
      await responderCorreos(chatId, parsed, prefix)
      return
    case 'que_sigue':
      // Fase 4b: ordered in code, same HTML style as the 8:00 list, numbered like an alarm.
      if (prefix) await reply(chatId, prefix)
      await enviarQueSigue(chatId, parsed.opts)
      return
    case 'alarmas':
      await reply(chatId, joinLines(prefix, await listarRecordatorios(chatId)))
      return
    case 'esperando': {
      // Fase 9c-D: narrated (who, since when), then the numbered ⏳ lines ("listo 2" works on them).
      const narrada = await responderNarrada(chatId, '¿qué tengo esperando?')
      if (narrada) {
        await responderNarradaEn(chatId, narrada, prefix)
        return
      }
      if (prefix) await reply(chatId, prefix)
      await enviarListaEsperando(chatId)
      return
    }
    case 'esperar': {
      // Fase 9: "la de TOTT está esperando a Andrew" — by list number or a word of the title.
      const params: AccionParams = { accion: 'esperar', quien: parsed.quien, fin: parsed.fin }
      await responderAccion(chatId, text, params, (nonce) => manejarAccion(params, parsed.termino, nonce), prefix)
      return
    }
    case 'mudar_alarmas':
      // Fase 15: "pasa mis alarmas al calendario".
      await reply(chatId, htmlSeguro(joinLines(prefix, await textoMudanza(chatId))), undefined, true)
      return
    case 'quitar_alarma':
      await reply(chatId, joinLines(prefix, await quitarRecordatorio(chatId, parsed.arg)))
      return
    case 'edicion':
    case 'tarea':
      // Free text: the interpreter first (fase 4); the classic result is the fallback.
      await handleLibre(chatId, text, parsed, prefix)
      return
  }
}

// ── Classic fallback (what every free text did before fase 4) ────────────

async function handleClasico(chatId: number, text: string, parsed: Parsed, prefix: string | null) {
  switch (parsed.kind) {
    case 'edicion': {
      // "paypal urgente": an edit if some open task matches «paypal»;
      // otherwise it was a new task all along.
      const params: AccionParams = { accion: 'editar', cambios: parsed.cambios }
      const handled = await responderAccion(chatId, text, params, (nonce) => manejarPorTitulo(params, parsed.termino, nonce), prefix)
      if (!handled) await guardarOPreguntar(chatId, text, parsed.fallback, prefix)
      return
    }
    case 'tarea': {
      if (!parsed.tarea.text) {
        await reply(chatId, joinLines(prefix, 'Falta la tarea. Ejemplo: urgente IM llamar a Juan mañana'))
        return
      }
      await guardarOPreguntar(chatId, text, parsed.tarea, prefix)
      return
    }
    default:
      await handleText(chatId, text, prefix)
  }
}

/** The classic parser found something explicit (a modifier, a company, a date): worth saving without asking. */
function clasicoEstructurado(parsed: Parsed): boolean {
  if (parsed.kind === 'edicion') return true
  if (parsed.kind !== 'tarea') return true
  const t = parsed.tarea
  return !!t.text && (!!t.company_id || !!t.priority || !!t.due_date || t.importante)
}

const PISTA_ORDEN = 'Es una ORDEN sobre una tarea existente (completar, cancelar, posponer, renombrar, cambiar o nota). Busca la tarea más parecida.'
const PISTA_ALARMA = 'Es una ALARMA (recordatorio): devuelve una acción "alarma" con texto, fecha y hora.'

function botonesAclarar(nonce: string) {
  return inlineKeyboard([[
    { text: '➕ Tarea nueva', callback_data: `q:${nonce}:tarea` },
    { text: '🔧 Orden', callback_data: `q:${nonce}:orden` },
    { text: '⏰ Alarma', callback_data: `q:${nonce}:alarma` },
  ]])
}

async function preguntarQueEs(chatId: number, text: string, prefix: string | null) {
  const cfg = await cargarConfig()
  const nonce = await borradorConNonce(chatId, text, { tipo: 'aclarar', texto: text })
  await reply(chatId, joinLines(prefix, loQueOi(chatId), `No entendí bien eso, ${cfg.nombre_persona}. ¿Es una tarea nueva, una orden sobre una tarea, o una alarma?`), botonesAclarar(nonce))
}

/** "divide X": the open task whose title contains X, then its steps. */
async function ponerPasos(chatId: number, termino: string, prefix: string | null) {
  const { data, error } = await dbCliente().from('tasks').select(COLS_SIN_NOTAS).eq('done', false)
  if (error) throw new Error(`Supabase tasks: ${error.message}`)
  const hits = buscarEnAbiertas((data as unknown as TaskRow[]) ?? [], termino)
  if (hits.length === 0) {
    await reply(chatId, joinLines(prefix, `No encontré ninguna tarea abierta con «${termino}». ¿La creo? Dímela como tarea y luego "divide …".`))
    return
  }
  if (hits.length > 1) {
    await reply(chatId, joinLines(prefix, `«${termino}» coincide con ${hits.length} tareas: ${hits.slice(0, 5).map((t) => `«${t.text}»`).join(', ')}. Dime algo más específico.`))
    return
  }
  await guardarTurno(chatId, 'assistant', `[dividir] ${hits[0].text}`, { tareas: [{ id: hits[0].id, text: hits[0].text }] })
  await reply(chatId, joinLines(prefix, await dividirTarea(hits[0].id)))
}

/** The task id behind "listo 3": number 3 of the last numbered list (of any type). */
async function idDeNumero(n: string): Promise<string | null> {
  const alarma = await ultimaAlarma().catch(() => null)
  return alarma?.items.find((i) => i.n === Number(n))?.task_id ?? null
}

// ── Fase 4: free text → interpreter → plan ───────────────────────────────

/**
 * Logs the interpreted message with what came out of it, so the prompt can
 * be tuned later and "la anterior" knows which task was last mentioned.
 */
async function registrar(chatId: number, text: string, r: Interpretacion, acciones: AccionResuelta[]) {
  await registrarInterpretacion({
    chat_id: chatId,
    pregunta: text,
    respuesta: resumenParaLog(acciones),
    modelo: r.modelo,
    tokens_in: r.tokensIn,
    tokens_out: r.tokensOut,
    ms: r.ms,
  })
}

function botonesPlan(nonce: string, semana = false) {
  return inlineKeyboard([[
    { text: semana ? '✅ Así queda' : '✅ Hacer todo', callback_data: `k:${nonce}:1` },
    { text: semana ? '✏️ Corrijo' : '✏️ No, corrijo', callback_data: `k:${nonce}:0` },
  ]])
}

function botonesHora(nonce: string) {
  return inlineKeyboard([HORAS_BOTONES.map((h) => ({ text: formatHoraEs(`${h}:00`), callback_data: `h:${nonce}:${h}` }))])
}

// ── Ajuste 7-G: correcting the plan that waits ───────────────────────────

const COMO_CORREGIR = 'Dime qué corrijo: «la de marketing a las 10», «lo de WSH el viernes», «quita X», «déjala donde estaba»… o «olvídalo» para no hacer nada.'

interface PlanPendiente {
  id: string
  nonce: string
  acciones: AccionResuelta[]
}

/** The plan (or the question about it) that waits for her OK, if any. */
async function planPendiente(chatId: number): Promise<PlanPendiente | null> {
  const b = await borradorVigente(chatId)
  if (!b || !('tipo' in b.parsed) || (b.parsed.tipo !== 'plan' && b.parsed.tipo !== 'plan_duda')) return null
  // Ajuste 15b: un "plan" donde nada se puede ejecutar no espera nada: el siguiente mensaje es un mensaje nuevo.
  if (sinNadaQueHacer(b.parsed.acciones)) return null
  return { id: b.id, nonce: nonceDe(b.id), acciones: b.parsed.acciones }
}

/**
 * Applies a correction's outcome: the corrected plan (only what changed,
 * with the plan's buttons again), a question with buttons, "nothing to
 * change", or the plan discarded.
 */
async function responderCorreccion(chatId: number, plan: PlanPendiente, r: Resultado, prefix: string | null) {
  if (r.tipo === 'descartar') {
    await borrarBorrador(plan.id)
    if (r.limpiarHilo) await limpiarHilo(chatId)
    await reply(chatId, joinLines(prefix, r.limpiarHilo ? 'Ok, descarté el plan y empezamos de cero. No hice nada.' : 'Ok, descarté el plan. No hice nada.'))
    return
  }
  if (r.tipo === 'igual') {
    await actualizarBorrador(plan.id, { tipo: 'plan', acciones: plan.acciones })
    await reply(chatId, joinLines(prefix, r.texto), botonesPlan(plan.nonce, esPlanSemana(plan.acciones)))
    return
  }
  if (r.tipo === 'duda') {
    await actualizarBorrador(plan.id, { tipo: 'plan_duda', acciones: plan.acciones, opciones: r.opciones })
    await reply(chatId, joinLines(prefix, r.pregunta), inlineKeyboard(r.opciones.map((o, i) => [{ text: o.texto, callback_data: `c:${plan.nonce}:${i}` }])))
    return
  }
  if (r.acciones.length === 0) {
    await borrarBorrador(plan.id)
    await reply(chatId, joinLines(prefix, renderCorreccion(r), 'No hago nada.'))
    return
  }
  await actualizarBorrador(plan.id, { tipo: 'plan', acciones: r.acciones })
  await reply(chatId, joinLines(prefix, renderCorreccion(r)), botonesPlan(plan.nonce, esPlanSemana(r.acciones)))
}

/**
 * Everything that is not an exact command. `pista` comes from the
 * [Orden] / [Alarma] buttons on a second try.
 */
/** Actions that only read or talk: several of them together are never a plan to confirm. */
const SOLO_LECTURA = new Set<string>(['lista', 'que_sigue', 'pregunta', 'esperando', 'conversar', 'documentos', 'proyectos'])

async function handleLibre(chatId: number, text: string, parsed: Parsed, prefix: string | null, pista?: string) {
  const companies = await cargarEmpresas()
  const r = await interpretar(chatId, text, companies, pista)

  if (!r) {
    // The model is down or answered garbage: the bot keeps working as it did
    // before fase 4, except for alarms, which the classic parser cannot read.
    if (/^(?:alarma|recu[eé]rdame|av[ií]same|recordatorio)\b/i.test(text)) {
      await reply(chatId, joinLines(prefix, 'No pude interpretar la alarma ahora (el modelo falló). Inténtalo otra vez en un momento.'))
      return
    }
    await handleClasico(chatId, text, parsed, prefix)
    return
  }

  // Ajuste 16c: "el viernes 14" cuando el viernes es 13 → gana el día de la semana, y se dice.
  const avisosFecha = corregirFechas(r.acciones, text, cancunYmd())
  if (avisosFecha.length > 0) prefix = joinLines(prefix, ...avisosFecha)

  const utiles = r.acciones.filter((a) => a.tipo !== 'desconocido')
  if (utiles.length === 0) {
    await registrar(chatId, text, r, resolverAcciones(r.acciones, r.contexto, companies))
    if (pista) {
      await reply(chatId, joinLines(prefix, loQueOi(chatId), 'Sigo sin entender. Dime por ejemplo "listo 3", "pasa el 3 al lunes" o "alarma mañana 9am revisar X".'))
      return
    }
    if (clasicoEstructurado(parsed)) {
      await handleClasico(chatId, text, parsed, prefix)
      return
    }
    await preguntarQueEs(chatId, text, prefix)
    return
  }

  let acciones = resolverAcciones(utiles, r.contexto, companies)
  // Fase 7-G: a plan by days only touches what the message named.
  if (esPlanSemana(acciones)) acciones = soloLasNombradas(acciones, text)
  await registrar(chatId, text, r, acciones)

  // Ajuste 7-G: a plan is waiting → this is a correction of it ("la de
  // marketing a las 10"): the line it names changes, the rest stays.
  const pendiente = await planPendiente(chatId)
  if (pendiente) {
    const fusion = fusionarCorreccion(pendiente.acciones, acciones)
    if (fusion.tipo !== 'ajena') {
      await responderCorreccion(chatId, pendiente, fusion, prefix)
      return
    }
  }

  // Ajuste 15b: varias líneas y ninguna se puede hacer → no es un plan. Se dice en claro, sin botones
  // y sin dejar nada esperando (un plan vacío se tragaba el mensaje siguiente como "corrección").
  if (acciones.length >= 2 && sinNadaQueHacer(acciones)) {
    const motivos = Array.from(new Set(acciones.map((a) => a.error).filter((e): e is string => !!e)))
    await reply(
      chatId,
      joinLines(
        prefix,
        loQueOi(chatId),
        'No encontré nada que hacer con ese mensaje.',
        motivos.length > 0 ? motivos.map((m) => `• ${m}`).join('\n') : null,
        'Dímelo de otra forma, o una cosa a la vez.'
      )
    )
    return
  }

  // Ajuste 16c: varias cosas y ninguna cambia nada (una lista, una pregunta, pensar en voz alta) → no
  // es un plan: ni "Entendí: 1… 2…" ni botones. Si está conversando, se conversa con el mensaje
  // entero (y NO se le vuelve a mandar la lista que está comentando); si no, se contesta lo primero.
  if (acciones.length >= 2 && acciones.every((a) => SOLO_LECTURA.has(a.tipo))) {
    if (acciones.some((a) => a.tipo === 'conversar')) {
      await reply(chatId, joinLines(prefix, await responderConversacion(chatId, text)))
      return
    }
    acciones = [acciones[0]]
  }

  // ── Several actions, or anything that cancels: show the plan, ask OK ──
  if (necesitaConfirmacion(acciones)) {
    const nonce = await borradorConNonce(chatId, text, { tipo: 'plan', acciones })
    // Fase 7-G: several days → grouped by day, with ONE suggestion line under it.
    const semana = esPlanSemana(acciones)
    const cuerpo = semana ? renderPlanSemana(acciones) : renderPlan(acciones)
    const sugerencia = semana && (await cargarConfig()).sugerencias ? sugerenciaPlanSemana(acciones) : null
    // Fase 7-B: a long voice note closes with a door open for what was missed.
    const cierre = prefix && acciones.length >= 3 ? '¿Algo que se me escapó?' : null
    await reply(chatId, joinLines(prefix, cuerpo, sugerencia, cierre), botonesPlan(nonce, semana))
    return
  }

  // ── One action: run it now ──
  const a = acciones[0]
  // Fase 9c-D: a question or "qué tengo esperando" said in any other way → the narrated answer (list recorded, plan with buttons when it proposes changes).
  if (a.tipo === 'pregunta' || a.tipo === 'esperando') {
    const narrada = await responderNarrada(chatId, a.tipo === 'pregunta' ? a.texto : '¿qué tengo esperando?')
    if (narrada) {
      await responderNarradaEn(chatId, narrada, prefix)
      return
    }
  }
  // Fase 16: está pensando en voz alta → Gabita responde con una propuesta sobre su semana.
  // Sin el eco de "🎙 Entendí: …": la respuesta misma muestra que entendió.
  if (a.tipo === 'conversar') {
    await reply(chatId, await responderConversacion(chatId, a.texto))
    return
  }
  // Fase 14: el archivero contesta con enlace firmado, así que va en HTML y no por ejecutarUna.
  if (a.tipo === 'documentos') {
    if (prefix) await reply(chatId, prefix)
    const r = await responderDeDocumentos(a.texto)
    await reply(chatId, r.texto, undefined, true)
    return
  }
  if (a.tipo === 'documento_nota') {
    if (prefix) await reply(chatId, prefix)
    try {
      await enviarSalidaDoc(chatId, await recibirNota(chatId, a.texto, companies))
    } catch (err) {
      console.error(`[bot] documento_nota: ${mensajeError(err)}`)
      await reply(chatId, `⚠️ No pude archivar el dato: ${motivoParaUsuario(err)}`)
    }
    return
  }
  if (a.candidatos && a.candidatos.length > 0) {
    const nonce = await borradorConNonce(chatId, text, { tipo: 'elegir', accion: a, candidatos: a.candidatos.map((t) => t.id) })
    await reply(chatId, joinLines(prefix, '¿Cuál?'), inlineKeyboard(botonesElegir(a.candidatos, nonce).map((b) => [b])))
    return
  }
  if (a.error) {
    await reply(chatId, joinLines(prefix, `⚠️ ${a.error.charAt(0).toUpperCase()}${a.error.slice(1)}.`))
    return
  }
  if (a.tipo === 'crear') {
    const t = tareaParsedDe(a)
    // Ajuste 16e: lo que ella YA dijo no se le vuelve a preguntar. Si el modelo soltó la urgencia
    // ("normal, datavia, comprar X"), se toma del mensaje; y "recordatorio del día" es un evento
    // de todo el día en Calendar, sin preguntar la hora.
    if (!t.priority) {
      t.priority = prioridadDicha(text)
      if (t.priority === 'urgente') t.importante = true
    }
    if (t.due_date && !t.due_time && pideRecordatorioDelDia(text)) {
      t.calendar = true
      t.todo_el_dia = true
    }
    // "Compra de orangután - Datavia": la empresa ya va en su campo, no en el título.
    if (t.company_name) {
      const sin = t.text.replace(new RegExp(`\\s*[-–—·,(]\\s*${t.company_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)?\\s*$`, 'i'), '').trim()
      if (sin.length >= 3) t.text = sin
    }
    // Same flow as a typed task: ask company / urgency with buttons if missing.
    await guardarOPreguntar(chatId, text, t, prefix)
    return
  }
  if (a.tipo === 'borrar') {
    // "bórralo": the same [Sí, borrar] [No] as "borra 3". Never without it.
    const params: AccionParams = { accion: 'borra' }
    await responderAccion(chatId, text, params, (nonce) => conIds(params, [a.tarea!.id], nonce), prefix)
    return
  }
  if (a.tipo === 'calendar' && a.tarea && !a.hora && !a.todo_el_dia) {
    await ponerEnCalendar(chatId, a.tarea.text, prefix)
    return
  }
  if (a.tipo === 'alarma' && !a.dispara_en) {
    const nonce = await borradorConNonce(chatId, text, { tipo: 'alarma_hora', texto: a.texto, fecha: a.fecha ?? null, repetir: a.repetir ?? null })
    const dia = a.fecha ? `el ${formatVenceEs(a.fecha)}` : 'hoy'
    await reply(chatId, joinLines(prefix, `¿A qué hora te aviso «${a.texto}» ${dia}?`), botonesHora(nonce))
    return
  }
  // Fase 15: una línea puede traer un enlace (📆 abrir, 🔗 Reconectar). Va como HTML seguro:
  // nuestras etiquetas se quedan y lo que ella escribió se escapa.
  const hecho = await ejecutarUna(chatId, a)
  // Ajuste 16c: "(lista enviada arriba)" no dice nada: la lista ya está ahí.
  const soloMarca = /^\S+ \((?:lista|cierre) enviad[oa] arriba\)$|^\S+ \(enviado arriba\)$/.test(hecho.trim())
  if (soloMarca && !prefix) return
  await reply(chatId, htmlSeguro(joinLines(prefix, soloMarca ? null : hecho)), undefined, true)
  if (a.tarea) await guardarTurno(chatId, 'assistant', `[${a.tipo}] ${a.tarea.text}`, { tareas: [{ id: a.tarea.id, text: a.tarea.text }] })
  if (a.tipo === 'completar' && a.tarea) await sugerir(chatId, await trasCompletar(chatId, await cargarConfig(), a.tarea.id))
}

// ── Voice notes ──────────────────────────────────────────────────────────

export interface TelegramAudio {
  file_id: string
  duration?: number
  mime_type?: string
}

/** Ajuste 16c: the transcription of the voice note being handled, per chat (only shown when it was not understood). */
const oido = new Map<number, string>()
function loQueOi(chatId: number): string | null {
  const t = oido.get(chatId)
  return t ? `🎤 Escuché: «${t}»` : null
}

export async function handleVoice(chatId: number, audio: TelegramAudio) {
  const duration = audio.duration ?? 0
  if (duration > MAX_AUDIO_SECONDS) {
    await reply(chatId, `Mándame un audio más corto (máx ${MAX_AUDIO_SECONDS / 60} min).`)
    return
  }
  const { bytes, path } = await downloadTelegramFile(audio.file_id)
  const filename = path.split('/').pop() || 'voice.ogg'
  const texto = await transcribirAudio(bytes, filename)
  if (!texto) {
    await reply(chatId, 'No entendí el audio. ¿Me lo repites?')
    return
  }
  // Ajuste 16c: no more "🎤 Entendí: «…»" before every answer — the answer
  // itself shows what was understood. What she said only comes back when
  // Gabita did NOT understand, so she can tell a bad transcription from a bad reading.
  oido.set(chatId, texto)
  try {
    await handleText(chatId, texto, null)
  } finally {
    oido.delete(chatId)
  }
}

// ── Fase 14: documents (segundo cerebro) ─────────────────────────────────

/** Everything the brain says carries HTML (titles in bold, signed links). */
async function enviarSalidaDoc(chatId: number, s: SalidaDoc): Promise<void> {
  await reply(chatId, s.texto, s.botones, true)
}

export interface TelegramDocumento {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

/**
 * A PDF or a photo arrived. It is stored, read, and its ficha comes back with
 * [💾 Guardar] [✏️ Corregir]. Nothing is written to `documentos` until she
 * taps Guardar.
 */
export async function handleDocumento(
  chatId: number,
  file: TelegramDocumento,
  opts: { caption?: string | null; esFoto?: boolean } = {}
) {
  const nombre = file.file_name ?? (opts.esFoto ? 'foto.jpg' : 'documento')
  if ((file.file_size ?? 0) > TELEGRAM_MAX_BYTES) {
    await reply(chatId, avisoDemasiadoGrande(nombre, file.file_size ?? 0), undefined, true)
    return
  }
  // The read + the model take a while: say something first so she knows it landed.
  await reply(chatId, opts.esFoto ? '📷 Déjame leer la foto…' : `📄 Déjame leer «${nombre}»…`)
  const empresas = await cargarEmpresas()
  try {
    const { bytes, path } = await downloadTelegramFile(file.file_id)
    const tipo = file.mime_type ?? (opts.esFoto ? 'image/jpeg' : tipoPorExtension(path))
    const s = await recibirArchivo(chatId, {
      bytes,
      nombre: file.file_name ?? path.split('/').pop() ?? nombre,
      tipo,
      pista: opts.caption ?? null,
      esFoto: opts.esFoto,
    }, empresas)
    await enviarSalidaDoc(chatId, s)
  } catch (err) {
    console.error(`[bot] documento: ${mensajeError(err)}`)
    await reply(chatId, `⚠️ No pude archivarlo: ${motivoParaUsuario(err)}. Vuelve a mandarlo, o súbelo en ${appUrl()}/archivos.`)
  }
}

/** Telegram does not send a mime type for every file; the extension is enough. */
function tipoPorExtension(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return `image/${ext}`
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

/**
 * The brain's buttons: Guardar · Corregir · misma/otra página · renovación ·
 * "tarea de renovar" under a vencimiento. Returns false when `data` is not one
 * of them, so the usual button handling continues.
 */
async function procesarBotonDoc(chatId: number, data: string): Promise<boolean> {
  const m = data.match(/^(dg|dc|dm|do|dr|dn|dv):([0-9a-f-]{36})$/)
  if (!m) return false
  const [, kind, id] = m
  const empresas = await cargarEmpresas()

  // A vencimiento → a task ("Renovar la póliza del carro").
  if (kind === 'dv') {
    const d = await documentoPorId(id)
    if (!d) {
      await reply(chatId, 'Ese documento ya no está en el archivero.')
      return true
    }
    const g = await guardarTarea({
      text: tituloRenovar(d),
      priority: 'urgente',
      company_id: d.company_id,
      company_name: null,
      importante: true,
      due_date: d.vence,
      due_time: null,
      calendar: false,
    })
    await guardarTurno(chatId, 'assistant', `[creada] ${tituloRenovar(d)}`, { tareas: [{ id: g.id, text: tituloRenovar(d) }] })
    await reply(chatId, `✓ Tarea creada: «${tituloRenovar(d)}»${d.vence ? ` · vence ${formatVenceEs(d.vence)}` : ''} · urgente ★`)
    return true
  }

  const b = await borradorDocPorId(id)
  if (!b) {
    await reply(chatId, 'Esa ficha ya expiró (24 h) o ya la guardaste. Mándame el archivo otra vez si hace falta.')
    return true
  }
  try {
    if (kind === 'dg') {
      await enviarSalidaDoc(chatId, await guardarFicha(b, empresas))
      return true
    }
    if (kind === 'dc') {
      await actualizarBorradorDoc(b.id, { estado: 'corrigiendo' })
      await reply(chatId, COMO_CORREGIR_DOC)
      return true
    }
    if (kind === 'dm') {
      await enviarSalidaDoc(chatId, await unirPaginas(b, empresas))
      return true
    }
    if (kind === 'do') {
      await enviarSalidaDoc(chatId, await separarPaginas(b, empresas))
      return true
    }
    // La renovación: reemplaza a la anterior, o se guarda aparte.
    await enviarSalidaDoc(chatId, await guardarFicha(b, empresas, { reemplazar: kind === 'dr' }))
    return true
  } catch (err) {
    console.error(`[bot] botón documento ${kind}: ${mensajeError(err)}`)
    await reply(chatId, `⚠️ No pude: ${motivoParaUsuario(err)}`)
    return true
  }
}

// ── Inline buttons ───────────────────────────────────────────────────────

export interface CallbackQuery {
  id: string
  data?: string
  message?: { message_id: number; chat?: { id: number } }
}

/** A Telegram inline-button tap. */
export async function handleCallback(cq: CallbackQuery) {
  await answerCallbackQuery(cq.id)
  const chatId = cq.message?.chat?.id
  const messageId = cq.message?.message_id
  if (!chatId || !messageId) return
  if (!isAllowedChat(chatId)) {
    console.warn(`[bot] callback de chat no autorizado: ${chatId}`)
    return
  }
  await procesarBoton(chatId, messageId, String(cq.data ?? ''))
}

/**
 * What a button means, whatever sent it: Telegram (with the message id, so
 * its buttons can be removed) or the web chat (no message id; fase 9c-E).
 */
export async function procesarBoton(chatId: number, messageId: number | null, data: string) {
  const quitarBotones = async () => {
    if (messageId) await removeInlineKeyboard(chatId, messageId)
  }

  // ── Fase 14: the brain's buttons (their id is the draft, not a nonce) ──
  if (/^(?:dg|dc|dm|do|dr|dn|dv):/.test(data)) {
    try {
      await quitarBotones()
      if (await procesarBotonDoc(chatId, data)) return
    } catch (err) {
      console.error(`[bot] callback documento: ${mensajeError(err)}`)
      await reply(chatId, ERROR_GENERICO)
      return
    }
  }

  // ── A sent reminder: [✅ Listo] [⏰ +1h] [📅 Mañana] — no draft involved ──
  const rm = data.match(/^r:([0-9a-f-]{36}):(ok|1h|man)$/)
  if (rm) {
    try {
      // Fase 15: la respuesta se escribe EN el mismo mensaje de la alarma ("⏰ Pospuesta → …"),
      // en vez de mandar otro: un aviso es un mensaje, no dos.
      const texto = await responderRecordatorio(chatId, rm[1], rm[2] as RespuestaRecordatorio)
      const editado = messageId ? await editMessageText(chatId, messageId, texto) : false
      if (editado) await guardarTurno(chatId, 'assistant', texto)
      else {
        await quitarBotones()
        await reply(chatId, texto)
      }
    } catch (err) {
      console.error('[bot] callback recordatorio error:', err)
      await reply(chatId, ERROR_GENERICO)
    }
    return
  }

  // ── Fase 6: a mail alert's buttons [Para Chelsea] [Lo hago yo] [Tarea] [Archivar] — no draft involved ──
  const mm = data.match(/^m:([0-9a-f-]{36}):(ch|yo|ta|ar)$/)
  if (mm) {
    const accion = accionDeBoton(mm[2])
    if (!accion) return
    try {
      const d = await decidirCorreo(mm[1], accion, { desdeBoton: true })
      // The alert itself is rewritten by decidirCorreo; a tap elsewhere (old message) just loses its buttons.
      if (Number(d.correo.telegram_message_id) !== messageId) await quitarBotones()
      await reply(chatId, d.texto)
    } catch (err) {
      console.error(`[bot] callback correo error: ${mensajeError(err)}`)
      await reply(chatId, `⚠️ No pude: ${motivoParaUsuario(err)}`)
    }
    return
  }

  // ── Ajuste 6-2: [📋 Correos de <cuenta>] under an alert → the account's whole pending list ──
  const ml = data.match(/^ml:([0-9a-f-]{36})$/)
  if (ml) {
    try {
      await enviarListaCorreos(chatId, await cuentaPorId(ml[1]))
    } catch (err) {
      console.error(`[bot] callback lista correos: ${mensajeError(err)}`)
      await reply(chatId, ERROR_GENERICO)
    }
    return
  }

  // "e:<nonce>:<company_id>" | "p:<nonce>:<priority>" | "t:<nonce>:<task_id>" | "y:<nonce>:1|0"
  // fase 4: "k:<nonce>:1|0" (plan) | "h:<nonce>:09|12|15|18" (alarm hour) | "q:<nonce>:tarea|orden|alarma"
  // fase 7: "s:<nonce>:<valor>" (suggestion) | "o:<nonce>:<valor>" (organízame)
  // ajuste 7-G: "c:<nonce>:<n>" (an ambiguous correction of the plan) · 9c-1: "a:<nonce>:<cuenta_id>" (which mailbox)
  const m = data.match(/^([eptykhqsoca]):([0-9a-f]{8}):(.+)$/)
  if (!m) return
  const [, kind, nonce, value] = m
  await guardarTurno(chatId, 'user', `[botón: ${value}]`, { boton: value })

  try {
    await quitarBotones()
    const borrador = await borradorVigente(chatId)
    if (!borrador || nonceDe(borrador.id) !== nonce) {
      await reply(chatId, 'Ese borrador ya expiró (10 min). Mándamelo otra vez.')
      return
    }
    const companies = await cargarEmpresas()
    const parsed = borrador.parsed

    // ── "listo paypal" etc. with several matches: the chosen task ──
    if (parsed.tipo === 'accion') {
      if (kind !== 't' || !parsed.candidatos.includes(value)) return
      const r = await conIds(parsed.params, [value], nonce)
      if (r.confirmar && r.confirmar.length > 0) {
        // borra: one more step — the same draft now waits for the yes/no.
        await actualizarBorrador(borrador.id, { tipo: 'confirmar', params: parsed.params, ids: r.confirmar })
      } else {
        await borrarBorrador(borrador.id)
      }
      await reply(chatId, r.text, r.replyMarkup)
      return
    }

    // ── Ajuste 9c-1: "correos de X" → which mailbox ──
    if (parsed.tipo === 'cuenta_correo') {
      if (kind !== 'a' || !parsed.cuenta_ids.includes(value)) return
      await borrarBorrador(borrador.id)
      await enviarListaCorreos(chatId, await cuentaPorId(value), { importante: parsed.importante })
      return
    }

    // ── [Sí, borrar] [No] ──
    if (parsed.tipo === 'confirmar') {
      if (kind !== 'y') return
      await borrarBorrador(borrador.id)
      if (value !== '1') {
        await reply(chatId, 'Ok, no borré nada.')
        return
      }
      await reply(chatId, await ejecutarAccion(parsed.params, parsed.ids))
      return
    }

    // ── Fase 7-B: a suggestion's buttons ──
    if (parsed.tipo === 'sugerencia') {
      if (kind !== 's') return
      const cfg: AsistenteConfig = await cargarConfig()
      // The draft stays alive for "pasa todo" (it needs the nonce); the rest are done.
      if (parsed.clase !== 'todo_manana') await borrarBorrador(borrador.id)
      const texto = await resolverSugerencia(chatId, cfg, parsed, value, nonce)
      if (parsed.clase === 'todo_manana') await borrarBorrador(borrador.id)
      await reply(chatId, texto)
      return
    }

    // ── Fase 7-C: organízame, one item at a time ──
    if (parsed.tipo === 'organizar') {
      if (kind !== 'o') return
      const cfg = await cargarConfig()
      const r = await responderOrganizar(parsed, value as RespuestaOrganizar, cfg)
      if (r.terminado) {
        await borrarBorrador(borrador.id)
        await reply(chatId, joinLines(r.hecho, resumenOrganizar(r.draft, cfg)))
        await sugerir(chatId, trasOrganizar())
        return
      }
      await actualizarBorrador(borrador.id, r.draft)
      await reply(chatId, joinLines(r.hecho, r.siguiente), tecladoOrganizar(nonce))
      return
    }

    // ── Ajuste 7-G: an ambiguous correction, answered by button ──
    if (parsed.tipo === 'plan_duda') {
      if (kind !== 'c') return
      const op = parsed.opciones[Number(value)]
      if (!op) return
      const hecho = op.ejecutar ? await ejecutarUna(chatId, op.ejecutar) : null
      await responderCorreccion(chatId, { id: borrador.id, nonce, acciones: parsed.acciones }, op.resultado, hecho)
      return
    }

    // ── Fase 4: [✅ Hacer todo] [✏️ No, corrijo] ──
    if (parsed.tipo === 'plan') {
      if (kind !== 'k') return
      if (value !== '1') {
        // The plan keeps waiting: the next message corrects it.
        await reply(chatId, COMO_CORREGIR)
        return
      }
      await borrarBorrador(borrador.id)
      await reply(chatId, htmlSeguro(await ejecutarPlan(chatId, parsed.acciones)), undefined, true)
      const tocadas = parsed.acciones.filter((a) => a.tarea && !a.error).map((a) => ({ id: a.tarea!.id, text: a.tarea!.text }))
      if (tocadas.length > 0) await guardarTurno(chatId, 'assistant', `[plan] ${tocadas.length} tareas`, { tareas: tocadas })
      return
    }

    // ── Fase 4: one interpreted action, several title matches ──
    if (parsed.tipo === 'elegir') {
      if (kind !== 't' || !parsed.candidatos.includes(value)) return
      await borrarBorrador(borrador.id)
      const elegida = parsed.accion.candidatos?.find((t) => t.id === value)
      if (!elegida) return
      if (parsed.accion.tipo === 'borrar') {
        // Chosen, but still a delete: ask [Sí, borrar] [No] on a fresh draft.
        const params: AccionParams = { accion: 'borra' }
        await responderAccion(chatId, borrador.texto, params, (n) => conIds(params, [elegida.id], n), null)
        return
      }
      const accion: AccionResuelta = { ...parsed.accion, tarea: elegida, candidatos: undefined, error: undefined }
      await reply(chatId, htmlSeguro(await ejecutarUna(chatId, accion)), undefined, true)
      return
    }

    // ── Fase 4: "alarma …" without an hour ──
    if (parsed.tipo === 'alarma_hora') {
      if (kind !== 'h' || !(HORAS_BOTONES as readonly string[]).includes(value)) return
      await borrarBorrador(borrador.id)
      const cuando = instanteDe({ fecha: parsed.fecha, hora: `${value}:00` })!
      // Fase 15: ya tiene hora → a su calendario (si Calendar falla, por aquí y diciendo por qué).
      await reply(chatId, htmlSeguro(await crearAviso(chatId, { texto: parsed.texto, dispara_en: cuando, repetir: parsed.repetir ?? null })), undefined, true)
      return
    }

    // ── Fase 5-B: "ponla en calendar" on a task without an hour ──
    if (parsed.tipo === 'calendar_hora') {
      if (kind !== 'h') return
      const dia = value === 'dia'
      if (!dia && !(HORAS_BOTONES as readonly string[]).includes(value)) return
      await borrarBorrador(borrador.id)
      const r = await agregarACalendar(parsed.task_id, dia ? { todoElDia: true } : { hora: `${value}:00` })
      await reply(chatId, r.confirmacion ?? r.aviso ?? '📅 sin cambios')
      return
    }

    // ── Fase 4: "No te entendí" → [Tarea nueva] [Orden] [Alarma] ──
    if (parsed.tipo === 'aclarar') {
      if (kind !== 'q') return
      await borrarBorrador(borrador.id)
      const texto = parsed.texto
      const clasico = parseMensaje(texto, companies, cancunYmd())
      if (value === 'tarea') {
        const tarea = clasico.kind === 'edicion' ? clasico.fallback : clasico.kind === 'tarea' ? clasico.tarea : null
        if (!tarea || !tarea.text) {
          await reply(chatId, 'Mándame la tarea otra vez, por ejemplo: urgente IM llamar a Juan mañana')
          return
        }
        await guardarOPreguntar(chatId, texto, tarea, null)
        return
      }
      await handleLibre(chatId, texto, clasico, null, value === 'alarma' ? PISTA_ALARMA : PISTA_ORDEN)
      return
    }

    // ── "nota: …" without a company: the chosen company ──
    if (parsed.tipo === 'nota') {
      if (kind !== 'e') return
      const c = companies.find((x) => x.id === value)
      if (!c) {
        await reply(chatId, 'Esa empresa ya no existe. Mándame la nota otra vez.')
        return
      }
      await borrarBorrador(borrador.id)
      await reply(chatId, await ejecutarNota({ ...parsed.nota, company_id: c.id, company_name: c.name.trim() }))
      return
    }

    // ── A task missing company and/or priority ──
    if (kind !== 'e' && kind !== 'p') return
    const tarea: TareaParsed = { ...parsed }
    if (kind === 'e') {
      const c = companies.find((x) => x.id === value)
      if (!c) {
        await reply(chatId, 'Esa empresa ya no existe. Mándame la tarea otra vez.')
        return
      }
      tarea.company_id = c.id
      tarea.company_name = c.name.trim()
    } else {
      if (!['urgente', 'normal', 'cuando'].includes(value)) return
      tarea.priority = value as Priority
      if (value === 'urgente') tarea.importante = true
    }

    const falta = faltantes(tarea)
    if (falta.length > 0) {
      await actualizarBorrador(borrador.id, tarea)
      const q = pregunta(falta[0], nonce, companies)
      await reply(chatId, q.text, q.replyMarkup)
      return
    }
    await borrarBorrador(borrador.id)
    await guardarYConfirmar(chatId, tarea, null)
  } catch (err) {
    console.error('[bot] callback error:', err)
    await reply(chatId, ERROR_GENERICO)
  }
}
