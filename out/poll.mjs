import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url)
const pw = require('playwright')
const CHROME = process.env.PW_CHROME || 'C:\\Users\\20167046\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe'
const browser = await pw.chromium.launch({ headless: true, executablePath: CHROME, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })
const page = await browser.newPage({ viewport: { width: 1680, height: 945 } })
page.on('pageerror', (e) => console.log('ERR', e.message))
await page.goto(pathToFileURL(resolve('out/check.html')).href, { waitUntil: 'load' })
await page.waitForFunction(() => window.__HMI?.ready === true)
const t0 = Date.now()
await page.evaluate(() => document.querySelector('[data-flow="feed"]').click())
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(300)
  const s = await page.evaluate(() => ({ p: __HMI.sim.process, ore: __HMI.sim.anim.ore.toFixed(3), t: __HMI.sim.t.toFixed(2), hint: __HMI.sim.hint, fps: __HMI.stats().fps }))
  console.log(((Date.now() - t0) / 1000).toFixed(2), JSON.stringify(s))
}
await page.evaluate(() => document.querySelector('[data-flow="dose"]').click())
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(300)
  const s = await page.evaluate(() => ({ p: __HMI.sim.process, dose: __HMI.sim.anim.dose.toFixed(3), t: __HMI.sim.t.toFixed(2), fps: __HMI.stats().fps }))
  console.log(((Date.now() - t0) / 1000).toFixed(2), JSON.stringify(s))
}
await browser.close()
