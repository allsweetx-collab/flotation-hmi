// Headless review shots for the flotation HMI page.
//   node tools/shot.mjs out/alice.html out/a.png
//   node tools/shot.mjs out/alice.html out/run.png --wait 1 --js "__HMI.runFlow('feed')" --then 2
//   node tools/shot.mjs out/alice.html out/x --steps steps.json      [{ "js": "...", "wait": 2, "out": "out/y.png" }]
//   node tools/shot.mjs out/alice.html out/ui.png --w 1600 --h 900
// Prints page errors, console errors, fps, triangles, draw calls.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
let pw
try { pw = require('playwright') } catch { try { pw = require('playwright-core') } catch { console.error('playwright missing'); process.exit(2) } }

const a = process.argv.slice(2)
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d }
const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--')))
const [PAGE, OUT] = pos
if (!PAGE || !OUT) { console.error('usage: node tools/shot.mjs <page.html> <out.png> [--wait s] [--js code] [--then s] [--w n --h n] [--steps file]'); process.exit(1) }
const W = Number(opt('--w', 1680)), H = Number(opt('--h', 945))
const file = resolve(PAGE)
const url = pathToFileURL(file).href
mkdirSync(resolve(OUT, '..'), { recursive: true })

const args = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
const CHROME = process.env.PW_CHROME || 'C:\\Users\\20167046\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe'
const browser = await pw.chromium.launch({ headless: true, executablePath: CHROME, args })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => { errors.push('PAGE ERROR ' + e.message.split('\n')[0]); console.log('PAGE ERROR', e.message.split('\n')[0]) })
page.on('console', (m) => { if (m.type() === 'error') { errors.push('CONSOLE ' + m.text()); console.log('CONSOLE', m.text().slice(0, 1500)) } })
page.on('requestfailed', (r) => console.log('REQFAIL', r.url().slice(0, 120), r.failure()?.errorText))

try {
  await page.goto(url, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.__HMI && window.__HMI.ready === true, null, { timeout: 120000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(Number(opt('--wait', 3)) * 1000)
  const evalJs = async (s) => {
    const r = await page.evaluate((code) => { try { return (0, eval)(code) } catch (e) { return 'EVAL ERROR ' + e.message } }, s)
    if (r !== undefined) console.log('EVAL =>', typeof r === 'string' ? r.slice(0, 4000) : JSON.stringify(r)?.slice(0, 4000))
    await page.waitForTimeout(Number(opt('--then', 1.6)) * 1000)
  }
  if (opt('--js')) await evalJs(opt('--js'))
  const info = await page.evaluate(async () => {
    const t0 = performance.now(); let n = 0
    await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
    return { fps: n, ...window.__HMI.stats() }
  })
  console.log(JSON.stringify(info))
  await page.screenshot({ path: OUT, timeout: 240000 })
  console.log('shot', OUT)
  const steps = opt('--steps')
  if (steps) {
    for (const st of JSON.parse(readFileSync(resolve(steps), 'utf8'))) {
      if (st.js) await page.evaluate((code) => (0, eval)(code), st.js)
      await page.waitForTimeout((st.wait ?? 2) * 1000)
      mkdirSync(resolve(st.out, '..'), { recursive: true })
      await page.screenshot({ path: st.out })
      console.log('shot', st.out)
    }
  }
  if (errors.length) console.log('ERRORS:', errors.length)
} finally {
  await browser.close()
}
