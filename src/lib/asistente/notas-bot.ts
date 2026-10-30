// "nota IM: …" from Telegram → the same upsert /hoy and /tasks use.

import { createServerClient } from '@/lib/supabase-server'
import { deleteNota, saveNota } from '@/lib/notas'
import type { NotaParsed } from '@/lib/parser'
import type { NotaEmpresa } from '@/types'

export const USO_NOTA =
  'Formato: nota IM: texto (reemplaza) · nota IM + línea (agrega al final) · nota IM: (borra)'

/** Runs a note command whose company is already known. Returns the one-line confirmation. */
export async function ejecutarNota(n: NotaParsed): Promise<string> {
  if (!n.company_id || !n.company_name) throw new Error('ejecutarNota sin empresa')
  const db = createServerClient()

  if (n.modo === 'borrar') {
    const { error } = await deleteNota(n.company_id, db)
    if (error) throw new Error(`Supabase notas_empresa: ${error.message}`)
    return `📝 Nota de ${n.company_name} borrada`
  }

  let texto = n.texto
  if (n.modo === 'agregar') {
    const { data, error } = await db
      .from('notas_empresa')
      .select('*')
      .eq('company_id', n.company_id)
      .maybeSingle<NotaEmpresa>()
    if (error) throw new Error(`Supabase notas_empresa: ${error.message}`)
    const actual = data?.nota?.trim() ?? ''
    texto = actual ? `${actual}\n${n.texto}` : n.texto
  }

  const { data, error } = await saveNota(n.company_id, texto, db)
  if (error) throw new Error(`Supabase notas_empresa: ${error.message}`)
  const lineas = (data?.nota ?? texto).split('\n').filter((l) => l.trim()).length
  return `📝 Nota de ${n.company_name} guardada (${lineas} ${lineas === 1 ? 'línea' : 'líneas'})`
}
