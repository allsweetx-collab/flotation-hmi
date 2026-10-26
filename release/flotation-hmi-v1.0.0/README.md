# 有色冶金视觉浮选系统 · 3D 工业 HMI

> Non-ferrous metallurgy visual flotation system — a single-file, offline 3D industrial HMI built with Three.js.

面向锡石浮选工艺的 3D 实时监控界面：全部模型由代码程序化生成，全部贴图由 Canvas 在运行时绘制，构建产物是一个可直接双击打开的 HTML 文件，无网络请求、无外部资源、无需本地服务器。

- 渲染：Three.js r160（离线运行，构建时由本地 `node_modules` 解析）
- 构建：esbuild 打包 `src/main.js`，把 JS/CSS 内联进模板
- 产物：`flotation-hmi.html`（约 1 MB，单文件）
- 验收：Playwright 驱动的端到端检查，35 项全部通过

## 功能特性

**3D 场景（13 个部件，其中 12 个可拾取）**

| 部件 | 说明 |
|---|---|
| 浮选槽 `cell` | 2.0 × 1.7 m 槽体（高 1.8 m）、矿浆液面、泡沫层、检修格栅平台、液位刻度 |
| 刮板机构 `scraper` | 沿 X 向的轴 + 径向桨叶，扫过前侧泡沫带 |
| 精矿槽 `concentrate` | 紧贴前唇口的通长溜槽（2.06 × 0.36 m），接收刮出的泡沫 |
| 气泵 `pump` | 基座/泵体/电机/联轴器护罩/进出口法兰/压力表 |
| 伸缩机构 `telescopic` | 立柱、滑座、伸缩臂，行程 0–700 mm |
| 自动吸管 `suctionPipe` | 自精矿槽液面下取样，管口浸入 195–255 mm |
| 视觉相机 `camera` / 光源 `light` | L 型支架、镜头、环形光源与光锥 |
| 药剂阀 `valve` | 手轮 + 电动执行器 + 药剂管 |
| 电气柜 `cabinet` / 变频器 `vfd` / PLC `plc` | 柜体、柜内部件（透视模式下可查看/拾取） |
| 锡矿石 `ore` | 落料动画与液面飞溅 |

**工艺流程状态机**

`IDLE → FEEDING → FED → DOSING → DOSED → FLOTATING → (RESET)`

按钮带前置条件联锁：未投料时无法加药，未加药时无法启动浮选，乱序点击会被拦截并给出提示。

**动画与工艺表现**

- 泡沫从矿浆中生成：气泡在泡沫面鼓起、破裂，泡沫层厚度随充气量生长
- 泡沫面行进波朝 +Z，刮板旋转后把泡沫推向前唇口
- 泡沫经唇口泡沫舌 → 泡沫帘 → 落料泡沫团翻入精矿槽，槽内泡沫面内沿堆高并缓慢起伏
- 气泵联轴器旋转、伸缩臂周期取样、药剂阀开度变化、相机帧率与识别结果联动

**交互**

| 操作 | 效果 |
|---|---|
| 左键点选部件 | 左右面板切换为该部件的实时参数与视觉分析 |
| 点击空白处 / `Esc` | 取消选中，回到总览 |
| 顶栏「透视模式」 | 槽体/柜体半透明，可查看并拾取内部件（VFD、PLC） |
| 顶栏「剖切」/ 左下角滑条 | Z 向剖切，观察槽体与柜体内部结构 |
| 鼠标拖拽 / 滚轮 | 轨道相机旋转、缩放 |

**界面**

左侧「部件状态 · 实时参数」，右侧「视觉系统 · 分析输出」：气泡识别数、当量直径、泡沫稳定性、帧率曲线、刮取量、回收率、液位/槽容、运行日志等；在 1366×768 与 1920×1080 下均无面板横向溢出。

## 快速开始

### 直接运行

```powershell
Start-Process .\flotation-hmi.html
```

或双击 `flotation-hmi.html`。页面在 `file://` 下即可运行，无需服务器；推荐 Chrome / Edge 110+。

### 从源码构建

```powershell
# 安装依赖（仓库未提交 node_modules）
npm init -y
npm install three@0.160 esbuild

# 构建单文件产物
node build.mjs --out flotation-hmi.html

# 开发模式（不压缩，便于看堆栈）
node build.mjs --out out/dev.html --dev
```

> `build.mjs` 未指定 `--out` 时默认写到作者本机的绝对路径，因此建议始终显式传 `--out`。
> 构建时 `three` 由 Node 模块解析，需要仓库（或上层目录）存在 `three@0.160`。

### 截图与验收

```powershell
# 单张截图（--js 可在截图前执行调试命令）
node tools/shot.mjs flotation-hmi.html out/preview.png --wait 2.5
node tools/shot.mjs flotation-hmi.html out/run.png --wait 1 --js "__HMI.flow('feed')" --then 2

# 端到端验收（35 项：状态机、面板映射、真实点击拾取、透视、剖切、响应式、控制台错误）
node tools/acceptance.mjs flotation-hmi.html out/accept-final
```

验收与截图脚本依赖 Playwright 与本地 Chromium，可用环境变量 `PW_CHROME` 指定浏览器路径：

```powershell
$env:PW_CHROME = "C:\Program Files\Google\Chrome\Application\chrome.exe"
node tools/acceptance.mjs flotation-hmi.html out/accept-final
```

## 项目结构

```
flotation-hmi/
├─ flotation-hmi.html        # 构建产物（单文件，离线可运行）
├─ build.mjs                 # esbuild 打包 + 内联 CSS/JS → 单 HTML
├─ template.html             # HTML 骨架（CSS/JS 占位符）
├─ contract.md               # 施工契约：坐标、接口、验收基准
├─ src/
│  ├─ main.js                # 渲染器、灯光、拾取、选中、透视、剖切、主循环
│  ├─ world.js               # 部件注册、帧回调、标签、拾取、高亮
│  ├─ sim.js                 # 工艺状态机与只读数据源（供各部件读取）
│  ├─ hmi.js                 # 顶栏 + 左右面板的 DOM 渲染与事件
│  ├─ hmi.css                # HMI 视觉样式
│  ├─ kit/lab-kit.js         # 材质/几何工具库、环境光照、后处理
│  └─ parts/
│     ├─ external-a.js       # 浮选槽、液面、泡沫、平台、药剂阀、锡矿石
│     ├─ external-b.js       # 气泵、刮板机构、精矿槽
│     ├─ external-c.js       # 伸缩机构、吸管、视觉相机、光源
│     └─ cabinet.js          # 电气柜、变频器、PLC
└─ tools/
   ├─ shot.mjs               # 无头浏览器截图
   └─ acceptance.mjs         # 端到端验收（35 项）
```

`out/` 为本地调试产物（截图、临时构建、验收输出），不是运行所需文件。

## 实现要点

- **程序化建模**：`src/kit/lab-kit.js` 提供 `MAT.*` 材质与 `GEO.*` 几何工具；静态件按材质分桶合并成少量 Mesh，控制 draw call。
- **零外部资源**：所有贴图（泡沫、格栅、刻度、铭牌、警示、液位）用 `CanvasTexture` 程序生成。
- **动画约束**：几何/材质只在构建期创建；每帧仅在 `world.onFrame((dt, sim) => …)` 中更新矩阵、顶点或材质参数，动态实例用 `InstancedMesh` + `DynamicDrawUsage`。
- **数据与表现分离**：`sim.js` 是唯一数据源，各部件只读；HMI 面板按同一份数据渲染。
- **调试接口** `window.__HMI`：

| 接口 | 说明 |
|---|---|
| `stats()` | fps / parts / process / selected / xray / cut |
| `select(id)` | 选中部件（传 `null` 取消） |
| `flow('feed'\|'dose'\|'flotate'\|'reset')` | 触发流程步骤 |
| `xray(true/false)` | 透视模式 |
| `cut(0..1)` | Z 向剖切深度 |
| `view(az, el, dist)` | 设置相机方位角/仰角（度）/距离 |
| `screenOf(id)` / `pickAt(x, y)` | 部件屏幕坐标 / 屏幕点拾取 |

- **坐标基准**：浮选槽 x∈[-1,1]、z∈[-0.85,0.85]、y∈[0.55,2.35]，液面 y≈2.16；完整坐标与尺寸见 [contract.md](contract.md)。

## 环境要求

- Node.js 18+
- Chrome / Edge 110+（WebGL2）
- `three@0.160`、`esbuild`（构建）
- `playwright` + Chromium（仅截图与验收脚本需要）

## 许可证

本项目采用 [MIT License](LICENSE)。

第三方依赖：Three.js 遵循 MIT 许可证，esbuild 遵循 MIT 许可证，Playwright 遵循 Apache-2.0 许可证（仅用于测试脚本）。
