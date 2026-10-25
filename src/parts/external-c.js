// 外部机组 C：伸缩吸取机构 + 自动吸管 + 视觉相机 + 打光装置
// 全部坐标为世界米制（Y 向上）。几何与材质只在构建期创建一次；
// 逐帧只更新 Object3D 变换、纹理偏移、发光材质颜色/强度。
import * as THREE from 'three'
import { MAT, GEO, clamp } from '../kit/lab-kit.js'

// ================================================================== 固定几何
// 立柱贴槽体后左角外沿（槽壁 x≈-0.955/z≈-0.805，立柱不能再往内，否则穿矿浆）
const COL = { x: -1.14, z: -0.95, baseY: 0.55, topY: 3.92 }
const CAR = { z: -0.80, y0: 2.35, travel: 1.10 }      // 滑座原点 z / y 行程
const TRUN = { y: 0.22, z: 0.06 }                     // 滑座局部：俯仰枢轴
const BOOM = { ret: 0.98, ext: 0.65 }                 // 套筒最短/可伸长（沿臂轴）
const PIVOT = new THREE.Vector3(0.9025, 0, -0.4307).normalize()   // 水平俯仰轴

// 吸管轴向：由夹持点向管口（向下、向槽心）
const PIPE_UP = new THREE.Vector3(-0.209, 0.949, -0.241).normalize()
const PIPE_DOWN = PIPE_UP.clone().negate()
const PIPE_LEN = 0.735
const Q_PIPE = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), PIPE_DOWN)

// 夹持爪局部坐标系：X = 腕点指向管轴，Y = 管轴向上，Z = X×Y
const CLAMP_X = new THREE.Vector3(-0.431, 0, -0.902)
CLAMP_X.addScaledVector(PIPE_UP, -CLAMP_X.dot(PIPE_UP)).normalize()
const CLAMP_Z = new THREE.Vector3().crossVectors(CLAMP_X, PIPE_UP).normalize()
const Q_CLAMP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(CLAMP_X, PIPE_UP, CLAMP_Z))

// 视觉相机 / 环形光源
const CAM_HEAD = new THREE.Vector3(0.62, 3.12, -0.18)
const CAM_AIM = new THREE.Vector3(0.30, 2.22, 0.10)
const CAM_AXIS = new THREE.Vector3().subVectors(CAM_AIM, CAM_HEAD).normalize()
const Q_CAM = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), CAM_AXIS)

// ================================================================== 程序纹理（只建一次）
let _hazard = null
function hazardTex() {
  if (_hazard) return _hazard
  const S = 128
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#161006'; g.fillRect(0, 0, S, S)
  g.save()
  g.translate(S / 2, S / 2); g.rotate(-Math.PI / 4); g.translate(-S / 2, -S / 2)
  g.fillStyle = '#b08a2c'
  for (let i = -S; i < S * 2; i += 34) g.fillRect(i, -S, 17, S * 3)
  g.restore()
  _hazard = new THREE.CanvasTexture(c)
  _hazard.wrapS = _hazard.wrapT = THREE.RepeatWrapping
  _hazard.colorSpace = THREE.SRGBColorSpace
  _hazard.repeat.set(2, 2)
  return _hazard
}
function hazardMat() {
  return new THREE.MeshStandardMaterial({ map: hazardTex(), color: 0x8a8a8a, roughness: 0.55, metalness: 0.15 })
}

const _plateCache = {}
function plateTex(text, w = 512, h = 128) {
  if (_plateCache[text]) return _plateCache[text]
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')
  g.fillStyle = '#0b0d0f'; g.fillRect(0, 0, w, h)
  g.strokeStyle = '#3d4348'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6)
  g.fillStyle = '#ffb84d'
  g.font = `bold ${Math.floor(h * 0.42)}px "Microsoft YaHei", "Inter", sans-serif`
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(text, w / 2, h / 2 + 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  _plateCache[text] = t
  return t
}

let _flow = null
function flowTex() {
  if (_flow) return _flow
  const W = 128, H = 256
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#251307'; g.fillRect(0, 0, W, H)
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 2 + Math.random() * 10
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, 'rgba(198,146,74,0.5)')
    gr.addColorStop(1, 'rgba(198,146,74,0)')
    g.fillStyle = gr
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill()
  }
  for (let i = 0; i < 16; i++) {
    const y = Math.random() * H
    g.strokeStyle = 'rgba(236,203,152,0.2)'
    g.lineWidth = 1 + Math.random() * 2
    g.beginPath(); g.moveTo(0, y)
    g.bezierCurveTo(W * 0.3, y + 12, W * 0.6, y - 14, W, y + 5)
    g.stroke()
  }
  _flow = new THREE.CanvasTexture(c)
  _flow.wrapS = _flow.wrapT = THREE.RepeatWrapping
  _flow.repeat.set(2, 1)
  _flow.colorSpace = THREE.SRGBColorSpace
  return _flow
}

let _ticks = null
function tickTex() {
  if (_ticks) return _ticks
  const w = 96, h = 512
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')
  g.fillStyle = '#c8ccd0'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#12161a'
  for (let i = 0; i <= 40; i++) {
    const y = h - 8 - i * 12.4
    const len = i % 5 === 0 ? 54 : 30
    g.fillRect(0, y, len, 3)
    if (i % 5 === 0) { g.font = 'bold 20px sans-serif'; g.textAlign = 'right'; g.fillText(String(i * 20), w - 4, y + 7) }
  }
  _ticks = new THREE.CanvasTexture(c)
  _ticks.colorSpace = THREE.SRGBColorSpace
  return _ticks
}

// ================================================================== 小工具（仅构建期调用）
const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _b3 = new THREE.Vector3()
function addMesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, mat)
  o.position.set(x, y, z)
  parent.add(o)
  return o
}
function bar(parent, mat, a, b, w, h) {
  _b1.set(a[0], a[1], a[2]); _b2.set(b[0], b[1], b[2])
  const len = _b1.distanceTo(_b2) || 1e-4
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat)
  o.position.copy(_b1).add(_b2).multiplyScalar(0.5)
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _b3.copy(_b2).sub(_b1).normalize())
  parent.add(o)
  return o
}
function cylZ(parent, mat, r, len, x, y, z, seg = 20) {
  const o = addMesh(parent, new THREE.CylinderGeometry(r, r, len, seg), mat, x, y, z)
  o.rotation.x = Math.PI / 2
  return o
}

// ================================================================== 运动学
// 滑座随行程升降；臂端（腕点）由行程给出，臂长/俯仰角逐帧反解，
// 保证夹持点平滑移动、吸管始终浸没且不碰撞槽体/刮板。
const _target = new THREE.Vector3()
function makePose() {
  return {
    stroke: 0.04, cyc: 0, ext: 0, tip: BOOM.ret, carriageY: 2.39,
    B: new THREE.Vector3(), W: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, 1),
    flange: new THREE.Vector3(), mouth: new THREE.Vector3(),
    qBoom: new THREE.Quaternion(),
  }
}
const _bx = new THREE.Vector3()
const _bm = new THREE.Matrix4()
function solvePose(stroke, out) {
  const yc = CAR.y0 + CAR.travel * stroke
  out.carriageY = yc
  out.B.set(COL.x, yc + TRUN.y, CAR.z + TRUN.z)
  _target.set(-0.730, 2.62 - 0.26 * stroke, 0.14)
  out.dir.copy(_target).sub(out.B)
  const L = out.dir.length() || 1e-6
  out.dir.multiplyScalar(1 / L)
  const e = clamp((L - BOOM.ret) / BOOM.ext, 0, 1)
  out.ext = e
  out.tip = BOOM.ret + BOOM.ext * e
  out.W.copy(out.B).addScaledVector(out.dir, out.tip)
  // 腕点 → 法兰 → 管口（刚性：法兰相对腕点固定）
  out.flange.copy(out.W).addScaledVector(CLAMP_X, 0.10).addScaledVector(PIPE_UP, 0.085)
  out.mouth.copy(out.flange).addScaledVector(PIPE_DOWN, PIPE_LEN)
  _bx.crossVectors(out.dir, PIVOT).normalize()
  out.qBoom.setFromRotationMatrix(_bm.makeBasis(PIVOT, _bx, out.dir))
  return out
}

// 局部相位：FLOTATING 时跟随 sim 的 5.6 s 循环；点击后局部提速一个周期（不改流程状态）
function updateMechanism(sim, pose, dt) {
  const A = sim.anim
  const run = sim.process === 'FLOTATING'
  if (run) {
    const pulse = sim.pulseOf('telescopic')
    pose.cyc += (dt / 5.6) * (1 + 2.6 * pulse)
    let err = A.telescopePhase - (pose.cyc - Math.floor(pose.cyc))
    err -= Math.round(err)
    pose.cyc += err * Math.min(1, dt * 1.6)
    const ph = pose.cyc - Math.floor(pose.cyc)
    pose.stroke = clamp(0.5 - 0.5 * Math.cos(ph * Math.PI * 2), 0.02, 0.98)
  } else {
    pose.cyc = A.telescopePhase
    pose.stroke += (0.04 - pose.stroke) * (1 - Math.exp(-dt / 0.5))
  }
  solvePose(pose.stroke, pose)
}

// ================================================================== 入口
export function buildExternalC(world) {
  const sim = world.sim
  const pose = makePose()
  const mean = makePose()
  solvePose(0.5, mean)
  // 注意：此 updater 必须最先注册，其余部件帧回调读取 pose
  world.onFrame((dt) => updateMechanism(sim, pose, dt))
  buildTelescopic(world, sim, pose)
  buildSuction(world, sim, pose, mean)
  buildCamera(world, sim)
  buildLight(world, sim)
}

// ================================================================== 伸缩吸取机构
function buildTelescopic(world, sim, pose) {
  const g = new THREE.Group()
  g.name = 'telescopic'

  // 深色工业金属 + 亮钢导轨 + 暗黄执行机构（深色环境里避免大面积 metalness=1）
  const darkSteel = MAT.steelDark({ color: [0.045, 0.05, 0.055], metalness: 0.68, roughness: 0.52, finish: 'cast' })
  const midSteel = MAT.steel({ color: [0.075, 0.08, 0.085], metalness: 0.7, roughness: 0.42, finish: 'cast' })
  const rail = MAT.chrome({ color: [0.58, 0.61, 0.62], metalness: 1, roughness: 0.14 })
  const chrome = MAT.chrome({ color: [0.44, 0.46, 0.47], metalness: 1, roughness: 0.1 })
  const yellow = MAT.paint({ color: [0.30, 0.185, 0.022], roughness: 0.42 })
  const brass = MAT.brass({ color: [0.19, 0.135, 0.045], roughness: 0.34 })
  const rubber = MAT.rubber()
  const black = MAT.satin({ color: [0.012, 0.013, 0.015], roughness: 0.9, finish: null })
  const hazard = hazardMat()

  const cx = COL.x, cz = COL.z

  // ---------- 基础 / 地脚（落在检修平台上） ----------
  const foot = addMesh(g, GEO.rbox(0.36, 0.035, 0.36, 0.008), darkSteel, cx, 0.098, cz)
  foot.castShadow = true; foot.receiveShadow = true
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addMesh(g, new THREE.CylinderGeometry(0.015, 0.015, 0.055, 10), chrome, cx + sx * 0.13, 0.125, cz + sz * 0.13)
    addMesh(g, new THREE.CylinderGeometry(0.026, 0.026, 0.016, 6), darkSteel, cx + sx * 0.13, 0.152, cz + sz * 0.13)
  }
  const ped = addMesh(g, GEO.rbox(0.22, 0.45, 0.22, 0.012), darkSteel, cx, 0.33, cz)
  ped.castShadow = true
  for (const sx of [-1, 1]) addMesh(g, GEO.rbox(0.014, 0.30, 0.17, 0.004), midSteel, cx + sx * 0.117, 0.42, cz)
  for (const sz of [-1, 1]) addMesh(g, GEO.rbox(0.17, 0.30, 0.014, 0.004), midSteel, cx, 0.42, cz + sz * 0.117)
  addMesh(g, GEO.rbox(0.226, 0.10, 0.226, 0.006), hazard, cx, 0.20, cz)
  addMesh(g, GEO.rbox(0.30, 0.032, 0.30, 0.006), midSteel, cx, 0.545, cz).castShadow = true

  // ---------- 立柱 ----------
  const colH = COL.topY - COL.baseY
  const column = addMesh(g, GEO.rbox(0.16, colH, 0.16, 0.01), darkSteel, cx, COL.baseY + colH / 2, cz)
  column.castShadow = true; column.receiveShadow = true
  addMesh(g, GEO.rbox(0.205, 0.04, 0.205, 0.008), midSteel, cx, COL.topY + 0.02, cz)
  // 拼接板 + 螺栓
  for (const y of [1.55, 2.55]) {
    for (const sz of [-1, 1]) {
      addMesh(g, GEO.rbox(0.20, 0.12, 0.014, 0.004), midSteel, cx, y, cz + sz * 0.083)
      for (const sx of [-1, 1]) addMesh(g, new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6), chrome, cx + sx * 0.07, y + 0.03, cz + sz * 0.092).rotation.x = Math.PI / 2
    }
  }
  // 侧面电缆槽 + 行程标尺 + 铭牌
  addMesh(g, GEO.rbox(0.028, 2.45, 0.075, 0.005), black, cx - 0.095, 2.05, cz + 0.02)
  const scale = addMesh(g, new THREE.PlaneGeometry(0.062, 1.30), new THREE.MeshStandardMaterial({ map: tickTex(), roughness: 0.6, metalness: 0.1 }), cx - 0.081, 2.15, cz + 0.055)
  scale.rotation.y = -Math.PI / 2
  const plate = addMesh(g, new THREE.PlaneGeometry(0.17, 0.045), new THREE.MeshStandardMaterial({ map: plateTex('自动取样 Sampler-S02'), roughness: 0.5, metalness: 0.2 }), cx + 0.01, 1.92, cz + 0.081)
  plate.rotation.y = 0
  addMesh(g, GEO.rbox(0.19, 0.062, 0.006, 0.003), black, cx + 0.01, 1.92, cz + 0.077)

  // ---------- 双竖直导轨 ----------
  const railLen = 2.85
  for (const sx of [-1, 1]) {
    const r = addMesh(g, new THREE.CylinderGeometry(0.019, 0.019, railLen, 14), rail, cx + sx * 0.075, 0.95 + railLen / 2, cz + 0.095)
    r.castShadow = true
    for (const y of [1.0, 1.65, 2.3, 2.95, 3.6, 3.78]) {
      addMesh(g, GEO.rbox(0.062, 0.05, 0.05, 0.005), midSteel, cx + sx * 0.075, y, cz + 0.088)
    }
    addMesh(g, new THREE.CylinderGeometry(0.027, 0.027, 0.018, 14), midSteel, cx + sx * 0.075, 0.94, cz + 0.095)
    addMesh(g, new THREE.CylinderGeometry(0.027, 0.027, 0.018, 14), midSteel, cx + sx * 0.075, 3.81, cz + 0.095)
  }
  // 上下限位接近开关
  for (const [y, c] of [[2.42, 0x3fe0c5], [3.34, 0xffb84d]]) {
    addMesh(g, GEO.rbox(0.05, 0.06, 0.045, 0.005), black, cx + 0.075, y, cz + 0.13)
    const ledMat = new THREE.MeshBasicMaterial({ color: c, toneMapped: false })
    addMesh(g, new THREE.SphereGeometry(0.008, 8, 6), ledMat, cx + 0.075, y + 0.018, cz + 0.154)
  }

  // ---------- 滑座 ----------
  const carriage = new THREE.Group()
  carriage.position.set(cx, CAR.y0, CAR.z)
  g.add(carriage)
  const plateMesh = addMesh(carriage, GEO.rbox(0.28, 0.34, 0.055, 0.010), midSteel, 0, 0, 0)
  plateMesh.castShadow = true
  for (const sx of [-1, 1]) addMesh(carriage, GEO.rbox(0.012, 0.30, 0.09, 0.004), darkSteel, sx * 0.132, 0, -0.01)
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const tr = addMesh(carriage, GEO.rbox(0.072, 0.072, 0.09, 0.006), darkSteel, sx * 0.075, sy * 0.098, -0.065)
    tr.castShadow = true
    addMesh(carriage, GEO.rbox(0.046, 0.048, 0.014, 0.003), brass, sx * 0.075, sy * 0.098, -0.108)
    addMesh(carriage, new THREE.CylinderGeometry(0.008, 0.008, 0.022, 6), chrome, sx * 0.106, sy * 0.074, -0.03).rotation.x = Math.PI / 2
  }
  addMesh(carriage, new THREE.CylinderGeometry(0.02, 0.02, 0.05, 10), yellow, 0, 0.16, 0.02)

  // 俯仰枢轴框架（随机架安装角）
  const tf = new THREE.Group()
  tf.position.set(0, TRUN.y, TRUN.z)
  tf.rotation.y = 0.4452
  carriage.add(tf)
  for (const sx of [-1, 1]) {
    const ear = addMesh(tf, GEO.rbox(0.028, 0.30, 0.115, 0.006), yellow, sx * 0.14, 0.02, 0)
    ear.castShadow = true
    addMesh(tf, new THREE.CylinderGeometry(0.028, 0.028, 0.016, 16), chrome, sx * 0.162, 0, 0).rotation.z = Math.PI / 2
  }
  addMesh(tf, GEO.rbox(0.31, 0.03, 0.17, 0.006), darkSteel, 0, -0.115, 0)
  addMesh(tf, GEO.rbox(0.16, 0.055, 0.10, 0.006), midSteel, 0, -0.02, 0.06)

  // ---------- 伸缩臂 ----------
  const boom = new THREE.Group()
  g.add(boom)
  // 枢轴毂（轴 = 臂局部 X）
  const hub = addMesh(boom, new THREE.CylinderGeometry(0.075, 0.075, 0.26, 24), yellow, 0, 0, 0)
  hub.rotation.z = Math.PI / 2; hub.castShadow = true
  addMesh(boom, new THREE.CylinderGeometry(0.038, 0.038, 0.30, 16), chrome, 0, 0, 0).rotation.z = Math.PI / 2
  // 基座筒（黄漆）+ 后端盖 + 警示环
  const baseTube = addMesh(boom, new THREE.CylinderGeometry(0.085, 0.085, BOOM.ret - 0.40, 28), yellow, 0, 0, 0.40 + (BOOM.ret - 0.40) / 2)
  baseTube.rotation.x = Math.PI / 2; baseTube.castShadow = true
  cylZ(boom, midSteel, 0.094, 0.045, 0, 0, 0.09)
  cylZ(boom, hazard, 0.087, 0.055, 0, 0, 0.17)
  cylZ(boom, midSteel, 0.092, 0.03, 0, 0, 0.60)
  // 液压软管环
  const hoseLoop = new THREE.Mesh(GEO.pipe([[0.09, 0.03, 0.14], [0.14, 0.11, 0.07], [0.13, 0.15, -0.04], [0.05, 0.12, -0.13], [-0.01, 0.03, -0.11]], 0.011, { seg: 28, radial: 8 }), rubber)
  boom.add(hoseLoop)
  // 伸缩节：sec1（钢套）/ sec2、sec3（镀铬柱塞）
  const sections = []
  const secDef = [
    { r: 0.065, len: 0.52, mat: midSteel, collar: 0.074 },
    { r: 0.050, len: 0.50, mat: chrome, collar: 0.058 },
    { r: 0.036, len: 0.46, mat: chrome, collar: 0.043 },
  ]
  for (const d of secDef) {
    const s = new THREE.Group()
    const tube = addMesh(s, new THREE.CylinderGeometry(d.r, d.r, d.len, 26), d.mat, 0, 0, 0)
    tube.rotation.x = Math.PI / 2; tube.castShadow = true
    for (const zz of [-d.len / 2 + 0.022, d.len / 2 - 0.022]) {
      addMesh(s, new THREE.CylinderGeometry(d.collar, d.collar, 0.04, 26), brass, 0, 0, zz).rotation.x = Math.PI / 2
    }
    boom.add(s)
    sections.push(s)
  }
  // 臂端法兰（柱塞头，接夹持爪腕球）
  cylZ(boom, brass, 0.05, 0.05, 0, 0, BOOM.ret + BOOM.ext - 0.02)

  // ---------- 夹持爪（两爪夹紧吸管，刚性连接） ----------
  const clampG = new THREE.Group()
  g.add(clampG)
  addMesh(clampG, new THREE.SphereGeometry(0.05, 16, 12), midSteel)
  addMesh(clampG, GEO.rbox(0.11, 0.065, 0.10, 0.008), midSteel, 0.045, -0.005, 0)
  addMesh(clampG, GEO.rbox(0.165, 0.05, 0.105, 0.006), darkSteel, 0.10, 0.015, 0)
  for (const sx of [-1, 1]) {
    const jaw = addMesh(clampG, GEO.rbox(0.028, 0.17, 0.11, 0.005), darkSteel, 0.10 + sx * 0.045, -0.095, 0)
    jaw.castShadow = true
    addMesh(clampG, GEO.rbox(0.011, 0.10, 0.075, 0.003), brass, 0.10 + sx * 0.025, -0.10, 0)
  }
  const act = addMesh(clampG, new THREE.CylinderGeometry(0.016, 0.016, 0.14, 12), chrome, 0.10, 0.055, 0.085)
  act.rotation.z = Math.PI / 2
  addMesh(clampG, new THREE.CylinderGeometry(0.024, 0.024, 0.05, 12), black, 0.155, 0.055, 0.085).rotation.z = Math.PI / 2

  world.addPart('telescopic', g, {
    label: '伸缩吸取机构',
    htmlLabel: '伸缩机构 · 行程 860 mm',
    anchor: [COL.x + 0.02, COL.topY + 0.10, COL.z + 0.02],
  })
  world.root.add(g)

  // 逐帧：滑座升降、臂俯仰/伸缩、夹持爪就位
  world.onFrame(() => {
    carriage.position.y = pose.carriageY
    boom.position.copy(pose.B)
    boom.quaternion.copy(pose.qBoom)
    sections[0].position.z = 0.54 + 0.20 * pose.ext
    sections[1].position.z = 0.67 + 0.42 * pose.ext
    sections[2].position.z = 0.75 + 0.65 * pose.ext
    clampG.position.copy(pose.W)
    clampG.quaternion.copy(Q_CLAMP)
  })
}

// ================================================================== 自动吸管
function buildSuction(world, sim, pose, mean) {
  const g = new THREE.Group()
  g.name = 'suctionPipe'
  const steel = MAT.stainless({ color: [0.30, 0.31, 0.31], metalness: 0.72, roughness: 0.3, finish: 'brushed' })
  const darkSteel = MAT.steelDark({ color: [0.05, 0.055, 0.06], metalness: 0.65, roughness: 0.5 })
  const chrome = MAT.chrome({ color: [0.5, 0.52, 0.53], metalness: 1, roughness: 0.1 })
  const brass = MAT.brass({ color: [0.24, 0.17, 0.06], roughness: 0.32 })
  const rubber = MAT.rubber()
  const black = MAT.satin({ color: [0.014, 0.015, 0.017], roughness: 0.88, finish: null })
  const hazard = hazardMat()
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfe0dc, roughness: 0.05, metalness: 0, transmission: 0.6, thickness: 0.004,
    transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide, ior: 1.5, clearcoat: 1,
  })
  const tex = flowTex()
  const flowMat = new THREE.MeshStandardMaterial({ map: tex, color: 0x9a7449, roughness: 0.42, metalness: 0.05, emissive: 0x2b1708, emissiveIntensity: 0.55 })

  // ---------- 随动部分（法兰 + 刚性管 + 观察窗 + 软管） ----------
  const rig = new THREE.Group()
  g.add(rig)
  addMesh(rig, GEO.disc(0.062, 0.026, 0.006, 36), steel, 0, 0.005, 0)
  addMesh(rig, GEO.bolts(6, 0.047, 0.006, 0.013, { y: 0.016 }), chrome)
  addMesh(rig, GEO.tube(0.034, 0.026, 0.045, 20, 0.017), steel)
  addMesh(rig, new THREE.TorusGeometry(0.037, 0.008, 8, 20), chrome, 0, 0.06, 0).rotation.x = Math.PI / 2
  // 上段刚性管
  addMesh(rig, GEO.tube(0.025, 0.017, 0.27, 24, -0.30), steel).castShadow = true
  addMesh(rig, GEO.tube(0.032, 0.023, 0.028, 24, -0.322), steel)
  addMesh(rig, GEO.tube(0.032, 0.023, 0.028, 24, -0.478), steel)
  // 观察窗（半透明）+ 内部液流芯
  const win = addMesh(rig, GEO.tube(0.0305, 0.028, 0.155, 28, -0.463), glassMat)
  win.renderOrder = 4
  const inner = addMesh(rig, new THREE.CylinderGeometry(0.019, 0.019, 0.13, 20), flowMat, 0, -0.385, 0)
  inner.renderOrder = 3
  // 下段刚性管 + 管口
  addMesh(rig, GEO.tube(0.025, 0.017, 0.20, 24, -0.682), steel).castShadow = true
  addMesh(rig, GEO.tube(0.031, 0.021, 0.05, 24, -0.732), steel)
  addMesh(rig, GEO.tube(0.034, 0.024, 0.018, 24, -0.690), brass)
  addMesh(rig, new THREE.TorusGeometry(0.029, 0.004, 6, 18), chrome, 0, -0.733, 0).rotation.x = Math.PI / 2
  // 中段卡箍 + 取样传感器
  addMesh(rig, GEO.tube(0.031, 0.023, 0.03, 20, -0.215), brass)
  addMesh(rig, GEO.rbox(0.05, 0.055, 0.045, 0.005), black, 0.038, -0.25, 0)
  addMesh(rig, new THREE.CylinderGeometry(0.006, 0.006, 0.02, 8), chrome, 0.038, -0.25, 0.03).rotation.x = Math.PI / 2
  // 软管（CatmullRom，上端通到槽外立柱后的取样杯）
  const mf = mean.flange
  const hp = (dx, dy, dz) => [mf.x + dx, mf.y + dy, mf.z + dz]
  const hosePts = [
    hp(-0.0125, 0.0569, -0.0145),
    hp(0.066, 0.407, -0.098),
    hp(0.126, 0.757, -0.318),
    hp(0.026, 1.037, -0.678),
    hp(-0.164, 1.137, -1.118),
    hp(-0.504, 0.917, -1.188),
    hp(-0.524, 0.407, -1.208),
    hp(-0.514, -0.143, -1.208),
    hp(-0.494, -0.593, -1.208),
    hp(-0.474, -0.943, -1.198),
  ]
  const hoseGeo = GEO.pipe(hosePts, 0.030, { seg: 64, radial: 10 })
  const inv = new THREE.Matrix4().compose(mean.flange, Q_PIPE, new THREE.Vector3(1, 1, 1)).invert()
  const curve = hoseGeo.userData.curve
  hoseGeo.applyMatrix4(inv)
  const hose = new THREE.Mesh(hoseGeo, rubber)
  hose.castShadow = true
  rig.add(hose)
  for (const t of [0.16, 0.36, 0.58, 0.8]) {
    const a = curve.getPointAt(Math.max(0, t - 0.008)).applyMatrix4(inv)
    const b = curve.getPointAt(Math.min(1, t + 0.008)).applyMatrix4(inv)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16), darkSteel)
    ring.position.copy(curve.getPointAt(t)).applyMatrix4(inv)
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.sub(a).normalize())
    rig.add(ring)
  }

  // ---------- 槽外取样杯 / 接收器（固定，挂在立柱背面） ----------
  addMesh(g, GEO.rbox(0.22, 0.34, 0.20, 0.012), darkSteel, -1.29, 1.08, -1.18).castShadow = true
  addMesh(g, GEO.rbox(0.236, 0.16, 0.216, 0.008), hazard, -1.29, 1.15, -1.18)
  const funnelMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide })
  addMesh(g, new THREE.CylinderGeometry(0.135, 0.10, 0.50, 28, 1, true), funnelMat, -1.29, 1.55, -1.18)
  addMesh(g, new THREE.TorusGeometry(0.135, 0.012, 8, 28), chrome, -1.29, 1.80, -1.18).rotation.x = Math.PI / 2
  addMesh(g, new THREE.CylinderGeometry(0.10, 0.075, 0.06, 24), darkSteel, -1.29, 1.27, -1.18)
  // 液位观察条 + 排液阀 + 状态灯
  const sightMat = new THREE.MeshPhysicalMaterial({ color: 0x9fd0c8, roughness: 0.1, metalness: 0, transmission: 0.5, transparent: true, opacity: 0.4, depthWrite: false })
  addMesh(g, new THREE.BoxGeometry(0.02, 0.20, 0.012), sightMat, -1.184, 1.06, -1.18)
  addMesh(g, new THREE.CylinderGeometry(0.022, 0.022, 0.07, 12), chrome, -1.29, 0.90, -1.18)
  addMesh(g, new THREE.TorusGeometry(0.04, 0.008, 6, 16), chrome, -1.29, 0.86, -1.18).rotation.x = Math.PI / 2
  const recvLed = new THREE.MeshBasicMaterial({ color: 0x3fe0c5, toneMapped: false })
  addMesh(g, new THREE.SphereGeometry(0.01, 8, 6), recvLed, -1.42, 1.22, -1.18)
  // 支架（接立柱背面）
  bar(g, steel, [-1.20, 1.20, -1.02], [-1.28, 1.20, -1.09], 0.12, 0.05).castShadow = true
  bar(g, darkSteel, [-1.29, 1.18, -1.08], [-1.29, 1.30, -1.12], 0.10, 0.04)
  addMesh(g, GEO.rbox(0.14, 0.12, 0.02, 0.004), steel, -1.20, 1.20, -1.035).rotation.y = Math.PI / 2
  for (const sy of [-0.04, 0.04]) addMesh(g, new THREE.CylinderGeometry(0.009, 0.009, 0.024, 6), chrome, -1.20, 1.20 + sy, -1.024).rotation.x = Math.PI / 2

  world.addPart('suctionPipe', g, {
    label: '自动吸管',
    htmlLabel: '自动吸管 · Φ50',
    anchor: [-0.70, 2.92, 0.10],
  })
  world.root.add(g)

  world.onFrame((dt) => {
    rig.position.copy(pose.flange)
    rig.quaternion.copy(Q_PIPE)
    const run = sim.process === 'FLOTATING'
    const pulse = sim.pulseOf('suctionPipe')
    const speed = run ? 0.30 + pulse * 1.6 : 0.02
    tex.offset.y -= dt * speed
    tex.offset.x += dt * speed * 0.05
    inner.rotation.y += dt * (run ? 0.8 + pulse * 2.4 : 0.04)
    flowMat.emissiveIntensity = (run ? 0.7 : 0.28) + pulse * 0.5
    recvLed.color.setHex(run ? 0x3fe0c5 : 0x1d3a36)
  })
}

// ================================================================== 视觉相机
function buildCamera(world, sim) {
  const g = new THREE.Group()
  g.name = 'camera'
  const bracket = MAT.steelDark({ color: [0.05, 0.055, 0.06], metalness: 0.66, roughness: 0.48, finish: 'cast' })
  const steel = MAT.steel({ color: [0.10, 0.105, 0.11], metalness: 0.7, roughness: 0.4 })
  const black = MAT.satin({ color: [0.010, 0.011, 0.013], roughness: 0.9, finish: null })
  const anod = MAT.anodised({ color: [0.028, 0.030, 0.033], metalness: 0.7, roughness: 0.4 })
  const chrome = MAT.chrome({ color: [0.45, 0.47, 0.48], metalness: 1, roughness: 0.1 })
  const rubber = MAT.rubber()
  const lensGlass = new THREE.MeshPhysicalMaterial({ color: 0x0a1620, roughness: 0.04, metalness: 0.25, transmission: 0.5, thickness: 0.01, transparent: true, opacity: 0.9, ior: 1.6, clearcoat: 1 })

  // ---------- L 型支架：从槽体后右角（x≈1.0,z≈-0.85）起步 ----------
  const basePlate = addMesh(g, GEO.rbox(0.18, 0.024, 0.18, 0.006), bracket, 0.99, 2.423, -0.85)
  basePlate.castShadow = true; basePlate.receiveShadow = true
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addMesh(g, new THREE.CylinderGeometry(0.012, 0.012, 0.022, 8), steel, 0.99 + sx * 0.062, 2.443, -0.85 + sz * 0.062)
    addMesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.012, 6), chrome, 0.99 + sx * 0.062, 2.456, -0.85 + sz * 0.062)
  }
  const post = addMesh(g, GEO.rbox(0.075, 1.09, 0.075, 0.008), bracket, 0.99, 2.97, -0.85)
  post.castShadow = true
  addMesh(g, GEO.rbox(0.10, 0.03, 0.10, 0.006), steel, 0.99, 3.525, -0.85)
  addMesh(g, GEO.rbox(0.016, 0.24, 0.09, 0.004), steel, 0.944, 2.56, -0.85)
  addMesh(g, GEO.rbox(0.09, 0.24, 0.016, 0.004), steel, 0.99, 2.56, -0.897)
  // 接线盒
  addMesh(g, GEO.rbox(0.095, 0.135, 0.058, 0.006), anod, 0.99, 2.92, -0.897)
  addMesh(g, new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10), steel, 0.965, 2.858, -0.897)
  addMesh(g, new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10), steel, 1.015, 2.858, -0.897)
  const jbLed = new THREE.MeshBasicMaterial({ color: 0x3fe0c5, toneMapped: false })
  addMesh(g, new THREE.SphereGeometry(0.008, 8, 6), jbLed, 0.99, 2.968, -0.928)
  // 横臂 + 斜撑
  const arm = bar(g, bracket, [0.99, 3.465, -0.85], [0.62, 3.465, -0.24], 0.068, 0.088)
  arm.castShadow = true
  bar(g, steel, [0.95, 3.512, -0.80], [0.66, 3.512, -0.31], 0.042, 0.036)
  bar(g, steel, [0.99, 3.10, -0.85], [0.80, 3.462, -0.52], 0.042, 0.05)
  addMesh(g, GEO.rbox(0.095, 0.10, 0.095, 0.008), steel, 0.62, 3.455, -0.24)
  // 云台：竖降管 + U 型叉 + 球铰
  addMesh(g, new THREE.CylinderGeometry(0.032, 0.032, 0.18, 14), anod, 0.62, 3.37, -0.23)
  addMesh(g, GEO.rbox(0.10, 0.055, 0.10, 0.006), steel, 0.62, 3.285, -0.23)
  for (const sx of [-1, 1]) addMesh(g, GEO.rbox(0.016, 0.09, 0.08, 0.004), bracket, 0.62 + sx * 0.05, 3.245, -0.225)
  addMesh(g, new THREE.SphereGeometry(0.046, 16, 12), steel, 0.62, 3.235, -0.222)
  addMesh(g, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 10), chrome, 0.62, 3.235, -0.222).rotation.z = Math.PI / 2

  // ---------- 相机头 ----------
  const head = new THREE.Group()
  head.position.copy(CAM_HEAD)
  head.quaternion.copy(Q_CAM)
  g.add(head)
  const body = addMesh(head, GEO.rbox(0.17, 0.15, 0.21, 0.012), black, 0, 0, 0)
  body.castShadow = true
  // 散热筋 / 顶板
  for (const z of [-0.062, -0.021, 0.02, 0.061]) addMesh(head, GEO.rbox(0.15, 0.018, 0.012, 0.004), anod, 0, 0.082, z)
  addMesh(head, GEO.rbox(0.145, 0.01, 0.185, 0.004), anod, 0, 0.071, 0)
  // 前端安装板 + 镜头
  addMesh(head, GEO.rbox(0.132, 0.132, 0.014, 0.006), anod, 0, 0, -0.107)
  const lensG = new THREE.Group()
  lensG.position.set(0, 0, -0.115)
  lensG.rotation.x = -Math.PI / 2
  head.add(lensG)
  addMesh(lensG, GEO.lathe([[0.030, 0], [0.061, 0], [0.061, 0.028], [0.057, 0.034], [0.057, 0.082], [0.049, 0.094], [0.038, 0.100], [0.028, 0.102], [0.028, 0]], 40), anod)
  addMesh(lensG, new THREE.CircleGeometry(0.047, 36), lensGlass, 0, 0.103, 0).rotation.x = -Math.PI / 2
  addMesh(lensG, new THREE.TorusGeometry(0.052, 0.006, 8, 28), chrome, 0, 0.098, 0).rotation.x = Math.PI / 2
  // 后部连接器 + 线缆
  for (const x of [0.048, -0.042]) {
    addMesh(head, new THREE.CylinderGeometry(0.016, 0.016, 0.035, 12), anod, x, 0.028, 0.116).rotation.x = Math.PI / 2
    addMesh(head, new THREE.CylinderGeometry(0.012, 0.012, 0.014, 10), rubber, x, 0.028, 0.140).rotation.x = Math.PI / 2
  }
  // 状态 LED（绿色呼吸/快闪）+ 电源灯
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x2fe08d, toneMapped: false })
  const LED_BASE = new THREE.Color(0x2fe08d)
  addMesh(head, new THREE.SphereGeometry(0.010, 10, 8), ledMat, 0.062, 0.052, -0.112)
  addMesh(head, new THREE.SphereGeometry(0.009, 10, 8), ledMat, 0.062, 0.079, 0.0)
  addMesh(head, new THREE.SphereGeometry(0.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb84d, toneMapped: false }), -0.062, 0.079, 0.0)
  // 铭牌
  addMesh(head, new THREE.PlaneGeometry(0.10, 0.026), new THREE.MeshStandardMaterial({ map: plateTex('VIS-01 · 30 fps'), roughness: 0.5, metalness: 0.2 }), 0, 0.0795, 0.077).rotation.x = -Math.PI / 2
  // 头到云台的短连杆
  const headTop = new THREE.Vector3(0, 0.085, 0).applyQuaternion(Q_CAM).add(CAM_HEAD)
  bar(g, anod, headTop.toArray(), [0.62, 3.22, -0.215], 0.05, 0.05)
  // 线缆（头 → 接线盒），带固定卡箍
  const back = new THREE.Vector3(0.02, 0.028, 0.14).applyQuaternion(Q_CAM).add(CAM_HEAD)
  const cablePts = [
    back.toArray(),
    [0.68, 3.19, -0.03],
    [0.80, 3.40, -0.38],
    [0.95, 3.39, -0.78],
    [1.005, 3.05, -0.885],
    [0.99, 2.97, -0.897],
  ]
  const cableGeo = GEO.pipe(cablePts, 0.011, { seg: 44, radial: 8 })
  const cable = new THREE.Mesh(cableGeo, rubber)
  g.add(cable)
  const ccurve = cableGeo.userData.curve
  for (const t of [0.3, 0.52, 0.74, 0.9]) {
    const a = ccurve.getPointAt(Math.max(0, t - 0.01))
    const b = ccurve.getPointAt(Math.min(1, t + 0.01))
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.005, 6, 14), steel)
    ring.position.copy(ccurve.getPointAt(t))
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.sub(a).normalize())
    g.add(ring)
  }

  world.addPart('camera', g, {
    label: '视觉相机',
    htmlLabel: '视觉相机 · 30 fps',
    anchor: [0.62, 3.42, -0.18],
  })
  world.root.add(g)

  world.onFrame(() => {
    const A = sim.anim
    const run = sim.process === 'FLOTATING'
    const blink = 0.5 + 0.5 * Math.sin(A.cameraBlink * (run ? 2.0 : 1.15))
    const k = run ? 0.55 + 0.85 * blink : 0.16 + 0.45 * blink
    ledMat.color.copy(LED_BASE).multiplyScalar(0.35 + 1.5 * k)
    jbLed.color.setHex(run ? 0x3fe0c5 : 0x24504a)
  })
}

// ================================================================== 环形光源
function buildLight(world, sim) {
  const g = new THREE.Group()
  g.name = 'light'
  const anod = MAT.anodised({ color: [0.022, 0.024, 0.027], metalness: 0.7, roughness: 0.42 })
  const chrome = MAT.chrome({ color: [0.42, 0.44, 0.45], metalness: 1, roughness: 0.12 })

  const head = new THREE.Group()
  head.position.copy(CAM_HEAD)
  head.quaternion.copy(Q_CAM)
  g.add(head)

  // 灯座（环形板 + 外筒）
  const housing = addMesh(head, GEO.lathe([[0.084, 0], [0.132, 0], [0.132, 0.02], [0.084, 0.02]], 40), anod)
  housing.rotation.x = Math.PI / 2
  housing.position.set(0, 0, -0.205)
  const shroud = addMesh(head, new THREE.CylinderGeometry(0.134, 0.128, 0.05, 36, 1, true), new THREE.MeshStandardMaterial({ color: 0x101214, metalness: 0.75, roughness: 0.4, side: THREE.DoubleSide }), 0, 0, -0.188)
  shroud.rotation.x = Math.PI / 2
  addMesh(head, new THREE.TorusGeometry(0.133, 0.006, 6, 36), chrome, 0, 0, -0.213).rotation.x = Math.PI / 2
  // 供电小线
  bar(head, MAT.rubber(), [0.11, 0.05, -0.19], [0.10, 0.10, -0.08], 0.014, 0.014)

  // 两道同心发光环 + 灯珠（暖白 / 冷白）
  const WARM = new THREE.Color(0xfff0d8)
  const COOL = new THREE.Color(0xdcecff)
  const warmMat = new THREE.MeshBasicMaterial({ color: 0xfff0d8, toneMapped: false })
  const coolMat = new THREE.MeshBasicMaterial({ color: 0xdcecff, toneMapped: false })
  const beadMat = new THREE.MeshBasicMaterial({ color: 0xfff0d8, toneMapped: false })
  addMesh(head, new THREE.TorusGeometry(0.113, 0.011, 8, 40), warmMat, 0, 0, -0.214)
  addMesh(head, new THREE.TorusGeometry(0.088, 0.008, 8, 36), coolMat, 0, 0, -0.208)
  const beadGeo = new THREE.SphereGeometry(0.0062, 8, 6).translate(0.124, 0, 0)
  addMesh(head, GEO.ring(beadGeo, 20, 'z'), beadMat, 0, 0, -0.212)

  // 光锥：两层 ShaderMaterial（Additive、边沿 Fresnel 淡出、底端渐隐）
  const coneVS = `
    varying vec3 vN; varying vec3 vV; varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`
  const coneFS = `
    uniform vec3 uColor; uniform float uOpacity;
    varying vec3 vN; varying vec3 vV; varying vec2 vUv;
    void main() {
      float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      rim = pow(rim, 1.4);
      float along = smoothstep(0.0, 0.34, vUv.y) * (1.0 - 0.35 * smoothstep(0.86, 1.0, vUv.y));
      float a = uOpacity * rim * along;
      gl_FragColor = vec4(uColor * (0.55 + 0.45 * rim), a);
    }`
  const mkCone = (rTop, rBot, op) => {
    const uOp = { value: op }
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffe6bd) }, uOpacity: uOp },
      vertexShader: coneVS, fragmentShader: coneFS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
    const mesh = addMesh(head, new THREE.CylinderGeometry(rTop, rBot, 0.73, 40, 1, true), m, 0, 0, -0.585)
    mesh.rotation.x = Math.PI / 2
    mesh.raycast = () => {}
    mesh.renderOrder = 6
    return { mesh, uOp }
  }
  const outerCone = mkCone(0.105, 0.30, 0.10)
  const innerCone = mkCone(0.065, 0.17, 0.09)

  // 聚光灯
  const spot = new THREE.SpotLight(0xffeccd, 6, 2.6, 0.6, 0.8, 1.3)
  spot.position.set(0, 0, -0.205)
  spot.target.position.set(0, 0, -1.6)
  head.add(spot); head.add(spot.target)

  world.addPart('light', g, {
    label: '打光装置',
    htmlLabel: '环形光源 · 5600 K',
    anchor: [0.50, 2.98, 0.06],
  })
  world.root.add(g)

  world.onFrame(() => {
    const run = sim.process === 'FLOTATING'
    const b = clamp(sim.lightLevel / 100, 0, 1)
    const boost = 1 + (run ? 0.22 + 0.18 * sim.anim.foam : 0)
    const k = (0.42 + b * 1.55) * boost
    warmMat.color.copy(WARM).multiplyScalar(k)
    coolMat.color.copy(COOL).multiplyScalar(k * 0.85)
    beadMat.color.copy(WARM).multiplyScalar(k * 1.12)
    outerCone.uOp.value = (0.020 + b * 0.050) * boost
    innerCone.uOp.value = (0.014 + b * 0.034) * boost
    spot.intensity = (0.7 + b * 6.4) * boost
  })
}
