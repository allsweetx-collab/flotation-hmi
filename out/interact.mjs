// Interaction checks + screenshots for HMI.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
let pw
try { pw = require('playwright') } catch { pw = require('playwright-core') }
const CHROME = process.env.PW_CHROME || 'C:\\Users\\20167046\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe'
const browser = await pw.chromium.launch({ headless: true, executablePath: CHROME, args: ['--ignore-gpu-blocklist'] })
const errs = []
const results = {}
async function open(W, H) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => errs.push('PAGE ' + String(e.message).split('\n')[0]))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)) })
  await page.goto(pathToFileURL(resolve('out/hmi.html')).href, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.__HMI && window.__HMI.ready === true, null, { timeout: 120000 })
  await page.waitForTimeout(1000)
  return page
}
mkdirSync('out', { recursive: true })

// ---- 1680 light slider focus / live link
const page = await open(1680, 945)
await page.evaluate(() => window.__HMI.select('light'))
await page.waitForTimeout(400)
await page.evaluate(() => {
  const s = document.querySelector('.sld-input')
  s.focus()
  s.value = '92'
  s.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(250)
results.lightAfterInput = await page.evaluate(() => ({
  value: window.__HMI.sim.lightLevel,
  shown: document.querySelector('.sld-top b').textContent,
  focusKept: document.activeElement === document.querySelector('.sld-input'),
  sliderVal: document.querySelector('.sld-input').value,
}))
// hold interaction across several HMI ticks, keep dragging
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => {
    const s = document.querySelector('.sld-input'); s.value = String(86 + Math.round(Math.random() * 8)); s.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(180)
}
results.dragKeptFocus = await page.evaluate(() => document.activeElement === document.querySelector('.sld-input'))
await page.evaluate(() => { const s = document.querySelector('.sld-input'); s.value = '92'; s.dispatchEvent(new Event('input', { bubbles: true })) })
await page.waitForTimeout(600)
await page.screenshot({ path: 'out/hmi_light92.png' })
results.lightShot = await page.evaluate(() => ({ brightness: window.__HMI.sim.lightLevel, topLamp: document.querySelector('#tb-stage').textContent }))

// ---- xray + internal part
await page.evaluate(() => { window.__HMI.xray(true); window.__HMI.select('vfd') })
await page.waitForTimeout(700)
results.xray = await page.evaluate(() => ({
  on: window.__HMI.xrayOn, btnOn: document.querySelector('#tb-xray').classList.contains('on'),
  btnText: document.querySelector('#tb-xray').textContent.trim(), selected: window.__HMI.stats().selected,
}))
await page.screenshot({ path: 'out/hmi_xray.png' })

// ---- cut plane sync
await page.evaluate(() => { window.__HMI.xray(false); window.__HMI.cut(0.42) })
await page.waitForTimeout(400)
results.cut = await page.evaluate(() => ({
  top: document.querySelector('#tb-cut-val').textContent,
  left: document.querySelector('#cut-pct').textContent,
  slider: document.querySelector('#cut-slider').value,
  cut: window.__HMI.stats().cut,
}))
await page.screenshot({ path: 'out/hmi_cut.png' })

// ---- Esc back to summary
await page.evaluate(() => { window.__HMI.cut(0); window.__HMI.select('cell') })
await page.waitForTimeout(400)
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
await page.waitForTimeout(400)
results.esc = await page.evaluate(() => ({
  selected: window.__HMI.stats().selected,
  tag: document.querySelector('#left-tag').textContent,
  backHidden: document.querySelector('#left-back').hidden,
}))

// ---- disabled flow button toast
await page.waitForTimeout(300)
await page.evaluate(() => document.querySelector('[data-flow="dose"]').click())
await page.waitForTimeout(250)
results.toast = await page.evaluate(() => ({ count: document.querySelectorAll('#toasts .toast').length, text: (document.querySelector('#toasts .toast') || {}).textContent || '' }))
await page.screenshot({ path: 'out/hmi_toast.png' })
await page.close()

// ---- compact layout 900x700
const small = await open(900, 700)
results.compact = await small.evaluate(() => ({
  tabs: getComputedStyle(document.querySelector('#pane-tabs')).display,
  panelTransform: getComputedStyle(document.querySelector('#panel-left')).transform,
}))
await small.evaluate(() => document.querySelector('#pane-tabs [data-pane="left"]').click())
await small.waitForTimeout(600)
results.compactOpen = await small.evaluate(() => ({
  open: document.querySelector('#panel-left').classList.contains('open'),
  rect: document.querySelector('#panel-left').getBoundingClientRect().toJSON(),
}))
await small.screenshot({ path: 'out/hmi_compact.png' })
await small.evaluate(() => document.querySelector('#pane-tabs [data-pane="right"]').click())
await small.waitForTimeout(600)
await small.screenshot({ path: 'out/hmi_compact_right.png' })
await small.close()

console.log(JSON.stringify(results, null, 1))
console.log('ERRORS:', JSON.stringify(errs))
await browser.close()
