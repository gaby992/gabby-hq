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

if (fallos > 0) {
  console.error(`\n${fallos} prueba(s) fallaron`)
  process.exit(1)
}
console.log('✓ pruebas del parser: todo bien')
