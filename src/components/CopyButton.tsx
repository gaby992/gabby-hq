'use client'

import { useState } from 'react'

interface Props {
  // Either a static string or a getter (evaluated at click time for fresh data).
  text: string | (() => string)
  label?: string
  className?: string
}

export default function CopyButton({ text, label = 'Copy', className }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    const value = typeof text === 'function' ? text() : text
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — fail quietly.
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={
        className ??
        'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-[#2a2a2a] hover:bg-[#333333] text-[#888888] hover:text-[#e8e8e8] transition-colors'
      }
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        {copied ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        )}
      </svg>
      {copied ? 'Copied' : label}
    </button>
  )
}
