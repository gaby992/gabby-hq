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

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron`)
  process.exit(1)
}
console.log('✓ pruebas del parser: todo bien')
