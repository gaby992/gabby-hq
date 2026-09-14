'use client'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Shown next to the label — omitted in the cramped inline edit panel. */
  hint?: string
}

/**
 * 6b/6c: the one control behind the whole "importante" axis. Shared by the
 * Add-task form and the inline edit panel so the two can't drift apart.
 */
export default function ImportanteCheckbox({ checked, onChange, hint }: Props) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none w-fit">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded border-[#2a2a2a] bg-[#0f0f0f] accent-[#EF9F27] cursor-pointer"
      />
      <span className={`text-xs font-medium ${checked ? 'text-[#EF9F27]' : 'text-[#888888]'}`}>
        ★ Importante
      </span>
      {hint && <span className="text-[10px] text-[#555555]">{hint}</span>}
    </label>
  )
}
