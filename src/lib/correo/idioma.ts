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
  // Ajuste 9c-2: the whole mail message in the account's language — summary lines, footers, hints.
  /** "lo importante" · "what matters" (list title tail). */
  loImportante: string
  /** "6 que importan: 5 urgentes, 1 pide respuesta." · "6 that matter: 5 urgent, 1 needs a reply." */
  resumen: (o: { total: number; altas: number; respuesta: number; resto: number; chelsea: number; importante: boolean }) => string
  /** "61 sin prisa fuera." · "61 low-priority left out." */
  fuera: (n: number) => string
  /** "El más viejo lleva 3 días (TechFin)." */
  masViejo: (dias: number, quien: string) => string
  /** "👉 ¿Empezamos por el 1 (TechFin)?" · "👉 Start with #1 (TechFin)?" */
  empieza: (n: number, quien: string) => string
  /** "Nada urgente ni que pida respuesta; 61 sin prisa en …" when the filter leaves nothing. */
  nadaImportante: (fuera: number, link: string) => string
  /** "· 61 sin prisa fuera de esta lista: di «correos de X» para verlos todos" */
  verTodos: (n: number, comando: string) => string
  /** The decide-by-number hints under the list. The commands stay in Spanish (that is what the bot reads); the labels follow the language. */
  pie: (n: number, link: string) => string
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
  loImportante: 'lo importante',
  resumen: ({ total, altas, respuesta, resto, chelsea, importante }) => {
    const partes = [
      altas > 0 ? `${altas} ${altas === 1 ? 'urgente' : 'urgentes'}` : null,
      respuesta > 0 ? `${respuesta} ${respuesta === 1 ? 'pide respuesta' : 'piden respuesta'}` : null,
      !importante && resto > 0 ? `${resto} solo para enterarte` : null,
      chelsea > 0 ? `${chelsea} ya con Chelsea` : null,
    ].filter(Boolean)
    const cabeza = importante ? `${total} que ${total === 1 ? 'importa' : 'importan'}` : `${total} ${total === 1 ? 'pendiente' : 'pendientes'}`
    return `${cabeza}${partes.length ? `: ${partes.join(', ')}` : ''}.`
  },
  fuera: (n) => `${n} sin prisa fuera.`,
  masViejo: (d, quien) => `El más viejo lleva ${d} días (${quien}).`,
  empieza: (n, quien) => `👉 ¿Empezamos por el ${n} (${quien})?`,
  nadaImportante: (fuera, link) => `Nada urgente ni que pida respuesta; ${fuera === 1 ? 'hay 1 correo' : `hay ${fuera} correos`} sin prisa en ${link}.`,
  verTodos: (n, comando) => `· ${n === 1 ? '1 correo sin prisa' : `${n} correos sin prisa`} fuera de esta lista: di «${comando}» para verlos todos`,
  pie: (n, link) => `Para decidir: <code>el ${n} lo hago yo</code> · <code>el ${n} para Chelsea</code> · <code>archiva el ${n}</code> · <code>correos</code> = la lista completa · ${link}`,
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
  loImportante: 'what matters',
  resumen: ({ total, altas, respuesta, resto, chelsea, importante }) => {
    const partes = [
      altas > 0 ? `${altas} urgent` : null,
      respuesta > 0 ? `${respuesta} ${respuesta === 1 ? 'needs' : 'need'} a reply` : null,
      !importante && resto > 0 ? `${resto} FYI` : null,
      chelsea > 0 ? `${chelsea} already with Chelsea` : null,
    ].filter(Boolean)
    const cabeza = importante ? `${total} that ${total === 1 ? 'matters' : 'matter'}` : `${total} pending`
    return `${cabeza}${partes.length ? `: ${partes.join(', ')}` : ''}.`
  },
  fuera: (n) => `${n} low-priority left out.`,
  masViejo: (d, quien) => `Oldest is ${d} days old (${quien}).`,
  empieza: (n, quien) => `👉 Start with #${n} (${quien})?`,
  nadaImportante: (fuera, link) => `Nothing urgent or waiting for a reply; ${fuera === 1 ? '1 low-priority email' : `${fuera} low-priority emails`} in ${link}.`,
  verTodos: (n, comando) => `· ${n} low-priority ${n === 1 ? 'email' : 'emails'} left out: say «${comando}» to see them all`,
  pie: (n, link) => `To decide: <code>el ${n} lo hago yo</code> (I'll handle it) · <code>el ${n} para Chelsea</code> (to Chelsea) · <code>archiva el ${n}</code> (archive) · <code>correos</code> = full list · ${link}`,
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
