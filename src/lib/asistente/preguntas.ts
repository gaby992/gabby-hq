// Fase 9c-D: the questions the assistant answers in prose, read without a
// model. Pure text → intent; no database here (the parser imports this, and
// so does narracion.ts, which fetches the data and writes the answer).
//
//   hoy        ¿qué tengo hoy? · qué hay hoy · cómo viene el día · 📋 Hoy
//   pendiente  ¿qué me queda pendiente? · qué tengo · qué me falta
//   manana     ¿qué tengo mañana? · qué hay mañana · 📅 Mañana
//   estancado  ¿qué tengo estancado? · qué se me quedó atorado · qué está parado
//   empresa    ¿cómo va IM? · cómo vamos con PD · qué hay de DATAVIA
//   esperando  ¿qué tengo esperando? · a quién estoy esperando
//   semana     ¿qué hay esta semana? · cómo viene la semana
// Anything else stays a free question for the model (/pregunta).

export type PreguntaNatural =
  | { tipo: 'hoy' }
  | { tipo: 'pendiente' }
  | { tipo: 'manana' }
  | { tipo: 'estancado' }
  | { tipo: 'empresa'; nombre: string }
  | { tipo: 'esperando' }
  | { tipo: 'semana' }

interface EmpresaRef {
  id: string
  name: string
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^[¿?¡!\s]+|[?!.\s]+$/g, '')
    .replace(/^\/?pregunta\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const RE_ESTANCADO = /\b(estancad|atorad|trabad|atascad|parad|detenid|olvidad|abandonad|sin mover|sin tocar|no he movido|no he tocado|se me quedo|empolvad)/

export function clasificarPregunta(texto: string, companies: EmpresaRef[] = []): PreguntaNatural | null {
  const n = normalizar(texto)
  if (!n) return null

  // "qué tengo estancado", "qué se me quedó atorado", "qué está parado", "qué tareas llevan tiempo sin moverse"
  if (/^(que|cuales?|cual)\b/.test(n) && RE_ESTANCADO.test(n)) return { tipo: 'estancado' }

  // "qué tengo esperando", "a quién estoy esperando", "qué espero de alguien", "qué está en manos de otros"
  if (/^(?:que|cuales?)\s+(?:tengo|hay|esta|tenemos|cosas\s+tengo)\s+(?:en\s+)?(?:esperando|espera|en\s+manos\s+de\s+(?:otros|alguien|alguien\s+mas))$/.test(n)) return { tipo: 'esperando' }
  if (/^(?:a\s+)?quien(?:es)?\s+(?:estoy\s+|estamos\s+)?esperando$|^que\s+espero(?:\s+de\s+(?:alguien|otros|los\s+demas))?$|^(?:lista\s+(?:de\s+)?)?esperando$|^en\s+espera$/.test(n)) return { tipo: 'esperando' }

  // "qué hay esta semana", "qué tengo esta semana", "cómo viene la semana", "cómo pinta la semana"
  if (/^(?:que|como)\s+(?:hay|tengo|tenemos|toca|viene|pinta|esta|se\s+ve)\s+(?:para\s+)?(?:esta\s+|la\s+)semana$|^(?:como\s+)?(?:viene|pinta|va)\s+(?:la|esta)\s+semana$|^(?:esta\s+)?semana$|^plan\s+de\s+la\s+semana$/.test(n)) return { tipo: 'semana' }

  // "qué tengo mañana", "qué hay mañana", "qué toca mañana", "cómo viene mañana", "qué tengo que hacer mañana"
  if (/^(?:que|como)\s+(?:tengo|hay|toca|me\s+toca|tenemos|viene|pinta|esta)\s+(?:que\s+hacer\s+)?(?:para\s+)?manana$|^manana$/.test(n)) return { tipo: 'manana' }

  // "qué tengo hoy", "qué hay hoy", "qué toca hoy", "cómo viene el día", "qué tengo que hacer hoy"
  if (/^(?:que|como)\s+(?:tengo|hay|toca|me\s+toca|tenemos|viene|pinta|esta)\s+(?:que\s+hacer\s+)?(?:para\s+)?hoy$|^(?:como\s+)?(?:viene|pinta|esta|va)\s+(?:el\s+)?dia(?:\s+de\s+hoy)?$|^hoy$/.test(n)) return { tipo: 'hoy' }

  // "qué me queda pendiente", "qué tengo pendiente", "qué me falta", "qué queda", "qué tengo"
  if (/^(?:que|cuanto|cuantas?)\s+(?:me\s+)?(?:queda|quedan|tengo|hay|falta|faltan)(?:\s+(?:de\s+)?pendientes?)?$|^(?:que|cuanto|cuantas?)\s+(?:me\s+)?(?:queda|quedan|tengo|hay)\s+(?:por\s+hacer|abierto|abiertas?)$/.test(n)) return { tipo: 'pendiente' }

  // "cómo va IM", "cómo vamos con PD", "qué tal DATAVIA", "cómo está lo de IM", "qué hay de IM", "cómo voy con IM"
  const empresas = [...companies].sort((a, b) => b.name.length - a.name.length)
  for (const c of empresas) {
    const nombre = escapeRe(normalizar(c.name))
    if (!nombre) continue
    const re = new RegExp(
      `^(?:como|que\\s+tal)\\s+(?:va|vamos|voy|anda|andamos|esta|estan|estamos|vas|viene|pinta)\\s+(?:con\\s+|en\\s+|de\\s+|lo\\s+de\\s+|la\\s+de\\s+|el\\s+)?${nombre}$` +
        `|^(?:que|como)\\s+(?:hay|tenemos|tengo|queda)\\s+(?:de|en|con|para)\\s+${nombre}$` +
        `|^(?:que\\s+tal|como\\s+va)\\s+${nombre}$` +
        `|^(?:resumen|estado|panorama)\\s+(?:de\\s+)?${nombre}$`
    )
    if (re.test(n)) return { tipo: 'empresa', nombre: c.name.trim() }
  }
  return null
}
