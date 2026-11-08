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
