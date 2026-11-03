// Ajuste 6c (3 nov 2026): the language of one mail account. What is MEANT
// for the account's owner — the classifier's summary and reason, the
// Telegram alert, the "correos" list and the 📧 section of the 8:00 list —
// comes out in `cuentas_correo.idioma` ('es' | 'en') so it can be pasted to
// her as is. The rest of the bot (tasks, "qué sigue", notes, the buttons
// and the "el 5 lo hago yo" hints) stays in Spanish.

import { CORREO_TIPO_LABELS, type CorreoTipo, type CorreoUrgencia, type IdiomaCorreo } from '@/types'

export const IDIOMAS: IdiomaCorreo[] = ['es', 'en']

export function esIdioma(v: unknown): v is IdiomaCorreo {
  return v === 'es' || v === 'en'
}

const TIPO_EN: Record<CorreoTipo, string> = {
  necesita_respuesta: 'needs a reply',
  pedido_de_tarea: 'task request',
  fyi: 'FYI',
  notificacion: 'notification',
  marketing: 'marketing',
  reunion: 'meeting',
  pago: 'payment',
}

const URGENCIA_EN: Record<CorreoUrgencia, string> = { alta: 'high', media: 'medium', baja: 'low' }

export interface TextosCorreo {
  sinAsunto: string
  de: string
  urgencia: (u: CorreoUrgencia) => string
  tipo: (t: CorreoTipo) => string
  /** "hace 5 min" · "5 min ago" */
  hace: (min: number) => string
  respondio: (quien: string | null) => string
  /** "+3 más → correos" */
  mas: (n: number, link: string) => string
  grupos: { alta: string; respuesta: string; resto: string }
  correos: string
  todasLasCuentas: string
  nadaPendiente: string
}

const ES: TextosCorreo = {
  sinAsunto: '(sin asunto)',
  de: 'De:',
  urgencia: (u) => u,
  tipo: (t) => CORREO_TIPO_LABELS[t].toLowerCase(),
  hace: (min) => (min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)}h` : `hace ${Math.round(min / 1440)}d`),
  respondio: (quien) => (quien ? `${quien} respondió` : 'respondido'),
  mas: (n, link) => `+${n} más → ${link}`,
  grupos: { alta: '✴️ Alta', respuesta: '✉️ Necesitan respuesta', resto: 'Resto' },
  correos: 'Correos',
  todasLasCuentas: 'todas las cuentas',
  nadaPendiente: 'Nada pendiente 🎉',
}

const EN: TextosCorreo = {
  sinAsunto: '(no subject)',
  de: 'From:',
  urgencia: (u) => URGENCIA_EN[u],
  tipo: (t) => TIPO_EN[t],
  hace: (min) => (min < 60 ? `${min} min ago` : min < 1440 ? `${Math.round(min / 60)}h ago` : `${Math.round(min / 1440)}d ago`),
  respondio: (quien) => (quien ? `${quien} replied` : 'replied'),
  mas: (n, link) => `+${n} more → ${link}`,
  grupos: { alta: '✴️ High', respuesta: '✉️ Need a reply', resto: 'Rest' },
  correos: 'Mail',
  todasLasCuentas: 'all accounts',
  nadaPendiente: 'Nothing pending 🎉',
}

/** The strings for one account's language ('es' when unknown). */
export function textos(idioma: IdiomaCorreo | null | undefined): TextosCorreo {
  return idioma === 'en' ? EN : ES
}

/** The line the classifier's prompt adds for an English account (nothing for Spanish: the prompt stays as evaluated). */
export function instruccionIdioma(idioma: IdiomaCorreo | null | undefined): string | null {
  if (idioma !== 'en') return null
  return 'IDIOMA: la dueña de este buzón habla inglés. Escribe "resumen" y "razon" EN INGLÉS (los valores de urgencia, tipo y categoria siguen siendo los códigos del JSON tal cual).'
}
