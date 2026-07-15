import InboxTabs from '@/components/InboxTabs'

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <InboxTabs />
      {children}
    </div>
  )
}
