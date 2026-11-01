import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/asistente/cron-auth'
import { enviarRecordatoriosVencidos } from '@/lib/asistente/recordatorios'

// Vercel Cron → GET here every 5 minutes (see vercel.json): sends Gabby's own
// alarms whose time has come. Same CRON_SECRET as the two daily alarms. No
// retry loop: whatever fails stays pending and the next run picks it up.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const r = await enviarRecordatoriosVencidos()
    if (r.vencidos > 0) console.log(`[recordatorios] vencidos ${r.vencidos} · enviados ${r.enviados} · fallidos ${r.fallidos}`)
    return NextResponse.json({ ok: r.fallidos === 0, ...r }, { status: r.fallidos === 0 ? 200 : 500 })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[recordatorios] error: ${error}`)
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}
