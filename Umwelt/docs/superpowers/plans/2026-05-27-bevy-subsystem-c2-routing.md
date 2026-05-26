# Bevy 子系统 C-2 — Routing / Edge 模型 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 C-1 网格基质之上加 routing/edge 数据模型 — `Edge` 树、双反查索引(线格单值 + 端点多值)、级联删除非对称、modulator 失效降级、隐式 via、`EdgeOps` 唯一入口 + Bevy `RoutesPlugin` + gizmo 可视化 + `routing_demo` example。

**Architecture:** Routing 作为 `grid_workshop` crate 的子模块 `src/routing/` 落地(spec §6 #8:与 Grid 同 crate,才能把 Grid 的 neuron mutator 设 `pub(crate)`,从结构上把 `EdgeOps` 强制为唯一入口)。先做 task 0 — 删 C-1 已落地的 `CellContents::Via` 变体(spec §3.4 / §6 #2:via 走隐式,违反宪法 §2 的"无 Via entity")。然后 PathTree → Edge → Routes(双索引)→ EdgeOps → Bevy 集成 → 测试三件套。

**Tech Stack:** Rust 2024、Bevy 0.15、glam、smallvec(新增依赖)、proptest(新增 dev 依赖)、HashMap。

**Spec:** `D:/dev/Umwelt/docs/superpowers/specs/2026-05-26-bevy-subsystem-c2-routing-design.md` v0.2。

**宪法:** `D:/dev/Umwelt/docs/umwelt_design_constitution.md` — 每个不变量绑定到 §1–§5,违反不能"灵活处理",surface conflict。

---

## File Structure

**Modify(C-1 已落地):**
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/core/kind.rs` — 删 `CellContents::Via` 变体 + 相关测试
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/core/grid.rs` — 测试改 `Neuron` 替代 `Via`,`place` / `remove` 改 `pub(crate)`(task 7)
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/render.rs` — 删 `CellContents::Via` 匹配臂
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/lib.rs` — re-export routing 公开类型
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/plugin.rs` — `RoutesPlugin` 与 `GridPlugin` 并列
- `D:/dev/umwelt-bevy/crates/grid_workshop/examples/three_layer_demo.rs` — 删 `Via` 用例
- `D:/dev/umwelt-bevy/crates/grid_workshop/Cargo.toml` — 加 `smallvec`、dev `proptest`
- `D:/dev/Umwelt/docs/superpowers/plans/2026-05-24-bevy-subsystem-c1-grid-substrate.md` — 文档头加 v0.2 注

**Create:**
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/mod.rs` — 子模块入口 + re-export
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/ids.rs` — `EdgeId`、`PathEndpoint` newtype
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/path_tree.rs` — `PathTree`(扁平 cells+parent)
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/edge.rs` — `Edge` 结构、`PlaceEdgeError`、`NeuronRemovalImpact`、`PrunedBranch`、`DemoteRecord`、`KindReplaceImpact`
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/routes.rs` — `Routes` 结构 + `place_edge` / `remove_edge` / `on_neuron_removed` / `on_neuron_kind_replaced`
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/ops.rs` — `EdgeOps<'a>` 唯一入口
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/plugin.rs` — `RoutesPlugin` + `RoutesRes` + debug invariant validator
- `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/render.rs` — `RoutesRenderPlugin`(gizmo)
- `D:/dev/umwelt-bevy/crates/grid_workshop/examples/routing_demo.rs` — 3 神经元 + 2 边,R 热键演示 cascade / prune / demote
- `D:/dev/umwelt-bevy/crates/grid_workshop/tests/routing_smoke.rs` — App-level 烟测
- `D:/dev/umwelt-bevy/crates/grid_workshop/tests/routing_prop.rs` — proptest I-1..I-7

**职责切分理由:** Routes 是数据(`routes.rs`)、Edge 类型与错误是值对象(`edge.rs`)、PathTree 是独立算法(`path_tree.rs`)、ID 是窄类型(`ids.rs`)、EdgeOps 是组合入口(`ops.rs`)、Bevy 接线单独放(`plugin.rs`、`render.rs`)。这样每个文件 < 300 行,改一处不必加载全部上下文。

---

## Task 0: C-1 改动 — 删 `CellContents::Via` 变体

**Spec ref:** §3.4(via 走隐式)、§6 #2(已决定);宪法 §2(no Via entity)。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/core/kind.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/core/grid.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/render.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/examples/three_layer_demo.rs`
- Modify: `D:/dev/Umwelt/docs/superpowers/plans/2026-05-24-bevy-subsystem-c1-grid-substrate.md`(文档注)

- [ ] **Step 0.1:** 在 C-1 plan 文档顶部 `# Bevy 子系统 C-1` 标题下方插入 v0.2 注。

打开 `D:/dev/Umwelt/docs/superpowers/plans/2026-05-24-bevy-subsystem-c1-grid-substrate.md`,在第一行 `# ...` 标题与第二行之间插入:

```markdown
> **v0.2 注(2026-05-27,随 C-2 v0.2 spec 落地):** `CellContents::Via` 变体作废,via 走隐式 — 见 `docs/superpowers/specs/2026-05-26-bevy-subsystem-c2-routing-design.md` §3.4。本文档下文凡引用 `CellContents::Via` 的 task(Task 3、Task 4、Task 6 渲染、Task 8 example)以 C-2 实现计划 Task 0 的改动为准,本文未回填以保留 v0.1 历史原貌。
```

- [ ] **Step 0.2:** 改 `core/kind.rs` — 删 `Via` 变体与相关测试。

替换 `core/kind.rs` 整文件为:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NeuronKind {
    SensorOn,
    InterExc,
    InterInh,
    Modulator,
    Motor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CellContents {
    #[default]
    Empty,
    Neuron(NeuronKind),
}

impl CellContents {
    pub fn is_occupied(self) -> bool {
        !matches!(self, CellContents::Empty)
    }

    pub fn as_neuron(self) -> Option<NeuronKind> {
        match self {
            CellContents::Neuron(k) => Some(k),
            CellContents::Empty => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_five_neuron_kinds_exist() {
        let kinds = [
            NeuronKind::SensorOn,
            NeuronKind::InterExc,
            NeuronKind::InterInh,
            NeuronKind::Modulator,
            NeuronKind::Motor,
        ];
        assert_eq!(kinds.len(), 5);
    }

    #[test]
    fn cell_contents_empty_is_default() {
        let c: CellContents = CellContents::default();
        assert_eq!(c, CellContents::Empty);
    }

    #[test]
    fn cell_contents_neuron_carries_kind() {
        let c = CellContents::Neuron(NeuronKind::Motor);
        match c {
            CellContents::Neuron(k) => assert_eq!(k, NeuronKind::Motor),
            _ => panic!("expected Neuron"),
        }
    }

    #[test]
    fn is_occupied_distinguishes_empty_from_neuron() {
        assert!(!CellContents::Empty.is_occupied());
        assert!(CellContents::Neuron(NeuronKind::SensorOn).is_occupied());
    }

    #[test]
    fn as_neuron_extracts_kind() {
        assert_eq!(CellContents::Empty.as_neuron(), None);
        assert_eq!(
            CellContents::Neuron(NeuronKind::Modulator).as_neuron(),
            Some(NeuronKind::Modulator)
        );
    }
}
```

- [ ] **Step 0.3:** 改 `core/grid.rs` 测试 — 把所有用 `Via` 的地方换成 `Neuron(NeuronKind::SensorOn)` 等具体类型。

打开 `core/grid.rs`,逐行替换测试段:

- 第 77 行 `g.place(c(0, 0, 0), CellContents::Via).unwrap();` → `g.place(c(0, 0, 0), CellContents::Neuron(NeuronKind::SensorOn)).unwrap();`
- 第 92–95 行测试 `remove`:把 `Via` 换成 `Neuron(NeuronKind::SensorOn)`,断言对应改。
- 第 107、113 行(`occupied_cells_iter_lists_all_placed` 测试)把 `Via` 换成 `Neuron(NeuronKind::SensorOn)`,断言对应改。
- 第 122 行(`len_counts_only_occupied`)把 `Via` 换成 `Neuron(NeuronKind::SensorOn)`。

不要改 `Grid` 结构本身的 pub 性 — Task 7 会做 `pub(crate)` 改动。

- [ ] **Step 0.4:** 改 `render.rs` — 删 `CellContents::Via` 匹配臂。

打开 `src/render.rs`,删除第 26 行:

```rust
        CellContents::Via => Color::srgb(0.85, 0.85, 0.85),
```

留下 `color_for` 的 match 只剩 `Empty` + 5 个 Neuron 分支(已穷尽)。

- [ ] **Step 0.5:** 改 `examples/three_layer_demo.rs` — 把 Via 那一格换成空(隐式 via 在 C-2 落地前,该 demo 暂时只展示神经元摆放;C-2 task 10 的 `routing_demo` 才展示路径)。

打开 `examples/three_layer_demo.rs`,删除第 22 行:

```rust
    grid.0.place(CellCoord::new(1,  0, 1), CellContents::Via).unwrap();
```

保留余下神经元摆放代码不动。

- [ ] **Step 0.6:** 运行 cargo 检查编译通过 + 测试全绿。

Run: `cargo test -p grid_workshop`
Expected: 全绿。若 `unused import` 警告(因为 Via 删除可能空出导入),按编译器提示删掉。

Run: `cargo build -p grid_workshop --example three_layer_demo`
Expected: 编译通过。

- [ ] **Step 0.7:** 提交 Task 0。

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/core/kind.rs crates/grid_workshop/src/core/grid.rs crates/grid_workshop/src/render.rs crates/grid_workshop/examples/three_layer_demo.rs && git commit -m "refactor(grid_workshop): drop CellContents::Via — via goes implicit per C-2 v0.2"
cd D:/dev/Umwelt && git add docs/superpowers/plans/2026-05-24-bevy-subsystem-c1-grid-substrate.md && git commit -m "docs(C-1 plan): annotate Via deprecation per C-2 v0.2"
```

---

## Task 1: 加 dependencies + routing 模块骨架

**Spec ref:** §2.3(SmallVec)、§5.3(proptest)。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/Cargo.toml`
- Modify: `D:/dev/umwelt-bevy/Cargo.toml`(workspace dep 集中)
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/mod.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/lib.rs`

- [ ] **Step 1.1:** 在 workspace `Cargo.toml` 的 `[workspace.dependencies]` 末尾追加:

```toml
smallvec = "1.13"
proptest = "1.5"
```

完整段应为:

```toml
[workspace.dependencies]
bevy = { version = "0.15", default-features = false, features = ["bevy_render", "bevy_pbr", "bevy_gizmos", "bevy_winit", "tonemapping_luts", "ktx2", "zstd"] }
glam = "0.29"
smallvec = "1.13"
proptest = "1.5"
```

- [ ] **Step 1.2:** 在 `crates/grid_workshop/Cargo.toml` 的 `[dependencies]` 加 smallvec、`[dev-dependencies]` 加 proptest:

```toml
[dependencies]
bevy = { workspace = true }
glam = { workspace = true }
smallvec = { workspace = true }

[dev-dependencies]
approx = "0.5"
proptest = { workspace = true }
```

- [ ] **Step 1.3:** 创建 `src/routing/mod.rs`:

```rust
//! C-2: routing / edge model.
//!
//! Spec: `docs/superpowers/specs/2026-05-26-bevy-subsystem-c2-routing-design.md` v0.2.
//! Constitution: `docs/umwelt_design_constitution.md` §1–§5.

pub mod ids;
pub mod path_tree;
pub mod edge;
pub mod routes;
pub mod ops;
pub mod plugin;
pub mod render;

pub use ids::{EdgeId, PathEndpoint};
pub use path_tree::PathTree;
pub use edge::{
    Edge, PlaceEdgeError, NeuronRemovalImpact, PrunedBranch, DemoteRecord, KindReplaceImpact,
};
pub use routes::Routes;
pub use ops::EdgeOps;
pub use plugin::{RoutesPlugin, RoutesRes};
pub use render::RoutesRenderPlugin;
```

注:这一步会让 `cargo build` 暂时失败(子模块文件不存在)。在 Task 2 开头创建占位 `pub mod ids` 等空文件即可解锁;但为了让本任务自身闭合,本步只写 mod.rs 不跑编译。

- [ ] **Step 1.4:** 修改 `src/lib.rs`:

```rust
pub mod core;
pub mod plugin;
pub mod render;
pub mod debug;
pub mod routing;

pub use core::coord::{CellCoord, CELL_PITCH, LAYER_PITCH};
pub use core::grid::{Grid, PlaceError};
pub use core::kind::{CellContents, NeuronKind};
pub use plugin::{GridPlugin, GridRes};
pub use routing::{
    Edge, EdgeId, EdgeOps, NeuronRemovalImpact, PathEndpoint, PathTree,
    PlaceEdgeError, Routes, RoutesPlugin, RoutesRes,
};
```

- [ ] **Step 1.5:** 创建七个子模块的占位文件,让 cargo build 在本 task 末尾能通过:

`src/routing/ids.rs`:
```rust
// implemented in Task 2
```

`src/routing/path_tree.rs`:
```rust
use crate::core::coord::CellCoord;

/// Placeholder — implemented in Task 3.
pub struct PathTree {
    pub(crate) cells: Vec<CellCoord>,
    pub(crate) parent: Vec<Option<u16>>,
}
```

`src/routing/edge.rs`:
```rust
// implemented in Task 4
```

`src/routing/routes.rs`:
```rust
// implemented in Task 5
```

`src/routing/ops.rs`:
```rust
// implemented in Task 8
```

`src/routing/plugin.rs`:
```rust
// implemented in Task 9
```

`src/routing/render.rs`:
```rust
// implemented in Task 10
```

注意:`mod.rs` 中的 `pub use` 引用了尚未存在的类型,本 task 暂时把 `pub use` 改为占位 — **替换 mod.rs 的 `pub use` 段为下方**:

```rust
// pub-use 待后续 task 逐步加回 — 见每 task 的 Step "更新 mod.rs"。
```

`mod.rs` 完整内容此时:

```rust
//! C-2: routing / edge model.
//!
//! Spec: `docs/superpowers/specs/2026-05-26-bevy-subsystem-c2-routing-design.md` v0.2.
//! Constitution: `docs/umwelt_design_constitution.md` §1–§5.

pub mod ids;
pub mod path_tree;
pub mod edge;
pub mod routes;
pub mod ops;
pub mod plugin;
pub mod render;

// pub-use 待后续 task 逐步加回 — 见每 task 的 Step "更新 mod.rs"。
```

`lib.rs` 完整内容此时(不导出 routing 内部类型):

```rust
pub mod core;
pub mod plugin;
pub mod render;
pub mod debug;
pub mod routing;

pub use core::coord::{CellCoord, CELL_PITCH, LAYER_PITCH};
pub use core::grid::{Grid, PlaceError};
pub use core::kind::{CellContents, NeuronKind};
pub use plugin::{GridPlugin, GridRes};
```

- [ ] **Step 1.6:** 验证编译通过。

Run: `cargo build -p grid_workshop`
Expected: 通过(可能有 dead_code 警告,正常)。

- [ ] **Step 1.7:** 提交。

```bash
cd D:/dev/umwelt-bevy && git add Cargo.toml crates/grid_workshop/Cargo.toml crates/grid_workshop/src/lib.rs crates/grid_workshop/src/routing/ && git commit -m "scaffold(routing): submodule skeleton + smallvec/proptest deps"
```

---

## Task 2: `EdgeId` + `PathEndpoint` newtype

**Spec ref:** §2.1(EdgeId u32 + PathEndpoint(CellCoord) 包 coord-as-id)、§6 #3(不重用 id)、宪法 §3。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/ids.rs`

- [ ] **Step 2.1: Write the failing tests** in `src/routing/ids.rs`:

```rust
use crate::core::coord::CellCoord;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct EdgeId(pub u32);

/// coord-as-id 的 newtype 包装(宪法 §3、spec §2.1)。
/// 未来若改成 explicit NeuronId 是局部改动,不是全仓 sweep。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PathEndpoint(pub CellCoord);

impl PathEndpoint {
    pub fn coord(self) -> CellCoord {
        self.0
    }
}

impl From<CellCoord> for PathEndpoint {
    fn from(c: CellCoord) -> Self {
        Self(c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_id_is_distinct_per_value() {
        assert_ne!(EdgeId(0), EdgeId(1));
    }

    #[test]
    fn edge_id_hashable() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        set.insert(EdgeId(7));
        set.insert(EdgeId(7));
        assert_eq!(set.len(), 1);
    }

    #[test]
    fn path_endpoint_round_trips_coord() {
        let c = CellCoord::new(0, 1, 2);
        let e: PathEndpoint = c.into();
        assert_eq!(e.coord(), c);
    }

    #[test]
    fn path_endpoint_hashable_distinct_from_other_coords() {
        let a = PathEndpoint(CellCoord::new(0, 0, 0));
        let b = PathEndpoint(CellCoord::new(0, 0, 1));
        assert_ne!(a, b);
    }
}
```

- [ ] **Step 2.2: Run tests**

Run: `cargo test -p grid_workshop routing::ids`
Expected: PASS(实现是和测试同步写的简单 newtype,无需 RED 阶段)。

- [ ] **Step 2.3: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/ids.rs && git commit -m "feat(routing): EdgeId + PathEndpoint newtype"
```

---

## Task 3: `PathTree` 扁平表示 + 操作

**Spec ref:** §2.2(单一扁平 cells + parent,is_path 是查询)、§3.2.3(prune_to_node 剪到最近 fork)、宪法 §3(F4 树)、§2(单 parent 禁止 join)。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/path_tree.rs`

- [ ] **Step 3.1: Write the failing tests** by replacing `path_tree.rs` with:

```rust
use crate::core::coord::CellCoord;
use smallvec::SmallVec;

/// Spec §2.2 — 单一扁平表示:`cells` index 即节点 id,`parent[0] = None`。
/// 退化为 path 时 `parent` 是单调链 `None, Some(0), Some(1), ...`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathTree {
    cells: Vec<CellCoord>,
    parent: Vec<Option<u16>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathTreeError {
    /// 输入路径为空
    Empty,
    /// 输入路径相邻 cell 不是 6-邻居
    Discontinuous { from: CellCoord, to: CellCoord },
    /// graft 的 attach_at 超出当前节点数
    AttachOutOfRange { attach: u16, len: u16 },
    /// graft 的 branch 第一格不与 attach 相邻
    BranchNotAdjacent { attach: CellCoord, first: CellCoord },
    /// graft 的 branch 自身不连续
    BranchDiscontinuous { from: CellCoord, to: CellCoord },
    /// graft 的 branch 在 65k cell 上限
    TooManyCells,
}

impl PathTree {
    /// 从 cells 序列构造单调链(退化 path)。要求 cells.len() >= 1,且相邻 6-邻居。
    pub fn from_path(cells: Vec<CellCoord>) -> Result<Self, PathTreeError> {
        if cells.is_empty() {
            return Err(PathTreeError::Empty);
        }
        if cells.len() > u16::MAX as usize {
            return Err(PathTreeError::TooManyCells);
        }
        for w in cells.windows(2) {
            if !is_six_neighbor(w[0], w[1]) {
                return Err(PathTreeError::Discontinuous { from: w[0], to: w[1] });
            }
        }
        let mut parent: Vec<Option<u16>> = Vec::with_capacity(cells.len());
        parent.push(None);
        for i in 1..cells.len() {
            parent.push(Some((i - 1) as u16));
        }
        Ok(Self { cells, parent })
    }

    /// 从已存在 attach_at 节点引出新分支。branch_cells[0] 必须与 cells[attach_at] 相邻。
    pub fn graft_branch(
        &mut self,
        attach_at: u16,
        branch_cells: Vec<CellCoord>,
    ) -> Result<(), PathTreeError> {
        if branch_cells.is_empty() {
            return Err(PathTreeError::Empty);
        }
        let attach_idx = attach_at as usize;
        if attach_idx >= self.cells.len() {
            return Err(PathTreeError::AttachOutOfRange {
                attach: attach_at,
                len: self.cells.len() as u16,
            });
        }
        let attach_cell = self.cells[attach_idx];
        if !is_six_neighbor(attach_cell, branch_cells[0]) {
            return Err(PathTreeError::BranchNotAdjacent {
                attach: attach_cell,
                first: branch_cells[0],
            });
        }
        for w in branch_cells.windows(2) {
            if !is_six_neighbor(w[0], w[1]) {
                return Err(PathTreeError::BranchDiscontinuous { from: w[0], to: w[1] });
            }
        }
        if self.cells.len() + branch_cells.len() > u16::MAX as usize {
            return Err(PathTreeError::TooManyCells);
        }
        let first_new = self.cells.len() as u16;
        self.cells.push(branch_cells[0]);
        self.parent.push(Some(attach_at));
        for i in 1..branch_cells.len() {
            self.cells.push(branch_cells[i]);
            self.parent.push(Some(first_new + (i - 1) as u16));
        }
        Ok(())
    }

    /// 剪枝到最近 fork(spec §3.2.3)。`leaf` 必须真是当前 tree 的叶。
    /// 返回剪掉的分支信息(用于 undo);若整棵塌成空(单端 path 全删),返回 None 表示 caller 应整删。
    pub fn prune_to_node(&mut self, leaf: u16) -> PruneOutcome {
        let leaf_idx = leaf as usize;
        debug_assert!(leaf_idx < self.cells.len(), "leaf out of range");
        debug_assert!(self.is_leaf(leaf), "node {} is not a leaf", leaf);

        // 向上回溯,收集这次要删的节点(沿 parent 链),直到遇到 fork 或 root。
        let mut to_remove: Vec<u16> = Vec::new();
        let mut cursor = leaf;
        loop {
            to_remove.push(cursor);
            let p = self.parent[cursor as usize];
            match p {
                None => {
                    // 到 root,无 fork — 整树塌
                    return PruneOutcome::WholeTreeCollapsed;
                }
                Some(parent_idx) => {
                    if self.child_count(parent_idx) >= 2 {
                        // 找到 fork,剪到这里(但 fork 自己保留)
                        let fork_attach_cell = self.cells[parent_idx as usize];
                        // 拍下被剪段的 cells + 相对 parent(用于 undo 重建)
                        // 相对 parent:第 0 个挂 fork,其余指向 to_remove[i-1] 在 branch 内的相对位置
                        let branch_cells: Vec<CellCoord> = to_remove
                            .iter()
                            .rev()
                            .map(|&i| self.cells[i as usize])
                            .collect();
                        // branch 内相对 parent:第 0 个挂 fork(用 None 表示"挂 attach"),
                        // 其余按 branch 内的顺序 chain
                        let mut branch_parent: Vec<Option<u16>> =
                            Vec::with_capacity(branch_cells.len());
                        branch_parent.push(None);
                        for i in 1..branch_cells.len() {
                            branch_parent.push(Some((i - 1) as u16));
                        }
                        self.remove_indices(&to_remove);
                        return PruneOutcome::Pruned {
                            fork_attach_cell,
                            branch_cells,
                            branch_parent,
                        };
                    }
                    cursor = parent_idx;
                }
            }
        }
    }

    pub fn root(&self) -> CellCoord {
        self.cells[0]
    }

    pub fn cells(&self) -> &[CellCoord] {
        &self.cells
    }

    pub fn parent(&self) -> &[Option<u16>] {
        &self.parent
    }

    pub fn leaves(&self) -> impl Iterator<Item = (u16, CellCoord)> + '_ {
        (0..self.cells.len() as u16).filter_map(|i| {
            if self.is_leaf(i) {
                Some((i, self.cells[i as usize]))
            } else {
                None
            }
        })
    }

    pub fn endpoint_cells(&self) -> impl Iterator<Item = CellCoord> + '_ {
        let root = self.cells[0];
        std::iter::once(root).chain(
            (1..self.cells.len() as u16).filter_map(|i| {
                if self.is_leaf(i) {
                    Some(self.cells[i as usize])
                } else {
                    None
                }
            }),
        )
    }

    pub fn wire_cells(&self) -> impl Iterator<Item = CellCoord> + '_ {
        (1..self.cells.len() as u16).filter_map(|i| {
            if !self.is_leaf(i) {
                Some(self.cells[i as usize])
            } else {
                None
            }
        })
    }

    pub fn is_path(&self) -> bool {
        // fork 数 = 0 <=> 每个节点至多 1 个 child
        let mut child_count: Vec<u8> = vec![0; self.cells.len()];
        for &p in &self.parent {
            if let Some(p) = p {
                child_count[p as usize] += 1;
            }
        }
        child_count.iter().all(|&c| c <= 1)
    }

    pub fn len(&self) -> usize {
        self.cells.len()
    }

    pub fn is_leaf(&self, i: u16) -> bool {
        !self.parent.iter().any(|p| *p == Some(i))
    }

    fn child_count(&self, i: u16) -> usize {
        self.parent.iter().filter(|p| **p == Some(i)).count()
    }

    /// 拓扑合法性自检(I-6):parent 长度 = cells 长度,恰一个 None,其余指向更小 index。
    pub(crate) fn validate_topology(&self) -> bool {
        if self.cells.len() != self.parent.len() || self.cells.is_empty() {
            return false;
        }
        let mut root_count = 0usize;
        for (i, p) in self.parent.iter().enumerate() {
            match p {
                None => root_count += 1,
                Some(pi) => {
                    if (*pi as usize) >= i {
                        return false;
                    }
                }
            }
        }
        root_count == 1
    }

    /// 删除一批 index 并重映射 parent。要求 indices 是当前 tree 的真子集。
    fn remove_indices(&mut self, indices: &[u16]) {
        let mut remove_set: SmallVec<[bool; 64]> = smallvec::smallvec![false; self.cells.len()];
        for &i in indices {
            remove_set[i as usize] = true;
        }
        // 计算 old_idx -> new_idx 重映射
        let mut remap: Vec<Option<u16>> = Vec::with_capacity(self.cells.len());
        let mut new_idx: u16 = 0;
        for i in 0..self.cells.len() {
            if remove_set[i] {
                remap.push(None);
            } else {
                remap.push(Some(new_idx));
                new_idx += 1;
            }
        }
        let mut new_cells: Vec<CellCoord> = Vec::with_capacity(new_idx as usize);
        let mut new_parent: Vec<Option<u16>> = Vec::with_capacity(new_idx as usize);
        for i in 0..self.cells.len() {
            if remove_set[i] {
                continue;
            }
            new_cells.push(self.cells[i]);
            new_parent.push(match self.parent[i] {
                None => None,
                Some(p) => remap[p as usize], // 若 parent 也被删则也是 None,但 caller 保证不会
            });
        }
        self.cells = new_cells;
        self.parent = new_parent;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PruneOutcome {
    Pruned {
        fork_attach_cell: CellCoord,
        branch_cells: Vec<CellCoord>,
        branch_parent: Vec<Option<u16>>,
    },
    /// 单端 path 整棵塌空 — caller 应整删 edge。
    WholeTreeCollapsed,
}

fn is_six_neighbor(a: CellCoord, b: CellCoord) -> bool {
    let dl = (a.layer - b.layer).abs();
    let dx = (a.x - b.x).abs();
    let dy = (a.y - b.y).abs();
    matches!((dl, dx, dy), (0, 1, 0) | (0, 0, 1) | (1, 0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::coord::CellCoord;

    fn c(layer: i32, x: i32, y: i32) -> CellCoord {
        CellCoord::new(layer, x, y)
    }

    #[test]
    fn from_path_single_cell_ok() {
        let t = PathTree::from_path(vec![c(0, 0, 0)]).unwrap();
        assert_eq!(t.len(), 1);
        assert!(t.is_path());
        assert!(t.validate_topology());
    }

    #[test]
    fn from_path_two_cells_chain() {
        let t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0)]).unwrap();
        assert_eq!(t.root(), c(0, 0, 0));
        assert!(t.is_path());
        let leaves: Vec<_> = t.leaves().collect();
        assert_eq!(leaves, vec![(1, c(0, 1, 0))]);
    }

    #[test]
    fn from_path_discontinuous_rejected() {
        let err = PathTree::from_path(vec![c(0, 0, 0), c(0, 2, 0)]).unwrap_err();
        assert!(matches!(err, PathTreeError::Discontinuous { .. }));
    }

    #[test]
    fn from_path_empty_rejected() {
        let err = PathTree::from_path(vec![]).unwrap_err();
        assert_eq!(err, PathTreeError::Empty);
    }

    #[test]
    fn graft_branch_creates_fork() {
        // 0,0 - 1,0 - 2,0 (主干);从 1,0 分出 1,1
        let mut t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        t.graft_branch(1, vec![c(0, 1, 1)]).unwrap();
        assert!(!t.is_path());
        assert!(t.validate_topology());
        let leaves: Vec<_> = t.leaves().map(|(_, c)| c).collect();
        assert!(leaves.contains(&c(0, 2, 0)));
        assert!(leaves.contains(&c(0, 1, 1)));
        assert_eq!(leaves.len(), 2);
    }

    #[test]
    fn graft_branch_attach_out_of_range_rejected() {
        let mut t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0)]).unwrap();
        let err = t.graft_branch(5, vec![c(0, 0, 1)]).unwrap_err();
        assert!(matches!(err, PathTreeError::AttachOutOfRange { .. }));
    }

    #[test]
    fn graft_branch_not_adjacent_rejected() {
        let mut t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0)]).unwrap();
        let err = t.graft_branch(0, vec![c(0, 5, 0)]).unwrap_err();
        assert!(matches!(err, PathTreeError::BranchNotAdjacent { .. }));
    }

    #[test]
    fn prune_single_path_collapses() {
        let mut t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let outcome = t.prune_to_node(2);
        assert_eq!(outcome, PruneOutcome::WholeTreeCollapsed);
    }

    #[test]
    fn prune_branch_back_to_fork() {
        // 0,0 - 1,0 (fork) - 2,0
        //              \
        //                1,1
        // 剪 1,1
        let mut t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        t.graft_branch(1, vec![c(0, 1, 1)]).unwrap();
        // leaf index for c(0,1,1) is 3
        let outcome = t.prune_to_node(3);
        match outcome {
            PruneOutcome::Pruned { fork_attach_cell, branch_cells, branch_parent } => {
                assert_eq!(fork_attach_cell, c(0, 1, 0));
                assert_eq!(branch_cells, vec![c(0, 1, 1)]);
                assert_eq!(branch_parent, vec![None]);
            }
            _ => panic!("expected Pruned"),
        }
        // 剪后 fork 只剩一支,is_path 自动 true(spec §3.2.3)
        assert!(t.is_path());
        assert!(t.validate_topology());
        // root + leaf 不变
        assert_eq!(t.root(), c(0, 0, 0));
        let leaves: Vec<_> = t.leaves().map(|(_, c)| c).collect();
        assert_eq!(leaves, vec![c(0, 2, 0)]);
    }

    #[test]
    fn prune_through_intermediate_to_nearest_fork() {
        // 0,0 - 1,0 (fork) - 2,0 - 3,0 - 4,0
        //              \
        //                1,1
        // 剪 4,0 应回溯到 fork 1,0,删 2,0..4,0 三个
        let mut t = PathTree::from_path(vec![
            c(0, 0, 0),
            c(0, 1, 0),
            c(0, 2, 0),
            c(0, 3, 0),
            c(0, 4, 0),
        ])
        .unwrap();
        t.graft_branch(1, vec![c(0, 1, 1)]).unwrap();
        // leaf index for c(0,4,0) is 4
        let outcome = t.prune_to_node(4);
        match outcome {
            PruneOutcome::Pruned { fork_attach_cell, branch_cells, .. } => {
                assert_eq!(fork_attach_cell, c(0, 1, 0));
                assert_eq!(branch_cells, vec![c(0, 2, 0), c(0, 3, 0), c(0, 4, 0)]);
            }
            _ => panic!("expected Pruned"),
        }
        assert!(t.is_path());
    }

    #[test]
    fn endpoint_and_wire_cells_disjoint_and_complete() {
        let mut t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        t.graft_branch(1, vec![c(0, 1, 1), c(0, 1, 2)]).unwrap();
        // root: (0,0,0); leaves: (0,2,0), (0,1,2); wires: (0,1,0), (0,1,1)
        let endpoints: std::collections::HashSet<_> = t.endpoint_cells().collect();
        let wires: std::collections::HashSet<_> = t.wire_cells().collect();
        assert_eq!(endpoints.len(), 3);
        assert_eq!(wires.len(), 2);
        assert!(endpoints.is_disjoint(&wires));
        let all: std::collections::HashSet<_> = t.cells().iter().copied().collect();
        let union: std::collections::HashSet<_> = endpoints.union(&wires).copied().collect();
        assert_eq!(union, all);
    }
}
```

- [ ] **Step 3.2: Run tests**

Run: `cargo test -p grid_workshop routing::path_tree`
Expected: PASS — 10 个测试全绿。

- [ ] **Step 3.3: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/path_tree.rs && git commit -m "feat(routing): PathTree flat (cells+parent) + graft/prune/queries"
```

---

## Task 4: `Edge` + 错误 + impact 类型

**Spec ref:** §2.1(Edge 字段)、§3.1(PlaceEdgeError)、§3.2.2(NeuronRemovalImpact / PrunedBranch / DemoteRecord)、§3.3(KindReplaceImpact)。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/edge.rs`

- [ ] **Step 4.1:** 替换 `routing/edge.rs` 为:

```rust
use crate::core::coord::CellCoord;
use crate::routing::ids::{EdgeId, PathEndpoint};
use crate::routing::path_tree::PathTree;

/// Spec §2.1。
#[derive(Debug, Clone, PartialEq)]
pub struct Edge {
    pub tree: PathTree,
    /// 真实单位 μm;C-2 只存,√d 物理在 C-4 编译时展开(宪法 §4)。
    pub thickness_d: f32,
    pub plastic: bool,
    /// None → 固定连接;Some(coord) → 可塑且绑该 modulator。
    pub mod_source: Option<PathEndpoint>,
}

/// Spec §3.1。
#[derive(Debug, Clone, PartialEq)]
pub enum PlaceEdgeError {
    /// root 或某 leaf cell 在 Grid 上不是 Neuron (I-1)
    EndpointNotNeuron(CellCoord),
    /// 路径中某线格已被其他边占用 (I-2 / 宪法 §2 no-overlap)
    CellOccupied { cell: CellCoord, by: EdgeId },
    /// 路径中某中间 cell 是 Neuron(不能借另一神经元胞体中转 — 宪法 §2)
    PathThroughNeuron(CellCoord),
    /// mod_source 指向的 cell 不是 Modulator 神经元 (I-5)
    ModSourceNotModulator(CellCoord),
    /// tree 拓扑非法(spec §3.1 通过 PathTree::validate_topology 推断)
    InvalidTreeTopology,
    /// 厚度非正
    InvalidThickness(f32),
}

/// Spec §3.2.2 — 给 undo / UI 报告用。
#[derive(Debug, Clone, PartialEq)]
pub struct NeuronRemovalImpact {
    /// 整棵删的边(被删神经元为该 edge 的 source)
    pub removed_edges: Vec<(EdgeId, Edge)>,
    /// 部分剪枝的边(被删神经元为该 edge 的某 leaf)
    pub pruned_branches: Vec<(EdgeId, PrunedBranch)>,
    /// mod_source 失效降级的边
    pub demoted_plastic: Vec<DemoteRecord>,
}

/// Spec §3.2.2 — undo 回插剪枝段需要的全部信息。
#[derive(Debug, Clone, PartialEq)]
pub struct PrunedBranch {
    /// 剪到的最近 fork 点(被剪段挂回这个 cell)
    pub fork_attach_cell: CellCoord,
    /// 被剪掉的 cell 序列(从 fork 出发到 leaf)
    pub branch_cells: Vec<CellCoord>,
    /// 被剪段内部的 parent 链(用于回插时重建拓扑)
    pub branch_parent: Vec<Option<u16>>,
}

/// Spec §3.2.2 — 恢复降级前的 plastic / mod_source 配置。
#[derive(Debug, Clone, PartialEq)]
pub struct DemoteRecord {
    pub edge: EdgeId,
    pub was_plastic: bool,
    pub was_mod_source: Option<PathEndpoint>,
}

/// Spec §3.3 — replace_kind 的响应(只在 Modulator → 非 Modulator 时降级)。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct KindReplaceImpact {
    pub demoted_plastic: Vec<DemoteRecord>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::coord::CellCoord;

    #[test]
    fn edge_default_fields_compile() {
        let tree = PathTree::from_path(vec![CellCoord::new(0, 0, 0), CellCoord::new(0, 1, 0)]).unwrap();
        let e = Edge {
            tree,
            thickness_d: 1.0,
            plastic: false,
            mod_source: None,
        };
        assert!(!e.plastic);
        assert!(e.mod_source.is_none());
    }

    #[test]
    fn place_edge_error_variants_distinguishable() {
        let a = PlaceEdgeError::EndpointNotNeuron(CellCoord::new(0, 0, 0));
        let b = PlaceEdgeError::InvalidThickness(-1.0);
        assert_ne!(a, b);
    }
}
```

- [ ] **Step 4.2: Update mod.rs** — re-export Edge/types。打开 `src/routing/mod.rs`,在底部加:

```rust
pub use ids::{EdgeId, PathEndpoint};
pub use path_tree::PathTree;
pub use edge::{
    Edge, PlaceEdgeError, NeuronRemovalImpact, PrunedBranch, DemoteRecord, KindReplaceImpact,
};
```

- [ ] **Step 4.3: Run**

Run: `cargo test -p grid_workshop routing::edge`
Expected: PASS。

Run: `cargo build -p grid_workshop`
Expected: 通过。

- [ ] **Step 4.4: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/edge.rs crates/grid_workshop/src/routing/mod.rs && git commit -m "feat(routing): Edge + PlaceEdgeError + impact/record types"
```

---

## Task 5: `Routes` 基础结构 + `place_edge` / `remove_edge`

**Spec ref:** §2.3(Routes 双索引、不变量 I-1..I-7)、§3.1(place_edge)、§3.2.1(remove_edge)、§3.4(隐式 via:路径中间 Empty 合法)。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/routes.rs`

- [ ] **Step 5.1: Write the failing tests** by replacing `routes.rs` with:

```rust
use crate::core::coord::CellCoord;
use crate::core::grid::Grid;
use crate::core::kind::{CellContents, NeuronKind};
use crate::routing::edge::{
    DemoteRecord, Edge, KindReplaceImpact, NeuronRemovalImpact, PlaceEdgeError, PrunedBranch,
};
use crate::routing::ids::{EdgeId, PathEndpoint};
use crate::routing::path_tree::{PathTree, PruneOutcome};
use smallvec::SmallVec;
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct Routes {
    edges: HashMap<EdgeId, Edge>,
    /// I-2 / 宪法 §2:**只索引线格**(`PathTree::wire_cells()`),不索引端点神经元 cell。
    cell_to_edge: HashMap<CellCoord, EdgeId>,
    /// I-3:神经元 cell → 把它当端点(根或叶)的所有 edge。
    endpoint_to_edges: HashMap<CellCoord, SmallVec<[EdgeId; 6]>>,
    /// 单调递增分配器(spec §2.3 / §6 #3:不重用 id)
    next_id: u32,
}

impl Routes {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn edges(&self) -> impl Iterator<Item = (EdgeId, &Edge)> {
        self.edges.iter().map(|(id, e)| (*id, e))
    }

    pub fn get(&self, eid: EdgeId) -> Option<&Edge> {
        self.edges.get(&eid)
    }

    pub fn edge_at_wire_cell(&self, c: CellCoord) -> Option<EdgeId> {
        self.cell_to_edge.get(&c).copied()
    }

    pub fn edges_at_endpoint(&self, c: CellCoord) -> &[EdgeId] {
        self.endpoint_to_edges
            .get(&c)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Spec §3.1。grid 仅读不写;Routes 与 Grid 共享 cell 命名空间但持久化分离。
    pub fn place_edge(
        &mut self,
        grid: &Grid,
        tree: PathTree,
        thickness_d: f32,
        plastic: bool,
        mod_source: Option<PathEndpoint>,
    ) -> Result<EdgeId, PlaceEdgeError> {
        if !tree.validate_topology() {
            return Err(PlaceEdgeError::InvalidTreeTopology);
        }
        if !(thickness_d > 0.0) {
            return Err(PlaceEdgeError::InvalidThickness(thickness_d));
        }
        // I-1: 端点必须是神经元
        for ep in tree.endpoint_cells() {
            if !matches!(grid.get(ep), CellContents::Neuron(_)) {
                return Err(PlaceEdgeError::EndpointNotNeuron(ep));
            }
        }
        // 线格中间 cell 必须不是 Neuron(隐式 via 允许 Empty)
        for wc in tree.wire_cells() {
            if matches!(grid.get(wc), CellContents::Neuron(_)) {
                return Err(PlaceEdgeError::PathThroughNeuron(wc));
            }
        }
        // I-2: 线格不能已被别条边占
        for wc in tree.wire_cells() {
            if let Some(other) = self.cell_to_edge.get(&wc) {
                return Err(PlaceEdgeError::CellOccupied { cell: wc, by: *other });
            }
        }
        // I-5: mod_source 必须是 Modulator
        if let Some(ms) = mod_source {
            if !matches!(grid.get(ms.coord()), CellContents::Neuron(NeuronKind::Modulator)) {
                return Err(PlaceEdgeError::ModSourceNotModulator(ms.coord()));
            }
        }
        // 分配 id 并落地
        let eid = EdgeId(self.next_id);
        self.next_id += 1;
        for wc in tree.wire_cells() {
            self.cell_to_edge.insert(wc, eid);
        }
        for ep in tree.endpoint_cells() {
            self.endpoint_to_edges
                .entry(ep)
                .or_default()
                .push(eid);
        }
        let edge = Edge { tree, thickness_d, plastic, mod_source };
        self.edges.insert(eid, edge);
        Ok(eid)
    }

    /// Spec §3.2.1。
    pub fn remove_edge(&mut self, eid: EdgeId) -> Option<Edge> {
        let edge = self.edges.remove(&eid)?;
        for wc in edge.tree.wire_cells() {
            self.cell_to_edge.remove(&wc);
        }
        for ep in edge.tree.endpoint_cells() {
            if let Some(v) = self.endpoint_to_edges.get_mut(&ep) {
                v.retain(|x| *x != eid);
                if v.is_empty() {
                    self.endpoint_to_edges.remove(&ep);
                }
            }
        }
        Some(edge)
    }

    // on_neuron_removed / on_neuron_kind_replaced 在 Task 6 / Task 7 加。

    /// 调试用:检查 I-1..I-7 全部。
    #[cfg(debug_assertions)]
    pub fn validate_invariants(&self, grid: &Grid) -> Result<(), String> {
        // I-6: tree 拓扑合法
        for (eid, e) in &self.edges {
            if !e.tree.validate_topology() {
                return Err(format!("I-6 violated by edge {:?}", eid));
            }
            // I-1: 端点是神经元
            for ep in e.tree.endpoint_cells() {
                if !matches!(grid.get(ep), CellContents::Neuron(_)) {
                    return Err(format!("I-1 violated: edge {:?} endpoint {:?} not neuron", eid, ep));
                }
            }
            // I-5: mod_source 是 Modulator
            if let Some(ms) = e.mod_source {
                if !matches!(grid.get(ms.coord()), CellContents::Neuron(NeuronKind::Modulator)) {
                    return Err(format!("I-5 violated: edge {:?} mod_source not Modulator", eid));
                }
            }
            // 厚度
            if !(e.thickness_d > 0.0) {
                return Err(format!("invalid thickness on edge {:?}", eid));
            }
        }
        // I-2 正向:cell_to_edge 每 entry 在对应 edge 的 wire_cells
        for (c, eid) in &self.cell_to_edge {
            let edge = self
                .edges
                .get(eid)
                .ok_or_else(|| format!("I-2 violated: cell {:?} points to stale edge {:?}", c, eid))?;
            if !edge.tree.wire_cells().any(|w| w == *c) {
                return Err(format!(
                    "I-2 violated: cell {:?} -> edge {:?} but cell not in wire_cells",
                    c, eid
                ));
            }
            // I-4: 端点 cell 不进 cell_to_edge
            if edge.tree.endpoint_cells().any(|e| e == *c) {
                return Err(format!(
                    "I-2/I-4 violated: cell {:?} is endpoint of edge {:?} but appears in cell_to_edge",
                    c, eid
                ));
            }
        }
        // I-2 反向:edge.wire_cells 每个 cell 在 cell_to_edge 指向自己
        for (eid, e) in &self.edges {
            for wc in e.tree.wire_cells() {
                match self.cell_to_edge.get(&wc) {
                    Some(other) if *other == *eid => {}
                    other => {
                        return Err(format!(
                            "I-2 violated: edge {:?} wire {:?} maps to {:?} not self",
                            eid, wc, other
                        ));
                    }
                }
            }
        }
        // I-3 正向:endpoint_to_edges 每条目对应 edge 真把该 cell 当端点
        for (c, eids) in &self.endpoint_to_edges {
            for eid in eids {
                let edge = self
                    .edges
                    .get(eid)
                    .ok_or_else(|| format!("I-3 violated: stale edge {:?} in endpoint_to_edges[{:?}]", eid, c))?;
                if !edge.tree.endpoint_cells().any(|e| e == *c) {
                    return Err(format!(
                        "I-3 violated: endpoint_to_edges[{:?}] contains edge {:?} but cell not in endpoints",
                        c, eid
                    ));
                }
            }
            // I-7: fan-in 上限
            if eids.len() > 6 {
                return Err(format!("I-7 violated: cell {:?} has {} edges (> 6)", c, eids.len()));
            }
        }
        // I-3 反向:edge.endpoint_cells 每个 cell 的 endpoint_to_edges 都含自己
        for (eid, e) in &self.edges {
            for ep in e.tree.endpoint_cells() {
                let bucket = self
                    .endpoint_to_edges
                    .get(&ep)
                    .ok_or_else(|| format!("I-3 violated: endpoint {:?} of edge {:?} missing bucket", ep, eid))?;
                if !bucket.contains(eid) {
                    return Err(format!(
                        "I-3 violated: endpoint {:?} bucket missing edge {:?}",
                        ep, eid
                    ));
                }
            }
        }
        Ok(())
    }
}

// 暂时持有 unused import 警告抑制(NeuronRemovalImpact / PrunedBranch / DemoteRecord / KindReplaceImpact / PruneOutcome 在 Task 6 用)
#[allow(dead_code)]
const _: fn() = || {
    let _ = std::marker::PhantomData::<(
        NeuronRemovalImpact,
        PrunedBranch,
        DemoteRecord,
        KindReplaceImpact,
        PruneOutcome,
    )>;
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::coord::CellCoord;
    use crate::core::kind::{CellContents, NeuronKind};

    fn c(layer: i32, x: i32, y: i32) -> CellCoord {
        CellCoord::new(layer, x, y)
    }

    fn neuron_grid_with(coords: &[(CellCoord, NeuronKind)]) -> Grid {
        let mut g = Grid::new();
        for (coord, k) in coords {
            g.place(*coord, CellContents::Neuron(*k)).unwrap();
        }
        g
    }

    #[test]
    fn place_simple_path_succeeds() {
        // S (0,0,0) - wire (0,1,0) - T (0,2,0)
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let eid = r.place_edge(&grid, tree, 1.0, false, None).unwrap();
        assert_eq!(r.edge_at_wire_cell(c(0, 1, 0)), Some(eid));
        assert_eq!(r.edges_at_endpoint(c(0, 0, 0)), &[eid]);
        assert_eq!(r.edges_at_endpoint(c(0, 2, 0)), &[eid]);
        r.validate_invariants(&grid).unwrap();
    }

    #[test]
    fn three_neuron_chain_s_i_m() {
        // 关键回归(spec §5.1 / v0.1 漏的 case):S -> I -> M,I 同时作 e1 叶和 e2 根。
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::InterExc),
            (c(0, 4, 0), NeuronKind::Motor),
        ]);
        let t1 = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let t2 = PathTree::from_path(vec![c(0, 2, 0), c(0, 3, 0), c(0, 4, 0)]).unwrap();
        let mut r = Routes::new();
        let e1 = r.place_edge(&grid, t1, 1.0, false, None).unwrap();
        let e2 = r.place_edge(&grid, t2, 1.0, false, None).unwrap();
        let i_endpoints = r.edges_at_endpoint(c(0, 2, 0));
        assert!(i_endpoints.contains(&e1));
        assert!(i_endpoints.contains(&e2));
        assert_eq!(i_endpoints.len(), 2);
        r.validate_invariants(&grid).unwrap();
    }

    #[test]
    fn implicit_via_through_empty_cells() {
        // S - empty - empty - T:中间穿两 Empty 合法。
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 3, 0), NeuronKind::Motor),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0), c(0, 3, 0)]).unwrap();
        let mut r = Routes::new();
        let eid = r.place_edge(&grid, tree, 1.0, false, None).unwrap();
        // 中间 cells 进 cell_to_edge,Grid 仍 Empty
        assert_eq!(r.edge_at_wire_cell(c(0, 1, 0)), Some(eid));
        assert_eq!(r.edge_at_wire_cell(c(0, 2, 0)), Some(eid));
        assert_eq!(grid.get(c(0, 1, 0)), CellContents::Empty);

        // 删边后,占用消失;Grid 不变
        r.remove_edge(eid).unwrap();
        assert_eq!(r.edge_at_wire_cell(c(0, 1, 0)), None);
        assert_eq!(grid.get(c(0, 1, 0)), CellContents::Empty);
    }

    #[test]
    fn place_endpoint_not_neuron_rejected() {
        let grid = neuron_grid_with(&[(c(0, 0, 0), NeuronKind::SensorOn)]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let err = r.place_edge(&grid, tree, 1.0, false, None).unwrap_err();
        assert!(matches!(err, PlaceEdgeError::EndpointNotNeuron(_)));
    }

    #[test]
    fn place_path_through_neuron_rejected() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 1, 0), NeuronKind::InterExc), // 挡在中间
            (c(0, 2, 0), NeuronKind::Motor),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let err = r.place_edge(&grid, tree, 1.0, false, None).unwrap_err();
        assert!(matches!(err, PlaceEdgeError::PathThroughNeuron(_)));
    }

    #[test]
    fn place_wire_cell_already_occupied_rejected() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
            (c(0, 4, 0), NeuronKind::InterExc),
        ]);
        let t1 = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let t2 = PathTree::from_path(vec![c(0, 4, 0), c(0, 3, 0), c(0, 2, 0), c(0, 1, 0), c(0, 0, 0)])
            .unwrap();
        let mut r = Routes::new();
        r.place_edge(&grid, t1, 1.0, false, None).unwrap();
        // t2 试图占 (0,1,0):被 t1 占了
        // 注意 t2 也有 PathThroughNeuron 问题(穿 (0,2,0) 神经元) — 但这条会先于 CellOccupied 触发。
        let err = r.place_edge(&grid, t2, 1.0, false, None).unwrap_err();
        assert!(matches!(err, PlaceEdgeError::PathThroughNeuron(_) | PlaceEdgeError::CellOccupied { .. }));
    }

    #[test]
    fn place_mod_source_not_modulator_rejected() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
            (c(0, 5, 0), NeuronKind::InterExc), // 不是 Modulator
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let err = r
            .place_edge(&grid, tree, 1.0, true, Some(PathEndpoint(c(0, 5, 0))))
            .unwrap_err();
        assert!(matches!(err, PlaceEdgeError::ModSourceNotModulator(_)));
    }

    #[test]
    fn place_invalid_thickness_rejected() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let err = r.place_edge(&grid, tree, 0.0, false, None).unwrap_err();
        assert!(matches!(err, PlaceEdgeError::InvalidThickness(_)));
    }

    #[test]
    fn fan_in_cap_six_neighbor_cells() {
        // 一个神经元 T 在 (0,0,0),6 个邻居 cell 上各放一个源神经元,各画一条 1-step 边。
        // 第 7 条边因为没有第 7 个不同的邻居 cell,必复用前 6 条中某邻格 → CellOccupied。
        // 这正是 spec §2.3 「~6 fan-in 上限是结构性的」(I-7)。
        let mut g = Grid::new();
        g.place(c(0, 0, 0), CellContents::Neuron(NeuronKind::Motor)).unwrap();
        let neighbors = [
            c(0, 1, 0), c(0, -1, 0),
            c(0, 0, 1), c(0, 0, -1),
            c(1, 0, 0), c(-1, 0, 0),
        ];
        // 每个邻格的"再外一格"作为源神经元,例如 +x 邻格 (0,1,0) 的源在 (0,2,0)
        let sources = [
            c(0, 2, 0), c(0, -2, 0),
            c(0, 0, 2), c(0, 0, -2),
            c(2, 0, 0), c(-2, 0, 0),
        ];
        for s in sources {
            g.place(s, CellContents::Neuron(NeuronKind::SensorOn)).unwrap();
        }
        let mut r = Routes::new();
        for i in 0..6 {
            let t = PathTree::from_path(vec![sources[i], neighbors[i], c(0, 0, 0)]).unwrap();
            r.place_edge(&g, t, 1.0, false, None).unwrap();
        }
        assert_eq!(r.edges_at_endpoint(c(0, 0, 0)).len(), 6);
        r.validate_invariants(&g).unwrap();

        // 第 7 条:加第 7 个源(更远),但它必经过已占的 6 个邻格之一
        g.place(c(0, 3, 0), CellContents::Neuron(NeuronKind::SensorOn)).unwrap();
        let t7 = PathTree::from_path(vec![c(0, 3, 0), c(0, 2, 0), c(0, 1, 0), c(0, 0, 0)]);
        // 注意 (0,2,0) 已经是神经元 source — 会是 PathThroughNeuron。换一条路:
        // 实际拓扑层面:任何到 (0,0,0) 的入边都必经其 6 邻格之一,而 6 个邻格已被占 → CellOccupied。
        // 构造一条不经过已有神经元、只在最后一步复用 (0,1,0) 的路径:
        // (0,3,1) - (0,2,1) - (0,1,1) - (0,1,0) - (0,0,0)
        g.place(c(0, 3, 1), CellContents::Neuron(NeuronKind::SensorOn)).unwrap();
        let t7_real = PathTree::from_path(vec![
            c(0, 3, 1), c(0, 2, 1), c(0, 1, 1), c(0, 1, 0), c(0, 0, 0),
        ])
        .unwrap();
        let err = r.place_edge(&g, t7_real, 1.0, false, None).unwrap_err();
        assert!(matches!(err, PlaceEdgeError::CellOccupied { .. }));

        // 删除 t7 的源,清理
        let _ = t7;
    }

    #[test]
    fn remove_edge_clears_both_indices() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let eid = r.place_edge(&grid, tree, 1.0, false, None).unwrap();
        let removed = r.remove_edge(eid);
        assert!(removed.is_some());
        assert_eq!(r.edge_at_wire_cell(c(0, 1, 0)), None);
        assert_eq!(r.edges_at_endpoint(c(0, 0, 0)), &[] as &[EdgeId]);
        assert_eq!(r.edges_at_endpoint(c(0, 2, 0)), &[] as &[EdgeId]);
        r.validate_invariants(&grid).unwrap();
    }

    #[test]
    fn edge_id_not_reused_after_remove() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
        ]);
        let t1 = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let t2 = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let e1 = r.place_edge(&grid, t1, 1.0, false, None).unwrap();
        r.remove_edge(e1).unwrap();
        let e2 = r.place_edge(&grid, t2, 1.0, false, None).unwrap();
        assert_ne!(e1, e2);
    }
}
```

- [ ] **Step 5.2: Update mod.rs** — 加 routes re-export。打开 `routing/mod.rs`,确保最末有:

```rust
pub use routes::Routes;
```

- [ ] **Step 5.3: Run**

Run: `cargo test -p grid_workshop routing::routes`
Expected: 11 个测试全绿。注意 `place_wire_cell_already_occupied_rejected` 的断言允许两种 error 之一(顺序敏感)。若失败,检查 cell_to_edge 单值索引行为。

- [ ] **Step 5.4: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/routes.rs crates/grid_workshop/src/routing/mod.rs && git commit -m "feat(routing): Routes + place_edge/remove_edge + invariant checker"
```

---

## Task 6: `on_neuron_removed` 级联(整删 source / 剪叶 / modulator 降级)

**Spec ref:** §3.2.2(三种 cascade 情况)、§3.2.3(剪枝算法);宪法 §3。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/routes.rs`

- [ ] **Step 6.1:** 在 `routes.rs` 的 `impl Routes` 块内追加(在 `validate_invariants` 之前):

```rust
    /// Spec §3.2.2。**在 Grid 实际清除 `coord` 前调用**。返回受影响 edge 全集,供 undo / UI。
    pub fn on_neuron_removed(&mut self, coord: CellCoord) -> NeuronRemovalImpact {
        let mut impact = NeuronRemovalImpact {
            removed_edges: Vec::new(),
            pruned_branches: Vec::new(),
            demoted_plastic: Vec::new(),
        };

        // 端点身份:source(被删 = 整删)、leaf(被删 = 剪叶)。
        // 一个神经元可同时是 e1 的 source + e2 的 leaf —— 各自处理。
        let bucket_owned: Vec<EdgeId> = self
            .endpoint_to_edges
            .get(&coord)
            .map(|v| v.iter().copied().collect())
            .unwrap_or_default();

        for eid in bucket_owned {
            let role_is_source = self
                .edges
                .get(&eid)
                .map(|e| e.tree.root() == coord)
                .unwrap_or(false);
            if role_is_source {
                if let Some(edge) = self.remove_edge(eid) {
                    impact.removed_edges.push((eid, edge));
                }
            } else {
                // 是叶 — 剪到最近 fork
                let leaf_idx = self
                    .edges
                    .get(&eid)
                    .and_then(|e| {
                        e.tree
                            .leaves()
                            .find(|(_, c)| *c == coord)
                            .map(|(i, _)| i)
                    });
                let Some(leaf_idx) = leaf_idx else {
                    continue; // 数据已被前一步整删
                };
                let outcome = self
                    .edges
                    .get_mut(&eid)
                    .unwrap()
                    .tree
                    .prune_to_node(leaf_idx);
                match outcome {
                    PruneOutcome::WholeTreeCollapsed => {
                        if let Some(edge) = self.remove_edge(eid) {
                            impact.removed_edges.push((eid, edge));
                        }
                    }
                    PruneOutcome::Pruned {
                        fork_attach_cell,
                        branch_cells,
                        branch_parent,
                    } => {
                        // 同步两索引:被剪段的 wire/leaf 都要从 cell_to_edge / endpoint_to_edges 拿掉。
                        // 简化做法:删边对应的所有 cell 反查项,然后再按当前 tree 重建。
                        self.reindex_edge(eid);
                        impact.pruned_branches.push((
                            eid,
                            PrunedBranch {
                                fork_attach_cell,
                                branch_cells,
                                branch_parent,
                            },
                        ));
                    }
                }
            }
        }

        // mod_source 失效降级(coord 是某 plastic edge 的 mod_source,不是其端点)
        let demote_targets: Vec<EdgeId> = self
            .edges
            .iter()
            .filter_map(|(eid, e)| {
                if e.mod_source.map(|m| m.coord()) == Some(coord) {
                    Some(*eid)
                } else {
                    None
                }
            })
            .collect();
        for eid in demote_targets {
            let edge = self.edges.get_mut(&eid).unwrap();
            impact.demoted_plastic.push(DemoteRecord {
                edge: eid,
                was_plastic: edge.plastic,
                was_mod_source: edge.mod_source,
            });
            edge.plastic = false;
            edge.mod_source = None;
        }

        impact
    }

    /// 内部:某条边 tree 改变后,清掉它在两索引里的旧记录并按当前 tree 重建。
    fn reindex_edge(&mut self, eid: EdgeId) {
        // 先按 cell_to_edge 反查:把所有指向 eid 的 entry 删掉
        let stale_wires: Vec<CellCoord> = self
            .cell_to_edge
            .iter()
            .filter_map(|(c, e)| if *e == eid { Some(*c) } else { None })
            .collect();
        for c in stale_wires {
            self.cell_to_edge.remove(&c);
        }
        // endpoint_to_edges 反查:把含 eid 的桶里 eid 去掉
        let stale_eps: Vec<CellCoord> = self
            .endpoint_to_edges
            .iter()
            .filter_map(|(c, v)| if v.contains(&eid) { Some(*c) } else { None })
            .collect();
        for c in stale_eps {
            if let Some(v) = self.endpoint_to_edges.get_mut(&c) {
                v.retain(|x| *x != eid);
                if v.is_empty() {
                    self.endpoint_to_edges.remove(&c);
                }
            }
        }
        // 按当前 tree 重建
        let edge = self.edges.get(&eid).unwrap();
        for wc in edge.tree.wire_cells() {
            self.cell_to_edge.insert(wc, eid);
        }
        for ep in edge.tree.endpoint_cells() {
            self.endpoint_to_edges.entry(ep).or_default().push(eid);
        }
    }
```

- [ ] **Step 6.2: Add tests** at the bottom of the `tests` mod in `routes.rs`:

```rust
    #[test]
    fn remove_source_neuron_cascades_whole_edge() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let eid = r.place_edge(&grid, tree, 1.0, false, None).unwrap();

        let impact = r.on_neuron_removed(c(0, 0, 0));
        assert_eq!(impact.removed_edges.len(), 1);
        assert_eq!(impact.removed_edges[0].0, eid);
        assert!(impact.pruned_branches.is_empty());
        assert!(r.get(eid).is_none());
        // 校验:edges_at_endpoint 还是个空切片(神经元胞体即将被外部 Grid 删除)
        assert!(r.edges_at_endpoint(c(0, 0, 0)).is_empty());
    }

    #[test]
    fn remove_target_leaf_prunes_branch_keeps_siblings() {
        // S(0,0,0) -- 1,0 -- 2,0(T1)
        //                \-- 1,1(T2)
        let mut g = Grid::new();
        g.place(c(0, 0, 0), CellContents::Neuron(NeuronKind::SensorOn)).unwrap();
        g.place(c(0, 2, 0), CellContents::Neuron(NeuronKind::Motor)).unwrap();
        g.place(c(0, 1, 1), CellContents::Neuron(NeuronKind::Motor)).unwrap();
        let mut tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        tree.graft_branch(1, vec![c(0, 1, 1)]).unwrap();
        let mut r = Routes::new();
        let eid = r.place_edge(&g, tree, 1.0, false, None).unwrap();

        // 删 T2(0,1,1) — 剪到 fork (0,1,0)
        let impact = r.on_neuron_removed(c(0, 1, 1));
        assert!(impact.removed_edges.is_empty());
        assert_eq!(impact.pruned_branches.len(), 1);
        let (pruned_eid, pb) = &impact.pruned_branches[0];
        assert_eq!(*pruned_eid, eid);
        assert_eq!(pb.fork_attach_cell, c(0, 1, 0));
        assert_eq!(pb.branch_cells, vec![c(0, 1, 1)]);
        // edge 仍在,且现在变回单端 path
        let edge = r.get(eid).unwrap();
        assert!(edge.tree.is_path());
        let leaves: Vec<_> = edge.tree.leaves().map(|(_, c)| c).collect();
        assert_eq!(leaves, vec![c(0, 2, 0)]);
        r.validate_invariants(&g).unwrap();
    }

    #[test]
    fn remove_modulator_demotes_plastic_edge() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
            (c(0, 5, 0), NeuronKind::Modulator),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let eid = r
            .place_edge(&grid, tree, 1.0, true, Some(PathEndpoint(c(0, 5, 0))))
            .unwrap();
        assert!(r.get(eid).unwrap().plastic);

        let impact = r.on_neuron_removed(c(0, 5, 0));
        assert!(impact.removed_edges.is_empty());
        assert_eq!(impact.demoted_plastic.len(), 1);
        let d = &impact.demoted_plastic[0];
        assert_eq!(d.edge, eid);
        assert!(d.was_plastic);
        assert_eq!(d.was_mod_source, Some(PathEndpoint(c(0, 5, 0))));
        // 实际 edge 状态:plastic=false, mod_source=None,拓扑不动
        let edge = r.get(eid).unwrap();
        assert!(!edge.plastic);
        assert!(edge.mod_source.is_none());
        assert_eq!(edge.tree.root(), c(0, 0, 0));
    }

    #[test]
    fn remove_neuron_that_is_both_source_and_leaf() {
        // e1: A -> B (B is leaf)
        // e2: B -> C (B is source)
        // 删 B:e2 整删(B 是 e2 的 source),e1 剪叶 → 单端,B 被剪
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::InterExc),
            (c(0, 4, 0), NeuronKind::Motor),
        ]);
        let t1 = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let t2 = PathTree::from_path(vec![c(0, 2, 0), c(0, 3, 0), c(0, 4, 0)]).unwrap();
        let mut r = Routes::new();
        let e1 = r.place_edge(&grid, t1, 1.0, false, None).unwrap();
        let e2 = r.place_edge(&grid, t2, 1.0, false, None).unwrap();

        let impact = r.on_neuron_removed(c(0, 2, 0));
        // e2 整删
        let removed_ids: Vec<_> = impact.removed_edges.iter().map(|(i, _)| *i).collect();
        assert!(removed_ids.contains(&e2));
        // e1 是 leaf 被剪 — 单端 path 全删
        assert!(removed_ids.contains(&e1));
        // 两条边都没了
        assert!(r.get(e1).is_none());
        assert!(r.get(e2).is_none());
    }
```

- [ ] **Step 6.3: Run**

Run: `cargo test -p grid_workshop routing::routes`
Expected: 15 个测试全绿。

- [ ] **Step 6.4: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/routes.rs && git commit -m "feat(routing): on_neuron_removed cascade — source/leaf/modulator asymmetry"
```

---

## Task 7: `on_neuron_kind_replaced` — Modulator → 非 Modulator 触发降级

**Spec ref:** §3.3。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/routes.rs`

- [ ] **Step 7.1:** 在 `impl Routes` 中追加(在 `on_neuron_removed` 后):

```rust
    /// Spec §3.3。**在 Grid 实际改 kind 后调用**(因为只关心 new_kind 的类型)。
    pub fn on_neuron_kind_replaced(
        &mut self,
        coord: CellCoord,
        old_kind: NeuronKind,
        new_kind: NeuronKind,
    ) -> KindReplaceImpact {
        let mut impact = KindReplaceImpact::default();
        // 仅当从 Modulator 离开时触发降级
        if old_kind == NeuronKind::Modulator && new_kind != NeuronKind::Modulator {
            let demote_targets: Vec<EdgeId> = self
                .edges
                .iter()
                .filter_map(|(eid, e)| {
                    if e.mod_source.map(|m| m.coord()) == Some(coord) {
                        Some(*eid)
                    } else {
                        None
                    }
                })
                .collect();
            for eid in demote_targets {
                let edge = self.edges.get_mut(&eid).unwrap();
                impact.demoted_plastic.push(DemoteRecord {
                    edge: eid,
                    was_plastic: edge.plastic,
                    was_mod_source: edge.mod_source,
                });
                edge.plastic = false;
                edge.mod_source = None;
            }
        }
        impact
    }
```

- [ ] **Step 7.2: Add test** at bottom of `tests` mod:

```rust
    #[test]
    fn replace_modulator_demotes_dependent_plastic_edges() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
            (c(0, 5, 0), NeuronKind::Modulator),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let eid = r
            .place_edge(&grid, tree, 1.0, true, Some(PathEndpoint(c(0, 5, 0))))
            .unwrap();

        // 假装外部已把 (0,5,0) 改成 InterExc
        let impact = r.on_neuron_kind_replaced(c(0, 5, 0), NeuronKind::Modulator, NeuronKind::InterExc);
        assert_eq!(impact.demoted_plastic.len(), 1);
        let d = &impact.demoted_plastic[0];
        assert_eq!(d.edge, eid);
        assert!(d.was_plastic);
        let edge = r.get(eid).unwrap();
        assert!(!edge.plastic);
        assert!(edge.mod_source.is_none());
    }

    #[test]
    fn replace_modulator_to_modulator_no_op() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
            (c(0, 5, 0), NeuronKind::Modulator),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let eid = r
            .place_edge(&grid, tree, 1.0, true, Some(PathEndpoint(c(0, 5, 0))))
            .unwrap();
        let impact = r.on_neuron_kind_replaced(c(0, 5, 0), NeuronKind::Modulator, NeuronKind::Modulator);
        assert!(impact.demoted_plastic.is_empty());
        assert!(r.get(eid).unwrap().plastic);
    }

    #[test]
    fn replace_non_modulator_no_demote() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::Motor),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        r.place_edge(&grid, tree, 1.0, false, None).unwrap();
        let impact = r.on_neuron_kind_replaced(c(0, 0, 0), NeuronKind::SensorOn, NeuronKind::InterExc);
        assert!(impact.demoted_plastic.is_empty());
    }
```

- [ ] **Step 7.3: Run**

Run: `cargo test -p grid_workshop routing::routes`
Expected: 18 个测试全绿。

- [ ] **Step 7.4: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/routes.rs && git commit -m "feat(routing): on_neuron_kind_replaced — modulator demotion"
```

---

## Task 8: `EdgeOps` 唯一入口 + Grid neuron mutator 私有化

**Spec ref:** §4.1(EdgeOps 接口 + 结构性强制)、§6 #8(Grid mutator 改 pub(crate))。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/core/grid.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/ops.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/mod.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/lib.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/examples/three_layer_demo.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/tests/grid_smoke.rs`

- [ ] **Step 8.1:** 改 `core/grid.rs`:把 `place` 和 `remove` 的可见性从 `pub` 改成 `pub(crate)`。

把 `pub fn place(` 改成 `pub(crate) fn place(`,`pub fn remove(` 改成 `pub(crate) fn remove(`。

`Grid` 结构体本身、`new`、`get`、`occupied_cells`、`len`、`is_empty` 保持 `pub`(只读 API 开放,渲染用)。

- [ ] **Step 8.2:** 实现 `routing/ops.rs`:

```rust
use crate::core::coord::CellCoord;
use crate::core::grid::{Grid, PlaceError};
use crate::core::kind::{CellContents, NeuronKind};
use crate::routing::edge::{
    Edge, KindReplaceImpact, NeuronRemovalImpact, PlaceEdgeError,
};
use crate::routing::ids::{EdgeId, PathEndpoint};
use crate::routing::path_tree::PathTree;
use crate::routing::routes::Routes;

/// Spec §4.1 — Grid + Routes 共置入口。神经元 mutator 只能通过这个类型触发,
/// 从结构上禁止"绕过级联"破坏 I-1。
pub struct EdgeOps<'a> {
    grid: &'a mut Grid,
    routes: &'a mut Routes,
}

#[derive(Debug, Clone, PartialEq)]
pub enum NeuronPlaceError {
    Grid(PlaceError),
}

#[derive(Debug, Clone, PartialEq)]
pub enum NeuronRemoveError {
    NotANeuron(CellCoord),
    Empty(CellCoord),
}

#[derive(Debug, Clone, PartialEq)]
pub enum KindReplaceError {
    NotANeuron(CellCoord),
    Empty(CellCoord),
}

impl<'a> EdgeOps<'a> {
    pub fn new(grid: &'a mut Grid, routes: &'a mut Routes) -> Self {
        Self { grid, routes }
    }

    pub fn place_neuron(
        &mut self,
        c: CellCoord,
        k: NeuronKind,
    ) -> Result<(), NeuronPlaceError> {
        self.grid
            .place(c, CellContents::Neuron(k))
            .map_err(NeuronPlaceError::Grid)
    }

    /// Spec §3.2.2 — Grid 删除前先让 Routes 级联,再实际清 Grid。
    pub fn remove_neuron(
        &mut self,
        c: CellCoord,
    ) -> Result<NeuronRemovalImpact, NeuronRemoveError> {
        match self.grid.get(c) {
            CellContents::Empty => Err(NeuronRemoveError::Empty(c)),
            CellContents::Neuron(_) => {
                let impact = self.routes.on_neuron_removed(c);
                self.grid.remove(c);
                Ok(impact)
            }
        }
    }

    /// Spec §3.3 — Grid 改 kind 后让 Routes 处理可能的降级。
    pub fn replace_kind(
        &mut self,
        c: CellCoord,
        new_kind: NeuronKind,
    ) -> Result<KindReplaceImpact, KindReplaceError> {
        let old = match self.grid.get(c) {
            CellContents::Empty => return Err(KindReplaceError::Empty(c)),
            CellContents::Neuron(k) => k,
        };
        self.grid.remove(c);
        self.grid
            .place(c, CellContents::Neuron(new_kind))
            .expect("just removed, must succeed");
        Ok(self.routes.on_neuron_kind_replaced(c, old, new_kind))
    }

    pub fn place_edge(
        &mut self,
        tree: PathTree,
        thickness_d: f32,
        plastic: bool,
        mod_source: Option<PathEndpoint>,
    ) -> Result<EdgeId, PlaceEdgeError> {
        self.routes
            .place_edge(self.grid, tree, thickness_d, plastic, mod_source)
    }

    pub fn remove_edge(&mut self, eid: EdgeId) -> Option<Edge> {
        self.routes.remove_edge(eid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::coord::CellCoord;

    fn c(layer: i32, x: i32, y: i32) -> CellCoord {
        CellCoord::new(layer, x, y)
    }

    #[test]
    fn place_neuron_via_ops() {
        let mut grid = Grid::new();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        ops.place_neuron(c(0, 0, 0), NeuronKind::Motor).unwrap();
        assert_eq!(grid.get(c(0, 0, 0)), CellContents::Neuron(NeuronKind::Motor));
    }

    #[test]
    fn remove_neuron_triggers_cascade() {
        let mut grid = Grid::new();
        let mut routes = Routes::new();
        {
            let mut ops = EdgeOps::new(&mut grid, &mut routes);
            ops.place_neuron(c(0, 0, 0), NeuronKind::SensorOn).unwrap();
            ops.place_neuron(c(0, 2, 0), NeuronKind::Motor).unwrap();
            let t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
            ops.place_edge(t, 1.0, false, None).unwrap();
            let impact = ops.remove_neuron(c(0, 0, 0)).unwrap();
            assert_eq!(impact.removed_edges.len(), 1);
        }
        assert_eq!(grid.get(c(0, 0, 0)), CellContents::Empty);
        assert_eq!(routes.edges().count(), 0);
    }

    #[test]
    fn replace_kind_triggers_demotion() {
        let mut grid = Grid::new();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        ops.place_neuron(c(0, 0, 0), NeuronKind::SensorOn).unwrap();
        ops.place_neuron(c(0, 2, 0), NeuronKind::Motor).unwrap();
        ops.place_neuron(c(0, 5, 0), NeuronKind::Modulator).unwrap();
        let t = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let eid = ops
            .place_edge(t, 1.0, true, Some(PathEndpoint(c(0, 5, 0))))
            .unwrap();
        let impact = ops.replace_kind(c(0, 5, 0), NeuronKind::InterExc).unwrap();
        assert_eq!(impact.demoted_plastic.len(), 1);
        // 求证拓扑不动
        let _ = eid;
        // 检查 grid 的 kind 改了
        assert_eq!(grid.get(c(0, 5, 0)), CellContents::Neuron(NeuronKind::InterExc));
    }

    #[test]
    fn remove_empty_cell_errors() {
        let mut grid = Grid::new();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        let err = ops.remove_neuron(c(0, 0, 0)).unwrap_err();
        assert!(matches!(err, NeuronRemoveError::Empty(_)));
    }
}
```

- [ ] **Step 8.3:** 更新 `routing/mod.rs`,加 ops re-export:

```rust
pub use ops::{EdgeOps, NeuronPlaceError, NeuronRemoveError, KindReplaceError};
```

更新 `src/lib.rs`,加 routing 公开类型 re-export:

```rust
pub use routing::{
    Edge, EdgeId, EdgeOps, KindReplaceImpact, NeuronPlaceError, NeuronRemoveError,
    NeuronRemovalImpact, KindReplaceError, PathEndpoint, PathTree,
    PlaceEdgeError, PrunedBranch, DemoteRecord, Routes,
};
```

- [ ] **Step 8.4:** 把 example / smoke test 从直接 `grid.0.place(...)` 改为 EdgeOps 路径。

改 `examples/three_layer_demo.rs` 的 `populate_grid`:

```rust
fn populate_grid(mut grid: ResMut<GridRes>) {
    use grid_workshop::{EdgeOps, Routes};
    let mut routes = Routes::new();
    let mut ops = EdgeOps::new(&mut grid.0, &mut routes);
    ops.place_neuron(CellCoord::new(0, -2, 0), NeuronKind::SensorOn).unwrap();
    ops.place_neuron(CellCoord::new(0,  2, 0), NeuronKind::SensorOn).unwrap();
    ops.place_neuron(CellCoord::new(0,  0, 1), NeuronKind::InterExc).unwrap();
    ops.place_neuron(CellCoord::new(1, -1, 2), NeuronKind::InterInh).unwrap();
    ops.place_neuron(CellCoord::new(1,  1, 2), NeuronKind::Modulator).unwrap();
    ops.place_neuron(CellCoord::new(2,  0, 2), NeuronKind::Motor).unwrap();
    let _ = routes; // 本 example 不展示 edge,丢掉 routes(C-2 task 10 的 routing_demo 才展示)
}
```

注意:`three_layer_demo` 不再用 `CellContents`/`CellCoord` 的直接 import 之外的东西;`use` 行精简:

```rust
use bevy::prelude::*;
use grid_workshop::{CellCoord, GridPlugin, GridRes, NeuronKind};
use grid_workshop::render::GridRenderPlugin;
```

改 `tests/grid_smoke.rs` 的 `plugin_lets_callers_place_via_resource_mut`:

```rust
#[test]
fn plugin_lets_callers_place_via_ops() {
    use grid_workshop::{EdgeOps, Routes};
    let mut app = App::new();
    app.add_plugins(GridPlugin);
    {
        let mut grid = app.world_mut().resource_mut::<GridRes>();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid.0, &mut routes);
        ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::Motor).unwrap();
    }
    app.update();
    let grid = &app.world().resource::<GridRes>().0;
    assert_eq!(grid.len(), 1);
    assert_eq!(
        grid.get(CellCoord::new(0, 0, 0)),
        CellContents::Neuron(NeuronKind::Motor)
    );
}
```

留下原 `plugin_initializes_empty_grid_resource` 不变。删掉旧的 `plugin_lets_callers_place_via_resource_mut`。

- [ ] **Step 8.5: Run**

Run: `cargo test -p grid_workshop`
Expected: 全绿。

Run: `cargo build -p grid_workshop --example three_layer_demo`
Expected: 编译通过。

Run: `cargo build -p grid_workshop`
Expected:**注意** — 若有任何外部代码(workspace 其它 crate)直接调 `Grid::place / remove`,会编译失败。当前 workspace 只有 `grid_workshop` 一个 crate,所以应无外部调用方。

- [ ] **Step 8.6: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/core/grid.rs crates/grid_workshop/src/routing/ops.rs crates/grid_workshop/src/routing/mod.rs crates/grid_workshop/src/lib.rs crates/grid_workshop/examples/three_layer_demo.rs crates/grid_workshop/tests/grid_smoke.rs && git commit -m "feat(routing): EdgeOps sole entry + Grid neuron mutators pub(crate)"
```

---

## Task 9: `RoutesPlugin` + `RoutesRes` + debug invariant validator

**Spec ref:** §4.1。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/plugin.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/mod.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/lib.rs`

- [ ] **Step 9.1:** 替换 `routing/plugin.rs`:

```rust
use crate::plugin::GridRes;
use crate::routing::routes::Routes;
use bevy::prelude::*;

#[derive(Resource, Default, Deref, DerefMut)]
pub struct RoutesRes(pub Routes);

pub struct RoutesPlugin;

impl Plugin for RoutesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<RoutesRes>();

        #[cfg(debug_assertions)]
        app.add_systems(Update, validate_invariants_in_debug);
    }
}

#[cfg(debug_assertions)]
fn validate_invariants_in_debug(grid: Res<GridRes>, routes: Res<RoutesRes>) {
    if let Err(e) = routes.0.validate_invariants(&grid.0) {
        panic!("Routes invariant broken: {}", e);
    }
}
```

- [ ] **Step 9.2:** 确认 `routing/mod.rs` 末尾:

```rust
pub use plugin::{RoutesPlugin, RoutesRes};
```

- [ ] **Step 9.3:** `src/lib.rs` 已在 task 8 加过 `RoutesPlugin / RoutesRes` re-export — 检查存在。若缺,补:

```rust
pub use routing::{RoutesPlugin, RoutesRes};
```

- [ ] **Step 9.4: Run**

Run: `cargo build -p grid_workshop`
Expected: 通过。

- [ ] **Step 9.5: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/plugin.rs crates/grid_workshop/src/routing/mod.rs crates/grid_workshop/src/lib.rs && git commit -m "feat(routing): RoutesPlugin + RoutesRes + debug invariant validator"
```

---

## Task 10: `RoutesRenderPlugin` gizmo + `routing_demo` example

**Spec ref:** §4.2(gizmo 每帧画 edge cell-邻接段;plastic 用不同色)、§4.3(routing_demo 程序化场景,R 键触发 cascade/prune/demote)。

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/render.rs`
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/examples/routing_demo.rs`

- [ ] **Step 10.1:** 替换 `routing/render.rs`:

```rust
use crate::core::coord::CellCoord;
use crate::routing::plugin::RoutesRes;
use bevy::prelude::*;

pub struct RoutesRenderPlugin;

impl Plugin for RoutesRenderPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, draw_edges_gizmos);
    }
}

fn draw_edges_gizmos(routes: Res<RoutesRes>, mut gizmos: Gizmos) {
    for (_eid, edge) in routes.0.edges() {
        let color = if edge.plastic {
            Color::srgb(0.95, 0.55, 0.20) // plastic = 橙色
        } else {
            Color::srgb(0.85, 0.85, 0.90) // fixed = 浅银色
        };
        // 沿 parent 链画线
        let cells = edge.tree.cells();
        let parent = edge.tree.parent();
        for i in 1..cells.len() {
            if let Some(p) = parent[i] {
                let a = cells[p as usize].to_world();
                let b = cells[i].to_world();
                gizmos.line(a, b, color);
            }
        }
    }
}
```

- [ ] **Step 10.2:** 创建 `examples/routing_demo.rs`:

```rust
use bevy::prelude::*;
use grid_workshop::{
    CellCoord, EdgeId, EdgeOps, GridPlugin, GridRes, NeuronKind, PathEndpoint,
    PathTree, RoutesPlugin, RoutesRes, RoutesRenderPlugin,
};
use grid_workshop::render::GridRenderPlugin;

#[derive(Resource, Default)]
struct DemoEdges {
    plain: Option<EdgeId>,
    forked: Option<EdgeId>,
    plastic: Option<EdgeId>,
}

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins((GridPlugin, GridRenderPlugin, RoutesPlugin, RoutesRenderPlugin))
        .init_resource::<DemoEdges>()
        .add_systems(Startup, (build_scene, spawn_camera_and_light))
        .add_systems(Update, (key_remove_source, key_remove_leaf, key_replace_modulator))
        .run();
}

fn build_scene(
    mut grid: ResMut<GridRes>,
    mut routes: ResMut<RoutesRes>,
    mut demo: ResMut<DemoEdges>,
) {
    let mut ops = EdgeOps::new(&mut grid.0, &mut routes.0);
    // Layer 0: S - I - M with a branch
    ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn).unwrap(); // S
    ops.place_neuron(CellCoord::new(0, 4, 0), NeuronKind::Motor).unwrap();    // M
    ops.place_neuron(CellCoord::new(0, 2, 2), NeuronKind::Motor).unwrap();    // M' (branch leaf)
    ops.place_neuron(CellCoord::new(0, 6, 2), NeuronKind::Modulator).unwrap();// Mod
    ops.place_neuron(CellCoord::new(0, -2, 0), NeuronKind::SensorOn).unwrap();// S2
    ops.place_neuron(CellCoord::new(0, -2, 2), NeuronKind::Motor).unwrap();   // M2

    // Edge 1: S -- (1,0) -- (2,0) -- (3,0) -- M  with branch (2,0) -> (2,1) -> (2,2)
    let mut t1 = PathTree::from_path(vec![
        CellCoord::new(0, 0, 0),
        CellCoord::new(0, 1, 0),
        CellCoord::new(0, 2, 0),
        CellCoord::new(0, 3, 0),
        CellCoord::new(0, 4, 0),
    ])
    .unwrap();
    t1.graft_branch(2, vec![CellCoord::new(0, 2, 1), CellCoord::new(0, 2, 2)]).unwrap();
    demo.forked = Some(ops.place_edge(t1, 1.0, false, None).unwrap());

    // Edge 2 (plastic, bound to Mod at (0,6,2)): S2 -- (-2,1) -- (-2,2) M2
    let t2 = PathTree::from_path(vec![
        CellCoord::new(0, -2, 0),
        CellCoord::new(0, -2, 1),
        CellCoord::new(0, -2, 2),
    ])
    .unwrap();
    demo.plastic = Some(
        ops.place_edge(t2, 1.0, true, Some(PathEndpoint(CellCoord::new(0, 6, 2))))
            .unwrap(),
    );

    // Note: plain edge with no branches not separately built — forked already covers a plain trunk.
    demo.plain = demo.forked;
}

fn key_remove_source(
    keys: Res<ButtonInput<KeyCode>>,
    mut grid: ResMut<GridRes>,
    mut routes: ResMut<RoutesRes>,
) {
    if keys.just_pressed(KeyCode::KeyR) {
        let mut ops = EdgeOps::new(&mut grid.0, &mut routes.0);
        if let Ok(impact) = ops.remove_neuron(CellCoord::new(0, 0, 0)) {
            info!("[R] remove source S — impact: {:?}", impact);
        }
    }
}

fn key_remove_leaf(
    keys: Res<ButtonInput<KeyCode>>,
    mut grid: ResMut<GridRes>,
    mut routes: ResMut<RoutesRes>,
) {
    if keys.just_pressed(KeyCode::KeyL) {
        let mut ops = EdgeOps::new(&mut grid.0, &mut routes.0);
        // 删 branch leaf M' (0,2,2)
        if let Ok(impact) = ops.remove_neuron(CellCoord::new(0, 2, 2)) {
            info!("[L] remove leaf M' — impact: {:?}", impact);
        }
    }
}

fn key_replace_modulator(
    keys: Res<ButtonInput<KeyCode>>,
    mut grid: ResMut<GridRes>,
    mut routes: ResMut<RoutesRes>,
) {
    if keys.just_pressed(KeyCode::KeyK) {
        let mut ops = EdgeOps::new(&mut grid.0, &mut routes.0);
        if let Ok(impact) = ops.replace_kind(CellCoord::new(0, 6, 2), NeuronKind::InterExc) {
            info!("[K] replace Modulator -> InterExc — impact: {:?}", impact);
        }
    }
}

fn spawn_camera_and_light(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(8.0, 8.0, 8.0).looking_at(Vec3::new(1.5, 0.0, 1.0), Vec3::Y),
    ));
    commands.spawn((
        PointLight { intensity: 8000.0, shadows_enabled: false, ..default() },
        Transform::from_xyz(5.0, 10.0, 5.0),
    ));
    commands.spawn((
        DirectionalLight { illuminance: 6000.0, shadows_enabled: false, ..default() },
        Transform::from_xyz(0.0, 10.0, 0.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}
```

- [ ] **Step 10.3:** 更新 `routing/mod.rs` 末尾包含 `pub use render::RoutesRenderPlugin;` — 应已有,检查。`src/lib.rs` 同步 re-export `RoutesRenderPlugin`。

- [ ] **Step 10.4: Run**

Run: `cargo build -p grid_workshop --example routing_demo`
Expected: 编译通过。

(不要求跑起 demo — Bevy 窗口依赖图形栈,subagent 环境可能无 GPU;编译过即视为接通。)

- [ ] **Step 10.5: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/src/routing/render.rs crates/grid_workshop/examples/routing_demo.rs crates/grid_workshop/src/routing/mod.rs crates/grid_workshop/src/lib.rs && git commit -m "feat(routing): gizmo renderer + routing_demo example (R/L/K keys)"
```

---

## Task 11: Smoke test — App-level `RoutesPlugin` 接通

**Spec ref:** §5.2。

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/tests/routing_smoke.rs`

- [ ] **Step 11.1:** 创建 `tests/routing_smoke.rs`:

```rust
use bevy::prelude::*;
use grid_workshop::{
    CellCoord, EdgeOps, GridPlugin, GridRes, NeuronKind, PathTree,
    RoutesPlugin, RoutesRes,
};

#[test]
fn routes_plugin_initializes_empty_resource() {
    let mut app = App::new();
    app.add_plugins((GridPlugin, RoutesPlugin));
    app.update();
    let routes = &app.world().resource::<RoutesRes>().0;
    assert_eq!(routes.edges().count(), 0);
}

#[test]
fn edge_ops_round_trip_through_app() {
    let mut app = App::new();
    app.add_plugins((GridPlugin, RoutesPlugin));
    {
        let world = app.world_mut();
        let mut grid = world.resource_mut::<GridRes>();
        let mut grid_inner = std::mem::take(&mut grid.0);
        drop(grid);
        let mut routes = world.resource_mut::<RoutesRes>();
        let mut routes_inner = std::mem::take(&mut routes.0);
        drop(routes);

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
    // 跑一次 Update — debug 模式下 invariant validator 应不 panic
    app.update();
    let routes = &app.world().resource::<RoutesRes>().0;
    assert_eq!(routes.edges().count(), 1);
}
```

注:`std::mem::take` 借出 Grid/Routes 因为 `EdgeOps::new` 借两个 `&mut`,直接从 World 同时借两个 `ResMut` 受 Bevy 借用规则限制 — 实际应用中通常包装一个 system,或者 UI 层借两个不同 ResMut 通过分离 schedule。本 smoke 测试用 take/restore 模式。

- [ ] **Step 11.2: Run**

Run: `cargo test -p grid_workshop --test routing_smoke`
Expected: 2 个测试通过。

- [ ] **Step 11.3: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/tests/routing_smoke.rs && git commit -m "test(routing): App-level smoke — plugin init + edge round-trip"
```

---

## Task 12: Property test — 随机操作序列下 I-1..I-7 全保持

**Spec ref:** §5.3 — 生成器**必须**包含"一个神经元被多条边端点引用"的情形,否则 v0.1 单值索引 bug 又被漏掉。

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/tests/routing_prop.rs`

- [ ] **Step 12.1:** 创建 `tests/routing_prop.rs`:

```rust
use grid_workshop::{
    CellCoord, EdgeOps, Grid, NeuronKind, PathTree, Routes,
};
use proptest::prelude::*;

/// 操作种类的随机生成。
#[derive(Debug, Clone)]
enum Op {
    PlaceNeuron { coord: (i32, i32, i32), kind: NeuronKindTag },
    RemoveNeuron { coord: (i32, i32, i32) },
    PlaceEdge { path: Vec<(i32, i32, i32)>, plastic_with_mod: Option<(i32, i32, i32)> },
    ReplaceKind { coord: (i32, i32, i32), new_kind: NeuronKindTag },
}

#[derive(Debug, Clone, Copy)]
enum NeuronKindTag { S, IE, II, Mod, Mot }

impl From<NeuronKindTag> for NeuronKind {
    fn from(t: NeuronKindTag) -> Self {
        match t {
            NeuronKindTag::S => NeuronKind::SensorOn,
            NeuronKindTag::IE => NeuronKind::InterExc,
            NeuronKindTag::II => NeuronKind::InterInh,
            NeuronKindTag::Mod => NeuronKind::Modulator,
            NeuronKindTag::Mot => NeuronKind::Motor,
        }
    }
}

fn coord_strategy() -> impl Strategy<Value = (i32, i32, i32)> {
    // 小范围便于多神经元拥挤(强迫共享端点 / 共享邻格冲突场景)
    (-2i32..3, -2i32..3, -2i32..3)
}

fn kind_strategy() -> impl Strategy<Value = NeuronKindTag> {
    prop_oneof![
        Just(NeuronKindTag::S),
        Just(NeuronKindTag::IE),
        Just(NeuronKindTag::II),
        Just(NeuronKindTag::Mod),
        Just(NeuronKindTag::Mot),
    ]
}

fn path_strategy() -> impl Strategy<Value = Vec<(i32, i32, i32)>> {
    // 生成 2..6 长度的"随机起点 + 随机步序列",6-邻居 step
    (coord_strategy(), prop::collection::vec(0u8..6, 1..6)).prop_map(|(start, steps)| {
        let mut path = vec![start];
        let (mut l, mut x, mut y) = start;
        for s in steps {
            match s {
                0 => x += 1, 1 => x -= 1,
                2 => y += 1, 3 => y -= 1,
                4 => l += 1, _ => l -= 1,
            }
            path.push((l, x, y));
        }
        path
    })
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        // 加权:多放神经元,确保 edge 有合法端点
        4 => (coord_strategy(), kind_strategy()).prop_map(|(c, k)| Op::PlaceNeuron { coord: c, kind: k }),
        2 => coord_strategy().prop_map(|c| Op::RemoveNeuron { coord: c }),
        3 => (path_strategy(), prop::option::of(coord_strategy())).prop_map(|(p, m)| Op::PlaceEdge { path: p, plastic_with_mod: m }),
        1 => (coord_strategy(), kind_strategy()).prop_map(|(c, k)| Op::ReplaceKind { coord: c, new_kind: k }),
    ]
}

fn to_coord(t: (i32, i32, i32)) -> CellCoord {
    CellCoord::new(t.0, t.1, t.2)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]
    #[test]
    fn random_ops_keep_invariants(ops in prop::collection::vec(op_strategy(), 5..40)) {
        let mut grid = Grid::new();
        let mut routes = Routes::new();
        for op in ops {
            let mut e = EdgeOps::new(&mut grid, &mut routes);
            match op {
                Op::PlaceNeuron { coord, kind } => {
                    let _ = e.place_neuron(to_coord(coord), kind.into());
                }
                Op::RemoveNeuron { coord } => {
                    let _ = e.remove_neuron(to_coord(coord));
                }
                Op::PlaceEdge { path, plastic_with_mod } => {
                    let cells: Vec<CellCoord> = path.into_iter().map(to_coord).collect();
                    let Ok(tree) = PathTree::from_path(cells) else { continue };
                    let mod_src = plastic_with_mod.map(|c| grid_workshop::PathEndpoint(to_coord(c)));
                    let plastic = mod_src.is_some();
                    let _ = e.place_edge(tree, 1.0, plastic, mod_src);
                }
                Op::ReplaceKind { coord, new_kind } => {
                    let _ = e.replace_kind(to_coord(coord), new_kind.into());
                }
            }
            // 每步后 invariants 应保持
            routes.validate_invariants(&grid).expect("invariant broken mid-sequence");
        }
    }
}
```

- [ ] **Step 12.2: Run**

Run: `cargo test -p grid_workshop --test routing_prop --release`
Expected: 200 cases 通过(release 编译让 200 case 快)。

若有反例 — proptest 会自动 shrink 出最小反例;按 spec §5.3 检查是否触及"多神经元作多边端点"的具体不变量违反。

- [ ] **Step 12.3: Commit**

```bash
cd D:/dev/umwelt-bevy && git add crates/grid_workshop/tests/routing_prop.rs && git commit -m "test(routing): proptest random ops keep I-1..I-7"
```

---

## Task 13: 收尾 — 全套 cargo 验证 + worklog 写

**Files:**
- Modify: `D:/dev/Umwelt/docs/worklog.md`

- [ ] **Step 13.1: 全套 verification**

Run: `cargo test -p grid_workshop`
Expected: 全绿(单元 + smoke + prop)。

Run: `cargo build -p grid_workshop --examples`
Expected: 两个 example 都编译过。

Run: `cargo clippy -p grid_workshop -- -D warnings`
Expected: 无 warning(若有遗留 dead_code、unused import,清理之)。

- [ ] **Step 13.2:** 追加 worklog 段(给执行 agent — 在执行完后填实际数字 / 偏差,不要在 plan 阶段假填):

模板:

```markdown
## 2026-05-27

### 做了什么
- C-2 实现计划(`2026-05-27-bevy-subsystem-c2-routing.md`)落地,task 0–13:
  - task 0 删 `CellContents::Via` + C-1 plan v0.2 注
  - task 1–9 routing 模块(`grid_workshop::routing::{ids, path_tree, edge, routes, ops, plugin, render}`)
  - task 10 `routing_demo` example(R/L/K 热键演示 cascade / prune / demote)
  - task 11–12 smoke + proptest 三件套(spec §5.1–5.3 全覆盖)
  - task 13 全套 cargo 验证

### 关键设计点落地
- `PathTree` 单一扁平 `cells + parent`,`is_path()` 是查询;`prune_to_node` 用 `PruneOutcome` 区分整塌 vs 剪到 fork
- `Routes` 双反查:`cell_to_edge` 单值(仅线格)+ `endpoint_to_edges: HashMap<_, SmallVec<[_; 6]>>` 多值(端点)
- `EdgeOps` 唯一入口;`Grid::place / remove` 改 `pub(crate)`,外部代码无法绕过级联
- 隐式 via:线格穿 `Empty` 合法,被记入 `cell_to_edge` 但不改 Grid 状态;删边后线格还原 Empty
- `on_neuron_removed` 三种 cascade(source 整删 / leaf 剪叶 / modulator 降级)各自有测试覆盖
- I-1..I-7 7 条不变量 + `validate_invariants` debug-only 检查 + proptest 200 case 验证

### 未完成
- (执行后填)

### 下一步
- C-3 子系统设计 spec:横截面 + 成本(volume / 代谢 / 延迟 / 衰减)
- (执行后填:遗留 / 调整 / 后续 task)
```

- [ ] **Step 13.3: Commit final**

```bash
cd D:/dev/Umwelt && git add docs/worklog.md && git commit -m "docs(worklog): 2026-05-27 — C-2 routing landed"
```

---

## Self-Review

| 检查 | 结果 |
|------|------|
| Spec §2.1 Edge 字段 | Task 4 落地 |
| Spec §2.2 PathTree 单一扁平 + is_path 查询 | Task 3 落地;`is_path` 用 `parent` 链 child_count 计算 |
| Spec §2.3 双索引 + I-1..I-7 + ~6 fan-in 上限 | Task 5(索引)、Task 5 `validate_invariants`(I-1..I-7)、Task 5 fan_in_cap 测试 |
| Spec §3.1 `place_edge` 全错误分支 | Task 5(7 个错误分支)、Task 6/7 测试覆盖 |
| Spec §3.2.1 `remove_edge` | Task 5 |
| Spec §3.2.2 `on_neuron_removed` 三种 cascade + Impact / PrunedBranch / DemoteRecord | Task 6 |
| Spec §3.2.3 剪到最近 fork | Task 3 `prune_to_node` + Task 6 集成 |
| Spec §3.3 `replace_kind` 触发 Modulator 降级 | Task 7 |
| Spec §3.4 隐式 via(删 Via 变体 + 中间 cell 进 cell_to_edge 不改 Grid) | Task 0(删 Via)+ Task 5(test `implicit_via_through_empty_cells`) |
| Spec §4.1 RoutesPlugin / RoutesRes / EdgeOps 唯一入口 / Grid mutator pub(crate) | Task 8 + Task 9 |
| Spec §4.2 Gizmo 渲染 plastic 区分 | Task 10 `routing/render.rs` |
| Spec §4.3 routing_demo R/L/K 三热键 | Task 10 |
| Spec §5.1 单元测试(含 S→I→M、fan-in 6、隐式 via、降级、剪枝) | Task 3/5/6/7 共 ~25 个单元测试 |
| Spec §5.2 smoke | Task 11 |
| Spec §5.3 proptest 含"神经元多边端点"用例 | Task 12 — 用 5×5×5 小坐标空间 + 200 case + 含 PlaceEdge / RemoveNeuron 混合保证经常踩这条 |
| Spec §6 八条已决定全部贯彻 | #1 demote(task 6/7)、#2 隐式 via(task 0/5)、#3 EdgeId 不重用(task 5 + 测试)、#4 撤销外置(无内置)、#5 graft_branch 底层 API(task 3)、#6 单一扁平 PathTree(task 3)、#7 不强制一神经元一出边(无该检查)、#8 EdgeOps 唯一入口(task 8) |
| 类型一致性 | `EdgeId`、`PathEndpoint`、`PathTree`、`PathTreeError`、`PruneOutcome`、`PlaceEdgeError`、`NeuronRemovalImpact`、`PrunedBranch`、`DemoteRecord`、`KindReplaceImpact`、`NeuronPlaceError`、`NeuronRemoveError`、`KindReplaceError` — 跨 task 拼写一致 |
| 占位符扫描 | 无 TBD / TODO / "稍后" — 所有 step 含可执行内容 |

