'use client'

import { useEffect, useState, useCallback } from 'react'
import { RadarItem, RadarEstado, RADAR_ESTADO_LABELS } from '@/types'
import { supabase } from '@/lib/supabase'

const ESTADO_STYLES: Record<RadarEstado, string> = {
  idea: 'bg-blue-50 text-blue-600',
  explorando: 'bg-amber-50 text-amber-600',
  'en progreso': 'bg-green-50 text-green-600',
  descartado: 'bg-gray-100 text-gray-400',
}

export default function RadarPage() {
  const [items, setItems] = useState<RadarItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [categoria, setCategoria] = useState('')
  const [estado, setEstado] = useState<RadarEstado>('idea')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from('radar')
      .select('*')
      .order('created_at', { ascending: false })
    setItems(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!titulo.trim()) return
    setSaving(true)
    await supabase.from('radar').insert({
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      categoria: categoria.trim() || null,
      estado,
    })
    setTitulo('')
    setDescripcion('')
    setCategoria('')
    setEstado('idea')
    setShowForm(false)
    setSaving(false)
    fetchItems()
  }

  async function updateEstado(id: string, newEstado: RadarEstado) {
    await supabase.from('radar').update({ estado: newEstado }).eq('id', id)
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, estado: newEstado } : i))
  }

  async function deleteItem(id: string) {
    await supabase.from('radar').delete().eq('id', id)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setConfirmDelete(null)
  }

  if (loading) {
    return <div className="text-sm text-gray-400 py-8 text-center">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Radar</h1>
          <p className="text-sm text-gray-400 mt-0.5">Ideas and future projects</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <input
            autoFocus
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Title"
            className="w-full text-sm font-medium border-0 outline-none placeholder:text-gray-300 text-gray-900"
          />
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full text-xs border border-gray-200 rounded px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-gray-400 placeholder:text-gray-300 resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Category (optional)"
              className="text-xs border border-gray-200 rounded px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-gray-400 placeholder:text-gray-300"
            />
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value as RadarEstado)}
              className="text-xs border border-gray-200 rounded px-2 py-1.5 text-gray-600 focus:outline-none focus:border-gray-400 bg-white"
            >
              {(Object.keys(RADAR_ESTADO_LABELS) as RadarEstado[]).map((e) => (
                <option key={e} value={e}>{RADAR_ESTADO_LABELS[e]}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving || !titulo.trim()}
              className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving...' : 'Add item'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {items.length === 0 && (
        <div className="text-sm text-gray-400 text-center py-12">
          No radar items yet. Add one above.
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900">{item.titulo}</span>
                  {item.categoria && (
                    <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                      {item.categoria}
                    </span>
                  )}
                </div>
                {item.descripcion && (
                  <p className="text-sm text-gray-500 mt-1">{item.descripcion}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  value={item.estado}
                  onChange={(e) => updateEstado(item.id, e.target.value as RadarEstado)}
                  className={`text-xs px-2 py-1 rounded font-medium border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-gray-300 ${ESTADO_STYLES[item.estado]}`}
                >
                  {(Object.keys(RADAR_ESTADO_LABELS) as RadarEstado[]).map((e) => (
                    <option key={e} value={e}>{RADAR_ESTADO_LABELS[e]}</option>
                  ))}
                </select>
                {confirmDelete === item.id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="text-xs text-red-500 hover:text-red-600 font-medium"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(item.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
