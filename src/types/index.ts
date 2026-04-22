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
