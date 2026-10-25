// Build: bundle src/main.js (three + kit + parts + hmi) and inline everything
// into one self-contained HTML file that opens from disk.
//   node build.mjs                       -> F:\DshWorkSpace\flotation-hmi.html
//   node build.mjs --out out/alice.html  -> alternate output for a teammate's review
//   node build.mjs --dev                 -> unminified (readable stack traces)
import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const dev = args.includes('--dev')
const outArg = opt('--out', 'F:\\DshWorkSpace\\flotation-hmi.html')
const outFile = resolve(root, outArg)

const t0 = Date.now()
let result
try {
  result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    target: ['chrome110'],
    minify: !dev,
    sourcemap: false,
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
  })
} catch (e) {
  console.error('[build] esbuild failed')
  process.exit(1)
}
const js = result.outputFiles[0].text
const css = readFileSync(resolve(root, 'src/hmi.css'), 'utf8')
const tpl = readFileSync(resolve(root, 'template.html'), 'utf8')
const html = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js)
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, html)
console.log(`[build] ${outFile}  ${(html.length / 1024).toFixed(0)} KB  ${Date.now() - t0} ms${dev ? '  (dev)' : ''}`)
