// Process state machine + sensor solver for the visual flotation HMI.
// All displayed numbers are produced here; 3D parts and the HTML panels read `sim`.
import { clamp, lerp, approach } from './kit/lab-kit.js'

export const PROCESS = {
  IDLE: 'IDLE', FEEDING: 'FEEDING', FED: 'FED', DOSING: 'DOSING', DOSED: 'DOSED', FLOTATING: 'FLOTATING',
}

const AGENTS = ['丁基黄药 + 松醇油', '异戊基黄药 + 二号油', '乙基黄药 + 松醇油']
const BATCH = () => `SN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-A${String(7 + (Date.now() % 9)).padStart(2, '0')}`

const noise = (t, seed, amp = 1, speed = 1) => Math.sin(t * speed + seed) * amp + Math.sin(t * speed * 2.37 + seed * 1.7) * amp * 0.42

function clock() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}
function hms(sec) {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function createSim() {
  const sim = {
    t: 0,
    process: PROCESS.IDLE,
    lock: false,
    runtime: 0,
    clock: '--:--:--',
    hint: '请点击「投入锡矿石」开始演示',
    record: null,
    lightLevel: 68,
    history: [],
    histAcc: 0,

    anim: {
      ore: 0, oreOn: false, oreDone: false,
      splash: 0,
      dose: 0, doseOn: false,
      foam: 0, foamAmp: 0.02, liquidTint: 0,
      pump: 0, pumpShaft: 0,
      scraperSpeed: 0, scraperAngle: 0,
      telescopePhase: 0, telescopeStroke: 0,
      cameraBlink: 0, cameraRate: 1.2,
      valve: 0,
      bubble: 0,
      pulse: {},
    },

    data: {
      cell: { level: 1620, temp: 28.4, air: 0.0, pressure: 0.8, ph: 8.62 },
      foam: { thickness: 0, small: 0, mid: 0, large: 0, flow: 0, color: [214, 203, 182], stability: 0 },
      camera: {
        model: 'Basler acA1920-40gc', resolution: '1920 × 1200', fps: 0, exposure: '1/500 s', temp: 41.2, focal: 16,
        bubbles: 0, sizeMean: 0, stability: 0, confidence: 0, status: '待机',
      },
      light: { type: 'LED 环形光源', cct: 5600, brightness: 68, power: 34, hours: 1260, uniformity: 0, flare: '—', recMin: 55, recMax: 80 },
      scraper: { rpm: 0, period: 3.6, angle: 0, current: 0, bearingTemp: 32.1, mass: 0, rate: 0, wear: 18, maint: 312, status: '待机' },
      pump: { pressure: 0, flow: 0, current: 0, temp: 32.4, hours: 1846, vibration: 0, status: '待机' },
      telescope: { stroke: 0, speed: 0, pressure: 0, limit: '中间', cycles: 0, immersion: 0, flow: 0, density: 1.42, solid: 34, nextCycle: 0, status: '待机' },
      pipe: { diameter: 50, material: '316L 不锈钢', immersion: 0, velocity: 0, clog: '正常', density: 1.42, solid: 34, rep: 92, status: '待机' },
      concentrate: { level: 0, volume: 0, mass: 0, grade: 0, recovery: 0, density: 1.38, temp: 27.8, froth: 0, inflow: 0, status: '待机' },
      vfd: { setHz: 37.5, outHz: 0, current: 0, dcBus: 538, heat: 35.2, status: '待机', load: 0, energy: 12.4, thd: '3.1 %', faults: [{ code: 'F-021', text: '等待启动命令' }], drive: '刮板电机' },
      plc: {
        cpu: 31, scan: 8.2, io: 42, comm: '正常', rackTemp: 33.4, mode: '自动', interlock: '正常', version: 'V2.4.1',
        alarms: [{ time: '—', code: '—', text: '暂无报警记录' }],
      },
      valve: { opening: 0, medium: '丁基黄药', flow: 0, impact: '阀门关闭，药剂未进入浮选槽。' },
      ore: { batch: '—', mass: 0, grade: 0, time: '—' },
      dose: { agent: '—', dosage: 0, time: '—', stir: 0 },
      top: { currents: [0.6, 0.5, 0.6], status: '待机', runtime: '00:00:00' },
    },
  }

  const totalStages = 4
  sim.stageIndex = 0

  function setHint(h) { sim.hint = h }

  function feed() {
    if (sim.process !== PROCESS.IDLE) return false
    sim.process = PROCESS.FEEDING
    sim.lock = true
    sim.anim.oreOn = true
    sim.anim.ore = 0
    sim.anim.oreDone = false
    sim.record = { type: 'feed', at: clock() }
    sim.data.ore = { batch: BATCH(), mass: 25.0, grade: 1.82, time: clock() }
    setHint('锡矿石正在落入浮选槽…')
    return true
  }
  function dose() {
    if (sim.process !== PROCESS.FED) return false
    sim.process = PROCESS.DOSING
    sim.lock = true
    sim.anim.doseOn = true
    sim.anim.dose = 0
    sim.record = { type: 'dose', at: clock() }
    sim.data.dose = { agent: AGENTS[Date.now() % AGENTS.length], dosage: 86, time: clock(), stir: 1200 }
    setHint('药剂注入中，搅拌持续运行…')
    return true
  }
  function flotate() {
    if (sim.process !== PROCESS.DOSED) return false
    sim.process = PROCESS.FLOTATING
    sim.lock = false
    sim.runtime = 0
    sim.history = new Array(60).fill(0)
    setHint('浮选运行中，可点击部件查看实时数据')
    return true
  }
  function reset() {
    sim.process = PROCESS.IDLE
    sim.lock = false
    sim.runtime = 0
    sim.record = null
    sim.history = []
    sim.anim.oreOn = false
    sim.anim.doseOn = false
    sim.anim.splash = 0
    sim.anim.ore = 0
    sim.anim.dose = 0
    sim.data.ore = { batch: '—', mass: 0, grade: 0, time: '—' }
    sim.data.dose = { agent: '—', dosage: 0, time: '—', stir: 0 }
    setHint('流程已复位，请点击「投入锡矿石」开始演示')
    return true
  }

  sim.feed = feed
  sim.dose = dose
  sim.flotate = flotate
  sim.reset = reset
  sim.pulse = (id) => sim.anim.pulse[id] = 1
  sim.pulseOf = (id) => sim.anim.pulse[id] || 0
  sim.setLight = (v) => { sim.lightLevel = clamp(v, 0, 100) }

  sim.update = (dt) => {
    dt = Math.min(dt, 0.1)
    sim.t += dt
    sim.clock = clock()

    // ---- state machine timers -------------------------------------------------
    if (sim.process === PROCESS.FEEDING) {
      sim.anim.ore = Math.min(1, (sim.anim.ore + dt / 1.5))
      if (sim.anim.ore > 0.72 && !sim.anim.oreDone) { sim.anim.oreDone = true; sim.anim.splash = 1 }
      if (sim.anim.ore >= 1) {
        sim.process = PROCESS.FED
        sim.lock = false
        sim.anim.oreOn = false
        setHint('投料完成，请点击「加药」')
      }
    } else if (sim.process === PROCESS.DOSING) {
      sim.anim.dose = Math.min(1, sim.anim.dose + dt / 2.0)
      if (sim.anim.dose >= 1) {
        sim.process = PROCESS.DOSED
        sim.lock = false
        sim.anim.doseOn = false
        setHint('加药完成，请点击「启动浮选」')
      }
    } else if (sim.process === PROCESS.FLOTATING) {
      sim.runtime += dt
    }
    sim.anim.splash = Math.max(0, sim.anim.splash - dt / 0.9)

    const run = sim.process === PROCESS.FLOTATING
    const A = sim.anim

    // ---- mechanical state (first order lags) ---------------------------------
    A.foam = approach(A.foam, run ? 1 : 0, run ? 0.55 : 0.32, dt)
    A.foamAmp = lerp(0.012, 0.04, A.foam)
    A.pump = approach(A.pump, run ? 1 : 0, run ? 0.3 : 0.18, dt)
    A.pumpShaft += dt * A.pump * 26
    A.scraperSpeed = approach(A.scraperSpeed, run ? (Math.PI * 2) / 3.6 : 0, 0.5, dt)
    A.scraperAngle += A.scraperSpeed * dt
    A.telescopePhase = run ? (A.telescopePhase + dt / 5.6) % 1 : approach(A.telescopePhase, 0, 0.6, dt)
    const teleT = run ? 0.5 - 0.5 * Math.cos(A.telescopePhase * Math.PI * 2) : 0.04
    A.telescopeStroke = approach(A.telescopeStroke, teleT, 0.12, dt)
    A.valve = approach(A.valve, sim.process === PROCESS.DOSING ? 1 : 0, 0.25, dt)
    A.liquidTint = approach(A.liquidTint, (sim.process === PROCESS.DOSED || run) ? 1 : 0, 1.2, dt)
    A.cameraRate = run ? 7.5 : 1.2
    A.cameraBlink += dt * A.cameraRate
    A.bubble = approach(A.bubble, run ? 1 : 0, 0.5, dt)
    for (const k in A.pulse) A.pulse[k] = Math.max(0, A.pulse[k] - dt / 1.4)

    const t = sim.t
    const pumpOn = A.pump
    const scrapeOn = A.scraperSpeed
    const D = sim.data

    // ---- cell / foam ---------------------------------------------------------
    D.cell.level = 1620 + noise(t, 1.2, 2.2, 0.7)
    D.cell.temp = 28.4 + noise(t, 2.1, 0.16, 0.33)
    D.cell.air = A.pump * (62.4 + noise(t, 3.3, 1.1, 0.9)) + 0.0
    D.cell.pressure = 0.8 + A.pump * (11.6 + noise(t, 4.4, 0.35, 1.1))
    D.cell.ph = 8.62 - A.liquidTint * 0.16 + noise(t, 5.5, 0.02, 0.4)

    const foamTh = A.foam * (41 + noise(t, 6.6, 1.6, 0.55))
    D.foam.thickness = foamTh
    D.foam.small = A.foam * (46 + noise(t, 7.1, 2.4, 0.4))
    D.foam.mid = A.foam * (37 + noise(t, 7.7, 2.0, 0.35))
    D.foam.large = A.foam * (17 - noise(t, 8.2, 1.4, 0.3))
    D.foam.flow = A.foam * (0.92 + noise(t, 8.8, 0.06, 0.7))
    D.foam.stability = A.foam * (86 + noise(t, 9.4, 3.5, 0.5))
    D.foam.color = [Math.round(212 + A.liquidTint * 6 + noise(t, 9.9, 3, 1)), Math.round(201 - A.liquidTint * 4 + noise(t, 10.3, 2, 1)), Math.round(180 + A.liquidTint * 2 + noise(t, 10.8, 2, 1))]

    // ---- vision camera -------------------------------------------------------
    const camFps = run ? 29.5 + noise(t, 11.1, 1.3, 1.7) : 0
    D.camera.fps = camFps
    D.camera.bubbles = run ? Math.round(212 + noise(t, 11.9, 16, 0.9)) : 0
    D.camera.sizeMean = run ? 1.62 + noise(t, 12.5, 0.08, 0.5) : 0
    D.camera.stability = run ? 86 + noise(t, 13.1, 3.2, 0.4) : 0
    D.camera.confidence = run ? 0.958 + noise(t, 13.7, 0.012, 0.6) : 0
    D.camera.status = run ? '采集中' : '待机'
    sim.histAcc += dt
    if (sim.histAcc > 0.5) {
      sim.histAcc = 0
      if (run) { sim.history.push(D.camera.fps); if (sim.history.length > 60) sim.history.shift() }
    }
    if (!run && sim.history.length) sim.history = []

    // ---- light ---------------------------------------------------------------
    D.light.brightness = sim.lightLevel
    D.light.power = 14 + sim.lightLevel * 0.3
    D.light.uniformity = 92 - Math.abs(sim.lightLevel - 68) * 0.35 + noise(t, 14.3, 0.6, 0.4)
    D.light.flare = sim.lightLevel > 82 ? '偏高' : sim.lightLevel < 45 ? '偏低' : '低'

    // ---- scraper -------------------------------------------------------------
    D.scraper.rpm = scrapeOn / (Math.PI * 2) * 60
    D.scraper.period = scrapeOn > 0.01 ? (Math.PI * 2) / scrapeOn : 3.6
    D.scraper.angle = (A.scraperAngle * 180 / Math.PI) % 360
    D.scraper.current = scrapeOn > 0.01 ? 3.42 + noise(t, 15.1, 0.12, 1.3) : 0
    D.scraper.bearingTemp = 32.1 + A.foam * (13.4 + noise(t, 15.7, 0.5, 0.2))
    D.scraper.mass = A.foam * (2.4 + noise(t, 16.3, 0.2, 0.3))
    D.scraper.rate = A.foam * (14.2 + noise(t, 16.9, 0.9, 0.4))
    D.scraper.status = scrapeOn > 0.01 ? '运行' : '待机'

    // ---- air pump ------------------------------------------------------------
    D.pump.pressure = pumpOn * (68.5 + noise(t, 17.1, 1.4, 1.1)) + noise(t, 17.3, 0.15, 6)
    D.pump.flow = pumpOn * (61.2 + noise(t, 17.9, 1.8, 0.8))
    D.pump.current = pumpOn * (18.4 + noise(t, 18.3, 0.35, 1.2))
    D.pump.temp = 32.4 + pumpOn * (30.1 + noise(t, 18.9, 0.6, 0.12))
    D.pump.vibration = pumpOn * (2.28 + noise(t, 19.3, 0.12, 2.2))
    D.pump.hours = 1846 + sim.runtime / 3600
    D.pump.status = pumpOn > 0.02 ? '运行' : '待机'

    // ---- telescopic + suction ------------------------------------------------
    const strokeMM = A.telescopeStroke * 700
    D.telescope.stroke = strokeMM
    D.telescope.speed = run ? Math.abs(Math.sin(A.telescopePhase * Math.PI * 2)) * 125 : 0
    D.telescope.pressure = run ? 58 + A.telescopeStroke * 9 : 0
    D.telescope.limit = !run ? '中间' : A.telescopeStroke > 0.82 ? '上限位' : A.telescopeStroke < 0.18 ? '下限位' : '中间'
    D.telescope.cycles = 1204 + Math.floor(sim.runtime / 5.6)
    D.telescope.immersion = 195 + A.telescopeStroke * 60
    D.telescope.flow = pumpOn * (18.4 + noise(t, 19.9, 0.4, 0.6))
    D.telescope.density = 1.42 + A.liquidTint * 0.01 + noise(t, 20.3, 0.004, 0.4)
    D.telescope.solid = 34 + A.liquidTint * 1.2 + noise(t, 20.9, 0.4, 0.3)
    D.telescope.nextCycle = run ? (1 - A.telescopePhase) * 5.6 : 0
    D.telescope.status = run ? '运行' : '待机'

    D.pipe.immersion = D.telescope.immersion
    D.pipe.velocity = pumpOn * (1.82 + noise(t, 21.1, 0.05, 0.7))
    D.pipe.density = D.telescope.density
    D.pipe.solid = D.telescope.solid
    D.pipe.clog = '正常'
    D.pipe.status = run ? '运行' : '待机'

    // ---- concentrate tank (前方精矿槽) ---------------------------------------
    const Dc = D.concentrate
    Dc.inflow = A.foam * (14.2 + noise(t, 29.1, 0.8, 0.4))
    Dc.level = 40 + A.foam * (320 + noise(t, 29.3, 6, 0.35))
    Dc.volume = Dc.level / 1000 * 0.637
    Dc.density = 1.38 + A.liquidTint * 0.04 + noise(t, 29.5, 0.004, 0.4)
    Dc.mass = Dc.volume * Dc.density * 1000
    Dc.grade = A.foam * (18.6 + noise(t, 29.7, 0.35, 0.3))
    Dc.recovery = A.foam * (86.4 + noise(t, 30.0, 1.8, 0.25))
    Dc.temp = 27.8 + noise(t, 30.3, 0.15, 0.33)
    Dc.froth = A.foam * (36 + noise(t, 30.6, 3, 0.4))
    Dc.status = run ? '接收中' : '待机'

    // ---- VFD -----------------------------------------------------------------
    D.vfd.outHz = run ? 37.2 + noise(t, 22.1, 0.15, 0.8) : 0
    D.vfd.current = run ? 14.6 + noise(t, 22.7, 0.25, 1.1) : 0
    D.vfd.heat = 35.2 + A.foam * (12.8 + noise(t, 23.1, 0.4, 0.15))
    D.vfd.load = run ? 72 + noise(t, 23.7, 1.6, 0.5) : 0
    D.vfd.energy = 12.4 + sim.runtime * 0.0073
    D.vfd.status = run ? '运行' : '待机'
    D.vfd.faults = run ? [] : [{ code: 'F-021', text: '等待启动命令' }]

    // ---- PLC -----------------------------------------------------------------
    D.plc.cpu = 31 + A.foam * 9 + noise(t, 24.1, 1.7, 0.4)
    D.plc.scan = 8.2 + A.foam * 0.9 + noise(t, 24.7, 0.15, 0.8)
    D.plc.io = 42 + A.foam * 6 + noise(t, 25.1, 1.2, 0.3)
    D.plc.rackTemp = 33.4 + A.foam * 2.6 + noise(t, 25.7, 0.2, 0.2)
    D.plc.mode = run ? '自动' : '自动'
    D.plc.interlock = '正常'
    if (run) {
      D.plc.alarms = [
        { time: clock(), code: 'I-102', text: '气泵启动，供气压力建立' },
        { time: '—', code: 'I-087', text: '泡沫层厚度进入目标区间' },
        { time: '—', code: '—', text: '无故障报警' },
      ]
    } else {
      D.plc.alarms = [{ time: '—', code: '—', text: '暂无报警记录' }]
    }

    // ---- dosing valve --------------------------------------------------------
    D.valve.opening = A.valve * 65
    D.valve.medium = sim.data.dose.agent === '—' ? '丁基黄药' : sim.data.dose.agent.split(' + ')[0]
    D.valve.flow = A.valve * (1.42 + noise(t, 26.3, 0.04, 1))
    D.valve.impact = A.valve > 0.05 ? '药剂进入矿浆，锡矿物表面开始疏水化。' : run ? '加药完成，阀门已关闭，矿浆持续搅拌。' : '阀门关闭，药剂未进入浮选槽。'

    // ---- top status ----------------------------------------------------------
    D.top.runtime = hms(sim.runtime)
    const stat = sim.process === PROCESS.IDLE ? '待机' : sim.process === PROCESS.FLOTATING ? '运行'
      : (sim.process === PROCESS.FEEDING || sim.process === PROCESS.FED) ? '投料' : '加药'
    D.top.status = stat
    const base = run ? 18.4 : 0.6
    D.top.currents = [
      base + noise(t, 27.1, run ? 0.9 : 0.04, 1.3),
      base - 0.2 + noise(t, 27.7, run ? 0.8 : 0.04, 1.17),
      base + 0.3 + noise(t, 28.3, run ? 0.85 : 0.04, 1.41),
    ]

    sim.stageIndex = sim.process === PROCESS.IDLE ? 0 : sim.process === PROCESS.FEEDING || sim.process === PROCESS.FED ? 1
      : sim.process === PROCESS.DOSING || sim.process === PROCESS.DOSED ? 2 : 3
  }

  return sim
}
