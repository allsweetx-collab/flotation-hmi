
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
