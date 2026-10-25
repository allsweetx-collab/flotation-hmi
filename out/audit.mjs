// Layout audit for the HMI page: per-selection overflow + panel scroll + topbar rects.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url)
let pw
try { pw = require('playwright') } catch { pw = require('playwright-core') }
const a = process.argv.slice(2)
const pageArg = a[0], W = Number(a[1] || 1680), H = Number(a[2] || 945)
const wantFlow = a.includes('--flow')
const CHROME = process.env.PW_CHROME || 'C:\\Users\\20167046\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe'
const browser = await pw.chromium.launch({ headless: true, executablePath: CHROME, args: ['--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const errs = []
page.on('pageerror', (e) => errs.push(String(e.message).split('\n')[0]))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
await page.goto(pathToFileURL(resolve(pageArg)).href, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => window.__HMI && window.__HMI.ready === true, null, { timeout: 120000 })
await page.waitForTimeout(1200)
if (wantFlow) {
  await page.evaluate(() => window.__HMI.flow('feed'))
  await page.waitForTimeout(2600)
  await page.evaluate(() => window.__HMI.flow('dose'))
  await page.waitForTimeout(3200)
  await page.evaluate(() => window.__HMI.flow('flotate'))
  await page.waitForTimeout(2500)
}
const measure = async () => page.evaluate(() => {
  const panels = ['#panel-left', '#panel-right']
  const res = { body: {}, overflow: [], topbar: {} }
  for (const sel of panels) {
    const p = document.querySelector(sel)
    const pb = p.querySelector('.pbody')
    res.body[sel] = { scrollH: pb.scrollHeight, clientH: pb.clientHeight, fits: pb.scrollHeight <= pb.clientHeight + 1 }
    for (const el of p.querySelectorAll('*')) {
      if (el === pb) continue
      if (el.tagName === 'CANVAS') continue
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        const t = (el.textContent || '').trim().slice(0, 26)
        if (t && el.children.length === 0) res.overflow.push({ panel: sel, cls: el.className, sw: el.scrollWidth, cw: el.clientWidth, text: t })
        else if (t && el.scrollHeight > el.clientHeight + 1) res.overflow.push({ panel: sel, cls: el.className, sh: el.scrollHeight, ch: el.clientHeight, text: t })
      }
    }
  }
  const tb = document.querySelector('#topbar')
  for (const sel of ['.tb-left', '.tb-center', '.tb-right']) { const el = tb.querySelector(sel); const b = el.getBoundingClientRect(); res.topbar[sel] = { x: +b.x.toFixed(0), right: +b.right.toFixed(0) } }
  res.topbarH = tb.getBoundingClientRect().height
  return res
})
const ids = [null, 'cell', 'camera', 'light', 'scraper', 'valve', 'pump', 'telescopic', 'suctionPipe', 'vfd', 'plc']
const report = {}
for (const id of ids) {
  await page.evaluate((v) => window.__HMI.select(v), id)
  await page.waitForTimeout(350)
  const r = await measure()
  const l = r.body['#panel-left'], rt = r.body['#panel-right']
  report[id || 'SUMMARY'] = {
    left: l.fits ? 'fits' : `OVER ${l.scrollH - l.clientH}px`,
    right: rt.fits ? 'fits' : `OVER ${rt.scrollH - rt.clientH}px`,
    overflow: r.overflow,
  }
}
console.log(JSON.stringify({ viewport: { W, H }, flow: wantFlow, report }, null, 1))
console.log('ERRORS:', JSON.stringify(errs))
await browser.close()
