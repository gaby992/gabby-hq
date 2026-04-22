'use client'

import { useEffect, useState, useCallback } from 'react'
import { Company, ApiKey, COMPANY_COLORS } from '@/types'
import { supabase } from '@/lib/supabase'

const COLOR_OPTIONS = Object.entries(COMPANY_COLORS)

function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return 'ghq_' + Array.from(arr).map((b) => chars[b % chars.length]).join('')
}

export default function SettingsPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)

  // Company form
  const [companyName, setCompanyName] = useState('')
  const [companyColor, setCompanyColor] = useState('teal')
  const [savingCompany, setSavingCompany] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)

  // API key form
  const [keyLabel, setKeyLabel] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null)
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null)
  const [confirmDeleteCompany, setConfirmDeleteCompany] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const [{ data: c }, { data: k }] = await Promise.all([
      supabase.from('companies').select('*').order('name'),
      supabase.from('api_keys').select('*').order('created_at', { ascending: false }),
    ])
    setCompanies(c ?? [])
    setApiKeys(k ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleAddCompany(e: React.FormEvent) {
    e.preventDefault()
    if (!companyName.trim()) return
    setSavingCompany(true)
    if (editingCompany) {
      await supabase
        .from('companies')
        .update({ name: companyName.trim(), color: companyColor })
        .eq('id', editingCompany.id)
      setEditingCompany(null)
    } else {
      await supabase.from('companies').insert({ name: companyName.trim(), color: companyColor })
    }
    setCompanyName('')
    setCompanyColor('teal')
    setSavingCompany(false)
    fetchData()
  }

  function startEditCompany(c: Company) {
    setEditingCompany(c)
    setCompanyName(c.name)
    setCompanyColor(c.color)
  }

  async function deleteCompany(id: string) {
    await supabase.from('companies').delete().eq('id', id)
    setConfirmDeleteCompany(null)
    fetchData()
  }

  async function handleGenerateKey(e: React.FormEvent) {
    e.preventDefault()
    if (!keyLabel.trim()) return
    setSavingKey(true)
    const key = generateApiKey()
    const { error } = await supabase.from('api_keys').insert({ label: keyLabel.trim(), key })
    if (!error) {
      setNewKeyValue(key)
      setKeyLabel('')
    }
    setSavingKey(false)
    fetchData()
  }

  async function deleteApiKey(id: string) {
    await supabase.from('api_keys').delete().eq('id', id)
    setConfirmDeleteKey(null)
    fetchData()
  }

  if (loading) {
    return <div className="text-sm text-[#888888] py-8 text-center">Loading...</div>
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-lg font-semibold text-[#e8e8e8]">Settings</h1>
      </div>

      {/* Companies */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-[#888888] uppercase tracking-wider">Companies</h2>

        <form onSubmit={handleAddCompany} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-4 flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-40">
            <label className="text-xs text-[#888888] block mb-1">Name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Company name"
              className="w-full text-sm border border-[#2a2a2a] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444] bg-[#0f0f0f] text-[#e8e8e8]"
            />
          </div>
          <div>
            <label className="text-xs text-[#888888] block mb-1">Color</label>
            <div className="flex gap-1.5">
              {COLOR_OPTIONS.map(([name, hex]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setCompanyColor(name)}
                  title={name}
                  className={`w-6 h-6 rounded-full transition-transform ${companyColor === name ? 'scale-125 ring-2 ring-offset-2 ring-[#7F77DD] ring-offset-[#1c1c1c]' : 'hover:scale-110'}`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={savingCompany || !companyName.trim()}
              className="px-4 py-1.5 bg-[#7F77DD] text-white text-sm rounded hover:bg-[#6b62d0] disabled:opacity-40 transition-colors"
            >
              {editingCompany ? 'Update' : 'Add'}
            </button>
            {editingCompany && (
              <button
                type="button"
                onClick={() => { setEditingCompany(null); setCompanyName(''); setCompanyColor('teal') }}
                className="px-3 py-1.5 text-sm text-[#888888] hover:text-[#e8e8e8]"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="space-y-2">
          {companies.length === 0 && (
            <p className="text-sm text-[#888888]">No companies yet.</p>
          )}
          {companies.map((c) => {
            const color = COMPANY_COLORS[c.color] ?? '#888780'
            return (
              <div key={c.id} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-3 flex items-center gap-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-sm font-medium text-[#e8e8e8] flex-1">{c.name}</span>
                <span className="text-xs text-[#888888]">{c.color}</span>
                <button
                  onClick={() => startEditCompany(c)}
                  className="text-xs text-[#888888] hover:text-[#e8e8e8] transition-colors"
                >
                  Edit
                </button>
                {confirmDeleteCompany === c.id ? (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => deleteCompany(c.id)} className="text-xs text-red-500 hover:text-red-400 font-medium">Delete</button>
                    <button onClick={() => setConfirmDeleteCompany(null)} className="text-xs text-[#555555] hover:text-[#888888]">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteCompany(c.id)}
                    className="text-[#555555] hover:text-red-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* API Keys */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-[#888888] uppercase tracking-wider">API Keys</h2>

        <form onSubmit={handleGenerateKey} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-4 flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-[#888888] block mb-1">Label</label>
            <input
              type="text"
              value={keyLabel}
              onChange={(e) => setKeyLabel(e.target.value)}
              placeholder="e.g. Claude desktop"
              className="w-full text-sm border border-[#2a2a2a] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#7F77DD] placeholder:text-[#444444] bg-[#0f0f0f] text-[#e8e8e8]"
            />
          </div>
          <button
            type="submit"
            disabled={savingKey || !keyLabel.trim()}
            className="px-4 py-1.5 bg-[#7F77DD] text-white text-sm rounded hover:bg-[#6b62d0] disabled:opacity-40 transition-colors"
          >
            Generate
          </button>
        </form>

        {newKeyValue && (
          <div className="bg-[#0d2110] border border-green-900 rounded-lg p-4">
            <p className="text-xs text-green-400 font-medium mb-1">New API key — copy it now, it won&apos;t be shown again:</p>
            <code className="text-sm font-mono text-green-300 break-all">{newKeyValue}</code>
            <button
              onClick={() => setNewKeyValue(null)}
              className="mt-2 text-xs text-green-500 hover:text-green-300 block"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="space-y-2">
          {apiKeys.length === 0 && (
            <p className="text-sm text-[#888888]">No API keys yet.</p>
          )}
          {apiKeys.map((k) => (
            <div key={k.id} className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#e8e8e8]">{k.label}</p>
                <p className="text-xs text-[#888888] font-mono truncate">{k.key.slice(0, 12)}••••••••</p>
              </div>
              <span className="text-xs text-[#888888]">
                {new Date(k.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              {confirmDeleteKey === k.id ? (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => deleteApiKey(k.id)} className="text-xs text-red-500 hover:text-red-400 font-medium">Delete</button>
                  <button onClick={() => setConfirmDeleteKey(null)} className="text-xs text-[#555555] hover:text-[#888888]">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteKey(k.id)}
                  className="text-[#555555] hover:text-red-400 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* API Docs */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-[#888888] uppercase tracking-wider">API Reference</h2>
        <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg p-4 space-y-4">
          <p className="text-xs text-[#888888]">All endpoints require <code className="bg-[#0f0f0f] px-1 rounded font-mono text-[#e8e8e8]">x-api-key</code> header.</p>

          {[
            { method: 'POST', path: '/api/tasks', desc: 'Create a new task', body: '{ title, priority, company_id?, due_date?, notes?, link_url?, link_label? }' },
            { method: 'PATCH', path: '/api/tasks/[id]', desc: 'Update a task', body: '{ title?, priority?, status?, due_date?, notes? }' },
            { method: 'POST', path: '/api/tasks/[id]/subtasks', desc: 'Add a subtask', body: '{ title }' },
            { method: 'POST', path: '/api/radar', desc: 'Create a radar item', body: '{ titulo, descripcion?, categoria?, estado? }' },
            { method: 'GET', path: '/api/radar?search=keyword', desc: 'Search radar items', body: '' },
          ].map(({ method, path, desc, body }) => (
            <div key={path} className="border-t border-[#2a2a2a] pt-3 first:border-0 first:pt-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded ${method === 'GET' ? 'bg-[#1e1a3d] text-[#7F77DD]' : method === 'POST' ? 'bg-[#0d2110] text-green-400' : 'bg-[#2d1f00] text-amber-400'}`}>
                  {method}
                </span>
                <code className="text-xs font-mono text-[#e8e8e8]">{path}</code>
              </div>
              <p className="text-xs text-[#888888]">{desc}</p>
              {body && <pre className="text-xs text-[#888888] bg-[#0f0f0f] rounded p-2 mt-1 overflow-x-auto">{body}</pre>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
