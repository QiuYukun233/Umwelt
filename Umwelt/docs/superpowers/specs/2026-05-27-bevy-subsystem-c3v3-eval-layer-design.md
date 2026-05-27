# Eval Layer (C-3 v0.3) — Design Spec v0.1

> Status: **spec**, promoted from proposal after user review (2026-05-27).
> The five forks (originally §7 "open questions") were all resolved by user;
> §7 is now **Locked Decisions** and the rationale for each is preserved.
> Ready for writing-plans.

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
`output_prev[i] = node_output_for_type(kind[i], state[i], adapt[i])`。Bevy 端口要把这个写成
**结构性双缓冲**(不是"碰巧读了 prev"):

- 类型上显式两个缓冲:`output_prev: Vec<f32>` 与 `output_next: Vec<f32>`
- Step 1 从 `(state, adapt)` 计算 `output_prev`(整个 Step 3 的读源)
- Step 3 **只写** `output_next`,**只读** `output_prev`(以及 sensor 的 `output`,Step 2 latched)
- Step 3.5(history record)和 Step 4(plastic)按 §4 的指定读 `output_next`(=this tick's output)
- Tick 末 `swap(output_prev, output_next)` —— 下一 tick 的 Step 1 重算 prev,buffer 复用

**为什么结构性而非"算法上等价就行"**:同步更新下,没有 fixture 会暴露"序依赖"—— 把
`output_prev` 偷换成同 tick 的 `output_current` 在大多数图上数值差异极小,oracle 在 1e-5
容忍下兜不住。将来谁要"优化"成原地更新(read current, write current),序就**偷偷有意义**、
跟 JS 悄悄分叉,而 oracle 不响。**结构性双缓冲(类型上分离两个 buffer)才是这条的真防线**。
JS 实现里 prevOutput 就是单独 array(L367),Bevy 端口照搬这条物理分离,不能合并。

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

**oracle 列表**(5 个,前 4 个单边物理 + 第 5 个涌现时序):

| Oracle | JS 文件 | 测什么 |
|--------|---------|--------|
| `delay-echo` | delay-test.mjs:99-114 | delay_ticks 整数移位、history ring 索引 |
| `attenuation-half` | attenuation-test.mjs:116-122 | atten=0.5 → 输出 ≈ 0.5(几乎纯倍乘) |
| `hebbian-saturation` | plasticity-unit-test.mjs C2 | pre=post=mod=1 时 w 渐近 ≈ η/decay = 10,实际 clamp 到 1.0 |
| `parity-no-delay` | batch-parity-test.mjs | computeSignals 与 stepBatch 在 delay=0 时 bit-for-bit;Bevy 端口跑出的 trace 同时对得上两个 |
| `oscillator-mutual-inhibition` | test-neural.mjs:173-231 (Test 3) | 互抑 + PIR 的振荡涌现时序 —— port 最容易走样的一类 |

**为什么必须有第 5 个**:前 4 个测**单边物理**(delay、衰减、单边可塑、无延迟基线)。port 最容易
走样的不是单边公式,而是**多个组件组合后的涌现时序**,尤其调了很久的振荡器(互抑 + PIR + adapt
三股力的平衡)。单边对 ≠ 组合时序对。test-neural.mjs Test 3 是 JS 端最硬的验证资产 ——
A↔B 互抑、`tau=1.5, g_rebound=7, tau_discharge=0.4`、F0 持续输入 1200 ticks(20 秒 @ 60Hz)、
判定 "switches ≥ 6"(三个完整振荡周期)。

**第 5 个 oracle 的具体形状**:
- 提取**纯电路**版(去掉 world.composeSourceOutputs / world.ant / 食物位置那些),sensor F0
  直接喂 1.0 ×1200 ticks
- 同样 dump 双 motor trace(leftLeg、rightLeg)的逐 tick 输出 + 每个 tick 的 nodeA/B 的
  (state, adapt, h_rebound)用作回归断言点
- Bevy 端口在同样的 fixture 下,断言:
  1. **trace 数值相对误差** ≤ 1e-5(强断言,跟前 4 个 oracle 同标准)
  2. **switches ≥ 6** —— JS Test 3 的原判定,弱断言,留作行为级 backstop
- 强弱并存的原因:数值断言对漂移敏感(早 catch),switches 断言确保即使漂了也至少**行为类等价**

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

## 7. Locked Decisions(user review 2026-05-27)

原本是 5 个 open questions,user 一次性裁定全部。每条记入"LOCKED:" + 决定理由,保留备选与
否决路径,方便日后回看。

### Q1. 积分格式

**LOCKED: 显式 Euler(同 JS)**。理由:换格式 oracle 直接废,没得选。JS 的常数标定就在显式 Euler 上
做的,换积分等于换游戏感、且废主防线。备选 backward-Euler / RK4 在本期不考虑。

稳定性满足:最严苛是 sensor tau=0.5,dt/tau=0.033 << 1。

### Q2. Eval order —— 结构性双缓冲

**LOCKED: 结构性双缓冲**(详见 §4 Step 1 的展开)。原帖说"读 prev_output 让序不敏感"方向对,
但实现上必须**类型分离**两个 buffer (`output_prev` / `output_next`),不能写成"碰巧读了 prev"。

**为什么结构性而非算法等价**:同步更新下,序依赖不会被任何 fixture 暴露(在大多数图上数值漂移
小于 1e-5 oracle 容忍)。将来谁要"优化"成原地更新(read current, write current),序就**偷偷
有意义**、跟 JS 悄悄分叉,oracle 不响。结构性双缓冲(类型上两个 buffer)才是真防线。JS 实现里
prevOutput 是单独 array(`batch.js:367-373` 已 verified),Bevy 端口照搬这条物理分离,不允许
合并优化。

`(i, j, k)` lex 保留为**稳定的任意序**(deterministic but semantically meaningless),不带语义。

### Q3. 通道 I/O 绑定 —— 神经元匿名,Puzzle 持有有序 CellCoord 列表

**LOCKED:** Puzzle 自带 `sensors: Vec<CellCoord>` 和 `motors: Vec<CellCoord>` 的 ordered list;
神经元本身不知道自己服务于哪条通道。

**宪法引用**:这是 **宪法 §5 "Meaning has no label; it is built"** —— 哪个坐标是哪个通道,
由关卡的**物理 I/O 契约**说,不刻在神经元上。电路保持纯结构、可复用。(§1 只沾"用坐标当 handle"
那一点,跟通道绑定不是同一回事;之前 proposal 引 §1 是错的。)

否决的两个备选:
- (a) 神经元自带 `channel: Option<ChannelId>` —— 神经元被打上语义标签,违 §5
- (b) `PortBinding: HashMap<CellCoord, ChannelId>` 关卡级表 —— 跟 (c) 等价但更繁,留作 (c) 的
  future generalization 即可

**对 C-4 的连锁**:这条**不反推 un-park C-4**,反而**坐实 park**。绑定在外部、神经元匿名 ——
所以将来要导一个 HTML 真能吃下的完整 module,除了 `graph` 块外**还必须带一个 "coord → 物理
通道" 的绑定块**(spec 7.1 草案里的 `receptors` 数组就是这一类)。那是 C-4 park 在等的未来
子系统:**关卡 I/O 契约**。**将来导出形状 = graph + coord→channel 块**,需要的是另一个子系统
先存在,而非 HTML 端补 meta-only 旁路。**C-4 继续 park,不动**。

### Q4. inter_inh Matsuoka 常数

**LOCKED: 继承 JS + 标 inherited PROVISIONAL**(W_INH=2.0、PIR 累积 scale 0.8、
ADAPT_SUBTRACT_SCALE=0.6、MAX_H_REBOUND=1.5、G_REBOUND=7.0)。理由:为 oracle 先照搬,
puzzle 跑起来再调。这些是 Decision Protocol 的 scale/balance 类,允许调,但**现在调 = oracle 废**。

### Q5. EvalTopology 缓存策略

**LOCKED: 不缓存,每次 run_puzzle 从头编译**。理由:离线 harness 不要 realtime;每次重编译省掉
缓存失效的复杂度,谜题级别一次的编译开销忽略。Realtime UI 路径将来另说,不在本期。

## 8. 非目标(明确写出来)

- **不**碰世界 / 蚂蚁 / 化学场 / 感觉器官的物理采样
- **不**做 HTML 编辑器或 UI
- **不**做多蚂蚁并行(JS stepBatch 是多蚂蚁的,Bevy 端口先单蚂蚁,A=1 硬编)
- **不**做 save/load eval state
- **不**做 V_REF / activity coef 的最终标定 —— 留 PROVISIONAL,puzzle 跑起来后调

## 9. 任务分解(预览,plan 阶段细化)

大致 9 个 task:

1. `constants/eval.rs` —— EVAL_DT_SECONDS + 端口过来的 13 个常数,带 "inherited from JS" 注释 +
   inherited PROVISIONAL 标记(Q4)
2. `eval/topology.rs` —— `EvalTopology`(flat tensors 从 Grid+Routes 编译);(i,j,k) lex 作 stable
   任意序;**不**缓存(Q5),`compile()` 是纯函数
3. `eval/step.rs` —— port stepBatch 主循环,**结构性双缓冲**(output_prev / output_next 类型分离,
   每 tick swap)(Q2);**无 delay**
4. Delay ring buffer + history 索引(`history[i * ring + tick%ring]`)
5. Plastic 权重更新(`output_next` 作 this-tick output)
6. JS 端 `tools/dump-oracle-fixtures.mjs` —— **5 个** oracle 的 JSON dump(含 Test 3 振荡器,从
   `test-neural.mjs:173-231` 提取纯电路版,去掉 world.composeSourceOutputs)
7. `tests/eval_oracle.rs` —— 读 fixture,断言 trace `max_relative ≤ 1e-5`;振荡 oracle 额外加
   "switches ≥ 6" 行为级 backstop
8. `eval/puzzle.rs` —— Puzzle / Expected / ParTarget / run_puzzle 骨架;`sensors: Vec<CellCoord>` +
   `motors: Vec<CellCoord>` ordered list(Q3)
9. Step-response demo puzzle 跑通,worklog 收尾

## 10. 验收的形状(预演)

- **5 个** JS-derived oracle test 在 `max_relative=1e-5` 容忍下全绿(`delay-echo` + `attenuation-half` +
  `hebbian-saturation` + `parity-no-delay` + `oscillator-mutual-inhibition`)
- 振荡 oracle 额外 `switches ≥ 6` backstop 通过
- Step-response demo puzzle 给出 `PuzzleResult`,三轴成本(static + activity)能读
- `cargo test -p grid_workshop` + clippy dev/release 干净
- worklog 记两个 PROVISIONAL(V_REF、activity coef)在 puzzle 跑起来后的下一步调谁;Q4 的
  inter_inh inherited PROVISIONAL 也在 worklog 留迹
