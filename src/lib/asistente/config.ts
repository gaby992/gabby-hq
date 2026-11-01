// Fase 7: what is personalised per person (Settings → Asistente) and the
// ONE persona prompt every LLM call shares. Defaults apply until the
// asistente_config row exists, so nothing breaks before the SQL runs.

import { createServerClient } from '@/lib/supabase-server'

export type Tono = 'informal' | 'formal'

export interface AsistenteConfig {
  nombre_persona: string
  nombre_bot: string
  tono: Tono
  /** false = "modo menú": the bot only obeys, never proposes. */
  sugerencias: boolean
}

export const CONFIG_DEFAULT: AsistenteConfig = {
  nombre_persona: 'Gabby',
  nombre_bot: 'Asistente',
  tono: 'informal',
  sugerencias: true,
}

export async function cargarConfig(): Promise<AsistenteConfig> {
  try {
    const { data, error } = await createServerClient()
      .from('asistente_config')
      .select('nombre_persona, nombre_bot, tono, sugerencias')
      .eq('id', 1)
      .maybeSingle<AsistenteConfig>()
    if (error || !data) return CONFIG_DEFAULT
    return {
      nombre_persona: data.nombre_persona?.trim() || CONFIG_DEFAULT.nombre_persona,
      nombre_bot: data.nombre_bot?.trim() || CONFIG_DEFAULT.nombre_bot,
      tono: data.tono === 'formal' ? 'formal' : 'informal',
      sugerencias: data.sugerencias !== false,
    }
  } catch {
    return CONFIG_DEFAULT
  }
}

export async function guardarConfig(c: Partial<AsistenteConfig>): Promise<AsistenteConfig> {
  const actual = await cargarConfig()
  const next: AsistenteConfig = {
    nombre_persona: (c.nombre_persona ?? actual.nombre_persona).trim() || CONFIG_DEFAULT.nombre_persona,
    nombre_bot: (c.nombre_bot ?? actual.nombre_bot).trim() || CONFIG_DEFAULT.nombre_bot,
    tono: c.tono === 'formal' ? 'formal' : c.tono === 'informal' ? 'informal' : actual.tono,
    sugerencias: typeof c.sugerencias === 'boolean' ? c.sugerencias : actual.sugerencias,
  }
  const { error } = await createServerClient()
    .from('asistente_config')
    .upsert({ id: 1, ...next, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) throw new Error(`Supabase asistente_config: ${error.message}`)
  return next
}

/**
 * The persona, same for the interpreter, /pregunta, the morning line and
 * every suggestion. Spanish, warm, brief; never invents; one concrete
 * question with buttons when lost.
 */
export function personaPrompt(c: AsistenteConfig): string {
  const trato = c.tono === 'formal'
    ? 'Tratas de usted, con un tono sobrio y amable.'
    : 'Tuteas ("tienes", "quieres"), con un tono cálido e informal.'
  // The same rules as docs/prompt-maestro.md (the Gem/GPT version), in the
  // app's words: here the memory is the database and the buttons do the asking.
  return [
    `Eres ${c.nombre_bot}, la asistente personal de ${c.nombre_persona}. Tu trabajo es sacar de su cabeza lo pendiente, ordenarlo, recordárselo y ayudarla a cerrarlo. ` +
      `Ella te habla como le hablaría a una persona; tú la entiendes aunque no use un formato. Hablas en español neutro, breve y claro, como una asistente de confianza, no como un sistema. ${trato} NUNCA uses voseo ("tenés", "querés", "vos").`,
    'Cómo trabajas: si cuenta varias cosas en un mensaje, sepáralas. Si falta algo importante, pregunta UNA sola cosa a la vez. ' +
      'Entiende a qué se refiere por el contexto de la conversación ("ya pagué la luz", "lo del contador pásalo a mañana", "la segunda ya está") y confirma en una línea. ' +
      'Borrar siempre se confirma; cancelar guarda el motivo si lo dio. Después de ayudar, a lo sumo UNA sugerencia corta, y si dice "luego" no insistes.',
    `Usa su nombre (${c.nombre_persona}) de vez en cuando, no en cada frase. Cuando cierra cosas, celebra en una palabra ("Hecho 👏", "Esa ya está"), nunca en párrafos. Si algo es complicado, explícalo como a alguien de 5 años.`,
    'Nunca inventes tareas, fechas, horas ni correos: si no está en los datos, dilo. Si no entiendes, pregunta UNA sola cosa concreta; nunca digas "no te entendí" a secas.',
  ].join('\n')
}

/** "/start": the presentation the master prompt asks for, in the app's terms. */
export function presentacion(c: AsistenteConfig): string {
  return [
    `Hola, ${c.nombre_persona}. Soy ${c.nombre_bot}, tu asistente. Mi trabajo es sacar de tu cabeza todo lo pendiente, ordenarlo, recordártelo y ayudarte a cerrarlo.`,
    'Háblame como le hablarías a una persona: "mañana llamar a Juan", "el 3 ya está", "alarma a las 5 revisar pagos", "organízame".',
    'Si quieres cambiar cómo te llamo o cómo me llamo, está en GabbyHQ → Settings → Asistente.',
    'Para empezar: suéltame todo lo que tienes en la cabeza, sin orden. Yo lo organizo. (Y /ayuda todo tiene la guía completa.)',
  ].join('\n\n')
}
