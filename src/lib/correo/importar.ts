// Fase 6-B "Importar de n8n": Gabby exports the im_reglas rows and the VIP
// list of the n8n workflow and pastes the JSON. Accepted shapes:
//   · an array of im_reglas rows: { match_tipo, match_valor, accion, alerta, activa }
//   · { vip: [...], ruido: [...], reglas: [...] } with reglas in either shape
//   · { im_reglas: [...], vip: [...] }
// Mapping: auto_chelsea → para_chelsea · auto_gabby → lo_hago_yo ·
// auto_archivar → archivar · solo_registrar → registrar. A sender/domain
// rule with `alerta: true` also goes to VIP.

import type { ReglaCorreo, ReglaCorreoAccion } from '@/types'
import { normalizarLista, normalizarReglas } from './cuentas'

const MAPA: Record<string, ReglaCorreoAccion> = {
  auto_chelsea: 'para_chelsea',
  auto_gabby: 'lo_hago_yo',
  auto_archivar: 'archivar',
  solo_registrar: 'registrar',
  vip: 'vip',
  ruido: 'ruido',
  para_chelsea: 'para_chelsea',
  lo_hago_yo: 'lo_hago_yo',
  archivar: 'archivar',
  registrar: 'registrar',
}

export interface Importado {
  vip: string[]
  ruido: string[]
  reglas: ReglaCorreo[]
  ignoradas: number
}

function esFilaN8n(r: Record<string, unknown>): boolean {
  return typeof r.match_valor === 'string' || typeof r.match_tipo === 'string'
}

export function importarDeN8n(json: unknown): Importado {
  const out: Importado = { vip: [], ruido: [], reglas: [], ignoradas: 0 }
  const obj = (Array.isArray(json) ? { reglas: json } : (json ?? {})) as Record<string, unknown>
  if (Array.isArray(obj.vip) || typeof obj.vip === 'string') out.vip.push(...normalizarLista(obj.vip as string[] | string))
  if (Array.isArray(obj.ruido) || typeof obj.ruido === 'string') out.ruido.push(...normalizarLista(obj.ruido as string[] | string))
  const filas = [...(Array.isArray(obj.reglas) ? obj.reglas : []), ...(Array.isArray(obj.im_reglas) ? obj.im_reglas : [])] as Record<string, unknown>[]
  for (const r of filas) {
    if (!r || typeof r !== 'object') {
      out.ignoradas += 1
      continue
    }
    if (esFilaN8n(r)) {
      if (r.activa === false) {
        out.ignoradas += 1
        continue
      }
      const match = String(r.match_valor ?? '').trim().toLowerCase()
      const accion = MAPA[String(r.accion ?? '').toLowerCase()]
      if (!match || !accion) {
        out.ignoradas += 1
        continue
      }
      const porRemitente = r.match_tipo === 'remitente' || r.match_tipo === 'dominio'
      if (porRemitente && r.alerta === true) out.vip.push(match)
      out.reglas.push({ match, accion, alerta: r.alerta === true })
      continue
    }
    const accion = MAPA[String(r.accion ?? '').toLowerCase()]
    const match = String(r.match ?? '').trim().toLowerCase()
    if (!match || !accion) {
      out.ignoradas += 1
      continue
    }
    out.reglas.push({ match, accion, alerta: r.alerta === true })
  }
  out.vip = normalizarLista(out.vip)
  out.ruido = normalizarLista(out.ruido)
  out.reglas = normalizarReglas(out.reglas)
  return out
}

/** Merges an import into what the account already has (nothing is removed). */
export function fusionarImport(actual: { vip: string[]; ruido: string[]; reglas: ReglaCorreo[] }, imp: Importado): { vip: string[]; ruido: string[]; reglas: ReglaCorreo[] } {
  const reglas = [...actual.reglas]
  for (const r of imp.reglas) if (!reglas.some((x) => x.match === r.match && x.accion === r.accion)) reglas.push(r)
  return { vip: normalizarLista([...actual.vip, ...imp.vip]), ruido: normalizarLista([...actual.ruido, ...imp.ruido]), reglas }
}
