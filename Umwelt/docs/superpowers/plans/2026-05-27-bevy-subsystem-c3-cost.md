# Bevy 子系统 C-3 — 成本数字(静态派生量)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 C-2 routing 之上加一层静态成本数字 —— 让 Routes 能算出 delay / 衰减 / 体积 / 膜面积 / 静态功率 / 逐层凸包,纯函数 view 不缓存。

**Architecture:** 在 `grid_workshop` crate 内新建 `constants/biology.rs`(物理常数 + √d 公式)+ `routing/cost.rs`(Edge 派生方法、`OrganStatic`、`Routes::organ_static`)+ `PathTree::pathlen_*` 辅助。无 ECS 资源,无 Update 系统;C-3 是纯函数层,从 routing 数据 + 常数算出读法。

**Tech Stack:** Rust 2024、Bevy 0.15、glam,无新依赖(凸包用手写 Andrew monotone chain,~30 行)。

**Spec:** `D:/dev/Umwelt/docs/superpowers/specs/2026-05-28-bevy-subsystem-c3-cost-design.md` v0.2(定稿)。
**宪法:** `D:/dev/Umwelt/docs/umwelt_design_constitution.md`(§1 + §4 同期修订:hull-includes-wires、metabolism ∝ membrane area)。

---

## File Structure

**Create(在 `D:/dev/umwelt-bevy/crates/grid_workshop/`):**
- `src/constants/mod.rs` — 新模块入口
- `src/constants/biology.rs` — 物理常数 + √d 公式 helper
- `src/routing/cost.rs` — Edge 成本方法、`OrganStatic`、`Routes::organ_static`、凸包
- `examples/cost_demo.rs` — debug log 七个数(无 UI,无 mesh)
- `tests/cost_smoke.rs` — App-level 烟测
- `docs/superpowers/plans/2026-05-27-c3-constants-ledger.md`(临时审议文件,Task 1 commit 之后 user review)

**Modify:**
- `src/routing/edge.rs` — `Edge` 加方法不加字段(`impl Edge` 在 cost.rs;edge.rs 本身只动 module visibility)
- `src/routing/path_tree.rs` — `PathTree` 加 `pathlen_total_um(...)` 和 `pathlen_to_leaf_um(...)` 方法
- `src/routing/mod.rs` — re-export `OrganStatic`、`cost` 模块
- `src/lib.rs` — top-level re-export
- `D:/dev/Umwelt/docs/superpowers/specs/2026-05-26-bevy-subsystem-c2-routing-design.md` — 顶部加 v0.2.1 注
- `D:/dev/Umwelt/docs/worklog.md` — 收尾

**职责切分:** `biology.rs` 守常数 + √d/exp 公式 + 强制注释(spec §5.3);`cost.rs` 守 routing 数据 → 数字的派生 + 凸包;`pathlen` 助手挂 `PathTree` 因为它知道 cells/parent 拓扑、最少污染。

---

## Task 0: C-2 spec v0.2.1 头注

**Spec ref:** spec §1.3 + §10。

**Files:**
- Modify: `D:/dev/Umwelt/docs/superpowers/specs/2026-05-26-bevy-subsystem-c2-routing-design.md`

- [ ] **Step 0.1:** 在 C-2 spec 顶部 `# Bevy 子系统 C-2` 标题与"`> **状态**`"块之间,插入 v0.2.1 注释块:

```markdown
> **v0.2.1 注(2026-05-27,随 C-3 spec v0.2 + 宪法 §1/§4 修订):**
> - 本文 §1 行 31 "`constants/biology.rs` 真实数值 —— C-4"作废,常数表归 C-3。
> - 本文 §2.1 行 50 注释"真实单位 μm,常数表在 C-4 才用"作废,同上归 C-3。
> - 本文 §7.4 宪法 §4 自检中暗含的"d² 体积驱动代谢"语义被宪法 §4 行 60 修订作废 —— 代谢挂膜面积 d·len、体积 d²·len 独立空间成本不进代谢。具体见 C-3 spec §1.3 与新宪法 §4。
> 本文不回填正文,以上为权威修订记录。后续遇冲突以 C-3 spec 与新宪法为准。
```

- [ ] **Step 0.2:** 提交。

```bash
cd D:/dev/Umwelt && git add docs/superpowers/specs/2026-05-26-bevy-subsystem-c2-routing-design.md && git commit -m "docs(C-2 spec): v0.2.1 head note — constants归 C-3 + metabolism ∝ membrane"
```

---

## Task 1: 常数 ledger(取数 + 引文献,**等 user 拍板再进 Task 2**)

**Spec ref:** spec §5.2、§5.4、§8.1、§8.2。

**Files:**
- Create: `D:/dev/Umwelt/docs/superpowers/plans/2026-05-27-c3-constants-ledger.md`

**关键约束:** 本任务**只产出 markdown 表格**,不写任何 Rust 代码。每个值必须给出处或标 `ESTIMATE: <外推路径>`。完成后 commit,**status = NEEDS_USER_CONFIRMATION**,**控制层(Claude)向 user 报告并等待批准**,user 拍板前不进 Task 2。

- [ ] **Step 1.1:** 创建 `docs/superpowers/plans/2026-05-27-c3-constants-ledger.md`,模板如下:

```markdown
# C-3 常数 ledger(取数 + 引文献,待 user 确认)

> 用于 `crates/grid_workshop/src/constants/biology.rs`。每条:数值 + 单位 + 出处/ESTIMATE + 量级合理性 + 后续可细化方向。

## A. 几何常数(无需文献,公式定义)

| 常数 | 值 | 来源 |
|---|---|---|
| `K_VOL_EDGE` | `π/4` | 圆截面常数,d = 直径 |
| `K_MEMB_EDGE` | `π` | 圆柱侧面常数 |

## B. 标定锚(待 user 确认)

| 常数 | 提议值 | 单位 | 理由 |
|---|---|---|---|
| `CELL_PITCH_UM` | `5.0` | μm | 对齐 Drosophila medulla 列间距与 Kenyon cell 胞体尺度;典型 5–15 cell 边 → 25–75μm 落在合理 λ 内,衰减是远距离专属代价非默认税。 |
| `LAYER_HEIGHT_UM` | `10.0` | μm | 对齐 medulla M 层典型厚度 5–15μm;2:1 整数比让"换层 ≈ 2 同层 cell"心理可读。 |

## C. 物理常数(必有出处或 ESTIMATE)

填写时每条三行:
- 值 + 单位
- 出处/ESTIMATE + 外推路径
- 量级合理性 + 后续可细化

| 常数 | 值 | 出处 / ESTIMATE | 合理性 / 可细化 |
|---|---|---|---|
| `D_REF_UM` | (待取) | (Burrows & Siegler 1978 蝗虫?Schafer 2016 综述?C. elegans graded 文献?) | |
| `LAMBDA_REF_UM` | (待取) | (同上) | |
| `V_REF_M_S` | (待取) | (同上) | |
| `NEURON_BODY_VOL_UM3` | (待取) | (Kenyon cell ~5μm 直径 → 球 ~65μm³;ESTIMATE) | |
| `NEURON_BODY_MEMB_UM2` | (待取) | (同上 → 球表面 ~78μm²;ESTIMATE) | |
| `P_REST_PER_NEURON_PJ_S` | (待取) | (Attwell & Laughlin 2001 JCBFM 21:1133,外推路径:总功率 / 神经元数;ESTIMATE) | |
| `P_ACTIVITY_COEF_PER_NEURON_PJ_S` | (待取) | (Attwell 2001;ESTIMATE) | |
| `P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2` | (待取) | (漏电流密度,单位换算到 pJ/s/μm²;ESTIMATE) | |
| `P_MAINT_PER_SYNAPSE_PJ_S` | (待取) | (突触维持代谢,昆虫数据稀;ESTIMATE 哺乳外推) | |

## 备注

- 任何 ESTIMATE 必须写清外推路径(用了哪个数据集 + 假设)。
- 数值量级合理性:跑一遍量纲分析,一只蚂蚁器官(~1000 神经元、~50 边、d~1μm)的静态总功率应落在 10^1–10^4 pJ/s 区间(insect brain 量级)。若严重偏离,标出来再 review。
```

- [ ] **Step 1.2:** 实现者填表(读 research report + Attwell 2001 等引用,**网络搜索 OK,但每个数附引用**)。填完后 commit。

```bash
cd D:/dev/Umwelt && git add docs/superpowers/plans/2026-05-27-c3-constants-ledger.md && git commit -m "docs(C-3): constants ledger — proposals + citations, pending user review"
```

- [ ] **Step 1.3:** **报告 status: NEEDS_USER_CONFIRMATION** 给控制层。控制层向 user 出示 ledger 文件,等 user 答复后再放 Task 2。

**实现者不要主动进 Task 2 —— 这是硬同步点。**

---

## Task 2: `constants/biology.rs` 模块 + 强制注释

**Spec ref:** spec §5(整节),特别是 §5.3 三条强制注释。

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/constants/mod.rs`
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/constants/biology.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/lib.rs`(加 `pub mod constants;`)

**前置:** Task 1 ledger 已 user 确认。**把 ledger 里 user 批准的具体数值填进 biology.rs。** 本 task 不再选数。

- [ ] **Step 2.1:** 创建 `src/constants/mod.rs`:

```rust
pub mod biology;
```

- [ ] **Step 2.2:** 创建 `src/constants/biology.rs`,顶部模块文档(三条强制注释):

```rust
//! C-3 物理常数。所有单位真实(μm、μm²、μm³、m/s、pJ/s)。
//!
//! **强制项**(宪法 §4 + C-3 spec §5.3):
//!
//! 1. `velocity(d)` 和 `lambda(d)` 共享同一个 `sqrt(d / D_REF_UM)` 因子 ——
//!    这是 cable-theory 的"两面一根",同一根号不要拆开调。改一个必须同步改另一个。
//!
//! 2. 代谢挂**膜面积** ∝ d·len(本模块的 `K_MEMB_EDGE`、`P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2`)。
//!    体积 ∝ d²·len(`K_VOL_EDGE`、`vol_edge`)**只算空间成本,不进代谢公式**。
//!    膜上有泵和漏电流,膜面积随 d 线性增长。两个不同幂次是对的,不要强行统一。
//!
//! 3. 突触维持(`P_MAINT_PER_SYNAPSE_PJ_S`)按端点数计,**与 d 无关**。
//!
//! 数值来源见 `docs/superpowers/plans/2026-05-27-c3-constants-ledger.md`;
//! 每常数附 ESTIMATE 标记或文献引用。

use std::f32::consts::PI;
```

- [ ] **Step 2.3:** 在文件中加几何常数:

```rust
// === 几何常数(公式定义,无需文献) ===

/// 圆截面常数:轴突横截面面积 = K_VOL_EDGE × d²,d 是直径。
pub const K_VOL_EDGE: f32 = PI / 4.0;

/// 圆柱侧面常数:轴突膜面积 = K_MEMB_EDGE × d × len。
pub const K_MEMB_EDGE: f32 = PI;
```

- [ ] **Step 2.4:** 加标定锚(从 ledger 取 user 确认值):

```rust
// === 标定锚(user 确认值,见 ledger §B) ===

/// 单 cell 同层边长(x / y)。
pub const CELL_PITCH_UM: f32 = 5.0;  // user-confirmed; see ledger §B

/// 层间距(z 方向)。
pub const LAYER_HEIGHT_UM: f32 = 10.0;  // user-confirmed; see ledger §B
```

- [ ] **Step 2.5:** 加物理常数,**每条**带 ledger 引用的出处或 ESTIMATE 标记。注意:**实现者**把 Task 1 ledger 中 user 确认的每个值搬到这里 + 抄出处。模板如下,数值占位用 `__VAL__` 标示,真正实现时替换为 ledger 值:

```rust
// === 物理常数(数值与出处见 ledger §C;每条带文献引用或 ESTIMATE) ===

/// 参考轴突粗细 d₀。
pub const D_REF_UM: f32 = __VAL__;  // <出处/ESTIMATE 简短一行,详见 ledger>

/// d = D_REF_UM 时的电紧张长度常数 λ₀。
pub const LAMBDA_REF_UM: f32 = __VAL__;  // <出处/ESTIMATE>

/// d = D_REF_UM 时的传导速度 v₀。
pub const V_REF_M_S: f32 = __VAL__;  // <出处/ESTIMATE>

/// 单神经元胞体体积(空间)。
pub const NEURON_BODY_VOL_UM3: f32 = __VAL__;  // <出处/ESTIMATE>

/// 单神经元胞体膜面积(几何;参考显示用,不直接进代谢公式)。
pub const NEURON_BODY_MEMB_UM2: f32 = __VAL__;  // <出处/ESTIMATE>

/// 单神经元静息功率(已封装"A_body × 漏电"成一个数;见 spec §5.2 不引入中间常数的理由)。
pub const P_REST_PER_NEURON_PJ_S: f32 = __VAL__;  // <出处/ESTIMATE>

/// 单神经元每单位激活(∈ [0,1])的活动功率。活动项归运行时层乘激活,不在 C-3。
pub const P_ACTIVITY_COEF_PER_NEURON_PJ_S: f32 = __VAL__;  // <出处/ESTIMATE>

/// 每 μm² 轴突膜面积的维持功率(代谢主项)。
pub const P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2: f32 = __VAL__;  // <出处/ESTIMATE>

/// 单突触维持功率(按端点数,与 d 无关)。
pub const P_MAINT_PER_SYNAPSE_PJ_S: f32 = __VAL__;  // <出处/ESTIMATE>
```

- [ ] **Step 2.6:** 加 √d 公式 helper(数值断言在 Task 4 写,这里只放函数):

```rust
// === √d 公式 helper(spec §5.3) ===

/// λ(d) = LAMBDA_REF_UM × sqrt(d / D_REF_UM)。单位 μm。
/// **共享 √d 与 `velocity` —— 不要独立调整其中之一。**
pub fn lambda_um(d_um: f32) -> f32 {
    LAMBDA_REF_UM * (d_um / D_REF_UM).sqrt()
}

/// v(d) = V_REF_M_S × sqrt(d / D_REF_UM)。单位 m/s。
/// **共享 √d 与 `lambda_um` —— 不要独立调整其中之一。**
pub fn velocity_m_s(d_um: f32) -> f32 {
    V_REF_M_S * (d_um / D_REF_UM).sqrt()
}

/// 边体积(空间成本):K_VOL_EDGE × d² × len。
pub fn vol_edge_um3(d_um: f32, pathlen_um: f32) -> f32 {
    K_VOL_EDGE * d_um * d_um * pathlen_um
}

/// 边膜面积(代谢驱动):K_MEMB_EDGE × d × len。
pub fn membrane_edge_um2(d_um: f32, pathlen_um: f32) -> f32 {
    K_MEMB_EDGE * d_um * pathlen_um
}

/// 延迟:pathlen_um → 信号穿越时间(ms)。pathlen 换算到米后除以 m/s 速度,再 ×1000 转 ms。
pub fn delay_ms(d_um: f32, pathlen_um: f32) -> f32 {
    let pathlen_m = pathlen_um * 1.0e-6;
    pathlen_m / velocity_m_s(d_um) * 1.0e3
}

/// 衰减系数:exp(−pathlen_um / λ(d))。
pub fn attenuation_coef(d_um: f32, pathlen_um: f32) -> f32 {
    (-pathlen_um / lambda_um(d_um)).exp()
}
```

- [ ] **Step 2.7:** 在 `src/lib.rs` 加模块声明:

打开 `crates/grid_workshop/src/lib.rs`,在 `pub mod routing;` 后插入:

```rust
pub mod constants;
```

- [ ] **Step 2.8:** 验证编译。

Run: `cargo build -p grid_workshop`
Expected: 通过。可能有 `dead_code` 警告(常数尚未被 Task 4+ 使用),OK 暂不消。

- [ ] **Step 2.9:** 提交。

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/constants/ crates/grid_workshop/src/lib.rs && git commit -m "feat(constants): biology.rs — physical constants + √d helpers per C-3 spec"
```

---

## Task 3: `PathTree` pathlen 助手(cell→μm)

**Spec ref:** spec §3.1 "pathlen 单位是 μm,不是 cell 数"。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/path_tree.rs`

**关键设计点:** 同层步(`is_six_neighbor` 的 (0,1,0) 或 (0,0,1))= `CELL_PITCH_UM`;跨层步(1,0,0)= `LAYER_HEIGHT_UM`。这俩可能不相等(标定锚 5 vs 10),需分别累加。

- [ ] **Step 3.1: Write failing tests** 在 `path_tree.rs` 的 `#[cfg(test)] mod tests` 末尾追加:

```rust
    use crate::constants::biology::{CELL_PITCH_UM, LAYER_HEIGHT_UM};

    #[test]
    fn pathlen_total_two_same_layer_steps() {
        // 0,0,0 - 0,1,0 - 0,2,0  (2 同层步)
        let t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let expected = 2.0 * CELL_PITCH_UM;
        assert!((t.pathlen_total_um() - expected).abs() < 1e-4);
    }

    #[test]
    fn pathlen_total_mixed_layer_and_same_layer_steps() {
        // 0,0,0 - 0,1,0 (同层步) - 1,1,0 (跨层步) - 1,2,0 (同层)
        let t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 2, 0)]).unwrap();
        let expected = 2.0 * CELL_PITCH_UM + 1.0 * LAYER_HEIGHT_UM;
        assert!((t.pathlen_total_um() - expected).abs() < 1e-4);
    }

    #[test]
    fn pathlen_to_leaf_traces_parent_chain() {
        // 单端 path:0,0,0 - 0,1,0 - 0,2,0,leaf 是 index 2
        let t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let expected = 2.0 * CELL_PITCH_UM;
        assert!((t.pathlen_to_leaf_um(2) - expected).abs() < 1e-4);
    }

    #[test]
    fn pathlen_to_leaf_with_fork() {
        // 0,0,0 - 0,1,0 - 0,2,0,从 idx 1 分叉到 0,1,1 - 0,1,2
        // leaves: idx 2 (0,2,0) 距 root = 2 cell,idx 4 (0,1,2) 距 root = 3 cell
        let mut t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        t.graft_branch(1, vec![c(0, 1, 1), c(0, 1, 2)]).unwrap();
        let len_to_2 = t.pathlen_to_leaf_um(2);
        let len_to_4 = t.pathlen_to_leaf_um(4);
        assert!((len_to_2 - 2.0 * CELL_PITCH_UM).abs() < 1e-4);
        assert!((len_to_4 - 3.0 * CELL_PITCH_UM).abs() < 1e-4);
    }

    #[test]
    fn pathlen_total_includes_all_segments_including_branches() {
        // 主干 3 cell + 分叉 2 cell:总 cell-邻接段数 = 4(main 2 + branch 2)
        let mut t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        t.graft_branch(1, vec![c(0, 1, 1), c(0, 1, 2)]).unwrap();
        let expected = 4.0 * CELL_PITCH_UM;
        assert!((t.pathlen_total_um() - expected).abs() < 1e-4);
    }
```

- [ ] **Step 3.2: Run** — 应失败(方法未实现)。

Run: `cargo test -p grid_workshop routing::path_tree::tests::pathlen`
Expected: FAIL — `method pathlen_total_um not found`(或类似)。

- [ ] **Step 3.3: 在 `impl PathTree` 中实现两个方法**(放在 `is_leaf` 之后、`child_count` 之前):

```rust
    /// 同层 ↔ 跨层步长不同。spec §3.1:pathlen 单位是 μm,不是 cell 数。
    pub fn pathlen_total_um(&self) -> f32 {
        let mut total = 0.0;
        for (i, parent) in self.parent.iter().enumerate() {
            if let Some(p) = parent {
                total += segment_length_um(self.cells[*p as usize], self.cells[i]);
            }
        }
        total
    }

    /// 从 root 沿 parent 链走到 `leaf` 的累计长度。
    pub fn pathlen_to_leaf_um(&self, leaf: u16) -> f32 {
        let mut total = 0.0;
        let mut cursor = leaf;
        loop {
            match self.parent[cursor as usize] {
                None => return total,
                Some(p) => {
                    total += segment_length_um(self.cells[p as usize], self.cells[cursor as usize]);
                    cursor = p;
                }
            }
        }
    }
```

并在 `is_six_neighbor` 函数下方加 helper:

```rust
/// 6-邻居 cell 对之间的物理距离。同层步 = CELL_PITCH_UM、跨层步 = LAYER_HEIGHT_UM。
fn segment_length_um(a: CellCoord, b: CellCoord) -> f32 {
    use crate::constants::biology::{CELL_PITCH_UM, LAYER_HEIGHT_UM};
    if a.layer != b.layer {
        LAYER_HEIGHT_UM
    } else {
        CELL_PITCH_UM
    }
}
```

- [ ] **Step 3.4: Run tests pass.**

Run: `cargo test -p grid_workshop routing::path_tree::tests::pathlen`
Expected: PASS — 5 个新测试全绿。

Run: `cargo test -p grid_workshop`
Expected: 全绿(原有 65 测试 + 5 新 = 70)。

- [ ] **Step 3.5: Commit.**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/path_tree.rs && git commit -m "feat(routing): PathTree::pathlen_*_um — cell→μm with layer step asymmetry"
```

---

## Task 4: Edge 静态派生 + cost.rs 模块

**Spec ref:** spec §3.1、§4.1、§5.3、§7.1(d 翻倍 → 体积×4 + 膜面积×2)。

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/cost.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/mod.rs`

- [ ] **Step 4.1: 创建 `src/routing/cost.rs`** 含 Edge 方法 + 测试:

```rust
//! C-3 静态成本派生层。spec §3 / §4 / §5。
//!
//! 纯函数 view:输入 (Grid, Routes, Edge, 常数),输出 *Static 类型。
//! 不缓存、不持久化、不挂 Bevy 系统(spec §3.4)。

use crate::constants::biology;
use crate::core::coord::CellCoord;
use crate::core::grid::Grid;
use crate::core::kind::CellContents;
use crate::routing::edge::Edge;
use crate::routing::routes::Routes;
use std::collections::BTreeMap;

// === Edge 方法 ===

impl Edge {
    /// 树上所有 cell-邻接段长度之和(μm)。
    pub fn pathlen_total_um(&self) -> f32 {
        self.tree.pathlen_total_um()
    }

    /// 从 root 到指定 leaf 的 parent 链长度(μm)。
    pub fn pathlen_to_leaf_um(&self, leaf_idx: u16) -> f32 {
        self.tree.pathlen_to_leaf_um(leaf_idx)
    }

    /// 空间成本:K_VOL_EDGE × d² × pathlen_total。
    pub fn volume_um3(&self) -> f32 {
        biology::vol_edge_um3(self.thickness_d, self.pathlen_total_um())
    }

    /// 代谢驱动:K_MEMB_EDGE × d × pathlen_total。
    pub fn membrane_um2(&self) -> f32 {
        biology::membrane_edge_um2(self.thickness_d, self.pathlen_total_um())
    }

    /// 沿 root→leaf 的传导延迟(ms)。
    pub fn delay_ms_to_leaf(&self, leaf_idx: u16) -> f32 {
        biology::delay_ms(self.thickness_d, self.pathlen_to_leaf_um(leaf_idx))
    }

    /// 沿 root→leaf 的衰减系数:exp(−len/λ(d))。无量纲 ∈ (0, 1]。
    pub fn attenuation_to_leaf(&self, leaf_idx: u16) -> f32 {
        biology::attenuation_coef(self.thickness_d, self.pathlen_to_leaf_um(leaf_idx))
    }

    /// 边的静态维持功率(pJ/s)= 膜面积维持 + 突触维持。
    pub fn static_power_pj_s(&self) -> f32 {
        let membrane = self.membrane_um2() * biology::P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2;
        let n_leaves = self.tree.leaves().count() as f32;
        let synapse = n_leaves * biology::P_MAINT_PER_SYNAPSE_PJ_S;
        membrane + synapse
    }
}

// === OrganStatic 聚合类型 ===

#[derive(Debug, Clone, PartialEq)]
pub struct OrganStatic {
    pub neuron_count: usize,
    pub total_volume_um3: f32,
    pub total_membrane_um2: f32,
    pub total_static_pj_s: f32,
    pub per_layer_hull_um2: BTreeMap<i32, f32>,
    pub layered_volume_um3: f32,
    pub max_path_delay_ms: f32,
}

impl Routes {
    /// 一次性算所有 organ 级量(spec §3.3)。
    pub fn organ_static(&self, grid: &Grid) -> OrganStatic {
        // 1) 计数神经元、累加 body volume / membrane / resting power
        let mut neuron_count: usize = 0;
        let mut total_volume = 0.0_f32;
        let mut total_membrane = 0.0_f32;
        let mut total_static = 0.0_f32;
        for (_coord, contents) in grid.occupied_cells() {
            if matches!(contents, CellContents::Neuron(_)) {
                neuron_count += 1;
                total_volume += biology::NEURON_BODY_VOL_UM3;
                total_membrane += biology::NEURON_BODY_MEMB_UM2;
                total_static += biology::P_REST_PER_NEURON_PJ_S;
            }
        }

        // 2) 累加 edge volume / membrane / static power,顺手求 max delay
        let mut max_delay = 0.0_f32;
        for (_eid, edge) in self.edges() {
            total_volume += edge.volume_um3();
            total_membrane += edge.membrane_um2();
            total_static += edge.static_power_pj_s();
            for (leaf_idx, _coord) in edge.tree.leaves() {
                let d = edge.delay_ms_to_leaf(leaf_idx);
                if d > max_delay {
                    max_delay = d;
                }
            }
        }

        // 3) 逐层凸包(occupied cells = neurons + edge wire cells,宪法 §1)
        let per_layer_hull_um2 = compute_per_layer_hulls(grid, self);
        let layered_volume = per_layer_hull_um2
            .values()
            .map(|a| a * biology::LAYER_HEIGHT_UM)
            .sum();

        OrganStatic {
            neuron_count,
            total_volume_um3: total_volume,
            total_membrane_um2: total_membrane,
            total_static_pj_s: total_static,
            per_layer_hull_um2,
            layered_volume_um3: layered_volume,
            max_path_delay_ms: max_delay,
        }
    }
}

// === 凸包(Andrew monotone chain) ===

/// 每层占用 cell 集合 → 投影到 (x, y) → 2D 凸包 → 面积(μm²)。
fn compute_per_layer_hulls(grid: &Grid, routes: &Routes) -> BTreeMap<i32, f32> {
    use std::collections::HashMap;
    // 收集每层的 (x, y) cell 集合
    let mut per_layer: HashMap<i32, Vec<(i32, i32)>> = HashMap::new();
    for (coord, _) in grid.occupied_cells() {
        per_layer.entry(coord.layer).or_default().push((coord.x, coord.y));
    }
    for (_eid, edge) in routes.edges() {
        for c in edge.tree.cells() {
            per_layer.entry(c.layer).or_default().push((c.x, c.y));
        }
    }
    let mut result = BTreeMap::new();
    for (layer, mut pts) in per_layer {
        pts.sort();
        pts.dedup();
        result.insert(layer, hull_area_um2(&pts));
    }
    result
}

/// 输入整数 cell 坐标 (x, y),返回凸包面积(μm²)= 多边形面积 × CELL_PITCH²。
/// 用 Andrew monotone chain。0/1/2 点退化为 0。
fn hull_area_um2(pts: &[(i32, i32)]) -> f32 {
    if pts.len() < 3 {
        return 0.0;
    }
    let hull = convex_hull(pts);
    if hull.len() < 3 {
        return 0.0;
    }
    // shoelace,整数运算,最后 ×0.5 + CELL_PITCH²
    let mut sum: i64 = 0;
    for i in 0..hull.len() {
        let (x1, y1) = hull[i];
        let (x2, y2) = hull[(i + 1) % hull.len()];
        sum += (x1 as i64) * (y2 as i64) - (x2 as i64) * (y1 as i64);
    }
    let area_cells_sq = (sum.abs() as f32) * 0.5;
    let pitch = biology::CELL_PITCH_UM;
    area_cells_sq * pitch * pitch
}

/// Andrew monotone chain。返回 CCW 凸包顶点序列。
fn convex_hull(pts: &[(i32, i32)]) -> Vec<(i32, i32)> {
    let mut p = pts.to_vec();
    p.sort();
    p.dedup();
    if p.len() <= 1 {
        return p;
    }
    let mut lower: Vec<(i32, i32)> = Vec::new();
    for &pt in &p {
        while lower.len() >= 2
            && cross(lower[lower.len() - 2], lower[lower.len() - 1], pt) <= 0
        {
            lower.pop();
        }
        lower.push(pt);
    }
    let mut upper: Vec<(i32, i32)> = Vec::new();
    for &pt in p.iter().rev() {
        while upper.len() >= 2
            && cross(upper[upper.len() - 2], upper[upper.len() - 1], pt) <= 0
        {
            upper.pop();
        }
        upper.push(pt);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

fn cross(o: (i32, i32), a: (i32, i32), b: (i32, i32)) -> i64 {
    ((a.0 - o.0) as i64) * ((b.1 - o.1) as i64) - ((a.1 - o.1) as i64) * ((b.0 - o.0) as i64)
}

// silence "unused" if a const becomes unused in some build flag combo
#[allow(dead_code)]
const _: fn() = || {
    let _: f32 = biology::P_ACTIVITY_COEF_PER_NEURON_PJ_S;
};

// === Tests ===

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::coord::CellCoord;
    use crate::core::kind::NeuronKind;
    use crate::routing::path_tree::PathTree;

    fn c(layer: i32, x: i32, y: i32) -> CellCoord {
        CellCoord::new(layer, x, y)
    }

    fn simple_grid_with_two_neurons() -> Grid {
        let mut g = Grid::new();
        g.place(c(0, 0, 0), CellContents::Neuron(NeuronKind::SensorOn)).unwrap();
        g.place(c(0, 2, 0), CellContents::Neuron(NeuronKind::Motor)).unwrap();
        g
    }

    fn simple_edge() -> Edge {
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        Edge { tree, thickness_d: biology::D_REF_UM, plastic: false, mod_source: None }
    }

    #[test]
    fn delay_at_d_ref_no_sqrt_factor() {
        // d = D_REF → sqrt(d/D_REF) = 1 → velocity = V_REF_M_S, delay = pathlen/v
        let edge = simple_edge();
        let leaf = edge.tree.leaves().last().unwrap().0;
        let pathlen = edge.pathlen_to_leaf_um(leaf);
        let expected = (pathlen * 1e-6) / biology::V_REF_M_S * 1e3;
        let got = edge.delay_ms_to_leaf(leaf);
        assert!((got - expected).abs() < 1e-3, "got {} expected {}", got, expected);
    }

    #[test]
    fn lambda_doubles_at_d_quadrupled() {
        // λ(4·d) = 2·λ(d)
        let l_ref = biology::lambda_um(biology::D_REF_UM);
        let l_4d = biology::lambda_um(4.0 * biology::D_REF_UM);
        assert!((l_4d / l_ref - 2.0).abs() < 1e-3);
    }

    #[test]
    fn attenuation_at_lambda_is_inv_e() {
        // pathlen = λ → exp(−1) ≈ 0.368
        let d = biology::D_REF_UM;
        let lam = biology::lambda_um(d);
        let a = biology::attenuation_coef(d, lam);
        assert!((a - (-1.0_f32).exp()).abs() < 1e-3);
    }

    #[test]
    fn attenuation_at_zero_is_one() {
        let a = biology::attenuation_coef(biology::D_REF_UM, 0.0);
        assert!((a - 1.0).abs() < 1e-6);
    }

    #[test]
    fn volume_quadruples_when_d_doubles() {
        let edge = simple_edge();
        let v1 = edge.volume_um3();
        let edge2 = Edge {
            thickness_d: 2.0 * edge.thickness_d,
            ..simple_edge()
        };
        let v2 = edge2.volume_um3();
        assert!((v2 / v1 - 4.0).abs() < 1e-3);
    }

    #[test]
    fn membrane_doubles_when_d_doubles() {
        // 这条断言显式守护宪法 §4 行 60 "两个不同幂次"。
        let edge = simple_edge();
        let m1 = edge.membrane_um2();
        let edge2 = Edge {
            thickness_d: 2.0 * edge.thickness_d,
            ..simple_edge()
        };
        let m2 = edge2.membrane_um2();
        assert!((m2 / m1 - 2.0).abs() < 1e-3);
    }

    #[test]
    fn synapse_maint_unchanged_when_d_doubles() {
        // 突触维持与 d 无关(spec §5.3 强制项 3)
        let n = simple_edge().tree.leaves().count() as f32;
        let expected = n * biology::P_MAINT_PER_SYNAPSE_PJ_S;
        let edge_thin = simple_edge();
        let edge_fat = Edge { thickness_d: 4.0 * edge_thin.thickness_d, ..simple_edge() };
        // 用 edge.static_power_pj_s 减去 membrane 项就得到 synapse 项
        let synapse_thin =
            edge_thin.static_power_pj_s() - edge_thin.membrane_um2() * biology::P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2;
        let synapse_fat =
            edge_fat.static_power_pj_s() - edge_fat.membrane_um2() * biology::P_MAINT_PER_MEMBRANE_AREA_PJ_S_UM2;
        assert!((synapse_thin - expected).abs() < 1e-4);
        assert!((synapse_fat - expected).abs() < 1e-4);
    }

    #[test]
    fn organ_static_two_neurons_one_edge_hand_account() {
        let grid = simple_grid_with_two_neurons();
        let mut routes = Routes::new();
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        routes
            .place_edge(&grid, tree, biology::D_REF_UM, false, None)
            .unwrap();

        let s = routes.organ_static(&grid);
        assert_eq!(s.neuron_count, 2);
        // total volume = 2 × body_vol + edge_vol
        let edge_vol = biology::vol_edge_um3(biology::D_REF_UM, 2.0 * biology::CELL_PITCH_UM);
        let expected_total_vol = 2.0 * biology::NEURON_BODY_VOL_UM3 + edge_vol;
        assert!((s.total_volume_um3 - expected_total_vol).abs() < 1e-3);
        // hull: 3 个 layer=0 cell 共线 → 面积 = 0
        assert_eq!(s.per_layer_hull_um2.len(), 1);
        assert!((s.per_layer_hull_um2[&0] - 0.0).abs() < 1e-6);
        // layered volume = 0 (no area)
        assert!((s.layered_volume_um3 - 0.0).abs() < 1e-6);
        // max delay > 0
        assert!(s.max_path_delay_ms > 0.0);
    }

    #[test]
    fn hull_area_non_colinear_triangle() {
        let pts = vec![(0, 0), (4, 0), (0, 3)];
        let area = hull_area_um2(&pts);
        // 整数三角形 shoelace area = |4·3 − 0·0|/2 = 6;乘 pitch²
        let expected = 6.0 * biology::CELL_PITCH_UM * biology::CELL_PITCH_UM;
        assert!((area - expected).abs() < 1e-3);
    }

    #[test]
    fn hull_includes_wire_cells_sprawling_increases_hull() {
        // 两神经元同层近邻 → hull tiny;加一条远绕路径 wire → hull 严格变大。
        let mut grid = Grid::new();
        grid.place(c(0, 0, 0), CellContents::Neuron(NeuronKind::SensorOn)).unwrap();
        grid.place(c(0, 1, 0), CellContents::Neuron(NeuronKind::Motor)).unwrap();
        let mut routes_short = Routes::new();
        let short = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0)]).unwrap();
        routes_short.place_edge(&grid, short, biology::D_REF_UM, false, None).unwrap();
        let s_short = routes_short.organ_static(&grid);
        let hull_short = s_short.per_layer_hull_um2[&0];

        let mut grid2 = Grid::new();
        grid2.place(c(0, 0, 0), CellContents::Neuron(NeuronKind::SensorOn)).unwrap();
        grid2.place(c(0, 1, 0), CellContents::Neuron(NeuronKind::Motor)).unwrap();
        let mut routes_long = Routes::new();
        // 绕一圈:0,0,0 -> 0,0,5 -> 0,5,5 -> 0,5,0 -> 0,1,0
        let long = PathTree::from_path(vec![
            c(0, 0, 0), c(0, 0, 1), c(0, 0, 2), c(0, 0, 3), c(0, 0, 4), c(0, 0, 5),
            c(0, 1, 5), c(0, 2, 5), c(0, 3, 5), c(0, 4, 5), c(0, 5, 5),
            c(0, 5, 4), c(0, 5, 3), c(0, 5, 2), c(0, 5, 1), c(0, 5, 0),
            c(0, 4, 0), c(0, 3, 0), c(0, 2, 0), c(0, 1, 0),
        ])
        .unwrap();
        routes_long.place_edge(&grid2, long, biology::D_REF_UM, false, None).unwrap();
        let s_long = routes_long.organ_static(&grid2);
        let hull_long = s_long.per_layer_hull_um2[&0];
        assert!(hull_long > hull_short);
    }
}
```

- [ ] **Step 4.2: 更新 `routing/mod.rs`** —— 加入 cost 模块声明 + re-export:

打开 `src/routing/mod.rs`,在 `pub mod render;` 后追加:

```rust
pub mod cost;
```

然后在 `pub use ops::{...}` 块下方追加:

```rust
pub use cost::OrganStatic;
```

- [ ] **Step 4.3: 更新 `src/lib.rs`** 加 `OrganStatic` 到 top-level re-export 块。打开 `lib.rs`,在 `pub use routing::{` 那个块中加 `OrganStatic`(放在合适的字母位置或末尾)。

- [ ] **Step 4.4: Run all tests.**

Run: `cargo test -p grid_workshop`
Expected: 全绿(70 prior + ~10 new = ~80)。

- [ ] **Step 4.5: Run clippy with -D warnings.**

Run: `cargo clippy -p grid_workshop --tests --examples -- -D warnings`
Expected: 通过。如果出 lint(如 `needless_borrow` 之类),按编译器建议修。

- [ ] **Step 4.6: Commit.**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/cost.rs crates/grid_workshop/src/routing/mod.rs crates/grid_workshop/src/lib.rs && git commit -m "feat(routing): cost.rs — Edge derivations + OrganStatic + convex hull"
```

---

## Task 5: `cost_demo` example —— 调试读出七个数

**Spec ref:** spec §6。

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/examples/cost_demo.rs`

- [ ] **Step 5.1: 创建 `examples/cost_demo.rs`:**

```rust
//! C-3 调试读出:把 OrganStatic 的七个数 info!log 出来。
//! 不画、不开窗,纯 cargo run --example 启一次就退出。
//! 用 MinimalPlugins,跑一帧后 exit。

use bevy::app::{AppExit, ScheduleRunnerPlugin};
use bevy::log::LogPlugin;
use bevy::prelude::*;
use grid_workshop::{
    CellCoord, EdgeOps, GridPlugin, GridRes, NeuronKind, PathTree, RoutesPlugin, RoutesRes,
};

fn main() {
    App::new()
        .add_plugins(MinimalPlugins.set(ScheduleRunnerPlugin::run_once()))
        .add_plugins(LogPlugin::default())
        .add_plugins((GridPlugin, RoutesPlugin))
        .add_systems(Startup, build_scene)
        .add_systems(Update, (print_organ_static, |mut e: EventWriter<AppExit>| { e.send(AppExit::Success); }))
        .run();
}

fn build_scene(mut grid: ResMut<GridRes>, mut routes: ResMut<RoutesRes>) {
    let mut ops = EdgeOps::new(&mut grid.0, &mut routes.0);
    ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn).unwrap();
    ops.place_neuron(CellCoord::new(0, 4, 0), NeuronKind::Motor).unwrap();
    ops.place_neuron(CellCoord::new(0, 2, 2), NeuronKind::Motor).unwrap();
    let mut tree = PathTree::from_path(vec![
        CellCoord::new(0, 0, 0),
        CellCoord::new(0, 1, 0),
        CellCoord::new(0, 2, 0),
        CellCoord::new(0, 3, 0),
        CellCoord::new(0, 4, 0),
    ])
    .unwrap();
    tree.graft_branch(2, vec![CellCoord::new(0, 2, 1), CellCoord::new(0, 2, 2)]).unwrap();
    ops.place_edge(tree, 1.0, false, None).unwrap();
}

fn print_organ_static(grid: Res<GridRes>, routes: Res<RoutesRes>) {
    let s = routes.0.organ_static(&grid.0);
    info!("--- OrganStatic ---");
    info!("neuron_count          : {}", s.neuron_count);
    info!("total_volume_um3      : {:.3}", s.total_volume_um3);
    info!("total_membrane_um2    : {:.3}", s.total_membrane_um2);
    info!("total_static_pj_s     : {:.3}", s.total_static_pj_s);
    info!("layered_volume_um3    : {:.3}", s.layered_volume_um3);
    info!("max_path_delay_ms     : {:.3}", s.max_path_delay_ms);
    info!("per_layer_hull_um2    :");
    for (layer, area) in &s.per_layer_hull_um2 {
        info!("  layer {} : {:.3} um²", layer, area);
    }
}
```

- [ ] **Step 5.2: 验证编译 + 跑一次。**

Run: `cargo build -p grid_workshop --example cost_demo`
Expected: 通过。

Run: `cargo run -p grid_workshop --example cost_demo`
Expected: 七行 OrganStatic 数字在控制台。**实际数字依赖 Task 2 填入的常数。** 这一步是开发者"看一眼数字合不合理"的入口。

- [ ] **Step 5.3: Commit.**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/examples/cost_demo.rs && git commit -m "feat(routing): cost_demo — debug readout of OrganStatic seven numbers"
```

---

## Task 6: App-level smoke test

**Spec ref:** spec §7.2 中提到的"插件接通"检查的成本对位物。

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/tests/cost_smoke.rs`

- [ ] **Step 6.1: 创建 `tests/cost_smoke.rs`:**

```rust
use bevy::prelude::*;
use grid_workshop::{
    CellCoord, EdgeOps, Grid, GridPlugin, GridRes, NeuronKind, PathTree,
    Routes, RoutesPlugin, RoutesRes,
};

#[test]
fn organ_static_reachable_through_app_resources() {
    let mut app = App::new();
    app.add_plugins((GridPlugin, RoutesPlugin));
    {
        let world = app.world_mut();
        let mut grid_res = world.resource_mut::<GridRes>();
        let mut grid_inner: Grid = std::mem::take(&mut grid_res.0);
        drop(grid_res);

        let mut routes_res = world.resource_mut::<RoutesRes>();
        let mut routes_inner: Routes = std::mem::take(&mut routes_res.0);
        drop(routes_res);

        {
            let mut ops = EdgeOps::new(&mut grid_inner, &mut routes_inner);
            ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn).unwrap();
            ops.place_neuron(CellCoord::new(0, 2, 0), NeuronKind::Motor).unwrap();
            let t = PathTree::from_path(vec![
                CellCoord::new(0, 0, 0),
                CellCoord::new(0, 1, 0),
                CellCoord::new(0, 2, 0),
            ])
            .unwrap();
            ops.place_edge(t, 1.0, false, None).unwrap();
        }

        world.resource_mut::<GridRes>().0 = grid_inner;
        world.resource_mut::<RoutesRes>().0 = routes_inner;
    }
    app.update();

    let grid = &app.world().resource::<GridRes>().0;
    let routes = &app.world().resource::<RoutesRes>().0;
    let s = routes.organ_static(grid);
    assert_eq!(s.neuron_count, 2);
    assert!(s.total_volume_um3 > 0.0);
    assert!(s.total_membrane_um2 > 0.0);
    assert!(s.total_static_pj_s > 0.0);
    assert!(s.max_path_delay_ms > 0.0);
}
```

- [ ] **Step 6.2: Run.**

Run: `cargo test -p grid_workshop --test cost_smoke`
Expected: PASS。

Run: `cargo test -p grid_workshop`
Expected: 全绿(82+ 测试)。

- [ ] **Step 6.3: Commit.**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/tests/cost_smoke.rs && git commit -m "test(routing): cost_smoke — organ_static reachable through App resources"
```

---

## Task 7: 收尾 — clippy 全套 + worklog

**Files:**
- Modify: `D:/dev/Umwelt/docs/worklog.md`

- [ ] **Step 7.1: 全套 verification.**

Run: `cargo test -p grid_workshop`
Expected: 全绿。

Run: `cargo build -p grid_workshop --examples`
Expected: 三个 example(`three_layer_demo`, `routing_demo`, `cost_demo`)都编译过。

Run: `cargo clippy -p grid_workshop --tests --examples -- -D warnings`
Expected: 干净。如果 release 模式有 lint,跑 `cargo clippy -p grid_workshop --release -- -D warnings` 也确认。

- [ ] **Step 7.2: 追加 worklog 段。**

打开 `D:/dev/Umwelt/docs/worklog.md`,在 `## 2026-05-27` 段下追加(注意 worklog 已有当日 entry,在做了什么部分末尾加段):

```markdown

- **C-3 子系统 spec + 实现落地**:`docs/superpowers/specs/2026-05-28-bevy-subsystem-c3-cost-design.md` v0.2(定稿,5 条 review 决定回到正文) + `docs/superpowers/plans/2026-05-27-bevy-subsystem-c3-cost.md`(7 task)。
  - **宪法 §1 + §4 同步修订**:hull 含 wire 线格;代谢 ∝ 膜面积 d·len、体积 d²·len 是空间成本不进代谢;突触维持与 d 无关。
  - 落地:`constants/biology.rs`(常数 + √d helper + 三条强制注释)+ `routing/cost.rs`(Edge 派生方法、OrganStatic、Andrew monotone chain 凸包)+ `PathTree::pathlen_*_um`(同层步 / 跨层步 asymmetric)+ `cost_demo` + `cost_smoke`。
  - 常数 ledger 是 Task 1 的输出(`2026-05-27-c3-constants-ledger.md`),user 拍板后才进 Task 2 的 biology.rs;cell pitch 提议 5μm + 层高 10μm,user 已确认。
  - 验证:cargo test 全绿、clippy --tests --examples -- -D warnings 干净、三个 example 都编译。
```

- [ ] **Step 7.3: Commit worklog.**

```bash
cd D:/dev/Umwelt && git add docs/worklog.md && git commit -m "docs(worklog): C-3 cost subsystem landed"
```

---

## Self-Review

| 检查 | 结果 |
|---|---|
| Spec §1.1 五个代价量 | delay/attenuation 在 Edge methods(Task 4)、volume/membrane 在 Edge methods(Task 4)、static power 在 Edge(Task 4)、逐层 hull 在 cost.rs(Task 4) |
| Spec §1.2 五条不做 | 无渲染(无 example 画 mesh / gizmo)、无活动项(只有 static)、无 par 比对、无合成总分、无 HTML 导出 |
| Spec §1.3 C-2 spec 勘误 | Task 0 |
| Spec §2 静态/运行时切分 | Edge 方法和 OrganStatic 完全静态,无 activation 参数;P_ACTIVITY_COEF 仅作为常数暴露不在 organ_static 里聚合 |
| Spec §3.1 Edge 派生量 | Task 4 含 volume_um3、membrane_um2、delay_ms_to_leaf、attenuation_to_leaf、static_power_pj_s |
| Spec §3.2 NeuronStatic 不区分 kind | Task 4 `organ_static` 用单一 NEURON_BODY_VOL/MEMB/P_REST 常数 |
| Spec §3.3 OrganStatic 七字段 | Task 4 类型定义 + `organ_static` 实现 |
| Spec §3.4 按需算不缓存 | 无 cache 字段;Edge methods 调用即算 |
| Spec §4 API 形态 | Edge inherent methods + Routes::organ_static |
| Spec §5 biology.rs 常数 + 强制注释 + ledger | Task 1(ledger)+ Task 2(biology.rs);三条强制注释在 Task 2 顶部 module doc |
| Spec §7.1 数值断言 | Task 4 测试包含 d_ref 退化、λ × 2 at 4×d、e⁻¹ at λ、d 翻倍 → vol×4 + memb×2、synapse 与 d 无关、organ_static 手算 |
| Spec §7.2 几何 / 拓扑 | Task 4 含 fork 后 per-leaf delay / hull-includes-wire 增加 |
| Spec §7.3 不变量 | Task 4 测试覆盖了部分;d↑/pathlen↑ 严格单调断言可在 Task 4 末加补充 |
| Spec §8.1 cell pitch user 确认锚 | Task 1 ledger + 控制层 NEEDS_USER_CONFIRMATION 硬同步点 |
| Spec §8.2 待取数 | Task 1 ledger 全列;Task 2 把 user 批准的值填进 biology.rs |
| 占位符扫描 | `__VAL__` 在 Task 2 step 2.5 是显式占位,**实现者替换为 ledger 值**,不是 plan placeholder。其余无 TBD/TODO |
| 类型一致性 | `EdgeOps`、`OrganStatic`、`organ_static`、`pathlen_total_um`、`pathlen_to_leaf_um`、`volume_um3`、`membrane_um2`、`delay_ms_to_leaf`、`attenuation_to_leaf`、`static_power_pj_s` 跨 task 拼写统一 |
