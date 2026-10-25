// 内部电气柜：柜体（开放前脸壳体）/ 变频器（CanvasTexture LCD）/ PLC 模块组
// partId: cabinet = 柜体壳体（装饰件，pickable:false）；vfd / plc = 柜内部件（internal，透视后可拾取）
// 坐标：柜体世界中心 (2.15, 0, 0.27)，外形 1.00 w × 1.92 h × 0.56 d，柜门朝 +Z（门面 world z ≈ 0.55）
import * as THREE from 'three'
import { MAT, GEO } from '../kit/lab-kit.js'

const CX = 2.15, CZ = 0.27
const BODY_W = 1.0, BODY_H = 1.92, BODY_D = 0.56
const BASE_H = 0.10                       // 落地底座高
const SHELL_H = BODY_H - BASE_H
const SHELL_MID = BASE_H + SHELL_H / 2
const DOOR_FACE = BODY_D / 2              // 门面局部 z = 0.28（世界 0.55）

const MONO = 'Consolas, "Courier New", monospace'
const SANS = '"Microsoft YaHei", "Segoe UI", Arial, sans-serif'

// ---------------------------------------------------------------- 小工具
function canvas2D(w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  return { canvas, ctx: canvas.getContext('2d') }
}
function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}
function boxGeo(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}
function cylGeo(r, h, seg, x, y, z, axis = 'y') {
  const g = new THREE.CylinderGeometry(r, r, h, seg)
  if (axis === 'z') g.rotateX(Math.PI / 2)
  else if (axis === 'x') g.rotateZ(Math.PI / 2)
  g.translate(x, y, z)
  return g
}
function mergedMesh(list, mat, cast = false, receive = false) {
  const m = new THREE.Mesh(GEO.merge(list), mat)
  m.castShadow = cast; m.receiveShadow = receive
  return m
}

// ---------------------------------------------------------------- Canvas 贴图
// 柜门铭牌（一次性绘制）
function nameplateTexture() {
  const { canvas, ctx } = canvas2D(512, 160)
  ctx.fillStyle = '#141a1c'; ctx.fillRect(0, 0, 512, 160)
  ctx.strokeStyle = 'rgba(126,158,166,0.45)'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, 502, 150)
  ctx.fillStyle = '#2fc0a8'; ctx.fillRect(22, 34, 5, 92)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#dfe8ea'
  ctx.font = `600 27px ${SANS}`
  try { ctx.letterSpacing = '2px' } catch (e) { /* 老内核忽略 */ }
  ctx.fillText('FLOTATION CONTROL CABINET', 40, 68)
  ctx.font = `500 22px ${SANS}`
  ctx.fillStyle = '#84b8bf'
  ctx.fillText('37 kW  ·  3~400 V  ·  IP54', 40, 108)
  ctx.fillStyle = '#51747a'
  ctx.font = `500 16px ${MONO}`
  ctx.fillText('No. EC-01', 390, 140)
  return canvasTexture(canvas)
}
// 门面高压警示贴
function dangerTexture() {
  const { canvas, ctx } = canvas2D(128, 160)
  ctx.fillStyle = '#e0bb32'; ctx.fillRect(0, 0, 128, 160)
  ctx.strokeStyle = '#141414'; ctx.lineWidth = 5; ctx.strokeRect(6, 6, 116, 148)
  ctx.beginPath(); ctx.moveTo(64, 18); ctx.lineTo(106, 92); ctx.lineTo(22, 92); ctx.closePath()
  ctx.lineWidth = 5; ctx.stroke()
  ctx.fillStyle = '#141414'
  ctx.textAlign = 'center'
  ctx.font = '700 44px Arial, sans-serif'
  ctx.fillText('!', 64, 84)
  ctx.font = '700 27px Arial, sans-serif'
  ctx.fillText('380V', 64, 126)
  ctx.font = '600 15px Arial, sans-serif'
  ctx.fillText('DANGER', 64, 146)
  return canvasTexture(canvas)
}
// 变频器型号铭牌
function vfdPlateTexture() {
  const { canvas, ctx } = canvas2D(512, 64)
  ctx.fillStyle = '#111517'; ctx.fillRect(0, 0, 512, 64)
  ctx.strokeStyle = 'rgba(120,150,158,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(3, 3, 506, 58)
  ctx.fillStyle = '#c9d6d9'
  ctx.font = `600 26px ${MONO}`
  ctx.fillText('VLT 302 · 37 kW', 18, 40)
  ctx.fillStyle = '#6f9ba2'
  ctx.font = `500 20px ${MONO}`
  ctx.fillText('3~400V · 71A · IP20', 250, 40)
  return canvasTexture(canvas)
}
// PLC 模块标签条（每个模块一张）
function moduleLabelTexture(text) {
  const { canvas, ctx } = canvas2D(192, 48)
  ctx.fillStyle = '#d6d9d5'; ctx.fillRect(0, 0, 192, 48)
  ctx.fillStyle = '#1a1d1e'
  ctx.font = '600 22px "Arial Narrow", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, 96, 33)
  return canvasTexture(canvas)
}

// ---------------------------------------------------------------- 材质（每个部件独立，一次性创建）
function makeMaterials() {
  const M = {}
  // 柜内大面积哑光件用不带纹理的 Standard 材质：漆面/贴图 roughness 会被 roughnessMap 压低，
  // 近距离下点光源容易在板面上烧出高光斑，柜内必须用真正的哑光面。
  const flat = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
  // 柜体深灰工业漆：线性 albedo 0.01–0.04（线性值太小会显脏，太大发白）
  M.shellPaint = MAT.paint({ color: [0.026, 0.030, 0.034], metalness: 0.46, roughness: 0.40, clearcoat: 0.35, clearcoatRoughness: 0.36 })
  M.doorPaint = MAT.paint({ color: [0.038, 0.042, 0.047], metalness: 0.44, roughness: 0.34, clearcoat: 0.50, clearcoatRoughness: 0.28 })
  M.trimPaint = MAT.paint({ color: [0.012, 0.014, 0.016], metalness: 0.50, roughness: 0.50 })
  M.hardware = MAT.steel({ color: [0.26, 0.275, 0.285], roughness: 0.36 })
  M.gasket = MAT.rubber({ color: [0.010, 0.011, 0.012], roughness: 0.9 })
  M.cabCable = MAT.rubber({ color: [0.020, 0.021, 0.024], roughness: 0.85 })
  // 柜内
  M.plate = flat(0x33383c, 0.86, 0.22)
  M.duct = flat(0x3b4045, 0.92, 0.0)
  M.rail = flat(0x8d949a, 0.42, 0.85)
  M.terminal = flat(0xb2b8bd, 0.44, 0.9)
  M.copper = flat(0xa8673d, 0.42, 0.85)
  M.block = flat(0x24282c, 0.85, 0.0)
  // 变频器
  M.vfdBody = flat(0x1c2023, 0.74, 0.10)
  M.vfdFace = flat(0x0e1012, 0.55, 0.15)
  M.dark = flat(0x08090a, 0.65, 0.05)
  M.alu = flat(0x9aa0a4, 0.40, 1.0)
  M.key = flat(0x171a1d, 0.48, 0.20)
  M.vfdCable = MAT.rubber({ color: [0.016, 0.017, 0.019], roughness: 0.86 })
  // PLC
  M.moduleBody = flat(0x191d20, 0.80, 0.05)
  M.moduleFace = flat(0x101315, 0.62, 0.05)
  M.mcb = flat(0x5c6369, 0.55, 0.05)
  // 铭牌 / 警示贴
  M.nameplate = new THREE.MeshStandardMaterial({
    map: nameplateTexture(), roughness: 0.42, metalness: 0.28,
    emissive: 0xffffff, emissiveIntensity: 0.14,
  })
  M.nameplate.emissiveMap = M.nameplate.map
  M.danger = new THREE.MeshBasicMaterial({ map: dangerTexture(), toneMapped: false })
  // 细线缆（PLC / 端子排）
  M.wireRed = new THREE.MeshStandardMaterial({ color: 0x8f2f24, roughness: 0.62 })
  M.wireBlue = new THREE.MeshStandardMaterial({ color: 0x25489a, roughness: 0.62 })
  M.wireBlack = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.66 })
  M.wireEarth = new THREE.MeshStandardMaterial({ color: 0x7f9430, roughness: 0.62 })
  return M
}

// ---------------------------------------------------------------- 柜体
function buildShell(world, sim, M) {
  const g = new THREE.Group()
  g.position.set(CX, 0, CZ)

  const add = (geo, mat, cast = true, receive = true) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = cast; m.receiveShadow = receive
    g.add(m); return m
  }
  const rb = (w, h, d, r = 0.004, s = 2) => GEO.rbox(w, h, d, r, s)

  // ---- 开放前脸壳体：背板 / 侧板 / 顶板 / 底板 / 底座（不是实心盒子）
  const t = 0.030
  add(rb(BODY_W, SHELL_H, t), M.shellPaint).position.set(0, SHELL_MID, -BODY_D / 2 + t / 2)
  add(rb(BODY_W, t, BODY_D), M.shellPaint).position.set(0, BODY_H - t / 2, 0)
  add(rb(BODY_W, 0.025, BODY_D), M.shellPaint).position.set(0, BASE_H + 0.0125, 0)
  add(rb(0.025, SHELL_H, BODY_D), M.shellPaint).position.set(-BODY_W / 2 + 0.0125, SHELL_MID, 0)
  add(rb(0.025, SHELL_H, BODY_D), M.shellPaint).position.set(BODY_W / 2 - 0.0125, SHELL_MID, 0)

  // ---- 落地小底座（内缩，形成柜脚阴影）
  add(rb(0.86, BASE_H, 0.36, 0.004), M.trimPaint).position.set(0, BASE_H / 2, -0.030)
  add(boxGeo(0.82, 0.012, 0.006, 0, 0.036, 0.1485), M.trimPaint, false, false)
  for (const sx of [-1, 1]) add(boxGeo(0.004, BASE_H - 0.02, 0.34, sx * 0.432, BASE_H / 2, -0.030), M.trimPaint, false, false)

  // ---- 前门框（上下横档 + 左右立柱，门嵌在其中；用深色勾出门缝）
  const openingTop = 1.879, openingBot = 0.1425
  const doorW = 0.945, doorH = openingTop - openingBot - 0.006
  const stileX = doorW / 2 + 0.0125
  add(rb(0.025, SHELL_H, 0.040), M.trimPaint).position.set(-stileX, SHELL_MID, DOOR_FACE - 0.020)
  add(rb(0.025, SHELL_H, 0.040), M.trimPaint).position.set(stileX, SHELL_MID, DOOR_FACE - 0.020)
  add(boxGeo(0.95, 0.042, 0.040, 0, (openingTop + BODY_H) / 2 - 0.001, DOOR_FACE - 0.020), M.trimPaint)
  add(boxGeo(0.95, 0.043, 0.040, 0, (BASE_H + openingBot) / 2, DOOR_FACE - 0.020), M.trimPaint)

  // ---- 柜门
  const doorZ = DOOR_FACE - 0.014
  const door = add(rb(doorW, doorH, 0.028, 0.005), M.doorPaint)
  door.position.set(0, (openingTop + openingBot) / 2, doorZ)
  // 门内侧加强筋（透视时能看到）
  for (const y of [0.52, 1.50]) {
    add(boxGeo(0.86, 0.028, 0.013, 0, y, doorZ - 0.019), M.shellPaint, false, false)
  }
  // 门边密封条（细，防漏光/缝隙）
  const seal = [
    boxGeo(0.006, doorH, 0.012, -doorW / 2 + 0.001, (openingTop + openingBot) / 2, doorZ - 0.014),
    boxGeo(0.006, doorH, 0.012, doorW / 2 - 0.001, (openingTop + openingBot) / 2, doorZ - 0.014),
    boxGeo(doorW, 0.006, 0.012, 0, openingTop - 0.002, doorZ - 0.014),
    boxGeo(doorW, 0.006, 0.012, 0, openingBot + 0.002, doorZ - 0.014),
  ]
  g.add(mergedMesh(seal, M.gasket))

  // 门面凹槽线（压型门板缝，近距离可读）
  const groove = []
  const gx0 = -doorW / 2 + 0.048, gx1 = doorW / 2 - 0.048
  const gy0 = openingBot + 0.048, gy1 = openingTop - 0.048
  groove.push(boxGeo(gx1 - gx0, 0.005, 0.003, 0, gy1, DOOR_FACE + 0.0008))
  groove.push(boxGeo(gx1 - gx0, 0.005, 0.003, 0, gy0, DOOR_FACE + 0.0008))
  groove.push(boxGeo(0.005, gy1 - gy0, 0.003, gx0, (gy0 + gy1) / 2, DOOR_FACE + 0.0008))
  groove.push(boxGeo(0.005, gy1 - gy0, 0.003, gx1, (gy0 + gy1) / 2, DOOR_FACE + 0.0008))
  g.add(mergedMesh(groove, M.trimPaint))

  // ---- 铰链（3 个，门左侧）
  const hinge = []
  for (const hy of [0.33, 1.01, 1.69]) {
    hinge.push(boxGeo(0.034, 0.100, 0.008, -doorW / 2 + 0.014, hy, doorZ + 0.0195))
    hinge.push(cylGeo(0.0130, 0.104, 12, -doorW / 2 - 0.002, hy, doorZ + 0.0195))
    hinge.push(cylGeo(0.0144, 0.008, 12, -doorW / 2 - 0.002, hy + 0.054, doorZ + 0.0195))
    hinge.push(cylGeo(0.0144, 0.008, 12, -doorW / 2 - 0.002, hy - 0.054, doorZ + 0.0195))
    hinge.push(cylGeo(0.0040, 0.005, 8, -doorW / 2 + 0.014, hy + 0.030, doorZ + 0.0235, 'z'))
    hinge.push(cylGeo(0.0040, 0.005, 8, -doorW / 2 + 0.014, hy - 0.030, doorZ + 0.0235, 'z'))
  }
  g.add(mergedMesh(hinge, M.hardware, true))

  // ---- 门把手 + 门锁（右侧）
  const hx = doorW / 2 - 0.055
  const hz = DOOR_FACE + 0.004
  const handle = [
    rb(0.056, 0.165, 0.010, 0.004).translate(hx, 1.02, hz + 0.001),
    rb(0.020, 0.115, 0.024, 0.006).translate(hx - 0.016, 1.03, hz + 0.012),
    rb(0.062, 0.022, 0.022, 0.006).translate(hx - 0.046, 1.072, hz + 0.012),
    rb(0.032, 0.058, 0.011, 0.003).translate(hx, 0.925, hz + 0.001),
    cylGeo(0.009, 0.014, 12, hx, 0.928, hz + 0.010, 'z'),
  ]
  g.add(mergedMesh(handle, M.hardware, true))
  // 锁芯钥匙孔
  g.add(new THREE.Mesh(boxGeo(0.0035, 0.012, 0.003, hx, 0.928, hz + 0.0185), M.trimPaint))

  // ---- 铭牌
  const plate = add(rb(0.36, 0.105, 0.006, 0.002), M.nameplate, false, false)
  plate.position.set(0, 1.60, DOOR_FACE + 0.004)
  const plateScrew = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) plateScrew.push(cylGeo(0.004, 0.005, 8, sx * 0.163, 1.60 + sy * 0.040, DOOR_FACE + 0.007, 'z'))
  g.add(mergedMesh(plateScrew, M.hardware))

  // ---- 高压警示贴
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.088, 0.110), M.danger)
  sticker.position.set(-0.345, 0.40, DOOR_FACE + 0.0015)
  g.add(sticker)

  // ---- 门下半部回风百叶
  const doorLouver = []
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) {
      doorLouver.push(boxGeo(0.056, 0.009, 0.005, -0.175 + i * 0.070, 0.225 + row * 0.024, DOOR_FACE + 0.0025))
    }
  }
  g.add(mergedMesh(doorLouver, M.trimPaint))

  // ---- 顶部散热槽（上表面两组百叶）
  const vent = [boxGeo(0.66, 0.006, 0.17, 0, BODY_H + 0.0025, -0.06)]
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 7; i++) {
      vent.push(boxGeo(0.072, 0.007, 0.014, -0.27 + i * 0.09, BODY_H + 0.0075, -0.115 + row * 0.088))
    }
  }
  g.add(mergedMesh(vent, M.trimPaint, true))

  // ---- 两侧散热槽（上部）
  const sideVent = []
  for (const sx of [-1, 1]) {
    for (const z of [-0.105, 0.055]) {
      for (let i = 0; i < 6; i++) {
        sideVent.push(boxGeo(0.007, 0.010, 0.048, sx * (BODY_W / 2 + 0.002), 1.63 + i * 0.032, z))
      }
    }
  }
  g.add(mergedMesh(sideVent, M.trimPaint))

  // ---- 底部进出线：封板 + 格兰头 + 电缆（引至后方地面）
  const gy = BASE_H - 0.0015, gz = 0.225
  g.add(new THREE.Mesh(boxGeo(0.28, 0.008, 0.09, 0.30, gy, gz), M.hardware))
  const glands = []
  for (const x of [0.22, 0.30, 0.38]) {
    glands.push(cylGeo(0.015, 0.030, 12, x, gy - 0.019, gz))
    glands.push(boxGeo(0.036, 0.007, 0.036, x, gy - 0.006, gz))
  }
  g.add(mergedMesh(glands, M.hardware))
  const cablePts = (x) => [
    [x, gy - 0.034, gz], [x, 0.036, gz + 0.012], [x + 0.012, 0.015, gz + 0.048],
    [x + 0.13, 0.012, gz + 0.095], [x + 0.26, 0.012, gz + 0.02], [x + 0.28, 0.012, -0.20], [x + 0.28, 0.012, -0.42],
  ]
  const cables = [
    new THREE.Mesh(GEO.pipe(cablePts(0.22), 0.011, { seg: 26, radial: 8 }), M.cabCable),
    new THREE.Mesh(GEO.pipe(cablePts(0.30), 0.013, { seg: 26, radial: 8 }), M.cabCable),
    new THREE.Mesh(GEO.pipe(cablePts(0.38), 0.010, { seg: 26, radial: 8 }), M.cabCable),
  ]
  for (const c of cables) { c.castShadow = true; g.add(c) }

  // ---- 柜内安装底板（镀锌板）-------------------------------------------
  const plateZ = -0.232
  add(rb(0.88, 1.52, 0.008, 0.002), M.plate).position.set(0, 1.00, plateZ)
  const plateBolts = []
  for (let i = 0; i < 4; i++) {
    plateBolts.push(cylGeo(0.006, 0.006, 8, (i % 2 ? 1 : -1) * 0.41, i < 2 ? 0.27 : 1.73, plateZ + 0.006, 'z'))
  }
  for (let i = 0; i < 3; i++) plateBolts.push(cylGeo(0.006, 0.006, 8, -0.2 + i * 0.2, 1.00, plateZ + 0.006, 'z'))
  g.add(mergedMesh(plateBolts, M.hardware))

  // 柜内照明灯条（冷白，顶部；亮度压低，避免形成眩光团）
  g.add(mergedMesh([boxGeo(0.66, 0.020, 0.046, 0, 1.868, 0.16)], M.trimPaint))
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.018),
    new THREE.MeshBasicMaterial({ color: 0x55636f, toneMapped: false })
  )
  strip.rotation.x = Math.PI / 2
  strip.position.set(0, 1.8578, 0.16)
  g.add(strip)

  // 两侧竖向线槽（把柜内两侧的空洞填满，走线也合理）
  const vDuct = []
  const vSlots = []
  for (const sx of [-1, 1]) {
    const x = sx * 0.404
    vDuct.push(boxGeo(0.075, 1.44, 0.055, x, 0.97, -0.165))
    for (let i = 0; i < 21; i++) vSlots.push(boxGeo(0.045, 0.011, 0.004, x, 0.32 + i * 0.062, -0.1375))
  }
  g.add(mergedMesh(vDuct, M.duct))
  g.add(mergedMesh(vSlots, M.dark))

  // 水平线槽（PLC 上方 / 下方），带梳齿槽细节
  const duct = (y, z, w) => {
    const list = [boxGeo(w, 0.052, 0.046, 0, y, z)]
    for (let i = 0; i < 18; i++) list.push(boxGeo(0.006, 0.050, 0.004, -w / 2 + 0.03 + i * 0.045, y, z + 0.023))
    g.add(mergedMesh(list, M.duct))
  }
  duct(0.867, 0.020, 0.86)
  duct(0.437, 0.000, 0.86)

  // 下端子排（DIN 导轨 + 端子块）+ 接地铜排
  g.add(new THREE.Mesh(boxGeo(0.80, 0.034, 0.012, 0, 0.30, -0.010), M.rail))
  const blocks = []
  for (let i = 0; i < 13; i++) {
    const bx = -0.216 + i * 0.036
    blocks.push(boxGeo(0.032, 0.054, 0.050, bx, 0.302, 0.004))
    blocks.push(boxGeo(0.026, 0.010, 0.046, bx, 0.333, 0.005))
  }
  g.add(mergedMesh(blocks, M.block))
  g.add(mergedMesh([
    boxGeo(0.44, 0.011, 0.013, 0, 0.212, -0.010),
    cylGeo(0.004, 0.006, 8, -0.19, 0.212, 0.0035, 'z'),
    cylGeo(0.004, 0.006, 8, -0.10, 0.212, 0.0035, 'z'),
    cylGeo(0.004, 0.006, 8, 0.10, 0.212, 0.0035, 'z'),
    cylGeo(0.004, 0.006, 8, 0.19, 0.212, 0.0035, 'z'),
  ], M.copper))
  // 端子排上几根短接线（向下进入线槽）
  const tbWires = []
  for (let i = 0; i < 5; i++) {
    const bx = -0.18 + i * 0.09
    tbWires.push(GEO.pipe([[bx, 0.326, 0.028], [bx, 0.36, 0.030], [bx + 0.004, 0.40, 0.02], [bx + 0.006, 0.412, 0.0]], 0.0024, { seg: 10, radial: 5 }))
  }
  g.add(mergedMesh(tbWires, M.wireBlack))

  // ---- 注册（壳体 + 门 + 五金 = 透视/剖切材质；bounds 供剖切轮廓线用）
  world.addPart('cabinet', g, {
    label: '内部电气柜', pickable: false,
    bounds: [[1.63, 0, -0.03], [2.67, 1.94, 0.58]],
    xrayMats: [M.shellPaint, M.doorPaint, M.trimPaint, M.hardware, M.nameplate, M.danger, M.gasket],
    cutMats: [M.shellPaint, M.doorPaint, M.trimPaint, M.hardware, M.nameplate, M.danger, M.gasket],
  })
  world.root.add(g)
  return g
}

// ---------------------------------------------------------------- 变频器
function drawVFD(ctx, tex, d) {
  const W = 512, H = 256
  const run = d.status === '运行'
  // 背景（深色玻璃屏 + 细网格）
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#081b1d'); bg.addColorStop(1, '#02090b')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(70,200,180,0.05)'; ctx.lineWidth = 1
  for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke() }
  for (let y = 0; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke() }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  // 顶栏
  ctx.fillStyle = '#5d9f96'; ctx.font = `600 19px ${SANS}`
  ctx.fillText('VFD 37 kW', 20, 33)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#456f6c'; ctx.font = `500 17px ${SANS}`
  ctx.fillText('刮板驱动 · 3~400 V', W - 78, 33)
  ctx.textAlign = 'left'
  const accent = run ? '#43f0b4' : '#ffb84d'
  ctx.save()
  ctx.shadowColor = accent; ctx.shadowBlur = 16
  ctx.fillStyle = accent
  ctx.beginPath(); ctx.arc(W - 54, 26, 7.5, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(80,200,180,0.22)'; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(20, 46); ctx.lineTo(W - 20, 46); ctx.stroke()

  // 主读数：输出频率
  const hz = d.outHz.toFixed(1)
  ctx.save()
  ctx.shadowColor = 'rgba(70,240,190,0.35)'; ctx.shadowBlur = 18
  ctx.fillStyle = '#e2fff6'; ctx.font = `700 96px ${MONO}`
  ctx.fillText(hz, 18, 148)
  ctx.restore()
  const hzW = ctx.measureText(hz).width
  ctx.fillStyle = '#6fd2bd'; ctx.font = `600 34px ${MONO}`
  ctx.fillText('Hz', 28 + hzW, 148)

  // 设定频率
  ctx.fillStyle = '#5b928c'; ctx.font = `500 16px ${MONO}`
  ctx.fillText('SET', 312, 76)
  ctx.fillStyle = '#ffcf7a'; ctx.font = `600 32px ${MONO}`
  const setTxt = d.setHz.toFixed(1)
  ctx.fillText(setTxt, 312, 112)
  const setW = ctx.measureText(setTxt).width
  ctx.fillStyle = '#8f7527'; ctx.font = `500 18px ${MONO}`
  ctx.fillText('Hz', 312 + setW + 5, 112)

  // 负载条
  ctx.fillStyle = '#5b928c'; ctx.font = `500 16px ${MONO}`
  ctx.fillText('LOAD', 312, 146)
  ctx.fillStyle = '#ffd27a'; ctx.font = `600 22px ${MONO}`
  ctx.fillText(`${d.load.toFixed(0)} %`, 372, 148)
  ctx.fillStyle = 'rgba(80,200,180,0.16)'; ctx.fillRect(312, 158, 178, 8)
  ctx.fillStyle = run ? '#43f0b4' : '#3b625f'
  ctx.fillRect(312, 158, Math.max(2, 178 * Math.min(1, d.load / 100)), 8)

  // 底部三读数
  ctx.strokeStyle = 'rgba(80,200,180,0.16)'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, 184); ctx.lineTo(W, 184); ctx.stroke()
  const cell = (x, label, value, unit) => {
    ctx.fillStyle = '#588d87'; ctx.font = `500 15px ${MONO}`
    ctx.fillText(label, x, 206)
    ctx.fillStyle = '#9df0dc'; ctx.font = `600 30px ${MONO}`
    ctx.fillText(value, x, 238)
    const vw = ctx.measureText(value).width
    ctx.fillStyle = '#5f9c95'; ctx.font = `500 17px ${MONO}`
    ctx.fillText(unit, x + vw + 5, 238)
  }
  cell(20, 'CURRENT', d.current.toFixed(1), 'A')
  cell(196, 'DC BUS', d.dcBus.toFixed(0), 'V')
  cell(356, 'HEAT', d.heat.toFixed(1), '°C')
  for (const x of [180, 340]) {
    ctx.strokeStyle = 'rgba(80,200,180,0.14)'
    ctx.beginPath(); ctx.moveTo(x, 194); ctx.lineTo(x, 248); ctx.stroke()
  }
  tex.needsUpdate = true
}

function buildVFD(world, sim, M) {
  const g = new THREE.Group()
  // 柜内局部坐标：面板面 z = 0.17（世界 0.44）
  g.position.set(CX - 0.02, 1.30, CZ + 0.04)

  const add = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = cast
    g.add(m); return m
  }
  // 本体
  add(GEO.rbox(0.40, 0.56, 0.26, 0.006, 2), M.vfdBody)
  // 前面板
  add(GEO.rbox(0.368, 0.528, 0.012, 0.003, 2), M.vfdFace).position.set(0, 0, 0.133)
  // 顶部散热格栅
  const grille = []
  for (let i = 0; i < 5; i++) grille.push(boxGeo(0.30, 0.007, 0.005, 0, 0.200 + i * 0.0125, 0.1405))
  for (let i = 0; i < 4; i++) grille.push(boxGeo(0.008, 0.048, 0.004, -0.10 + i * 0.066, 0.224, 0.1405))
  g.add(mergedMesh(grille, M.dark))
  // 底部通风格栅
  const grille2 = []
  for (let i = 0; i < 4; i++) grille2.push(boxGeo(0.30, 0.006, 0.005, 0, -0.195 - i * 0.011, 0.1405))
  g.add(mergedMesh(grille2, M.dark))
  // LCD 遮光框
  add(GEO.rbox(0.264, 0.144, 0.005, 0.002, 2), M.dark).position.set(0, 0.105, 0.1405)
  // LCD（512×256 CanvasTexture，动态刷新）
  const { canvas: lcdCanvas, ctx: lcdCtx } = canvas2D(512, 256)
  const lcdTex = canvasTexture(lcdCanvas)
  const lcdMat = new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false })
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.240, 0.120), lcdMat)
  lcd.position.set(0, 0.105, 0.1435)
  g.add(lcd)
  // 屏玻璃：不加（避免点光源高光盖住读数）
  // 状态 LED（独立小 Mesh）
  const ledInfo = [
    { x: -0.112, mat: new THREE.MeshBasicMaterial({ color: 0x122a20, toneMapped: false }), role: 'run' },
    { x: -0.077, mat: new THREE.MeshBasicMaterial({ color: 0x102a20, toneMapped: false }), role: 'blink' },
    { x: -0.042, mat: new THREE.MeshBasicMaterial({ color: 0x2a1c0c, toneMapped: false }), role: 'alarm' },
    { x: -0.007, mat: new THREE.MeshBasicMaterial({ color: 0x1d3033, toneMapped: false }), role: 'link' },
  ]
  for (const li of ledInfo) {
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0058, 8, 6), li.mat)
    led.position.set(li.x, 0.004, 0.1435)
    led.castShadow = false
    g.add(led)
  }
  // 操作按键（4 个）
  const keys = []
  for (let i = 0; i < 4; i++) keys.push(GEO.rbox(0.052, 0.030, 0.012, 0.003, 2).translate(-0.100 + i * 0.070, -0.076, 0.1405))
  g.add(mergedMesh(keys, M.key))
  // 型号铭牌
  const vfdPlateMat = new THREE.MeshStandardMaterial({
    map: vfdPlateTexture(), roughness: 0.45, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.12,
  })
  vfdPlateMat.emissiveMap = vfdPlateMat.map
  add(GEO.rbox(0.30, 0.038, 0.004, 0.001, 2), vfdPlateMat, false).position.set(0, -0.128, 0.1408)
  // 底部接线盖 + 格兰头
  add(GEO.rbox(0.34, 0.045, 0.02, 0.003, 2), M.dark).position.set(0, -0.245, 0.125)
  const vGland = []
  for (const gx of [-0.10, -0.02, 0.09]) {
    vGland.push(cylGeo(0.015, 0.028, 12, gx, -0.283, 0.015))
    vGland.push(boxGeo(0.036, 0.007, 0.036, gx, -0.288, 0.015))
  }
  g.add(mergedMesh(vGland, M.hardware))
  // 背面散热片阵列
  add(boxGeo(0.34, 0.50, 0.014, 0, 0, -0.137), M.alu)
  const fins = []
  for (let i = 0; i < 13; i++) fins.push(boxGeo(0.007, 0.48, 0.085, -0.156 + i * 0.026, 0, -0.187))
  g.add(mergedMesh(fins, M.alu, true))
  // 底部安装脚
  const feet = []
  for (const sx of [-0.15, 0.15]) feet.push(boxGeo(0.05, 0.012, 0.14, sx, -0.286, -0.10))
  g.add(mergedMesh(feet, M.rail))
  // 动力电缆（含屏蔽层）+ 控制电缆
  const motor = GEO.pipe([[0.09, -0.30, 0.015], [0.09, -0.355, 0.015], [0.086, -0.41, 0.008], [0.082, -0.437, 0.0]], 0.013, { seg: 14, radial: 8 })
  const ctrl1 = GEO.pipe([[-0.10, -0.30, 0.010], [-0.10, -0.35, 0.008], [-0.096, -0.40, 0.004], [-0.092, -0.437, 0.0]], 0.006, { seg: 14, radial: 6 })
  const ctrl2 = GEO.pipe([[-0.02, -0.30, 0.030], [-0.02, -0.35, 0.026], [-0.016, -0.40, 0.010], [-0.012, -0.437, 0.0]], 0.006, { seg: 14, radial: 6 })
  g.add(mergedMesh([motor, ctrl1, ctrl2], M.vfdCable, true))
  // 屏蔽层压接环 + 接地线
  g.add(new THREE.Mesh(cylGeo(0.0165, 0.030, 12, 0.09, -0.335, 0.015), M.alu))
  g.add(new THREE.Mesh(GEO.pipe([[-0.155, -0.296, 0.03], [-0.175, -0.34, 0.012], [-0.19, -0.40, -0.005]], 0.0035, { seg: 12, radial: 6 }), M.copper))

  world.addPart('vfd', g, {
    label: '变频器', internal: true, htmlLabel: '变频器 · 37 kW',
    anchor: [2.07, 1.9, 0.62],
  })
  world.root.add(g)

  // ---- 刷新：LCD 限频 ~8 Hz；LED 每帧
  let acc = 1
  world.onFrame((dt) => {
    const d = sim.data.vfd
    acc += dt
    if (acc >= 0.12) { acc = 0; drawVFD(lcdCtx, lcdTex, d) }
    const run = d.status === '运行'
    const t = sim.t
    const blinkOn = Math.sin(t * 6.28) > -0.15
    ledInfo[0].mat.color.setHex(run ? 0x46f5a5 : 0x11342a)
    ledInfo[1].mat.color.setHex(run ? (blinkOn ? 0x2fe08d : 0x0a2118) : 0x0a2118)
    ledInfo[2].mat.color.setHex(!run && d.faults && d.faults.length ? 0xffab3d : 0x2a1c0c)
    ledInfo[3].mat.color.setHex(run ? 0x2d8f96 : 0x173f43)
  })
}

// ---------------------------------------------------------------- PLC
function buildPLC(world, sim, M) {
  const g = new THREE.Group()
  g.position.set(CX, 0.64, CZ)

  const add = (geo, mat, cast = false) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = cast
    g.add(m); return m
  }
  // DIN 导轨 + 支架（接到安装底板）
  add(boxGeo(0.80, 0.035, 0.014, 0, -0.030, -0.130), M.rail)
  add(boxGeo(0.20, 0.030, 0.010, 0, -0.030, -0.160), M.rail)
  for (const sx of [-1, 1]) {
    add(boxGeo(0.020, 0.030, 0.090, sx * 0.33, -0.030, -0.185), M.rail)
    add(boxGeo(0.020, 0.070, 0.010, sx * 0.33, -0.020, -0.228), M.rail)
  }
  add(boxGeo(0.022, 0.048, 0.020, -0.375, -0.030, -0.120), M.rail)
  add(boxGeo(0.022, 0.048, 0.020, 0.375, -0.030, -0.120), M.rail)

  const mods = [
    { w: 0.058, name: 'PS 24V', kind: 'ps' },
    { w: 0.115, name: 'CPU 1214C', kind: 'cpu' },
    { w: 0.070, name: 'DI 16', kind: 'io' },
    { w: 0.070, name: 'DO 16', kind: 'io' },
    { w: 0.070, name: 'AI 4', kind: 'io' },
  ]
  const MOD_H = 0.185, MOD_D = 0.150, MOD_CZ = -0.045
  const gap = 0.005
  let total = gap * (mods.length - 1)
  for (const m of mods) total += m.w
  let cx = -total / 2

  const moduleBodies = []
  const terminals = []
  const grilles = []
  const accent = []
  const ledPos = []
  const eth = []

  for (let mi = 0; mi < mods.length; mi++) {
    const mod = mods[mi]
    const half = mod.w / 2
    // 模块本体（每个模块独立几何、宽度不同，之间留面板缝）
    moduleBodies.push(GEO.rbox(mod.w, MOD_H, MOD_D, 0.004, 2).translate(cx, 0, MOD_CZ))
    // 面板（略凸出）
    add(GEO.rbox(mod.w - 0.010, 0.135, 0.008, 0.002, 2), M.moduleFace).position.set(cx, 0, 0.034)
    // 上下端子排（6–10 个小方块，独立阵列，凸出模块面板）
    const n = mod.kind === 'ps' ? 6 : mod.kind === 'cpu' ? 9 : 8
    const bw = (mod.w - 0.012) / n
    for (let k = 0; k < n; k++) {
      const tx = cx - (mod.w - 0.012) / 2 + bw * (k + 0.5)
      terminals.push(boxGeo(bw - 0.0018, 0.020, 0.056, tx, 0.079, 0.012))
      terminals.push(boxGeo(bw - 0.0018, 0.020, 0.056, tx, -0.079, 0.012))
    }
    // 面板下部细格栅
    for (let k = 0; k < 3; k++) grilles.push(boxGeo(mod.w - 0.022, 0.0040, 0.0025, cx, -0.026 - k * 0.010, 0.0385))
    // 色条 / 型号标签
    accent.push(boxGeo(mod.w - 0.020, 0.005, 0.002, cx, 0.012, 0.0385))
    const lm = new THREE.MeshStandardMaterial({ map: moduleLabelTexture(mod.name), roughness: 0.5, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.10 })
    lm.emissiveMap = lm.map
    add(boxGeo(Math.min(mod.w - 0.020, 0.075), 0.0145, 0.002, cx, 0.030, 0.0385), lm, false)
    // 每个模块 4 颗 LED（RUN / ERR / IO / IO2）
    for (let k = 0; k < 4; k++) {
      ledPos.push([cx - half + 0.0135 + k * 0.0118, 0.052, 0.0415])
    }
    // CPU 网口
    if (mod.kind === 'cpu') {
      eth.push(boxGeo(0.042, 0.016, 0.006, cx + 0.026, -0.062, 0.039))
      eth.push(boxGeo(0.032, 0.022, 0.004, cx + 0.026, -0.062, 0.0355))
    }
    cx += mod.w + gap
  }
  g.add(mergedMesh(moduleBodies, M.moduleBody, true))
  g.add(mergedMesh(terminals, M.terminal, false))
  g.add(mergedMesh(grilles, M.dark))
  g.add(mergedMesh(accent, M.dark))
  if (eth.length) g.add(mergedMesh(eth, M.key))

  // ---- 同一根导轨上的辅助器件：右侧 3 只微型断路器、左侧 1 只接触器
  const mcbBody = []
  const mcbLever = []
  for (let i = 0; i < 3; i++) {
    const x = 0.238 + i * 0.049
    mcbBody.push(GEO.rbox(0.043, 0.170, 0.100, 0.003, 2).translate(x, 0, MOD_CZ))
    mcbLever.push(boxGeo(0.016, 0.034, 0.022, x, 0.040, 0.012))
  }
  const cont = GEO.rbox(0.072, 0.165, 0.115, 0.004, 2).translate(-0.262, 0, MOD_CZ - 0.005)
  g.add(mergedMesh(mcbBody, M.mcb, true))
  g.add(new THREE.Mesh(cont, M.moduleBody))
  g.add(mergedMesh(mcbLever, M.key))
  g.add(mergedMesh([
    boxGeo(0.056, 0.030, 0.003, -0.262, 0.032, 0.018),
    boxGeo(0.044, 0.008, 0.003, -0.262, -0.005, 0.018),
  ], M.dark))

  // ---- LED：InstancedMesh（每颗独立颜色，随 sim.process）
  const ledGeo = new THREE.SphereGeometry(0.0048, 8, 6)
  const ledMat = new THREE.MeshBasicMaterial({ toneMapped: false })
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, ledPos.length)
  leds.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  leds.frustumCulled = false
  const m4 = new THREE.Matrix4()
  const cTmp = new THREE.Color()
  for (let i = 0; i < ledPos.length; i++) {
    leds.setMatrixAt(i, m4.makeTranslation(ledPos[i][0], ledPos[i][1], ledPos[i][2]))
    leds.setColorAt(i, cTmp.setHex(0x0d2418))
  }
  if (leds.instanceColor) leds.instanceColor.needsUpdate = true
  g.add(leds)

  // ---- 顶部端子出线（进入上方线槽）
  const wires = { red: [], blue: [], black: [], earth: [] }
  const wireSpan = [-0.17, -0.13, -0.04, 0.03, 0.10, 0.15]
  for (let i = 0; i < wireSpan.length; i++) {
    const x = wireSpan[i]
    const p = [[x, 0.092, -0.010], [x, 0.125, -0.004], [x + 0.002, 0.165, 0.004], [x + 0.004, 0.203, 0.012]]
    const key = i % 4 === 0 ? 'red' : i % 4 === 1 ? 'blue' : i % 4 === 3 ? 'earth' : 'black'
    wires[key].push(GEO.pipe(p, 0.0022, { seg: 10, radial: 5 }))
  }
  // 底部 I/O 出线（进入下方线槽）
  for (let i = 0; i < 5; i++) {
    const x = -0.14 + i * 0.070
    const p = [[x, -0.092, -0.010], [x, -0.125, -0.004], [x + 0.002, -0.170, 0.002], [x + 0.004, -0.198, 0.008]]
    const key = i % 3 === 0 ? 'blue' : 'black'
    wires[key].push(GEO.pipe(p, 0.0022, { seg: 10, radial: 5 }))
  }
  for (const key of Object.keys(wires)) {
    if (!wires[key].length) continue
    const mat = key === 'red' ? M.wireRed : key === 'blue' ? M.wireBlue : key === 'earth' ? M.wireEarth : M.wireBlack
    g.add(mergedMesh(wires[key], mat))
  }

  world.addPart('plc', g, {
    label: 'PLC', internal: true, htmlLabel: 'PLC · S7-1200',
    anchor: [2.15, 0.90, 0.62],
  })
  world.root.add(g)

  // ---- 状态刷新：RUN 常亮（PLC 上电即运行），FLOTATING 时 IO/通道灯闪
  const GREEN = 0x46f5a5, RED = 0xff5a4d, DIM_RED = 0x2a1210
  const CYAN = 0x3fe0c5, DIM_CYAN = 0x0e2d2a
  world.onFrame(() => {
    const run = sim.process === 'FLOTATING'
    const t = sim.t
    for (let i = 0; i < ledPos.length; i++) {
      const mod = Math.floor(i / 4), role = i % 4
      const ph = mod * 0.9
      let col
      if (role === 0) col = GREEN                                   // RUN 常亮
      else if (role === 1) col = DIM_RED                            // ERR 熄灭（无故障）
      else if (role === 2) col = run ? (Math.sin(t * 9.0 + ph) > -0.2 ? CYAN : DIM_CYAN) : DIM_CYAN
      else col = run ? (Math.sin(t * 4.4 + ph * 1.7) > 0 ? CYAN : DIM_CYAN) : DIM_CYAN
      leds.setColorAt(i, cTmp.setHex(col))
    }
    if (leds.instanceColor) leds.instanceColor.needsUpdate = true
  })
}

// ---------------------------------------------------------------- 入口
export function buildCabinet(world) {
  const sim = world.sim
  const M = makeMaterials()
  buildShell(world, sim, M)
  buildVFD(world, sim, M)
  buildPLC(world, sim, M)

  // 柜内冷白照明：低强度、短距离；只照柜内（关灯时柜门外观不受影响）
  // 偏置安装，避免在安装板/线槽上烧出正中的点光斑
  const lampTop = new THREE.PointLight(0xdcecff, 0.95, 1.10, 2)
  lampTop.position.set(CX - 0.28, 1.76, CZ + 0.19)
  world.scene.add(lampTop)
  const lampLow = new THREE.PointLight(0xe6f2ff, 0.58, 0.80, 2)
  lampLow.position.set(CX + 0.05, 0.60, CZ + 0.22)
  world.scene.add(lampLow)
}
