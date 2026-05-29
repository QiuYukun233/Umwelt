# Umwelt 工作日志

每天干了啥,按倒序记。目的:防止隔了几周回来忘记进度/半成品。

格式:每天一个 `## YYYY-MM-DD`,底下记「做了什么」「未完成/坑」「下一步」。
开工前先扫一眼最近几条,收工前补一条。

---

## 2026-05-30

**做了什么**
- **战略转向 + 记录对齐(止血)**。把"Bevy 工坊先行"的下一步具体化:**不再凭空设计单题,而是先在编辑器里手搭一整只蚂蚁**,作为整个 grid/走线/成本/eval 架构的集成测试;谜题从蚂蚁的真实电路与损坏派生。**单边衰减修复谜题(连同 layer-hop fork)作废** —— 它是"凭空设计单题"路线的产物。耐久决定写进 `CLAUDE.md`「产品形态」节(新增「路径细化:先搭一整只蚂蚁」子节),不再只活在 worklog,免得每个 session 把 layer-hop 当 CRITICAL 翻出来。
  - **layer-hop cheese 降级**:从"CRITICAL 待拍板的下一步"降为"已记录的结构约束(无界 3D 逼不出有限墙的迷宫绕行)",留待将来真做空间路由谜题再翻。不在主路径上。
- **为手搭 CPG(半中枢振荡器)扫障 —— 查证两个可能挡路点**(只读+一次性实测,没替 user 搭):
  - **Q1 抑制符号:确认成立,无需修。** `edge_kind` 在 `topology.rs:171` 按**源节点类型**编译(`EdgeKindCode::from_node_type`),InterInh 源 → `Inh`;`step.rs:181` `net_input=(exc_sum−inh_sum)·gain`,inh 真被减掉。Dale 律已落实,从 inter_inh 连出去的边确实压制目标。之前"fixed excitatory edges"含糊只因参考解源是 Sensor/InterExc。
  - **Q2 振荡可达性:无瓶颈,默认参数就持续振。** 先确认编辑器**调不了 tau/tau_discharge/g_rebound** —— `topology.rs:142-145` TODO 明说 per-node 这三个没从 grid 接线,`compile()` 给每个 InterInh 硬填默认(tau=3.0、tau_discharge=10.0、g_rebound=7.0);玩家唯一的旋钮是拓扑+边权重。**实测**(一次性 scratch 测试,已删):最小半中枢(1 sensor 恒驱 + 两 inter_inh 互抑)用**默认 3.0/10/7 持续振荡**(early/late 窗口各 5 次交替,周期稳定);讽刺的是已验证 fixture 的 1.5/0.4/7 在这个最小拓扑反而后半衰减。**结论:用默认参数 + 纯拓扑就能搭出能振的 CPG,不需要 per-node 调参,坚决不建调参 UI。**
  - **手搭配方**:1× sensor(求值时恒喂 1.0 当持续驱动)→ inter_inh A;A↔B 互抑(两条边);各 inter_inh → 一个 motor 把交替读出来。

**下一步**
- **在编辑器里手搭半中枢 CPG**(上面的配方),这就是编辑器的真实 playtest —— 摆/连/看激活随 tick 交替,卡哪修哪(拾取精度/相机/编辑后发光)。窗口 user 驱动、CC 看不到渲染。
- CPG 立住后继续往一整只蚂蚁的回路扩。

---

## 2026-05-29

**做了什么**
- **第一道真 Zach-like 谜题落地:单路衰减修复** (`docs/superpowers/specs/2026-05-28-bevy-subsystem-first-puzzle-attenuation-repair-design.md` spec, `docs/superpowers/plans/2026-05-28-bevy-subsystem-first-puzzle-attenuation-repair.md` plan, umwelt-bevy commits `a05d686`→Task4)。brainstorm→spec→plan→subagent-driven 4 task。修复题:sensor→motor 轴突被切,玩家重接;信号沿线衰减 `exp(−len/λ)`,绕太远就太弱推不动 motor。
  - **关键模型发现(reframe 了整道题)**:延迟在谜题尺度是 **sub-tick**。同层格 5 μm、V_REF 0.3 m/s → 每格 ~0.017 ms,一 tick 16.7 ms,要 ~1000 格才够一个 tick。几十格谜题里 `delay_ms_to_ticks` 恒为 0。**界定了模型能算什么**:活在幅值/慢动力学区(衰减、振荡、抑制、门控),不在精细时序区(符合探测、Reichardt 类出局)。让延迟可分辨要把传导调慢 ~1000×(0.3 mm/s),生物学上不诚实(虫轴突 0.1–几 m/s),不假造。记进 `biology.rs` V_REF 旁。
  - 因此第一题从 user 原构想的"双触角符合探测靠延迟配平"**转基底为单路衰减**(user 拍板)。衰减在谜题尺度可分辨:λ=300 μm@d=1,30 格×0.61、60 格×0.37。
  - **机制对着 step.rs 核过**:motor 是瞬时节点(`out=net_input.clamp`),`motor_out = sensor·weight·atten`。过关 = atten ≥ 0.5 → 预算 ≈41 格(208 μm)。参考解 ≈32 格(atten 0.587 过),太长解 ≈44 格(atten 0.480 不过)。
  - **反例 = 另一条绕太远的电路,不是另一组输入** → harness 零改动(单个 ThresholdByTick 正例 + 两个 guard 测试:参考解过/绕太远不过)。`Vec<Case>` battery 推迟(YAGNI)。
  - **校准数与手算几乎完全吻合**(volume 710.66 vs 711、membrane 1209.15 vs 1209、power 1869.68 vs ~1870)—— 强证实现正确而非自洽。三轴 par 留 ~10–25% margin,d-加粗逃生路按 d²/d 自然撑爆 par。
  - **障碍 = 惰性 InterExc 神经元**(v1 表示法;墙的代谢混进绝对成本但 par 相对不受影响,已在 spec/doc 标注;真正 Blocked 格类型记进升级路径)。
  - **铭文 = 被动电缆理论**(Hodgkin & Rushton 1946 首测 λ),不是 M-P 逻辑(跟着推后的逻辑门谜题)、不是 HH 1952 主动脉冲(我们信号非脉冲)。诚实警觉保留:铭文说物理,不断言神经元类型。

- **方向修正:dev 级 UI 上马**(memory `umwelt-zachlike-needs-dev-ui`)。之前"纯代码跳过 UI"被判定 over-correct:对 Zach-like,摆电路的手感是核心乐趣、纯代码测不出;空间电路没视觉没法想。定性:粗、丑、灰盒、坚决不打磨,是想东西+验手感的工具,不是产品 UI(那是将来 Claude Design 的事)。唯一失败模式 = UI 无底洞。
  - **第一步 只读查看器**(umwelt-bevy `1c7aa23`,`examples/eval_viewer.rs`):扩 GridRenderPlugin/RoutesRenderPlugin,神经元 cube 按激活发光(emissive ∝ `output`),Space/S/R 播放/单步/重置,成本三轴 + tick 走 console。**依赖查证:求值层无需改动** —— `EvalState`/`EvalTopology` 字段全 pub、`step_eval`/`compile` 公开,viewer 自己跑 step 循环读 `s.output`。
  - **第二步 交互编辑**(umwelt-bevy `af04e0c`→`62b90c1`):
    - **自动布线器**`route_same_layer`(`routing/pathfind.rs`,7 单测):给两神经元算同层单目标 BFS 短路径,守 no-overlap(`grid.get==Empty && edge_at_wire_cell.is_none()`),bounded(SEARCH_MARGIN=12)。连线的前提。
    - **编辑模式**:Tab 切正交俯视相机(拾取 = cursor→ray→当前层平面→格子,免 3D pick),`P/C/X/K/M` 工具 + `1-5` 选神经元类型。Place/Connect(点 A 点 B 自动布线)/Delete(级联)/Replace。每次编辑后重编译 Sim,可立即播放。文字全走 console(workspace bevy 无 bevy_ui/bevy_text,不为几行字碰它)。
    - **有限 move**(`62b90c1`):仅当神经元所有边都是单叶、非可塑、且它不是被可塑边绑的 modulator 时才做(remove+place+逐条重走线,保留 d/weight);否则 console 警告拒做。**完整 move(扇出树/可塑/分支重接)推后** —— 单目标布线器做不了,routed 为设计 fork。
    - 全程 console-only;build/clippy clean,112 lib 测全绿;windowed run-smoke 干净(window 起、无 panic);**交互手感未由我目验**(拾取精度/相机/编辑后发光),留 user playtest。

**未完成 / parked**
- **衰减谜题 layer-hop cheese**(final review 抓到):无界 3D 格子里有限墙总能被另一层绕过(且更便宜、还过 par)。结构性发现:有限障碍逼不出长绕路,真迷宫路由需要 bounded 区域/真 Blocked 格概念,或第一题改用"距离+d 预算"基底(不是迷宫)。viewer 现在能直接看见这个 cheese。**【2026-05-30 更新:谜题作废、此项降级为已记录的结构约束,不再 CRITICAL —— 见 2026-05-30 entry 与 CLAUDE.md】**
- **eval/puzzle.rs harness**:`Vec<Case>` battery + `StaysBelowThrough` Expected 变体(TODO 在 puzzle.rs:33),双触角/抑制谜题要才做。
- **完整 move**、真 Blocked 格类型、跨层布线/扇出树布线。

**下一步候选(需 user 拍板)** —— **【已被 2026-05-30 取代:谜题作废,下一步 = 在编辑器里手搭蚂蚁/CPG】**
- ~~处理 layer-hop cheese(改基底 or 建 Blocked 概念)~~ 降级,见 2026-05-30
- 用 viewer playtest 编辑器手感,卡哪修哪 ← 仍有效,并入手搭 CPG
- 给衰减谜题/编辑器补 spec 或继续搭蚂蚁电路 ← 收敛为"继续搭蚂蚁电路"

---

## 2026-05-28

**做了什么**
- **C-2 Edge authored weight 落地** (`docs/superpowers/specs/2026-05-28-bevy-subsystem-c2-edge-authored-weight-design.md` spec, `docs/superpowers/plans/2026-05-28-bevy-subsystem-c2-edge-authored-weight.md` plan, umwelt-bevy commits `73c70cc`→`7ec6356`)。给 `Edge` 加玩家授权的突触权重,接通到求值层 —— 兑现 C-3 v0.3 worklog 里"edge_weight/edge_init_w 硬编码 1.0"那个坑。Subagent-driven 流跑 3 task,每 task 两段 review(spec→quality)+ 最终全特性 review。
  - **模型 settle 干净,无 fork**:JS `batch.js:202-207` 定死了形态 —— 一个授权字段 `Edge.weight`。固定边是运行时权重 `[0.1,1.0]`;可塑边是先天 baseline + tick-0 起点(同一个值)`[0,1]`(使 `w_init=0` 从零学习可达)。独立的运行时 `edge.w`(学到的当前值,异于 baseline)只为 save-state 回放,不是第二个授权旋钮 —— 本次不做(无 save/load)。
  - **magnitude-only 结构性成立**:非负值域使符号进不去权重,符号永远在源神经元类型(Dale)。不靠运行时检查。和 `replace_kind` 干净组合(换类型翻符号、幅值不动,无需重授权)。
  - **边界 reject 而非 clamp**:`place_edge` 加 `PlaceEdgeError::WeightOutOfRange{weight,plastic}`,plastic-aware 区间。写成 **accept-if-in-range**(`!(w>=lo && w<=hi)`)而非取反式 —— NaN 全比较为 false,前者自动拒掉 NaN,后者会漏。专门一个 NaN 测试钉住这个形式。运行时 `clamp_w`/`clamp_dale` 照旧留作 Dale 安全网(双层)。
  - **常量复用防漂移**:验证区间引 `constants/eval.rs` 的 `EDGE_WEIGHT_MIN/MAX`(= eval clamp 用的同一对),授权边界和运行时 clamp 不会偷偷分叉。per-flag 路由对齐:plastic→clamp_dale(floor 0)、fixed→clamp_w(floor 0.1)。
  - **compile() 接通**:单一授权值同喂 `edge_weight`(baseline)+ `edge_init_w`(start);二者发散仅是 oracle override 的 test/save-state seam。
  - **粒度边界**(记在 spec,非 bug):权重 per-edge(一棵轴突树共享一个),同 §4 "one d per edge" 档简化。将来"同源不同目标不同权重"是 per-target 升级路径,类比 §2 树突升级。
  - **review 抓到的**:Task 1 scope creep(subagent 顺手加了个 example + 一个无关 test)被 spec review 抓到并回退(`b8573d0`);两处现已失真的注释(声称 topology 硬编码 1.0)分别在 `ff8eb84`/`7ec6356` 修正;Task 2 补了 plastic 侧 out-of-range 测试缺口 + 常量复用。
  - **验证**:102 lib + 5 oracle 全绿(oracle override seam 不受授权路径影响,如 spec 所诺),clippy 干净,`step_response` demo `passed:true`。最终全特性 review:ready to land,零 issue。

**下一步**(候选,需 user 拍板)
- 第一个真 Zach-like 谜题(现在 par 多轴 + 授权权重都齐了,可以设计输入时间线 + 期望输出 + par 目标的真关卡)
- V_REF / activity coef 两个 PROVISIONAL 校准(谜题能跑了,有了校准锚)
- Bevy UI 子系统 brainstorm(摆神经元 / 走线 / 设权重 / 点 run 的交互层)

---

## 2026-05-27

**做了什么(后半段)**
- **C-3 v0.3 求值层落地** (`docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md` spec, `docs/superpowers/plans/2026-05-27-bevy-subsystem-c3v3-eval-layer.md` plan, umwelt-bevy 11+ commits)。Subagent-driven 流跑 9 task,5 个 oracle 在 max_relative ≤ 1e-5 全绿:
  - **3 个 port 真 bug 被 oracle 抓到**(spec §6 说的 surface point 这次具体兑现了):
    1. plastic decay baseline 用错变量 —— Bevy 用 `edge_init_w[e]` 而 JS 用 `edge.weight`(authored synaptic weight);二者在 Bevy 默认 1.0/1.0 重合,所以 unit test 看不出来;hebbian oracle 一上来就抓到。
    2. modulator 初值 = 0 而非 `(MOD_GAIN_BASELINE - MOD_GAIN_MIN)/(MOD_GAIN_MAX - MOD_GAIN_MIN) ≈ 0.31034`(JS batch.js:134-140 的 initState),导致 modulator 起步即拉低 gain 到地板 0.1,Hebbian drive 被压制 ~300×。
    3. inter_inh 的 `tau_discharge` / `g_rebound` 在 JS 是 per-node(默认 + 节点级 override),Bevy 端口只读全局 `DEFAULT_*` 常数;振荡器节点 `tau_discharge=0.4`(默认 10)被忽略,oracle 在 tick ~70 偏离捕到。
    每个 fix 都引 JS source-of-truth 行号,审核确认无臆造。
  - **结构性保留**:spec §7 Q2 双缓冲(`output_prev` / `output_next` 类型分离 + 指针级断言)、Q1 显式 Euler、Q3 通道绑定在 Puzzle 不在神经元、Q5 `compile()` 无缓存。
  - **新加 fixture 字段**:`init_w_override`(plastic 边的起始 w,Bevy 默认 `edge_init_w=1.0` 无 headroom 看不到 Hebbian 增长)。dual-write 到 `edge_weight + edge_init_w` 模拟 JS `updateEdgeWeight` 语义。
  - **EvalTopology 新字段** `tau_discharge` / `g_rebound`(per-node Vec<f32>);`compile()` 现在填默认值,`tests/eval_oracle.rs::build_topo` 从 fixture 填实际值。打了 TODO 提醒未来 Bevy UI / C-4-extension 要把 per-neuron 值从 Grid metadata 接进来。
  - **demo example**(`cargo run --example step_response`):sensor→inter_exc→motor 链,sensor 60 ticks 0 + 60 ticks 1,motor 在 tick 119 达 0.2554,过 0.2 阈值 → passed=true;static volume=210.708 um³ / membrane=298.332 um² / power=787.831 pJ/s,activity=112.205 pJ,三轴 par 都通过(loose 1e6/1e6/1e9 target)。
  - **108 测试全绿**(97 lib unit + 11 integration:5 oracle + 2 routing_smoke + 2 cost_smoke + 1 routing_prop + 1 doctest dummy),clippy dev + release 干净。

- **CLAUDE.md 治理层加 Decision Protocol** (`docs/umwelt_decision_protocol.md` → CLAUDE.md inlined, commit `4a28bd6`)。宪法管"决定落到哪",protocol 管"碰到宪法没覆盖的岔口怎么处理"。两条核心规则:**don't fabricate**(别给工程方便选择穿生物学外衣)+ **do route**(model/biology 岔口走 review,runtime guard 往往是埋着的设计决定)。位置:宪法 §4 之后、当前主角:蚂蚁之前 —— 跟宪法绑在治理块里,在所有操作内容之前。
- **C-4 HTML JSON 导出子系统 brainstorm → spec v0.1 → 实现落地** (`docs/superpowers/specs/2026-05-27-bevy-subsystem-c4-html-json-export-design.md`, commit `4c0c7c8`)。
  - **核心原则锁定**(memory `umwelt-export-only-what-you-own`):导出方只导此刻**真正拥有、不用编**的字段;缺的**省略**(JSON 里 key 不出现),不是写 null 占位。每个缺席块要有正经归宿,不是"导出方编默认"。
  - 由此 MVP **只导 meta**:7 个 OrganStatic 字段(`neuron_count, total_volume_um3, total_membrane_um2, total_static_pj_s, layered_volume_um3, max_path_delay_ms, per_layer_hull_um2`)。`graph` 归未来求值层(动力学) + 关卡 I/O 契约(sourceId) + HTML adapter(画布坐标);`receptors` 归关卡 I/O 契约;`level_id` 归未来 Bevy 关卡子系统。三个都不是 Bevy 现在该编的。
  - 落地:
    - `crates/grid_workshop/src/routing/export.rs` —— `ModuleMetaDto` v1 schema + `to_module_json(&Grid, &Routes) -> String` 自由函数(不挂 `Routes::`,依赖箭头朝对)。**DTO 而非 derive(Serialize) for OrganStatic**:让"meta 恰含 7 字段"在构造上成立,而非事后断言。
    - `crates/grid_workshop/examples/module_export.rs` —— 复用 cost_demo 同款场景,`println!` 输出可重定向到文件
    - 4 unit test:empty grid 各字段为 0、3-neuron 各字段 > 0、顶层 keys 严格 = `{schema, meta}`、meta keys 严格 = 7 个名字
  - **验证**:85 测试全绿(+4 vs 上轮 81),clippy dev+release 干净,example 跑通输出真实 JSON。
  - **§6 人工跨语言验证执行了 → spec 的预测命中 → REJECTED**:`parseModuleText` 严格按 module.js:34-37 拒掉 meta-only payload(`if (!raw.graph || typeof raw.graph !== "object") return null`)。**这是 surface-of-discovery,不是 bug**。spec §6 已经预测到、并明确说:**别**为了让它过去而吐空对象的 graph,那违 "don't fabricate"。意义:meta-only 路径要工作,HTML 侧需要补一个"允许 graph 缺席"的入口 —— 这是 scope 决定、留给 user 拍板,不是 C-4 自己能填的窟窿。

- **C-3 子系统 spec + 实现落地** (`docs/superpowers/specs/2026-05-28-bevy-subsystem-c3-cost-design.md` v0.2 定稿,`docs/superpowers/plans/2026-05-27-bevy-subsystem-c3-cost.md` 7 task)。
  - **宪法 §1 + §4 同期修订**(commit `2e970e9`):hull 含 wire 线格;**代谢 ∝ 膜面积 d·len**(不是体积),体积 d²·len 是独立空间成本;突触维持与 d 无关。一个 d 触三种斜率:√d(速度/λ)、d(代谢)、d²(空间)。
  - **常数 ledger 是 Task 1 输出**(`docs/superpowers/plans/2026-05-27-c3-constants-ledger.md`),user gate review 后两条 provisional + 一条结构改:`P_REST_PER_NEURON_PJ_S` **从独立常数改为派生**(`NEURON_BODY_MEMB_UM2 × P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2 ≈ 102 pJ/s`),全脑外推从 100 mW 落回 ~25 μW 与真实蚂蚁脑同量级。
  - 标定锚 user 确认:`CELL_PITCH_UM = 5.0`、`LAYER_HEIGHT_UM = 10.0`。
  - 落地代码:
    - `crates/grid_workshop/src/constants/biology.rs` —— 物理常数 + √d helper + 顶部四条强制注释项(锁死比例 vs 可调标度)
    - `crates/grid_workshop/src/routing/cost.rs` —— Edge 方法(volume/membrane/delay_to_leaf/attenuation_to_leaf/static_power)、`OrganStatic` 七字段、`Routes::organ_static`、Andrew monotone chain 凸包(含 wire,宪法 §1)
    - `crates/grid_workshop/src/routing/path_tree.rs` —— `pathlen_total_um` + `pathlen_to_leaf_um`(同层 5μm / 跨层 10μm asymmetric)
    - `crates/grid_workshop/examples/cost_demo.rs` —— `MinimalPlugins + LogPlugin` info!log 七个数无窗口
    - `crates/grid_workshop/tests/cost_smoke.rs` —— App-level 烟测
  - **关键单元测试断言**(spec §7.1 强制项):d 翻倍 → 体积 ×4(d²)+ 膜面积 ×2(d¹) 同时成立 —— 显式守护宪法 §4 行 60 "两个不同幂次";突触维持与 d 无关;hull 含 wire 时 sprawling 路径严格增加 hull。
  - **验证**:81 测试全绿(75 unit + 6 integration),`cargo clippy --tests --examples -- -D warnings` + `--release` 都干净,三个 example 都编译。

**未完成 / 坑**
- 两个 PROVISIONAL 数值:`V_REF_M_S = 0.3` 待求值层 dt 定;`P_ACTIVITY_COEF_PER_NEURON_PJ_S = 400` rest:active 比是 game-feel 旋钮,游戏跑起来再调。
- subagent-driven 流坑:Task 5 implementer 报告里**捏造了 cost_demo 的输出数值**(报 0.009 实际 218.562),还顺手删了 three_layer_demo.rs 一个仍在用的 import 导致 example build 挂了。捏造数值难抓(代码本身正确),但 "I claim X tests pass" 与 "I claim example runs OK" 应该现场验证 — 至少跑 `cargo build --examples` 抓住 import 漂移。下次 dispatch implementer 时加一条 "report 必含 cargo run/build 的 raw stdout 引用" 减少幻觉。
- C-3b 横截面渲染、C-4 HTML JSON 导出仍未做,排队待 UI/相机子系统先立。

**下一步**
- **C-3 v0.3 续:V_REF / activity coef 校准** —— 两个 PROVISIONAL 现在能跑实际谜题看 par 比例,可以开始调
- **第一个真 Zach-like puzzle** —— 定义一个有趣的具体谜题(关联学习?互抑振荡?),不只是 step-response smoke
- **C-2 Edge 加 authored weight 字段** —— 现在 `edge_weight` / `edge_init_w` 默认 1.0,UI 还没接;一旦有了 UI(或前期通过别的接口)再 wire 进 topology.rs:130
- **Bevy UI 子系统 brainstorm** —— 离线 puzzle harness 跑通后,下一个杠杆是把它给真玩家用;UI 是硬骨头,先 brainstorm
- C-3b 横截面渲染(独立 spec,等 UI/相机子系统就位再开)
- C-4 §6 REJECTED 处置仍 park(HTML 不再是 C-3 数字的目标消费者,见 CLAUDE.md 产品形态决定);hand-off C-2 spec §6 #1 的"权重冻结 vs 弹回 w_init"也属于这一波
- 涌现 / 蚂蚁 / 化学世界仍 park 作 campaign 层

- **C-2 实现计划写完 + 全套 13 个 task 落地** (`docs/superpowers/plans/2026-05-27-bevy-subsystem-c2-routing.md`),subagent-driven 流(implementer + spec reviewer + code quality reviewer 三阶段)。
- **task 0** 删 `CellContents::Via` 变体 + 在 C-1 plan 文档加 v0.2 注。Umwelt commit `6807b1e`,umwelt-bevy `2a3589c`。
- **task 1–12** 在 `crates/grid_workshop/src/routing/` 落地 routing 子模块:
  - `ids.rs` — `EdgeId(u32)` + `PathEndpoint(CellCoord)` newtype
  - `path_tree.rs` — 单一扁平 `cells + parent`,`from_path` / `graft_branch` / `prune_to_node` / `is_path()` 是查询
  - `edge.rs` — `Edge`、`PlaceEdgeError`、`NeuronRemovalImpact`、`PrunedBranch`、`DemoteRecord`、`KindReplaceImpact`
  - `routes.rs` — `Routes` 双反查索引(`cell_to_edge` 线格单值 + `endpoint_to_edges` 端点多值 SmallVec)、`place_edge` 七个错误分支、`on_neuron_removed` 三种 cascade(source 整删 / leaf 剪叶 / modulator 降级)、`on_neuron_kind_replaced` Modulator 降级、`validate_invariants` I-1..I-7 双向校验
  - `ops.rs` — `EdgeOps<'a>` 唯一入口;`Grid::place` / `Grid::remove` 改 `pub(crate)`,外部代码无法绕过级联(integration test 也走 EdgeOps,verified)
  - `plugin.rs` — `RoutesPlugin` + `RoutesRes` + `debug_assertions` 不变量 validator system
  - `render.rs` — gizmo 渲染 plastic / fixed 区分色
  - `examples/routing_demo.rs` — R/L/K 三热键演示 cascade / prune / demote
  - `tests/routing_smoke.rs` + `tests/routing_prop.rs`(proptest 200 case,5×5×5 小坐标空间,含"神经元多边端点"用例)
- **review 发现一个真 bug**(spec gap):spec §2.1 隐含 `plastic ⟺ mod_source.is_some()` 但 `place_edge` 没强制;`on_neuron_removed` 的降级 filter 没用 `plastic &&` 守。修复:加 `PlaceEdgeError::PlasticModSourceMismatch`,validate_invariants 也加 paired 检查。commit `47ed77b`。
- **clippy 清零**:用 `cargo clippy -- -D warnings` 跑出来 8 个错(`needless_range_loop` / `manual_contains` / `neg_cmp_op_on_partial_ord` ×2 / `collapsible_if` ×2 / `useless_conversion` ×2)+ 跑 `--tests --examples` 又多 2 个(`drop_non_drop` / `neg_multiply`)。一并清干净。commit `3eb8047`。

**关键设计点已落地**
- **单值索引 + 多值索引分工**:wire 单值守"线不挤同格"(I-2 / 宪法 §2);endpoint 多值允许 ~6 fan-in。三神经元链 S→I→M 是 regression test。
- **隐式 via**:wire cell 穿 `Empty` 合法,占用进 `cell_to_edge` 但不改 Grid;删边后 Grid 仍 Empty。 
- **级联非对称**:删 source 整树死,删 leaf 剪到最近 fork,modulator 失效只降级不动拓扑。
- **EdgeOps 是结构性强制**(spec §6 #8 / 宪法 §3 cascade):`Grid::place/remove` `pub(crate)`,外部代码物理上拿不到神经元 mutator。
- **plastic ↔ mod_source 配对**作为新 invariant(spec §2.1 隐含,review 才显式化)。
- **65 测试** + **200 proptest case** 全绿。

**未完成 / 坑**
- 渲染层:gizmo 是 placeholder,无 mesh / 无 d 粗细可视化。C-3 才做。
- `Vec3::from` 在 render.rs 一开始是 sonnet implementer 多加的"防御性转换"(`CellCoord::to_world` 返回 `glam::Vec3`,而 `bevy::prelude::Vec3` 是同一类型,re-export 关系)。clippy 抓到删掉了。**教训**:每个 task 末尾 plan 里就该带 `cargo clippy -- -D warnings`,不只 build,否则积累到 task 13 一波清。

**下一步**
- **C-3 子系统设计 spec**:横截面 / 成本(volume / 代谢 / 延迟 / 衰减),开始把 C-2 的 `Edge.thickness_d` 接到真实物理。需要先 brainstorm 哪些"代价量"是正交的(宪法 §1 + §4)、哪些可以推到编译时(C-4)。
- **C-4 hand-off 别丢**:
  1. modulator 失效降级时,plastic 权重是冻结当前值还是回到 `w_init`?(权重持久化在 C-2 的 Edge 故意没字段,在求值层。)
  2. 导出/导入的稳定边 id 是用 `<root_coord>-><sorted_leaf_coords>` 派生(spec §6 #3)还是 EdgeId 字符串化?
- **proptest 强度可以提升**:现在 5×5×5 + 多数 `place_edge` 因 `PathThroughNeuron` 或重复路径在 `PathTree::from_path` 就 reject,实际 mutate 次数偏少(0.01s 在 release 跑完 200 case)。后续如果不变量 bug 暴露,把"先放够神经元再画线"的 sequenced strategy 提上日程,或者给 path strategy 做 "走 Empty 优先"。

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
