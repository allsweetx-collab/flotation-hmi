// 外部机组 A：浮选槽主体 / 矿浆液面 / 泡沫层 / 检修平台 / 药剂阀组 / 锡矿石
// 契约要点：只读 sim；几何与材质只创建一次；所有动画统一挂在 world.onFrame，不每帧 new。
// 坐标严格按 contract.md 第 1 节：槽体 x[-1,1] z[-0.85,0.85] y[0.55,2.35]，液面 y≈2.16。
import * as THREE from 'three'
import { MAT, GEO, clamp, lerp, rng } from '../kit/lab-kit.js'

// ------------------------------------------------------------------ 尺寸
const W = 2.0, D = 1.7                     // 槽体外廓
const T = 0.045                            // 壁厚
const BOT = 0.55, TOP = 2.35               // 槽底 / 槽口
const WALL_H = TOP - (BOT + T)             // 侧壁净高
const WALL_Y = BOT + T + WALL_H / 2
const LIQ_Y = 2.16                         // 矿浆液面
const IN_W = W - 2 * T, IN_D = D - 2 * T   // 内腔 1.91 × 1.61
const DECK_Y = 0.52                        // 检修格栅平台面
const GRATE_TILE = 0.22                    // 格栅贴图一个循环对应多少米
// 药剂阀中心（契约 (-1.16, 1.52, 0.35)）
const VX = -1.16, VY = 1.52, VZ = 0.35
// 落矿点 / 加药注入点（液面扰动中心）
const ORE_X = 0.15, ORE_Z = 0.15
const DOSE_X = -0.73, DOSE_Z = 0.55

const smooth01 = (x) => { const t = clamp(x); return t * t * (3 - 2 * t) }

// ------------------------------------------------------------------ 程序贴图
function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  return c
}
function toTex(c, { srgb = true, repeat = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  t.anisotropy = 8
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  return t
}

// 检修平台格栅：程序生成，带透明孔洞（alphaTest），不是一整块平板
function makeGratingTex() {
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d')
  g.clearRect(0, 0, S, S)
  // 承载扁钢（竖向），带高光边和暗缝，做出厚度感
  const pitch = 28, bar = 9
  for (let x = 2; x < S; x += pitch) {
    const gr = g.createLinearGradient(x, 0, x + bar, 0)
    gr.addColorStop(0, '#191d21'); gr.addColorStop(0.28, '#575f66'); gr.addColorStop(0.62, '#343a40'); gr.addColorStop(1, '#121518')
    g.fillStyle = gr; g.fillRect(x, 0, bar, S)
    g.fillStyle = 'rgba(170,184,190,0.26)'; g.fillRect(x + 1, 0, 1.5, S)
  }
  // 横向绞条（每 1/4 张图一条）
  for (let y = 14; y < S; y += 64) {
    g.fillStyle = '#363d43'; g.fillRect(0, y, S, 9)
    g.fillStyle = 'rgba(180,192,198,0.28)'; g.fillRect(0, y + 1, S, 2)
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, y + 8, S, 3)
  }
  // 轻微锈迹/污渍
  const R = rng(91)
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${70 + R() * 30 | 0},${52 + R() * 20 | 0},${38 + R() * 16 | 0},${0.05 + R() * 0.10})`
    g.fillRect(R() * S, R() * S, 2 + R() * 14, 1 + R() * 4)
  }
  return toTex(c, { srgb: true })
}

// 外壁液位刻度：0.8–2.2 m，主刻度 0.2 m，副刻度 0.05 m
function makeLevelTex() {
  const w = 160, h = 896, c = makeCanvas(w, h), g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  g.strokeStyle = 'rgba(210,220,216,0.88)'
  g.fillStyle = 'rgba(214,223,219,0.94)'
  g.lineWidth = 3
  g.textBaseline = 'middle'
  g.textAlign = 'right'
  g.font = '600 30px "Segoe UI", Arial, sans-serif'
  g.beginPath(); g.moveTo(w - 16, 12); g.lineTo(w - 16, h - 12); g.stroke()
  for (let i = 0; i <= 28; i++) {
    const t = i / 28
    const y = h - 12 - t * (h - 24)
    const major = i % 4 === 0
    g.lineWidth = major ? 3.2 : 1.7
    g.beginPath(); g.moveTo(w - 16, y); g.lineTo(w - 16 - (major ? 42 : 21), y); g.stroke()
    if (major) g.fillText((0.8 + t * 1.4).toFixed(1), w - 68, y)
  }
  g.font = '600 25px "Segoe UI", Arial, sans-serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.save(); g.translate(22, h / 2); g.rotate(-Math.PI / 2); g.fillText('液位 / m', 0, 0); g.restore()
  return toTex(c)
}

// 铭牌
function makeNameTex() {
  const w = 512, h = 256, c = makeCanvas(w, h), g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  g.strokeStyle = 'rgba(196,206,202,0.72)'; g.lineWidth = 3
  g.strokeRect(12, 12, w - 24, h - 24)
  g.strokeStyle = 'rgba(196,206,202,0.35)'; g.lineWidth = 1.5
  g.strokeRect(22, 22, w - 44, h - 44)
  g.fillStyle = 'rgba(226,234,230,0.95)'
  g.font = '700 62px "Microsoft YaHei", "Segoe UI", sans-serif'
  g.fillText('浮选槽', 46, 92)
  g.fillStyle = 'rgba(170,182,178,0.92)'
  g.font = '600 28px "Segoe UI", Arial, sans-serif'
  g.fillText('FLOTATION CELL', 46, 134)
  g.fillStyle = 'rgba(206,216,212,0.9)'
  g.font = '500 27px "Segoe UI", Arial, sans-serif'
  g.fillText('SN-01 · 2.0 m³', 46, 182)
  g.fillStyle = 'rgba(150,162,158,0.9)'
  g.font = '500 23px "Segoe UI", Arial, sans-serif'
  g.fillText('Q235B · 316L 内衬 · 常温', 46, 218)
  return toTex(c)
}

// 警示标识
function makeWarnTex() {
  const w = 512, h = 128, c = makeCanvas(w, h), g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  g.strokeStyle = 'rgba(255,184,77,0.92)'; g.lineWidth = 4
  g.beginPath(); g.moveTo(26, 104); g.lineTo(62, 26); g.lineTo(98, 104); g.closePath(); g.stroke()
  g.fillStyle = 'rgba(255,184,77,0.95)'
  g.font = '700 26px "Segoe UI", Arial, sans-serif'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText('!', 62, 82)
  g.textAlign = 'left'
  g.font = '600 40px "Microsoft YaHei", "Segoe UI", sans-serif'
  g.fillText('当心 高温矿浆', 122, 66)
  g.font = '500 21px "Segoe UI", Arial, sans-serif'
  g.fillStyle = 'rgba(255,184,77,0.62)'
  g.fillText('HOT PULP · 运行中禁止靠近', 124, 100)
  return toTex(c)
}

// 泡沫层贴图：凹凸（气泡团簇，强对比）+ 极低对比度的米色斑驳，不要照片感
function makeFoamTextures() {
  const S = 512
  const bump = makeCanvas(S, S), color = makeCanvas(S, S)
  const gb = bump.getContext('2d'), gc = color.getContext('2d')
  gb.fillStyle = '#8a8a8a'; gb.fillRect(0, 0, S, S)
  gc.fillStyle = '#f2f2f2'; gc.fillRect(0, 0, S, S)
  const R = rng(311)
  // 大尺度斑驳（泡沫床的不均匀）
  for (let i = 0; i < 26; i++) {
    const r = 40 + R() * 110
    const x = R() * S, y = R() * S
    const gr = gc.createRadialGradient(x, y, 0, x, y, r)
    const v = 214 + R() * 34 | 0
    gr.addColorStop(0, `rgba(${v},${v},${v},0.5)`)
    gr.addColorStop(1, `rgba(${v},${v},${v},0)`)
    gc.fillStyle = gr; gc.fillRect(x - r, y - r, 2 * r, 2 * r)
  }
  for (let i = 0; i < 420; i++) {
    const r = 5 + R() * 32
    const x = R() * S, y = R() * S
    // 凹凸：暗环 + 亮顶，模拟相邻气泡的泡壁
    const gr = gb.createRadialGradient(x - r * 0.3, y - r * 0.34, r * 0.1, x, y, r)
    const v = 120 + R() * 105 | 0
    gr.addColorStop(0, `rgba(${Math.min(255, v + 60)},${Math.min(255, v + 60)},${Math.min(255, v + 60)},0.95)`)
    gr.addColorStop(0.55, `rgba(${v},${v},${v},0.85)`)
    gr.addColorStop(0.82, `rgba(${Math.max(0, v - 110)},${Math.max(0, v - 110)},${Math.max(0, v - 110)},0.85)`)
    gr.addColorStop(1, 'rgba(120,120,120,0)')
    gb.fillStyle = gr
    gb.beginPath(); gb.arc(x, y, r, 0, Math.PI * 2); gb.fill()
    // 颜色：气泡只留极淡的明暗
    const gr2 = gc.createRadialGradient(x - r * 0.3, y - r * 0.34, r * 0.1, x, y, r)
    gr2.addColorStop(0, 'rgba(255,255,255,0.45)')
    gr2.addColorStop(0.6, 'rgba(226,226,226,0.16)')
    gr2.addColorStop(0.86, 'rgba(168,168,168,0.34)')
    gr2.addColorStop(1, 'rgba(242,242,242,0)')
    gc.fillStyle = gr2
    gc.beginPath(); gc.arc(x, y, r, 0, Math.PI * 2); gc.fill()
  }
  const d = gb.getImageData(0, 0, S, S)
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (R() - 0.5) * 34
    d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n
  }
  gb.putImageData(d, 0, 0)
  return {
    bump: toTex(bump, { srgb: false, repeat: [5, 5] }),
    color: toTex(color, { srgb: true, repeat: [5, 5] }),
  }
}

// ------------------------------------------------------------------ 静态几何工具
const boxGeo = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g }
const rotBoxGeo = (w, h, d, x, y, z, rx) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.translate(x, y, z); return g }
const cylGeo = (r, h, seg, x, y, z) => { const g = new THREE.CylinderGeometry(r, r, h, seg); g.translate(x, y, z); return g }
const tubeXGeo = (rOut, rIn, len, seg, x, y, z) => { const g = GEO.tube(rOut, rIn, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g }
const tubeZGeo = (rOut, rIn, len, seg, x, y, z) => { const g = GEO.tube(rOut, rIn, len, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z); return g }
const discXGeo = (r, h, seg, x, y, z) => { const g = GEO.disc(r, h, 0.006, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g }
const discYGeo = (r, h, seg, x, y, z) => { const g = GEO.disc(r, h, 0.006, seg); g.translate(x, y, z); return g }
const discZGeo = (r, h, seg, x, y, z) => { const g = GEO.disc(r, h, 0.006, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z); return g }
const boltsYGeo = (n, R, size, len, x, y, z) => {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const g = new THREE.CylinderGeometry(size, size, len, 6)
    g.translate(x + R * Math.cos(a), y, z + R * Math.sin(a))
    out.push(g)
  }
  return GEO.merge(out)
}
const boltsXGeo = (n, R, size, len, x, y, z) => {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const g = new THREE.CylinderGeometry(size, size, len, 6)
    g.rotateZ(Math.PI / 2)
    g.translate(x, y + R * Math.cos(a), z + R * Math.sin(a))
    out.push(g)
  }
  return GEO.merge(out)
}
const boltsZGeo = (n, R, size, len, x, y, z) => {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const g = new THREE.CylinderGeometry(size, size, len, 6)
    g.rotateX(Math.PI / 2)
    g.translate(x + R * Math.cos(a), y + R * Math.sin(a), z)
    out.push(g)
  }
  return GEO.merge(out)
}

// ------------------------------------------------------------------ 主构建
export function buildExternalA(world) {
  const sim = world.sim

  // ================================================================ 材质
  // 注意：kit 的 color 是线性 albedo；深灰/炭黑要用 0.02–0.08。
  // 深色环境下大面积金属若 metalness≈1 会接近纯黑（没有漫反射），实测取 0.6–0.7 保留少量金属反射。
  const M = {
    shell: MAT.steelDark({ color: [0.082, 0.088, 0.097], roughness: 0.46, metalness: 0.68, finish: 'cast', rep: [3, 3], envMapIntensity: 1.35 }),
    rib: MAT.steelDark({ color: [0.098, 0.104, 0.114], roughness: 0.52, metalness: 0.62, finish: 'cast', rep: [2, 4], envMapIntensity: 1.15 }),
    rim: MAT.steel({ color: [0.21, 0.22, 0.235], roughness: 0.34, metalness: 0.82, finish: 'turned', rep: [1, 10], envMapIntensity: 1.35 }),
    steel: MAT.stainless({ color: [0.40, 0.41, 0.415], roughness: 0.28, metalness: 0.88, envMapIntensity: 1.3 }),
    panel: MAT.steel({ color: [0.145, 0.152, 0.162], roughness: 0.4, metalness: 0.6, finish: 'brushed', rep: [2, 2], envMapIntensity: 1.1 }),
    liner: MAT.steelDark({ color: [0.032, 0.035, 0.038], roughness: 0.6, metalness: 0.45, finish: 'cast', rep: [2, 2], envMapIntensity: 0.75 }),
    dark: MAT.steelDark({ color: [0.035, 0.038, 0.043], roughness: 0.6, metalness: 0.5, finish: 'cast', rep: [2, 2], envMapIntensity: 0.9 }),
    rubber: MAT.rubber({ color: [0.02, 0.021, 0.023] }),
    paint: MAT.paint({ color: [0.155, 0.032, 0.022], roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    ore: MAT.castIron({ color: [0.09, 0.075, 0.057], roughness: 0.44, metalness: 0.7, finish: 'cast', envMapIntensity: 1.2 }),
  }

  const grateTex = makeGratingTex()
  const grateMat = new THREE.MeshStandardMaterial({
    map: grateTex, color: 0xffffff, metalness: 0.45, roughness: 0.66,
    alphaTest: 0.45, side: THREE.DoubleSide, envMapIntensity: 0.85,
  })

  const foamTex = makeFoamTextures()

  // ================================================================ 浮选槽本体
  const cell = new THREE.Group()
  cell.name = 'cell'
  // 机架/平台单独成组：不注册 pickable，避免选中槽体时 OutlinePass 把整块平台一起描边
  const base = new THREE.Group()
  base.name = 'cell-base'

  // 静态件按材质分桶，最后各合并成一个 Mesh（控制 draw call）
  const bin = { shell: [], rib: [], rim: [], panel: [], liner: [], steel: [], dark: [], paint: [] }
  const bbin = { dark: [], steel: [] }
  const add = (k, g) => { bin[k].push(g); return g }
  const addB = (k, g) => { bbin[k].push(g); return g }

  // ---- 槽底 / 四壁（顶部开口）
  add('shell', boxGeo(W, T, D, 0, BOT + T / 2, 0))
  add('shell', boxGeo(W, WALL_H, T, 0, WALL_Y, D / 2 - T / 2))
  add('shell', boxGeo(W, WALL_H, T, 0, WALL_Y, -(D / 2 - T / 2)))
  add('shell', boxGeo(T, WALL_H, D - 2 * T, -(W / 2 - T / 2), WALL_Y, 0))
  add('shell', boxGeo(T, WALL_H, D - 2 * T, W / 2 - T / 2, WALL_Y, 0))
  // ---- 316L 内衬（更暗更粗糙，避免内壁反光过亮；液面/泡沫在其内侧）
  {
    const LIN = 0.008
    const lh = TOP - (BOT + T) - 0.022
    const ly = BOT + T + lh / 2
    add('liner', boxGeo(LIN, lh, IN_D, W / 2 - T - LIN / 2, ly, 0))
    add('liner', boxGeo(LIN, lh, IN_D, -(W / 2 - T - LIN / 2), ly, 0))
    add('liner', boxGeo(IN_W, lh, LIN, 0, ly, D / 2 - T - LIN / 2))
    add('liner', boxGeo(IN_W, lh, LIN, 0, ly, -(D / 2 - T - LIN / 2)))
    add('liner', boxGeo(IN_W - 2 * LIN, LIN, IN_D - 2 * LIN, 0, BOT + T + LIN / 2, 0))
  }
  // 槽底与壁的焊缝（外侧一圈，略凸出的焊道）
  add('rib', cylGeo(0.0095, W - 0.1, 8, 0, BOT + T + 0.002, D / 2 + 0.001))
  add('rib', cylGeo(0.0095, W - 0.1, 8, 0, BOT + T + 0.002, -(D / 2 + 0.001)))
  add('rib', cylGeo(0.0095, D - 0.1, 8, W / 2 + 0.001, BOT + T + 0.002, 0))
  add('rib', cylGeo(0.0095, D - 0.1, 8, -(W / 2 + 0.001), BOT + T + 0.002, 0))

  // ---- 四角角钢立柱（外凸，形成硬朗轮廓）
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add('rib', boxGeo(0.075, WALL_H + 0.04, 0.075, sx * (W / 2 - 0.027), WALL_Y, sz * (D / 2 - 0.027)))
  }
  // ---- 竖向加强筋
  for (const sx of [-1, 1]) {
    add('rib', boxGeo(0.09, WALL_H - 0.12, 0.038, sx * 0.36, WALL_Y, D / 2 + 0.019))
    add('rib', boxGeo(0.09, WALL_H - 0.12, 0.038, sx * 0.36, WALL_Y, -(D / 2 + 0.019)))
  }
  for (const sz of [-1, 1]) {
    add('rib', boxGeo(0.038, WALL_H - 0.12, 0.09, W / 2 + 0.019, WALL_Y, sz * 0.44))
    add('rib', boxGeo(0.038, WALL_H - 0.12, 0.09, -(W / 2 + 0.019), WALL_Y, sz * 0.44))
  }
  // ---- 两道横向加强箍
  for (const y of [1.06, 1.92]) {
    add('rib', boxGeo(W + 0.02, 0.09, 0.036, 0, y, D / 2 + 0.018))
    add('rib', boxGeo(W + 0.02, 0.09, 0.036, 0, y, -(D / 2 + 0.018)))
    add('rib', boxGeo(0.036, 0.09, D + 0.02, W / 2 + 0.018, y, 0))
    add('rib', boxGeo(0.036, 0.09, D + 0.02, -(W / 2 + 0.018), y, 0))
  }

  // ---- 顶部口沿（平整的机加工环板 + 一圈螺栓）
  add('rim', boxGeo(W + 0.10, 0.05, 0.10, 0, TOP + 0.025, D / 2))
  add('rim', boxGeo(W + 0.10, 0.05, 0.10, 0, TOP + 0.025, -(D / 2)))
  add('rim', boxGeo(0.10, 0.05, D, W / 2, TOP + 0.025, 0))
  add('rim', boxGeo(0.10, 0.05, D, -(W / 2), TOP + 0.025, 0))
  for (let i = 0; i < 21; i++) {
    const x = -0.95 + i * 0.095
    add('steel', cylGeo(0.0115, 0.014, 6, x, TOP + 0.055, D / 2 + 0.005))
    add('steel', cylGeo(0.0115, 0.014, 6, x, TOP + 0.055, -(D / 2 + 0.005)))
  }
  for (let i = 0; i < 15; i++) {
    const z = -0.78 + i * 0.1115
    add('steel', cylGeo(0.0115, 0.014, 6, W / 2 + 0.005, TOP + 0.055, z))
    add('steel', cylGeo(0.0115, 0.014, 6, -(W / 2 + 0.005), TOP + 0.055, z))
  }

  // ---- 进料口（左上侧，法兰 + 螺栓）
  add('steel', tubeXGeo(0.078, 0.062, 0.20, 32, -(W / 2 + 0.085), 2.02, -0.35))
  add('steel', discXGeo(0.112, 0.028, 32, -(W / 2 + 0.19), 2.02, -0.35))
  add('steel', boltsXGeo(8, 0.083, 0.0105, 0.02, -(W / 2 + 0.20), 2.02, -0.35))
  // ---- 进气口（左下侧，接气泵软管；内接槽底曝气总管）
  add('steel', tubeXGeo(0.056, 0.042, 0.18, 28, -(W / 2 + 0.075), 0.78, -0.24))
  add('steel', discXGeo(0.085, 0.024, 28, -(W / 2 + 0.17), 0.78, -0.24))
  add('steel', boltsXGeo(6, 0.062, 0.0095, 0.018, -(W / 2 + 0.18), 0.78, -0.24))
  // ---- 尾矿/排空口（右侧下部，法兰 + 盲板）
  add('steel', tubeXGeo(0.062, 0.048, 0.18, 28, W / 2 + 0.075, 0.72, -0.42))
  add('steel', discXGeo(0.092, 0.026, 28, W / 2 + 0.17, 0.72, -0.42))
  add('steel', boltsXGeo(6, 0.068, 0.0095, 0.018, W / 2 + 0.18, 0.72, -0.42))

  // ---- 槽内曝气总管（透视 / 剖切时可见），经进气口穿入
  add('steel', tubeXGeo(0.032, 0.0, 1.72, 18, 0, 0.80, -0.15))
  for (let i = 0; i < 9; i++) {
    const x = -0.72 + i * 0.18
    add('steel', cylGeo(0.0105, 0.055, 10, x, 0.835, -0.15))
  }
  {
    const g = GEO.pipe([[-0.86, 0.80, -0.15], [-0.93, 0.792, -0.19], [-0.97, 0.785, -0.225]], 0.028, { seg: 24, radial: 10 })
    add('steel', g)
  }

  // ---- 槽内泡沫挡板（靠近后壁，液面以上，兼作尾矿溢流挡板）
  add('steel', boxGeo(1.86, 0.24, 0.018, 0, 2.22, -0.60))
  add('steel', boxGeo(1.86, 0.028, 0.05, 0, 2.348, -0.60))
  for (const x of [-0.68, 0, 0.68]) add('steel', boxGeo(0.05, 0.03, 0.19, x, 2.30, -0.70))

  // ---- 前侧溢流唇口（泡沫翻过口沿落入刮板接矿溜槽，与刮板呼应）
  const lipTilt = 0.15
  add('rim', rotBoxGeo(1.52, 0.014, 0.20, 0, 2.315, 0.945, lipTilt))
  add('rim', rotBoxGeo(0.014, 0.085, 0.20, 0.756, 2.345, 0.945, lipTilt))
  add('rim', rotBoxGeo(0.014, 0.085, 0.20, -0.756, 2.345, 0.945, lipTilt))
  for (const x of [-0.55, 0, 0.55]) add('rim', rotBoxGeo(0.04, 0.022, 0.13, x, 2.30, 0.965, lipTilt))

  // ---- 外壁液位刻度（离壁架高，避开加强箍）
  add('dark', boxGeo(0.30, 1.46, 0.008, 0.56, 1.50, 0.900))
  add('dark', boxGeo(0.07, 0.02, 0.05, 0.56, 0.86, 0.872))
  add('dark', boxGeo(0.07, 0.02, 0.05, 0.56, 2.14, 0.872))
  // ---- 铭牌底座
  add('dark', boxGeo(0.38, 0.20, 0.008, -0.62, 1.25, 0.856))
  for (const [dx, dy] of [[-0.17, 0.09], [0.17, 0.09], [-0.17, -0.09], [0.17, -0.09]]) add('steel', cylGeo(0.006, 0.008, 8, -0.62 + dx, 1.25 + dy, 0.862))

  // ---- 前壁检修人孔盖（浅色拉丝面板 + 一圈螺栓 + 把手），提供明暗对比
  add('panel', boxGeo(0.54, 0.50, 0.020, 0, 1.46, 0.860))
  add('panel', boxGeo(0.46, 0.42, 0.010, 0, 1.46, 0.874))
  for (let i = 0; i < 7; i++) {
    const x = -0.21 + i * 0.07
    add('steel', cylGeo(0.0085, 0.014, 6, x, 1.68, 0.868))
    add('steel', cylGeo(0.0085, 0.014, 6, x, 1.24, 0.868))
  }
  for (let i = 0; i < 5; i++) {
    const y = 1.30 + i * 0.08
    add('steel', cylGeo(0.0085, 0.014, 6, -0.24, y, 0.868))
    add('steel', cylGeo(0.0085, 0.014, 6, 0.24, y, 0.868))
  }
  add('steel', boxGeo(0.16, 0.016, 0.016, 0, 1.46, 0.890))
  add('steel', cylGeo(0.008, 0.026, 10, -0.06, 1.46, 0.878))
  add('steel', cylGeo(0.008, 0.026, 10, 0.06, 1.46, 0.878))

  // ---- 前壁下部取样阀（小法兰 + 球阀 + 红色手柄），近平台操作高度
  add('rim', boxGeo(0.11, 0.11, 0.014, 0.28, 0.82, 0.858))
  add('steel', tubeZGeo(0.026, 0.016, 0.085, 18, 0.28, 0.82, 0.900))
  add('steel', discZGeo(0.048, 0.020, 20, 0.28, 0.82, 0.945))
  add('steel', discZGeo(0.040, 0.055, 18, 0.28, 0.82, 0.978))
  add('steel', discZGeo(0.012, 0.034, 10, 0.28, 0.826, 1.008))
  add('paint', boxGeo(0.130, 0.013, 0.016, 0.348, 0.826, 1.006))

  // ---- 现场液位计（玻璃管 + 上下接管 + 卡箍），可直观读出液位
  const glassZ = 0.945
  add('steel', tubeZGeo(0.020, 0.012, 0.115, 20, 0.80, 0.97, 0.892))
  add('steel', tubeZGeo(0.020, 0.012, 0.115, 20, 0.80, 2.24, 0.892))
  add('steel', discZGeo(0.045, 0.020, 24, 0.80, 0.97, 0.858))
  add('steel', discZGeo(0.045, 0.020, 24, 0.80, 2.24, 0.858))
  for (const y of [1.30, 1.70]) {
    add('dark', boxGeo(0.05, 0.024, 0.10, 0.80, y, 0.897))
    add('steel', new THREE.TorusGeometry(0.030, 0.0055, 6, 16).rotateX(Math.PI / 2).translate(0.80, y, glassZ))
  }
  for (const y of [0.97, 2.24]) add('steel', cylGeo(0.025, 0.045, 16, 0.80, y, glassZ))

  // ---- 现场状态灯（口沿上，青绿/琥珀随流程）
  add('dark', boxGeo(0.072, 0.045, 0.072, 0.72, TOP + 0.062, 0.85))
  add('steel', cylGeo(0.030, 0.020, 16, 0.72, TOP + 0.090, 0.85))

  // ---- 支撑腿 / 底架（槽底以下，归入独立静态组 base）
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addB('dark', boxGeo(0.10, BOT - 0.012, 0.10, sx * 0.82, (BOT - 0.012) / 2 + 0.006, sz * 0.56))
    addB('dark', boxGeo(0.17, 0.016, 0.17, sx * 0.82, 0.009, sz * 0.56))
    addB('steel', boltsYGeo(4, 0.052, 0.007, 0.012, sx * 0.82, 0.022, sz * 0.56))
  }
  addB('dark', boxGeo(1.90, 0.13, 0.12, 0, 0.49, 0.55))
  addB('dark', boxGeo(1.90, 0.13, 0.12, 0, 0.49, -0.55))
  addB('dark', boxGeo(0.12, 0.10, 1.12, 0.82, 0.485, 0))
  addB('dark', boxGeo(0.12, 0.10, 1.12, -0.82, 0.485, 0))
  addB('dark', boxGeo(1.66, 0.05, 0.05, 0, 0.17, 0.56))
  addB('dark', boxGeo(1.66, 0.05, 0.05, 0, 0.17, -0.56))
  addB('dark', boxGeo(0.05, 0.05, 1.12, 0.82, 0.17, 0))
  addB('dark', boxGeo(0.05, 0.05, 1.12, -0.82, 0.17, 0))

  // ---- 检修平台骨架（L 形环槽体的格栅走道）
  const frameRect = (cx, cz, w, d) => {
    addB('dark', boxGeo(w, 0.10, 0.06, cx, DECK_Y - 0.05, cz - d / 2))
    addB('dark', boxGeo(w, 0.10, 0.06, cx, DECK_Y - 0.05, cz + d / 2))
    addB('dark', boxGeo(0.06, 0.10, d, cx - w / 2, DECK_Y - 0.05, cz))
    addB('dark', boxGeo(0.06, 0.10, d, cx + w / 2, DECK_Y - 0.05, cz))
  }
  frameRect(0, 1.18, 3.10, 0.56)     // 前侧走道 z 0.90–1.46
  frameRect(1.30, 0, 0.50, 1.80)     // 右侧走道 x 1.05–1.55
  frameRect(-1.30, 0, 0.50, 1.80)    // 左侧走道 x -1.55–-1.05
  for (const x of [-1.2, -0.7, -0.2, 0.3, 0.8, 1.3]) addB('dark', boxGeo(0.05, 0.07, 0.56, x, DECK_Y - 0.075, 1.18))
  for (const z of [-0.55, 0, 0.55]) {
    addB('dark', boxGeo(0.50, 0.07, 0.05, 1.30, DECK_Y - 0.075, z))
    addB('dark', boxGeo(0.50, 0.07, 0.05, -1.30, DECK_Y - 0.075, z))
  }
  // 平台立柱 + 地脚板
  for (const [px, pz] of [[-1.52, 1.43], [1.52, 1.43], [-0.55, 1.43], [0.55, 1.43], [-1.52, 0.30], [1.52, 0.30], [-1.52, -0.86], [1.52, -0.86]]) {
    addB('dark', boxGeo(0.07, DECK_Y - 0.03, 0.07, px, (DECK_Y - 0.03) / 2 + 0.02, pz))
    addB('dark', boxGeo(0.15, 0.016, 0.15, px, 0.008, pz))
    addB('steel', boltsYGeo(4, 0.052, 0.007, 0.012, px, 0.022, pz))
  }
  // 踢脚板（外沿）
  addB('dark', boxGeo(3.10, 0.085, 0.012, 0, DECK_Y + 0.043, 1.466))
  addB('dark', boxGeo(0.012, 0.085, 1.80, 1.556, DECK_Y + 0.043, 0))
  addB('dark', boxGeo(0.012, 0.085, 1.80, -1.556, DECK_Y + 0.043, 0))
  addB('dark', boxGeo(0.50, 0.085, 0.012, 1.30, DECK_Y + 0.043, -0.906))
  addB('dark', boxGeo(0.50, 0.085, 0.012, -1.30, DECK_Y + 0.043, -0.906))

  // ---- 合并静态件
  const addMerged = (group, key, bins, mat, opts = {}) => {
    const list = bins[key]
    if (!list || !list.length) return null
    bins[key] = []
    const mesh = new THREE.Mesh(GEO.merge(list), mat)
    mesh.castShadow = opts.cast !== false
    mesh.receiveShadow = opts.receive !== false
    group.add(mesh)
    return mesh
  }
  addMerged(cell, 'shell', bin, M.shell)
  addMerged(cell, 'rib', bin, M.rib)
  addMerged(cell, 'rim', bin, M.rim)
  addMerged(cell, 'panel', bin, M.panel)
  addMerged(cell, 'liner', bin, M.liner)
  addMerged(cell, 'steel', bin, M.steel)
  addMerged(cell, 'paint', bin, M.paint)
  addMerged(cell, 'dark', bin, M.dark)
  addMerged(base, 'dark', bbin, M.dark)
  addMerged(base, 'steel', bbin, M.steel)
  world.root.add(base)

  // ---- 平台格栅（程序生成透明格栅纹理，三块拼接）
  const deckGeo = (w, d, x, z) => {
    const g = new THREE.PlaneGeometry(w, d)
    g.rotateX(-Math.PI / 2)
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / GRATE_TILE, uv.getY(i) * d / GRATE_TILE)
    g.translate(x, DECK_Y, z)
    return g
  }
  for (const [w, d, x, z] of [[3.10, 0.56, 0, 1.18], [0.50, 1.80, 1.30, 0], [0.50, 1.80, -1.30, 0]]) {
    const m = new THREE.Mesh(deckGeo(w, d, x, z), grateMat)
    m.receiveShadow = true
    m.castShadow = false
    base.add(m)
  }

  // ---- 液位刻度 / 铭牌 / 警示标识（CanvasTexture 贴片）
  const decal = (tex, w, h, x, y, z, order = 4) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xdfe6e2,
    }))
    m.position.set(x, y, z)
    m.renderOrder = order
    cell.add(m)
    return m
  }
  decal(makeLevelTex(), 0.26, 1.40, 0.56, 1.50, 0.907)
  decal(makeNameTex(), 0.34, 0.17, -0.62, 1.25, 0.862)
  decal(makeWarnTex(), 0.36, 0.09, -0.60, 1.60, 0.862)

  // ---- 现场液位计玻璃管与管内矿浆
  const gaugeGlassMat = new THREE.MeshPhysicalMaterial({
    color: [0.16, 0.18, 0.178], roughness: 0.09, metalness: 0.0, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.1, clearcoat: 0.6, clearcoatRoughness: 0.06,
  })
  const gg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.28, 20, 1, true), gaugeGlassMat)
  gg.position.set(0.80, 1.63, glassZ)
  gg.renderOrder = 6
  cell.add(gg)
  const gaugePulpMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.032, 0.026, 0.019), roughness: 0.24, metalness: 0.05, envMapIntensity: 1.4 })
  const gp = new THREE.Mesh(new THREE.CylinderGeometry(0.0185, 0.0185, 1.16, 20), gaugePulpMat)
  gp.position.set(0.80, 1.57, glassZ)
  cell.add(gp)
  const men = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.006, 20), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.10, 0.078, 0.05), roughness: 0.3, metalness: 0.1 }))
  men.position.set(0.80, 2.152, glassZ)
  cell.add(men)

  // ---- 状态灯灯芯 + 电缆
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x0a1a18, toneMapped: false })
  const led = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.026, 16), ledMat)
  led.position.set(0.72, TOP + 0.108, 0.85)
  cell.add(led)
  const cable = new THREE.Mesh(GEO.pipe([
    [0.72, TOP + 0.045, 0.86], [0.72, 2.37, 0.892], [0.72, 2.08, 0.896],
    [0.72, 1.72, 0.896], [0.72, 1.58, 0.882],
  ], 0.0065, { seg: 40, radial: 8 }), M.rubber)
  cable.castShadow = false
  cell.add(cable)
  const jb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.10, 0.036), M.dark)
  jb.position.set(0.72, 1.52, 0.868)
  jb.castShadow = true
  cell.add(jb)

  // ================================================================ 矿浆液面
  const SEGX = 40, SEGZ = 34, NX = SEGX + 1
  const liqGeo = new THREE.PlaneGeometry(1.880, 1.580, SEGX, SEGZ)
  liqGeo.rotateX(-Math.PI / 2)
  const liqMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.021, 0.017, 0.012),
    roughness: 0.3, metalness: 0.0, clearcoat: 0.55, clearcoatRoughness: 0.18,
    transparent: true, opacity: 0.87, depthWrite: false, side: THREE.DoubleSide,
    envMapIntensity: 0.55,
  })
  const liquid = new THREE.Mesh(liqGeo, liqMat)
  liquid.position.y = LIQ_Y
  liquid.renderOrder = 2
  liquid.receiveShadow = false
  cell.add(liquid)
  const lPos = liqGeo.attributes.position
  const lArr = lPos.array
  const lNrm = liqGeo.attributes.normal.array
  const LSTEP = 1.880 / SEGX, LSTEPZ = 1.580 / SEGZ
  const LIQ_BASE = new THREE.Color(0.021, 0.017, 0.012)
  const LIQ_TINT = new THREE.Color(0.033, 0.023, 0.011)

  // ================================================================ 泡沫层
  const FSX = 42, FSZ = 36, FNX = FSX + 1
  const foamGeo = new THREE.PlaneGeometry(1.868, 1.568, FSX, FSZ)
  foamGeo.rotateX(-Math.PI / 2)
  const foamMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.38, 0.335, 0.25), map: foamTex.color, roughness: 0.92, metalness: 0.0,
    sheen: 0.25, sheenColor: new THREE.Color(0.48, 0.44, 0.33), sheenRoughness: 0.85,
    bumpMap: foamTex.bump, bumpScale: 0.035,
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    envMapIntensity: 0.5,
  })
  const foam = new THREE.Mesh(foamGeo, foamMat)
  foam.position.y = LIQ_Y
  foam.renderOrder = 3
  foam.visible = false
  foam.receiveShadow = true
  cell.add(foam)
  const fPos = foamGeo.attributes.position
  const fArr = fPos.array
  const fNrm = foamGeo.attributes.normal.array
  const FSTEP = 1.868 / FSX, FSTEPZ = 1.568 / FSZ
  const F_HX = 0.934, F_HZ = 0.784

  // ================================================================ 浮出泡沫面的气泡
  // 少量 InstancedMesh 小球：从泡沫层里浮出、鼓胀、破裂，表现泡沫持续从矿浆中生成
  const BUB_N = 16
  const bubX = new Float32Array(BUB_N)
  const bubZ = new Float32Array(BUB_N)
  const bubR = new Float32Array(BUB_N)
  const bubPh = new Float32Array(BUB_N)
  {
    const R = rng(507)
    for (let i = 0; i < BUB_N; i++) {
      bubX[i] = (R() - 0.5) * 1.62
      bubZ[i] = -0.50 + R() * 1.16
      bubR[i] = 0.012 + R() * 0.020
      bubPh[i] = R()
    }
  }
  const bubMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.60, 0.545, 0.42), roughness: 0.30, metalness: 0.0,
    sheen: 0.65, sheenColor: new THREE.Color(0.72, 0.66, 0.50), sheenRoughness: 0.45,
    transparent: true, opacity: 0.88, depthWrite: false, envMapIntensity: 0.7,
  })
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), bubMat, BUB_N)
  bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  bubbles.frustumCulled = false
  bubbles.visible = false
  bubbles.renderOrder = 5
  cell.add(bubbles)

  // ================================================================ 极简飞溅（落矿/扰动时）
  const SPL_N = 12
  const splDir = new Float32Array(SPL_N * 2)
  const splVy = new Float32Array(SPL_N)
  const splVr = new Float32Array(SPL_N)
  const splSz = new Float32Array(SPL_N)
  {
    const R = rng(29)
    for (let i = 0; i < SPL_N; i++) {
      const a = (i / SPL_N) * Math.PI * 2 + R() * 0.6
      splDir[i * 2] = Math.cos(a); splDir[i * 2 + 1] = Math.sin(a)
      splVy[i] = 0.45 + R() * 0.75
      splVr[i] = 0.05 + R() * 0.26
      splSz[i] = 0.55 + R() * 0.75
    }
  }
  const splMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.16, 0.115, 0.07), roughness: 0.22, metalness: 0.15,
    transparent: true, opacity: 0.9, envMapIntensity: 1.2,
  })
  const splash = new THREE.InstancedMesh(new THREE.SphereGeometry(0.013, 8, 6), splMat, SPL_N)
  splash.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  splash.frustumCulled = false
  splash.visible = false
  splash.castShadow = false
  cell.add(splash)

  // ================================================================ 注册 cell
  world.addPart('cell', cell, {
    label: '浮选槽',
    htmlLabel: '浮选槽 · 2.0 m³',
    anchor: [0.02, 2.88, 0.22],
    bounds: [[-1.06, 0.52, -0.92], [1.06, 2.42, 0.92]],
    xrayMats: [M.shell, M.rib, M.rim, M.panel, M.liner],
    cutMats: [M.shell, M.rib, M.rim, M.panel, M.liner],
  })
  world.root.add(cell)

  // ================================================================ 锡矿石
  const oreGroup = new THREE.Group()
  oreGroup.position.set(ORE_X, 3.4, ORE_Z)
  const oreGeo = new THREE.IcosahedronGeometry(0.145, 1)
  {
    const p = oreGeo.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize()
      const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453
      const f = h - Math.floor(h)
      const s = 0.74 + f * 0.46
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.9, p.getZ(i) * s)
    }
    oreGeo.computeVertexNormals()
  }
  const oreBody = new THREE.Mesh(oreGeo, M.ore)
  oreBody.castShadow = true
  oreBody.receiveShadow = true
  oreGroup.add(oreBody)
  const oreChip = new THREE.Mesh(oreGeo, M.ore)
  oreChip.castShadow = true
  oreChip.scale.setScalar(0.5)
  oreChip.position.set(0.125, 0.05, -0.085)
  oreChip.rotation.set(0.7, 1.9, 0.4)
  oreGroup.add(oreChip)
  oreGroup.visible = false
  world.addPart('ore', oreGroup, { label: '锡矿石', pickable: false })
  world.root.add(oreGroup)

  // ================================================================ 药剂阀组（手轮 + 管路 + 注入细流）
  const valve = new THREE.Group()
  valve.name = 'valve'
  valve.position.set(VX, VY, VZ)
  // 阀组独立材质：不和槽体共享可变材质，避免透视/剖切互相串
  const VM = {
    rim: MAT.steel({ color: [0.21, 0.22, 0.235], roughness: 0.34, metalness: 0.82, finish: 'turned', rep: [1, 10], envMapIntensity: 1.35 }),
    steel: MAT.stainless({ color: [0.405, 0.415, 0.42], roughness: 0.28, metalness: 0.88, envMapIntensity: 1.3 }),
    dark: MAT.steelDark({ color: [0.035, 0.038, 0.043], roughness: 0.6, metalness: 0.5, finish: 'cast', rep: [2, 2], envMapIntensity: 0.9 }),
    paint: MAT.paint({ color: [0.155, 0.032, 0.022], roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
  }
  const vb = { steel: [], dark: [], rim: [] }
  const vadd = (k, g) => { vb[k].push(g); return g }
  // 阀体（阀轴沿 Z，避免与槽壁打架）
  {
    const body = GEO.lathe([
      [0, -0.086], [0.048, -0.086], [0.077, -0.052], [0.086, -0.012],
      [0.086, 0.028], [0.070, 0.058], [0.050, 0.078], [0, 0.078],
    ], 40)
    body.rotateX(Math.PI / 2)
    body.translate(0, 0, 0)
    vadd('rim', body)
  }
  vadd('steel', tubeZGeo(0.052, 0.040, 0.14, 28, 0, 0, 0.105))
  vadd('steel', tubeZGeo(0.052, 0.040, 0.14, 28, 0, 0, -0.105))
  vadd('steel', discZGeo(0.078, 0.024, 28, 0, 0, 0.176))
  vadd('steel', discZGeo(0.078, 0.024, 28, 0, 0, -0.176))
  vadd('steel', boltsZGeo(8, 0.058, 0.009, 0.018, 0, 0, 0.190))
  vadd('steel', boltsZGeo(8, 0.058, 0.009, 0.018, 0, 0, -0.190))
  // 阀盖 / 填料压盖 / 阀杆
  vadd('rim', cylGeo(0.048, 0.10, 28, 0, 0.095, 0))
  vadd('steel', cylGeo(0.038, 0.030, 6, 0, 0.152, 0))
  vadd('steel', cylGeo(0.030, 0.028, 6, 0, 0.184, 0))
  // 上游供液管：顶部盲法兰接管 → 沿槽外侧下行 → 水平进入阀体
  const supplyPts = [
    [-0.46, 1.10, -0.97], [-0.24, 1.11, -0.97], [-0.04, 1.10, -0.97], [0, 1.03, -0.97],
    [0, 0.23, -0.97], [0, 0.03, -0.97], [0, 0, -0.85], [0, 0, -0.45], [0, 0, -0.19],
  ]
  vadd('steel', GEO.pipe(supplyPts, 0.028, { seg: 60, radial: 12 }))
  vadd('steel', discXGeo(0.058, 0.024, 24, -0.475, 1.10, -0.97))
  vadd('steel', boltsXGeo(4, 0.042, 0.008, 0.016, -0.489, 1.10, -0.97))
  // 下游：出阀后沿槽外壁上行，翻过口沿，弯向槽内注入
  const outPts = [
    [0, 0, 0.19], [0, 0.18, 0.20], [0, 0.66, 0.20], [0, 0.92, 0.20], [0, 0.98, 0.20],
    [0.11, 0.985, 0.20], [0.26, 0.945, 0.20], [0.37, 0.865, 0.20], [0.425, 0.795, 0.20],
  ]
  vadd('steel', GEO.pipe(outPts, 0.024, { seg: 60, radial: 12 }))
  // 喷嘴
  vadd('steel', cylGeo(0.030, 0.090, 18, 0.425, 0.735, 0.20))
  vadd('steel', cylGeo(0.020, 0.030, 16, 0.425, 0.688, 0.20))
  // 管夹 / 支架（与槽壁、口沿刚性连接）
  for (const y of [0.42, 0.76]) {
    vadd('dark', boxGeo(0.30, 0.026, 0.05, 0.01, y, -0.97))
    vadd('dark', boxGeo(0.012, 0.09, 0.07, 0.158, y, -0.97))
    vadd('steel', new THREE.TorusGeometry(0.034, 0.0065, 6, 16).rotateY(Math.PI / 2).translate(0, y, -0.97))
    vadd('steel', cylGeo(0.0065, 0.012, 8, 0.158, y + 0.03, -0.97))
    vadd('steel', cylGeo(0.0065, 0.012, 8, 0.158, y - 0.03, -0.97))
  }
  vadd('dark', boxGeo(0.30, 0.026, 0.05, 0.01, 0, -0.30))
  vadd('dark', boxGeo(0.012, 0.09, 0.07, 0.158, 0, -0.30))
  vadd('steel', new THREE.TorusGeometry(0.032, 0.0065, 6, 16).rotateY(Math.PI / 2).translate(0, 0, -0.30))
  for (const y of [0.50, 0.86]) {
    vadd('dark', boxGeo(0.30, 0.026, 0.05, 0.01, y, 0.20))
    vadd('dark', boxGeo(0.012, 0.09, 0.07, 0.158, y, 0.20))
    vadd('steel', new THREE.TorusGeometry(0.030, 0.0065, 6, 16).rotateY(Math.PI / 2).translate(0, y, 0.20))
  }
  // 口沿处的固定夹（跨过槽口沿）
  vadd('dark', boxGeo(0.05, 0.05, 0.05, 0.12, 0.965, 0.20))
  vadd('steel', new THREE.TorusGeometry(0.030, 0.0065, 6, 16).rotateY(Math.PI / 2).translate(0.11, 0.985, 0.20))

  const vMerged = (k, mat) => {
    if (!vb[k].length) return
    const m = new THREE.Mesh(GEO.merge(vb[k]), mat)
    vb[k] = []
    m.castShadow = true
    m.receiveShadow = true
    valve.add(m)
  }
  vMerged('rim', VM.rim)
  vMerged('steel', VM.steel)
  vMerged('dark', VM.dark)

  // 手轮（绕阀杆 Y 轴旋转）
  const wheel = new THREE.Group()
  wheel.position.set(0, 0.255, 0)
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.102, 0.0115, 10, 44).rotateX(Math.PI / 2), VM.paint)
    ring.castShadow = true
    wheel.add(ring)
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.196, 0.011, 0.011), VM.steel)
      sp.rotation.y = (i / 4) * Math.PI
      sp.castShadow = true
      wheel.add(sp)
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.028, 20), VM.steel)
    hub.castShadow = true
    wheel.add(hub)
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.22, 12), VM.steel)
    stem.position.y = -0.075
    wheel.add(stem)
  }
  valve.add(wheel)

  // 加药细流（双芯半透明细圆柱）+ 液滴串
  const streamGroup = new THREE.Group()
  const streamOuterMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.30, 0.15, 0.035), roughness: 0.12, metalness: 0, transparent: true,
    opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4, clearcoat: 1,
  })
  const streamInnerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.52, 0.30, 0.09), transparent: true, opacity: 0.55, depthWrite: false })
  const streamOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0082, 0.16, 12, 1, true), streamOuterMat)
  streamOuter.position.set(0.425, 0.628, 0.20)
  streamOuter.renderOrder = 7
  streamGroup.add(streamOuter)
  const streamInner = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0036, 0.16, 8), streamInnerMat)
  streamInner.position.copy(streamOuter.position)
  streamInner.renderOrder = 8
  streamGroup.add(streamInner)
  const DOSE_N = 6
  const doseDrop = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.0062, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.42, 0.23, 0.06), transparent: true, opacity: 0.8, depthWrite: false }),
    DOSE_N,
  )
  doseDrop.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  doseDrop.frustumCulled = false
  doseDrop.renderOrder = 8
  streamGroup.add(doseDrop)
  streamGroup.visible = false
  valve.add(streamGroup)

  world.addPart('valve', valve, {
    label: '药剂阀', htmlLabel: '药剂阀 · 开度 0 %',
    anchor: [VX, VY + 0.48, VZ],
  })
  world.root.add(valve)

  // ================================================================ 每帧动画
  const dummy = new THREE.Object3D()
  let labelAcc = 0
  const valveEntry = world.parts.get('valve')
  const ORE_TOP = 3.4, ORE_LAND = LIQ_Y + 0.02
  let liquidTint = 0

  world.onFrame((dt) => {
    const A = sim.anim
    const t = sim.t
    const run = sim.process === 'FLOTATING'
    liquidTint = A.liquidTint

    // ---------------- 矿浆液面：低幅正弦 + 落矿/加药扰动 ----------------
    // 落矿涟漪（半径自落点向外传播，splash 由 1 → 0）
    const spl = A.splash
    const splPhase = (1 - spl) * 17
    const doseAmp = A.dose > 0.001 && sim.process === 'DOSING' ? A.dose * 0.0045 : 0
    for (let iz = 0; iz <= SEGZ; iz++) {
      for (let ix = 0; ix <= SEGX; ix++) {
        const i = iz * NX + ix
        const i3 = i * 3
        const x = lArr[i3], z = lArr[i3 + 2]
        let y = 0.0042 * Math.sin(x * 3.4 + t * 1.65) + 0.0032 * Math.cos(z * 4.6 - t * 1.25)
          + 0.0016 * Math.sin((x + z) * 9.2 + t * 3.1)
        if (spl > 0.001) {
          const dx = x - ORE_X, dz = z - ORE_Z
          const r = Math.sqrt(dx * dx + dz * dz)
          y += spl * 0.015 * Math.exp(-r * 4.6) * Math.sin(r * 34 - splPhase)
        }
        if (doseAmp > 0) {
          const dx = x - DOSE_X, dz = z - DOSE_Z
          const r = Math.sqrt(dx * dx + dz * dz)
          y += doseAmp * Math.exp(-r * 7) * Math.sin(r * 46 - t * 13)
        }
        lArr[i3 + 1] = y
      }
    }
    // 液面法线（有限差分，避免每帧 computeVertexNormals 的临时分配）
    for (let iz = 0; iz <= SEGZ; iz++) {
      for (let ix = 0; ix <= SEGX; ix++) {
        const i = iz * NX + ix
        const l = ix > 0 ? i - 1 : i, rr = ix < SEGX ? i + 1 : i
        const d = iz > 0 ? i - NX : i, u = iz < SEGZ ? i + NX : i
        const fx = (lArr[rr * 3 + 1] - lArr[l * 3 + 1]) / (LSTEP * (rr - l))
        const fz = (lArr[u * 3 + 1] - lArr[d * 3 + 1]) / (LSTEPZ * (u - d))
        const inv = 1 / Math.sqrt(fx * fx + fz * fz + 1)
        lNrm[i * 3] = -fx * inv
        lNrm[i * 3 + 1] = inv
        lNrm[i * 3 + 2] = -fz * inv
      }
    }
    lPos.needsUpdate = true
    liqGeo.attributes.normal.needsUpdate = true
    // 加药后矿浆色调极轻变化
    liqMat.color.copy(LIQ_BASE).lerp(LIQ_TINT, liquidTint * 0.75)

    // ---------------- 泡沫层：厚度随 foam 生长，正弦波动，随刮板向 +Z 流动 ----------------
    const foamV = clamp(A.foam)
    const foamOn = foamV > 0.004
    foam.visible = foamOn
    if (foamOn) {
      const th = foamV * (0.020 + 0.052 * foamV)          // 视觉厚度 0.02 → 0.072
      const amp = A.foamAmp * 0.85
      const flow = clamp(A.scraperSpeed / 1.745)
      const phase = t * 1.9
      for (let iz = 0; iz <= FSZ; iz++) {
        for (let ix = 0; ix <= FSX; ix++) {
          const i = iz * FNX + ix
          const i3 = i * 3
          const x = fArr[i3], z = fArr[i3 + 2]
          const dEdge = Math.min(F_HX - Math.abs(x), F_HZ - Math.abs(z))
          const e = smooth01(dEdge / 0.17)                 // 边缘 17 cm 渐变，形成圆润的泡沫床边
          // 行进波朝 +Z（刮板把泡沫推向接矿溜槽），叠加轻微横向相位差 + 大尺度起伏
          const w = (0.55 * Math.sin(z * 6.4 - phase - x * 0.9) + 0.3 * Math.cos(x * 5.2 + t * 1.5)) * amp
            + 0.34 * amp * flow * Math.sin(z * 10.5 - t * 3.2)
            + 0.014 * Math.sin(x * 1.9 + t * 0.55) * Math.cos(z * 2.3 - t * 0.42) * smooth01(foamV)
          fArr[i3 + 1] = e * (th + w)
        }
      }
      for (let iz = 0; iz <= FSZ; iz++) {
        for (let ix = 0; ix <= FSX; ix++) {
          const i = iz * FNX + ix
          const l = ix > 0 ? i - 1 : i, rr = ix < FSX ? i + 1 : i
          const d = iz > 0 ? i - FNX : i, u = iz < FSZ ? i + FNX : i
          const fx = (fArr[rr * 3 + 1] - fArr[l * 3 + 1]) / (FSTEP * (rr - l))
          const fz = (fArr[u * 3 + 1] - fArr[d * 3 + 1]) / (FSTEPZ * (u - d))
          const inv = 1 / Math.sqrt(fx * fx + fz * fz + 1)
          fNrm[i * 3] = -fx * inv
          fNrm[i * 3 + 1] = inv
          fNrm[i * 3 + 2] = -fz * inv
        }
      }
      fPos.needsUpdate = true
      foamGeo.attributes.normal.needsUpdate = true
      foamMat.opacity = 0.92 * smooth01(foamV * 1.25)
      foamTex.bump.offset.y -= dt * (0.015 + flow * 0.16)
      foamTex.bump.offset.x += dt * 0.01
      foamTex.color.offset.copy(foamTex.bump.offset)

      // 泡沫表面的气泡：浮出 → 鼓胀 → 破裂（充气量不足时隐藏）
      const bubOn = foamV > 0.12
      bubbles.visible = bubOn
      if (bubOn) {
        const surf = LIQ_Y + th * 0.8
        for (let i = 0; i < BUB_N; i++) {
          const ph = (t * 0.42 + bubPh[i]) % 1
          const rr = bubR[i] * (0.62 + 0.55 * ph)
          const pop = ph > 0.8 ? 1 - smooth01((ph - 0.8) / 0.2) : 1
          dummy.position.set(bubX[i] + Math.sin(t * 1.3 + i) * 0.008, surf - rr * 0.5 + ph * (rr * 1.9 + 0.014), bubZ[i])
          dummy.scale.setScalar(Math.max(0.0001, rr * pop * smooth01(foamV * 1.4)))
          dummy.rotation.set(0, 0, 0)
          dummy.updateMatrix()
          bubbles.setMatrixAt(i, dummy.matrix)
        }
        bubbles.instanceMatrix.needsUpdate = true
      }
    } else {
      bubbles.visible = false
    }

    // ---------------- 落矿涟漪飞溅（少量小球，非粒子系统） ----------------
    if (spl > 0.004) {
      splash.visible = true
      const te = (1 - spl) * 0.9
      for (let i = 0; i < SPL_N; i++) {
        const rr = splVr[i] * te
        const y = LIQ_Y + 0.01 + splVy[i] * te - 4.9 * te * te
        if (y < LIQ_Y - 0.02) {
          dummy.scale.setScalar(0.0001)
        } else {
          dummy.scale.setScalar(splSz[i])
        }
        dummy.position.set(ORE_X + splDir[i * 2] * rr, y, ORE_Z + splDir[i * 2 + 1] * rr)
        dummy.rotation.set(te * 6, i, te * 4)
        dummy.updateMatrix()
        splash.setMatrixAt(i, dummy.matrix)
      }
      splash.instanceMatrix.needsUpdate = true
    } else {
      splash.visible = false
    }

    // ---------------- 锡矿石：FEEDING 落入液面，之后下沉并隐藏 ----------------
    const oreOnNow = A.oreOn
    oreGroup.visible = oreOnNow
    if (oreOnNow) {
      const e = clamp(A.ore)
      if (e <= 0.72) {
        const u = e / 0.72
        oreGroup.position.y = lerp(ORE_TOP, ORE_LAND, u * u)
      } else {
        oreGroup.position.y = ORE_LAND - (e - 0.72) / 0.28 * 0.20
      }
      oreBody.rotation.x += dt * 2.6
      oreBody.rotation.y += dt * 1.35
      oreChip.rotation.x -= dt * 1.9
      oreChip.rotation.z += dt * 1.2
    }

    // ---------------- 药剂阀：手轮旋转、加药细流、液滴 ----------------
    const pulse = sim.pulseOf('valve')
    wheel.rotation.y = -A.valve * Math.PI * 3 - pulse * 0.9
    const dosing = sim.process === 'DOSING' && A.dose > 0.015
    streamGroup.visible = dosing
    if (dosing) {
      const fl = 1 + Math.sin(t * 46) * 0.16
      streamOuter.scale.set(fl, 1, fl)
      streamInner.scale.set(fl, 1, fl)
      streamInnerMat.opacity = 0.4 + 0.22 * (0.5 + 0.5 * Math.sin(t * 31))
      for (let i = 0; i < DOSE_N; i++) {
        const ph = (t * 0.95 + i / DOSE_N) % 1
        dummy.position.set(0.425 + 0.0025 * Math.sin(t * 9 + i), 0.70 - ph * 0.135, 0.20)
        dummy.scale.setScalar(0.7 + 0.5 * (1 - ph))
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        doseDrop.setMatrixAt(i, dummy.matrix)
      }
      doseDrop.instanceMatrix.needsUpdate = true
    }

    // ---------------- 现场状态灯 ----------------
    if (run) {
      const p = 0.55 + 0.45 * Math.sin(t * 3.2)
      ledMat.color.setRGB(0.045 * p, 0.62 * p, 0.5 * p)
    } else if (sim.process === 'DOSING' || sim.process === 'FEEDING') {
      const p = 0.5 + 0.5 * Math.sin(t * 9)
      ledMat.color.setRGB(0.9 * p, 0.36 * p, 0.045 * p)
    } else if (sim.process === 'FED' || sim.process === 'DOSED') {
      ledMat.color.setRGB(0.03, 0.26, 0.22)
    } else {
      ledMat.color.setRGB(0.012, 0.075, 0.066)
    }

    // ---------------- 药剂阀标签（开度动态，节流刷新） ----------------
    labelAcc += dt
    if (labelAcc > 0.18 && valveEntry) {
      labelAcc = 0
      const txt = `药剂阀 · 开度 ${Math.round(sim.data.valve.opening)} %`
      if (valveEntry.htmlLabel !== txt) {
        valveEntry.htmlLabel = txt
        if (world.selected === valveEntry) {
          const el = world.labels.get('valve')
          if (el) el.textContent = txt
        }
      }
    }
  })
}
