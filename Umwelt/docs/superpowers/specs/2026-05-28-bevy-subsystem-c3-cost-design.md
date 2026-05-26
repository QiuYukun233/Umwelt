# Bevy 子系统 C-3 — 成本数字(静态派生量)设计规格

> **状态**:草案 v0.1
> **日期**:2026-05-28
> **上位**:`docs/umwelt_design_constitution.md`(尤其 §1 空间是真的、§4 分级信号 / 衰减 / 代谢 / √d、§5 正交不合并),`docs/superpowers/specs/2026-05-22-bevy-workshop-grid-substrate-design.md`(工坊 spec §4 物理约束),`docs/superpowers/specs/2026-05-26-bevy-subsystem-c2-routing-design.md`(C-2 routing,Edge 数据形状)
> **依赖**:C-2 落地结果(`grid_workshop::routing`:`Edge { tree, thickness_d, plastic, mod_source }`、`Routes`、`EdgeOps`)
> **下位**:C-3b 横截面渲染(独立 spec,等 UI / 相机子系统就位再开)、C-4 HTML JSON 导出(本 spec 收缩 C-4 的作用域,见 §1.2)

---

## 1. 目标

### 1.1 做什么

把 C-2 落下的几何 + `Edge.thickness_d` 拧到真实物理常数上,在 routing 数据结构旁边长出一层**静态成本数字**,让上层(求值层、UI、par、HTML 导出)可以读"这条边的延迟、这条边到每个叶的衰减、这只器官的总静态代谢、这只器官每层凸包、…"等量。

四个代价量按宪法 §4 + 工坊 spec §4 的约定:

1. **延迟(delay)** — 沿轴突路径 pathlen × 1/v(d),按毫秒。
2. **衰减(attenuation)** — 远端信号系数 = exp(−pathlen / λ(d))。**每个叶子**有自己的 pathlen,所以一棵树有 N 个叶 → N 个衰减系数。
3. **代谢功率(power)** — 瞬时功率 pJ/s,**静态部分**:每神经元的静息功率 + 每边沿体积的维持功率 + 每突触的维持功率。活动项在运行时层算(见 §2)。
4. **体积(volume)** — 神经元胞体体积 + 每边的体积(d² × pathlen,常数因子见 §5.3);用于代谢维持和总体积预算。

加几何聚合:

5. **逐层凸包足迹** — 每一层的占用 cell 投影到 (x, y) 后求凸包面积;总几何代价 = Σ 各层足迹 × 层高 h。**逐层求和,不是合并 footprint × 总层数**(宪法 §1)。

### 1.2 不做什么 / 边界

- **不做横截面渲染、相机、层切换、mesh 化** —— 拆 C-3b,等 UI / 相机子系统先立起来再说。本 spec 写完后 C-3b 仍是 placeholder,不在本子系统作用域内。
- **不做活动项 / 真正的瞬时功率 / 真正的远端信号** —— 那些是结构 × 运行时输入的函数,归求值层,见 §2。
- **不做"代谢预算上限 / par 比对 / UI 显示数字"** —— C-3 只提供数,上层(关卡系统、par 系统、UI HUD)拿数比对。
- **不内置 cost-combining "效率分数"** —— 宪法 §5:成本是正交量,绝不合并。任何聚合方法只暴露**各项分开**,不暴露"总分"。
- **HTML JSON 导出不在 C-3** —— 但所有 HTML 导出会用到的常数(λ、v、p_*、体积公式)都集中在 C-3 的 `constants/biology.rs`。C-4 收缩为"按 HTML schema 把 C-3 算出的数填进 JSON",不再持有任何生物常数。

### 1.3 对 C-2 §1 的勘误

C-2 spec §1(`2026-05-26-bevy-subsystem-c2-routing-design.md` 行 31)写"`constants/biology.rs` 真实数值 —— C-4"。**本 spec 取消该归属**:常数表归 C-3。理由:四个代价量里只有体积是纯几何;delay / 衰减 / 功率没有真实常数 + 单位就是空话,把"常数"和"用常数的数学"分到不同子系统会把单子系统拆成两个不闭环的半成品。

C-2 spec 不回填 —— 本 spec §1.3 作为权威修订记录,后续如有冲突以本 spec 为准。

---

## 2. 静态 vs 运行时:必须画死的线

C-3 最容易出错的地方,所以单独立一节。

### 2.1 静态部分(C-3 算、C-3 测、C-3 缓存或按需算 — 见 §3.4)

| 量 | 公式 | 输入 |
|---|---|---|
| edge delay_ms | pathlen / v(d) | pathlen(几何)、d、`v_ref`(常数) |
| edge attenuation 系数(per leaf) | exp(−pathlen_leaf / λ(d)) | pathlen_leaf、d、`lambda_ref` |
| edge volume | k_vol × d² × pathlen | pathlen、d、`k_vol`(几何常数,见 §5.3) |
| neuron resting power | `p_rest_per_neuron` | 常数 |
| edge volume-maint power | edge_volume × `p_maint_per_volume` | edge_volume、常数 |
| synapse maint power(per leaf) | `p_maint_per_synapse` | 常数 |
| neuron activity coefficient | `p_activity_coef_per_neuron` | 常数(单位 pJ/s,乘 [0,1] 激活) |
| 逐层凸包足迹 | ConvexHull2D(layer cells projected to xy) | Grid neurons + edge wire cells |
| 器官静态总功率 | Σ neuron rest + Σ edge volume-maint + Σ synapse maint | 上面三者 |
| 器官总体积 | Σ neuron body volume + Σ edge volume | 几何 + d |
| 器官几何足迹积 | Σ 逐层凸包 × `layer_height_um` | 凸包 + 层高常数 |

**这一层只读结构(Grid + Routes + d + 常数),不读任何运行时激活值。** 任何带 *t* 下标的量都不在 C-3 数据里。

### 2.2 运行时部分(NOT C-3 —— 归求值层 / eval crate / batch 求值器)

| 量 | 公式 | 输入 |
|---|---|---|
| 真正远端信号 | source(t) × attenuation_coef | C-3 的衰减系数 × 求值层的当前 source |
| 神经元活动项功率 | `p_activity_coef_per_neuron` × activation(t) | C-3 的系数 × 当前激活 |
| 器官瞬时总功率 | 静态总 + Σ 神经元活动项 | C-3 静态总 + 上一行 |

**Edge 上不放"瞬时功率"字段。Routes 上不暴露"当前总功率"读法。** 这些是求值层的事。C-3 只交付"系数 + 静态部分",求值层乘上当前激活后才得到瞬时数。

### 2.3 为什么这条线必须死

宪法 §4 的原话(行 59):"The activity term is **instantaneous power ∝ mean activation, NOT a time-integral** — an integral would couple metabolism to runtime and break orthogonality with the delay/cycles axis."

如果 C-3 在 Edge 上放一个"当前功率"字段,它就必须在每个 tick 写一次 —— 写动作只能由求值层做,但求值层不该往 routing 数据里写。把这个量留给求值层在自己的批数据里持有,routing 一侧保持只含结构 + 静态量,数据流单向。

---

## 3. 数据形状

### 3.1 Edge 的静态派生量

C-2 的 `Edge { tree, thickness_d, plastic, mod_source }` 不改字段。新增**派生视图**:一个 Edge 的静态成本可以表达为(类型只是说明语义,实际是缓存还是按需算见 §3.4):

```
EdgeStatic {
    volume_um3 : f32,                   // k_vol × d² × pathlen_total
    delay_ms_per_leaf : { leaf_idx -> f32 },
    attenuation_per_leaf : { leaf_idx -> f32 },   // exp(−pathlen_leaf / λ(d))
    volume_maint_pj_s : f32,            // volume × p_maint_per_volume
    synapse_maint_pj_s : f32,           // n_leaves × p_maint_per_synapse
    static_total_pj_s : f32,            // volume_maint + synapse_maint
}
```

注意:**衰减和延迟是 per-leaf 的**,因为 Edge 是 tree、不同叶有不同的 pathlen。`leaf_idx` 来自 C-2 `PathTree::leaves()` 的 index。

`pathlen_total` = 树上所有 cell-邻接段长度之和(对树体积/维持功率有意义)。`pathlen_leaf` = 从 root 到该 leaf 的 parent 链 cell-邻接段长度之和(对该叶的延迟/衰减有意义)。两者不同。

**单位**:`pathlen` 单位是 μm,不是 cell 数;cell→μm 用常数 `cell_pitch_um`(见 §5.3 与开放问题)。

### 3.2 Neuron 的静态派生量

`Grid` 里每个 `CellContents::Neuron(_)` 对应:

```
NeuronStatic {
    body_volume_um3 : f32,              // 常数:每神经元一个胞体体积 V_body(见 §5.3)
    resting_pj_s : f32,                 // 常数:p_rest_per_neuron
    activity_coef_pj_s : f32,           // 常数:p_activity_coef_per_neuron
}
```

**MVP 不按 NeuronKind 区分**这三个量 —— 五种 kind 全用同一组常数(感觉/中间/调制/运动的代谢差异先做"无差别",见 §8 开放问题)。

### 3.3 Routes / Grid 聚合量

```
OrganStatic {
    total_volume_um3 : f32,
    total_static_pj_s : f32,            // Σ neuron rest + Σ edge static_total
    per_layer_hull_um2 : { layer_i -> f32 },     // 每层凸包面积
    layered_volume_um3 : f32,           // Σ 各层凸包 × layer_height_um
    max_path_delay_ms : f32,            // 全 organ 最长 root→leaf 延迟
}
```

`per_layer_hull_um2` 的输入 = 每一层上 Grid 神经元 cell + Edge 占用线格(spec §1 的"占用 cell"广义);投影到 (x, y) 求 2D 凸包面积。

`layered_volume_um3` 是宪法 §1 / 工坊 spec §4 的"逐层求和 × 层高",不是合并 footprint × 总层数。

`max_path_delay_ms` 是 cycles 那条轴的输入(每边每叶都有自己的延迟,取全 organ 最大),给关卡 par / cycles 度量用。

### 3.4 缓存策略 —— 已决定

**按需算,不缓存到结构上。** 理由:

1. 输入面很窄(几何 + d + 常数),公式都是简单乘加 / exp / 凸包,**不存在重复计算昂贵到必须缓存的项**。最贵的是凸包,O(n log n) per layer,触发频率 = 看一眼 HUD 那个频率,不进 hot loop。
2. 缓存到 Edge 上就要在每个 mutate 入口(`place_edge` / `on_neuron_removed` / `on_neuron_kind_replaced` / 改 d)同步刷新,一个漏点就 stale。C-2 已经在维护两个反查索引;再加一层缓存就是第三个一致性面,负担不抵收益。
3. 求值层若发现某派生量在 hot loop 里被反复读且确实瓶颈,在求值层自己缓存(因为求值层本来就有每只蚂蚁一份的批数据)—— C-3 数据保持无状态。

**写入接口** —— C-3 不引入"改 thickness_d"的操作入口。MVP 阶段 thickness_d 只在 `place_edge` 时传入;改 d 需要先 `remove_edge` 再重新 `place_edge`。后续 UI 若需要"直接拖滑块改 d",再加 `EdgeOps::set_thickness_d`,届时缓存策略也才需要重新讨论。

---

## 4. 计算 API

C-3 不长出新的 ECS 资源,也不挂 Bevy 系统在 Update 上跑。它是 routing 数据的**纯函数 view**:输入 (Grid, Routes),输出上面的 *Static 类型。

### 4.1 暴露的入口

按层级递增:

- `Edge::pathlen_total(&self) -> f32`(μm)
- `Edge::pathlen_to_leaf(&self, leaf_idx: u16) -> f32`(μm)
- `Edge::volume_um3(&self) -> f32`
- `Edge::delay_ms_to_leaf(&self, leaf_idx: u16) -> f32`
- `Edge::attenuation_to_leaf(&self, leaf_idx: u16) -> f32`
- `Edge::static_power_pj_s(&self) -> f32`(volume-maint + synapse-maint)
- `Routes::organ_static(&self, grid: &Grid) -> OrganStatic`(一次性计算所有 organ 级量)
- `Routes::neuron_count(&self, grid: &Grid) -> usize`(顺手量,放在 organ_static 里)

`per_layer_hull_um2` 由 `organ_static` 计算时一并产生。需要 per-edge / per-leaf 单点查询时走 Edge 方法即可;需要 organ 级看板时调一次 `organ_static`。

### 4.2 不暴露什么

- 不暴露任何"返回一个对象,在它身上多次取值"的 stateful accessor。
- 不暴露"瞬时功率 / 当前激活功率"。
- 不暴露"合成单一总分"。

### 4.3 调用方

- **求值层**:开始仿真前读一次 organ_static + 每边的 `attenuation_to_leaf` 系数表,缓存进批数据;每 tick 不再调 C-3。
- **HTML 导出(C-4)**:导出时调 organ_static + 每边的 delay_ms / attenuation,填进 module JSON 的 `meta` 块。
- **UI / par 比对**:调 organ_static,把六个数(neuron count、volume、static power、layered volume、max delay、per-layer hull)分开显示;UI 拿 par 单独比对每个数。
- **C-3b 横截面渲染(未来)**:按层取凸包,把凸包顶点画出来,等等。

---

## 5. `constants/biology.rs`

### 5.1 文件归属

放在 `crates/grid_workshop/src/constants/biology.rs`(或 C-3 实现阶段决定的位置,但**与 routing 同 crate**,因为 routing 的派生 view 直接依赖它)。

每个常数必须:

1. 真实物理单位(μm、μm³、m/s、pJ/s)。
2. 简短注释说明**机理**(为什么这个量纲 / 这个量级)。
3. **出处** —— 引用研究报告(`docs/compass_artifact_*.md`)、文献(作者 年 期刊 卷:页),或明确标 `// ESTIMATE: <理由>` 不要伪装成实测值。
4. 单位制写在文件顶层模块注释里,常数本身只写数值 + 单位后缀(如 `const LAMBDA_REF_UM: f32 = ...`)。

### 5.2 必有常数(MVP)

| 常数 | 含义 | 单位 |
|---|---|---|
| `D_REF_UM` | 参考轴突粗细 d₀ | μm |
| `LAMBDA_REF_UM` | d = D_REF_UM 时的电紧张长度常数 λ₀ | μm |
| `V_REF_M_S` | d = D_REF_UM 时的传导速度 v₀ | m/s |
| `CELL_PITCH_UM` | 单 cell 边长(同层 x/y) | μm |
| `LAYER_HEIGHT_UM` | 层间距(z 方向) | μm |
| `NEURON_BODY_VOL_UM3` | 单神经元胞体体积 V_body | μm³ |
| `P_REST_PER_NEURON_PJ_S` | 单神经元静息功率 | pJ/s |
| `P_MAINT_PER_VOLUME_PJ_S_UM3` | 每 μm³ 轴突维持功率 | pJ/s/μm³ |
| `P_MAINT_PER_SYNAPSE_PJ_S` | 单突触维持功率 | pJ/s |
| `P_ACTIVITY_COEF_PER_NEURON_PJ_S` | 单神经元每单位激活的活动功率 | pJ/s(乘 [0,1]) |
| `K_VOL_EDGE` | edge 体积公式 `k_vol × d² × pathlen` 中的几何常数 | 无量纲 |

### 5.3 衍生公式(由上面常数定义,不是另立常数)

```
λ(d)   = LAMBDA_REF_UM × sqrt(d / D_REF_UM)               // μm
v(d)   = V_REF_M_S × sqrt(d / D_REF_UM)                   // m/s
vol_edge(d, pathlen_um) = K_VOL_EDGE × d² × pathlen_um    // μm³
delay_ms(d, pathlen_um) = (pathlen_um × 1e-6) / v(d) × 1e3
attenuation_coef(d, pathlen_um) = exp(−pathlen_um / λ(d))
```

`v(d)` 和 `λ(d)` 共享同一个 `sqrt(d / D_REF_UM)` 因子 —— 这是宪法 §4 "two faces of one cable-theory root" 的代码体现,**`biology.rs` 的注释里必须点明这一点**,提醒后续修改者不要把两个常数独立调。

`K_VOL_EDGE` 见 §8 开放问题(几何 cylinder 是 π/4,但若 routing 暗含"一个 cell ≈ 1 单位粗细的轴突段"则未必,需要明确)。

### 5.4 估算 vs 实测

研究报告(`docs/compass_artifact_*.md`)提供的是**结构性指导**和"哪些常数是诚实的"(板层 / Dale / 分级 / 可塑定位 / Cherniak 布线经济),**不直接给数值表**(报告内 grep "lambda / conduction velocity / pJ" 仅命中一处"vias 是 metabolic cost"的语义性提及)。

因此 §5.2 的 11 个常数里,**多数是估算**。MVP 策略(沿用工坊 spec §4.2):

- 常数取在真实昆虫数据**一个量级之内**,允许粗略估算。
- 每常数附 `// ESTIMATE: <最接近的文献依据>`,不可伪装实测。
- 数值边界存疑的(尤其 `CELL_PITCH_UM`、`P_*` 三项)进开放问题(§8),不在 spec 里写死数值;实现阶段实测验证一组用,文档同步注明"该值是 MVP 估算,见 spec §8 #N"。

---

## 6. Bevy 集成

C-3 不新建 Plugin、不新建 Resource、不挂 Update 系统。它是 `grid_workshop` crate 内 routing 模块旁边的纯函数层(同 crate,可访问 routing 私有以便复用 PathTree 内部)。

**单一调试读出**(C-2 那个 gizmo 占位的对位物):一个不带 UI 框架的最小入口,把 `Routes::organ_static(&grid)` 的六个数 println 或 info!log 出来,运行时开发者能"看一眼数字"。**不画**,不开窗口,不要 mesh —— 渲染是 C-3b 的事。

调用形态(实现细节):一个独立 example 或一个 debug 命令,程序化搭一个小场景 → 调 organ_static → log。

---

## 7. 验证

### 7.1 单元测试 —— 真实数值断言

不只是"公式套对",还要"数对":

- 取 d = D_REF_UM 时,delay_ms(d, 1000μm) 必须等于 (1e-3 / V_REF_M_S) × 1e3 在浮点误差内(检查 √d 因子退化为 1)。
- 取 d = 4 × D_REF_UM 时,λ(d) 必须 ≈ 2 × LAMBDA_REF_UM(√ 因子 = 2)。
- 衰减 attenuation(d, pathlen_um=λ(d)) ≈ exp(−1) ≈ 0.368;pathlen_um=2×λ(d) ≈ 0.135;0 → 1.0。
- 体积 vol_edge(d, len) 在 d 翻倍时翻 4 倍。
- 一只只含两神经元 + 一条 1-cell 直边的"最小器官",organ_static 的所有六个量手算可对账,断言到具体数值。

### 7.2 几何 / 拓扑测试

- 三神经元一条链 S→I→M(C-2 的 regression 用例),Edge 1 的 leaves() 唯一 = (I 索引,I 坐标);delay / attenuation 是 per-leaf 计算的单值。
- 分叉树(graft_branch 之后)有 2 个 leaf,两个 attenuation / delay 分别正确,且总 volume 用 pathlen_total(所有 cell-邻接段总和),不是某一支的 pathlen。
- 单层 organ 的 per_layer_hull 单层为非零、其它层为零;多层 organ 各层独立。
- 凸包面积手算可验(取三点构成已知三角形)。

### 7.3 不变量

- 增加 d 严格不减少 delay 倒数(传导更快)、不减少 attenuation 系数(衰减更小)、严格增加 edge volume。
- 增加 pathlen 严格增加 delay、严格减小 attenuation、严格增加 edge volume。
- organ_static 的 total_volume 等于 Σ neuron body + Σ edge volume(不重不漏)。
- organ_static 不依赖 Routes / Grid 的内部 ordering(传入两个等价图必得等值结果,凸包对置换不变)。

### 7.4 不在本次验证范围

- 不验真实昆虫量级 —— 那是常数本身的事,常数若改,断言里的数值跟着改;数值断言验的是公式一致性,不是物理真实性。
- 不验 par —— par 是关卡作者填的,不是 C-3 算的。

---

## 8. 开放问题 / 待定

这些是 review / 实现阶段需要拍板的点,**不要在没有依据时自己定**(宪法:碰到模型/生物维度的岔口,surface conflict)。

### 8.1 数值类(常数依据)

1. **`CELL_PITCH_UM` 和 `LAYER_HEIGHT_UM`** —— 这俩是绝对尺度的锚,所有派生量随它们伸缩。昆虫 mushroom-body microglomerulus 直径 ≈ 几 μm;medulla 一层厚度也是同量级,但游戏里"一个 cell"对应多大物理结构没有自动答案。需要一个 defensible 选择(MVP 估算 + 理由)。
2. **`D_REF_UM`, `LAMBDA_REF_UM`, `V_REF_M_S`** —— 参考粗细及对应 λ、v 的实测/估算。昆虫非脉冲轴突(graded interneurons)cable theory 数据稀。最相近文献是?MVP 估算量级。
3. **`P_REST_PER_NEURON_PJ_S`、`P_ACTIVITY_COEF_PER_NEURON_PJ_S`** —— 单神经元功耗。Attwell & Laughlin 2001(哺乳动物)有数,昆虫直接数据弱。是否用哺乳动物数据按 V_body 比例外推?或就用 Attwell 数除以 N?这是估算的最大不确定点。
4. **`P_MAINT_PER_VOLUME_PJ_S_UM3` 和 `P_MAINT_PER_SYNAPSE_PJ_S`** —— 轴突维持 vs 突触维持的拆分。生物学上膜面积主导维持功率,而膜面积 ∝ d × len ≠ d² × len(体积)。**这里可能要把"按体积"换成"按膜面积"** —— 但那会让"d² 体积"和"d×len 维持"在 spec 里出现两个 d 的不同幂次。要不要这么做?
5. **`NEURON_BODY_VOL_UM3`** —— 单胞体体积。Kenyon cell ~5μm 直径 → ~65 μm³;medulla 神经元更大。MVP 估算量级。
6. **MVP 不区分 NeuronKind 的代谢**(§3.2)—— 这是简化假设,需要 sanity check。研究报告 §7 提到 plasticity 集中在 MB microglomeruli,意味着调制神经元的能耗结构和别的可能差别大。MVP 接受单一常数,后续若涌现测试发现 Modulator 行为不合理,引入 per-kind 数值。

### 8.2 公式选择类

7. **`K_VOL_EDGE`** —— 几何 cylinder 是 `π/4 × d² × len`,但若 routing 暗含"一个 cell 是一个体素,d 是该体素内轴突占用比例的几何抽象",则常数因子未必 π/4。MVP 倾向 π/4 + 注释说明。需要确认这个选择与"d² × pathlen 维持代谢" 这条物理诚实性不冲突(见 #4 关于体积 vs 膜面积)。
8. **衰减取自 root 端还是 leaf 端**:`attenuation_coef = exp(−pathlen_leaf / λ(d))` 假设信号从 root(source 神经元)沿 path 抵达每个 leaf(target),距离 = root→leaf 的累计 cell-邻接段长度 × CELL_PITCH。这是 §3.1 的设定。**这条要确认**:神经元的 axon hillock 是 source 端,信号沿 axon 远传到 dendrite end—— root = axon hillock,leaves = synaptic boutons,距离方向无歧义。√
9. **凸包面积输入** —— 包不包含 edge 占用的线格(穿 Empty 的 wire cell)?MVP 倾向包含(它们物理上是器官的占地)。但宪法 §1 写的是"the organ's extent is *emergent* from neuron positions" —— 字面读只算神经元?这里 spec 草案选**包含线格**,理由:轴突也占空间,Cherniak 的 wire-economy 算的是 wire,不止 neuron 位置;但要 surface 给 review。

### 8.3 范围 / 接口类

10. **edge 体积 vs 神经元体积的比例**:典型蚂蚁神经元里,轴突总体积通常远大于胞体总体积,还是接近?如果接近,把胞体体积常数搞错一倍对 organ_total_volume 影响小;若轴突占主导,胞体常数可以宽松。需要从研究报告里确认一个量级。
11. **是否暴露"every leaf 的 delay / attenuation 同时取出"的批接口**:UI / HTML 导出会要,但 C-3 §4 草稿只给单点查询。这是实现阶段的人体工学决定,不是设计决定;writing-plans 阶段决定。

---

## 9. 设计宪法检查

按 §1–§5 逐条:

1. **§1 空间是真的;布线有代价** — 四个代价量都从几何派生,delay ∝ pathlen,体积 ∝ d² × pathlen,代谢 ∝ 体积,凸包逐层求和 × 层高。"放得远 = 又慢又衰减又耗代谢"全部在公式里兑现。**√**
2. **§2 一条线是一个神经元的私线** — C-3 不动 routing 数据结构,沿用 C-2 的 tree 模型;每条 Edge 一个 d。无相关 invariant 风险。**N/A**
3. **§3 连接是关系,与端点共生死** — C-3 是无状态 view,不持久化任何派生数据;Edge 被级联删除,派生量自动消失,无 stale 风险。**√**
4. **§4 信号分级,衰减,学习局部** — 衰减系数公式与宪法行 58 一致;v ∝ √d, λ ∝ √d 共享同一根号在常数文件注释里强制说明;代谢是**瞬时功率**,活动项归运行时(§2),不写时间积分。**√**
5. **§5 意义没有标签** — 派生量名都是物理(`delay_ms`, `attenuation`, `pj_s`, `um3`),没有 "efficiency", "elegance", "score" 这种合成词;**organ_static 暴露六个独立数,绝不合成总分**(§4.2 / §1.2 都写明)。**√**

---

## 10. 下一步

本文档定义"做什么"。下一步是 `writing-plans` 阶段,产出 C-3 实现计划,task-by-task 落到 `crates/grid_workshop/src/constants/biology.rs`(新建)+ `crates/grid_workshop/src/routing/cost.rs`(或类似)+ tests。

实现计划必须:

- 严格按 §1.2 的"不做什么"边界,不混入横截面 / UI / 渲染。
- 把 §8 的开放问题在计划前先 review —— **常数取值要么给文献依据,要么明确标 ESTIMATE**,不要为了让 test pass 而把数填上。
- C-3 实现前先 commit 一笔对 C-2 spec §1 的勘误注(本 spec §1.3 是声明,C-2 文档加一条 v0.2.1 注向这里指)。
- 在常数实现 task 里把"v 与 λ 共享 √d"作为 code 注释强制项。
