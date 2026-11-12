import { NextResponse } from 'next/server'
import { atender, llaveValida } from '@/lib/mcp'

// Fase 19: el conector de Claude. MCP remoto por "Streamable HTTP" sin estado:
// cada POST trae un mensaje JSON-RPC (o un lote) y se contesta en JSON.
// La llave va en la URL; sin ella, 404 (como si no existiera).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
}

function noExiste() {
  return new NextResponse('Not found', { status: 404 })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(request: Request, { params }: { params: { llave: string } }) {
  if (!llaveValida(params.llave)) return noExiste()
  const cuerpo = await request.json().catch(() => undefined)
  if (cuerpo === undefined) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS })
  }
  if (Array.isArray(cuerpo)) {
    const respuestas = (await Promise.all(cuerpo.map((m) => atender(m ?? {})))).filter((r) => r !== null)
    if (respuestas.length === 0) return new NextResponse(null, { status: 202, headers: CORS })
    return NextResponse.json(respuestas, { headers: CORS })
  }
  const r = await atender(cuerpo ?? {})
  // A notification (or a response from the client) has nothing to answer.
  if (r === null) return new NextResponse(null, { status: 202, headers: CORS })
  return NextResponse.json(r, { headers: CORS })
}

// No server-initiated stream and no sessions: the spec's answer for both is 405.
export async function GET(_request: Request, { params }: { params: { llave: string } }) {
  if (!llaveValida(params.llave)) return noExiste()
  return new NextResponse('Method Not Allowed', { status: 405, headers: { ...CORS, Allow: 'POST' } })
}

export async function DELETE(_request: Request, { params }: { params: { llave: string } }) {
  if (!llaveValida(params.llave)) return noExiste()
  return new NextResponse('Method Not Allowed', { status: 405, headers: { ...CORS, Allow: 'POST' } })
}
