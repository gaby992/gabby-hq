// The bot writes its messages in Telegram HTML (bold titles, signed links).
// Some places have to send the same text WITHOUT tags: the web panels, and
// any line that travels inside a plain-text reply (a plan line, a
// confirmation). A stray "<" would make Telegram reject the whole message,
// so going through here is what keeps those paths safe.

/** `<a href="u">abrir</a>` → `abrir (u)` (Telegram still links the bare URL); other tags are dropped. */
export function sinHtml(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, '$2 ($1)')
    .replace(/<\/?(?:b|i|code|s|u|pre)>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** A loose "&", "<" or ">" in plain words; entities already written are left alone. */
function escaparSuelto(s: string): string {
  return s
    .replace(/&(?!(?:amp|lt|gt|quot);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Our own tags: a link with a quoted href, and the few inline styles Telegram knows. */
const RE_ETIQUETA = /(<a href="[^"<>]*">[^<]*<\/a>|<\/?(?:b|i|code|s|u)>)/g

/**
 * Fase 15: text that mixes HER words (a task title, a transcript — anything
 * could be in there, a "<" included) with OUR tags (a link, a bold) → HTML
 * Telegram accepts. Our tags stay; everything else is escaped. This is what
 * lets a confirmation carry a clean "abrir" link instead of a raw URL in
 * parentheses, without one odd title making Telegram reject the message.
 */
export function htmlSeguro(texto: string): string {
  return texto
    .split(RE_ETIQUETA)
    .map((seg, i) => {
      if (i % 2 === 0) return escaparSuelto(seg)
      // Inside a link, the href's own "&" must be an entity too.
      return seg.replace(/^<a href="([^"]*)">/, (_m, url: string) => `<a href="${url.replace(/&(?!(?:amp|lt|gt|quot);)/g, '&amp;')}">`)
    })
    .join('')
}
