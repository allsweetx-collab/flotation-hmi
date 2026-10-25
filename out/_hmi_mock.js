// HMI shell — top status bar + left "part status" / right "vision analysis" floating panels.
//
// Rendering model: the DOM is scaffolded once (top bar, flow controls, panel shells) and the
// selected-part bodies are rebuilt only when the selection changes. A 10 Hz tick then patches
// text nodes / bar widths / status-dot classes, so sliders keep focus and nothing flashes.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

const PROC_CN = {
  IDLE: '待机', FEEDING: '投料中', FED: '已投料', DOSING: '加药中', DOSED: '已加药', FLOTATING: '浮选中',
}
const STAGES = ['待投料', '已投料', '已加药', '浮选中']
const LAMPS = ['待机', '投料', '加药', '运行', '报警']
const FLOW_HINT = {
  feed: '前置条件未满足：请先复位流程',
  dose: '前置条件未满足：请先投入锡矿石',
  flotate: '前置条件未满足：请先完成加药',
  reset: '流程尚未启动，无需复位',
}

const fmt = (v, d = 0) => {
  if (v === null || v === undefined || !isFinite(v)) return '--'
  const n = Number(v)
  if (d) return n.toFixed(d)
  const s = String(Math.round(Math.abs(n)))
  return (n < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
const dps = (v, d, unit = '') => fmt(v, d) + (unit ? ' ' + unit : '')
const setText = (el, t) => { if (el && el.__t !== t) { el.__t = t; el.textContent = t } }
const isFin = (v) => isFinite(v) && v !== null && v !== undefined

export function createHMI({ sim, world, actions, state }) {
  const $id = (id) => document.getElementById(id)
  const topbar = $id('topbar')
  const left = $id('panel-left')
  const right = $id('panel-right')

  let selected = null
  let vfdDrive = 0
  let keySeq = 0
  const nextKey = () => 'k' + (++keySeq)
  let bodyUpdaters = []

  const addBody = (fn) => bodyUpdaters.push(fn)
  const run = () => sim.process === 'FLOTATING'
  const partLabel = (id) => {
    try { return world?.parts?.get?.(id)?.label || id } catch { return id }
  }

  // ------------------------------------------------------------------ top bar
  topbar.innerHTML = `
    <div class="tb-left">
      <div class="tb-brand"><i></i>有色冶金视觉浮选系统<span>· 实时监控</span></div>
      <div class="tb-sub">VISUAL FLOTATION CONSOLE · DCS-3F / REAL-TIME MONITORING</div>
    </div>
    <div class="tb-center">
      <div class="tb-clock" id="tb-clock">--:--:--</div>
      <div class="tb-runtime"><span>运行时长</span><b id="tb-runtime">00:00:00</b><span class="tb-stage" id="tb-stage">IDLE</span></div>
    </div>
    <div class="tb-right">
      <div class="tb-lamps" id="tb-lamps">
        ${LAMPS.map((n) => `<span class="lamp${n === '报警' ? ' alarm' : ''}" data-lamp="${n}">${n}</span>`).join('')}
      </div>
      <div class="tb-currents">
        ${[0, 1, 2].map((i) => `
          <div class="cur">
            <span class="cl">${'ABC'[i]} 相</span>
            <span class="ct"><i data-cf="${i}"></i></span>
            <b data-cv="${i}">0.0 A</b>
          </div>`).join('')}
      </div>
      <button class="tb-btn" id="tb-xray" type="button">透视模式<b>OFF</b></button>
      <div class="tb-cut" id="tb-cut"><span class="lbl">剖切</span><span class="cbar"><i id="tb-cut-fill"></i></span><b id="tb-cut-val">0%</b></div>
    </div>`

  // ------------------------------------------------------------------ left panel shell
  left.innerHTML = `
    <div class="ph">
      <span class="ph-t">部件状态 <b>·</b> 实时参数</span>
      <em class="ph-tag" id="left-tag">SUMMARY</em>
      <button class="ph-back" id="left-back" type="button" hidden>总览</button>
    </div>
    <div class="flowbox">
      <div class="flow-btns">
        <button type="button" data-flow="feed">投入锡矿石</button>
        <button type="button" data-flow="dose">加药</button>
        <button type="button" data-flow="flotate">启动浮选</button>
        <button type="button" data-flow="reset" class="ghost">复位流程</button>
      </div>
      <div class="stages" id="flow-stages">
        ${STAGES.map((n, i) => `<span data-stage="${i}">${n}</span>`).join('')}
      </div>
      <div class="flow-hint" id="flow-hint">请点击「投入锡矿石」开始演示</div>
    </div>
    <div class="pbody" id="left-body"></div>
    <div class="cutbox">
      <div class="cut-top"><span>剖切面 · Z 向</span><b id="cut-pct">0 %</b></div>
      <input type="range" id="cut-slider" min="0" max="100" step="1" value="0" aria-label="剖切面深度">
      <div class="cut-ticks"><span>0</span><span>50</span><span>100</span></div>
    </div>`

  // ------------------------------------------------------------------ right panel shell
  right.innerHTML = `
    <div class="ph">
      <span class="ph-t">视觉系统 <b>·</b> 分析输出</span>
      <em class="ph-tag" id="right-tag">VISION</em>
    </div>
    <div class="pbody" id="right-body"></div>`

  const leftBody = $id('left-body')
  const rightBody = $id('right-body')
  const hintEl = $id('flow-hint')
  const stageEls = [...$id('flow-stages').querySelectorAll('[data-stage]')]
  const flowBtns = [...left.querySelectorAll('[data-flow]')]
  const lampEls = [...$id('tb-lamps').querySelectorAll('[data-lamp]')]
  const curFills = [0, 1, 2].map((i) => $id('tb-lamps').parentNode.querySelector(`[data-cf="${i}"]`))
  const curVals = [0, 1, 2].map((i) => $id('tb-lamps').parentNode.querySelector(`[data-cv="${i}"]`))
  const xrayBtn = $id('tb-xray')
  const cutWrap = $id('tb-cut')
  const cutFill = $id('tb-cut-fill')
  const cutVal = $id('tb-cut-val')
  const cutSlider = $id('cut-slider')
  const cutPct = $id('cut-pct')

  // ------------------------------------------------------------------ compact drawers
  const tabs = document.createElement('div')
  tabs.id = 'pane-tabs'
  tabs.innerHTML = `<button type="button" data-pane="left">部件状态</button><button type="button" data-pane="right">视觉分析</button>`
  document.body.appendChild(tabs)
  const paneBtns = [...tabs.querySelectorAll('[data-pane]')]
  let paneOpen = null
  const isCompact = () => window.matchMedia('(max-width: 980px)').matches
  function openPane(name) {
    paneOpen = name
    left.classList.toggle('open', name === 'left')
    right.classList.toggle('open', name === 'right')
    paneBtns.forEach((b) => b.classList.toggle('on', b.dataset.pane === name))
  }
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-pane]')
    if (!btn) return
    openPane(paneOpen === btn.dataset.pane ? null : btn.dataset.pane)
  })
  window.addEventListener('resize', () => {
    if (!isCompact()) {
      openPane(null)
      paneBtns.forEach((b) => b.classList.remove('on'))
    }
  })

  // ------------------------------------------------------------------ toasts
  let lastToast = 0
  function toast(msg, kind = 'warn') {
    const now = performance.now()
    if (now - lastToast < 350) return
    lastToast = now
    const host = $id('toasts')
    if (!host) return
    const el = document.createElement('div')
    el.className = 'toast' + (kind === 'bad' ? ' bad' : '')
    el.textContent = msg
    host.appendChild(el)
    while (host.children.length > 3) host.firstChild.remove()
    setTimeout(() => el.classList.add('out'), 1500)
    setTimeout(() => el.remove(), 2100)
  }

  // ------------------------------------------------------------------ interactions: flow
  function flowAvail() {
    const locked = !!sim.lock
    return {
      feed: !locked && sim.process === 'IDLE',
      dose: !locked && sim.process === 'FED',
      flotate: !locked && sim.process === 'DOSED',
      reset: !locked && sim.process !== 'IDLE',
      locked,
    }
  }
  for (const btn of flowBtns) {
    btn.addEventListener('click', () => {
      const a = btn.dataset.flow
      const av = flowAvail()
      if (!av[a]) { toast(av.locked ? '流程动画执行中，请稍候…' : FLOW_HINT[a]); return }
      const ok = actions.flow(a)
      if (!ok) toast(FLOW_HINT[a])
    })
  }

  // ------------------------------------------------------------------ interactions: xray / cut / back
  xrayBtn.addEventListener('click', () => actions.toggleXray())
  $id('left-back').addEventListener('click', () => actions.clearSelection?.())
  cutSlider.addEventListener('input', () => {
    const v = Number(cutSlider.value)
    cutPct.textContent = v + ' %'
    actions.setCut(v / 100)
  })

  // ------------------------------------------------------------------ chrome updater
  function chromeTick() {
    const D = sim.data
    setText($id('tb-clock'), sim.clock)
    setText($id('tb-runtime'), D.top.runtime)
    setText($id('tb-stage'), sim.process)
    const st = D.top.status
    for (const el of lampEls) el.classList.toggle('on', el.dataset.lamp === st)
    for (let i = 0; i < 3; i++) {
      const v = D.top.currents[i]
      curFills[i].style.width = Math.max(2, clamp(v / 24, 0, 1) * 100).toFixed(1) + '%'
      setText(curVals[i], fmt(v, 1) + ' A')
    }
    const xon = !!state.xrayOn
    xrayBtn.classList.toggle('on', xon)
    setText(xrayBtn.querySelector('b'), xon ? 'ON' : 'OFF')
    const cv = Math.round(clamp(state.cutValue, 0, 1) * 100)
    cutFill.style.width = cv + '%'
    setText(cutVal, cv + '%')
    cutWrap.classList.toggle('on', cv > 0)
    if (document.activeElement !== cutSlider) {
      if (Number(cutSlider.value) !== cv) cutSlider.value = cv
      setText(cutPct, cv + ' %')
    } else {
      setText(cutPct, cutSlider.value + ' %')
    }
    const av = flowAvail()
    for (const b of flowBtns) {
      const ok = !!av[b.dataset.flow]
      b.classList.toggle('disabled', !ok)
      b.classList.toggle('ready', ok)
      b.setAttribute('aria-disabled', String(!ok))
    }
    for (let i = 0; i < stageEls.length; i++) {
      stageEls[i].classList.toggle('cur', i === sim.stageIndex)
      stageEls[i].classList.toggle('done', i < sim.stageIndex)
    }
    setText(hintEl, sim.hint)
  }

  // ------------------------------------------------------------------ HTML block builders
  const secHead = (idx, title) => `<div class="sec-h"><b>${idx}</b><span>${title}</span></div>`
  const compose = (...blocks) => ({
    html: blocks.map((b) => b.html).join(''),
    bind(c) { for (const b of blocks) b.bind(c) },
  })

  function blockRows(title, idx, defs) {
    const items = defs.map((d) => ({ d, key: nextKey() }))
    const html = `<div class="sec">${secHead(idx, title)}${items.map(({ d, key }) => `
      <div class="row${d.strong ? ' strong' : ''}">
        ${d.dot ? `<i class="dot idle" data-d="${key}"></i>` : ''}
        <span class="k">${d.k}</span>
        <span class="v"><b data-k="${key}">--</b>${d.u ? `<em>${d.u}</em>` : ''}</span>
      </div>`).join('')}</div>`
    return {
      html,
      bind(c) {
        for (const { d, key } of items) {
          const b = c.querySelector(`[data-k="${key}"]`)
          const dt = c.querySelector(`[data-d="${key}"]`)
          addBody(() => {
            setText(b, d.v(sim.data, sim))
            if (dt) {
              const s = d.dot(sim.data, sim)
              if (dt.__s !== s) { dt.__s = s; dt.className = 'dot ' + s }
            }
          })
        }
      },
    }
  }

  function blockKpis(title, idx, defs) {
    const items = defs.map((d) => ({ d, key: nextKey() }))
    const html = `<div class="sec">${secHead(idx, title)}<div class="kpis">${items.map(({ d, key }) => `
      <div class="kpi">
        <div class="kl">${d.dot ? `<i class="dot idle" data-d="${key}"></i>` : ''}<span>${d.k}</span></div>
        <div class="kv"><b data-k="${key}" class="${d.small ? 'sm' : ''}">--</b>${d.u ? `<em>${d.u}</em>` : ''}</div>
      </div>`).join('')}</div></div>`
    return {
      html,
      bind(c) {
        for (const { d, key } of items) {
          const b = c.querySelector(`[data-k="${key}"]`)
          const dt = c.querySelector(`[data-d="${key}"]`)
          addBody(() => {
            setText(b, d.v(sim.data, sim))
            if (dt) {
              const s = d.dot(sim.data, sim)
              if (dt.__s !== s) { dt.__s = s; dt.className = 'dot ' + s }
            }
          })
        }
      },
    }
  }

  function blockBars(title, idx, defs) {
    const items = defs.map((d) => ({ d, key: nextKey() }))
    const html = `<div class="sec">${secHead(idx, title)}<div class="bars">${items.map(({ d, key }) => `
      <div class="bar-row">
        <span class="bk">${d.k}</span>
        <span class="bt"><i data-f="${key}" class="${d.tone || ''}"></i></span>
        <span class="bv"><b data-k="${key}">--</b></span>
      </div>`).join('')}</div></div>`
    return {
      html,
      bind(c) {
        for (const { d, key } of items) {
          const f = c.querySelector(`[data-f="${key}"]`)
          const b = c.querySelector(`[data-k="${key}"]`)
          addBody(() => {
            const v = Number(d.v(sim.data, sim)) || 0
            const p = clamp(v / (d.max || 100), 0, 1) * 100
            const w = p.toFixed(1) + '%'
            if (f.__w !== w) { f.__w = w; f.style.width = w }
            setText(b, d.fmt ? d.fmt(v) : fmt(v, d.dp || 0) + '%')
          })
        }
      },
    }
  }

  function drawChart(cv, o) {
    const w = cv.clientWidth, h = cv.clientHeight
    if (!w || !h) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = Math.round(w * dpr), H = Math.round(h * dpr)
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(96,126,136,.14)'
    for (let i = 1; i < 4; i++) {
      const y = Math.round((h / 4) * i) + 0.5
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
    const vals = o.values() || []
    if (!vals.length) {
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = 'rgba(120,150,160,.5)'
      const y = Math.round(h * 0.62) + 0.5
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(120,150,160,.6)'
      ctx.font = '9px Consolas, monospace'
      ctx.fillText('待机 · 无帧率数据', 5, h * 0.62 - 6)
      return
    }
    const last = o.slots || 60
    const n = Math.min(vals.length, last)
    const X = (i) => ((i + (last - n)) / (last - 1)) * (w - 2) + 1
    const Y = (v) => h - 2 - ((clamp(v, o.min, o.max) - o.min) / (o.max - o.min)) * (h - 7)
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const px = X(i), py = Y(vals[vals.length - n + i])
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
    }
    ctx.lineTo(X(n - 1), h); ctx.lineTo(X(0), h); ctx.closePath()
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, 'rgba(63,224,197,.24)')
    g.addColorStop(1, 'rgba(63,224,197,0)')
    ctx.fillStyle = g; ctx.fill()
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const px = X(i), py = Y(vals[vals.length - n + i])
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
    }
    ctx.strokeStyle = '#3fe0c5'; ctx.lineWidth = 1.3; ctx.stroke()
    ctx.fillStyle = '#d9fff7'
    ctx.beginPath(); ctx.arc(X(n - 1), Y(vals[vals.length - 1]), 1.8, 0, Math.PI * 2); ctx.fill()
  }

  function blockChart(title, idx, o) {
    const key = nextKey()
    const html = `<div class="sec">${secHead(idx, title)}
      <div class="chart">
        <div class="ch-top"><span>${o.hint || ''}</span><b data-k="${key}">--</b></div>
        <canvas></canvas>
        <div class="ch-axis"><span>−30 s</span><span>现在</span></div>
      </div></div>`
    return {
      html,
      bind(c) {
        const b = c.querySelector(`[data-k="${key}"]`)
        addBody(() => setText(b, o.value(sim.data, sim)))
        const cv = c.querySelector('canvas')
        addBody(() => drawChart(cv, o))
      },
    }
  }

  function blockRing(title, idx, o) {
    const key = nextKey()
    const html = `<div class="sec">${secHead(idx, title)}
      <div class="ring-wrap">
        <div class="ring" data-ring="${key}">
          <div class="rin"><b data-k="${key}">--</b>${o.u ? `<em>${o.u}</em>` : ''}<span>${o.sub || ''}</span></div>
        </div>
        ${o.note ? `<div class="ring-note">${o.note}</div>` : ''}
      </div>${o.foot ? `<div class="note">${o.foot}</div>` : ''}</div>`
    return {
      html,
      bind(c) {
        const ringEl = c.querySelector(`[data-ring="${key}"]`)
        const b = c.querySelector(`[data-k="${key}"]`)
        addBody(() => {
          const p = clamp(o.pct(sim.data, sim), 0, 1)
          const deg = (p * 360).toFixed(1)
          ringEl.style.background = `conic-gradient(from -90deg, ${o.color || '#3fe0c5'} 0deg ${deg}deg, rgba(28,38,44,.95) ${deg}deg 360deg)`
          setText(b, o.main(sim.data, sim))
        })
      },
    }
  }

  function blockColor(title, idx, fn) {
    const key = nextKey()
    const html = `<div class="sec">${secHead(idx, title)}
      <div class="swatch-row">
        <div class="swatch" data-sw="${key}"></div>
        <div class="rgb-list">
          <span>R <b data-r="${key}">--</b></span>
          <span>G <b data-g="${key}">--</b></span>
          <span>B <b data-b="${key}">--</b></span>
        </div>
      </div></div>`
    return {
      html,
      bind(c) {
        const sw = c.querySelector(`[data-sw="${key}"]`)
        const r = c.querySelector(`[data-r="${key}"]`)
        const g = c.querySelector(`[data-g="${key}"]`)
        const b = c.querySelector(`[data-b="${key}"]`)
        addBody(() => {
          const col = fn(sim.data, sim) || [0, 0, 0]
          const css = `rgb(${col[0]},${col[1]},${col[2]})`
          if (sw.__c !== css) { sw.__c = css; sw.style.background = css }
          setText(r, String(Math.round(col[0])))
          setText(g, String(Math.round(col[1])))
          setText(b, String(Math.round(col[2])))
        })
      },
    }
  }

  function blockImpact(title, idx, fn) {
    const key = nextKey()
    return {
      html: `<div class="sec">${secHead(idx, title)}<div class="impact" data-ik="${key}">—</div></div>`,
      bind(c) {
        const el = c.querySelector(`[data-ik="${key}"]`)
        addBody(() => setText(el, fn(sim.data, sim)))
      },
    }
  }

  function blockAlarms(title, idx, fn, max = 3) {
    const slots = Array.from({ length: max }, (_, i) => ({ i, key: nextKey() }))
    const html = `<div class="sec">${secHead(idx, title)}<div class="alarm-list">${slots.map((s) => `
      <div class="alarm info" data-s="${s.i}" hidden>
        <span class="at" data-t="${s.key}"></span>
        <span class="ac" data-c="${s.key}"></span>
        <span class="ax" data-x="${s.key}"></span>
      </div>`).join('')}</div></div>`
    return {
      html,
      bind(c) {
        const list = fn(sim.data, sim) || []
        slots.forEach((s, i) => {
          const row = c.querySelector(`[data-s="${s.i}"]`)
          const at = c.querySelector(`[data-t="${s.key}"]`)
          const ac = c.querySelector(`[data-c="${s.key}"]`)
          const ax = c.querySelector(`[data-x="${s.key}"]`)
          addBody(() => {
            const arr = fn(sim.data, sim) || []
            const a = arr[i]
            row.hidden = !a
            if (!a) return
            setText(at, a.time || '—')
            setText(ac, a.code || '—')
            setText(ax, a.text || '')
            const sev = /^F/.test(a.code || '') ? 'warn' : 'info'
            if (row.__s !== sev) { row.__s = sev; row.className = 'alarm ' + sev }
          })
        })
      },
    }
  }

  function blockFaults(title, idx, fn) {
    const key = nextKey()
    return {
      html: `<div class="sec">${secHead(idx, title)}<div class="alarm-list" data-fl="${key}"></div></div>`,
      bind(c) {
        const host = c.querySelector(`[data-fl="${key}"]`)
        let sig = ''
        addBody(() => {
          const list = fn(sim.data, sim) || []
          const s = JSON.stringify(list)
          if (s === sig) return
          sig = s
          host.innerHTML = list.length
            ? list.map((f) => `<div class="alarm ${/^F/.test(f.code || '') ? 'warn' : 'info'}"><span class="ac">${f.code || '—'}</span><span class="ax">${f.text || ''}</span></div>`).join('')
            : '<div class="alarm ok"><span class="ax">无故障码 · 驱动器就绪</span></div>'
        })
      },
    }
  }

  function blockSlider(title, idx, o) {
    const key = nextKey()
    const html = `<div class="sec">${secHead(idx, title)}
      <div class="sld-top"><span>光源亮度调节</span><b data-k="${key}">68 %</b></div>
      <input type="range" class="sld-input" min="${o.min}" max="${o.max}" step="1" value="${Math.round(sim.lightLevel)}" aria-label="光源亮度">
      <div class="sld-scale"><span>${o.min}</span><span>${o.recMin}</span><span>${o.recMax}</span><span>${o.max}</span></div>
      ${o.foot ? `<div class="note">${o.foot}</div>` : ''}</div>`
    return {
      html,
      bind(c) {
        const inp = c.querySelector('.sld-input')
        const out = c.querySelector(`[data-k="${key}"]`)
        inp.value = String(Math.round(sim.lightLevel))
        inp.addEventListener('input', () => {
          actions.setLight(Number(inp.value))
          setText(out, Math.round(Number(inp.value)) + ' %')
        })
        addBody(() => {
          let v
          if (document.activeElement === inp) v = Math.round(Number(inp.value))
          else {
            v = Math.round(sim.lightLevel)
            if (Number(inp.value) !== v) inp.value = String(v)
          }
          setText(out, v + ' %')
        })
      },
    }
  }

  function blockRecords() {
    const html = `<div class="sec" data-sec="rec" hidden>
      ${secHead('03', '投料 / 加药记录')}
      <div class="rec" data-rec="ore" hidden>
        <div class="rec-h"><i class="dot ok"></i>投料记录</div>
        <div class="rec-grid">
          <div><span>批号</span><b data-r="oreBatch">—</b></div>
          <div><span>时间</span><b data-r="oreTime">—</b></div>
          <div><span>质量</span><b data-r="oreMass">—</b></div>
          <div><span>品位 Sn</span><b data-r="oreGrade">—</b></div>
        </div>
      </div>
      <div class="rec" data-rec="dose" hidden>
        <div class="rec-h"><i class="dot ok"></i>加药记录</div>
        <div class="rec-grid">
          <div><span>药剂</span><b data-r="doseAgent">—</b></div>
          <div><span>时间</span><b data-r="doseTime">—</b></div>
          <div><span>用量</span><b data-r="doseDosage">—</b></div>
          <div><span>搅拌</span><b data-r="doseStir">—</b></div>
        </div>
      </div>
    </div>`
    return {
      html,
      bind(c) {
        const sec = c.querySelector('[data-sec="rec"]')
        const ore = c.querySelector('[data-rec="ore"]')
        const dose = c.querySelector('[data-rec="dose"]')
        const ref = {}
        for (const el of c.querySelectorAll('[data-r]')) ref[el.dataset.r] = el
        addBody(() => {
          const D = sim.data
          const hasOre = !!D.ore && D.ore.batch && D.ore.batch !== '—'
          const hasDose = !!D.dose && D.dose.agent && D.dose.agent !== '—'
          sec.hidden = !hasOre && !hasDose
          ore.hidden = !hasOre
          dose.hidden = !hasDose
          if (hasOre) {
            setText(ref.oreBatch, D.ore.batch)
            setText(ref.oreMass, fmt(D.ore.mass, 1) + ' kg')
            setText(ref.oreGrade, fmt(D.ore.grade, 2) + ' %')
            setText(ref.oreTime, D.ore.time)
          }
          if (hasDose) {
            setText(ref.doseAgent, D.dose.agent)
            setText(ref.doseDosage, fmt(D.dose.dosage, 0) + ' g/t')
            setText(ref.doseStir, fmt(D.dose.stir, 0) + ' r/min')
            setText(ref.doseTime, D.dose.time)
          }
        })
      },
    }
  }

  function blockNote(title, idx, text, cls = '') {
    return { html: `<div class="sec ${cls}">${secHead(idx, title)}<div class="note">${text}</div></div>`, bind() {} }
  }

  function blockCustom(title, idx, html, bindFn) {
    return { html: `<div class="sec">${secHead(idx, title)}${html}</div>`, bind: bindFn }
  }

  // ------------------------------------------------------------------ summary
  function buildSummarySpec() {
    const leftSpec = compose(
      blockKpis('浮选槽 · 总体状态', '01', [
        { k: '矿浆液位', u: 'mm', v: (d) => fmt(d.cell.level, 0), dot: () => 'ok' },
        { k: '充气量', u: 'm³/h', v: (d) => fmt(d.cell.air, 1), dot: (d) => d.cell.air > 2 ? 'ok' : 'idle' },
        { k: '矿浆 pH', v: (d) => fmt(d.cell.ph, 2), dot: () => 'ok' },
        { k: '泡沫层厚度', u: 'mm', v: (d) => fmt(d.foam.thickness, 0), dot: (d) => d.foam.thickness > 2 ? 'ok' : 'idle' },
      ]),
      blockRows('过程参数', '02', [
        { k: '矿浆温度', u: '℃', v: (d) => fmt(d.cell.temp, 1) },
        { k: '槽内压力', u: 'kPa', v: (d) => fmt(d.cell.pressure, 1), dot: (d) => d.cell.pressure > 1 ? 'ok' : 'idle' },
        { k: '流程阶段', v: () => PROC_CN[sim.process] || sim.process, dot: (d, s) => s.process === 'FLOTATING' ? 'ok' : s.process === 'IDLE' ? 'idle' : 'warn' },
        { k: '液位设定', u: 'mm', v: () => '1,620' },
      ]),
      blockRecords(),
      blockNote('操作提示', '04', '点击 3D 模型中的部件查看该设备的实时参数与视觉分析；按 Esc 或点击空白处返回总览。', 'sec-tip'),
    )
    const rightSpec = compose(
      blockKpis('视觉相机 · 工作状态', '01', [
        { k: '采集帧率', u: 'fps', v: (d) => fmt(d.camera.fps, 1), dot: (d) => d.camera.fps > 20 ? 'ok' : 'idle' },
        { k: '曝光时间', v: (d) => d.camera.exposure, small: true, dot: () => 'ok' },
        { k: '光源亮度', u: '%', v: (d) => fmt(d.light.brightness, 0), dot: (d) => d.light.brightness >= 55 && d.light.brightness <= 80 ? 'ok' : 'warn' },
      ]),
      blockChart('最近 30 秒帧率', '02', {
        hint: 'CAM-01 / FPS', slots: 60, min: 0, max: 35,
        values: () => sim.history,
        value: (d) => fmt(d.camera.fps, 1) + ' fps',
      }),
      blockRows('视觉分析输出', '03', [
        { k: '气泡识别数量', u: '个/帧', v: (d) => fmt(d.camera.bubbles, 0), dot: (d) => d.camera.bubbles > 0 ? 'ok' : 'idle' },
        { k: '气泡尺寸均值', u: 'mm', v: (d) => fmt(d.camera.sizeMean, 2) },
        { k: '泡沫稳定性评分', u: '/100', v: (d) => fmt(d.camera.stability, 0) },
        { k: '图像置信度', u: '%', v: (d) => fmt(d.camera.confidence * 100, 1) },
        { k: '相机状态', v: (d) => d.camera.status, dot: (d) => d.camera.status === '采集中' ? 'ok' : 'idle' },
      ]),
      blockNote('采集提示', '04', '启动浮选后视觉系统进入连续采集，帧率曲线开始记录；待机时曲线保持基线。'),
    )
    return { left: leftSpec, right: rightSpec }
  }

  // ------------------------------------------------------------------ per-part detail
  function buildPartSpec(id) {
    switch (id) {
      case 'cell': return {
        left: compose(
          blockKpis('槽体总体状态', '01', [
            { k: '矿浆液位', u: 'mm', v: (d) => fmt(d.cell.level, 0), dot: () => 'ok' },
            { k: '充气量', u: 'm³/h', v: (d) => fmt(d.cell.air, 1), dot: (d) => d.cell.air > 2 ? 'ok' : 'idle' },
            { k: '矿浆 pH', v: (d) => fmt(d.cell.ph, 2), dot: () => 'ok' },
            { k: '泡沫层厚度', u: 'mm', v: (d) => fmt(d.foam.thickness, 0), dot: (d) => d.foam.thickness > 2 ? 'ok' : 'idle' },
          ]),
          blockRows('实时参数', '02', [
            { k: '矿浆温度', u: '℃', v: (d) => fmt(d.cell.temp, 1), dot: () => 'ok' },
            { k: '槽内压力', u: 'kPa', v: (d) => fmt(d.cell.pressure, 1), dot: (d) => d.cell.pressure > 1 ? 'ok' : 'idle' },
            { k: '矿浆液位设定', u: 'mm', v: () => '1,620' },
            { k: '流程阶段', v: () => PROC_CN[sim.process] || sim.process, dot: (d, s) => s.process === 'FLOTATING' ? 'ok' : 'idle' },
            { k: '泡沫层存在度', u: '%', v: () => fmt(sim.anim.foam * 100, 0) },
          ]),
          blockBars('矿浆 / 泡沫状态', '03', [
            { k: '充气强度', v: (d) => (d.cell.air / 62.4) * 100, fmt: (v) => fmt(Math.min(999, v), 0) + '%' },
            { k: '泡沫层厚度', v: (d) => (d.foam.thickness / 42) * 100, fmt: (v) => fmt(Math.min(999, v), 0) + '%' },
          ]),
          blockNote('工艺说明', '04', '泡沫层随充气量与药剂作用建立，液位稳定在 1,620 mm 目标区间。'),
        ),
        right: compose(
          blockRows('泡沫层分析', '01', [
            { k: '泡沫层厚度', u: 'mm', v: (d) => fmt(d.foam.thickness, 0), dot: (d) => d.foam.thickness > 2 ? 'ok' : 'idle' },
            { k: '泡沫流速', u: 'm/min', v: (d) => fmt(d.foam.flow, 2) },
            { k: '泡沫稳定性', u: '/100', v: (d) => fmt(d.foam.stability, 0), dot: (d) => d.foam.stability > 80 ? 'ok' : d.foam.stability > 0 ? 'warn' : 'idle' },
            { k: '泡沫层状态', v: (d) => d.foam.thickness > 2 ? '正常' : '未建立', dot: (d) => d.foam.thickness > 2 ? 'ok' : 'idle' },
          ]),
          blockBars('气泡尺寸分布', '02', [
            { k: '小气泡', v: (d) => d.foam.small, dp: 0 },
            { k: '中气泡', v: (d) => d.foam.mid, dp: 0 },
            { k: '大气泡', v: (d) => d.foam.large, dp: 0, tone: 'amber' },
          ]),
          blockColor('泡沫颜色指数', '03', (d) => d.foam.color),
          blockNote('视觉判读', '04', '小气泡占比越高，泡沫比表面积越大，锡矿物回收率越好。'),
        ),
      }

      case 'camera': return {
        left: compose(
          blockRows('设备信息', '01', [
            { k: '相机型号', v: (d) => d.camera.model },
            { k: '图像分辨率', v: (d) => d.camera.resolution },
            { k: '镜头焦距', u: 'mm', v: (d) => fmt(d.camera.focal, 0) },
            { k: '工作温度', u: '℃', v: (d) => fmt(d.camera.temp, 1), dot: (d) => d.camera.temp < 50 ? 'ok' : 'warn' },
          ]),
          blockRows('采集参数', '02', [
            { k: '当前帧率', u: 'fps', v: (d) => fmt(d.camera.fps, 1), dot: (d) => d.camera.fps > 20 ? 'ok' : 'idle' },
            { k: '曝光时间', v: (d) => d.camera.exposure },
            { k: '工作状态', v: (d) => d.camera.status, dot: (d) => d.camera.status === '采集中' ? 'ok' : 'idle' },
            { k: '安装位置', v: () => '槽体后右角 · 俯视' },
          ]),
          blockNote('安装说明', '03', '相机安装于浮选槽后右角 L 型支架，镜头俯视泡沫层中心区域。'),
        ),
        right: compose(
          blockRows('视觉分析输出', '01', [
            { k: '采集帧率', u: 'fps', v: (d) => fmt(d.camera.fps, 1), dot: (d) => d.camera.fps > 20 ? 'ok' : 'idle' },
            { k: '气泡识别数量', u: '个/帧', v: (d) => fmt(d.camera.bubbles, 0) },
            { k: '气泡尺寸均值', u: 'mm', v: (d) => fmt(d.camera.sizeMean, 2) },
            { k: '泡沫稳定性评分', u: '/100', v: (d) => fmt(d.camera.stability, 0), dot: (d) => d.camera.stability > 80 ? 'ok' : d.camera.stability > 0 ? 'warn' : 'idle' },
            { k: '图像置信度', u: '%', v: (d) => fmt(d.camera.confidence * 100, 1), dot: (d) => d.camera.confidence > 0.9 ? 'ok' : 'warn' },
          ]),
          blockChart('最近 30 秒帧率', '02', {
            hint: 'CAM-01 / FPS', slots: 60, min: 0, max: 35,
            values: () => sim.history,
            value: (d) => fmt(d.camera.fps, 1) + ' fps',
          }),
          blockBars('图像质量评分', '03', [
            { k: '稳定性', v: (d) => d.camera.stability, dp: 0 },
            { k: '置信度', v: (d) => d.camera.confidence * 100, dp: 0 },
          ]),
          blockNote('识别说明', '04', '气泡识别基于分水岭分割，置信度低于 90 % 时建议复核光源亮度。'),
        ),
      }

      case 'light': return {
        left: compose(
          blockRows('光源参数', '01', [
            { k: '光源类型', v: (d) => d.light.type },
            { k: '色温', u: 'K', v: (d) => fmt(d.light.cct, 0) },
            { k: '当前亮度', u: '%', v: (d) => fmt(d.light.brightness, 0), dot: (d) => d.light.brightness >= 55 && d.light.brightness <= 80 ? 'ok' : 'warn' },
            { k: '光源功耗', u: 'W', v: (d) => fmt(d.light.power, 0) },
            { k: '累计工作时间', u: 'h', v: (d) => fmt(d.light.hours, 0) },
          ]),
          blockBars('亮度水平', '02', [
            { k: '亮度输出', v: (d) => d.light.brightness, dp: 0 },
          ]),
          blockNote('使用说明', '03', '环形光源随相机安装，光锥覆盖槽内泡沫层中心区域。'),
        ),
        right: compose(
          blockRows('光照质量', '01', [
            { k: '光照均匀度', u: '%', v: (d) => fmt(d.light.uniformity, 1), dot: (d) => d.light.uniformity > 85 ? 'ok' : 'warn' },
            { k: '反光抑制等级', v: (d) => d.light.flare, dot: (d) => d.light.flare === '低' ? 'ok' : 'warn' },
            { k: '建议亮度区间', u: '%', v: (d) => `${d.light.recMin} – ${d.light.recMax}` },
            { k: '当前亮度', u: '%', v: (d) => fmt(d.light.brightness, 0) },
          ]),
          blockSlider('亮度调节', '02', {
            min: 20, max: 100,
            recMin: sim.data.light.recMin, recMax: sim.data.light.recMax,
            foot: '拖动滑条实时联动 3D 光源；建议保持在 55 – 80 % 区间。',
          }),
          blockNote('视觉影响', '03', '亮度偏低导致气泡边缘欠曝，偏高则泡沫表面反光，均会降低识别精度。'),
        ),
      }

      case 'scraper': return {
        left: compose(
          blockRows('运行参数', '01', [
            { k: '电机转速', u: 'rpm', v: (d) => fmt(d.scraper.rpm, 1), dot: (d) => d.scraper.rpm > 1 ? 'ok' : 'idle' },
            { k: '刮取周期', u: 's', v: (d) => fmt(d.scraper.period, 2) },
            { k: '刮板角度', u: '°', v: (d) => fmt(d.scraper.angle, 0) },
            { k: '电机电流', u: 'A', v: (d) => fmt(d.scraper.current, 2) },
            { k: '轴承温度', u: '℃', v: (d) => fmt(d.scraper.bearingTemp, 1), dot: (d) => d.scraper.bearingTemp < 60 ? 'ok' : 'warn' },
            { k: '运行状态', v: (d) => d.scraper.status, dot: (d) => d.scraper.status === '运行' ? 'ok' : 'idle' },
          ]),
          blockNote('机构说明', '03', '刮板轴沿 X 向布置，叶片扫过泡沫层后经前溜槽排出精矿。'),
        ),
        right: compose(
          blockRows('刮取产出', '01', [
            { k: '单次刮取量', u: 'kg', v: (d) => fmt(d.scraper.mass, 1) },
            { k: '泡沫排出速率', u: 'kg/min', v: (d) => fmt(d.scraper.rate, 1) },
            { k: '刮板磨损指数', u: '%', v: (d) => fmt(d.scraper.wear, 0), dot: (d) => d.scraper.wear > 60 ? 'warn' : 'ok' },
          ]),
          blockRing('维护倒计时', '02', {
            pct: (d) => clamp(d.scraper.maint / 500, 0, 1),
            main: (d) => fmt(d.scraper.maint, 0), u: 'h', sub: '距下次维护',
            foot: '磨损指数超过 60 % 时建议提前更换刮板叶片。',
          }),
          blockNote('排矿说明', '03', '刮板每 3.6 s 完成一个刮取循环，泡沫层越厚单次刮取量越大。'),
        ),
      }

      case 'valve': return {
        left: compose(
          blockRows('阀门状态', '01', [
            { k: '阀门开度', u: '%', v: (d) => fmt(d.valve.opening, 0), dot: (d) => d.valve.opening > 1 ? 'ok' : 'idle' },
            { k: '介质名称', v: (d) => d.valve.medium },
            { k: '介质流量', u: 'm³/h', v: (d) => fmt(d.valve.flow, 2) },
            { k: '阀位状态', v: (d) => d.valve.opening > 1 ? '开启' : '关闭', dot: (d) => d.valve.opening > 1 ? 'ok' : 'idle' },
          ]),
          blockBars('开度指示', '02', [
            { k: '阀门开度', v: (d) => d.valve.opening, max: 65, dp: 0 },
          ]),
          blockNote('执行机构', '03', '手轮式药剂阀由电动执行器驱动，加药阶段自动开启。'),
        ),
        right: compose(
          blockRows('加药参数', '01', [
            { k: '阀门开度', u: '%', v: (d) => fmt(d.valve.opening, 0), dot: (d) => d.valve.opening > 1 ? 'ok' : 'idle' },
            { k: '介质名称', v: (d) => d.valve.medium },
            { k: '介质流量', u: 'm³/h', v: (d) => fmt(d.valve.flow, 2) },
          ]),
          blockRing('开度指示', '02', {
            pct: (d) => clamp(d.valve.opening / 65, 0, 1),
            main: (d) => fmt(d.valve.opening, 0), u: '%', sub: '阀门开度',
          }),
          blockImpact('对浮选过程的影响', '03', (d) => d.valve.impact),
        ),
      }

      case 'pump': return {
        left: compose(
          blockRows('运行状态', '01', [
            { k: '出口压力', u: 'kPa', v: (d) => fmt(d.pump.pressure, 1), dot: (d) => d.pump.pressure > 10 ? 'ok' : 'idle' },
            { k: '供气流量', u: 'm³/h', v: (d) => fmt(d.pump.flow, 1) },
            { k: '电机电流', u: 'A', v: (d) => fmt(d.pump.current, 1) },
            { k: '电机温度', u: '℃', v: (d) => fmt(d.pump.temp, 1), dot: (d) => d.pump.temp < 80 ? 'ok' : 'warn' },
            { k: '累计运行', u: 'h', v: (d) => fmt(d.pump.hours, 0) },
            { k: '轴承振动', u: 'mm/s', v: (d) => fmt(d.pump.vibration, 2), dot: (d) => run() ? (d.pump.vibration < 4.5 ? 'ok' : 'warn') : 'idle' },
            { k: '运行状态', v: (d) => d.pump.status, dot: (d) => d.pump.status === '运行' ? 'ok' : 'idle' },
          ]),
          blockNote('设备说明', '03', '气泵出口软管接槽体左下布气主管，为浮选提供上升气流。'),
        ),
        right: compose(
          blockRows('供气与浮选关联', '01', [
            { k: '泡沫层影响', v: () => run() ? '强化' : '待机', dot: () => run() ? 'ok' : 'idle' },
            { k: '气路压差', u: 'kPa', v: (d) => fmt(d.pump.pressure * 0.18, 1) },
            { k: '建议压力区间', u: 'kPa', v: () => '60 – 75' },
            { k: '气泵能效比', u: 'm³/kWh', v: (d) => d.pump.current > 0.5 ? fmt(d.pump.flow / d.pump.current, 2) : '—' },
          ]),
          blockBars('气压 / 流量', '02', [
            { k: '出口压力', v: (d) => d.pump.pressure, max: 85, fmt: (v) => fmt(v, 1) + ' kPa' },
            { k: '供气流量', v: (d) => d.pump.flow, max: 70, fmt: (v) => fmt(v, 1) + ' m³/h' },
          ]),
          blockNote('关联说明', '03', '充气量不足将导致泡沫层变薄、回收率下降；压力过高易造成泡沫兼并。'),
        ),
      }

      case 'telescopic': return {
        left: compose(
          blockRows('执行状态', '01', [
            { k: '推杆行程', u: 'mm', v: (d) => fmt(d.telescope.stroke, 0), dot: (d) => d.telescope.stroke > 5 ? 'ok' : 'idle' },
            { k: '伸缩速度', u: 'mm/s', v: (d) => fmt(d.telescope.speed, 0) },
            { k: '液压压力', u: 'bar', v: (d) => fmt(d.telescope.pressure, 0) },
            { k: '限位状态', v: (d) => d.telescope.limit, dot: (d) => d.telescope.limit === '中间' ? 'ok' : 'warn' },
            { k: '循环次数', v: (d) => fmt(d.telescope.cycles, 0) },
            { k: '运行状态', v: (d) => d.telescope.status, dot: (d) => d.telescope.status === '运行' ? 'ok' : 'idle' },
          ]),
          blockBars('推杆行程', '02', [
            { k: '行程', v: (d) => d.telescope.stroke, max: 860, fmt: (v) => fmt(v, 0) + ' mm' },
          ]),
          blockNote('机构说明', '03', '立柱导轨驱动滑块升降，吸管随滑块做 5.6 s 周期往复运动。'),
        ),
        right: compose(
          blockRows('吸取作业', '01', [
            { k: '吸管浸入深度', u: 'mm', v: (d) => fmt(d.telescope.immersion, 0), dot: (d) => d.telescope.immersion > 100 ? 'ok' : 'idle' },
            { k: '吸取流量', u: 'L/min', v: (d) => fmt(d.telescope.flow, 1) },
            { k: '矿浆浓度', u: '%', v: (d) => fmt(d.telescope.solid, 1) },
            { k: '循环周期', u: 's', v: () => '5.6' },
          ]),
          blockRing('下一循环倒计时', '02', {
            pct: (d) => clamp(d.telescope.nextCycle / 5.6, 0, 1),
            main: (d) => fmt(d.telescope.nextCycle, 1), u: 's', sub: '下一循环',
            foot: '倒计时归零时吸管到达取样位，管口保持在液面以下。',
          }),
          blockNote('取样说明', '03', '吸管随伸缩机构同步运动，保持与夹持爪刚性连接。'),
        ),
      }

      case 'suctionPipe': return {
        left: compose(
          blockRows('管路参数', '01', [
            { k: '管径', u: 'mm', v: (d) => fmt(d.pipe.diameter, 0) },
            { k: '管材', v: (d) => d.pipe.material },
            { k: '浸入深度', u: 'mm', v: (d) => fmt(d.pipe.immersion, 0), dot: (d) => d.pipe.immersion > 100 ? 'ok' : 'idle' },
            { k: '管内流速', u: 'm/s', v: (d) => fmt(d.pipe.velocity, 2) },
            { k: '堵塞预警', v: (d) => d.pipe.clog, dot: (d) => d.pipe.clog === '正常' ? 'ok' : 'bad' },
            { k: '运行状态', v: (d) => d.pipe.status, dot: (d) => d.pipe.status === '运行' ? 'ok' : 'idle' },
          ]),
          blockNote('维护提示', '03', '每班次检查管口结垢，流速低于 1.2 m/s 时需反冲洗。'),
        ),
        right: compose(
          blockRows('吸取质量分析', '01', [
            { k: '矿浆密度', u: 'g/cm³', v: (d) => fmt(d.pipe.density, 2) },
            { k: '固体含量', u: '%', v: (d) => fmt(d.pipe.solid, 1), dot: (d) => d.pipe.solid > 20 ? 'ok' : 'warn' },
          ]),
          blockBars('固体含量水平', '02', [
            { k: '固体含量', v: (d) => d.pipe.solid, max: 60, dp: 1 },
          ]),
          blockRing('取样代表性', '03', {
            pct: (d) => clamp(d.pipe.rep / 100, 0, 1),
            main: (d) => fmt(d.pipe.rep, 0), u: '/100', sub: '取样代表性',
            foot: '评分低于 80 时建议提高吸管浸入深度重新取样。',
          }),
        ),
      }

      case 'vfd': return {
        left: compose(
          blockRows('电气参数', '01', [
            { k: '设定频率', u: 'Hz', v: (d) => fmt(d.vfd.setHz, 1) },
            { k: '输出频率', u: 'Hz', v: (d) => fmt(d.vfd.outHz, 1), dot: (d) => d.vfd.outHz > 1 ? 'ok' : 'idle' },
            { k: '输出电流', u: 'A', v: (d) => fmt(d.vfd.current, 1) },
            { k: '直流母线电压', u: 'V', v: (d) => fmt(d.vfd.dcBus, 0) },
            { k: '散热器温度', u: '℃', v: (d) => fmt(d.vfd.heat, 1), dot: (d) => d.vfd.heat < 60 ? 'ok' : 'warn' },
            { k: '运行状态', v: (d) => d.vfd.status, dot: (d) => d.vfd.status === '运行' ? 'ok' : 'idle' },
          ]),
          blockNote('设备说明', '03', '变频器安装于电气柜上部，面板朝向柜门；柜内下部为 PLC 模块。'),
        ),
        right: compose(
          blockCustom('驱动设备切换', '01', `<div class="seg" data-seg>
              <button type="button" data-drive="0">刮板电机</button>
              <button type="button" data-drive="1">气泵电机</button>
            </div><div class="note">切换查看柜内两路变频驱动输出。</div>`, (c) => {
            const btns = [...c.querySelectorAll('[data-drive]')]
            const paint = () => btns.forEach((b) => b.classList.toggle('on', Number(b.dataset.drive) === vfdDrive))
            btns.forEach((b) => b.addEventListener('click', () => { vfdDrive = Number(b.dataset.drive); paint() }))
            paint()
          }),
          blockRows('负载与能耗', '02', [
            { k: '驱动设备', v: () => vfdDrive ? '气泵电机' : (sim.data.vfd.drive || '刮板电机'), dot: () => 'ok' },
            { k: '负载率', u: '%', v: (d) => fmt(vfdDrive ? d.pump.current / 22.8 * 100 : d.vfd.load, 0), dot: (d) => (vfdDrive ? d.pump.current / 22.8 * 100 : d.vfd.load) > 85 ? 'warn' : 'ok' },
            { k: '输出频率', u: 'Hz', v: (d) => fmt(vfdDrive ? (run() ? d.vfd.setHz - 0.4 : 0) : d.vfd.outHz, 1) },
            { k: '输出电流', u: 'A', v: (d) => fmt(vfdDrive ? d.pump.current : d.vfd.current, 1) },
            { k: '累计能耗', u: 'kWh', v: (d) => fmt(d.vfd.energy, 1) },
            { k: '谐波畸变', v: (d) => d.vfd.thd, dot: (d) => parseFloat(d.vfd.thd) > 5 ? 'warn' : 'ok' },
          ]),
          blockFaults('故障码列表', '04', (d) => d.vfd.faults),        ),
      }

      case 'plc': return {
        left: compose(
          blockRows('控制器状态', '01', [
            { k: 'CPU 负载', u: '%', v: (d) => fmt(d.plc.cpu, 0), dot: (d) => d.plc.cpu < 70 ? 'ok' : 'warn' },
            { k: '扫描周期', u: 'ms', v: (d) => fmt(d.plc.scan, 1) },
            { k: 'I/O 使用率', u: '%', v: (d) => fmt(d.plc.io, 0) },
            { k: '通讯状态', v: (d) => d.plc.comm, dot: (d) => d.plc.comm === '正常' ? 'ok' : 'bad' },
            { k: '机架温度', u: '℃', v: (d) => fmt(d.plc.rackTemp, 1), dot: (d) => d.plc.rackTemp < 50 ? 'ok' : 'warn' },
          ]),
          blockBars('资源占用', '02', [
            { k: 'CPU 负载', v: (d) => d.plc.cpu, dp: 0 },
            { k: 'I/O 使用率', v: (d) => d.plc.io, dp: 0 },
          ]),
          blockNote('安装说明', '03', 'PLC 安装于电气柜下部，模块沿 X 向排列；透视模式下可观察内部。'),
        ),
        right: compose(
          blockRows('控制逻辑', '01', [
            { k: '运行模式', v: (d) => d.plc.mode, dot: () => 'ok' },
            { k: '联锁状态', v: (d) => d.plc.interlock, dot: (d) => d.plc.interlock === '正常' ? 'ok' : 'bad' },
            { k: '程序版本', v: (d) => d.plc.version },
          ]),
          blockAlarms('最近三条报警', '02', (d) => d.plc.alarms),
          blockNote('控制器提示', '03', 'PLC 处于自动模式，流程步序由联锁条件逐级放行。'),
        ),
      }

      default: return {
        left: compose(
          blockRows('部件信息', '01', [
            { k: '部件名称', v: () => partLabel(id) },
            { k: '部件编号', v: () => String(id).toUpperCase() },
            { k: '当前状态', v: () => run() ? '运行' : '待机', dot: () => run() ? 'ok' : 'idle' },
          ]),
          blockNote('提示', '02', '该部件暂无独立数据面板，可点击浮选槽、视觉相机或电气部件查看实时分析。'),
        ),
        right: compose(
          blockNote('分析输出', '01', '该部件暂无独立视觉分析数据。'),
        ),
      }
    }
  }

  // ------------------------------------------------------------------ selection / render
  function renderSelection() {
    bodyUpdaters = []
    const spec = selected ? buildPartSpec(selected) : buildSummarySpec()
    leftBody.innerHTML = spec.left.html
    rightBody.innerHTML = spec.right.html
    spec.left.bind(leftBody)
    spec.right.bind(rightBody)
    setText($id('left-tag'), selected ? String(selected).toUpperCase() : 'SUMMARY')
    setText($id('right-tag'), selected ? 'ANALYSIS' : 'VISION')
    $id('left-back').hidden = !selected
    leftBody.scrollTop = 0
    rightBody.scrollTop = 0
    for (const f of bodyUpdaters) f()
  }

  function setSelection(id) {
    const next = id || null
    if (next === selected) return
    selected = next
    renderSelection()
    if (next && isCompact()) openPane('left')
  }

  // ------------------------------------------------------------------ tick / init
  let acc = 0
  function tick(dt) {
    acc += dt
    if (acc < 0.1) return
    acc = 0
    chromeTick()
    for (const f of bodyUpdaters) f()
  }

  renderSelection()
  chromeTick()

  return {
    tick,
    setSelection,
    syncState: chromeTick,
    actionsDebug: (a) => actions.flow(a),
    get selected() { return selected },
  }
}
