// 有色冶金视觉浮选系统 · 3D 工业 HMI
// Renderer / studio lighting / picking / selection / x-ray / cut / loop.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { clamp, lerp, MAT, GEO } from './kit/lab-kit.js'
import { createWorld } from './world.js'
import { createSim } from './sim.js'
import { buildExternalA } from './parts/external-a.js'
import { buildExternalB } from './parts/external-b.js'
import { buildExternalC } from './parts/external-c.js'
import { buildCabinet } from './parts/cabinet.js'
import { createHMI } from './hmi.js'

const boot = document.getElementById('boot')
const canvas = document.getElementById('gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.12
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.localClippingEnabled = true

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x090c0f)
scene.fog = new THREE.FogExp2(0x090c0f, 0.022)

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 120)
camera.position.set(3.4, 5.75, 6.0)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(-0.05, 1.5, 0.02)
controls.enableDamping = true
controls.dampingFactor = 0.075
controls.rotateSpeed = 0.62
controls.zoomSpeed = 0.8
controls.panSpeed = 0.6
controls.screenSpacePanning = true
controls.minDistance = 4.2
controls.maxDistance = 15.5
controls.minPolarAngle = THREE.MathUtils.degToRad(16)
controls.maxPolarAngle = THREE.MathUtils.degToRad(84)
controls.update()

// ------------------------------------------------------------------ environment map (dark industrial studio)
function environmentScene() {
  const s = new THREE.Scene()
  s.background = new THREE.Color(0x0c1218)
  const panel = (w, h, color, pos, rot, power = 1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }))
    m.material.color.multiplyScalar(power)
    m.position.set(...pos)
    m.rotation.set(...rot)
    s.add(m)
  }
  // cool overhead softboxes
  panel(7, 2.2, new THREE.Color(0x9dc4e8), [0, 6, 0], [Math.PI / 2, 0, 0], 2.8)
  panel(5, 1.2, new THREE.Color(0x6f93b8), [-4, 4, -4], [Math.PI / 2.4, 0.6, 0], 1.5)
  panel(4, 1.0, new THREE.Color(0x53707f), [4, 3, -3], [Math.PI / 2.2, -0.5, 0], 1.1)
  // warm floor bounce
  panel(6, 3, new THREE.Color(0x5a3a24), [0, -1, 0], [-Math.PI / 2, 0, 0], 0.9)
  // front / side softboxes: what flat metal faces reflect toward the default camera
  panel(10, 4.5, new THREE.Color(0x8fb4d4), [0, 3.2, 10], [0, Math.PI, 0], 1.7)
  panel(4.5, 4, new THREE.Color(0x5f7f96), [-8, 3.2, 4], [0, Math.PI / 2, 0], 1.0)
  panel(4.5, 4, new THREE.Color(0x6d8fa6), [8, 3.2, 4], [0, -Math.PI / 2, 0], 1.0)
  return s
}
{
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const env = pmrem.fromScene(environmentScene(), 0.06)
  scene.environment = env.texture
  pmrem.dispose()
}

// ------------------------------------------------------------------ lights
const hemi = new THREE.HemisphereLight(0xa8c6e0, 0x0b0e11, 0.45)
scene.add(hemi)

const key = new THREE.DirectionalLight(0xd8e6ff, 2.6)
key.position.set(6.5, 9.5, 6.0)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.near = 0.5
key.shadow.camera.far = 30
key.shadow.camera.left = -7
key.shadow.camera.right = 7
key.shadow.camera.top = 7
key.shadow.camera.bottom = -7
key.shadow.bias = -0.0006
key.shadow.normalBias = 0.018
key.shadow.radius = 2.5
scene.add(key)
scene.add(key.target)
key.target.position.set(0, 1, 0)

const fill = new THREE.DirectionalLight(0xffc99a, 0.5)
fill.position.set(-7, 4.2, 4.5)
scene.add(fill)

// frontal fill so dark metal faces still read from the default camera
const frontFill = new THREE.DirectionalLight(0xb9d4e8, 1.45)
frontFill.position.set(1.5, 3.2, 9)
scene.add(frontFill)

const rim = new THREE.SpotLight(0x4fa8d8, 18, 22, 0.62, 0.55, 1.6)
rim.position.set(-4.5, 5.5, -7.5)
rim.target.position.set(0, 1.6, 0)
scene.add(rim)
scene.add(rim.target)

const underGlow = new THREE.PointLight(0x2b7d8c, 1.5, 7.5, 2)
underGlow.position.set(0, 0.25, 0.4)
scene.add(underGlow)

// warm light inside the cell: hints at the slurry and lights the froth from below
const cellLight = new THREE.PointLight(0xffb173, 1.6, 2.6, 2)
cellLight.position.set(0, 2.28, 0.05)
scene.add(cellLight)

// ------------------------------------------------------------------ atmosphere: gradient dome + haze
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(70, 32, 20),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { cTop: { value: new THREE.Color(0x04070a) }, cBottom: { value: new THREE.Color(0x0a1117) }, cGlow: { value: new THREE.Color(0x143039) } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 cTop, cBottom, cGlow; varying vec3 vP;
      void main(){ float h = clamp(vP.y / 70.0 * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(cBottom, cTop, pow(h, 0.75));
        float glow = exp(-pow((h - 0.40) * 6.0, 2.0));
        c += cGlow * glow * 0.85;
        gl_FragColor = vec4(c, 1.0); }`,
  })
)
sky.frustumCulled = false
scene.add(sky)

function hazeTexture() {
  const S = 512
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(S / 2, S * 0.55, 10, S / 2, S * 0.55, S * 0.5)
  gr.addColorStop(0, 'rgba(90,170,185,0.5)')
  gr.addColorStop(0.5, 'rgba(40,90,105,0.16)')
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr; g.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
const haze = new THREE.Mesh(new THREE.PlaneGeometry(52, 22), new THREE.MeshBasicMaterial({ map: hazeTexture(), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }))
haze.position.set(0, 4.5, -14.5)
scene.add(haze)

// overhead linear lights
for (const [y, z, w, col] of [[8.4, -3.2, 16, 0x3f7480], [9.0, -6.8, 22, 0x2c5560]]) {
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.06), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }))
  strip.position.set(0, y, z)
  scene.add(strip)
}

// ------------------------------------------------------------------ floor + industrial backdrop
function floorTexture() {
  const S = 512
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#0e1216'; g.fillRect(0, 0, S, S)
  // fine noise
  for (let i = 0; i < 2600; i++) { const v = 10 + Math.random() * 22; g.fillStyle = `rgba(${v},${v + 2},${v + 4},0.5)`; g.fillRect(Math.random() * S, Math.random() * S, 2, 2) }
  // grating: parallel slats + cross ties
  for (let y = 0; y < S; y += 32) {
    g.fillStyle = '#1b2229'; g.fillRect(0, y, S, 7)
    g.fillStyle = '#070a0c'; g.fillRect(0, y + 9, S, 5)
    g.strokeStyle = 'rgba(120,150,160,0.10)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y + 1); g.lineTo(S, y + 1); g.stroke()
    for (let x = 0; x < S; x += 128) { g.fillStyle = '#242d35'; g.fillRect(x, y, 6, 18) }
  }
  for (let x = 0; x < S; x += 128) { g.fillStyle = '#141a20'; g.fillRect(x, 0, 5, S) }
  // panel bolts
  for (let x = 64; x < S; x += 128) for (let y = 64; y < S; y += 128) { g.fillStyle = '#39434c'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill() }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(18, 18)
  t.anisotropy = renderer.capabilities.getMaxAnisotropy()
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const floorMap = floorTexture()
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(90, 90),
  new THREE.MeshStandardMaterial({ map: floorMap, color: 0x6d7a82, roughness: 0.8, metalness: 0.35, envMapIntensity: 0.5 })
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

// faint radial flood under the rig
function radialTexture(inner = 'rgba(120,190,200,0.35)', outer = 'rgba(0,0,0,0)') {
  const S = 256
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2)
  gr.addColorStop(0, inner); gr.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.12)')); gr.addColorStop(1, outer)
  g.fillStyle = gr; g.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
const pool = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.28 }))
pool.rotation.x = -Math.PI / 2
pool.position.set(0.3, 0.01, 0.2)
scene.add(pool)

// yellow safety marking painted on the floor around the rig
function markingTexture() {
  const S = 512
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  g.clearRect(0, 0, S, S)
  g.strokeStyle = 'rgba(214,168,58,0.85)'; g.lineWidth = 10; g.setLineDash([26, 16])
  g.strokeRect(14, 14, S - 28, S - 28)
  g.setLineDash([])
  g.strokeStyle = 'rgba(214,168,58,0.5)'; g.lineWidth = 5
  for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S]]) {
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (x ? -60 : 60), y); g.stroke()
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + (y ? -60 : 60)); g.stroke()
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
const marking = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 4.4), new THREE.MeshBasicMaterial({ map: markingTexture(), transparent: true, opacity: 0.35, depthWrite: false }))
marking.rotation.x = -Math.PI / 2
marking.position.set(0.1, 0.014, 0.1)
scene.add(marking)

// distant factory silhouettes: columns, overhead pipes, faint warning lights
const bg = new THREE.Group()
scene.add(bg)
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x10161b, roughness: 0.75, metalness: 0.55, envMapIntensity: 0.25 })
const darkMetal2 = new THREE.MeshStandardMaterial({ color: 0x0c1116, roughness: 0.85, metalness: 0.35, envMapIntensity: 0.2 })
for (let i = -4; i <= 4; i++) {
  const col = new THREE.Mesh(new THREE.BoxGeometry(0.65, 11, 0.65), darkMetal)
  col.position.set(i * 3.1, 5.5, -12.5 + (i % 2) * 0.8)
  bg.add(col)
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.95), darkMetal2)
  cap.position.set(col.position.x, 10.6, col.position.z)
  bg.add(cap)
}
for (let k = 0; k < 3; k++) {
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14 + k * 0.05, 0.14 + k * 0.05, 36, 14), darkMetal)
  pipe.rotation.z = Math.PI / 2
  pipe.position.set(0, 6.4 + k * 0.55, -13.7 - k * 0.4)
  bg.add(pipe)
}
for (let k = -3; k <= 3; k++) {
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), new THREE.MeshBasicMaterial({ color: k % 2 ? 0x2f7f86 : 0x9c6a2a, toneMapped: false }))
  lamp.position.set(k * 3.0, 5.2, -12.1)
  bg.add(lamp)
}
// overhead cable trays
for (let k = 0; k < 2; k++) {
  const tray = new THREE.Mesh(new THREE.BoxGeometry(30, 0.12, 0.5), darkMetal2)
  tray.position.set(0, 8.2 + k * 0.5, -9.5 - k * 1.2)
  bg.add(tray)
}
// distant tank silhouettes + pipe bridges, just enough to read "plant" through the haze
for (const [x, z, r, h] of [[-8.5, -8.6, 1.3, 4.2], [8.2, -9.4, 1.1, 3.6], [-6.5, -13, 1.8, 5.2]]) {
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28), darkMetal)
  tank.position.set(x, h / 2, z)
  bg.add(tank)
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.08, 28), darkMetal2)
  lid.position.set(x, h, z)
  bg.add(lid)
  const rail = new THREE.Mesh(new THREE.TorusGeometry(r + 0.02, 0.035, 6, 28), darkMetal2)
  rail.rotation.x = Math.PI / 2; rail.position.set(x, h - 0.35, z); bg.add(rail)
}
for (let k = 0; k < 2; k++) {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 0.3), darkMetal2)
  beam.position.set(0, 5.9 + k * 0.8, -10.5 - k * 1.6)
  bg.add(beam)
}

// ------------------------------------------------------------------ post processing
const composer = new EffectComposer(renderer)
composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
composer.setSize(window.innerWidth, window.innerHeight)
composer.addPass(new RenderPass(scene, camera))

const outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera)
outlinePass.edgeStrength = 2.5
outlinePass.edgeGlow = 0.22
outlinePass.edgeThickness = 1.2
outlinePass.pulsePeriod = 0
outlinePass.visibleEdgeColor.set(0x49e8d2)
outlinePass.hiddenEdgeColor.set(0x06110f)
composer.addPass(outlinePass)

const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.34, 0.55, 0.88)
composer.addPass(bloom)

composer.addPass(new OutputPass())

// ------------------------------------------------------------------ world + parts
const labelHost = document.getElementById('labels')
const world = createWorld(scene, labelHost)
const sim = createSim()
world.sim = sim

buildExternalA(world)
buildExternalB(world)
buildExternalC(world)
buildCabinet(world)

// keep the dark industrial look: cap environment contribution on all PBR materials
scene.traverse((o) => {
  if (!o.isMesh) return
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  for (const m of mats) if (m && m.isMeshStandardMaterial) m.envMapIntensity = Math.min(m.envMapIntensity ?? 1, 1.25)
})

// ------------------------------------------------------------------ selection
let syncXrayUI = () => {}
let syncCutUI = () => {}
function flowAction(a) {
  let ok = false
  if (a === 'feed') ok = sim.feed()
  else if (a === 'dose') ok = sim.dose()
  else if (a === 'flotate') ok = sim.flotate()
  else if (a === 'reset') { sim.reset(); selectPart(null); ok = true }
  return ok
}
function setXray(on) {
  world.setXray(on)
  if (!on && world.selected && world.selected.internal) selectPart(null)
  syncXrayUI()
  syncCutUI()
}
function setCut(v) {
  world.setCut(v)
  if (v > 0.001 && world.xrayOn) { world.setXray(false); syncXrayUI() }
  if (v <= 0.001 && world.selected && world.selected.internal && !world.xrayOn) selectPart(null)
  syncCutUI()
  syncXrayUI()
}

function selectPart(partOrId) {
  const id = typeof partOrId === 'string' ? partOrId : partOrId?.id ?? null
  const part = id ? world.parts.get(id) || null : null
  world.select(part)
  outlinePass.selectedObjects = part && part.group ? [part.group] : []
  hmi.setSelection(part ? part.id : null)
  if (part) sim.pulse(part.id)
}
world.onSelect = () => {}

// ------------------------------------------------------------------ HMI
let hmi
hmi = createHMI({
  sim,
  world,
  actions: {
    flow: flowAction,
    setXray,
    toggleXray: () => setXray(!world.xrayOn),
    setCut,
    setLight: (v) => sim.setLight(v),
    clearSelection: () => selectPart(null),
  },
  state: {
    get xrayOn() { return world.xrayOn },
    get cutValue() { return world.cutValue },
  },
})

// ------------------------------------------------------------------ pointer picking
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let down = null
let hoverTimer = 0
const setPointer = (e) => {
  const r = renderer.domElement.getBoundingClientRect()
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  down = { x: e.clientX, y: e.clientY, t: performance.now() }
})
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !down) return
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
  const held = performance.now() - down.t
  down = null
  if (moved > 6 || held > 900) return
  setPointer(e)
  raycaster.setFromCamera(pointer, camera)
  raycaster.far = 60
  const hit = world.pick(raycaster)
  if (hit) selectPart(hit.part)
  else selectPart(null)
})
renderer.domElement.addEventListener('pointermove', (e) => {
  const now = performance.now()
  if (now - hoverTimer > 90) {
    hoverTimer = now
    setPointer(e)
    raycaster.setFromCamera(pointer, camera)
    raycaster.far = 60
    const hit = world.pick(raycaster)
    renderer.domElement.style.cursor = hit ? 'pointer' : 'grab'
  }
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { selectPart(null) }
  else if (e.key === 'p' || e.key === 'P') setXray(!world.xrayOn)
})

// ------------------------------------------------------------------ resize
function resize() {
  const w = window.innerWidth, h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  composer.setSize(w, h)
  outlinePass.setSize(w, h)
  bloom.setSize(w, h)
}
window.addEventListener('resize', resize)

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock()
let fpsFrames = 0
let fpsTime = 0
let fps = 60
let firstFrame = true
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1)
  sim.update(dt)
  world.update(dt)
  world.updateCut(camera, controls.target)
  world.updateLabels(camera)
  controls.target.x = clamp(controls.target.x, -2.6, 2.6)
  controls.target.z = clamp(controls.target.z, -2.6, 2.6)
  controls.target.y = clamp(controls.target.y, 0.4, 3.2)
  controls.update()
  hmi.tick(dt)
  composer.render()
  fpsFrames++; fpsTime += dt
  if (fpsTime > 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0 }
  if (firstFrame) {
    firstFrame = false
    boot.classList.add('done')
    setTimeout(() => { boot.style.display = 'none' }, 900)
    window.__HMI.ready = true
  }
  requestAnimationFrame(frame)
}

// sync HMI buttons with xray/cut toggled by keyboard or 3D
syncXrayUI = () => hmi?.syncState?.()
syncCutUI = () => hmi?.syncState?.()

window.__HMI = {
  ready: false,
  THREE, sim, world, scene, camera, renderer, controls,
  stats: () => ({
    fps,
    parts: world.parts.size,
    tris: renderer.info.render.triangles,
    calls: renderer.info.render.calls,
    xray: world.xrayOn,
    cut: world.cutValue,
    process: sim.process,
    selected: world.selected?.id || null,
  }),
  select: (id) => selectPart(id),
  flow: (a) => flowAction(a),
  xray: (on) => setXray(on),
  cut: (v) => setCut(v),
  shadow: (on) => { renderer.shadowMap.enabled = on; scene.traverse((o) => { if (!o.material) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m) m.needsUpdate = true }) },
  // projected centre of a part (for true pointer-click tests)
  screenOf: (id) => {
    const p = world.parts.get(id)
    if (!p) return null
    const box = new THREE.Box3().setFromObject(p.group)
    const v = box.getCenter(new THREE.Vector3()).project(camera)
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, z: v.z }
  },
  pickAt: (x, y) => {
    pointer.x = (x / window.innerWidth) * 2 - 1
    pointer.y = -(y / window.innerHeight) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    raycaster.far = 60
    const hit = world.pick(raycaster)
    return hit ? hit.part.id : null
  },
  setCamera: (pos, target) => { camera.position.set(...pos); controls.target.set(...target); controls.update() },
  view: (az, el, dist) => {
    const t = controls.target
    const r = dist ?? camera.position.distanceTo(t)
    camera.position.set(t.x + r * Math.sin(THREE.MathUtils.degToRad(az)) * Math.cos(THREE.MathUtils.degToRad(el)), t.y + r * Math.sin(THREE.MathUtils.degToRad(el)), t.z + r * Math.cos(THREE.MathUtils.degToRad(az)) * Math.cos(THREE.MathUtils.degToRad(el)))
    controls.update()
  },
}

frame()
