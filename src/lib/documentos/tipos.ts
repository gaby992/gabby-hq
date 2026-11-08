// Fase 14 (segundo cerebro): what a saved document is, as the whole app sees
// it. The categories are fixed — Gabby chose them — so a button row, a web
// filter and the model's prompt all read from the same list.

export const CATEGORIAS = [
  'Contratos',
  'Alquiler',
  'Seguros',
  'Finanzas',
  'Facturas y recibos',
  'Salud',
  'Documentos e IDs',
  'Otros',
] as const

export type Categoria = (typeof CATEGORIAS)[number]

export const CATEGORIA_EMOJI: Record<Categoria, string> = {
  'Contratos': '📜',
  'Alquiler': '🏠',
  'Seguros': '🛡',
  'Finanzas': '💰',
  'Facturas y recibos': '🧾',
  'Salud': '🩺',
  'Documentos e IDs': '🪪',
  'Otros': '📄',
}

export function esCategoria(v: unknown): v is Categoria {
  return typeof v === 'string' && (CATEGORIAS as readonly string[]).includes(v)
}

/** The model may answer "seguro", "insurance", "recibos": land it on one of the eight. */
export function normalizarCategoria(v: unknown): Categoria {
  if (esCategoria(v)) return v
  const s = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (!s) return 'Otros'
  if (/contrat|convenio|acuerdo|contract/.test(s)) return 'Contratos'
  if (/alquil|renta|arrend|lease|rent/.test(s)) return 'Alquiler'
  if (/seguro|poliz|insur|polic(?:y|e)/.test(s)) return 'Seguros'
  if (/factur|recib|invoice|receipt|ticket|nota de venta/.test(s)) return 'Facturas y recibos'
  if (/finanz|banco|bancari|estado de cuenta|statement|credito|prestam|impuesto|tax|sat/.test(s)) return 'Finanzas'
  if (/salud|medic|health|laboratorio|receta|hospital|dental/.test(s)) return 'Salud'
  if (/identif|pasaporte|ine|licencia|curp|rfc|id\b|visa|acta/.test(s)) return 'Documentos e IDs'
  return 'Otros'
}

export type OrigenDocumento = 'telegram' | 'web' | 'nota'

/** One row of `documentos`. `ruta` is null for a note with no file. */
export interface Documento {
  id: string
  titulo: string
  categoria: Categoria
  company_id: string | null
  ruta: string | null
  tipo: string | null
  paginas: number | null
  texto: string | null
  resumen: string | null
  fecha_documento: string | null
  vence: string | null
  monto: number | null
  moneda: string | null
  se_renueva: boolean
  notas: string | null
  reemplaza_a: string | null
  historial: boolean
  origen: OrigenDocumento
  creado: string
  actualizado: string
}

/** The fields the bot proposes and she can correct before saving. */
export interface Propuesta {
  titulo: string
  categoria: Categoria
  empresa?: string | null
  resumen?: string | null
  fecha_documento?: string | null
  vence?: string | null
  monto?: number | null
  moneda?: string | null
  se_renueva?: boolean
  notas?: string | null
}

/** One file of a document (a document can be several photos). */
export interface ArchivoGuardado {
  ruta: string
  tipo: string
  nombre: string
  paginas?: number
  texto?: string
}

export const MONEDAS = ['MXN', 'USD', 'EUR', 'VES', 'COP'] as const

/** "$1,250.00 MXN" — never a bare number in a message. */
export function montoTexto(monto: number | null | undefined, moneda: string | null | undefined): string | null {
  if (monto === null || monto === undefined || !Number.isFinite(monto)) return null
  const n = monto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `$${n}${moneda ? ` ${moneda}` : ''}`
}

/** Telegram refuses to hand a bot any file over 20 MB — the web upload has no such limit. */
export const TELEGRAM_MAX_BYTES = 20 * 1024 * 1024
/** What the web upload accepts, so a 300 MB video never lands in the bucket. */
export const WEB_MAX_BYTES = 40 * 1024 * 1024

export const TIPOS_ACEPTADOS = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]

export function esImagen(tipo: string | null | undefined): boolean {
  return !!tipo && tipo.startsWith('image/')
}

export function esPdf(tipo: string | null | undefined): boolean {
  return tipo === 'application/pdf'
}
