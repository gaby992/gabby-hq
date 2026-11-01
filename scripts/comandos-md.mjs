// Regenerates docs/comandos.md from src/lib/asistente/comandos.json.
// Same rendering as guiaMarkdown() in comandos.ts, kept in plain JS so it
// runs with `node` and no build step: `npm run comandos`.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const guia = JSON.parse(readFileSync(join(root, 'src/lib/asistente/comandos.json'), 'utf8'))

const out = [
  '# GabbyHQ — Chuleta del bot de Telegram',
  '',
  '> Generado desde `src/lib/asistente/comandos.json` con `npm run comandos`. No editar a mano.',
  '',
  guia.intro,
  '',
  'Es lo mismo que manda el bot con `/ayuda todo`. La guía técnica está en [asistente.md](asistente.md).',
  '',
]
for (const s of guia.secciones) {
  out.push(`## ${s.emoji} ${s.titulo}`, '')
  for (const l of s.lineas) out.push(`- \`${l.ejemplo}\` — ${l.que}`)
  out.push('')
}
writeFileSync(join(root, 'docs/comandos.md'), out.join('\n'))
console.log('docs/comandos.md actualizado')
