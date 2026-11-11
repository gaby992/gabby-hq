// Fase 18: qué es "de Chelsea". Sin dependencias, para que lo usen tanto el
// canal como el panorama sin importarse en círculo.

/** Is this mail account Chelsea's? By its owner, or by its name ("IM Chelsea"). */
export function esCuentaDeChelsea(c: { nombre?: string | null; duena?: string | null }): boolean {
  return /chelsea/i.test(`${c.duena ?? ''} ${c.nombre ?? ''}`)
}

/** Is this company Chelsea's ("Chelsea", "Chelsea Personal")? */
export function esEmpresaDeChelsea(c: { name: string }): boolean {
  return /chelsea/i.test(c.name)
}
