import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { borrarArchivos, enlaceFirmado } from '@/lib/documentos/almacen'
import { borrarDocumento } from '@/lib/documentos/buscar'
import { actualizarDocumento, documentoPorId, marcarHistorial } from '@/lib/documentos/ficha'
import { esCategoria } from '@/lib/documentos/tipos'
import { numero } from '@/lib/documentos/ficha'
import { mensajeError } from '@/lib/errores'

// Fase 14: editar, archivar en el historial o borrar un documento desde la web.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'

function fecha(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const b = await request.json().catch(() => ({}))
    // "Devolver a lo vigente" / "mandar al historial" es su propio botón.
    if (typeof b?.historial === 'boolean') {
      await marcarHistorial(params.id, b.historial)
      return NextResponse.json({ ok: true })
    }
    const cambios: Parameters<typeof actualizarDocumento>[1] = {}
    if (typeof b?.titulo === 'string' && b.titulo.trim()) cambios.titulo = b.titulo.trim().slice(0, 120)
    if (esCategoria(b?.categoria)) cambios.categoria = b.categoria
    if ('empresa_id' in (b ?? {})) cambios.empresa_id = typeof b.empresa_id === 'string' && b.empresa_id ? b.empresa_id : null
    if ('resumen' in (b ?? {})) cambios.resumen = typeof b.resumen === 'string' ? b.resumen.trim().slice(0, 600) || null : null
    if ('notas' in (b ?? {})) cambios.notas = typeof b.notas === 'string' ? b.notas.trim().slice(0, 2000) || null : null
    if ('vence' in (b ?? {})) cambios.vence = fecha(b.vence)
    if ('fecha_documento' in (b ?? {})) cambios.fecha_documento = fecha(b.fecha_documento)
    if ('monto' in (b ?? {})) cambios.monto = numero(b.monto)
    if ('moneda' in (b ?? {})) cambios.moneda = typeof b.moneda === 'string' && b.moneda.trim() ? b.moneda.trim().toUpperCase().slice(0, 6) : null
    if ('se_renueva' in (b ?? {})) cambios.se_renueva = b.se_renueva === true
    if (Object.keys(cambios).length === 0) return NextResponse.json({ error: 'nada que cambiar' }, { status: 400 })
    const d = await actualizarDocumento(params.id, cambios)
    return NextResponse.json({ ok: true, documento: { ...d, url: await enlaceFirmado(d.ruta) } })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[documentos] PATCH ${params.id}: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const d = await documentoPorId(params.id)
    if (!d) return NextResponse.json({ error: 'Ese documento ya no está.' }, { status: 404 })
    // Las páginas extra viven anotadas en `notas`; se van con el documento.
    const extra = (d.notas ?? '').match(/^Páginas: (.+)$/m)?.[1]?.split(' | ').map((s) => s.trim()) ?? []
    await borrarDocumento(d.id)
    await borrarArchivos([d.ruta, ...extra])
    return NextResponse.json({ ok: true })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[documentos] DELETE ${params.id}: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
