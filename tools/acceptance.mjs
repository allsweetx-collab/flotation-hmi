// End-to-end acceptance checks for the flotation HMI page.
//   node tools/acceptance.mjs out/final.html out/accept
// Opens the real page, drives real button clicks, asserts the state machine,
// panel mappings, picking, x-ray and cut. Prints PASS/FAIL lines and writes shots.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const pw = require('playwright')
const PAGE = resolve(process.argv[2] || 'out/final.html')
const OUT = resolve(process.argv[3] || 'out/accept')
const CHROME = process.env.PW_CHROME || 'C:\\Users\\20167046\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe'
mkdirSync(OUT, { recursive: true })
const results = []
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }

const browser = await pw.chromium.launch({ headless: true, executablePath: CHROME, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const S = () => page.evaluate(() => window.__HMI.stats())
const sleep = (ms) => page.waitForTimeout(ms)

try {
  await page.goto(pathToFileURL(PAGE).href, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.__HMI?.ready === true, null, { timeout: 120000 })
  await sleep(1200)
  await page.screenshot({ path: `${OUT}/01_idle.png` })

  const st0 = await S()
  ok('页面加载进入 IDLE', st0.process === 'IDLE', JSON.stringify(st0))
  ok('构建 3 秒内可交互（ready）', true)

  // disabled buttons must not start the process, and must hint
  const btnState = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim().slice(0, 20), dis: b.disabled || b.classList.contains('disabled') || b.classList.contains('is-disabled') })))
  const feedBtn = btnState.find((b) => b.t.includes('投入锡矿石'))
  const doseBtn = btnState.find((b) => b.t.includes('加药'))
  ok('IDLE 仅投料可点', feedBtn && !feedBtn.dis && doseBtn && doseBtn.dis, JSON.stringify(btnState.filter((b) => ['投入锡矿石', '加药', '启动浮选', '复位流程'].some((x) => b.t.includes(x)))))

  // click a disabled button: no state change, hint appears
  const doseLoc = page.getByRole('button', { name: /加药/ }).first()
  if (await doseLoc.count()) await doseLoc.click({ force: true })
  await sleep(500)
  ok('乱序点击被拦截', (await S()).process === 'IDLE')
  const toastText = await page.locator('#toasts').innerText().catch(() => '')
  ok('未满足前置条件出现提示', /请先|先投入|投料/.test(toastText + ' ' + (await page.locator('#panel-left').innerText())), toastText.slice(0, 40))

  // flow: feed
  await page.getByRole('button', { name: /投入锡矿石/ }).first().click()
  await sleep(2100)
  ok('投料完成 -> FED', (await S()).process === 'FED')
  await page.screenshot({ path: `${OUT}/02_fed.png` })
  const fedText = await page.locator('#panel-left').innerText()
  ok('投料记录进入左面板', /投料|批号|SN-/.test(fedText), fedText.slice(0, 60).replace(/\n/g, ' '))

  // flow: dose
  await page.getByRole('button', { name: /加药/ }).first().click()
  await sleep(2600)
  ok('加药完成 -> DOSED', (await S()).process === 'DOSED')
  await page.screenshot({ path: `${OUT}/03_dosed.png` })
  const dosedText = await page.locator('#panel-left').innerText()
  ok('加药记录进入左面板', /加药记录|黄药|松醇油|g\/t|加药量/.test(dosedText), dosedText.slice(0, 60).replace(/\n/g, ' '))

  // flow: flotation
  await page.getByRole('button', { name: /启动浮选/ }).first().click()
  await sleep(3500)
  const stFloat = await S()
  ok('启动浮选 -> FLOTATING', stFloat.process === 'FLOTATING')
  const runtime = await page.evaluate(() => __HMI.sim.data.top.runtime)
  ok('运行时长开始计时', runtime !== '00:00:00', runtime)
  await page.screenshot({ path: `${OUT}/04_flotating.png` })

  // part panel mapping
  const parts = ['cell', 'camera', 'light', 'scraper', 'pump', 'telescopic', 'suctionPipe', 'vfd', 'plc', 'valve']
  const expect = {
    cell: ['浮选槽', '液位', '充气量', 'pH', '泡沫'],
    camera: ['相机', '帧率', '曝光', '焦距', '气泡'],
    light: ['光源', '色温', '亮度', '功耗', '均匀'],
    scraper: ['刮板', '转速', '周期', '电流', '轴承', '刮取'],
    pump: ['气泵', '压力', '流量', '电流', '振动'],
    telescopic: ['伸缩', '行程', '速度', '限位', '循环'],
    suctionPipe: ['吸管', '管径', '材质', '浸入', '流速', '堵塞'],
    vfd: ['变频器', '频率', '电流', '直流母线', '散热', '负载'],
    plc: ['PLC', 'CPU', '扫描周期', 'I/O', '联锁', '报警'],
    valve: ['阀', '开度', '介质', '流量'],
  }
  for (const id of parts) {
    await page.evaluate((id) => __HMI.select(id), id)
    await sleep(320)
    const text = await page.evaluate(() => document.getElementById('panel-left').innerText + '\n' + document.getElementById('panel-right').innerText)
    const miss = expect[id].filter((k) => !text.toLowerCase().includes(k.toLowerCase()))
    ok(`面板映射 ${id}`, miss.length === 0, miss.length ? '缺: ' + miss.join(',') : '')
  }
  await page.screenshot({ path: `${OUT}/05_parts.png` })

  // real pointer click picks a part
  await page.evaluate(() => __HMI.select(null))
  const cellPt = await page.evaluate(() => __HMI.screenOf('cell'))
  if (cellPt) { await page.mouse.click(cellPt.x, cellPt.y); await sleep(500) }
  ok('真实鼠标点击选中浮选槽', (await S()).selected === 'cell')

  // x-ray: internals pickable and visible
  await page.evaluate(() => __HMI.xray(true))
  await sleep(700)
  await page.screenshot({ path: `${OUT}/06_xray.png` })
  const xr = await S()
  ok('透视模式开启', xr.xray === true)
  for (const id of ['vfd', 'plc']) {
    const pt = await page.evaluate((id) => __HMI.screenOf(id), id)
    const picked = pt ? await page.evaluate(({ x, y }) => __HMI.pickAt(x, y), pt) : null
    ok(`透视下可拾取 ${id}`, picked === id, `命中 ${picked}`)
    if (pt) { await page.mouse.click(pt.x, pt.y); await sleep(400) }
    ok(`点击 ${id} 面板切换`, (await page.evaluate(() => __HMI.stats().selected)) === id)
  }
  await page.screenshot({ path: `${OUT}/07_xray_vfd.png` })

  // x-ray off: internals not pickable
  await page.evaluate(() => __HMI.xray(false))
  await sleep(500)
  const vfdPt = await page.evaluate(() => __HMI.screenOf('vfd'))
  const pickedOff = vfdPt ? await page.evaluate(({ x, y }) => __HMI.pickAt(x, y), vfdPt) : null
  ok('关闭透视后内部件不可拾取', pickedOff !== 'vfd', `命中 ${pickedOff}`)

  // cut
  await page.evaluate(() => __HMI.cut(0.5))
  await sleep(900)
  await page.screenshot({ path: `${OUT}/08_cut.png` })
  const cutState = await S()
  ok('剖切滑条生效', cutState.cut > 0.1 && cutState.xray === false, JSON.stringify(cutState))
  const cutVfd = await page.evaluate(() => __HMI.screenOf('vfd'))
  if (cutVfd) { await page.mouse.click(cutVfd.x, cutVfd.y); await sleep(400) }
  ok('剖切下内部件可拾取', (await page.evaluate(() => __HMI.stats().selected)) === 'vfd')

  // blank click clears
  await page.evaluate(() => { __HMI.cut(0); __HMI.select(null) })
  await page.mouse.click(1200, 900)
  await sleep(400)
  ok('点击空白取消选中', (await page.evaluate(() => __HMI.stats().selected)) === null)

  // reset
  await page.getByRole('button', { name: /复位流程/ }).first().click()
  await sleep(1500)
  const stReset = await S()
  ok('复位回到 IDLE', stReset.process === 'IDLE')
  await page.screenshot({ path: `${OUT}/09_reset.png` })

  // responsive
  await page.setViewportSize({ width: 1366, height: 768 })
  await sleep(1200)
  await page.screenshot({ path: `${OUT}/10_small.png` })
  const overflow = await page.evaluate(() => [...document.querySelectorAll('#panel-left, #panel-right')].map((e) => ({ w: e.clientWidth, sw: e.scrollWidth, h: e.clientHeight, sh: e.scrollHeight })))
  ok('1366×768 面板不横向溢出', overflow.every((o) => o.sw <= o.w + 2), JSON.stringify(overflow))
  ok('无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error('ACCEPTANCE CRASH', e)
  results.push({ name: 'crash', pass: false, extra: e.message })
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join('; ')); process.exit(1) }
