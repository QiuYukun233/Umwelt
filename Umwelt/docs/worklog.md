# Umwelt 工作日志

每天干了啥,按倒序记。目的:防止隔了几周回来忘记进度/半成品。

格式:每天一个 `## YYYY-MM-DD`,底下记「做了什么」「未完成/坑」「下一步」。
开工前先扫一眼最近几条,收工前补一条。

---

## 2026-05-20

**做了什么**
- 整天 brainstorming 一个大方向决策:**把神经编辑器从 HTML 迁到 Bevy,做成 3D Zach-like 工坊**。
  HTML 主世界继续承担蚂蚁涌现观察场,工坊导出的模块通过 JSON 装回 HTML 蚂蚁身上跑。
  长期愿景是全游戏迁 Bevy(包括主世界),HTML 是过渡。
- 一连串设计决策全部敲定:
  - 3D 空间范式 = **A · 解剖空间**(3D 视图就是器官本身,神经元放在解剖位置)。
  - 自由度 = **全 DIY**。系统只声明 I/O 契约,玩家任意决定骨架形态/感受器位置/神经元数量/
    投射范围/可塑性区域。不强迫做"一根触须"。
  - 物理约束 = 真实生物学(体积、代谢、传导速度、双侧 SNR)。数值采"**量级正确**"策略:
    用真实物理单位(μm³、pJ/spike、m/s),MVP 数值取真实昆虫数据的一个量级之内,
    常数集中带文献注释,后期精校只改数字不改单位制。
  - 关卡测试 = **C · 两段式**。Stage 1 静态 3D 浓度场探针(决定性、可重放);Stage 2
    动态竞技场(把器官装到测试蚂蚁,跑真实化学场轨迹)。共用同一个化学场仿真器。
  - MVP 作用域 = **B · 裸关卡 + 模块导出**。一关「化学定向器官」端到端可玩,通过后导出 JSON,
    HTML 能加载装到蚂蚁。**不**做关卡选择菜单、模块库、工坊壳 —— 先验证核心循环。
  - 工坊↔HTML 合约 = **A-lite**。只把"传导延迟"编译进 HTML 运行时(`edge.delay_ms`),
    体积/代谢预算在工坊阶段履行后丢掉。因为长期目标是全 Bevy,HTML 是临时,但
    距离→延迟这根诚实链不能丢(否则玩家在工坊调的近放远放装上后没区别)。
- 设计规格写完并提交 review:`docs/superpowers/specs/2026-05-20-bevy-workshop-design.md`。
- 顺手加了 `.superpowers/` 到 .gitignore(brainstorming visual companion 的 mockup 目录)。

**未完成 / 坑**
- 设计 spec 等用户最终 review。
- 进入 writing-plans 阶段,把"做什么"展开成"怎么做":Bevy 项目脚手架、化学场仿真器接口、
  第一关代码结构、HTML 侧 `edge.delay_ms` 的具体改动顺序。
- **昨天(05-15)那笔 UI 合并 + style.css 瘦身仍然没 commit、没浏览器实测**。今天整天在
  brainstorming,完全没碰那个。优先级现在被 Bevy 工坊压过去了,但那笔改动还挂在工作区,
  得在开始 Bevy 实现之前处理掉(要么验证后 commit,要么 stash,不能就这么悬着)。
- 设计 spec 里的"开放问题"清单(spec 第 8 节)在 writing-plans 阶段会被进一步收敛。

**下一步**
- 进 writing-plans 阶段,把 spec 第 6 节 MVP 作用域展开成实现计划:
  - Bevy 项目脚手架(spec 第 8 节开放问题:同一 repo 子目录?分仓?Rust workspace 怎么切?)
  - 化学场仿真器接口(Stage 1 静态 / Stage 2 动态共用一套)
  - 第一关 `chemotaxis-l1` 的代码层结构
  - HTML 侧 `edge.delay_ms` 改动顺序(NeuralGraph 边结构 + evaluator 环形缓冲 +
    schema v9 → v10 + 主世界"装载模块"入口)
- 收工前把 05-15 那笔挂着的 UI 合并 commit 了(fc2707d) —— 用户当天就实测过没问题,
  之前误以为没测。

**收工状态**
- `2377608` 今天的 brainstorming 产出:spec + worklog + .gitignore
- `fc2707d` 05-15 UI 合并 bundle(index 并入 observation,删 main.js + 4 个 ui/*,
  style.css 161→109)
- 工作区干净
- 明天从 writing-plans 阶段开始,先读 `docs/superpowers/specs/2026-05-20-bevy-workshop-design.md`,
  特别是第 6 节(MVP 作用域)和第 8 节(开放问题)。

---

## 2026-05-15

**做了什么**
- 排查「UI 怎么还是焦糖色」的疑惑。结论:4月的 UI 重构(实验器具风 / diegetic 研究无人机)
  **只覆盖了 `observation.html`**,主游戏页 `index.html` 仍是 fibra 时代的老 `src/style.css`
  (`--bg:#1a1410` 焦糖褐)。两套 UI 并存。
- 确认 4月重构的产物在 repo 里没丢:`src/design/`(design_tokens.md、CLAUDE.md、
  umwelt_observation.html 五块 artboard)+ `observation.html` + `src/ui/observation.js`
  + `src/design/observation.css`。
- `D:\dev\ant.html` / `braitenberg.html` 是更早的独立原型,未跟踪,不是那次重构。
- 新建本工作日志 `docs/worklog.md`。
- **合并 UI,砍掉焦糖色**:`observation.html` 的内容并入 `index.html`(入口指向
  `observation-app.js`),删 `observation.html`、`src/main.js`、`src/ui/{topbar,footer,
  death,sidebar}.js`(只有 main.js 引用)。修了 schema.js / observation-app.js 里
  指向已删文件的过时注释。`vite build` 通过,save-load 26 / batch-parity 20 /
  multi-ant-smoke 25 全绿。

- **清理 `src/style.css` 焦糖遗留**:161 → 109 行。删掉自己的 `:root` 焦糖 token、
  `[data-theme="light"]`、焦糖 `body` 背景,以及所有已随旧 UI 删掉的 chrome 选择器
  (topbar / sidebar / footer / death-card / state / env / log 等)。只留:神经编辑器
  overlay、body editor、connection inspector、sensor-map 的 proprio/3D 视图,加
  `.btn`/`.mono` 工具类。token 现在全部来自 `observation.css` 的 legacy-token 块
  (那块 4月就建好了,把 `--surface`/`--amber`/... 映射到新调色板)。
  字体引用从 `"IBM Plex Sans/Mono"`(index.html 已不再加载)换成 design token
  `var(--font-ui)` / `var(--font-mono)`(Inter / JetBrains Mono)。
  `vite build` 通过,三套测试仍全绿。

**未完成 / 坑**
- Feature 2 主体已完成但**浏览器 UI 未手测**(见 2026-05-14)。本次 UI 合并 + style.css
  瘦身也都没手测 —— 需开 `index.html` 验:观察 HUD 正常、打开神经编辑器是新调色板、
  body editor / connection inspector 正常。
- 编辑器 overlay 里若有中文标签,`var(--font-ui)`(Inter)不含 CJK,可能 fallback。
  目前 index.html 里编辑器静态文案已是英文,但 body-editor.js 动态渲染的文案待确认。

**下一步**
- 浏览器实测合并 + 瘦身后的 `index.html`。
- 继续 roadmap:地图编辑器(feature-2-scope.md 第 2 步)。

**收工状态(未提交)**
今天的改动**还没 commit**,留着等浏览器实测。工作区:`index.html` / `src/style.css` /
`src/io/schema.js` / `src/observation-app.js` 改动,删了 `observation.html` +
`src/main.js` + `src/ui/{topbar,footer,death,sidebar}.js`,`docs/worklog.md` 新增。
明天:先 `npm run dev` 验一轮 → 没问题就把「UI 合并 + style.css 瘦身」一起 commit。

---

## 2026-05-14

**做了什么** — Feature 2 主体(多蚂蚁批处理),4 个 commit:
- `323f0ee` 批处理求值器 `src/neural/batch.js`(Topology + BatchState + stepBatch),
  与 `NeuralGraph.computeSignals` bit 级对齐。parity 测试 20/20。
- `201d336` `world.js` 重构:`ants[]` 为权威数据,`focusedAnt` getter,`spawnAnts` /
  `killAnt`,逐蚂蚁死亡。smoke 测试 25/25。
- `2882404` 存档 schema 升到 v9(`ants[]` + `focusedAntId` + `nextAntId` + `map` 块),
  迁移链 v8→v9。save-load 测试 26/26。
- `61a4976` `main.js` / `observation-app.js` 接入 `stepBatch`。

**未完成 / 坑**
- 浏览器 UI 未手测。建议验:默认电路下蚂蚁会动 / 侧栏边信号实时刷新 / 加删节点不崩 /
  存档刷新恢复 / 死亡 overlay。
- `test-neural.mjs` 预先就坏的(`composeSourceOutputs` 参数形状不对),非本次引入,未修。

---

## 2026-04-23

- `743e8ee` world.js 引入 `ants[]` 镜像 + `focusedAnt` getter(Feature 2 Step 1 铺垫)。
- `48f18f5` / `1328a36` .gitignore 与 .claude/settings.json 维护。

## 2026-04-22

- `c897d19` 带版本号的存档/读档(schema v8),序列化世界状态。
- `b967566` main 与 observation 两个入口走共享的 `src/io/schema.js` 模块。

## 2026-04-19

- `8e6c29d` 项目改名 fibra → Umwelt,迁入蚂蚁神经沙盒本体。
- `3cca01a` + `5dd8b5b` **观测无人机 UI 子系统**:`src/design/` 设计系统、
  `observation.html` 研究站台风页面、播放控件。← 即「实验器具风」UI 重构,仅覆盖观察页。
- 可塑突触整条链:`6a43319` 数据模型+常量 → `0a2b16e` 调制 Hebbian 更新 →
  `98fb68a` 存档迁移 → `4fd27cf` 连接检查器 UI → `001c9ef` 渲染区分 →
  `c7b7c29` 涌现测试(ChemC→turn_L 关联学习) → `94e74cc` 文档。
- `d050745` 修复:环境重建时清化学场。

## 2026-04-16

- `cb53d1f` 重写 README。

## 2026-03-26

- `3e1193f` 初始提交。

<!-- 注:2026-05-15 之前的条目是事后从 git log 重建的,可能不全;此后为实时记录。 -->
