/**
 * 6d: the "★" on a collapsed task card. Amber and tiny on purpose — it marks
 * what builds long-term, so it shouldn't shout over the priority badge.
 * Renders nothing when the task isn't starred.
 */
export default function ImportantBadge({ importante }: { importante?: boolean }) {
  if (!importante) return null

  return (
    <span
      title="Importante"
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-950/50 text-[#EF9F27]"
    >
      ★
    </span>
  )
}
