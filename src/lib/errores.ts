// Ajuste 6-1: an error message may carry a secret — a key pasted into the
// wrong env var ("LLM_PROVIDER_CORREO inválido: sk-proj-…"), a provider
// echoing the Authorization header, a token in a URL. Nothing that reaches
// Telegram, the web or the Vercel logs goes out without passing through
// here. Config errors are reported by VARIABLE NAME, never by value.

const NOMBRES_SENSIBLES = /(KEY|SECRET|TOKEN|PASSWORD|PASS|SEED|CREDENTIAL)/i

/** Masks anything that looks like a credential, and the actual value of every sensitive env var. */
export function redactar(texto: string): string {
  let out = texto
  for (const [nombre, valor] of Object.entries(process.env)) {
    if (!valor || valor.length < 8 || !NOMBRES_SENSIBLES.test(nombre)) continue
    if (out.includes(valor)) out = out.split(valor).join(`[${nombre}]`)
  }
  return out
    .replace(/\b(?:sk|rk|pk|xoxb|xoxp|ghp|gho|AIza)[-_][A-Za-z0-9_-]{8,}/g, '[key]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [token]')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, '[token]')
}

/** The message of any thrown value, redacted. Use it wherever an error becomes text. */
export function mensajeError(err: unknown): string {
  return redactar(err instanceof Error ? err.message : String(err))
}

/** Telegram-facing: no detail at all for config problems, a short redacted reason otherwise. */
export function motivoParaUsuario(err: unknown): string {
  const m = mensajeError(err)
  if (/no está definida|inválid[oa]|env var|variable/i.test(m)) return 'config'
  return m.length > 120 ? m.slice(0, 119) + '…' : m
}
