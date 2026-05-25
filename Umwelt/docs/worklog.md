# Umwelt 工作日志

每天干了啥,按倒序记。目的:防止隔了几周回来忘记进度/半成品。

格式:每天一个 `## YYYY-MM-DD`,底下记「做了什么」「未完成/坑」「下一步」。
开工前先扫一眼最近几条,收工前补一条。

---

## 2026-05-26

**做了什么**
- **C-2(布线 / 边模型)brainstorm + spec v0.1 → v0.2**,全程对照 `umwelt_design_constitution.md`。
  - Brainstorm 起点是 "C-2 之前先定神经元身份"(worklog 2026-05-24 列的 #1)。先讨论 coord-as-id vs 显式 NeuronId,选 coord-as-id。
  - 随后讨论 via 语义,用户给了关键论证:**离散网格上 cell 是位置原子单位,"同一格"= 同一位置,几何重合即电学连接;"同格信号独立"是自相矛盾的;格子稀缺性是布线谜题的灵魂**。via 唯一可行 = 每边私有路径段。已存为 memory `umwelt-grid-atomicity`。
  - 接着摊开"边端点标识 + 完整性策略"二维空间(F1–F4 × I1–I5),正在 brainstorm 边的本体论(衍生 vs 一等公民)时,用户指回 `umwelt_design_constitution.md` —— 宪法已经把端点形式、完整性、cascade 非对称、replace_kind、undo P0、no-Via、no-overlap、tree-forbids-join、One d per edge 全部钉死。我之前一长串其实是在重新发明宪法已写过的东西。已存 memory `umwelt-design-constitution` 作为下次的 reference 入口。
  - **新 load-bearing 设计**(宪法本轮新增 §2 行 30–31、§3 行 42–43):edge 是 cell 树(F4 推广 path→tree);tree 单 parent 结构性禁止 join,不需要 runtime 检查;MVP 把树突塌进 soma,fan-in 通过 ~6 邻格自然受限,要更多就用中继神经元搭漏斗(同型于自搭 OFF-cell);删 source = 整树,删 leaf = 剪到最近 fork。
- **C-2 spec v0.1 草稿写完**,commit `34a4969`。
- **收到 review 回执,定 v0.2 多处必改 + locked-in 决定**,commit `e502cad`:
  - **单值索引 bug 修正**:v0.1 让 `cell_to_edge` 单值索引覆盖所有 edge cells(含神经元端点)→ 三神经元链 S→I→M 中 I 不能同时作 E1 叶 / E2 根 → 整条链建不出来。修正:`cell_to_edge` 只索引**线格**,加 `endpoint_to_edges: HashMap<CellCoord, SmallVec<EdgeId>>` 多值反查端点。
  - **Via 改隐式**:删 `CellContents::Via`,删 `PathThroughEmpty` 错误,穿 `Empty` 合法(自动当作 via 段);C-1 已落地代码要同步改 —— 作为 C-2 实现计划的 task 0。
  - **Modulator 失效定为降级**(不级联):plastic→false, mod_source→None, 拓扑不动。
  - **PathTree 改单一扁平表示**(不要两变体 enum),is_path() 是查询非存储形态。
  - **EdgeOps 作为唯一入口**:Grid 的 neuron mutator 改 `pub(crate)`,routes 与 grid 同 crate(`grid_workshop/src/routing/`)—— 结构性禁止绕过级联。
  - **~6 fan-in 上限明文化为有意约束**(宪法 §2 honest simplification);prop test 必须覆盖"一个神经元被 ≥2 条边当端点"。

**未完成 / 坑**
- spec v0.2 已 review 通过,但 **C-2 实现计划(writing-plans)还没写**。下次开机第一件事。
- C-1 改动(删 `CellContents::Via`)是 C-2 task 0 阻塞,实现计划要把这条排在最前。
- C-4 的两条 hand-off 别丢:
  1. 边降级时学到的权重 —— 冻结当前值 vs 弹回 `w_init`?
  2. 权重持久化归属(C-2 的 `Edge` 故意不存权重,这是求值层的事)。

**下一步(明日接)**
1. 基于 spec v0.2 走 `writing-plans` 流程,写 C-2 实现计划到 `docs/superpowers/plans/2026-05-26-bevy-subsystem-c2-routing.md`(或 27,看明天日期)。
2. 计划必含 **task 0 — 改 C-1**:删 `CellContents::Via` 变体,更新已落地的 `grid_workshop` crate + 在 C-1 plan 文档加注"v0.2 起 Via 作废"。
3. 计划主体:`PathTree`(扁平 cells+parent)→ `Edge` + `PathEndpoint` newtype → `Routes`(双索引)→ `EdgeOps`(唯一入口,Grid mutator 私有化)→ `RoutesPlugin` + gizmo 渲染 → `routing_demo` example → 测试三件套(单元、smoke、prop test 含"神经元多边端点"用例)。
4. 实现走 subagent-driven 流(同 B、C-1 节奏)。

**新存的 memory**(下次自动加载)
- `umwelt-grid-atomicity` — 格是位置原子,几何重合即电学连接;格子稀缺性是谜题灵魂
- `umwelt-design-constitution` — `docs/umwelt_design_constitution.md` 是设计裁判,brainstorm 前先查

---

## 2026-05-24

**做了什么**
- **Bevy 子系统 B(化学场仿真器)1–9 落地**(在新独立仓 `D:/dev/umwelt-bevy/`,§8 #8
  既定)。10 个 task 用 subagent-driven 流程跑完(implementer + spec review + code
  review,每 task 三段)。Task 10 是 HTML 侧的 attenuation,已记 05-23。
  - 工作区 + `chem_field` crate,Bevy 0.15.3 / 2024 edition,workspace 继承。
  - 数据/数学:`Channel`(ChemA–D + GeometryDistance 留口)+ `CombineOp`(Sum 化学 /
    Min 几何留口);`Contributor` trait + `ChemicalPointSource`(高斯,σ(t)=√(σ₀²+2Dt)
    扩散展宽,exp(−vt) 挥发);`Field` 按 combine_op 聚合;`PhaseSpec` + `PhaseSchedule`
    多 phase 调度;`ChemFieldScene` + `SceneBuilder` 多 channel 路由。
  - Bevy:`ChemFieldPlugin` + `ChemFieldSceneRes` Resource + Update step 系统;
    `DebugVizPlugin` 体素 gizmo 调试可视化(可选,opt-in);两个 example(`static_single_source`
    + `evolving_dual_source`)。
  - 测试:20 单元 + 1 plugin smoke,全绿。两个 example 真窗口 run 验过,显卡识别正常,
    场形与衰减/扩散行为符合预期。
- **C-1 网格工坊计划 + 落地**:把"C 网格工坊编辑器"拆成 C-1/2/3/4(基质 → 布线 →
  截面+成本 → 编译导出),先做 C-1。
  - C-1 plan 写完(`docs/superpowers/plans/2026-05-24-bevy-subsystem-c1-grid-substrate.md`,
    8 个 task),subagent-driven 跑完。
  - 新建 `grid_workshop` crate(在同一 Bevy 仓):`CellCoord` + 锁定的世界坐标映射
    (cell.x→world.x、layer→world.y、y→world.z;CELL_PITCH=1.0、LAYER_PITCH=2.0);
    5 种 `NeuronKind` + `CellContents{Empty|Neuron|Via}`;稀疏 `Grid`(HashMap-backed,
    `place`/`remove`/`get`/`occupied_cells` + `PlaceError`);`GridPlugin` 暴露
    `GridRes`;`GridRenderPlugin` 双 system:`sync_cell_entities` 按 §3 七种内容物
    彩色立方体 + `sync_layer_planes` 每个 active layer 一块半透明平面。
  - `three_layer_demo` example(3 层 7 格)真窗口 run 通过,可看到 stratification。
  - 测试:19 单元 + 2 plugin smoke,全绿。
- **plan 文档归档**:B 与 C-1 两份 plan 都已 commit 进 Umwelt(`3a6e953` / `bfae9c0`)。

**未完成 / 坑**
- 工坊里 C-1 渲染:`sync_cell_entities` 不检测原地 contents 变更 —— 因为 `Grid::place`
  拒绝已占用格子,内容只能 remove+place 改,diff 已处理。**C-2 若引入 `Grid::replace`
  之类原地变更 API,渲染器要补按 contents 比对**。
- B 的 `ChemicalPointSource::sample` 在 σ₀=D=0 退化输入下会 0/0 → NaN。无 debug_assert,
  实测不会触发(玩家配的源都有正 σ₀),C-3/D 期可加一行守卫。
- B plugin smoke 用了 `App::new() + init_resource::<Time>()` 而非 `MinimalPlugins`
  —— `TimePlugin` 会覆盖 `Time::advance_by`。production 路径会跑全 plugin,smoke
  暂时简化。C/D 接入真 App 后切回。
- `umwelt-bevy` 仓默认分支是 `master`(host git 默认);两仓分支命名不一致。需要时
  改名,目前不挡路。
- pre-existing 红色测试 `test-neural.mjs` / `ant-chemotaxis-test.mjs` 仍未修(非本次
  引入,worklog 05-21 已记录)。

**下一步**(明日接)
1. **C-2 计划之前先定一件事:神经元身份**。当前 `CellContents::Neuron(kind)` 没 ID,
   布线端点要靠什么定位 —— coord-as-id(简单,但神经元不能移动)还是显式 `NeuronId`
   + coord→id 映射(支持 save/load 与未来重排)。这事影响 save/load 与 HTML 编译,
   不该在 C-2 写到一半才发现。建议小段 brainstorm。
2. 定完 ID 模型后写 C-2 plan(曼哈顿布线 + via 作多 axon 共享导体 + 轴突粗细 + 可塑性
   标记)。布线**别塞进 `CellContents`**,开 `src/core/routing.rs` 独立 `Routes` 表。
3. 待办留口:C-3 横截面预占的 `src/debug.rs` 仍是空 placeholder。
4. λ 公式(粗细 d ↔ 衰减/速度)要在 C-4 编译到 HTML 之前定常数(spec §4.2 估算,
   `biology.rs` 还没建)。

---

## 2026-05-23

**做了什么**
- 落地 Bevy 子系统 B 计划的 **Task 10:HTML 侧 `edge.attenuation` 配套**。
  spec §7.4 的"距离→衰减"诚实链需要 HTML 评估器同 lane 实现一个 per-edge 标量,
  让工坊将来导出的模块可以把衰减直接编译进 HTML —— 与 `delay_ms` 同模式。
- 实装范围:
  - `edge.attenuation ∈ [0, 1]` 字段,默认 1.0(完全透传 → 旧图行为 bit-identical)。
  - `NeuralGraph.computeSignals` 与 `stepBatch` 都在 `srcSignal * weight` 处补乘
    `attenuation`;`stepBatch` 在 `compileTopology` 把它打平成 `edgeAttenuation`
    Float32Array(与 `edgeDelayTicks` 并列)。
  - 序列化 / 反序列化对称处理;clamp 到 [0,1];缺字段默认 1.0。
  - 存档 schema **v10 → v11**(`migrations.js`):仅版本号 bump,旧图字段缺失由
    `NeuralGraph.deserialize` 默认补 1.0 兜底。
- 测试:新建 `attenuation-test.mjs`(11 个用例,涵盖字段默认 / 钳位 / 序列化往返 /
  `stepBatch` 数值正确 / `computeSignals` 一致 / v10→v11 migration)。先 TDD 全红,
  实装后全绿。回归:`delay-test` / `module-test` / `save-load-test` /
  `plasticity-unit-test` / `batch-parity-test` / `plasticity-test` / `ant-gland-test`
  / `ant-fixes-test` / `multi-ant-smoke-test` 全部 PASS。
  `save-load-test` 一处 `version === 10` 硬编码改为 `CURRENT_STORAGE_VERSION`。

**未完成 / 坑**
- 子系统 B 其余 9 个 task 不在本仓 —— 它们在新仓 `D:/dev/umwelt-bevy/`(Bevy 化学场
  仿真器),Task 10 是唯一活在 HTML 侧的工作项。
- `test-neural.mjs` / `ant-chemotaxis-test.mjs` 在 main 上仍旧红(`sensorDefs` API
  不匹配 / 旧 chemotaxis 数值),非本次引入,worklog 05-21 已记录。

**下一步**
- 由 Bevy 仓推进子系统 C(网格工坊编辑器)/ D(关卡)的计划。HTML 侧暂无新 task。

---

## 2026-05-22

**做了什么**
- 浏览器手测 Task 6「装载模块」入口(05-21 收工状态留的下一步)。查出一个真 bug 并修复。
- **Bug:** `_loadModule` 用 `world.log("danger", ...)` 报告成功/拒绝。但 behavior log
  面板在 05-15 UI 重构里已被删,`World` 构造也没接 `onLog` 回调 —— `world.log` 写进
  一个永远不渲染的数组。结果:拒绝一个非模块 JSON 时**完全无提示**,看着像"没拒绝"。
  (`_importCircuit` 的 `onWarn` 同样失声,是 05-15 重构遗留的更大面坑,本次未一并处理。)
- **修复 `022d60f`:** `_loadModule` 改用编辑器的 `showNotice` 提示条(1.4s 自动消失)。
  坏文件弹「装载失败:不是有效的 umwelt-module 文件」,好文件弹「已装载模块」。
  用 Playwright 驱动真 Chromium 验过:坏/好文件各自弹对提示,0 报错,`vite build` 通过。
- 用户报的「窗口卡住」**未能复现**:照原路径(开编辑器→装模块→run、装载→刷新、50s
  长跑)在真 Chromium 多次跑都正常,60fps、sim 正常推进;sim 环形缓冲代码另验 2 万
  tick 无异常。最可能成因:**Vite 开发服务器在项目目录有文件变动时会热刷新页面** ——
  调试期间反复往项目目录写临时脚本,把用户打开的页面一次次刷掉了(开发服务器日志确认
  每次文件改动都 `page reload`)。

**未完成 / 坑**
- 「窗口卡住」未给出根因定论 —— 不可复现。若再现,需要用户的浏览器 Console 红字。
- 为这次手测装了 Playwright(`npm install --no-save`,**未进 package.json**);Chromium
  二进制在 Playwright 缓存目录。`module-fixture.json` 是临时测试夹具,未跟踪。三者都可清理。
- `ant-chemotaxis-test.mjs` 旧 bug 仍红(非本次引入,见 05-21)。

**下一步**
- Task 6 手测完成,HTML `edge.delay_ms` 子系统就此收尾。
- 收敛 spec 第 8 节开放问题(尤其 3D 编辑器交互模型),为 Bevy 侧 3 个子系统写计划。
  Bevy 项目开**独立仓库**。

**追加 · §8 收敛 → 工坊基质重构(同日下午/夜)**
- 清理:Playwright + Chromium 卸载、`module-fixture.json` 删、dev 服务停 —— 工作区干净。
- 用户做了功课:一份深度研究报告(`docs/compass_artifact_*.md`,已入库),主张工坊基质用
  **网格 + 分层 + via + 横截面读取**(Zachtronics 式可读性 + 昆虫板层结构诚实)。
- 走完整个 brainstorming,用户**全量采纳网格基质**。一连串决定敲定:
  - 基质:网格 + 堆叠 2D 层(= 解剖板层)+ 垂直 via + 逐格曼哈顿布线。无限可扩魔方,无空间墙。
  - 受体保留物理采样(网格嵌在解剖空间里);两段式测试保留。
  - §4 物理约束重写并拧准:分级 only 无脉冲;三约束 = 延迟 ∝ 路径长 / 代谢功率(pJ/s,
    瞬时不积分)/ 信号距离衰减;轴突粗细 √d 是三者共同杠杆;体积逐层 Σ;建造成本砍掉
    (与体积共线);via 不单独计价。
  - §5 测试场:可扩展标量场(多 contributor 类型 + phase 外壳),化学点源叠加 / 几何距离场 min。
  - par 基线;参考电路拆成 修复关(软 trigger ≈ MVP 刚完)/ onboarding 脚手架
    (gated-on-first-playtest)。
- 产出新 spec v2:`docs/superpowers/specs/2026-05-22-bevy-workshop-grid-substrate-design.md`
  (`3d8c277`),取代 05-20 那份(已标记 superseded)。

**未完成 / 坑(追加)**
- 用户正在 review v2 spec,凌晨收工,没看完。
- 一处待用户拍板:**§7.2 —— 信号衰减要不要和 `delay_ms` 一起编译进 HTML**(A-lite)。
  我暂按"要"写了(和延迟同类的诚实链,实现廉),HTML 侧因此多一条 `edge` 衰减因子待办。

**下一步(追加,取代上面那条)**
- 用户看完 v2 spec(含确认 §7.2)→ 进 writing-plans,为 Bevy 三子系统
  (化学场仿真器 / 网格工坊编辑器 / 关卡系统)写实现计划,先定先做哪个。Bevy 开独立仓库。
- brainstorming 的可视化 mockup 在 `.superpowers/brainstorm/`(gitignored)。

---

## 2026-05-21

**做了什么**
- 接着昨天的 brainstorming,走完 **writing-plans + subagent 驱动执行**两个阶段。
- writing-plans 的作用域结论:spec 第 6 节 MVP 其实是 **4 个独立子系统**,当下只有
  「HTML 侧 `edge.delay_ms` 支持」这一块能写出无占位符的实现计划(另外 3 块卡在
  spec 第 8 节开放问题)。决定先做它。另:**Bevy 代码将来放独立 git 仓库**。
- 实现计划落盘:`docs/superpowers/plans/2026-05-21-html-edge-delay.md`,6 个 task。
- 用 subagent-driven-development 执行:每个 task 一个 implementer + spec review +
  code-quality review,全程 TDD。建 `feat/html-edge-delay` 分支,8 个 commit,
  最终评审 READY TO MERGE,**fast-forward 合进 main,分支已删**。
- 落地内容(spec 第 7.4 节 A-lite 合约,HTML 侧):
  - `edge.delay_ms` 字段(默认 0,序列化往返 + 钳到 `[0, DELAY_MS_MAX=500]`)。
  - 存档 schema v9 → **v10**(delay_ms 靠 deserialize 默认;新增可选 `moduleMeta` 块)。
  - `stepBatch` 用每节点输出历史环形缓冲实现传导延迟;`delay_ms=0` 是 bit-exact no-op。
  - `src/io/module.js` 的 `parseModuleText` —— 解析 `umwelt-module-v1` 工坊导出。
  - 编辑器工具栏「装载模块」按钮。
- 关键设计决定(写进 plan):只有 `stepBatch` 支持 delay,`computeSignals` 保持
  delay-free —— **编辑器预览会忽略 delay**(验收的 MVP gap,全 Bevy 化后消失);
  可塑性更新读未延迟输出;工坊受体→HTML 感受器通道的重映射推迟。

**未完成 / 坑**
- **Task 6 的「装载模块」入口还没浏览器手测**。纯 DOM/文件输入胶水,无自动化测试。
  plan 的 Task 6 Step 5 写了具体手测步骤 + 一个 fixture JSON,照着走一遍即可。
- `ant-chemotaxis-test.mjs` 一直是红的 —— 在 main 上本来就红(评审员在干净 main
  上验证过,逐字节相同),**不是本次引入**。一个待查的旧 bug。
- Bevy 侧 3 个子系统(化学场仿真器 / 3D 工坊编辑器 / 关卡系统)还没计划,卡在
  spec 第 8 节开放问题(3D 交互模型、轴突几何粒度、包络绘制等),需要单独一轮收敛
  才能写实现计划。
- `.git/worktrees` 下有几条权限锁住、prune 删不掉的陈旧 worktree 元数据(目录已不
  存在),无害,可忽略。

**下一步**
- 浏览器手测 Task 6 的装载模块入口(plan Task 6 Step 5)。
- 收敛 spec 第 8 节开放问题(尤其 3D 编辑器交互模型),之后才能为 Bevy 侧子系统
  写计划。Bevy 项目按昨天的决定开**独立仓库**。

**收工状态**
- main 今天 +9 个 commit:`06c494d`→`a1a95a4` 是 HTML `edge.delay_ms` 的 8 笔实现,
  `40a7d80` 是本日志。`feat/html-edge-delay` 分支已合并并删除。
- 工作区干净。实现计划 `docs/superpowers/plans/2026-05-21-html-edge-delay.md` 已入库。
- 明天从这里接:先 `npm run dev` 浏览器手测「装载模块」入口(plan 第 6 个 task 的
  Step 5,那里有 fixture JSON 和具体点击步骤);通过后再去收敛 spec 第 8 节,
  为 Bevy 侧写计划。

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
