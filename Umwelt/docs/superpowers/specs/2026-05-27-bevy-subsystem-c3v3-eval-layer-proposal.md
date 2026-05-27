# Eval Layer (C-3 v0.3) — Proposal + Open Questions

> Status: **proposal, not spec**. Per user direction (2026-05-27), this exists to
> be reviewed and stress-tested before promotion to a writing-plans-ready spec.
> Don't start implementation from this. The five open questions in §7 must be
> resolved before lifting this to a spec.

## 1. 范围(已锁)

**做**:单回路求值层 —— 输入通道信号(随时间)→ 经电路 → 输出通道信号。求值的"圈
就这一条":输入随时间馈入、神经元更新、边带延迟和衰减地传递、可塑权重按 Hebbian 演化、
读出马达输出 + 活动成本累计。

**守宪法 §4 的诚实物理**:分级 0–1、延迟 ∝ 路径长(C-3 已建)、衰减 exp(−len/λ)
(C-3 已建)、Dale's Law(节点类型决定符号)、可塑 Δw=η·pre·post·mod。

**不做**:世界 / 蚂蚁 / 化学场(park 的 campaign 层)、HTML 编辑器 / UI、多蚂蚁
并行(单蚂蚁先立住)、变 dt / 多速率。

## 2. 这是一次 port —— JS 端就是 source of truth

JS 端有两份求值实现:

| 文件:行 | 角色 |
|--------|------|
| `src/neural.js:603 computeSignals` | 单蚂蚁参照实现,**无 delay 支持**,Map-based |
| `src/neural/batch.js:345 stepBatch` | 多蚂蚁、**有 delay ring buffer**、TypedArray flat — 当前生产路径 |
| `src/neural/constants.js` | `LEARNING_RATE = 0.01`、`WEIGHT_DECAY_RATE = 0.001`、`DELAY_MS_MAX = 500` |
| `src/config.js:12` | `FIXED_DT = 1/60` 秒(=16.667 ms/tick) |
| `delay-test.mjs` | delay 行为的 oracle |
| `attenuation-test.mjs` | 衰减的 oracle |
| `plasticity-unit-test.mjs` | Hebbian 数学的 oracle(closed-form C2 测试) |
| `batch-parity-test.mjs` | computeSignals ↔ stepBatch 在 delay=0 上的 bit-for-bit 等价 oracle |

**Bevy 端口对 stepBatch**(不是 computeSignals):
- delay 是 Bevy 工坊的灵魂(C-2 + C-3 那条距离 → 延迟链路存在的全部理由),只有 stepBatch 实现了它
- TypedArray flat 布局天然映射 Bevy 的 `Vec<f32>` / `SmallVec` 结构,没有 Map indirection
- 它是 JS 端的生产路径,游戏跑起来用的就是它

所有动力学公式 / 常数都从 JS 出处引,**不自己重新发明**。任何偏离都得标 reason 并 surface
到 review。

## 3. Time / dt

JS 端的事实(`config.js:12` + `batch.js:88, 230-235`):
- `FIXED_DT = 1/60` 秒,即 `refDtMs = 1000/60 ≈ 16.667 ms`
- `edgeDelayTicks[e] = Math.round(edge.delay_ms / refDtMs)`
- Ring buffer 大小 = `maxDelayTicks + 1`,索引 `tick % ringSize`
- `delay_ms ∈ [0, DELAY_MS_MAX=500]`,即 [0, 30] ticks
- Leaky integrator 步:`state' = state + (drive - state) * (dt / tau)`,显式 Euler

**Bevy 端口提议**:
- `EVAL_DT_SECONDS = 1.0 / 60.0` 常数,定义在 `crates/grid_workshop/src/constants/eval.rs`(新文件)
- `delay_ticks_for(edge) = (edge.delay_ms_to_leaf(leaf) / 1000.0 / EVAL_DT_SECONDS).round() as i32`
- 同显式 Euler,**不**升级到 backward-Euler / trapezoidal —— 偏离会废掉 bit-for-bit oracle(见 Q1)

**这把 C-3 的两个 PROVISIONAL 钉死了**:
- `V_REF_M_S` 的不确定性来自 "等 dt 定下来才知道 round 出几个 tick"。现在 dt = 1/60 锁了,
  `V_REF` 的"游戏感"目标也具体化:让玩家可感的延迟范围 = [0, 30] ticks,对应 [0, 500] ms,
  对应 path length [0, ~V_REF × 500e-3 × 1e6] μm = [0, V_REF × 500] μm(当 V_REF 单位是 m/s)。
  V_REF = 0.3 m/s → 远端边可达 ~150 μm 延迟 30 ticks = 半秒。**留 V_REF=0.3 为 PROVISIONAL,
  在 puzzle harness 跑起来后看玩家是否能感受到延迟差异再调**。
- `P_ACTIVITY_COEF` 的活动成本表达式现在能写出来:`cost = sum_over_ticks(sum_over_neurons(output × COEF × dt))`。
  PROVISIONAL 还是 PROVISIONAL,得跑 puzzle 看 static:activity 比例是否撑得起决策。

## 4. 单 tick 算法(Bevy 端口规范)

直接对应 `batch.js:345-543` 的五步,行号引在每步:

**Step 1** —— Snapshot prevOutput(L367-373):对所有节点按"上一 tick 的 effective output"算
`prev_output[i] = node_output_for_type(kind[i], state[i], adapt[i])`。这是 Bevy 端口要带的"快照"
模式 —— 整个 tick 的边累加全部读这个快照,不让快读快写在同一 tick 内可见。

**Step 2** —— Sensor latch(L378-390):把外部 `sensor_inputs[s] ∈ [0,1]` 直接写到
`state[sensor_idx]`、清零 adapt 和 h_rebound、`output[sensor_idx] = state[sensor_idx]`。**sensor 这一帧的
output 立刻可见**(Step 3 里 sensor source 读 `output`,非 sensor source 读 `prev_output`)。

**Step 3** —— Feedforward eval(L404-508):对每个非 sensor 节点 i 按 evalOrder:
- 累加入边:
  - source 信号 src = `if delay_ticks <= 0 { if sensor: output[from] else: prev_output[from] } else: history[a*N*ring + from*ring + slot]`,slot = `((tick - delay_ticks) % ring + ring) % ring`
  - effW = `if plastic { clamp_dale(plastic_w[e]) } else { clamp_weight(weight[e]) }`
  - contrib = `clamp(src, 0, 1) * effW * atten[e]`
  - 按 edgeKind 入桶:EK_EXC → excSum,EK_INH → inhSum,EK_MOD → `gain *= gain_from_mod(src*atten, effW)`
- `gain = clamp(gain, MOD_GAIN_MIN=0.1, MOD_GAIN_MAX=3.0)`
- `netInput = (excSum - inhSum) * gain`
- 按 NeuronKind 分支(L473-501)更新 state / adapt / h_rebound:
  - **Motor**:`output = clamp(netInput, -1, 1)`、`state = output`、`adapt = 0`、`h_rebound = 0`
  - **Modulator**:`drive = clamp(netInput, 0, 1)`、`state' = state + (drive - state) * (dt / tau)` clamp [0,1]、`output = state'`
  - **InterInh**(Matsuoka + 累积 PIR):
    ```
    if state < REBOUND_THRESHOLD && inhSum > 0:
        h = h + inhSum * 0.8 * dt
    else:
        h = h * exp(-dt / TAU_DISCHARGE)
    h = clamp(h, 0, MAX_H_REBOUND=1.5)
    drive = excSum*gain - W_INH*inhSum*gain - 2.0*adapt + G_REBOUND*h_next
    state' = state + (-state + drive) * (dt / tau)  clamp [-1,1]
    eff = clamp(state', 0, 1)
    adapt' = adapt + (-adapt + eff) * (dt / TAU_ADAPT)  clamp [0,1]
    output = clamp(eff - adapt' * ADAPT_SUBTRACT_SCALE, 0, 1)
    ```
  - **InterExc**(简单 leaky + 适应):
    ```
    state' = state + (netInput - state) * (dt / tau)  clamp [-1,1]
    eff = clamp(state', 0, 1)
    adapt' = adapt + (eff - adapt) * (dt / TAU_ADAPT)  clamp [0,1]
    output = clamp(eff - adapt' * ADAPT_SUBTRACT_SCALE, 0, 1)
    ```

**Step 3.5** —— Record history(L510-520):`history[i*ring + tick%ring] = output[i]`,然后 `tick += 1`。

**Step 4** —— Plastic update(L522-542),**用 THIS tick 的 output**(批注 L725-728 明确这是设计选择):
```
for each plastic edge e:
    mod_idx = edge.mod_source_id  // -1 → skip
    pre  = clamp(output[from], 0, 1)
    post = clamp(output[to],   0, 1)
    mod  = clamp(output[mod_idx], 0, 1)
    cur = plastic_w[e]
    dw    = LEARNING_RATE * pre * post * mod
    decay = WEIGHT_DECAY_RATE * (edge.weight - cur)   // toward authored baseline
    plastic_w[e] = clamp_dale(cur + dw + decay)
```

**常数清单**(逐一从 `batch.js:39-53` 引):

| 常数 | 值 | 来源 |
|------|----|------|
| `EDGE_WEIGHT_MIN` | 0.1 | batch.js:39 |
| `EDGE_WEIGHT_MAX` | 1.0 | batch.js:40 |
| `MOD_GAIN_MIN/MAX/BASELINE` | 0.1 / 3.0 / 1.0 | batch.js:41-43 |
| `W_INH` | 2.0 | batch.js:44 (inhibitory drive amp) |
| `ADAPT_SUBTRACT_SCALE` | 0.6 | batch.js:45 |
| `MAX_H_REBOUND` | 1.5 | batch.js:46 |
| `DEFAULT_TAU[kind]` | sensor:0.5 / exc:3 / inh:3 / mod:15 / motor:0 | batch.js:47 |
| `DEFAULT_TAU_CHARGE` | 4.0 | batch.js:48 |
| `DEFAULT_TAU_DISCHARGE` | 10.0 | batch.js:49 |
| `DEFAULT_G_REBOUND` | 7.0 | batch.js:50 |
| `DEFAULT_REBOUND_THRESHOLD` | 0.5 | batch.js:51 |
| `LEARNING_RATE` | 0.01 | constants.js:11 |
| `WEIGHT_DECAY_RATE` | 0.001 | constants.js:12 |

按 Decision Protocol Constants 节:这些是 **scale/balance** 类(不是 ratio-locked),
继承 JS 的标定结果,**标 inherited PROVISIONAL,不重新调,但允许游戏跑起来后调**。

## 5. Golden oracle —— JS 是测试参照

防 port 走样的主防线 = **用 JS 端跑出来的 trace 当 Bevy 端单元测试 fixture**。

**步骤**:
1. 在 JS 仓写一个 `tools/dump-oracle-fixtures.mjs`,对每个 oracle 测试构图、跑 stepBatch、把
   `(sensor_input_timeline, motor_output_trace, key_state_snapshots)` 序列化成 JSON,落到
   `crates/grid_workshop/tests/fixtures/eval/<name>.json`
2. Bevy 端 integration test `tests/eval_oracle.rs` 读 JSON、构 Grid+Routes 等价图、用 EdgeOps 接线、
   跑端口 stepBatch、`approx::assert_relative_eq!(bevy_trace, js_trace, max_relative=1e-5)`

**oracle 列表**(初选,可加):

| Oracle | JS 文件 | 测什么 |
|--------|---------|--------|
| `delay-echo` | delay-test.mjs:99-114 | delay_ticks 整数移位、history ring 索引 |
| `attenuation-half` | attenuation-test.mjs:116-122 | atten=0.5 → 输出 ≈ 0.5(几乎纯倍乘) |
| `hebbian-saturation` | plasticity-unit-test.mjs C2 | pre=post=mod=1 时 w 渐近 ≈ η/decay = 10,实际 clamp 到 1.0 |
| `parity-no-delay` | batch-parity-test.mjs | computeSignals 与 stepBatch 在 delay=0 时 bit-for-bit;Bevy 端口跑出的 trace 同时对得上两个 |

**容忍**:`max_relative=1e-5`(浮点误差累积允许;严格 bit-for-bit 不现实 —— Rust f32 与 JS Number=f64
内部差异)。如果哪个 oracle 在 1e-5 容忍下还过不了,这就是 surface point(可能 port 漂了,或 dt 取整搞错了)。

## 6. Puzzle harness 形状

代码级接口,无 UI。`crates/grid_workshop/src/eval/puzzle.rs`(新文件):

```rust
pub struct Puzzle {
    pub sensors: Vec<CellCoord>,         // 哪些 SensorOn 神经元当输入端口(按这个序喂)
    pub motors: Vec<CellCoord>,          // 哪些 Motor 神经元读输出
    pub input_timeline: Vec<Vec<f32>>,   // [tick][sensor_idx] → value ∈ [0,1]
    pub expected: Expected,
    pub par: ParTarget,
}

pub enum Expected {
    OutputTrace { motor_traces: Vec<Vec<f32>>, tol: f32 },
    ThresholdByTick { motor_idx: usize, by_tick: usize, value: f32, op: Cmp },
    NoOscillation { motor_idx: usize, max_zero_crossings: u32 },
    // 后续按谜题需要扩展
}

pub struct ParTarget {
    pub total_volume_um3:  f32,
    pub total_membrane_um2: f32,
    pub total_power_pj_s:   f32,   // = static (C-3) + activity (eval-derived)
    // hull / max_delay 暂不入 par,先等谜题真跑出来后定
}

pub struct PuzzleResult {
    pub passed:          bool,
    pub fail_reason:     Option<String>,
    pub static_cost:     OrganStatic,            // C-3 直接给
    pub activity_pj:     f32,                    // 端口 eval 累积出来的活动能量
    pub par_pass:        ParStatus,              // 各轴是否在 par 内
    pub motor_trace:     Vec<Vec<f32>>,          // 给 dump / 调试
}

pub fn run_puzzle(puzzle: &Puzzle, grid: &Grid, routes: &Routes) -> PuzzleResult { ... }
```

**成本汇报 = C-3 静态 + 求值层活动**:正接 C-3 spec §3.2 的静态/运行时切分。Static 部分(膜
维持、突触维持、被动)在 grid 编辑期已经能算;activity 部分(=`P_ACTIVITY_COEF × output_per_tick`
累计)只能在 eval 跑起来后给。

**一个最小 demo puzzle**(在 C-3 v0.3 落地时一并写出来当 proof-of-concept):
- "Step-response":1 sensor + 1 motor + 1 中间 inter_exc。sensor 输入 60 ticks 0、然后 60 ticks 1,
  期望 motor 在 sensor=1 后 N ticks 内升到 > 0.8。Par 三轴。验证整条管路通了。
- 玩家级别的有趣谜题先**不**定，先把 harness 跑通

## 7. Open Questions(要 review)

按 Decision Protocol "do route":这些是有 model/biology 维度、我没把握用工程方便选定的岔口。

### Q1. 积分格式:显式 Euler 还是别的?

JS 用显式 Euler,稳定区间 `dt/tau ≤ 1` —— 现在最严苛是 sensor 的 tau=0.5,dt/tau=0.033,
非常稳定。Bevy 端口的选项:
- (a) **同 JS,显式 Euler** —— oracle bit-for-bit(在 1e-5 容忍下)可行,主防线在
- (b) Backward-Euler / 梯形 —— 更高阶,但偏离 oracle,主防线废
- (c) RK4 —— 同上,且 step 计算贵 4 倍

**我建议 (a)**。但这是 model 决定:JS 的标定就在显式 Euler 上做的,换积分等于换游戏感。要换的话
得重新调 W_INH / TAU 等。

### Q2. Eval order(同 tick 内非 sensor 节点的更新顺序)

JS 用 `(x, y)` 画布坐标 lex sort(`neural.js:629-630` / `batch.js:93`)。Bevy 没有 (x,y),
有 `CellCoord(i, j, k)`。选项:
- (a) `(i, j, k)` lex —— 把 JS 的"左上到右下"直译到 3D
- (b) `(k, j, i)` —— 层为主序,先小层后大层(直觉:信号从浅层流到深层)
- (c) 拓扑排序,平局按 (a) 或 (b) 打破
- (d) 同 step 内不分先后,所有非 sensor 节点都读 prev_output(算法上等价于"全部并行"),
      则 eval order 不影响结果

**关键**:这是 model fork。它直接影响"反馈环"在一 tick 内的展开行为。**我倾向 (d)**:
读 prev_output 已经是 JS 的设计(L399-403 评论说"removing the per-target interleaved fresh-read
restores parity"),即 JS 端实际上 eval order **对结果不敏感**(在 stepBatch 模式下)。Bevy 端口
任何序都不影响数值,选 (a) 最简单可复现。但需要 user 确认这个解读。

### Q3. 通道 I/O 绑定 —— SensorOn / Motor 神经元怎么知道自己是哪个输入/输出?

这是 §5 物理通道契约。神经元身份(SensorOn)只说"我是个 sensor",不说"我是左触角 ChemA 远端"。
选项:
- (a) 神经元自带 `channel: Option<ChannelId>` 字段 —— 数据落在神经元上
- (b) 关卡定义有 `PortBinding: HashMap<CellCoord, ChannelId>` 表 —— 数据落在关卡上
- (c) Puzzle 自带 ordered `sensors: Vec<CellCoord>` 和 `motors: Vec<CellCoord>` —— 通道身份纯
      靠位置序,神经元保持匿名 —— **本提案 §6 的草稿用的就是这个**

**我建议 (c)** —— 守宪法 §1 "诚实于神经结构的逻辑":神经元不知道自己服务于哪条通道,通道
身份是外部契约。同时跟 [[umwelt-export-only-what-you-own]] 一致:神经元只导自己拥有的东西
(类型 + 坐标),通道绑定归关卡。**这是 model fork,要 user 确认是否同意**。

如果 user 选 (a) 或 (b),C-4 之前那个 §6 REJECTED 的处置也会一并改 —— 因为 module JSON 的
`graph` 块里就要带 sourceId 类信息了。

### Q4. inter_inh Matsuoka 常数(W_INH=2.0、scale 0.8、ADAPT_SUBTRACT_SCALE=0.6、
MAX_H_REBOUND=1.5、G_REBOUND=7.0)

这些是 scale/balance 类(Decision Protocol),JS 端调出来给"互相抑制振荡"这个测试用的。
不是 ratio-locked(没有物理根据钉它们)。

选项:
- (a) **直接继承 JS 的数值** —— 同游戏感,oracle 可用
- (b) 重新调 —— 用 Bevy 的 puzzle 重新平衡,oracle 废

**我建议 (a)** —— 跟 Q1 同理,调常数等于换 oracle。游戏跑起来玩家不满意再调,标 inherited
PROVISIONAL。

### Q5. 编译拓扑(`compile_topology`)的所有权和失效

JS 端 stepBatch 用 `Topology`(flat TypedArray 索引),`compileTopology` 在 graph mutates 时重建。
Bevy 端口:
- (a) `EvalTopology` 是 `Routes` 的私有内部,EdgeOps 改变结构时 Routes 标 dirty,run_puzzle 内部
      lazy 重建
- (b) `EvalTopology` 是单独的 Bevy `Resource`,EvalPlugin 监听 EdgeOps 事件做缓存失效
- (c) **没有缓存**,run_puzzle 每次跑从头编译 —— 谜题级别一次,每个 puzzle 编译开销忽略

**我建议 (c)** —— puzzle harness 是离线 / 单次 run-and-check 风格,不是 60 FPS realtime。
runtime 那条路(给将来的 Bevy UI 实时运行)再考虑缓存。**这是工程决定,不是 model fork**,但
还是 surface 一下让 user 确认 scope。

## 8. 非目标(明确写出来)

- **不**碰世界 / 蚂蚁 / 化学场 / 感觉器官的物理采样
- **不**做 HTML 编辑器或 UI
- **不**做多蚂蚁并行(JS stepBatch 是多蚂蚁的,Bevy 端口先单蚂蚁,A=1 硬编)
- **不**做 save/load eval state
- **不**做 V_REF / activity coef 的最终标定 —— 留 PROVISIONAL,puzzle 跑起来后调

## 9. 任务分解(预览,不是 plan)

待 Q1–Q5 review 后定稿,目前大致 8–9 个 task:

1. `constants/eval.rs` —— EVAL_DT_SECONDS + 端口过来的 13 个常数,带"inherited from JS" 注释
2. `eval/topology.rs` —— EvalTopology(flat tensors 从 Grid+Routes 编译)
3. `eval/step.rs` —— port stepBatch 主循环(**无 delay**)
4. delay ring buffer + history 索引
5. plastic 更新
6. JS 端 `tools/dump-oracle-fixtures.mjs` —— 4 个 oracle 的 JSON dump
7. `tests/eval_oracle.rs` —— 读 fixture,断言 max_relative ≤ 1e-5
8. `eval/puzzle.rs` —— Puzzle / Expected / ParTarget / run_puzzle 骨架
9. Step-response demo puzzle 跑通,worklog 收尾

## 10. 验收的形状(预演)

- 4 个 JS-derived oracle test 在 max_relative=1e-5 容忍下全绿
- Step-response demo puzzle 给出 PuzzleResult,三轴成本能读
- `cargo test -p grid_workshop` + clippy dev/release 干净
- worklog 记两个 PROVISIONAL(V_REF、activity coef)在 puzzle 跑起来后的下一步调谁
