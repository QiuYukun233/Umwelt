# Bevy 子系统 C-3 — 成本数字(静态派生量)设计规格

> **状态**:定稿 v0.2(review 后)
> **日期**:2026-05-27(v0.1 → v0.2 同日修订)
> **v0.2 修订要点**:
> - **代谢从体积改挂膜面积**(宪法 §4 同步修订,2026-05-27):resting + maintenance + activity 全部 ∝ 膜面积 ∝ d·len;体积 ∝ d²·len 保留但**只作为空间成本**(§1 足迹族),不参与代谢。同一根 d 触三种斜率:√d(速度/λ)、d(代谢)、d²(空间)。
> - **突触维持**单独一项,按端点数计、与 d 无关(膜面积主导维持公式后,突触机制是独立的)。
> - **凸包面积包含 wire 线格**(宪法 §1 同步明示):足迹是空间成本、线也占空间,铺得越散越大。
> - **K_VOL_EDGE = π/4**(d 定义为直径,圆截面);**K_MEMB_EDGE = π**(圆柱侧面)。
> - **静态代谢不按 NeuronKind 区分**(MVP):几何量与类型无关;泵密度差异以后再说。
> - §8 收窄为"待取数 + 待 user 确认 cell 尺寸"两类,无悬而未决的设计/物理决定。
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
3. **代谢功率(power)** — 瞬时功率 pJ/s,**静态部分**:每神经元静息功率(膜面积驱动)+ 每边膜面积维持功率(∝ d·len)+ 每突触维持功率(按端点数,与 d 无关)。活动项在运行时层算(见 §2)。**注意:代谢挂膜面积、不挂体积**(宪法 §4 行 60:泵和漏电流在膜上,膜面积随 d 线性增长)。
4. **体积(volume)** — 神经元胞体体积 + 每边的体积(d² × pathlen,常数因子见 §5.3);**单纯空间/物质成本**(§1 足迹族),不进入代谢公式。

加几何聚合:

5. **逐层凸包足迹** — 每一层的占用 cell 投影到 (x, y) 后求凸包面积;总几何代价 = Σ 各层足迹 × 层高 h。**逐层求和,不是合并 footprint × 总层数**(宪法 §1)。

### 1.2 不做什么 / 边界

- **不做横截面渲染、相机、层切换、mesh 化** —— 拆 C-3b,等 UI / 相机子系统先立起来再说。本 spec 写完后 C-3b 仍是 placeholder,不在本子系统作用域内。
- **不做活动项 / 真正的瞬时功率 / 真正的远端信号** —— 那些是结构 × 运行时输入的函数,归求值层,见 §2。
- **不做"代谢预算上限 / par 比对 / UI 显示数字"** —— C-3 只提供数,上层(关卡系统、par 系统、UI HUD)拿数比对。
- **不内置 cost-combining "效率分数"** —— 宪法 §5:成本是正交量,绝不合并。任何聚合方法只暴露**各项分开**,不暴露"总分"。
- **HTML JSON 导出不在 C-3** —— 但所有 HTML 导出会用到的常数(λ、v、p_*、体积公式)都集中在 C-3 的 `constants/biology.rs`。C-4 收缩为"按 HTML schema 把 C-3 算出的数填进 JSON",不再持有任何生物常数。

### 1.3 对 C-2 §1 的勘误 + 宪法 §4 同步

两件事并入此节,因为都改的是"thickness_d 接什么物理"这条线:

1. **C-2 spec §1 行 31 "`constants/biology.rs` 真实数值 —— C-4"已作废。** 常数表归 C-3。理由:四个代价量里只有体积是纯几何;delay / 衰减 / 功率没有真实常数 + 单位就是空话,把"常数"和"用常数的数学"分到不同子系统会拆成两个不闭环的半成品。

2. **C-2 spec §2.1 行 50 注释"真实单位 μm,常数表在 C-4 才用"已作废。** 同上,常数表在 C-3。

3. **宪法 §4 同期修订(2026-05-27)**:代谢从"体积驱动"改为"**膜面积驱动**"——pumps and leak channels live in the membrane,膜面积 ∝ d·len。体积 ∝ d²·len 保留为**纯空间成本**(§1 足迹族),不进代谢公式。突触维持是与 d 无关的单独项。本 spec 全文按修订后宪法 §4 行 60 对齐;C-2 spec 中暗含"d² 体积 → 代谢"的语义在 C-2 §7.4(constitution 自检)如有冲突以本 spec 与宪法为准。

C-2 spec 不回填正文 —— 本 §1.3 是权威修订记录,后续如有冲突以本 spec 与宪法为准。

---

## 2. 静态 vs 运行时:必须画死的线

C-3 最容易出错的地方,所以单独立一节。

### 2.1 静态部分(C-3 算、C-3 测、C-3 缓存或按需算 — 见 §3.4)

| 量 | 公式 | 输入 |
|---|---|---|
| edge delay_ms | pathlen / v(d) | pathlen(几何)、d、`v_ref`(常数) |
| edge attenuation 系数(per leaf) | exp(−pathlen_leaf / λ(d)) | pathlen_leaf、d、`lambda_ref` |
| edge volume(空间) | K_VOL_EDGE × d² × pathlen | pathlen、d、`K_VOL_EDGE = π/4`(d 是直径,圆截面) |
| edge membrane area | K_MEMB_EDGE × d × pathlen | pathlen、d、`K_MEMB_EDGE = π`(圆柱侧面) |
| neuron resting power | `p_rest_per_neuron`(由胞体膜面积驱动,常数封装) | 常数 |
| edge membrane-maint power | edge_membrane_area × `p_maint_per_membrane_area` | membrane_area、常数 |
| synapse maint power | n_leaves × `p_maint_per_synapse`(与 d 无关) | n_leaves、常数 |
| neuron activity coefficient | `p_activity_coef_per_neuron` | 常数(单位 pJ/s,乘 [0,1] 激活) |
| 逐层凸包足迹 | ConvexHull2D(layer cells projected to xy) | **Grid neurons + edge wire cells**(宪法 §1) |
| 器官静态总功率 | Σ neuron rest + Σ edge membrane-maint + Σ synapse maint | 上面三者 |
| 器官总体积(空间成本) | Σ neuron body volume + Σ edge volume | 几何 + d |
| 器官总膜面积 | Σ neuron body membrane + Σ edge membrane | 几何 + d(代谢的输入聚合) |
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
    volume_um3        : f32,            // 空间成本:K_VOL_EDGE × d² × pathlen_total
    membrane_um2      : f32,            // 代谢驱动:K_MEMB_EDGE × d × pathlen_total
    delay_ms_per_leaf      : { leaf_idx -> f32 },
    attenuation_per_leaf   : { leaf_idx -> f32 },  // exp(−pathlen_leaf / λ(d))
    membrane_maint_pj_s    : f32,       // membrane_um2 × p_maint_per_membrane_area
    synapse_maint_pj_s     : f32,       // n_leaves × p_maint_per_synapse(与 d 无关)
    static_total_pj_s      : f32,       // membrane_maint + synapse_maint
}
```

注意:**衰减和延迟是 per-leaf 的**,因为 Edge 是 tree、不同叶有不同的 pathlen。`leaf_idx` 来自 C-2 `PathTree::leaves()` 的 index。

`pathlen_total` = 树上所有 cell-邻接段长度之和(对体积、膜面积、按膜面积驱动的维持功率有意义)。`pathlen_leaf` = 从 root 到该 leaf 的 parent 链 cell-邻接段长度之和(对该叶的延迟/衰减有意义)。两者不同。

`volume_um3` 和 `membrane_um2` 是同一根 `d` 的两个不同幂次:**d² 是空间(把粒子塞进体积里),d 是膜面积(把泵嵌在表面上)**。spec 不把这两者强行统一成一个公式 —— 不同的物理后果应该出现在不同的派生量里。

**单位**:`pathlen` 单位是 μm,不是 cell 数;cell→μm 用常数 `cell_pitch_um`(见 §5.3 与开放问题)。

### 3.2 Neuron 的静态派生量

`Grid` 里每个 `CellContents::Neuron(_)` 对应:

```
NeuronStatic {
    body_volume_um3   : f32,            // 常数:每神经元一个胞体体积 V_body(空间)
    body_membrane_um2 : f32,            // 常数:每神经元一个胞体膜面积 A_body(代谢驱动)
    resting_pj_s      : f32,            // 常数:p_rest_per_neuron(已封装"膜面积 × 单位漏电"成一个常数)
    activity_coef_pj_s: f32,            // 常数:p_activity_coef_per_neuron
}
```

**MVP 不按 NeuronKind 区分**这四个量 —— 几何量(膜面积、体积)与类型无关;泵密度差异以后(各 kind 引入泵密度修饰)再说。这是定稿决定,不留在开放问题。

### 3.3 Routes / Grid 聚合量

```
OrganStatic {
    neuron_count        : usize,
    total_volume_um3    : f32,                  // 空间成本
    total_membrane_um2  : f32,                  // 代谢的几何输入聚合
    total_static_pj_s   : f32,                  // Σ neuron rest + Σ edge static_total
    per_layer_hull_um2  : { layer_i -> f32 },   // 每层凸包面积
    layered_volume_um3  : f32,                  // Σ 各层凸包 × layer_height_um
    max_path_delay_ms   : f32,                  // 全 organ 最长 root→leaf 延迟
}
```

`per_layer_hull_um2` 的输入 = 每一层上**所有占用 cell**(Grid 神经元 cell + Edge 占用线格,宪法 §1 行 13:"the hull encloses *all* occupied cells on the layer (somata + wire)");投影到 (x, y) 求 2D 凸包面积。这是空间成本的核心信号:铺得越散,足迹越大。

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
- `Edge::volume_um3(&self) -> f32`(空间)
- `Edge::membrane_um2(&self) -> f32`(代谢驱动)
- `Edge::delay_ms_to_leaf(&self, leaf_idx: u16) -> f32`
- `Edge::attenuation_to_leaf(&self, leaf_idx: u16) -> f32`
- `Edge::static_power_pj_s(&self) -> f32`(membrane-maint + synapse-maint)
- `Routes::organ_static(&self, grid: &Grid) -> OrganStatic`(一次性算所有 organ 级量,内含 neuron_count)

`per_layer_hull_um2` 由 `organ_static` 计算时一并产生。需要 per-edge / per-leaf 单点查询时走 Edge 方法即可;需要 organ 级看板时调一次 `organ_static`。

### 4.2 不暴露什么

- 不暴露任何"返回一个对象,在它身上多次取值"的 stateful accessor。
- 不暴露"瞬时功率 / 当前激活功率"。
- 不暴露"合成单一总分"。

### 4.3 调用方

- **求值层**:开始仿真前读一次 organ_static + 每边的 `attenuation_to_leaf` 系数表,缓存进批数据;每 tick 不再调 C-3。
- **HTML 导出(C-4)**:导出时调 organ_static + 每边的 delay_ms / attenuation,填进 module JSON 的 `meta` 块。
- **UI / par 比对**:调 organ_static,把**七个数**(neuron count、volume、membrane、static power、layered volume、max delay、per-layer hull)**分开显示**;UI 拿 par 单独比对每个数。绝不合成单一总分(§1.2 / §4.2 / 宪法 §5)。
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

几何常数(由 §5.3 公式定义,可直接写死):

| 常数 | 含义 | 值 |
|---|---|---|
| `K_VOL_EDGE` | 圆截面常数:轴突横截面面积 = K_VOL_EDGE × d²,d 是直径 | `π/4` |
| `K_MEMB_EDGE` | 圆柱侧面常数:轴突膜面积 = K_MEMB_EDGE × d × len | `π` |

物理常数(必须带出处或标 ESTIMATE):

| 常数 | 含义 | 单位 |
|---|---|---|
| `D_REF_UM` | 参考轴突粗细 d₀ | μm |
| `LAMBDA_REF_UM` | d = D_REF_UM 时的电紧张长度常数 λ₀ | μm |
| `V_REF_M_S` | d = D_REF_UM 时的传导速度 v₀ | m/s |
| `CELL_PITCH_UM` | 单 cell 同层边长(x / y 方向);**待 user 确认的标定锚**(见 §8 #1) | μm |
| `LAYER_HEIGHT_UM` | 层间距(z 方向);同上 | μm |
| `NEURON_BODY_VOL_UM3` | 单神经元胞体体积 V_body | μm³ |
| `NEURON_BODY_MEMB_UM2` | 单神经元胞体膜面积 A_body(如果 V_body 假设球形,则 A_body 由 V_body 导出;在 biology.rs 里两者都保留为常数以便独立调) | μm² |
| `P_REST_PER_NEURON_PJ_S` | 单神经元静息功率(已封装 "A_body × 单位漏电"成一个数,**不引入"漏电密度"中间常数**;不需要的常数不引) | pJ/s |
| `P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2` | 每 μm² 轴突膜面积的维持功率(代谢主项) | pJ/s/μm² |
| `P_MAINT_PER_SYNAPSE_PJ_S` | 单突触维持功率(按端点数,与 d 无关) | pJ/s |
| `P_ACTIVITY_COEF_PER_NEURON_PJ_S` | 单神经元每单位激活的活动功率 | pJ/s(乘 [0,1]) |

**为什么不引入"漏电流密度 × A_body"中间常数**:把 A_body 和 p_per_um2_leak 分两个常数会把"哺乳数据按胞体大小外推到昆虫"的不确定性切成两半重复,且要求 NEURON_BODY_MEMB_UM2 精度高 —— 而那本身是估算。直接把 P_REST_PER_NEURON_PJ_S 当成一个数,胞体膜面积只作显示/几何不参与代谢求和,降低估算耦合。

### 5.3 衍生公式(由上面常数定义,不是另立常数)

```
λ(d)            = LAMBDA_REF_UM × sqrt(d / D_REF_UM)         // μm
v(d)            = V_REF_M_S × sqrt(d / D_REF_UM)             // m/s
vol_edge        = K_VOL_EDGE × d² × pathlen_um               // μm³(空间)
membrane_edge   = K_MEMB_EDGE × d × pathlen_um               // μm²(代谢驱动)
delay_ms        = (pathlen_um × 1e-6) / v(d) × 1e3           // ms
attenuation_c   = exp(−pathlen_um / λ(d))                    // 无量纲

edge static power:
  membrane_maint = membrane_edge × P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2
  synapse_maint  = n_leaves × P_MAINT_PER_SYNAPSE_PJ_S
  edge_static    = membrane_maint + synapse_maint            // pJ/s

organ static power:
  Σ neuron P_REST_PER_NEURON_PJ_S + Σ edge_static            // pJ/s
```

**注释强制项**(biology.rs 顶部模块文档):

1. `v(d)` 和 `λ(d)` 共享同一个 `sqrt(d / D_REF_UM)` 因子 —— 宪法 §4 "two faces of one cable-theory root"。同一个根不要拆开调。
2. **代谢挂膜面积(d·len),体积挂 d²·len 不进代谢公式**(宪法 §4 行 60)。膜面积 = 泵和漏电流的住所;体积 = 占多大地方。两个不同幂次是对的,不要强行统一。
3. 突触维持按端点数,与 d 无关。

### 5.4 估算 vs 实测

研究报告(`docs/compass_artifact_*.md`)提供的是**结构性指导**和"哪些常数是诚实的"(板层 / Dale / 分级 / 可塑定位 / Cherniak 布线经济),**不直接给数值表**(报告内 grep "lambda / conduction velocity / pJ" 仅命中一处"vias 是 metabolic cost"的语义性提及)。

因此 §5.2 的物理常数**多数是估算**。MVP 策略(沿用工坊 spec §4.2):

- 常数取在真实昆虫数据**一个量级之内**,允许粗略估算。
- 每常数附 `// ESTIMATE: <最接近的文献依据>`,不可伪装实测。
- 哺乳动物数据外推到昆虫的(典型:Attwell & Laughlin 2001 → 单神经元功耗)注明外推路径与缩放假设。
- **本 spec 故意不在 §5.2 写死数值**:实现 task 0 是"取数 + 引文献",由 review 验证每常数的来源后再合入。

---

## 6. Bevy 集成

C-3 不新建 Plugin、不新建 Resource、不挂 Update 系统。它是 `grid_workshop` crate 内 routing 模块旁边的纯函数层(同 crate,可访问 routing 私有以便复用 PathTree 内部)。

**单一调试读出**(C-2 那个 gizmo 占位的对位物):一个不带 UI 框架的最小入口,把 `Routes::organ_static(&grid)` 的七个数 println 或 info!log 出来,运行时开发者能"看一眼数字"。**不画**,不开窗口,不要 mesh —— 渲染是 C-3b 的事。

调用形态(实现细节):一个独立 example 或一个 debug 命令,程序化搭一个小场景 → 调 organ_static → log。

---

## 7. 验证

### 7.1 单元测试 —— 真实数值断言

不只是"公式套对",还要"数对":

- 取 d = D_REF_UM 时,delay_ms(d, 1000μm) 必须等于 (1e-3 / V_REF_M_S) × 1e3 在浮点误差内(检查 √d 因子退化为 1)。
- 取 d = 4 × D_REF_UM 时,λ(d) 必须 ≈ 2 × LAMBDA_REF_UM(√ 因子 = 2)。
- 衰减 attenuation(d, pathlen_um=λ(d)) ≈ exp(−1) ≈ 0.368;pathlen_um=2×λ(d) ≈ 0.135;0 → 1.0。
- **体积 vol_edge(d, len) 在 d 翻倍时翻 4 倍(d²)。**
- **膜面积 membrane_edge(d, len) 在 d 翻倍时翻 2 倍(d¹)。** 这条断言显式守护宪法 §4 行 60 的"两个不同幂次"。
- 同一条边在 d 翻倍时:edge_volume × 4,membrane_maint × 2,synapse_maint 不变;static_power 不是简单倍数 —— 必须断言三项分别正确。
- 一只只含两神经元 + 一条 1-cell 直边的"最小器官",organ_static 的所有七个量手算可对账,断言到具体数值。

### 7.2 几何 / 拓扑测试

- 三神经元一条链 S→I→M(C-2 的 regression 用例),Edge 1 的 leaves() 唯一 = (I 索引,I 坐标);delay / attenuation 是 per-leaf 计算的单值。
- 分叉树(graft_branch 之后)有 2 个 leaf,两个 attenuation / delay 分别正确,且总 volume 用 pathlen_total(所有 cell-邻接段总和),不是某一支的 pathlen。
- 单层 organ 的 per_layer_hull 单层为非零、其它层为零;多层 organ 各层独立。
- 凸包面积手算可验(取三点构成已知三角形)。

### 7.3 不变量

- 增加 d 严格减小 delay(传导更快)、严格增大 attenuation 系数(衰减更小)、严格增加 edge volume(× d²)、严格增加 edge membrane(× d)。
- 增加 pathlen 严格增加 delay、严格减小 attenuation、严格增加 edge volume、严格增加 edge membrane。
- organ_static 的 total_volume 等于 Σ neuron body + Σ edge volume(不重不漏)。
- organ_static 的 total_membrane 等于 Σ neuron body membrane + Σ edge membrane(不重不漏)。
- organ_static 不依赖 Routes / Grid 的内部 ordering(传入两个等价图必得等值结果,凸包对置换不变)。
- 凸包包含 wire 线格(增加一条 sprawling wire,即使不增加神经元,逐层 hull 严格不减)。

### 7.4 不在本次验证范围

- 不验真实昆虫量级 —— 那是常数本身的事,常数若改,断言里的数值跟着改;数值断言验的是公式一致性,不是物理真实性。
- 不验 par —— par 是关卡作者填的,不是 C-3 算的。

---

## 8. 开放问题 / 待定

这些是 review / 实现阶段需要拍板的点,**不要在没有依据时自己定**(宪法:碰到模型/生物维度的岔口,surface conflict)。

v0.2 把所有设计/物理决定收回正文。剩下两类都是**"等数 / 等 user 确认锚"**,实现阶段执行,不是 spec 内待 review 的设计岔口。

### 8.1 待 user 确认的标定锚

**1. cell 物理尺寸**(`CELL_PITCH_UM` 和 `LAYER_HEIGHT_UM`)。这不是文献能查的事实,是定标尺的锚 —— 所有派生量按它伸缩。spec **提议如下值**,等 user 拍板后写进 biology.rs;在确认前不进任何 commit。

  - 提议:`CELL_PITCH_UM = 5.0`、`LAYER_HEIGHT_UM = 10.0`。
  - 理由:
    1. 5 μm 对齐 Drosophila medulla 列间距与 Kenyon cell 胞体尺度 —— 一个 cell ≈ 一个真实的"单元微柱 / 单胞体大小"。
    2. 层间距 10 μm 对齐 medulla M 层典型厚度(5–15 μm 量级),让"换一层" ≈ "穿过 1–2 层神经组织",物理上比同层 4-邻位远但同量级。
    3. 在这个尺度下,典型 5–15 cell 的边对应 25–75 μm pathlen,落在合理 λ(估算几百 μm)内,**大多数情况衰减很小,只有玩家故意拉长才感觉到衰减**——这是想要的:衰减是远距离专属代价,不是默认税。
    4. 整数比 2:1 让"一层 = 两同层 cell"心理可读,逐层求和的足迹×层高公式数字不诡异。

### 8.2 待取数(实现阶段 task 0)

实现计划必有一个"取数 + 引文献"任务,**优先**于任何代码 task。每条必须给出处或标 `// ESTIMATE: <依据>`:

  - **`D_REF_UM` / `LAMBDA_REF_UM` / `V_REF_M_S`** —— 参考粗细 d₀ 及对应 λ、v。昆虫非脉冲 graded interneuron cable theory 数据稀;最接近的文献:Burrows & Siegler 1978(蝗虫),Schafer 2016(综述),C. elegans graded 信号文献。
  - **`P_REST_PER_NEURON_PJ_S`** —— Attwell & Laughlin 2001(*JCBFM* 21:1133)对哺乳皮层有定量,昆虫单神经元数据更弱。外推路径:Attwell 总功率 / 神经元数,记下用了哺乳哪个数据集 + 假设。
  - **`P_ACTIVITY_COEF_PER_NEURON_PJ_S`** —— 同上来源;Attwell 把活动功率拆得很细,我们打包成一个系数。
  - **`P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2`** —— 漏电流密度 × 单位面积代谢,文献用 ATP/m² 或 W/m² 报告,需要单位换算到 pJ/s/μm²。
  - **`P_MAINT_PER_SYNAPSE_PJ_S`** —— 突触维持代谢估值,昆虫数据稀,典型用哺乳 KC 突触估算外推。
  - **`NEURON_BODY_VOL_UM3` 和 `NEURON_BODY_MEMB_UM2`** —— Kenyon cell ~5 μm 直径 → 球体积 ~65 μm³,表面积 ~78 μm²;medulla 神经元更大。MVP 取 Kenyon 尺度并标 ESTIMATE。

实现 task 把这些数填进 biology.rs 时,每个值必须紧邻注释包含:**(a) 数值 + 单位 + 文献引用 (作者 年 期刊 卷:页) 或 ESTIMATE 标记 + 外推路径 (b) 量级合理性一句话 (c) 后续可细化方向(若有,如"按 NeuronKind 分")。**

---

## 9. 设计宪法检查

按 §1–§5 逐条:

1. **§1 空间是真的;布线有代价** — 五个代价量都从几何派生:delay ∝ pathlen,体积 ∝ d²·pathlen(空间),膜面积 ∝ d·pathlen(代谢),凸包逐层求和 × 层高,**凸包含 wire 线格**(行 13)。"放得远 = 又慢又衰减又耗代谢、铺得越散足迹越大"全部在公式里兑现。**√**
2. **§2 一条线是一个神经元的私线** — C-3 不动 routing 数据结构,沿用 C-2 的 tree 模型;每条 Edge 一个 d。无相关 invariant 风险。**N/A**
3. **§3 连接是关系,与端点共生死** — C-3 是无状态 view,不持久化任何派生数据;Edge 被级联删除,派生量自动消失,无 stale 风险。**√**
4. **§4 信号分级,衰减,学习局部** — 衰减系数公式与宪法行 58 一致;v ∝ √d, λ ∝ √d 共享同一根号在常数文件注释里强制说明;**代谢挂膜面积 d·len、体积 d²·len 单独算空间成本不进代谢**(行 60);代谢是**瞬时功率**,活动项归运行时(§2),不写时间积分;**突触维持按端点数与 d 无关**。**√**
5. **§5 意义没有标签** — 派生量名都是物理(`delay_ms`, `attenuation`, `pj_s`, `um3`, `um2`),没有 "efficiency", "elegance", "score" 这种合成词;**organ_static 暴露七个独立数,绝不合成总分**(§4.2 / §1.2 都写明)。**√**

---

## 10. 下一步

本文档定义"做什么"。下一步是 `writing-plans` 阶段,产出 C-3 实现计划,task-by-task 落到 `crates/grid_workshop/src/constants/biology.rs`(新建)+ `crates/grid_workshop/src/routing/cost.rs`(或类似)+ tests。

实现计划必须:

- 严格按 §1.2 的"不做什么"边界,不混入横截面 / UI / 渲染。
- **Task 0:对 C-2 spec 加一条 v0.2.1 头注**,指向本 spec §1.3(C-2 §1 行 31 "constants → C-4"作废 + §2.1 行 50 注释作废)。
- **Task 1:取数 + 引文献**(§8.2)—— 在写代码前完成。每个物理常数附文献引用或 ESTIMATE 标记 + 外推路径。等 user 确认 §8.1 的 cell 锚值后再 commit。
- **Task 2:`biology.rs` 顶部模块文档** 必须强制写入三条注释项(§5.3):
  1. v 与 λ 共享 √d 是同一根
  2. 代谢挂膜面积 d·len、体积 d²·len 不进代谢
  3. 突触维持与 d 无关
- 任何派生量字段命名禁用 "efficiency / elegance / score / cost" 这类合成词(宪法 §5)。
