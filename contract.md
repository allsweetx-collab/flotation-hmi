# 有色冶金视觉浮选系统 · 3D 工业 HMI — 施工契约

单文件离线网页：`F:\DshWorkSpace\flotation-hmi.html`（构建产物）。源码在 `F:\DshWorkSpace\flotation-hmi`。
禁止联网、禁止外部资源（three@0.160 已本地 vendored）。所有贴图用 CanvasTexture 程序生成。
配色与美术基准见第 8 节；所有改动都要用截图自查。

## 0. 构建 / 截图 / 调试（每个成员必须会）

```powershell
cd F:\DshWorkSpace\flotation-hmi
node build.mjs --out out/<你的名字>.html --dev      # 打包（约 1–2 s），不要写最终根目录文件
node tools/shot.mjs out/<你的名字>.html out/<你的名字>.png --wait 2.5
node tools/shot.mjs out/<你的名字>.html out/<名字>_run.png --wait 1 --js "__HMI.flow('feed')" --then 2
node tools/shot.mjs out/<你的名字>.html out/x --steps steps.json   # steps: [{"js":"__HMI.select('pump')","wait":1,"out":"out/pump.png"}]
```

`window.__HMI` 调试接口：
- `__HMI.stats()` → fps / parts / tris / calls / process / selected
- `__HMI.select(id)`、`__HMI.flow('feed'|'dose'|'flotate'|'reset')`
- `__HMI.xray(true/false)`、`__HMI.cut(0..1)`、`__HMI.view(az, el, dist)`
页面在 `file://` 下打开，无需服务器。构建后必须 **0 控制台报错/警告（three 的 deprecation 除外）**。

## 1. 场景坐标（米制，Y 向上，地面 y=0）— 不可改，所有部件必须与此对齐

| 对象 | 世界坐标/尺寸 |
|---|---|
| 浮选槽外壳 | x ∈ [-1.0, 1.0]，z ∈ [-0.85, 0.85]，y ∈ [0.55, 2.35]；壁厚 0.045，顶部开口 |
| 矿浆液面 | y ≈ 2.16（动画中 ±0.01），槽内水平面 1.88 × 1.58 |
| 泡沫层 | 液面之上，厚度视觉 0.02–0.075（数据 0–42 mm） |
| 支撑腿/平台 | 腿 y 0→0.55，四角；格栅检修平台在槽体周围 y≈0.04–0.58 |
| 气泵 | 基座中心约 (-2.02, 0, -0.35)，总高约 1.1，出口软管接槽体左下 |
| 伸缩机构立柱 | 约 (-0.88, 0.55, -0.78)，导轨 y 0.55→3.5；滑块 y 2.35→3.5 |
| 自动吸管 | 从伸缩机构末端（约 (-0.75, 2.75, 0.2)）斜插入液面约 (-0.62, 2.16, 0.35)，管口浸入 150–420 mm |
| 视觉相机 | 头部中心约 (0.62, 3.12, -0.18)，镜头朝下对准 (0.3, 2.2, 0.1) 泡沫；L 型支架接槽体后右角 |
| 打光装置 | 环形光源随相机，光锥照到泡沫面 |
| 刮板 | 轴沿 X 向，位于 (0, 2.47, 0.30)，跨度约 2.3 m；叶片扫过泡沫层，前方 z≈0.9 有接矿溜槽 |
| 药剂阀 | 约 (-1.16, 1.52, 0.35)，手轮 + 药剂管插入槽内 |
| 电气柜 | 柜体中心 (2.15, 0, 0.27)，外形 1.0 w × 1.92 h × 0.56 d，柜门朝 +Z；门面 z≈0.56 |
| 变频器 | 柜内上部（约 y 1.30），面板朝 +Z；PLC 在柜内下部（约 y 0.64），模块沿 X 排列 |
| 锡矿石 | 从 (0.15, 3.4, 0.15) 落入液面 |

默认相机：position (5.5, 3.7, 7.7)，target (-0.05, 1.42, 0.02)，FOV 35。重要观察区为画面中央约 60% 宽度。

## 2. 代码接口

### 2.1 部件注册（`src/world.js` 提供）
```js
world.addPart(id, group, {
  label: '排障用名称',
  htmlLabel: '变频器 · 37 kW',      // 选中时跟随 3D 投影的小标签，内部件必填
  internal: true,                   // 电气柜内部件：透视模式才可拾取
  pickable: true,                   // false = 装饰件（矿石、柜体等）
  anchor: [x, y, z],                // 标签锚点，世界坐标
  bounds: [[minX,minY,minZ],[maxX,maxY,maxZ]], // 仅 cell / cabinet：剖切边缘线用
  xrayMats: [mat...],               // 透视时变半透明的材质（0.25, depthWrite=false）
  cutMats: [mat...],                // 剖切时被 clipping plane 切掉的材质
})
world.onFrame((dt, sim) => { ... }) // 每帧；dt 秒。不要在里面 new 几何/材质
world.root                            // 所有部件挂到这个 Group
```
- 每个 part 独立 `THREE.Group`，`userData.partId` 会自动打给所有子 Mesh；不要手工覆盖 partId 为别的 id。
- 材质按部件创建，不要跨部件共享可变材质（否则高亮/透视会串）。
- 选中高亮由根级 OutlinePass 完成，部件无需处理。

### 2.2 数据源 `sim`（`src/sim.js`，只读；不要修改 sim.js）
```js
sim.process      // 'IDLE' | 'FEEDING' | 'FED' | 'DOSING' | 'DOSED' | 'FLOTATING'
sim.t            // 秒
sim.lock         // 过渡动画中
sim.lightLevel   // 0..100（右侧光源滑条控制）
sim.anim = {
  ore, oreOn, splash, dose, doseOn,
  foam,          // 0..1 泡沫层存在度
  foamAmp,       // 0.012..0.04
  liquidTint,    // 0..1 加药后矿浆色变
  pump,          // 0..1 气泵运行度（含启停缓动）
  pumpShaft,     // 弧度，联轴器/轴转角
  scraperSpeed,  // rad/s（0 = 停）
  scraperAngle,  // rad，累积
  telescopePhase,// 0..1 循环相位（5.6 s）
  telescopeStroke, // 0..1 行程
  cameraBlink, cameraRate,
  valve,         // 0..1 加药阀开度
  bubble,
  pulse: { [partId]: 0..1 }  // 点击部件后的 1.4 s 响应包络，sim.pulseOf(id)
}
sim.data = {
  cell:{level mm,temp ℃,air m³/h,pressure kPa,ph},
  foam:{thickness mm,small%,mid%,large%,flow m/min,color[r,g,b],stability},
  camera:{model,resolution,fps,exposure,temp ℃,focal mm,bubbles 个/帧,sizeMean mm,stability,confidence 0..1,status},
  light:{type,cct K,brightness %,power W,hours h,uniformity %,flare,recMin,recMax},
  scraper:{rpm,period s,angle °,current A,bearingTemp ℃,mass kg,rate kg/min,wear %,maint h,status},
  pump:{pressure kPa,flow m³/h,current A,temp ℃,hours h,vibration mm/s,status},
  telescope:{stroke mm,speed mm/s,pressure bar,limit,cycles,immersion mm,flow L/min,density g/cm³,solid %,nextCycle s,status},
  pipe:{diameter mm,material,immersion mm,velocity m/s,clog,density,solid,rep,status},
  vfd:{setHz,outHz,current,dcBus,heat,status,load,energy,thd,faults[],drive},
  plc:{cpu,scan,io,comm,rackTemp,mode,interlock,version,alarms[{time,code,text}]},
  valve:{opening %,medium,flow m³/h,impact},
  ore:{batch,mass,grade,time}, dose:{agent,dosage,time,stir},
  top:{currents[3],status,runtime},
}
```
动画状态一律来自 `sim.anim` / `sim.process`；点击只允许通过 `sim.pulseOf(id)` 做 1–2 s 的“响应”加速/指针抖动，**不得改变运行/停止状态**（流程状态机控制）。

### 2.3 每个部件必须使用的 partId
`cell`, `camera`, `light`, `scraper`, `valve`, `pump`, `telescopic`, `suctionPipe`, `vfd`, `plc`, `ore`（`ore` pickable:false 也可）。

## 3. 美术基准（重要，截图必须达到）
- 深色工业风：炭黑/深灰背景，冷白主光（0xd8e6ff）+ 暖色补光（0xffc99a）+ 青绿状态色 `#3fe0c5`、琥珀 `#ffb84d`、报警红 `#ff5a4d`。
- 材质用 `MAT.*` 预设（PBR），颜色注意是 **线性 albedo**：想要 sRGB 约 0.2 的深灰，线性值要 0.03–0.05；不要用 0.5 这类亮灰做大面积外壳。
- 外壳：磨砂金属（roughness 0.4–0.6，metalness 0.7–0.9）；相机哑光黑 roughness≈0.9；光源用 MeshBasicMaterial 发光；泡沫浅米色略透明；观察窗半透明；矿石灰褐带金属光泽。
- 禁止：真实照片贴图、夸张粒子、卡通圆角、彩虹渐变、自动旋转相机。
- 细节：法兰螺栓、散热筋、面板缝、警示标识（CanvasTexture 文字）、管线接头、地脚螺栓 —— 近距离截图要经得起看。
- 性能：每个模块三角面 ≤ 120k；共享几何/材质；只给主要轮廓 castShadow，地面/平台 receiveShadow。
- 每个部件都要有“真实设备”的完整结构：不能是孤立的盒子，要有机架、法兰、线缆、支架与地面/槽体的连接，不得悬空/穿模。

## 4. 流程与联动
`sim.process` 状态机由根级驱动；部件只读。要求：
- IDLE/FED/DOSED：气泵、刮板、伸缩、吸管、视觉数据均为待机（0 值/待机态）。
- FLOTATING：气泵 → 联轴器旋转、压力表指针抬升并随 `sim.data.pump.pressure` 微动、壳体极小幅高频振动；伸缩机构按 5.6 s 周期运动；吸管随动且保持与夹持爪刚性连接、不穿模、管口始终在液面下；刮板旋转；泡沫从无到有 ~2 s 增厚并按正弦波动；相机 LED 快速闪烁、视觉光锥增强。
- FEEDING：矿石下落 ~1.5 s，0.7 处触发溅射/液面扰动。
- DOSING：阀门手轮旋转、药剂注入细流、液面/矿浆轻微色调变化。
- 复位：泡沫淡出、泵/刮板/伸缩停止、吸管抬起，所有件回待机。

## 5. 工作纪律
- 只修改分配给你的文件；**不要改** `src/main.js`、`src/world.js`、`src/sim.js`、`src/hmi.js`、`src/hmi.css`、`template.html`、`build.mjs`、`tools/`（HMI 成员拥有 hmi.js/hmi.css）。
- 需要根级新增字段/回调时，发消息给 lead，不要直接改。
- 每次完成一个阶段：build → shot → 看图 → 修 → 再 shot，至少 3 轮。
- 完成后汇报：改了哪些文件、截图路径、已验证项、遗留问题、需要 lead 配合的点。
- 所有 UI 文本用中文；代码注释可中英混合。
- 不要运行涉及最终 `F:\DshWorkSpace\flotation-hmi.html` 的构建，避免与 lead 冲突；只构建 `out/*.html`。
