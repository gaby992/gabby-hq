// Fase 9c-A: the persistent menu (a Telegram "reply keyboard"), always
// under the text box. Each button is a question in plain words: Telegram
// sends the button's label as a normal message, and the parser swaps it for
// the phrase it stands for, so a tap and typing the question do exactly the
// same thing. Installed with the first message of a conversation, with
// /menu and under every 8:00 message; /ocultar removes it.

export interface BotonMenu {
  /** What the button shows (and what Telegram sends when tapped). */
  texto: string
  /** The question it stands for. */
  frase: string
}

export const MENU: BotonMenu[][] = [
  [
    { texto: '📋 Hoy', frase: '¿qué tengo hoy?' },
    { texto: '📅 Mañana', frase: '¿qué tengo mañana?' },
    { texto: '⏳ Esperando', frase: '¿qué tengo esperando?' },
  ],
  [
    { texto: '📧 Correos', frase: 'correos' },
    { texto: '🎯 ¿Qué sigue?', frase: '¿qué sigue?' },
    { texto: '🖥 Tablero', frase: 'mándame el tablero' },
  ],
]

/** Telegram `reply_markup` for the menu. */
export function tecladoMenu(): unknown {
  return {
    keyboard: MENU.map((fila) => fila.map((b) => ({ text: b.texto }))),
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Dime qué hacemos…',
  }
}

/** Telegram `reply_markup` that removes the menu ("/ocultar"). */
export function quitarTeclado(): unknown {
  return { remove_keyboard: true }
}

function limpiar(s: string): string {
  // Emoji and variation selectors out, accents out, case out.
  return s
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF\uFE0F]/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const POR_TEXTO = new Map<string, string>()
for (const fila of MENU) for (const b of fila) POR_TEXTO.set(limpiar(b.texto), b.frase)

/** The phrase a menu button stands for, or null when the message is not a button. */
export function fraseDeBoton(texto: string): string | null {
  return POR_TEXTO.get(limpiar(texto)) ?? null
}

/** The buttons as the web chat shows them (label + phrase), one flat list. */
export function botonesMenuWeb(): BotonMenu[] {
  return MENU.flat()
}
