// Parser tests, no database: `npm run pruebas`. Each case is a message as
// Gabby types it and what the bot must read. Exits 1 on the first group of
// failures, so it can gate a commit.
//
// Ajuste 9c-1: the four messages seen in production (mail asked in plain
// words, the mailbox typed as an answer, the correction) are here so they
// never regress.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'x'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'x'
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'pruebas-loader.mjs')).href)

const { parseMensaje } = await import('@/lib/parser')
const { clasificarPregunta } = await import('@/lib/asistente/preguntas')
const { fraseDeBoton } = await import('@/lib/asistente/menu')
const { leerRelectura } = await import('@/lib/asistente/relectura')
const { elegirCuentas } = await import('@/lib/correo/listas')

const companies = [{ id: '1', name: 'IM' }, { id: '2', name: 'PD' }, { id: '3', name: 'DATAVIA' }, { id: '4', name: 'Personal' }, { id: '5', name: 'Chelsea' }]
const today = '2026-11-04'
const cuentas = [
  { id: 'a', nombre: 'IM Chelsea', duena: 'Chelsea', conexion: { email: 'chelsea@im.com' } },
  { id: 'b', nombre: 'IM Gabby', duena: 'Gabby', conexion: { email: 'gabby@im.com' } },
  { id: 'c', nombre: 'PD Gabby', duena: 'Gabby', conexion: { email: 'gabby@pd.mx' } },
]

let fallos = 0
function ok(nombre, cond, detalle) {
  if (cond) return
  fallos += 1
  console.error(`✗ ${nombre}${detalle ? `\n    ${detalle}` : ''}`)
}
function parse(t) {
  return parseMensaje(t, companies, today)
}

// ── Ajuste 9c-1: los cuatro casos de producción ──
{
  const p = parse('dame una lista de lo más importante de correos de Chelsea')
  ok('9c-1 #1 es correos', p.kind === 'correos', JSON.stringify(p))
  ok('9c-1 #1 cuenta chelsea', p.kind === 'correos' && p.cuenta === 'chelsea', JSON.stringify(p))
  ok('9c-1 #1 importante', p.kind === 'correos' && p.importante === true, JSON.stringify(p))
  ok('9c-1 #1 buzón IM Chelsea', p.kind === 'correos' && elegirCuentas(p.cuenta, cuentas).map((c) => c.nombre).join() === 'IM Chelsea')
}
{
  const p = parse('los correos de chelsea, una lista por favor')
  ok('9c-1 #2 es correos', p.kind === 'correos' && p.cuenta === 'chelsea' && !p.importante, JSON.stringify(p))
}
{
  // "IM Chelsea" typed as the answer to "¿cuál cuenta?" → exactly that mailbox, never the Chelsea company.
  const hits = elegirCuentas('IM Chelsea', cuentas)
  ok('9c-1 #3 "IM Chelsea" → una cuenta', hits.length === 1 && hits[0].id === 'a', JSON.stringify(hits.map((c) => c.nombre)))
  ok('9c-1 #3 "sí" no es relectura', leerRelectura('sí') === null)
}
{
  const r = leerRelectura('eso no son correos, son tareas')
  ok('9c-1 #4 "no son correos, son tareas" → tareas', r?.lectura === 'tareas', JSON.stringify(r))
  const r2 = leerRelectura('no, me refería a los correos de PD')
  ok('9c-1 #4 "me refería a los correos de PD" → correos + resto', r2?.lectura === 'correos' && r2.resto === 'los correos de pd', JSON.stringify(r2))
  const r3 = leerRelectura('no eran tareas, eran los correos de chelsea')
  ok('9c-1 #4 "eran los correos" → correos', r3?.lectura === 'correos', JSON.stringify(r3))
  ok('9c-1 #4 un "no" solo no es relectura', leerRelectura('no') === null)
  ok('9c-1 #4 "no se va a hacer" no es relectura', leerRelectura('9 cancelar, no se va a hacer') === null)
}

// ── Más formas de pedir correos (regla 1) y lo que NO lo es (regla 2) ──
const correos = [
  ['correos', null, false], ['mis correos', null, false], ['correos de Chelsea', 'chelsea', false], ['lista de correos', null, false],
  ['¿qué correos tengo pendientes?', null, false], ['mi correo de IM', 'im', false], ['qué necesita respuesta en el correo de PD', 'pd', true],
  ['mándame los mails urgentes de IM Gabby', 'im gabby', true], ['qué hay en el buzón de Chelsea', 'chelsea', false], ['correos de la cuenta de IM Chelsea', 'im chelsea', false],
  ['¿qué llegó al correo hoy?', null, false], ['los correos importantes', null, true],
]
for (const [t, cuenta, importante] of correos) {
  const p = parse(t)
  ok(`correos: ${t}`, p.kind === 'correos' && p.cuenta === cuenta && p.importante === importante, JSON.stringify(p))
}
ok('mi correo de IM → IM Gabby (mío)', elegirCuentas('im', cuentas, { mio: true, persona: 'Gabby' }).map((c) => c.nombre).join() === 'IM Gabby')
ok('"pd" → PD Gabby', elegirCuentas('pd', cuentas).map((c) => c.nombre).join() === 'PD Gabby')
ok('"im" sin mío → dos (botones)', elegirCuentas('im', cuentas).length === 2)
ok('"chelsea" → IM Chelsea', elegirCuentas('chelsea', cuentas).map((c) => c.nombre).join() === 'IM Chelsea')
const noCorreos = [
  ['el correo de Andrew lo hago yo', ['tarea', 'edicion']], ['archiva el correo de zoom', ['tarea', 'edicion']], ['nota en paypal: ya mandé el correo', ['nota_tarea']],
  ['mañana revisar correo de Juan', ['tarea']], ['urgente IM contestar el correo de TOTT', ['tarea']], ['alarma mañana 9am revisar correos', ['tarea', 'edicion']],
  ['pendientes de Chelsea', ['lista']], ['qué sigue de Chelsea', ['que_sigue']], ['cómo va Chelsea', ['pregunta']],
]
for (const [t, kinds] of noCorreos) {
  const p = parse(t)
  ok(`no es lista de correos: ${t}`, p.kind !== 'correos' && kinds.includes(p.kind), JSON.stringify(p))
}

// ── Fase 9c: menú, tablero, preguntas naturales ──
const menu = [['📋 Hoy', 'pregunta'], ['📅 Mañana', 'pregunta'], ['⏳ Esperando', 'esperando'], ['📧 Correos', 'correos'], ['🎯 ¿Qué sigue?', 'que_sigue'], ['🖥 Tablero', 'tablero']]
for (const [t, kind] of menu) ok(`menú: ${t}`, fraseDeBoton(t) !== null && parse(t).kind === kind, parse(t).kind)
for (const t of ['/menu', 'menú', 'dame el menú']) ok(`menu: ${t}`, parse(t).kind === 'menu')
for (const t of ['/ocultar', 'quita el menú']) ok(`ocultar: ${t}`, parse(t).kind === 'ocultar')
for (const t of ['mándame el tablero', 'foto del tablero', 'tablero', 'cómo se ve el tablero', '/tablero']) ok(`tablero: ${t}`, parse(t).kind === 'tablero', parse(t).kind)
const preguntas = [
  ['¿qué me queda pendiente?', 'pendiente'], ['¿qué tengo hoy?', 'hoy'], ['qué tengo hoy', 'hoy'], ['cómo viene el día', 'hoy'],
  ['¿qué tengo estancado?', 'estancado'], ['qué se me quedó atorado', 'estancado'], ['¿cómo va IM?', 'empresa'], ['cómo vamos con PD', 'empresa'],
  ['a quién estoy esperando', 'esperando'], ['¿qué hay esta semana?', 'semana'], ['cómo viene la semana', 'semana'], ['¿qué tengo mañana?', 'manana'],
]
for (const [t, tipo] of preguntas) {
  const p = parse(t)
  ok(`pregunta natural: ${t}`, p.kind === 'pregunta' && clasificarPregunta(p.texto, companies)?.tipo === tipo, `${p.kind} ${JSON.stringify(clasificarPregunta(t, companies))}`)
}
for (const t of ['qué sigue', 'qué vence esta semana']) ok(`sigue: ${t}`, parse(t).kind === 'que_sigue')
ok('/hoy = lista', parse('/hoy').kind === 'lista')
ok('listo 3', parse('listo 3').kind === 'accion')
ok('¿qué cerré ayer? → pregunta libre', parse('¿qué cerré ayer?').kind === 'pregunta' && clasificarPregunta('¿qué cerré ayer?', companies) === null)

// ── Ajuste 9c-2: the summary in lines, the mail message in the account's language ──
{
  const { panoramaDe, resumenMananaFijo, resumenTardeFijo, narrar, nombreCorto } = await import('@/lib/asistente/narracion')
  const { resumenCorreos, pieDecidir } = await import('@/lib/correo/listas')
  const { textos } = await import('@/lib/correo/idioma')
  const co = { im: { name: 'IM', color: 'teal' }, pd: { name: 'PD', color: 'purple' }, ch: { name: 'Chelsea', color: 'pink' } }
  const comp = [{ id: 'im', ...co.im }, { id: 'pd', ...co.pd }, { id: 'ch', ...co.ch }]
  let n = 0
  const t = (text, cid, extra = {}) => ({ id: `t${++n}`, text, company_id: cid, company: cid ? co[cid] : null, priority: 'normal', importante: false, due_date: null, due_time: null, done: false, notes: null, link_url: null, link_label: null, start_date: null, created_at: '2026-10-01T12:00:00Z', estado: 'abierta', esperando_a: null, ...extra })
  const tasks = [
    t('Shift Google Ads campaign review', 'im', { due_date: '2026-10-26' }), t('TechFin proposal', 'pd', { due_date: '2026-11-01' }),
    t('llamar a Juan', 'pd', { due_date: today, due_time: '09:00:00' }), t('revisar contrato', 'pd', { due_date: today }), t('pagar luz', null, { due_date: today }), t('firmar NDA', 'im', { due_date: today, due_time: '15:00:00' }),
    t('mandar factura', 'im', { priority: 'urgente', importante: true }), t('probar Notion', 'im', { priority: 'urgente' }), t('cotizar hosting', 'pd', { priority: 'urgente' }),
    t('correos de Chelsea', 'im', { due_date: '2026-11-05' }),
    t('Chelsea onboarding', 'ch', { estado: 'esperando', esperando_a: 'PTHO' }),
  ]
  const mail = (id, de, asunto, urgencia, tipo, estado = 'nuevo') => ({ id, cuenta_id: 'k1', cuenta: 'IM Chelsea', de_nombre: de, de_email: `${de.toLowerCase()}@x.com`, asunto, resumen: null, recibido_en: '2026-11-01T10:00:00Z', urgencia, tipo, estado, alertado: false, gmail_thread_id: null, vip: false, respondido_en: null })
  const correos = [
    mail('c1', 'TechFin', 'Contrato de servicios — revisión', 'alta', 'necesita_respuesta'), mail('c2', 'Andrew', 'Landing page changes', 'alta', 'pedido_de_tarea'), mail('c3', 'Hope', 'Proposal', 'alta', 'necesita_respuesta'),
    mail('c4', 'Lion', 'Invoice', 'alta', 'necesita_respuesta'), mail('c5', 'Zed', 'Q4 plan', 'alta', 'fyi'), mail('c6', 'Mia', 'Can we talk?', 'media', 'necesita_respuesta'),
    ...Array.from({ length: 3 }, (_, i) => mail(`r${i}`, 'Zoom', 'Recording', 'baja', 'notificacion')),
  ]
  const p = panoramaDe(tasks, comp, [], correos, [{ id: 'k1', nombre: 'IM Chelsea', company_id: 'im' }], today)
  const cfg = { nombre_persona: 'Gabby', nombre_bot: 'Asistente', tono: 'informal', sugerencias: true }

  // "/hoy": the morning summary — at most 8 lines, no quotes, no full titles, one 👉 line.
  const m = resumenMananaFijo(cfg, p)
  ok('9c-2 /hoy ≤ 8 líneas', m.length <= 8, `${m.length}: ${JSON.stringify(m)}`)
  ok('9c-2 /hoy sin comillas', m.every((l) => !/[«»"]/.test(l)), JSON.stringify(m))
  ok('9c-2 /hoy termina con 👉', m[m.length - 1].startsWith('👉'), m[m.length - 1])
  ok('9c-2 /hoy una línea por horizonte', ['🔺', '🔸', '✴️', '📅', '⏳', '📧'].every((e) => m.filter((l) => l.startsWith(e)).length === 1), JSON.stringify(m))
  ok('9c-2 /hoy nombre corto, no título completo', m.some((l) => l.includes('Shift Google Ads')) && !m.some((l) => l.includes('campaign review')), JSON.stringify(m))
  ok('9c-2 /hoy "la primera a las 9"', m.some((l) => l.startsWith('🔸') && l.includes('a las 9 am')), JSON.stringify(m))
  const tarde = resumenTardeFijo(cfg, p, [t('cerrada', 'im')])
  ok('9c-2 cierre ≤ 8 líneas y 👉', tarde.length <= 8 && tarde[tarde.length - 1].startsWith('👉'), JSON.stringify(tarde))
  for (const q of [{ tipo: 'hoy' }, { tipo: 'pendiente' }, { tipo: 'manana' }, { tipo: 'estancado' }, { tipo: 'empresa', nombre: 'IM' }, { tipo: 'esperando' }, { tipo: 'semana' }]) {
    const r = narrar(q, p, cfg)
    const resumen = r.texto.split('\n\n')[0].split('\n')
    ok(`9c-2 ${q.tipo}: resumen ≤ 8 líneas con 👉`, resumen.length <= 8 && resumen.some((l) => l.startsWith('👉')), JSON.stringify(resumen))
    ok(`9c-2 ${q.tipo}: resumen sin comillas`, resumen.every((l) => !/[«»"]/.test(l) || /«(?:la \d|pasa|alarma|todo lo pendiente|qué sigue|la de TOTT|paypal)/.test(l)), JSON.stringify(resumen))
  }
  ok('nombreCorto', nombreCorto('Shift Google Ads campaign review for Q4') === 'Shift Google Ads' && nombreCorto('TechFin') === 'TechFin')

  // "lo importante de Chelsea" (account in English): zero Spanish in the fixed text; subjects as they arrived.
  const importantes = correos.filter((c) => c.urgencia === 'alta' || c.tipo === 'necesita_respuesta' || c.tipo === 'pedido_de_tarea')
  const en = resumenCorreos(importantes, { importante: true, fuera: correos.length - importantes.length, idioma: 'en', now: new Date('2026-11-04T12:00:00Z') })
  const textoEn = [...en, pieDecidir(1, 'en'), textos('en').grupos.alta, textos('en').grupos.respuesta, textos('en').loImportante, textos('en').verTodos(61, 'correos de IM Chelsea')].join('\n')
  const palabrasEs = /\b(que|importan|urgentes?|pide|piden|respuesta|fuera|sin prisa|empezamos|para decidir|lista completa|correo|correos pendientes|alta|necesitan|resto|lo importante|viejo|lleva|días|ya con|solo para|ver|todos|di)\b/i
  const sinComandos = textoEn.replace(/<code>[^<]*<\/code>/g, '').replace(/<a [^>]*>[^<]*<\/a>/g, '').replace(/«[^»]*»/g, '')
  ok('9c-2 cuenta en: cero español en el texto fijo', !palabrasEs.test(sinComandos), sinComandos)
  ok('9c-2 cuenta en: "6 that matter: 5 urgent, 1 needs a reply. 3 low-priority left out."', en[0] === '6 that matter: 5 urgent, 1 needs a reply. 3 low-priority left out. Oldest is 3 days old (TechFin).', en[0])
  ok('9c-2 cuenta en: 👉 Start with #1 (TechFin)?', en[1] === '👉 Start with #1 (TechFin)?', en[1])
  const es = resumenCorreos(importantes, { importante: true, fuera: 3, idioma: 'es', now: new Date('2026-11-04T12:00:00Z') })
  ok('9c-2 cuenta es: resumen en español', /que importan/.test(es[0]) && es[1].startsWith('👉 ¿Empezamos por el 1'), JSON.stringify(es))
  ok('9c-2 resumen de correos sin asuntos', !textoEn.includes('Contrato de servicios') && !es.join(' ').includes('Contrato de servicios'))
}

// ── Fase 12 (fallo #1): the classifier's summary and reason come out in the account's language ──
{
  const { systemPromptClasificador, pareceEspanol, razonRegla } = await import('@/lib/correo/clasificar')
  const en = systemPromptClasificador('en')
  const es = systemPromptClasificador('es')
  ok('fase 12: prompt en → RESUMEN y RAZON en INGLÉS', /RESUMEN: UNA línea en INGLÉS/.test(en) && /RAZON: una frase corta en INGLÉS/.test(en) && !/en español/.test(en), en.slice(0, 400))
  ok('fase 12: prompt en → la regla de idioma va primero', en.split('\n')[1].startsWith('IDIOMA:'), en.split('\n')[1])
  ok('fase 12: prompt es → RESUMEN en español', /RESUMEN: UNA línea en español/.test(es) && !/IDIOMA:/.test(es))
  ok('fase 12: pareceEspanol detecta la alerta real', pareceEspanol('Andrew confirma que el chef profile está listo y que Chelsea enviará pronto la imagen redimensionada.'))
  ok('fase 12: pareceEspanol deja pasar inglés', !pareceEspanol('Andrew confirms the chef profile is ready and Chelsea will send the resized image soon.'))
  ok('fase 12: razón de regla en inglés', razonRegla('alerta', 'en') === 'alert' && razonRegla('vip', 'en') === 'VIP rule' && razonRegla('alerta', 'es') === 'alerta')
}

// ── Fase 12b: free / repeating Calendar events, Google errors explained ──
{
  const { validarAcciones, repeticion } = await import('@/lib/asistente/interprete')
  const { rrule, describirRepeticion, primeraFechaEn, diaSemanaDe } = await import('@/lib/google/calendar')
  const { explicarErrorGoogle } = await import('@/lib/google/oauth')
  const acc = validarAcciones({ acciones: [
    { tipo: 'evento', titulo: 'Love on Hire', fecha: '2026-11-12', hora: '14:00', nota: 'GL', repetir: { cada: 'semana', dias: ['JU'], hasta: '2026-12-01' } },
    { tipo: 'evento', titulo: 'Under Her Rules', fecha: '2026-11-14', hora: '14:00', repetir: { cada: 'semana', dias: ['sábado'], veces: 8 } },
    { tipo: 'evento', titulo: 'Love Me to Hurt Me', fecha: '2026-11-13', hora: '14:00', repetir: { cada: 'semana', dias: ['VI'] } },
    { tipo: 'evento', titulo: 'sin fecha' },
  ] })
  ok('12b: tres eventos válidos + uno desconocido', acc.length === 4 && acc.filter((a) => a.tipo === 'evento').length === 3 && acc[3].tipo === 'desconocido', JSON.stringify(acc))
  ok('12b: hasta se conserva', acc[0].tipo === 'evento' && acc[0].repetir?.hasta === '2026-12-01' && acc[0].repetir?.dias?.[0] === 'JU', JSON.stringify(acc[0]))
  ok('12b: "sábado" → SA, veces 8', acc[1].tipo === 'evento' && acc[1].repetir?.dias?.[0] === 'SA' && acc[1].repetir?.veces === 8, JSON.stringify(acc[1]))
  ok('12b: sin fin → ni hasta ni veces', acc[2].tipo === 'evento' && !acc[2].repetir?.hasta && !acc[2].repetir?.veces, JSON.stringify(acc[2]))
  ok('12b: repeticion rechaza basura', repeticion('x') === undefined && repeticion({ cada: 'nunca' }) === undefined)
  ok('12b: rrule semanal hasta', rrule({ cada: 'semana', dias: ['JU'], hasta: '2026-12-01' }, '2026-11-12') === 'RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261202T045959Z', rrule({ cada: 'semana', dias: ['JU'], hasta: '2026-12-01' }, '2026-11-12'))
  ok('12b: rrule 8 veces', rrule({ cada: 'semana', dias: ['SA'], veces: 8 }, '2026-11-14') === 'RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=8')
  ok('12b: rrule sin fin', rrule({ cada: 'semana', dias: ['VI'] }, '2026-11-13') === 'RRULE:FREQ=WEEKLY;BYDAY=FR')
  ok('12b: diaSemanaDe', diaSemanaDe('2026-11-12') === 'JU' && diaSemanaDe('2026-11-14') === 'SA')
  ok('12b: primeraFechaEn corrige un jueves dicho como miércoles', primeraFechaEn('2026-11-11', ['JU']) === '2026-11-12')
  ok('12b: describirRepeticion', describirRepeticion({ cada: 'semana', dias: ['JU'], hasta: '2026-12-01' }, '2026-11-12') === 'los jueves hasta el 1 de dic' && describirRepeticion({ cada: 'semana', dias: ['SA'], veces: 8 }, '2026-11-14') === 'los sábados, 8 veces' && describirRepeticion({ cada: 'semana', dias: ['VI'] }, '2026-11-13') === 'los viernes, hasta que avises', describirRepeticion({ cada: 'semana', dias: ['JU'], hasta: '2026-12-01' }, '2026-11-12'))
  const u = explicarErrorGoogle(new Error('Unauthorized'), 'gabrielarangel169@gmail.com')
  ok('12b: "Unauthorized" explicado con reconectar', u.reconectar && /otra configuración|Reconecta/.test(u.texto) && !/unauthorized/i.test(u.texto), u.texto)
  const api = explicarErrorGoogle(new Error('Google Calendar API has not been used in project 158862810174 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=158862810174 then retry.'))
  ok('14a: API apagada = activar, no reconectar', !api.reconectar && /no está activada/.test(api.texto) && api.url?.includes('calendar-json.googleapis.com'), `${api.texto} · ${api.url}`)
  ok('14a: el error raro sale corto y sin URL', !/https?:/.test(explicarErrorGoogle(new Error('Something weird happened at https://x.y/z and more text')).texto))
  const g = explicarErrorGoogle(new Error('invalid_grant'))
  ok('12b: invalid_grant = caducó', g.reconectar && /caducó/.test(g.texto), g.texto)
}

// ── Ajuste 14b: "ponme en el calendario X" — ¿tarea que existe o evento nuevo? ──
{
  const { pareceEventoNuevo } = await import('@/lib/parser')
  ok('14b: con hora/repetición/fecha es un evento nuevo',
    pareceEventoNuevo('Love on Hire los jueves a las 2 pm hasta el 1 de diciembre, nota GL') &&
    pareceEventoNuevo('reunion con Angel el 15 de diciembre') &&
    pareceEventoNuevo('gym todos los lunes') &&
    pareceEventoNuevo('clase 8 veces') &&
    pareceEventoNuevo('llamada de 2 horas'))
  ok('14b: nombrar una tarea sigue siendo la tarea',
    !pareceEventoNuevo('la de TOTT') &&
    !pareceEventoNuevo('tarea de paypal statements') &&
    !pareceEventoNuevo('lo de Chelsea'))
  ok('14b: el atajo ya no se traga el evento repetido',
    parse('ponme en el calendario Love on Hire los jueves a las 2 pm hasta el 1 de diciembre, nota GL').kind !== 'calendar')
  ok('14b: y sigue funcionando el de siempre',
    parse('pon en calendar la de TOTT').kind === 'calendar')
}

// ── Fase 15: las alarmas con hora van a Google Calendar ─────────────────
{
  const { eventoDeAviso, confirmacionEnCalendar, confirmacionEnTelegram } = await import('@/lib/asistente/avisos')
  const { cuerpoEventoLibre } = await import('@/lib/google/calendar')
  const { leerQuitarVarias } = await import('@/lib/asistente/recordatorios')
  const { htmlSeguro } = await import('@/lib/asistente/html')
  const { validarAcciones } = await import('@/lib/asistente/interprete')

  // 10:00 am Cancún = 15:00 UTC
  const ev = eventoDeAviso({ texto: 'pago Health Insurance PD', dispara_en: '2026-11-10T15:00:00.000Z', repetir: { cada: 'mes' } })
  ok('15: la alarma se vuelve evento a su hora, con ⏰ y sonando al minuto 0',
    ev.titulo === '⏰ pago Health Insurance PD' && ev.fecha === '2026-11-10' && ev.hora === '10:00' && ev.aviso_min === 0 && ev.duracion_min === 15, JSON.stringify(ev))
  const cuerpo = cuerpoEventoLibre(ev)
  ok('15: cada mes y popup a la hora exacta',
    JSON.stringify(cuerpo.recurrence) === '["RRULE:FREQ=MONTHLY"]' && cuerpo.reminders.overrides[0].minutes === 0, JSON.stringify(cuerpo))
  ok('15: un evento normal sigue avisando 15 min antes',
    cuerpoEventoLibre({ titulo: 'Cita', fecha: '2026-11-12', hora: '14:00' }).reminders.overrides[0].minutes === 15)
  const semanal = eventoDeAviso({ texto: 'plan de Frey', dispara_en: '2026-11-10T14:00:00.000Z', repetir: { cada: 'semana', dias: ['LU'] } })
  ok('15: una semanal arranca en su primer día', semanal.fecha === '2026-11-16', semanal.fecha)

  const conf = confirmacionEnCalendar({ texto: 'pago Gold Amex', dispara_en: '2026-11-16T15:00:00.000Z', repetir: { cada: 'mes' } }, 'https://www.google.com/calendar/event?eid=abc')
  ok('15: la confirmación dice dónde quedó y trae el enlace limpio',
    conf.startsWith('⏰ En tu calendario: «pago Gold Amex»') && conf.includes('cada mes') && conf.endsWith('<a href="https://www.google.com/calendar/event?eid=abc">abrir</a>'), conf)
  ok('15: un temporizador avisa por aquí', confirmacionEnTelegram({ texto: 'revisar el deploy', dispara_en: '2026-11-09T22:00:00.000Z' }).startsWith('⏰ Te aviso por aquí: «revisar el deploy»'))

  const acc = validarAcciones({ acciones: [
    { tipo: 'alarma', texto: 'pago Health Insurance PD', fecha: '2026-11-10', hora: '10:00', repetir: { cada: 'mes' } },
    { tipo: 'alarma', texto: 'revisar el deploy', en_minutos: 20, repetir: { cada: 'dia' } },
    { tipo: 'alarma', texto: 'llamar al banco', fecha: '2026-11-10', hora: '10:00' },
  ] })
  ok('15: el intérprete conserva la repetición (y un temporizador no se repite)',
    acc[0].repetir?.cada === 'mes' && acc[1].repetir === undefined && acc[1].en_minutos === 20 && acc[2].repetir === undefined, JSON.stringify(acc))

  ok('15: quitar varias solo en plural',
    leerQuitarVarias('todas')?.palabra === null &&
    leerQuitarVarias('todas de pago')?.palabra === 'pago' &&
    leerQuitarVarias('todas las de Amex')?.palabra === 'amex' &&
    leerQuitarVarias('de pago') === null && leerQuitarVarias('2') === null)
  ok('15: órdenes nuevas de alarmas',
    parse('pasa mis alarmas al calendario').kind === 'mudar_alarmas' &&
    parse('pasa las alarmas a Google Calendar').kind === 'mudar_alarmas' &&
    parse('quita todas las alarmas').kind === 'quitar_alarma' && parse('quita todas las alarmas').arg === 'todas' &&
    parse('quita las alarmas de pago').arg === 'todas de pago' &&
    parse('quita alarma 2').arg === '2',
    `${parse('pasa mis alarmas al calendario').kind} · ${parse('quita las alarmas de pago').arg}`)

  const { lineasConOrdenDeAlarmas } = await import('@/lib/parser')
  const tres = lineasConOrdenDeAlarmas('quita las alarmas de pago\npasa mis alarmas al calendario\nalarma: pago Health Insurance PD los días 10 y 20 de\ncada mes a las 10 am, y pago Gold Amex PD los días 16 y\n22 de cada mes a las 10 am')
  ok('15a: tres órdenes apiladas se atienden una por una (y la alarma larga no se parte)',
    tres?.length === 3 && tres[0] === 'quita las alarmas de pago' && tres[1] === 'pasa mis alarmas al calendario' && tres[2].startsWith('alarma: pago Health') && tres[2].endsWith('10 am'), JSON.stringify(tres))
  ok('15a: un mensaje normal de varias líneas no se toca', lineasConOrdenDeAlarmas('1 terminado\n9 cancelar') === null && lineasConOrdenDeAlarmas('quita las alarmas de pago') === null)
  ok('15a: una orden de alarmas ya no se traga las líneas de abajo',
    parse('quita las alarmas de pago\npasa mis alarmas al calendario').kind !== 'quitar_alarma')
  const { fusionarCorreccion } = await import('@/lib/asistente/correcciones')
  const { sinNadaQueHacer } = await import('@/lib/asistente/plan')
  const al = (texto, fecha) => ({ tipo: 'alarma', texto, fecha, hora: '10:00', repetir: { cada: 'mes' } })
  const cuatro = [al('pago Health Insurance PD', '2026-11-10'), al('pago Health Insurance PD', '2026-11-20'), al('pago Gold Amex PD', '2026-11-16'), al('pago Gold Amex PD', '2026-11-22')]
  const f1 = fusionarCorreccion([{ tipo: 'crear', titulo: 'otra cosa' }], cuatro)
  ok('15b: dos alarmas con el mismo texto y distinto día son dos, no una pisando a la otra',
    f1.tipo === 'plan' && f1.acciones.filter((a) => a.tipo === 'alarma').length === 4 && f1.agregadas.length === 4, JSON.stringify(f1.acciones?.map((a) => a.fecha)))
  const f2 = fusionarCorreccion([al('pago Gold Amex PD', '2026-11-16')], [al('pago Gold Amex PD', '2026-11-17')])
  ok('15b: corregir la alarma que el plan ya tenía sigue reemplazándola',
    f2.tipo === 'plan' && f2.acciones.length === 1 && f2.acciones[0].fecha === '2026-11-17' && f2.cambiadas.length === 1)
  ok('15b: un plan donde nada se puede hacer no es un plan',
    sinNadaQueHacer([{ tipo: 'esperar', ref: 'anterior', error: 'no sé cuál es "la anterior"' }, { tipo: 'pregunta', texto: '¿a qué alarmas te refieres?' }]) &&
    !sinNadaQueHacer([{ tipo: 'pregunta', texto: 'x' }, al('pago', '2026-11-10')]))
  const h = htmlSeguro('🎙 Entendí: «IM < PD & más»\n📆 En Calendar: «Hitv» · <a href="https://g.co/e?a=1&b=2">abrir</a> · <b>ok</b>')
  ok('15: HTML seguro — lo suyo se escapa, nuestras etiquetas se quedan',
    h.includes('IM &lt; PD &amp; más') && h.includes('<a href="https://g.co/e?a=1&amp;b=2">abrir</a>') && h.includes('<b>ok</b>'), h)
  ok('15: HTML seguro no escapa dos veces', htmlSeguro('a &amp; b &lt;c&gt;') === 'a &amp; b &lt;c&gt;')
}

// ── Fase 16: la semana en bloques + Gabita conversando ───────────────────
{
  const B = await import('@/lib/asistente/bloques')
  const { limpiarRespuesta, systemPromptConversacion } = await import('@/lib/asistente/conversar')
  const { validarAcciones } = await import('@/lib/asistente/interprete')
  const { sinNadaQueHacer } = await import('@/lib/asistente/plan')

  const blq = (o) => ({ id: o.nombre + o.dia + o.inicio, tema: '', company_id: null, palabras: [], fijas: [], toma_tareas: true, bloqueado: false, activo: true, ...o })
  const plantilla = {
    bloques: [
      blq({ dia: 2, inicio: '04:45', fin: '06:45', nombre: 'Estudio', tema: 'GHL', palabras: ['ghl', 'estudiar'] }),
      blq({ dia: 2, inicio: '07:00', fin: '07:30', nombre: 'PD diario', company_id: 'pd', fijas: ['Bancos'], toma_tareas: false }),
      blq({ dia: 2, inicio: '08:15', fin: '10:15', nombre: 'Bloque A', tema: 'IM: cierre', company_id: 'im', palabras: ['quickbooks', 'paypal'] }),
      blq({ dia: 2, inicio: '10:30', fin: '12:30', nombre: 'Bloque B', tema: 'Shift y GHL', company_id: 'im', palabras: ['shift', 'ghl'] }),
      blq({ dia: 2, inicio: '13:00', fin: '18:00', nombre: 'Bloqueado', tema: 'Niñas', toma_tareas: false, bloqueado: true }),
      blq({ dia: 2, inicio: '18:00', fin: '19:30', nombre: 'Tarde', tema: 'DATAVIA', company_id: 'dv' }),
      blq({ dia: 5, inicio: '10:30', fin: '12:30', nombre: 'Bloque B', tema: 'Colchón' }),
      blq({ dia: 5, inicio: '08:15', fin: '10:15', nombre: 'Bloque A', tema: 'PD', company_id: 'pd' }),
      blq({ dia: 1, inicio: '10:30', fin: '12:30', nombre: 'Bloque B', tema: 'GHL', company_id: 'im', palabras: ['ghl'] }),
    ],
    reglas: [
      { id: 'r1', desde: 1, hasta: 7, inicio: '10:30', tema: 'SEO/GEO del mes', rotacion: ['Shift', 'TOTT', 'PTHO', 'Urólogo', 'CPT'], fijas: ['Reporte'], activo: true },
      { id: 'r2', desde: 12, hasta: 16, inicio: '10:30', tema: 'Repaso', rotacion: ['Shift, TOTT y PTHO', 'Urólogo y CPT'], fijas: [], activo: true },
    ],
  }
  const empresas = [{ id: 'pd', name: 'PD' }, { id: 'im', name: 'IM ' }, { id: 'dv', name: 'DATAVIA' }]
  const t = (o) => ({ done: false, importante: false, estado: 'abierta', company_id: null, due_date: '2026-11-10', ...o })
  const tareas = [
    t({ id: '1', text: 'Estudiar 2 temas de GHL en la Academy', company_id: 'im' }),
    t({ id: '2', text: 'PayPal statements Mar and Apr', company_id: 'im', due_date: '2026-11-08', minutos_estimados: 60 }),
    t({ id: '3', text: 'Shift Google Ads y SEO', company_id: 'im', minutos_estimados: 150 }),
    t({ id: '4', text: 'Cargar JEV', company_id: 'dv' }),
    t({ id: '5', text: 'PTHO acceso al hosting', company_id: 'ch', estado: 'esperando' }),
    t({ id: '6', text: 'Llamar al contador', company_id: 'dv', due_date: null }),
    t({ id: '7', text: 'Aug completo en QB', company_id: 'pd', due_date: '2026-10-31' }),
  ]

  ok('16: día de la semana y duración', B.diaDeLaSemana('2026-11-10') === 2 && B.diaDeLaSemana('2026-11-15') === 0 && B.duracion(90) === '1 h 30' && B.duracion(45) === '45 min' && B.duracion(120) === '2 h' && B.minutosEntre('08:15', '10:15') === 120)

  const martes = B.bloquesDelDia(plantilla, '2026-11-10', tareas, empresas, '2026-11-10')
  const de = (n) => martes.find((b) => b.nombre === n)
  ok('16: los bloques del martes salen en orden', martes.map((b) => b.inicio).join() === '04:45,07:00,08:15,10:30,13:00,18:00', martes.map((b) => b.inicio).join())
  ok('16: cada tarea cae en el bloque de su tema',
    de('Estudio').tareas.map((x) => x.id).join() === '1' && de('Bloque A').tareas.map((x) => x.id).join() === '2' && de('Bloque B').tareas.map((x) => x.id).join() === '3' && de('Tarde').tareas.map((x) => x.id).join() === '4',
    JSON.stringify(martes.map((b) => [b.nombre, b.tareas.map((x) => x.id)])))
  ok('16: la rutina y lo bloqueado no reciben tareas', de('PD diario').tareas.length === 0 && de('Bloqueado').tareas.length === 0 && de('Bloqueado').bloqueado)
  ok('16: aviso cuando no cabe', de('Bloque B').no_cabe && de('Bloque B').carga === 150 && !de('Bloque A').no_cabe && de('Bloque A').tareas[0].vencida)
  ok('16: sin estimado cuenta media hora y se marca', de('Tarde').tareas[0].minutos === 30 && de('Tarde').tareas[0].estimado && !de('Bloque A').tareas[0].estimado)
  ok('16: lo que espera a otra persona, lo sin fecha y lo de otra empresa no entran', B.sinBloque(martes, tareas, '2026-11-10', '2026-11-10').map((x) => x.id).join() === '7', JSON.stringify(B.sinBloque(martes, tareas, '2026-11-10', '2026-11-10').map((x) => x.id)))

  const viernes = B.bloquesDelDia(plantilla, '2026-11-13', [t({ id: '8', text: 'cosa suelta', due_date: '2026-11-13' }), t({ id: '9', text: 'algo de PD', company_id: 'pd', due_date: '2026-11-13' })], empresas, '2026-11-10')
  ok('16: el colchón solo recibe lo que nadie más tomó', viernes[0].tareas.map((x) => x.id).join() === '9' && viernes[1].tareas.map((x) => x.id).join() === '', JSON.stringify(viernes.map((b) => [b.tema, b.tareas.map((x) => x.id)])))
  ok('16: un día futuro solo carga lo que vence ese día', B.tareasDelDia(tareas, '2026-11-11', '2026-11-10').length === 0)

  // Noviembre 2026 empieza en domingo: los hábiles del 1 al 7 son lun 2 … vie 6.
  ok('16: turnos por día hábil',
    B.indiceHabil('2026-11-01', 1, 7) === -1 && B.indiceHabil('2026-11-02', 1, 7) === 0 && B.indiceHabil('2026-11-06', 1, 7) === 4 && B.indiceHabil('2026-11-09', 1, 7) === -1)
  const lun2 = B.bloquesDelDia(plantilla, '2026-11-02', [t({ id: 'g', text: 'algo de ghl', company_id: 'im', due_date: '2026-11-02' })], empresas, '2026-11-02')
  ok('16: en inicio de mes el Bloque B es el cliente del día y no recibe otras tareas',
    lun2[0].tema === 'SEO/GEO del mes · hoy: Shift' && lun2[0].regla_mes && lun2[0].tareas.length === 0 && lun2[0].fijas.join() === 'Reporte', JSON.stringify(lun2[0]))
  ok('16: mitad de mes: dos días y la regla se acaba',
    B.reglaPara(plantilla.reglas, '2026-11-12', '10:30')?.turno === 'Shift, TOTT y PTHO' && B.reglaPara(plantilla.reglas, '2026-11-13', '10:30')?.turno === 'Urólogo y CPT' && B.reglaPara(plantilla.reglas, '2026-11-16', '10:30') === null)

  const txt = B.textoHoyTeToca(martes, '08:00')
  ok('16: el mensaje de la mañana dice lo que queda del día',
    txt.startsWith('🧭 <b>Hoy te toca</b>') && !txt.includes('Estudio') && !txt.includes('Niñas') && txt.includes('8:15 am Bloque A') && txt.includes('⚠️ 10:30 am Bloque B') && txt.includes('no caben en 2 h'), txt)
  ok('16: sin plantilla no hay bloque', B.textoHoyTeToca([], '08:00') === null)

  const sem = B.semanaParaPrompt(plantilla, '2026-11-10', 1, tareas, empresas, '2026-11-10')
  ok('16: la semana para Gabita trae lo libre y lo no disponible',
    sem.includes('martes 2026-11-10 (HOY):') && sem.includes('13:00–18:00 NO DISPONIBLE (Niñas)') && sem.includes('18:00–19:30 Tarde · DATAVIA') && sem.includes('libre: 1 h') && sem.includes('no recibe tareas') && sem.includes('SIN BLOQUE ese día: «Aug completo en QB»'), sem)

  const acc = validarAcciones({ acciones: [
    { tipo: 'conversar', texto: 'necesito tiempo para CPT esta semana, no sé cuándo' },
    { tipo: 'crear', titulo: 'CPT: reunir la información', fecha: '2026-11-12', minutos: 90 },
    { tipo: 'crear', titulo: 'otra', minutos: 2 },
    { tipo: 'conversar' },
  ] })
  ok('16: el intérprete distingue conversar y guarda cuánto tarda',
    acc[0].tipo === 'conversar' && acc[1].minutos === 90 && acc[2].minutos === undefined && acc[3].tipo === 'desconocido', JSON.stringify(acc))
  ok('16: conversar no es un plan vacío', !sinNadaQueHacer([{ tipo: 'conversar', texto: 'x' }, { tipo: 'pregunta', texto: 'y' }]))

  ok('16: la respuesta de Gabita sale sin markdown', limpiarRespuesta('**Propuesta**\n\n\n- jue 12 · Tarde\n# Título\n* otra') === 'Propuesta\n\n• jue 12 · Tarde\nTítulo\n• otra', JSON.stringify(limpiarRespuesta('**Propuesta**\n\n\n- jue 12 · Tarde\n# Título\n* otra')))
  const sp = systemPromptConversacion({ nombre_persona: 'Gabby', nombre_bot: 'Gabita', tono: 'informal', sugerencias: true })
  ok('16: el prompt de conversación manda proponer y respetar el horario', sp.includes('MODO CONVERSACIÓN') && sp.includes('NO DISPONIBLE') && sp.includes('¿Lo dejo así?'))
}

// ── Fase 14: segundo cerebro (documentos) ────────────────────────────────
{
  const { normalizarCategoria, montoTexto } = await import('@/lib/documentos/tipos')
  const { numero, clavesDe, parecido, limpiarPropuesta } = await import('@/lib/documentos/ficha')
  const { consultaDe, pareceDeDocumentos } = await import('@/lib/documentos/buscar')
  const { leerNotaCerebro } = await import('@/lib/documentos/entrada')
  const { cuandoVence, toca } = await import('@/lib/documentos/vencimientos')
  const { rutaPara } = await import('@/lib/documentos/almacen')
  const { validarAcciones } = await import('@/lib/asistente/interprete')

  ok('14: categorías del modelo caen en las ocho',
    normalizarCategoria('Seguros') === 'Seguros' &&
    normalizarCategoria('seguro de auto') === 'Seguros' &&
    normalizarCategoria('insurance') === 'Seguros' &&
    normalizarCategoria('recibo de luz') === 'Facturas y recibos' &&
    normalizarCategoria('lease') === 'Alquiler' &&
    normalizarCategoria('pasaporte') === 'Documentos e IDs' &&
    normalizarCategoria('cualquier cosa') === 'Otros')

  ok('14: montos con cualquier formato',
    numero('1,250.00') === 1250 &&
    numero('$18.400,50') === 18400.5 &&
    numero(' MXN 7 500 ') === 7500 &&
    numero('sin monto') === null &&
    numero(null) === null,
    `${numero('1,250.00')} · ${numero('$18.400,50')} · ${numero(' MXN 7 500 ')}`)

  ok('14: montoTexto', montoTexto(18400.5, 'MXN') === '$18,400.50 MXN' && montoTexto(null, 'MXN') === null)

  ok('14: una renovación se reconoce por el título',
    parecido('Póliza del carro GNP 2027', 'Póliza del carro GNP 2026') >= 0.5 &&
    parecido('Recibo CFE octubre', 'Póliza del carro GNP 2026') < 0.5,
    `${parecido('Póliza del carro GNP 2027', 'Póliza del carro GNP 2026')}`)
  ok('14: las palabras de relleno no cuentan', !clavesDe('contrato de la nueva poliza').includes('contrato') && clavesDe('Seguro GNP carro').length === 3, JSON.stringify(clavesDe('contrato de la nueva poliza')))

  ok('14: la pregunta se queda solo con lo buscable',
    consultaDe('¿con quién tengo el seguro del carro?') === 'seguro carro' &&
    consultaDe('¿cuánto pago de alquiler?') === 'alquiler',
    `«${consultaDe('¿con quién tengo el seguro del carro?')}» · «${consultaDe('¿cuánto pago de alquiler?')}»`)
  ok('14: huele a papeles', pareceDeDocumentos('¿cuándo vence mi pasaporte?') && pareceDeDocumentos('la póliza del carro') && !pareceDeDocumentos('¿qué tengo pendiente de IM?'))

  ok('14: "guarda: …" es una nota del cerebro',
    leerNotaCerebro('guarda: el seguro del carro es con GNP, se paga en marzo') === 'el seguro del carro es con GNP, se paga en marzo' &&
    leerNotaCerebro('anota en el cerebro: la renta se paga el día 5') === 'la renta se paga el día 5' &&
    leerNotaCerebro('guarda: listo') === null &&
    leerNotaCerebro('llamar a Juan mañana') === null,
    String(leerNotaCerebro('anota en el cerebro: la renta se paga el día 5')))

  ok('14: "Gabita, guarda: …" también', leerNotaCerebro('Gabita, guarda: la renta se paga el día 5') === 'la renta se paga el día 5')
  ok('14: avisos a 30 / 7 / 1 y todos los días si ya venció',
    toca(30) && toca(7) && toca(1) && toca(0) && toca(-5) && !toca(29) && !toca(2))
  ok('14: cómo se dice el vencimiento', cuandoVence(0) === 'hoy' && cuandoVence(1) === 'mañana' && cuandoVence(30) === 'en 30 días' && cuandoVence(-3) === 'hace 3 días')

  ok('14: la ruta del archivo se limpia', /^2026\/11\/\d+-poliza-gnp\.pdf$/.test(rutaPara('Póliza GNP.pdf', '2026-11-07')), rutaPara('Póliza GNP.pdf', '2026-11-07'))

  const p = limpiarPropuesta(
    { titulo: 'Póliza del carro GNP 2026', categoria: 'seguro', empresa: 'Personal', vence: '2027-03-15', monto: '18,400.50', moneda: 'pesos', se_renueva: true },
    { empresas: ['IM', 'PD', 'DATAVIA', 'Personal', 'Chelsea'], hoy: '2026-11-07' }
  )
  ok('14: la ficha queda limpia', p.categoria === 'Seguros' && p.empresa === 'Personal' && p.vence === '2027-03-15' && p.monto === 18400.5 && p.moneda === 'MXN' && p.se_renueva === true, JSON.stringify(p))
  const sinEmpresa = limpiarPropuesta({ titulo: 'Acta', empresa: 'Acme Corp' }, { empresas: ['IM', 'PD'], hoy: '2026-11-07' })
  ok('14: una empresa que no es suya se descarta', sinEmpresa.empresa === null, JSON.stringify(sinEmpresa))

  const acc = validarAcciones({ acciones: [
    { tipo: 'documentos', texto: '¿con quién tengo el seguro del carro?' },
    { tipo: 'documento_nota', texto: 'la renta se paga el día 5' },
    { tipo: 'documentos' },
  ] })
  ok('14: el intérprete distingue preguntar y archivar',
    acc[0].tipo === 'documentos' && acc[1].tipo === 'documento_nota' && acc[2].tipo === 'desconocido', JSON.stringify(acc))
}

// ── Ajuste 16b: "tareas pendientes y alarmas de IM" = la vista de esa empresa ──
{
  for (const m of ['tareas pendientes y alarmas de IM', '¿qué son las tareas pendientes y alarms de IM?', 'pendientes y alarmas de PD', 'tareas pendientes de DATAVIA', 'pendientes de IM']) {
    const r = parse(m)
    ok(`16b: "${m}" → pendientes de esa empresa`, r.kind === 'lista' && r.tipo === 'pendientes' && !!r.empresa, JSON.stringify(r))
  }
  ok('16b: "pendientes" solo sigue siendo la lista', parse('pendientes').kind === 'lista' && parse('pendientes').tipo === 'manana')
  const { tituloNombra } = await import('@/lib/asistente/alarmas')
  ok('16b: el título nombra a la empresa como palabra', tituloNombra('⏰ pago Health Insurance PD', 'PD') && tituloNombra('IM: cierre', 'im') && !tituloNombra('update del sitio', 'PD') && !tituloNombra('Terminar la página', 'IM'))
}

// ── Ajuste 16c: fechas que no cuadran y clientes distintos ──
{
  const { fechasQueNoCuadran, corregirFechas } = await import('@/lib/asistente/fechas-dichas')
  const hoy = '2026-11-10' // martes
  const f = fechasQueNoCuadran('Dámelo de PTHO para este viernes, el viernes 14 tenemos que tener todo', hoy)
  ok('16c: "viernes 14" cuando el viernes es 13 → gana el viernes', f.length === 1 && f[0].mala === '2026-11-14' && f[0].buena === '2026-11-13', JSON.stringify(f))
  ok('16c: "viernes 13" cuadra → nada', fechasQueNoCuadran('para el viernes 13', hoy).length === 0)
  ok('16c: "viernes 27" es otro viernes → nada', fechasQueNoCuadran('para el viernes 27', hoy).length === 0)
  ok('16c: "viernes 3 pm" es una hora → nada', fechasQueNoCuadran('el viernes 3 pm reunión', hoy).length === 0 && fechasQueNoCuadran('el viernes 11:30 junta', hoy).length === 0)
  ok('16c: "hoy martes 11" → hoy', fechasQueNoCuadran('necesita comprar hoy martes 11 pañales', hoy)[0]?.buena === hoy)
  const acc = [{ tipo: 'crear', titulo: 'a', fecha: '2026-11-14' }, { tipo: 'crear', titulo: 'b', fecha: '2026-11-12' }]
  const av = corregirFechas(acc, 'el viernes 14 tenemos que tener todo', hoy)
  ok('16c: corrige solo la fecha equivocada y avisa', acc[0].fecha === '2026-11-13' && acc[1].fecha === '2026-11-12' && av.length === 1 && /viernes es 13/.test(av[0]), JSON.stringify({ acc, av }))

  const { buscarParecida, nombresDistintos } = await import('@/lib/asistente/similitud')
  const abiertas = [{ id: '1', text: 'Shift Google Ads y SEO' }, { id: '2', text: 'Terminar QuickBooks de IM' }, { id: '3', text: 'Marketing Team' }]
  ok('16c: "Trabajar Google Ads PTHO" NO es «Shift Google Ads y SEO»', buscarParecida('Trabajar Google Ads PTHO', abiertas) === null, JSON.stringify(buscarParecida('Trabajar Google Ads PTHO', abiertas)))
  ok('16c: "Trabajar Google Ads" a secas tampoco se pega a Shift', buscarParecida('Trabajar Google Ads', abiertas) === null)
  ok('16c: "Terminar QuickBooks de PD" NO es el de IM', buscarParecida('Terminar QuickBooks de PD', abiertas) === null)
  ok('16c: lo que sí es lo mismo se sigue encontrando', buscarParecida('armar el equipo de marketing', abiertas)?.tarea.id === '3' && buscarParecida('terminar quickbooks de IM', abiertas)?.tarea.id === '2')
  ok('16c: PTHO vs TOTT son nombres distintos; SEO no es un nombre', nombresDistintos('keywords PTHO', 'keywords TOTT') && !nombresDistintos('SEO de PTHO', 'estrategia PTHO') && !nombresDistintos('Google Ads y SEO', 'Google Ads PTHO'))
}

// ── Ajuste 16d: varias órdenes en un mensaje no son el nombre de UNA tarea ──
{
  const largo = 'Pasa «Trabajar keywords PTHO» al viernes 13. Pasa «Preparar estrategia de SEO PTHO» al viernes 13. Pasa «Shift Google Ads y SEO» a mañana miércoles a las 10 am. Y crea la tarea «Google Ads PTHO», IM, para el viernes 13.'
  ok('16d: cuatro órdenes juntas van al intérprete', parse(largo).kind !== 'accion', parse(largo).kind)
  ok('16d: "pasa paypal y crea X" va al intérprete', parse('pasa paypal a mañana y crea llamar a Juan').kind !== 'accion')
  ok('16d: "pasa 3" sigue siendo directo', parse('pasa 3').kind === 'accion' && parse('listo 2, 5').kind === 'accion' && parse('pasa paypal.').kind === 'accion' && parse('listo el 3').kind === 'accion')
  ok('16d: "pasa el 3 al lunes" sigue igual que antes', parse('pasa el 3 al lunes').kind === 'accion')
}

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron`)
  process.exit(1)
}
console.log('✓ pruebas del parser: todo bien')
