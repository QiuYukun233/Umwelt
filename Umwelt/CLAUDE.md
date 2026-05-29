# CLAUDE.md — Umwelt

## 项目概述

Umwelt 是一个 Braitenberg 风格的神经回路沙盒游戏。玩家手动接线神经回路来控制虚拟生物在化学世界中生存。名字来自 Jakob von Uexküll 的理论：每个生物栖息在由自己的感觉器官构成的独特主观世界中。

技术栈：JavaScript + Vite + Canvas 2D。未来计划迁移到 Unity 3D。

## 设计宪法

这些原则是不可违反的。所有设计决策必须通过这些原则的检验。处理新岔口（宪法未直接覆盖的决策）的过程见下方 Decision Protocol。

### 1. 诚实于神经结构的逻辑
不做语义层的东西，只做具体功能层的东西。不追求一比一还原，但不做本质上不诚实的抽象。精简的方式是"少几个硬件"，而非"把多个硬件合并成一个假概念"。

**反例（禁止）：** 一个叫"释放路径信息素"的输出端口——这是语义层，蚂蚁不知道什么是"路径信息素"。
**正例（正确）：** 一个叫 gland_α 的输出端口，激活时向化学场写入 ChemB——这是物理层，腺体就是分泌化学物质的器官。

### 2. 涌现，而非预设
复杂行为必须从简单组件中涌现出来，不能由系统直接提供。如果一个行为可以由玩家用基础神经节点搭出来，那就不应该把它做成内置功能。

**关键案例：** sensor_off 节点被删除。OFF 响应由玩家用 sensor_on + inter_inh 自己搭。这个"啊哈时刻"是游戏的灵魂。

### 3. 生物学忠实服务于玩法
生物学事实是设计灵感的来源。当生物学事实和可玩性冲突时，玩法优先——但解决方式是精简（少几个），而非撒谎（做假的）。

### 4. 产品定位
小众但受尊敬。"Niche work with a cult following, widely respected outside the core audience."

## Decision Protocol: Don't Fabricate, Do Route

> Companion to the Design Constitution. The constitution says *what* decisions resolve to; this says *how* to handle a fork the constitution doesn't already settle. Division of labor: CC implements and executes; a review layer holds the model / biology / architecture judgment. Your structural and engineering execution is trusted — the failure mode this protocol guards is narrow and specific: resolving a model/biology fork with an engineering-convenient default, or dressing such a default in a fabricated rationale.

### Two rules

**Don't fabricate.** Never manufacture a biological (or model) justification to support a choice. When you make a design decision, be explicit about which kind of reason you're using:
- *The constitution, or a biology fact you actually know, requires it* — cite which, and proceed.
- *Engineering judgment* (simplicity, performance, clean types) — say so plainly. "Clean code" and "honest to the biology" are different reasons; never let the first wear the costume of the second.
- *You don't know* — say you don't know. Do not invent a plausible-sounding biological reason to cover the gap.

Real cases where a wrong/fabricated rationale slipped in — learn the shape:
- *"the axon survives, like in biology"* — backwards. A severed axon undergoes Wallerian degeneration; it is cleared, not preserved. (→ the I2 cascade.)
- *"metabolism per spike"* — the model is non-spiking / graded; there are no spikes.
- *V_REF justified by a passive-cable argument that ran the wrong way* — a smaller passive velocity means *more* delay, not less.
- *a flat per-neuron resting-power constant* — silently contradicts §4 (metabolism ∝ membrane area, not a per-neuron flat).

Every one is the same shape: an engineering-convenient choice wearing a biological costume.

**Do route.** When a fork has a model/biology dimension you can't settle from the constitution or solid knowledge, write it up as an open question for review. Don't resolve it with an engineering default and move on. In particular: **a runtime guard or validation is often a buried design decision.** When you add a check to enforce a pairing or constraint, ask what it *encodes* and whether that decision should be surfaced. (The `plastic`/`mod_source` pairing guard silently encoded "no ungated plasticity" — a decision, not a bug fix.)

### Recognizing a model/biology fork

A fork has a model/biology dimension when it touches any of:
- **signal flow** — what combines where; fan-in/out; merging vs copying;
- **connection lifecycle** — creation, deletion, cascade; what dies with what;
- **timing / attenuation / metabolism** — delay, decay, the powers of the `d` lever, what scales with membrane area vs volume vs count;
- **learning** — plasticity, gating, where it's localized;
- **units and constants** — any real biological number or formula.

These belong to the review layer. Surface them; don't quietly pick.

### Constants and numbers

- Any biological number or formula: **cite a source.** Where insect data is thin and you must extrapolate (from mammalian work or another species), mark it **ESTIMATE** and show the chain — never present a guess as a measured value.
- Two classes, treated differently:
  - **Ratio-locked / faithful** — the powers of `d` (√d, d, d²), exponential attenuation, geometric coefficients (π/4, π). Fixed by physics/geometry. **Do not tune them.**
  - **Scale / balance** — absolute magnitudes (pJ/s values) and cross-term weights. **Tuning knobs.** Mark provisional; don't chase a real brain's absolute numbers — only the relative balance matters for `par`.

## 产品形态：Bevy 工坊先行的 Zach-like

**决定**：产品的第一形态 = Bevy 工坊里的 Zach-like 单回路谜题游戏。核心机制三件套：
- **格子稀缺**（宪法 §2 / memory `umwelt-grid-atomicity`）—— 一格一物，几何重合即电学连接，布线即谜题
- **物理走线**（C-2 的 PathTree）—— 边是穿过格子的树，距离决定延迟和衰减
- **多轴成本 par**（C-3 的 OrganStatic）—— 体积、膜面积、静态功率、凸包面积、max delay 五维优化

玩家循环：选谜题 → 在格子上摆神经元 → 走线 → "run"（求值层算输入到输出）→ 通过/不通过 + 三轴成本对比 par → 迭代。

**这条决定反转了原来"先 JS 验证 Tier 4 涌现、再迁 Bevy"的原则。** 老原则没有被忘，而是被想清楚后取代：
- 老原则的前提是"游戏成立性依赖涌现"。当时担心 Bevy 投资了一堆涌现却不成立。
- 这条 Zach-like **单回路谜题不依赖涌现**。一条电路 + 一对 I/O + par 多轴本身就能撑起 Zachtronics 类型的游戏循环。
- 所以"Bevy 先行"不是在赌涌现，是在赌一个已被验证过的游戏类型 + 我们独特的诚实物理约束（C-3 那套）。

**为什么不"JS 先验"**：格子稀缺 / PathTree / 多轴 par 这三件**只存在于 Bevy 仓**。在 JS 上先验 = 把 C-1/C-2/C-3 (14+7 task)在 JS 重写一遍，然后转回 Bevy 再写一次，中间还要承担 port 走样的经典风险（nematode → ant 的痛已吃过一次）。

### 路径细化：先搭一整只蚂蚁，谜题从它派生（2026-05-30）

**决定**：上面那条"Bevy 工坊先行"的**具体下一步不是凭空设计单题，而是先在编辑器里手搭一整只蚂蚁**——把所有传感器/执行器接成一套能活的回路。这只蚂蚁是整个 grid / 走线 / 成本 / eval 架构的**集成测试**：能不能摆、能不能连、走线对不对、成本算不算得出、求值层跑不跑得动，搭的过程里全暴露。谜题**从蚂蚁的真实电路与损坏派生**（"这段神经被切断了，修好它"），而不是先空想一道题再去凑电路。

**单边衰减修复谜题作废。** 它（连同 layer-hop fork）是"凭空设计单题"路线的产物，被本决定取代。它揭示的结构约束仍有效、已记录（见下方 worklog 与 §架构），但不再是主路径上的活任务——别再把 layer-hop 当 CRITICAL 翻出来。

**为什么先搭蚂蚁而不是先做一道干净小题**：一道孤立小题只测架构的一个切面；一整只蚂蚁同时压满所有切面，且天然产出"可被损坏 → 可被修复"的谜题素材。这是把"诚实于神经结构"（宪法 §1）落到产品循环里的最短路径——谜题诚实地长在生物身上，而非贴上去。

### 涌现 / 蚂蚁 / 化学世界 = 已命名、推后的 campaign 层

不是 drop、是 park。Tier 4 涌现（CLAUDE.md test 5/6/7：关联学习、学习+遗忘、多蚂蚁 ChemB 路径跟踪）仍是**中心赌注**，只是推到工坊单回路游戏立住之后作为 campaign / 后期场景。当前 `src/creatures/ant.js` + 化学场 + observation-app 的所有代码继续存在、不删；只是不在主路径上推进。

### 由此衍生的 park 项

- **C-4 HTML JSON 导出的 §6 REJECTED**：park。HTML 不再是 C-3 数字的目标消费者；不急着给 `parseModuleText` 补 meta-only 旁路。`to_module_json` 留着，未来 Bevy 工坊自己的 save/share/leaderboard 会复用它（或显式被新 schema 替换）。
- **C-3 v0.3 / 求值层接入**晋升为新主线：单回路谜题没有 "run" 就没有游戏。

## 当前主角：蚂蚁

> **状态**：parked campaign layer。本节内容仍是有效的生物学/解剖事实，但在 "Bevy 工坊先行" 决定下推到 campaign 阶段做。当前主路径是 Bevy 工坊单回路谜题；蚂蚁身体、传感器、执行器、化学场代码继续存在不删，但不在主线推进。详见上方「产品形态」节。


线虫（nematode）代码封存于 `src/creatures/nematode.js`，不删除。蚂蚁实现为 `src/creatures/ant.js`，作为默认生物。

线虫被替换的原因：线虫的感觉器官拓扑结构（嘴部六感受器纵置、背腹化学感受器）在二维平面上本质不兼容。蚂蚁的左右触角天然适合二维。

## 神经系统架构

### 信号类型
分级信号 0.0–1.0 连续值，不是脉冲。

### 节点类型（共 5 种，不新增）

- **sensor_on** — 绑定物理传感器，输出其分级信号
- **inter_exc** — 兴奋性中间神经元
- **inter_inh** — 抑制性中间神经元
- **modulator** — 调制神经元，调节增益，驱动可塑突触
- **motor** — 绑定物理执行器（肌肉或腺体）

### 节点特性
- Leaky integrator 时间积分
- Spike-frequency adaptation
- Post-inhibitory rebound (PIR)：g_rebound=7.0, tau_rebound=tau×3, tau_adapt=tau×4

### Dale's Law
节点类型决定兴奋/抑制，不是连接本身。inter_exc 输出权重 ≥ 0，inter_inh 输出权重 ≤ 0。

### 连接类型

**固定连接：** 玩家设权重，运行时不变。

**可塑连接（蚂蚁版新增）：** 玩家标记为可塑，指定绑定的 modulator 节点和初始权重。

可塑连接更新规则（每 tick）：
```
Δw = η × pre × post × mod
w = w + Δw
w = w + decay × (w_init - w)    // 向先天基线衰减（遗忘）
w = clamp(w, w_min, w_max)      // Dale's Law 限幅
```

### 可塑突触设计

**MVP 在连接层打标记。** 玩家把任意连接勾为"可塑"并绑定一个 modulator，权重在运行时按上面的规则演化。数据模型刻意保留在连接上（`edge.plastic` + `edge.mod_source_id`）而不是做成节点类型——因为未来会新增"蘑菇体节点"，其所有入边默认可塑。到那时，同一个标记由节点类型推导出来即可，不需要迁移数据。

**生物学根据。** 蚂蚁大脑里真正发生学习的是蘑菇体（mushroom body）的 microglomeruli 区域；其他通路基本硬接线。突触在分钟尺度重塑（学习），在数小时到数天尺度衰减（遗忘）。常量按这个时间尺度选。

**常量硬编码，不暴露给玩家：**
- `LEARNING_RATE` = 0.01
- `WEIGHT_DECAY_RATE` = 0.001

定义在 `src/neural/constants.js`。玩家看不到、调不了。游戏是电路拓扑设计，不是参数调优——把 η 和 decay 做成滑块会让游戏退化成"推杆子找甜点"。若将来涌现测试证明数值有问题，在代码里改一次，并在此节记下理由。

**权重值域：** 固定连接 `weight ∈ [0.1, 1.0]`；可塑连接允许 `w ∈ [0, 1]`（使 `w_init = 0` 的"从零开始学习"场景可达）。符号仍由源节点类型决定（inter_inh 对下游是抑制性贡献），不由 w 携带——magnitude-only 模型。

**modulator 失效时自动降级。** 玩家删除某个 modulator 节点时，绑定到它的可塑连接自动回退为固定连接并打印警告；存档加载时发现 `mod_source_id` 悬空也走同一路径。运行时永远看不到"可塑但 modulator 不存在"的半损状态。

## 化学场

化学场中有 4 种独立化学物质，各自独立扩散和衰减。使用 ChemicalField 类（Float32Array 网格 + 双线性插值）。

| ID | 来源 | 扩散 | 衰减 |
|----|------|------|------|
| ChemA | 环境（食物源） | 中 | 慢 |
| ChemB | 蚂蚁 gland_α（腹部，地面沉积） | 低 | 中 |
| ChemC | 蚂蚁 gland_β（大颚，空气挥发） | 高 | 快 |
| ChemD | 环境（危险区域） | 中 | 慢 |

系统不给化学物质贴语义标签。"ChemB 是路径信息素"是涌现解读，不是定义。

## 蚂蚁硬件

### 传感器（14 通道）

触角化学感受 × 8（左右各 4，每触角对 ChemA/B/C/D 各一通道，锥形采样）
触角机械感受 × 2（左右各 1，碰撞检测）
口器接触化学感受 × 1（味觉，需物理接触）
光感受 × 1（明暗，单通道）
体内状态 × 2（energy 能量储备，damage 伤害感受）

### 执行器（6 通道）

运动 × 3（forward, turn_L, turn_R）
腺体 × 2（gland_α 地面沉积 ChemB, gland_β 空气释放 ChemC；有储量上限和恢复速率）
大颚 × 1（合拢 = 夹持/进食/攻击，物理夹钳不区分功能）

## 架构约束

- 传感器采样复用线虫版 cone sampling
- 生物定义在 `src/creatures/` 目录下，每个物种一个文件
- 多个体同时运行是核心体验，性能必须支持 10+ 只蚂蚁同时跑
- 化学场需要支持生物体主动写入（线虫版只有被动读取）
- 每个腺体的储量/恢复是独立的物理参数，不是全局共享

## 已验证的行为测试（线虫版，需迁移到蚂蚁版）

1. 同侧抑制 → 食物趋近（15 秒内）
2. 时间积分 → 短期记忆（食物消失后速度缓慢衰减）
3. 互相抑制振荡 → 交替激活（9 次切换）
4. 调制神经元 → 状态依赖行为（饥饿时速度提升 75.2%）

蚂蚁版新增验证目标：
5. 可塑突触 → 关联学习（重复经历改变行为）
6. 可塑突触 + 遗忘 → 学习后行为随时间回到基线
7. 群体化学场交互 → 多只蚂蚁通过 ChemB 涌现出路径跟踪行为
