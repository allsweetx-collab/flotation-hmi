// Scene registry, selection, x-ray, cut plane and floating HTML labels.
import * as THREE from 'three'
import { MAT, GEO, clamp, lerp } from './kit/lab-kit.js'

export function createWorld(scene, labelHost) {
  const root = new THREE.Group()
  root.name = 'flotation-root'
  scene.add(root)

  const world = {
    THREE, MAT, GEO, scene, root,
    sim: null,
    parts: new Map(),
    externalGroups: [],
    internalGroups: [],
    updates: [],
    xrayMats: [],
    cutMats: [],
    cutBoxes: [],
    xrayOn: false,
    cutValue: 0,
    selected: null,
    onSelect: null,
    cutPlane: new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5),
    cutFrame: null,
    dashed: null,
    labels: new Map(),
  }

  // ---------------------------------------------------------------- registry
  world.addPart = (id, group, opts = {}) => {
    group.userData.partId = id
    group.name = group.name || id
    const entry = {
      id, group,
      label: opts.label || id,
      htmlLabel: opts.htmlLabel || '',
      internal: !!opts.internal,
      pickable: opts.pickable !== false,
      anchor: opts.anchor ? new THREE.Vector3(...opts.anchor) : null,
      bounds: opts.bounds || null,
    }
    group.traverse((o) => { if (o.isMesh) o.userData.partId = id })
    if (entry.pickable) (entry.internal ? world.internalGroups : world.externalGroups).push(group)
    world.parts.set(id, entry)
    for (const m of opts.xrayMats || []) world.registerXrayMat(m)
    for (const m of opts.cutMats || []) world.registerCutMat(m)
    if (entry.bounds) world.cutBoxes.push({ id, box: new THREE.Box3(new THREE.Vector3(...entry.bounds[0]), new THREE.Vector3(...entry.bounds[1])) })
    return entry
  }
  world.registerXrayMat = (m) => {
    if (!m || m.userData.__xrayBase) return m
    m.userData.__xrayBase = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }
    world.xrayMats.push(m)
    return m
  }
  world.registerCutMat = (m) => {
    if (!m || m.userData.__cutBase) return m
    m.userData.__cutBase = { clippingPlanes: m.clippingPlanes, clipShadows: m.clipShadows }
    world.cutMats.push(m)
    return m
  }
  world.onFrame = (fn) => { world.updates.push(fn); return fn }
  const meshVisible = (o) => {
    for (let p = o; p; p = p.parent) if (p.visible === false) return false
    return true
  }
  world.pick = (raycaster) => {
    const hit = (groups) => {
      const hits = raycaster.intersectObjects(groups, true)
      for (const h of hits) {
        if (!meshVisible(h.object)) continue
        const p = world.parts.get(h.object.userData.partId)
        if (p) return { part: p, point: h.point, distance: h.distance }
      }
      return null
    }
    if (world.xrayOn || world.cutValue > 0.001) {
      const inner = hit(world.internalGroups)
      if (inner) return inner
    }
    return hit(world.externalGroups)
  }

  // ---------------------------------------------------------------- x-ray
  world.setXray = (on) => {
    on = !!on
    if (on && world.cutValue > 0) world.setCut(0)
    if (on === world.xrayOn) {
      if (on) refreshDashed()
      return
    }
    world.xrayOn = on
    for (const m of world.xrayMats) {
      const b = m.userData.__xrayBase
      if (on) { m.transparent = true; m.opacity = 0.25; m.depthWrite = false }
      else { m.transparent = b.transparent; m.opacity = b.opacity; m.depthWrite = b.depthWrite }
      m.needsUpdate = true
    }
    if (world.selected && world.selected.internal && !on) world.select(null)
    if (on) refreshDashed()
    if (world.dashed) world.dashed.visible = on
    for (const l of world.labels.values()) l.hidden = on ? l.hidden : true
    world.updateLabels()
    return on
  }

  // ---------------------------------------------------------------- cut plane
  world.setCut = (v) => {
    v = clamp(v, 0, 1)
    if (v > 0.001 && world.xrayOn) world.setXray(false)
    world.cutValue = v
    const cutting = v > 0.001
    for (const m of world.cutMats) {
      const b = m.userData.__cutBase
      m.clippingPlanes = cutting ? [world.cutPlane] : b.clippingPlanes
      m.clipShadows = cutting ? true : b.clipShadows
      m.needsUpdate = true
    }
    if (!world.cutFrame) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(256 * 3), 3))
      const mat = new THREE.LineBasicMaterial({ color: 0x5ff5dc, transparent: true, opacity: 0.95, toneMapped: false })
      world.cutFrame = new THREE.LineSegments(g, mat)
      world.cutFrame.frustumCulled = false
      world.cutFrame.renderOrder = 12
      scene.add(world.cutFrame)
    }
    world.cutFrame.visible = cutting
    return v
  }
  function boxPlanePolygon(box, plane) {
    const pts = []
    const corners = []
    for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z))
    const edges = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    const d = corners.map((c) => plane.distanceToPoint(c))
    for (const [a, b] of edges) {
      const da = d[a], db = d[b]
      if (da === 0) pts.push(corners[a].clone())
      if (da * db < 0) {
        const t = da / (da - db)
        pts.push(corners[a].clone().lerp(corners[b], t))
      }
    }
    // unique
    const uniq = []
    for (const p of pts) if (!uniq.some((q) => q.distanceToSquared(p) < 1e-8)) uniq.push(p)
    if (uniq.length < 3) return []
    const c = uniq.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / uniq.length)
    const n = plane.normal.clone().normalize()
    const u = new THREE.Vector3(1, 0, 0)
    if (Math.abs(n.dot(u)) > 0.9) u.set(0, 0, 1)
    const v = new THREE.Vector3().crossVectors(n, u).normalize()
    u.crossVectors(v, n).normalize()
    uniq.sort((p, q) => Math.atan2(p.clone().sub(c).dot(v), p.clone().sub(c).dot(u)) - Math.atan2(q.clone().sub(c).dot(v), q.clone().sub(c).dot(u)))
    return uniq
  }
  world.updateCut = (camera, target) => {
    if (world.cutValue <= 0.001) return
    const v = world.cutValue
    const n = new THREE.Vector3().subVectors(camera.position, target)
    n.y = 0
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1)
    n.normalize()
    const s = lerp(1.45, -0.18, v)
    const c = n.dot(target) + s
    world.cutPlane.normal.copy(n).negate()
    world.cutPlane.constant = c
    // edge outline: intersections of each registered cut box with the plane
    const pos = []
    const plane = new THREE.Plane().setComponents(world.cutPlane.normal.x, world.cutPlane.normal.y, world.cutPlane.normal.z, world.cutPlane.constant)
    for (const { box } of world.cutBoxes) {
      const poly = boxPlanePolygon(box, plane)
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length]
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }
    const arr = world.cutFrame.geometry.attributes.position
    if (pos.length / 3 > arr.count) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pos), 3))
      world.cutFrame.geometry.dispose()
      world.cutFrame.geometry = g
    } else {
      arr.array.fill(0)
      for (let i = 0; i < pos.length; i++) arr.array[i] = pos[i]
      arr.needsUpdate = true
      world.cutFrame.geometry.setDrawRange(0, pos.length / 3)
    }
    // cut frame is already world space (BufferGeometry identity)
  }

  // ---------------------------------------------------------------- dashed x-ray boxes
  function refreshDashed() {
    if (world.dashed) { world.dashed.visible = world.xrayOn; return }
    const group = new THREE.Group()
    group.visible = world.xrayOn
    scene.add(group)
    for (const p of world.parts.values()) {
      if (!p.internal) continue
      const box = new THREE.Box3().setFromObject(p.group)
      if (box.isEmpty()) continue
      box.expandByScalar(0.03)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const bg = new THREE.BoxGeometry(size.x, size.y, size.z)
      const eg = new THREE.EdgesGeometry(bg)
      bg.dispose()
      const mat = new THREE.LineDashedMaterial({ color: 0xffb84d, dashSize: 0.055, gapSize: 0.035, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false })
      const line = new THREE.LineSegments(eg, mat)
      line.computeLineDistances()
      line.position.copy(center)
      line.renderOrder = 20
      group.add(line)
    }
    world.dashed = group
  }

  // ---------------------------------------------------------------- selection + labels
  world.select = (partOrId) => {
    let part = partOrId
    if (typeof partOrId === 'string') part = world.parts.get(partOrId) || null
    if (part === world.selected) { if (part) world.updateLabels(); return part }
    world.selected = part || null
    if (world.selected) {
      const p = world.selected
      if (p.htmlLabel) {
        let el = world.labels.get(p.id)
        if (!el) {
          el = document.createElement('div')
          el.className = 'part-label'
          labelHost.appendChild(el)
          world.labels.set(p.id, el)
        }
        el.textContent = p.htmlLabel
        el.hidden = false
        el.dataset.target = p.id
      }
    }
    for (const [id, el] of world.labels) {
      if (!world.selected || id !== world.selected.id) el.hidden = true
    }
    world.updateLabels()
    if (world.onSelect) world.onSelect(world.selected)
    return world.selected
  }
  const _v = new THREE.Vector3()
  world.updateLabels = (camera) => {
    if (!world.selected) return
    if (!camera) return
    const p = world.selected
    const el = world.labels.get(p.id)
    if (!el) return
    if (p.internal && !world.xrayOn && world.cutValue <= 0.001) { el.hidden = true; return }
    let anchor = p.anchor
    if (!anchor) {
      const box = new THREE.Box3().setFromObject(p.group)
      anchor = box.getCenter(new THREE.Vector3())
      anchor.y = box.max.y + 0.12
    }
    _v.copy(anchor).project(camera)
    const behind = _v.z > 1
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth
    const y = (-_v.y * 0.5 + 0.5) * window.innerHeight
    el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${(y - 10).toFixed(1)}px)`
    el.hidden = behind
  }

  world.update = (dt) => {
    for (const fn of world.updates) {
      try { fn(dt, world.sim) } catch (e) { console.error('part update', e) }
    }
  }
  return world
}
