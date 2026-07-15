export type Priority = 'urgente' | 'normal' | 'cuando'

export interface Company {
  id: string
  name: string
  color: string
  created_at: string
}

export interface Subtask {
  id: string
  task_id: string
  text: string
  done: boolean
  position?: number
  created_at: string
}

export interface Task {
  id: string
  company_id: string | null
  text: string
  priority: Priority
  due_date: string | null
  start_date: string | null
  notes: string | null
  link_url: string | null
  link_label: string | null
  done: boolean
  created_at: string
  company?: Company
  subtasks?: Subtask[]
}

export type RadarEstado = 'idea' | 'explorando' | 'en progreso' | 'descartado'

export interface RadarItem {
  id: string
  titulo: string
  descripcion: string | null
  categoria: string | null
  estado: RadarEstado
  created_at: string
}

export interface ApiKey {
  id: string
  label: string
  key: string
  created_at: string
}

export const COMPANY_COLORS: Record<string, string> = {
  teal: '#1D9E75',
  purple: '#7F77DD',
  amber: '#EF9F27',
  coral: '#D85A30',
  blue: '#378ADD',
  pink: '#D4537E',
  gray: '#888780',
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgente: 'Urgente',
  normal: 'Normal',
  cuando: 'Cuando pueda',
}

export const RADAR_ESTADO_LABELS: Record<RadarEstado, string> = {
  idea: 'Idea',
  explorando: 'Explorando',
  'en progreso': 'En progreso',
  descartado: 'Descartado',
}

// ── Inbox-IM triage module ──────────────────────────────────────────────

export type ImCategoria =
  | 'cliente'
  | 'facturacion_pagos'
  | 'operativo'
  | 'plataformas_seo'
  | 'informativo'
  | 'promocional_spam'

export type ImUrgencia = 'alta' | 'media' | 'baja'

export type ImTipo =
  | 'needs_reply'
  | 'task_request'
  | 'fyi'
  | 'notification'
  | 'marketing'
  | 'meeting'

export type ImStatus =
  | 'nuevo'
  | 'registrado'
  | 'pasado_a_chelsea'
  | 'lo_resuelvo_yo'
  | 'archivado'
  | 'resuelto'

export interface ImTriaje {
  id: string
  inbox: string
  gmail_message_id: string
  gmail_thread_id: string | null
  remitente: string | null
  asunto: string | null
  recibido_at: string | null
  resumen_ia: string | null
  categoria: ImCategoria | null
  urgencia: ImUrgencia | null
  tipo: ImTipo | null
  requiere_respuesta: boolean | null
  borrador_respuesta: string | null
  status: ImStatus
  asignado_a: string | null
  decidido_at: string | null
  resuelto_at: string | null
  telegram_message_id: string | null
  alertado: boolean | null
  regla_id: string | null
  created_at: string
}

export type ImReglaMatchTipo = 'remitente' | 'dominio' | 'asunto_contiene'
export type ImReglaAccion =
  | 'auto_chelsea'
  | 'auto_gabby'
  | 'auto_archivar'
  | 'solo_registrar'

export interface ImRegla {
  id: string
  inbox: string
  match_tipo: ImReglaMatchTipo
  match_valor: string
  accion: ImReglaAccion
  alerta: boolean
  activa: boolean
  created_at: string
}

// The four row actions — mirror the buttons in the Telegram bot.
export type InboxAction = 'for_chelsea' | 'ill_handle' | 'archive' | 'done'

export const URGENCIA_EMOJI: Record<ImUrgencia, string> = {
  alta: '🔴',
  media: '🟡',
  baja: '🟢',
}

export const URGENCIA_ORDER: ImUrgencia[] = ['alta', 'media', 'baja']

export const URGENCIA_LABELS: Record<ImUrgencia, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}

export const IM_CATEGORIA_LABELS: Record<ImCategoria, string> = {
  cliente: 'Cliente',
  facturacion_pagos: 'Facturación/Pagos',
  operativo: 'Operativo',
  plataformas_seo: 'Plataformas/SEO',
  informativo: 'Informativo',
  promocional_spam: 'Promocional/Spam',
}

export const IM_TIPO_LABELS: Record<ImTipo, string> = {
  needs_reply: 'Needs reply',
  task_request: 'Task request',
  fyi: 'FYI',
  notification: 'Notification',
  marketing: 'Marketing',
  meeting: 'Meeting',
}

export const IM_STATUS_LABELS: Record<ImStatus, string> = {
  nuevo: 'Nuevo',
  registrado: 'Registrado',
  pasado_a_chelsea: 'For Chelsea',
  lo_resuelvo_yo: "I'll handle it",
  archivado: 'Archived',
  resuelto: 'Resolved',
}

export const IM_REGLA_MATCH_LABELS: Record<ImReglaMatchTipo, string> = {
  remitente: 'Sender',
  dominio: 'Domain',
  asunto_contiene: 'Subject contains',
}

export const IM_REGLA_ACCION_LABELS: Record<ImReglaAccion, string> = {
  auto_chelsea: 'Auto → Chelsea',
  auto_gabby: 'Auto → Gabby',
  auto_archivar: 'Auto archive',
  solo_registrar: 'Log only',
}
