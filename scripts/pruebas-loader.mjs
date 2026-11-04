// Node loader for scripts/pruebas-parser.mjs: resolves "@/…" to src/, adds
// .ts/.tsx, transpiles .tsx with the repo's TypeScript (node strips plain
// .ts types by itself). No build step, no test framework: `npm run pruebas`.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src') + '/'
const ts = createRequire(join(ROOT, 'package.json'))('typescript')

function conExt(p) {
  for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
    const f = p + ext
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier === 'next/og') return { url: pathToFileURL(join(ROOT, 'node_modules/next/og.js')).href, shortCircuit: true }
  if (specifier.startsWith('@/')) {
    const f = conExt(SRC + specifier.slice(2))
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.includes(SRC)) {
    const f = conExt(decodeURIComponent(new URL(specifier, context.parentURL).pathname))
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true }
  }
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.endsWith('.tsx')) {
    const out = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: fileURLToPath(url),
    })
    return { format: 'module', source: out.outputText, shortCircuit: true }
  }
  return next(url, context)
}
