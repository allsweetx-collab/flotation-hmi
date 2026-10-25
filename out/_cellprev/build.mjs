// 私有预览构建（只含 external-a），用于其他部件正在编辑时独立迭代本部件。
// 用法: node out/_cellprev/build.mjs
import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['out/_cellprev/entry.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  minify: false,
  sourcemap: false,
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
})
const js = result.outputFiles[0].text
const css = readFileSync(resolve(root, 'src/hmi.css'), 'utf8')
const tpl = readFileSync(resolve(root, 'template.html'), 'utf8')
const html = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js)
const out = resolve(here, 'cellprev.html')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
console.log(`[preview] ${out}  ${(html.length / 1024).toFixed(0)} KB`)
