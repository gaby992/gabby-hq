import { NextResponse } from 'next/server'
import { isValidSession } from '@/lib/session'
import { cargarEmpresas } from '@/lib/asistente/tareas'
import { enlacesFirmados } from '@/lib/documentos/almacen'
import { listarDocumentos } from '@/lib/documentos/buscar'
import { guardarArchivo } from '@/lib/documentos/entrada'
import { guardarDocumento, limpiarPropuesta, proponerFicha } from '@/lib/documentos/ficha'
import { CATEGORIAS, WEB_MAX_BYTES, TIPOS_ACEPTADOS, esCategoria, type Documento } from '@/lib/documentos/tipos'
import { cancunYmd } from '@/lib/asistente/cancun'
import { mensajeError } from '@/lib/errores'

// Fase 14: the Archivos screen. GET lists (with a signed link per row, one
// hour), POST takes an upload — the file goes to the private bucket, its text
// is read, the model fills the ficha and the row is saved right away, because
// here she is looking at the screen and can fix it in place (that is what the
// PATCH is for). Telegram is the one that asks first.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const categoria = url.searchParams.get('categoria')
  try {
    const [{ filas, total }, empresas] = await Promise.all([
      listarDocumentos({
        q: url.searchParams.get('q'),
        categoria: esCategoria(categoria) ? categoria : null,
        empresa_id: url.searchParams.get('empresa') || null,
        historial: url.searchParams.get('historial') === '1',
        max: 200,
      }),
      cargarEmpresas(),
    ])
    const firmas = await enlacesFirmados(filas.map((d) => d.ruta))
    return NextResponse.json({
      filas: filas.map((d) => ({ ...d, url: d.ruta ? firmas.get(d.ruta) ?? null : null })),
      total,
      empresas: empresas.map((e) => ({ id: e.id, name: e.name.trim() })),
      categorias: CATEGORIAS,
      hoy: cancunYmd(),
    })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[documentos] GET: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!(await isValidSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const form = await request.formData()
    const nota = String(form.get('nota') ?? '').trim()
    const archivos = form.getAll('archivos').filter((f): f is File => f instanceof File && f.size > 0)

    // "Guardar un dato" — no file at all.
    if (archivos.length === 0) {
      if (nota.length < 8) return NextResponse.json({ error: 'Sube un archivo o escribe el dato que quieres guardar.' }, { status: 400 })
      const empresas = await cargarEmpresas()
      const propuesta = await proponerFicha({ texto: nota, pista: nota, empresas, esNota: true }).catch(() =>
        limpiarPropuesta({}, { pista: nota, empresas: empresas.map((e) => e.name.trim()), hoy: cancunYmd() })
      )
      const d = await guardarDocumento({ propuesta, archivos: [], empresas, origen: 'web' })
      return NextResponse.json({ ok: true, documentos: [d] })
    }

    for (const f of archivos) {
      if (f.size > WEB_MAX_BYTES) {
        return NextResponse.json({ error: `«${f.name}» pesa más de ${Math.round(WEB_MAX_BYTES / (1024 * 1024))} MB.` }, { status: 400 })
      }
      if (!TIPOS_ACEPTADOS.includes(f.type)) {
        return NextResponse.json({ error: `«${f.name}» es un ${f.type || 'archivo desconocido'}: por ahora solo PDF y fotos.` }, { status: 400 })
      }
    }

    const empresas = await cargarEmpresas()
    // "Son páginas de un mismo documento" → una sola ficha con todos los archivos.
    const juntos = String(form.get('juntos') ?? '') === '1' && archivos.length > 1
    const guardados = await Promise.all(archivos.map(async (f) => guardarArchivo({ bytes: await f.arrayBuffer(), nombre: f.name, tipo: f.type })))
    const grupos = juntos ? [guardados] : guardados.map((g) => [g])

    const out: Documento[] = []
    for (const grupo of grupos) {
      const texto = grupo.map((g) => g.texto ?? '').filter(Boolean).join('\n\n--- página ---\n\n')
      const propuesta = await proponerFicha({
        texto: texto || nota,
        nombreArchivo: grupo[0].nombre,
        pista: nota || null,
        empresas,
      }).catch(() => limpiarPropuesta({}, { pista: nota, nombreArchivo: grupo[0].nombre, empresas: empresas.map((e) => e.name.trim()), hoy: cancunYmd() }))
      out.push(await guardarDocumento({ propuesta, archivos: grupo, empresas, origen: 'web' }))
    }
    return NextResponse.json({ ok: true, documentos: out })
  } catch (err) {
    const error = mensajeError(err)
    console.error(`[documentos] POST: ${error}`)
    return NextResponse.json({ error }, { status: 500 })
  }
}
