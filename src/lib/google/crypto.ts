// Refresh tokens at rest (fase 5): AES-256-GCM with APP_ENCRYPTION_KEY
// (32 bytes, hex). The key lives only in Vercel; the database holds
// "v1:<base64(iv · tag · ciphertext)>" and nothing else.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function key(): Buffer {
  const hex = (process.env.APP_ENCRYPTION_KEY ?? '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('APP_ENCRYPTION_KEY debe ser 32 bytes en hex (openssl rand -hex 32)')
  }
  return Buffer.from(hex, 'hex')
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${Buffer.concat([iv, tag, enc]).toString('base64')}`
}

export function descifrar(blob: string): string {
  if (!blob.startsWith('v1:')) throw new Error('token cifrado con un formato desconocido')
  const buf = Buffer.from(blob.slice(3), 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
