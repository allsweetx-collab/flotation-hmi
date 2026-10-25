// 外部机组 B：气泵（混凝土基座/泵体/电机/联轴器护罩/进出口法兰/波纹软管/压力表/指示灯）
//              + 刮板机构（横跨槽顶的轴/轴承座/薄叶片/减速电机/接矿溜槽与精矿桶）
import * as THREE from 'three'
import { MAT, GEO, clamp, lerp } from '../kit/lab-kit.js'

export function buildExternalB(world) {
  buildPump(world, world.sim)
  buildScraper(world, world.sim)
}

// ---------------------------------------------------------------- helpers
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const UP_AXIS = new THREE.Vector3(0, 1, 0)

function put(parent, geo, mat, x = 0, y = 0, z = 0, shadow = false) {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = shadow
  parent.add(m)
  return m
}
/** 一根在两点之间的矩形杆件（支架、斜撑），几何只在构建期创建 */
function strut(parent, a, b, w, t, mat, shadow = false) {
  const A = new THREE.Vector3(a[0], a[1], a[2])
  const B = new THREE.Vector3(b[0], b[1], b[2])
  const d = new THREE.Vector3().subVectors(B, A)
  const len = d.length()
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, t), mat)
  m.position.copy(A).addScaledVector(d, 0.5)
  m.quaternion.setFromUnitVectors(UP_AXIS, d.normalize())
  m.castShadow = shadow
  parent.add(m)
  return m
}
/** 设备铭牌：程序生成贴图，不依赖外部资源 */
function namePlate(title, sub) {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 160
  const g = c.getContext('2d')
  g.fillStyle = '#14181a'; g.fillRect(0, 0, 512, 160)
  g.strokeStyle = '#6f7d81'; g.lineWidth = 5; g.strokeRect(9, 9, 494, 142)
  g.fillStyle = '#cfd8d4'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.font = 'bold 46px "Microsoft YaHei","Noto Sans SC",sans-serif'
  g.fillText(title, 256, 62)
  g.fillStyle = '#8b979a'; g.font = '24px "Microsoft YaHei","Noto Sans SC",sans-serif'
  g.fillText(sub, 256, 116)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}
/** 螺栓（六角头 + 垫圈），几何复用 */
function boltSet(mat, heads) {
  const head = new THREE.CylinderGeometry(0.011, 0.011, 0.016, 6)
  const washer = new THREE.CylinderGeometry(0.019, 0.019, 0.005, 12)
  return { head, washer, mat, list: heads }
}
function boltAt(parent, set, x, y, z, axis = 'y') {
  const h = new THREE.Mesh(set.head, set.mat)
  h.position.set(x, y, z)
  if (axis === 'x') h.rotation.z = Math.PI / 2
  else if (axis === 'z') h.rotation.x = Math.PI / 2
  parent.add(h)
  const w = new THREE.Mesh(set.washer, set.mat)
  w.position.copy(h.position)
  w.rotation.copy(h.rotation)
  w.position.y -= axis === 'y' ? 0.007 : 0
  parent.add(w)
  return h
}

// ================================================================ air pump
function buildPump(world, sim) {
  const g = new THREE.Group()
  g.position.set(-2.02, 0, -0.35)

  // ---- 材质（只创建一次；线性 albedo 走暗值）
  const mConcrete = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.072, 0.07, 0.065), roughness: 0.95, metalness: 0.02 })
  const mCast = MAT.castIron({ color: [0.082, 0.087, 0.094], roughness: 0.5, metalness: 0.68 })
  const mSteel = MAT.steel({ color: [0.19, 0.20, 0.21], roughness: 0.4 })
  const mBright = MAT.steel({ color: [0.40, 0.41, 0.42], roughness: 0.24 })
  const mDark = MAT.steelDark({ color: [0.028, 0.031, 0.034], roughness: 0.62 })
  const mMotor = MAT.paint({ color: [0.030, 0.058, 0.068], roughness: 0.42 })
  const mGuard = MAT.paint({ color: [0.16, 0.078, 0.014], roughness: 0.42 })
  const mRubber = MAT.rubber({ color: [0.021, 0.022, 0.024] })
  const mDial = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.58, 0.555, 0.47), roughness: 0.6, metalness: 0.0, emissive: new THREE.Color(0.06, 0.055, 0.04) })
  const mNeedle = new THREE.MeshBasicMaterial({ color: 0xa02b1b, toneMapped: false })
  const mRedMark = new THREE.MeshBasicMaterial({ color: 0x7d2013, toneMapped: false })
  const mGlass = new THREE.MeshStandardMaterial({ color: 0x93a9ab, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.16, depthWrite: false })
  const ledOn = new THREE.Color(0.04, 0.76, 0.56)
  const ledOff = new THREE.Color(0.010, 0.026, 0.022)
  const ledMat = new THREE.MeshBasicMaterial({ color: ledOff.clone(), toneMapped: false })

  // ---- 混凝土基座 + 地脚螺栓
  const pad = put(g, GEO.rbox(0.86, 0.16, 0.74, 0.014), mConcrete, -0.09, 0.08, 0, true)
  pad.receiveShadow = true
  // 台面抹灰边
  put(g, new THREE.BoxGeometry(0.89, 0.012, 0.77), mDark, -0.09, 0.163, 0)
  const anchors = boltSet(mBright)
  for (const sx of [-0.43, 0.25]) for (const sz of [-0.29, 0.29]) {
    boltAt(g, anchors, sx, 0.178, sz)
    put(g, new THREE.CylinderGeometry(0.009, 0.009, 0.052, 8), mSteel, sx, 0.19, sz)
  }

  // ---- 钢制机架（槽钢）
  const railGeo = new THREE.BoxGeometry(0.82, 0.075, 0.062)
  const crossGeo = new THREE.BoxGeometry(0.062, 0.075, 0.40)
  for (const sz of [-0.17, 0.17]) put(g, railGeo, mSteel, -0.09, 0.1975, sz, true)
  for (const sx of [-0.455, 0.265]) put(g, crossGeo, mSteel, sx, 0.1975, 0, true)
  // 机架与基座之间的调整垫片
  for (const sx of [-0.40, 0.20]) for (const sz of [-0.17, 0.17]) put(g, new THREE.BoxGeometry(0.07, 0.008, 0.075), mDark, sx, 0.239, sz)

  // ---- 泵体（圆柱 + 端盖 + 螺栓圈 + 进出口法兰）
  const barrel = put(g, GEO.lathe([[0, -0.13], [0.16, -0.13], [0.205, -0.12], [0.226, -0.10], [0.232, -0.06], [0.232, 0.06], [0.226, 0.10], [0.205, 0.12], [0.16, 0.13], [0, 0.13]], 40), mCast, 0.09, 0.62, 0, true)
  barrel.rotation.z = -Math.PI / 2
  const coverGeo = GEO.disc(0.245, 0.03, 0.008, 40)
  for (const cx of [-0.05, 0.23]) {
    const c = put(g, coverGeo, mSteel, cx, 0.62, 0, true)
    c.rotation.z = -Math.PI / 2
  }
  // 端盖螺栓圈
  const ringA = put(g, GEO.bolts(12, 0.208, 0.011, 0.018), mBright, -0.065, 0.62, 0, true)
  ringA.rotation.z = Math.PI / 2
  const ringB = put(g, GEO.bolts(12, 0.208, 0.011, 0.018), mBright, 0.245, 0.62, 0, true)
  ringB.rotation.z = -Math.PI / 2
  // 加固环
  const stiffGeo = new THREE.TorusGeometry(0.234, 0.009, 6, 28)
  for (const sx of [0.02, 0.16]) {
    const s = put(g, stiffGeo, mCast, sx, 0.62, 0, true)
    s.rotation.y = Math.PI / 2
  }
  // 泵体支脚
  for (const sx of [0.02, 0.16]) for (const sz of [-0.15, 0.15]) {
    put(g, new THREE.BoxGeometry(0.08, 0.152, 0.05), mCast, sx, 0.312, sz, true)
    put(g, new THREE.BoxGeometry(0.11, 0.014, 0.075), mSteel, sx, 0.242, sz)
  }
  // 出口立管 + 法兰（+Y）
  put(g, GEO.tube(0.062, 0.05, 0.17, 28), mSteel, 0.16, 0.885, 0, true)
  const dFlange = put(g, GEO.disc(0.088, 0.028, 0.006, 32), mSteel, 0.16, 0.984, 0, true)
  put(g, GEO.bolts(6, 0.070, 0.0085, 0.014), mBright, 0.16, 0.998, 0)
  // 进口（-Z 侧）：短管 + 法兰 + 消声过滤器
  const inletPipe = put(g, GEO.tube(0.075, 0.062, 0.13, 24), mSteel, 0.05, 0.62, -0.275, true)
  inletPipe.rotation.x = Math.PI / 2
  const inFlange = put(g, GEO.disc(0.10, 0.022, 0.006, 28), mSteel, 0.05, 0.62, -0.345)
  inFlange.rotation.x = Math.PI / 2
  put(g, GEO.bolts(6, 0.082, 0.0085, 0.014), mBright, 0.05, 0.62, -0.352).rotation.x = -Math.PI / 2
  const sil = put(g, GEO.disc(0.105, 0.14, 0.012, 28), mCast, 0.05, 0.62, -0.43, true)
  sil.rotation.x = Math.PI / 2
  for (let i = 0; i < 5; i++) {
    const slot = put(g, new THREE.BoxGeometry(0.15, 0.012, 0.012), mDark, 0.05, 0.62, -0.503)
    slot.rotation.z = 0
    slot.position.y = 0.62 + (i - 2) * 0.032
  }
  strut(g, [0.05, 0.24, -0.43], [0.05, 0.50, -0.43], 0.045, 0.045, mDark)

  // ---- 电机（散热筋 + 接线盒 + 风扇罩）
  const motor = put(g, GEO.lathe([[0, -0.15], [0.115, -0.15], [0.146, -0.13], [0.146, 0.13], [0.115, 0.15], [0, 0.15]], 36), mMotor, -0.30, 0.62, 0, true)
  motor.rotation.z = -Math.PI / 2
  const finGeo = new THREE.TorusGeometry(0.150, 0.0055, 6, 20)
  for (let i = 0; i < 12; i++) {
    const f = put(g, finGeo, mMotor, -0.425 + i * 0.0255, 0.62, 0, true)
    f.rotation.y = Math.PI / 2
  }
  const endBell = put(g, GEO.disc(0.148, 0.022, 0.006, 28), mMotor, -0.143, 0.62, 0, true)
  endBell.rotation.z = -Math.PI / 2
  const cowl = put(g, GEO.tube(0.152, 0.132, 0.06, 24), mMotor, -0.482, 0.62, 0, true)
  cowl.rotation.z = Math.PI / 2
  for (let i = 0; i < 3; i++) {
    const gr = put(g, new THREE.BoxGeometry(0.006, 0.27, 0.012), mDark, -0.513, 0.62, 0)
    gr.rotation.x = (i / 3) * Math.PI
  }
  // 接线盒 + 电缆
  const term = put(g, GEO.rbox(0.11, 0.07, 0.09, 0.008), mMotor, -0.30, 0.80, 0, true)
  put(g, new THREE.CylinderGeometry(0.016, 0.016, 0.03, 10), mBright, -0.30, 0.847, 0)
  const cable = new THREE.Mesh(GEO.pipe([[-0.30, 0.845, 0.02], [-0.31, 0.70, 0.14], [-0.28, 0.45, 0.17], [-0.16, 0.30, 0.21], [-0.02, 0.27, 0.235], [0.02, 0.27, 0.25]], 0.008, { seg: 28, radial: 6 }), mRubber)
  g.add(cable)
  // 电机底脚
  for (const sx of [-0.38, -0.22]) for (const sz of [-0.105, 0.105]) {
    put(g, new THREE.BoxGeometry(0.055, 0.239, 0.04), mDark, sx, 0.354, sz, true)
    put(g, new THREE.BoxGeometry(0.08, 0.014, 0.065), mSteel, sx, 0.243, sz)
  }

  // ---- 联轴器护罩（前侧敞开，可见内部旋转联轴器）+ 转子
  const rotor = new THREE.Group()
  rotor.position.set(-0.12, 0.62, 0)
  const shaftGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.22, 16)
  const keyGeo = new THREE.BoxGeometry(0.11, 0.013, 0.013)
  const halfGeo = GEO.disc(0.052, 0.026, 0.006, 24)
  const cboltGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.078, 8)
  const rShaft = put(rotor, shaftGeo, mBright, 0, 0, 0, true)
  rShaft.rotation.z = Math.PI / 2
  for (const hx of [-0.035, 0.035]) {
    const h = put(rotor, halfGeo, mBright, hx, 0, 0, true)
    h.rotation.z = Math.PI / 2
  }
  const key = put(rotor, keyGeo, mSteel, 0, 0.028, 0)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    const cb = put(rotor, cboltGeo, mBright, 0, Math.cos(a) * 0.032, Math.sin(a) * 0.032)
    cb.rotation.z = Math.PI / 2
  }
  key.rotation.x = 0
  g.add(rotor)
  // 护罩：两侧板 + 顶板（前 +Z 与底部敞开）
  const guardSideGeo = new THREE.BoxGeometry(0.15, 0.27, 0.008)
  for (const sz of [-0.105, 0.105]) put(g, guardSideGeo, mGuard, -0.12, 0.632, sz, true)
  put(g, new THREE.BoxGeometry(0.15, 0.008, 0.218), mGuard, -0.12, 0.771, 0, true)
  // 护罩铰链与搭扣
  for (const sz of [-0.10, 0.10]) put(g, new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), mDark, -0.185, 0.771, sz).rotation.z = Math.PI / 2
  put(g, new THREE.BoxGeometry(0.03, 0.035, 0.02), mDark, -0.05, 0.50, 0.108)

  // ---- 压力表（表盘 + 刻度 + 红区 + 指针）
  const gauge = new THREE.Group()
  gauge.position.set(0.05, 0.862, 0.30)
  gauge.rotation.x = -0.55
  const gBody = put(gauge, GEO.tube(0.085, 0.075, 0.042, 32), mSteel, 0, 0, 0, true)
  gBody.rotation.x = Math.PI / 2
  put(gauge, new THREE.TorusGeometry(0.082, 0.007, 8, 28), mSteel, 0, 0, 0.021)
  const dialFace = put(gauge, new THREE.CircleGeometry(0.073, 40), mDial, 0, 0, 0.0225)
  const tickGeo = new THREE.BoxGeometry(0.0035, 0.013, 0.0015)
  const tickLong = new THREE.BoxGeometry(0.004, 0.02, 0.002)
  for (let i = 0; i <= 10; i++) {
    const a = lerp(-1.1, 1.15, i / 10)
    const t = put(gauge, i % 5 === 0 ? tickLong : tickGeo, mSteel, -Math.sin(a) * 0.058, Math.cos(a) * 0.058, 0.0245)
    t.rotation.z = a
  }
  // 高压红区
  const redArc = put(gauge, new THREE.TorusGeometry(0.064, 0.0032, 4, 16, 0.43), mRedMark, 0, 0, 0.024)
  redArc.rotation.z = 0.72 * 2.25 - 1.1 + Math.PI / 2
  const needle = new THREE.Group()
  needle.position.z = 0.026
  const nGeo = new THREE.BoxGeometry(0.0045, 0.06, 0.0018).translate(0, 0.022, 0)
  put(needle, nGeo, mNeedle, 0, 0, 0)
  const tailGeo = new THREE.BoxGeometry(0.006, 0.018, 0.0018).translate(0, -0.012, 0)
  put(needle, tailGeo, mNeedle, 0, 0, 0)
  gauge.add(needle)
  const cap = put(gauge, new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12), mBright, 0, 0, 0.03)
  cap.rotation.x = Math.PI / 2
  const glass = put(gauge, new THREE.CircleGeometry(0.071, 32), mGlass, 0, 0, 0.031)
  g.add(gauge)
  // 表架
  strut(g, [0.05, 0.79, 0.16], [0.05, 0.857, 0.288], 0.032, 0.026, mSteel, true)
  put(g, new THREE.BoxGeometry(0.07, 0.02, 0.05), mSteel, 0.05, 0.783, 0.155)

  // ---- 现场控制盒 + 运行指示灯
  put(g, GEO.rbox(0.17, 0.12, 0.075, 0.008), mDark, 0.03, 0.26, 0.235, true)
  put(g, new THREE.BoxGeometry(0.19, 0.012, 0.09), mSteel, 0.03, 0.205, 0.235)
  put(g, new THREE.CylinderGeometry(0.018, 0.018, 0.014, 12), mSteel, -0.03, 0.28, 0.276)
  const led = put(g, new THREE.SphereGeometry(0.0155, 12, 8), ledMat, 0.07, 0.29, 0.277)
  put(g, new THREE.TorusGeometry(0.019, 0.004, 6, 14), mBright, 0.07, 0.29, 0.273)
  // 铭牌
  const plateMat = new THREE.MeshStandardMaterial({ map: namePlate('气泵机组 YX-80', '18.4 A · 68.5 kPa · 61.2 m³/h'), roughness: 0.5, metalness: 0.25 })
  put(g, new THREE.BoxGeometry(0.22, 0.068, 0.005), plateMat, -0.09, 0.10, 0.373)

  // ---- 出口波纹软管（CatmullRomCurve3 + TubeGeometry + 环向波纹 + 卡箍）→ 槽体左下
  // 终点对准浮选槽左下的进气口（其法兰端面约 x=-1.19, y=0.78, z=-0.24）
  const hosePts = [
    [0.16, 0.998, 0.00], [0.235, 1.075, 0.00], [0.39, 1.115, 0.01],
    [0.545, 1.055, 0.02], [0.66, 0.945, 0.04], [0.745, 0.855, 0.06], [0.828, 0.784, 0.11],
  ]
  const hoseGeo = GEO.pipe(hosePts, 0.05, { seg: 44, radial: 14 })
  const hose = new THREE.Mesh(hoseGeo, mRubber)
  hose.castShadow = true
  g.add(hose)
  const curve = hoseGeo.userData.curve
  const ribGeo = new THREE.TorusGeometry(0.058, 0.0075, 6, 16)
  const tmpQ = new THREE.Quaternion()
  const tmpT = new THREE.Vector3()
  const tmpP = new THREE.Vector3()
  for (let i = 1; i < 26; i++) {
    const t = i / 26
    curve.getPointAt(t, tmpP)
    curve.getTangentAt(t, tmpT).normalize()
    const rib = new THREE.Mesh(ribGeo, mRubber)
    rib.position.copy(tmpP)
    rib.quaternion.copy(tmpQ.setFromUnitVectors(Z_AXIS, tmpT))
    g.add(rib)
  }
  // ---- 气流指示：软管外的流动光环（仅运行/启动时可见）
  const airMat = new THREE.MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
  const airRings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.068, 0.005, 5, 18), airMat, 8)
  airRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  airRings.frustumCulled = false
  airRings.visible = false
  airRings.renderOrder = 6
  g.add(airRings)
  const airDummy = new THREE.Object3D()
  // 两端接头卡箍
  for (const t of [0.012, 0.988]) {
    curve.getPointAt(t, tmpP)
    curve.getTangentAt(t, tmpT).normalize()
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.0095, 6, 18), mBright)
    band.position.copy(tmpP)
    band.quaternion.copy(tmpQ.setFromUnitVectors(Z_AXIS, tmpT))
    g.add(band)
    const screw = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.03, 0.016), mDark)
    screw.position.copy(tmpP)
    screw.position.z += 0.058
    g.add(screw)
  }
  // 槽体侧接头卡箍（槽体自带法兰，这里只做软管端卡箍）
  const endBand = put(g, new THREE.TorusGeometry(0.056, 0.0095, 6, 18), mBright, 0.836, 0.783, 0.112)
  endBand.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(Z_AXIS, new THREE.Vector3(1, -0.42, 0.24).normalize()))
  put(g, new THREE.BoxGeometry(0.02, 0.026, 0.02), mDark, 0.842, 0.845, 0.10)

  world.addPart('pump', g, { label: '气泵', htmlLabel: '气泵 · 18.4 A', anchor: [-2.02, 1.30, -0.35] })
  world.root.add(g)

  // ---- 动画：整体高频微振 + 联轴器旋转 + 表针 + 指示灯
  const baseY = g.position.y
  world.onFrame((dt, s) => {
    const A = sim.anim
    const on = A.pump
    const t = sim.t
    g.position.y = baseY + Math.sin(t * 118) * 0.002 * on
    rotor.rotation.x = A.pumpShaft
    const p = clamp((s || sim).data.pump.pressure / 100, 0, 1)
    needle.rotation.z = lerp(-1.1, 1.15, p) + Math.sin(t * 7.3) * 0.006 * on
    ledMat.color.copy(ledOff).lerp(ledOn, on * on)
    // 气流依次沿软管滑动
    const airOn = on > 0.06
    airRings.visible = airOn
    if (airOn) {
      for (let i = 0; i < 8; i++) {
        const at = (t * (0.16 + 0.20 * on) + i / 8) % 1
        curve.getPointAt(at, tmpP)
        curve.getTangentAt(at, tmpT).normalize()
        airDummy.position.copy(tmpP)
        airDummy.quaternion.setFromUnitVectors(Z_AXIS, tmpT)
        airDummy.scale.setScalar(0.85 + 0.3 * Math.sin(t * 6 + i))
        airDummy.updateMatrix()
        airRings.setMatrixAt(i, airDummy.matrix)
      }
      airRings.instanceMatrix.needsUpdate = true
      airMat.opacity = 0.25 + 0.55 * on
    }
  })
}

// ================================================================ scraper
function buildScraper(world, sim) {
  const g = new THREE.Group()
  g.position.set(0, 2.47, 0.30)

  const mFrame = MAT.steelDark({ color: [0.052, 0.057, 0.062], roughness: 0.55, metalness: 0.55 })
  const mCast = MAT.castIron({ color: [0.085, 0.09, 0.097], roughness: 0.48, metalness: 0.66 })
  const mShaft = MAT.stainless({ color: [0.33, 0.34, 0.35], roughness: 0.28 })
  const mBright = MAT.steel({ color: [0.40, 0.41, 0.42], roughness: 0.24 })
  const mBlade = MAT.stainless({ color: [0.24, 0.25, 0.26], roughness: 0.38, metalness: 0.8 })
  const mDrive = MAT.paint({ color: [0.036, 0.062, 0.076], roughness: 0.42 })
  const mChute = MAT.steelDark({ color: [0.062, 0.067, 0.072], roughness: 0.5, metalness: 0.55 })
  const mDrum = MAT.steelDark({ color: [0.066, 0.07, 0.074], roughness: 0.48, metalness: 0.55 })
  const mPipe = MAT.stainless({ color: [0.24, 0.25, 0.26], roughness: 0.3 })
  const mWarn = MAT.paint({ color: [0.30, 0.16, 0.02], roughness: 0.42 })

  // ---- 轴 + 两端轴承座
  const shaft = put(g, new THREE.CylinderGeometry(0.035, 0.035, 2.26, 24), mShaft, 0, 0, 0, true)
  shaft.rotation.z = Math.PI / 2
  const basePlateGeo = GEO.rbox(0.24, 0.024, 0.17, 0.006)
  const housingGeo = GEO.rbox(0.11, 0.095, 0.13, 0.012)
  const capGeo = GEO.tube(0.052, 0.032, 0.022, 24)
  const padGeo = new THREE.BoxGeometry(0.02, 0.16, 0.12)
  const bolts = boltSet(mBright)
  for (const sx of [-1.12, 1.12]) {
    const bp = put(g, basePlateGeo, mCast, sx, -0.057, 0, true)
    bp.receiveShadow = true
    put(g, housingGeo, mCast, sx, 0.004, 0, true)
    const cap = put(g, capGeo, mCast, sx + Math.sign(sx) * 0.062, 0, 0, true)
    cap.rotation.z = Math.PI / 2
    for (const dx of [-0.085, 0.085]) for (const dz of [-0.055, 0.055]) boltAt(g, bolts, sx + dx, -0.038, dz)
    put(g, new THREE.CylinderGeometry(0.009, 0.009, 0.03, 8), mBright, sx, 0.032, 0.075).rotation.x = Math.PI / 2
    // 轴承座外侧斜撑，落在槽体侧壁（避免悬臂）
    strut(g, [Math.sign(sx) * 1.20, -0.055, 0], [Math.sign(sx) * 1.012, -0.37, 0], 0.05, 0.03, mFrame, true)
    put(g, padGeo, mFrame, Math.sign(sx) * 1.012, -0.37, 0, true)
  }

  // ---- 驱动：减速箱 + 电机 + 由槽壁引出的安装支架（不落地、不悬空）
  put(g, new THREE.BoxGeometry(0.022, 0.30, 0.30), mFrame, 1.012, -0.31, 0, true)   // 槽壁安装板
  for (const sz of [-0.09, 0.09]) strut(g, [1.03, -0.39, sz], [1.40, -0.16, sz], 0.05, 0.028, mFrame, true)
  put(g, new THREE.BoxGeometry(0.44, 0.022, 0.28), mFrame, 1.36, -0.141, 0, true)   // 减速箱安装板
  const gear = put(g, GEO.rbox(0.22, 0.26, 0.24, 0.014), mDrive, 1.29, -0.005, 0, true)
  gear.receiveShadow = true
  for (let i = 0; i < 5; i++) put(g, new THREE.BoxGeometry(0.18, 0.03, 0.018), mCast, 1.29, 0.10, -0.09 + i * 0.045)
  put(g, new THREE.CylinderGeometry(0.026, 0.026, 0.03, 12), mBright, 1.29, 0.14, 0.06)  // 注油塞
  put(g, new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), mBright, 1.29, -0.10, 0.122).rotation.x = Math.PI / 2 // 油位窗
  put(g, GEO.disc(0.09, 0.02, 0.006, 24), mCast, 1.405, -0.005, 0, true).rotation.z = -Math.PI / 2
  // 电机
  const motor = put(g, GEO.lathe([[0, -0.13], [0.088, -0.13], [0.10, -0.115], [0.10, 0.115], [0.088, 0.13], [0, 0.13]], 32), mDrive, 1.53, -0.005, 0, true)
  motor.rotation.z = -Math.PI / 2
  const finGeo = new THREE.TorusGeometry(0.103, 0.0045, 6, 18)
  for (let i = 0; i < 8; i++) put(g, finGeo, mDrive, 1.425 + i * 0.03, -0.005, 0, true).rotation.y = Math.PI / 2
  put(g, GEO.tube(0.10, 0.085, 0.05, 20), mDrive, 1.685, -0.005, 0, true).rotation.z = Math.PI / 2
  for (let i = 0; i < 3; i++) put(g, new THREE.BoxGeometry(0.006, 0.18, 0.01), mCast, 1.713, -0.005, 0).rotation.x = (i / 3) * Math.PI
  put(g, GEO.rbox(0.10, 0.06, 0.08, 0.008), mDrive, 1.53, 0.132, 0, true)
  put(g, new THREE.CylinderGeometry(0.013, 0.013, 0.024, 10), mBright, 1.53, 0.168, 0)
  put(g, new THREE.BoxGeometry(0.10, 0.03, 0.10), mCast, 1.53, -0.125, 0, true)
  // 减速箱铭牌
  const gPlateMat = new THREE.MeshStandardMaterial({ map: namePlate('刮板驱动', '17.6 rpm · 3.42 A'), roughness: 0.5, metalness: 0.25 })
  put(g, new THREE.BoxGeometry(0.155, 0.048, 0.004), gPlateMat, 1.29, 0.05, 0.122)

  // ---- 转子：轮毂 + 5 片薄叶片（带折边）
  const rotor = new THREE.Group()
  const hubGeo = GEO.disc(0.09, 0.05, 0.008, 24)
  for (const hx of [-0.80, 0, 0.80]) put(rotor, hubGeo, mShaft, hx, 0, 0, true).rotation.z = Math.PI / 2
  const plateGeo = new THREE.BoxGeometry(1.84, 0.145, 0.007)
  const lipGeo = new THREE.BoxGeometry(1.84, 0.03, 0.006)
  const armGeo = new THREE.BoxGeometry(0.045, 0.115, 0.032)
  const blade = new THREE.Group()
  put(blade, plateGeo, mBlade, 0, -0.158, 0, true)
  const lip = put(blade, lipGeo, mBlade, 0, -0.2305, -0.011, true)
  lip.rotation.x = 0.62
  for (const ax of [-0.80, 0, 0.80]) {
    put(blade, armGeo, mShaft, ax, -0.105, 0.012, true)
    put(blade, new THREE.BoxGeometry(0.05, 0.045, 0.05), mShaft, ax, -0.058, 0.014)
  }
  for (let i = 0; i < 5; i++) {
    const b = blade.clone()
    b.rotation.x = (i / 5) * Math.PI * 2
    rotor.add(b)
  }
  // 联轴器（在减速箱输出与轴之间，随转子转）
  const coup = put(rotor, GEO.tube(0.048, 0.032, 0.10, 20), mBright, 1.15, 0, 0, true)
  coup.rotation.z = Math.PI / 2
  g.add(rotor)

  // ---- 接矿溜槽（前缘对齐 z≈0.9；低于槽体溢流唇口，泡沫翻过唇口落入槽内）
  const chute = new THREE.Group()
  chute.position.set(0, -0.28, 0.76)
  chute.rotation.z = -0.038                            // 向 +X 端倾斜，尾端下料
  put(chute, new THREE.BoxGeometry(2.06, 0.012, 0.24), mChute, 0, 0, 0, true)
  put(chute, new THREE.BoxGeometry(2.06, 0.05, 0.01), mChute, 0, 0.031, -0.12, true)   // 靠槽侧矮壁，溢流可越入
  put(chute, new THREE.BoxGeometry(2.06, 0.17, 0.01), mChute, 0, 0.091, 0.12, true)    // 外侧高壁
  for (const ex of [-1.03, 1.03]) put(chute, new THREE.BoxGeometry(0.014, 0.11, 0.24), mChute, ex, 0.061, 0, true)
  for (const rx of [-0.8, -0.3, 0.3, 0.8]) put(chute, new THREE.BoxGeometry(0.05, 0.035, 0.21), mChute, rx, -0.021, 0)
  // 外侧壁上的警示色条（工业安全色，作为深色环境里的对比）
  put(chute, new THREE.BoxGeometry(0.42, 0.05, 0.006), mWarn, -0.55, 0.135, 0.126, true)
  put(chute, new THREE.BoxGeometry(0.42, 0.05, 0.006), mWarn, 0.55, 0.135, 0.126, true)
  g.add(chute)
  // 槽壁支架（3 组）：水平托臂 + 斜撑 + 壁板
  for (const bx of [-0.72, 0, 0.72]) {
    const cy = -0.28 - bx * Math.sin(0.038)         // 该处溜槽底面高度（组内坐标）
    put(g, new THREE.BoxGeometry(0.075, 0.25, 0.014), mFrame, bx, cy - 0.125, 0.568, true)
    strut(g, [bx, cy - 0.012, 0.575], [bx, cy - 0.012, 0.80], 0.055, 0.022, mFrame, true)
    strut(g, [bx, cy - 0.20, 0.575], [bx, cy - 0.022, 0.782], 0.04, 0.018, mFrame, true)
  }

  // ---- 溜槽出口：集料斗 + 下料管 + 精矿桶（坐在检修平台格栅上 y=0.52）
  put(g, GEO.rbox(0.24, 0.18, 0.24, 0.01), mChute, 0.93, -0.41, 0.76, true)
  put(g, new THREE.BoxGeometry(0.12, 0.07, 0.12), mChute, 0.93, -0.315, 0.76)
  const pipePts = [
    [0.93, -0.50, 0.76], [1.00, -0.67, 0.77], [1.03, -1.02, 0.78], [1.04, -1.27, 0.79],
    [1.09, -1.37, 0.80], [1.18, -1.42, 0.80], [1.26, -1.43, 0.80], [1.28, -1.45, 0.80],
  ]
  const down = new THREE.Mesh(GEO.pipe(pipePts, 0.048, { seg: 44, radial: 12 }), mPipe)
  down.castShadow = true
  g.add(down)
  // 管卡（2 处，固定在槽体前壁）
  for (const py of [-0.72, -1.19]) {
    strut(g, [0.94, py, 0.57], [1.03, py, 0.775], 0.045, 0.018, mFrame, true)
    put(g, new THREE.BoxGeometry(0.06, 0.07, 0.012), mFrame, 0.94, py, 0.562, true)
    const clamp = put(g, new THREE.TorusGeometry(0.054, 0.008, 6, 16), mBright, 1.035, py, 0.785)
    clamp.rotation.x = Math.PI / 2
  }
  // 精矿桶（落座在检修平台上）
  const drum = new THREE.Group()
  drum.position.set(1.28, -1.95, 0.80)
  put(drum, new THREE.TorusGeometry(0.15, 0.012, 6, 24), mFrame, 0, 0.012, 0).rotation.x = Math.PI / 2
  for (const lx of [-0.11, 0.11]) for (const lz of [-0.11, 0.11]) {
    put(drum, new THREE.BoxGeometry(0.032, 0.05, 0.032), mFrame, lx, 0.03, lz, true)
  }
  put(drum, GEO.lathe([[0, 0], [0.168, 0], [0.172, 0.02], [0.172, 0.46], [0.164, 0.48], [0, 0.48]], 28), mDrum, 0, 0.04, 0, true)
  put(drum, GEO.disc(0.172, 0.04, 0.006, 28), mDrum, 0, 0.52, 0, true)
  for (const hy of [0.22, 0.42]) put(drum, new THREE.TorusGeometry(0.174, 0.006, 6, 24), mDrum, 0, hy, 0).rotation.x = Math.PI / 2
  put(drum, new THREE.TorusGeometry(0.052, 0.008, 6, 16), mBright, 0, 0.542, 0).rotation.x = Math.PI / 2
  // 排料阀
  const drain = put(drum, new THREE.CylinderGeometry(0.02, 0.02, 0.10, 12), mPipe, 0.20, 0.12, 0)
  drain.rotation.z = Math.PI / 2
  const dwheel = put(drum, new THREE.TorusGeometry(0.045, 0.008, 6, 18), mBright, 0.25, 0.12, 0)
  dwheel.rotation.y = Math.PI / 2
  g.add(drum)

  world.addPart('scraper', g, { label: '刮板机构', htmlLabel: '刮板机构 · 17.6 rpm', anchor: [0.55, 2.92, 0.30] })
  world.root.add(g)

  // ---- 动画：叶片按 sim.anim.scraperAngle 匀速旋转；点击脉冲只临时加速，不改运行状态
  let extra = 0
  world.onFrame((dt) => {
    const A = sim.anim
    const pulse = sim.pulseOf('scraper')
    const boost = A.scraperSpeed > 0.03 ? pulse * pulse * 5.2 : 0
    extra += dt * boost
    rotor.rotation.x = A.scraperAngle + extra
  })
}
