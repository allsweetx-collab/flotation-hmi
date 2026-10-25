// Isolated HMI harness: bundles src/hmi.js + real sim.js WITHOUT the 3D scene,
// so panel layout can be verified while other members edit parts/.
import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hmi = readFileSync(resolve(root, 'src/hmi.js'), 'utf8')
  .replace("import { clamp } from './kit/lab-kit.js'", 'const clamp = (v, a, b) => Math.min(b, Math.max(a, v))')
writeFileSync(resolve(root, 'out/_hmi_mock.js'), hmi)

const entry = `
import { createSim } from '../src/sim.js'
import { createHMI } from './_hmi_mock.js'
const sim = createSim()
const world = {
  parts: new Map([['cell', { label: '浮选槽' }], ['camera', { label: '视觉相机' }]]),
  xrayOn: false, cutValue: 0,
}
let hmi
const actions = {
  flow: (a) => a === 'feed' ? sim.feed() : a === 'dose' ? sim.dose() : a === 'flotate' ? sim.flotate() : (sim.reset(), true),
  toggleXray: () => { world.xrayOn = !world.xrayOn; hmi.syncState() },
  setXray: (v) => { world.xrayOn = v; hmi.syncState() },
  setCut: (v) => { world.cutValue = v; hmi.syncState() },
  setLight: (v) => sim.setLight(v),
  clearSelection: () => hmi.setSelection(null),
}
hmi = createHMI({ sim, world, actions, state: { get xrayOn() { return world.xrayOn }, get cutValue() { return world.cutValue } } })
window.__HMI = {
  ready: true, sim, world, hmi,
  stats: () => ({ process: sim.process, selected: hmi.selected, xray: world.xrayOn, cut: world.cutValue, fps: 60 }),
  select: (id) => hmi.setSelection(id), flow: (a) => actions.flow(a),
  xray: actions.setXray, cut: actions.setCut,
}
document.getElementById('boot').style.display = 'none'
let last = performance.now()
function frame(now) { const dt = Math.min((now - last) / 1000, 0.05); last = now; sim.update(dt); hmi.tick(dt); requestAnimationFrame(frame) }
requestAnimationFrame(frame)
`
writeFileSync(resolve(root, 'out/_mock_entry.js'), entry)
const result = await esbuild.build({
  absWorkingDir: root, entryPoints: ['out/_mock_entry.js'], bundle: true, format: 'iife',
  target: ['chrome110'], minify: false, write: false, legalComments: 'none', logLevel: 'error',
})
const css = readFileSync(resolve(root, 'src/hmi.css'), 'utf8')
const tpl = readFileSync(resolve(root, 'template.html'), 'utf8')
const html = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => result.outputFiles[0].text)
writeFileSync(resolve(root, 'out/hmi_mock.html'), html)
console.log('[mock] out/hmi_mock.html', (html.length / 1024).toFixed(0) + ' KB')
