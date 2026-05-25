# Bevy 子系统 C-2 — 布线 / 边模型 设计规格

> **状态**:草案 v0.1
> **日期**:2026-05-26
> **上位**:`docs/umwelt_design_constitution.md`(五条物理真理,本文档每个不变量都引用其出处)、`docs/superpowers/specs/2026-05-22-bevy-workshop-grid-substrate-design.md`(工坊 spec v2)
> **依赖**:`docs/superpowers/plans/2026-05-24-bevy-subsystem-c1-grid-substrate.md`(C-1 已落地:`Grid` + `CellContents` + `CellCoord`)
> **下位**:`writing-plans` 阶段产出 C-2 实现计划。

---

## 1. 目标

在 C-1 网格基质之上,加一层**布线 / 边模型**,让玩家(及后续编辑器 UI)能在两个神经元之间放一条轴突 —— 但作为本子系统,**不含交互式 UI**,只提供数据 API + Bevy 插件 + 极简可视化(用 gizmo 把已放的边画出来,供 demo 验证)。

C-2 的产出物是一个**头脑可全部装得下**的数据模型:Edge = 树、cell→edge 单值反查索引、级联删除有源/叶不对称、`replace_kind` 高频操作。后续 C-3(横截面 / 成本)、C-4(编译到 HTML)、UI 层(鼠标画线)都在这个模型上接。

**显式不在 C-2 作用域**:

- 成本计算(体积 / 代谢 / 延迟 / 衰减数值化)—— C-3
- 横截面渲染 —— C-3
- HTML JSON 编译导出 —— C-4
- `constants/biology.rs` 真实数值 —— C-4(C-2 只存 `d` 字段,不展开 √d 物理)
- 鼠标交互画线 / 编辑 UI —— 单独 UI 子系统
- 撤销栈 —— 横切,会和 C-2 同期但独立追踪(见 §6)

---

## 2. 核心数据形状

### 2.1 Edge 是一棵树

宪法 §3:edge **是**一个神经元的轴突,以 source 神经元为根、叶子落在 target 神经元上的 cell 树(F4 从 path 推广为 tree)。

宪法 §2:tree 节点有且仅有一个 parent → **join 在数据结构层就不可表达**,不需要运行时检查。这是把"诚实于物理"做进数据形状。

宪法 §4:每棵树共享一个 `d`(粗细)、共享 `plastic` 和 `mod_source`。

```rust
pub struct Edge {
    pub tree: PathTree,                   // 见 §2.2
    pub thickness_d: f32,                 // 真实单位 μm,常数表在 C-4 才用,C-2 只存
    pub plastic: bool,
    pub mod_source: Option<PathEndpoint>, // None → 固定;Some(coord) → 可塑且绑该 modulator
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct EdgeId(pub u32);

/// coord-as-id 的 newtype 包装,宪法 §3 — 未来若改 explicit NeuronId
/// 是局部改动,不是全仓 sweep
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct PathEndpoint(pub CellCoord);
```

### 2.2 PathTree 的具体表示

**选定:enum 两变体(`Path` + `Tree`)**。

```rust
pub enum PathTree {
    /// 单端 / 无分叉。MVP 常态,也是宪法 §3 行 42 明确给的退化形式
    Path(Vec<CellCoord>),
    /// 分叉树。root = cells[0],fork 点和 leaf 通过 forks 表达
    Tree {
        cells: Vec<CellCoord>,            // 所有占用的 cell,扁平,index 即节点 id
        parent: Vec<Option<u16>>,         // parent[i] = cells[i] 的 parent index,root 为 None
        // 派生(在 Edge 构造期建,后续 cache):
        // leaves: Vec<u16>(parent index 不被任何节点引用的)
    },
}
```

**为什么 enum 两变体而不是始终 tree**:

1. MVP 大多数 edge 是单端,`Vec<CellCoord>` 既是宪法 §3 列出的退化形式,也是 `delay_ms = path_len / v` 和 `attenuation = exp(-path_len/λ)` 计算最廉价的形式;
2. 分叉态用 flat `cells` + `parent: Vec<Option<u16>>` 而不是嵌套递归,避免 `Box<Tree>` 的内存碎片,Bevy reflect / serde 也更友好;
3. enum 让模式匹配显式区分两态,降低误用;`u16` 节点 index 足够单棵树容纳 65k cell 一棵树(单棵树是一个神经元的轴突,上限远小于这个);
4. 路径变树的"升级"是显式构造函数 `PathTree::from_path(...).graft_branch(...)`,不是隐式 mutate,新分支接入点会要求是 `cells` 中已有的某个节点 index。

**path ↔ tree 互转**:`Path(v)` 可以理解成"`cells = v`、parent 为单调链"的退化树。提供 `as_tree_view(&self) -> TreeView` 适配器让算法只对 tree 写一份代码;但存储区分两态,以省常见 case 的内存。

### 2.3 Routes 全局结构

```rust
pub struct Routes {
    edges: HashMap<EdgeId, Edge>,
    /// 单值反查索引(宪法 §2 行 27):至多一边占用一 cell。
    /// place_edge 时 O(树大小) 检查冲突;remove_edge 时一并清理。
    cell_to_edge: HashMap<CellCoord, EdgeId>,
    /// 单调递增分配器。删除不重用 id —— 避免 stale EdgeId 静默指向新边
    next_id: u32,
}
```

`Routes` **独立于 `Grid`**(C-1 worklog 已经定调:不塞进 `CellContents`)。两者通过 `CellCoord` 关联。Grid 管"哪些 cell 上有神经元 / via",Routes 管"哪些 cell 被边占用、被哪条边占用"。它们共享 cell 命名空间,但持久化和 mutate 流是分离的。

**不变量集**(任一公开 mutate 入口结束时必须成立):

- I-1 (宪法 §3):`edge.tree.root_cell()` 和 every leaf cell 必须在 Grid 上是 `CellContents::Neuron(_)`。
- I-2 (宪法 §2):`cell_to_edge` 的每个 entry `(c, eid)` 满足 `c ∈ Routes::edges[eid].tree.cells()`;反之亦然(双向覆盖)。
- I-3 (宪法 §2):任意 `c ∈ Grid::occupied_cells()` 中是 `Neuron` 的 cell,可以同时出现在 `cell_to_edge` 中(因为 edge 的 root/leaf 落在神经元 cell 上)。是 `Via` 的 cell 也可以出现(via 是边路径的一段)。是 `Empty` 的 cell **不能** 出现在 `cell_to_edge` 中。**注**:本条按"保留显式 Via"假设书写;若 §6 #2 review 决定走"隐式 via"路线,此处需改为"`Empty` cell 在路径中是合法的,被穿过后不进 cell_to_edge",且去掉显式 Via 变体。
- I-4 (宪法 §4):`edge.thickness_d > 0`;`edge.mod_source` 若 `Some(c)`,则 Grid 上 `c` 必须是 `CellContents::Neuron(NeuronKind::Modulator)`。
- I-5:`PathTree::Tree` 形态下,`parent` 长度等于 `cells` 长度,且恰一个 None(根),其余指向更小 index(拓扑序),无环。

破坏不变量 = bug,而不是合法运行时态。任何"看起来想 dangling"的需求都应该回到宪法 §3 提示的 conflict surface 流程。

---

## 3. 操作 API

### 3.1 加边

```rust
impl Routes {
    pub fn place_edge(
        &mut self,
        grid: &Grid,
        tree: PathTree,
        thickness_d: f32,
        plastic: bool,
        mod_source: Option<PathEndpoint>,
    ) -> Result<EdgeId, PlaceEdgeError>;
}

pub enum PlaceEdgeError {
    /// root 或某 leaf cell 不在神经元上 (I-1)
    EndpointNotNeuron(CellCoord),
    /// 路径中某 cell 已被其他边占用 (I-2 / 宪法 §2 no-overlap)
    CellOccupied { cell: CellCoord, by: EdgeId },
    /// 路径中某 cell 在 Grid 上是 Empty(via 必须显式放置,不能"路径穿空气")
    PathThroughEmpty(CellCoord),
    /// 路径中某中间 cell 是 Neuron(不能"借道"另一个神经元的胞体)
    PathThroughNeuron(CellCoord),
    /// mod_source 指向的 cell 不是 Modulator 神经元 (I-4)
    ModSourceNotModulator(CellCoord),
    /// 路径不连续(相邻 cell 不是邻居,或跨层但不经 via cell)
    Discontinuous { from: CellCoord, to: CellCoord },
    /// tree 拓扑非法(有环、parent 索引越界等)
    InvalidTreeTopology,
    /// 厚度非正
    InvalidThickness(f32),
}
```

**`PathThroughNeuron` 的来意**:轴突路径**只能穿过 via cell 和神经元的根 / 叶 cell**,不能从一个无关神经元的胞体上经过 —— 这等价于"另一神经元给你的轴突当中转",违反宪法 §2 "wire is one neuron's private line"。via 必须由玩家**显式**放置(C-1 已有 `CellContents::Via`),placing the via 是显式动作,placing the edge 检查这些 cell 是不是 via。

**路径连续性**:tree 的每条 parent ↔ child cell 对必须是 6-邻居(同层 4 邻 + 上下层各 1 邻)。

### 3.2 删除

#### 3.2.1 删除一条整边

```rust
pub fn remove_edge(&mut self, eid: EdgeId) -> Option<Edge>;
```

最直接的:把 edge 从 `edges` 拿掉,把它占用的所有 cell 从 `cell_to_edge` 清掉。

#### 3.2.2 删除一个神经元(由 Grid 触发,Routes 响应)

宪法 §3 行 43 的非对称是 C-2 的关键设计:

- **删 source 神经元** → 整棵 edge tree 蒸发(整条 `remove_edge`)。
- **删 target 神经元(叶)** → 只剪到最近 fork,兄弟分支保留。
- 删一个**既是 A edge 源、又是 B edge 叶**的神经元 → 对 A 删整树,对 B 剪叶分支。
- 删一个**只用作 via 占位** 的 cell(neuron cell 同时被 edge 路径穿过的情况其实不存在,因为 I-1 强制 root/leaf 落 neuron,中间路径不能穿 neuron)—— 不适用。
- 删一个 cell **同时是某条 edge 的 mod_source**(被某条 plastic edge 引用作 modulator)→ 宪法尚未在 C-2 范围明文规定,我倾向**与 HTML 一致(CLAUDE.md 「modulator 失效时自动降级」):那条 edge 的 `plastic` 设为 false,`mod_source` 设为 None,边的拓扑不动**。这一点列入 §6 open question。

接口形态:

```rust
impl Routes {
    /// Grid 在 remove_neuron(coord) 时调用,在 Grid 实际清除前。
    /// 返回受影响的 edge 列表(给 undo / UI 报告用)。
    pub fn on_neuron_removed(&mut self, coord: CellCoord) -> NeuronRemovalImpact;
}

pub struct NeuronRemovalImpact {
    pub removed_edges: Vec<(EdgeId, Edge)>,         // 整条删的
    pub pruned_branches: Vec<(EdgeId, PrunedBranch)>, // 部分剪枝的
    pub demoted_plastic: Vec<EdgeId>,               // mod_source 失效降级的(若决定走这条路)
}
```

#### 3.2.3 叶剪枝算法:剪到最近 fork

设 leaf cell 在 tree 的节点 index 是 `L`,沿 `parent` 链向上走,直到遇到一个**有 ≥ 2 个 child** 的节点 `F`(fork),把 `F → ... → L` 这一段从 tree 移除。

**特殊情况**:

- 若一路上行到 root 都没遇到 fork(树本就是单端 path) → 整棵删除(等价于 §3.2.1 整边删)。
- 若 fork `F` 只剩两支,剪掉一支后只剩单链 → tree 形态**自动塌回 Path 变体**(显式收敛存储形式,免得 enum 变体里出现"假分叉树")。这个塌回是无条件的:`PathTree` 的 mutator 在每次结构变更后做一次"分叉计数 ≥ 2 才保 Tree,否则塌回 Path"的归一化。
- 若 source 神经元只通过这条 edge 出去,且 leaf 删除导致整树消失 → 也整删。

剪枝实现:O(path length) 一次回溯标记 + O(tree size) 一次 rebuild `cells`/`parent`。

### 3.3 替换神经元类型

宪法 §3 行 45:`replace_kind` 是高频实验操作。Edge 不动,coord 不动,Dale 符号在求值时按神经元类型推 —— 所以 C-2 这边其实只需要**配合 Grid 的 `replace_kind`,且不需要任何 edge 侧的响应**,除了一种情况:

- 被替换的神经元是某 plastic edge 的 `mod_source`,新类型不是 Modulator → 与 §3.2.2 的 modulator 失效降级同处理(降级为固定,plastic=false,mod_source=None)。

接口:

```rust
impl Routes {
    pub fn on_neuron_kind_replaced(
        &mut self,
        coord: CellCoord,
        old_kind: NeuronKind,
        new_kind: NeuronKind,
    ) -> KindReplaceImpact;
}
```

### 3.4 移动 / via / 其他

**移动神经元(同种,改坐标)**:当前 spec **不暴露该操作**。理由:coord-as-id 的代价是"神经元不可移动",这正是宪法 §3 选 F1 时接受的取舍。玩家有移位需求的话用"删 + 重放" + undo 救场。

**via**:via 是 edge 路径的一段(宪法 §2 "per-edge path segment"),不是独立操作。Grid 提供 `CellContents::Via` 作为 cell 内容是历史遗留;在 C-2 模型下,**via cell 的合法性由所属 edge 兜底**:place_edge 时若路径里某 cell 是 `Via`,允许穿过;若是 `Empty`,要求玩家先把那个 cell 放上 `Via`(显式动作)。via cell 没被任何 edge 占用是合法的(玩家提前规划),但放上去后不进 `cell_to_edge`,直到 place_edge。

> **§6 待定**:`Via` 这个 `CellContents` 变体在 C-1 还有意义吗?也许 C-2 应该直接让 edge 自带 via —— place_edge 时遇到 `Empty` 直接当作 via cell 由 edge 创建,不需要玩家先 place via。这影响 C-1 已落地的 API,要 review。

---

## 4. Bevy 集成

### 4.1 资源 & 插件

```rust
pub struct RoutesPlugin;

impl Plugin for RoutesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<RoutesRes>()
           .add_systems(Update, validate_invariants_in_debug); // debug_assertions only
    }
}

#[derive(Resource, Default, Deref, DerefMut)]
pub struct RoutesRes(pub Routes);
```

`RoutesPlugin` 必须在 `GridPlugin` 之后注册。两个 resource 由 high-level 的"操作系统"(后续 UI 子系统)同时 mutate;C-2 本身只暴露 API,不规定 mutate 谁先谁后 —— 但提供 `EdgeOps` helper trait 把"删神经元 + 触发 cascade"封装成原子调用,避免 UI 自己同步两个 resource 而漏 cascade。

```rust
pub trait EdgeOps {
    fn remove_neuron_with_cascade(&mut self, grid: &mut Grid, routes: &mut Routes, c: CellCoord) -> Removed;
    fn replace_kind_with_demote(&mut self, grid: &mut Grid, routes: &mut Routes, c: CellCoord, k: NeuronKind) -> Replaced;
    fn place_edge(&mut self, grid: &Grid, routes: &mut Routes, ...) -> Result<EdgeId, PlaceEdgeError>;
}
```

### 4.2 渲染(极简,只为 demo 验证)

```rust
pub struct RoutesRenderPlugin;
```

- 用 `Gizmos` 每帧把每条 edge 的所有 cell-邻接段画一条线。color 由 plastic 与否区分(plastic 用虚线 / 不同色调)。
- 不做 mesh 化 / 不做粗细 d 的可视化(C-3 / 后续 UI 子系统的事)。
- 反查索引 `cell_to_edge` 不参与渲染,只用作占用检查。

### 4.3 demo

`crates/grid_workshop/examples/routing_demo.rs`(或在 C-2 新建独立 example):程序化搭一个小场景 —— 3 个神经元 + 2 条边(其中一条带分叉、一条 plastic 绑 modulator),按下 R 键模拟删 source / 删 leaf / replace_kind,观察 cascade / prune / demote 效果。无 UI,纯键盘热键 + gizmo 渲染。

---

## 5. 不变量自检 / 测试

### 5.1 单元测试

- `Routes::place_edge` 所有错误分支都有对应的 should_fail 测试。
- 删 source / 删 leaf / 删既源又叶的神经元三种 cascade 路径分别测。
- 叶剪枝触发 Path 塌回。
- mod_source 失效降级 → plastic=false, mod_source=None。
- `replace_kind` 不动 edge tree,但 `Modulator → 非 Modulator` 触发降级。
- 路径连续性 / 神经元中转 / 路径穿空气三种非法路径单独测。

### 5.2 插件 smoke 测试

App + `GridPlugin + RoutesPlugin` 起来后,API 操作通过 resource 可达;`debug_assertions` 下的 invariant 检查跑一遍不 panic。

### 5.3 不变量 prop test

`proptest` 生成随机操作序列(place_neuron / place_edge / remove_neuron / replace_kind),每步后检查 I-1..I-5。规模小但密度高。

---

## 6. 开放问题

C-2 实现计划落地前**需在 spec review 时确认**:

1. **Modulator 失效的处理**:plastic edge 的 `mod_source` 指向的神经元被删除或换种 → 整条边降级为固定(plastic=false, mod_source=None)?这与 HTML 侧 CLAUDE.md 「modulator 失效时自动降级」一致;但严格读宪法 §3,删神经元应级联,modulator 是不是端点是模糊地带 —— 它**不是** edge 的 root 或 leaf,只是 plasticity 的调制源。我倾向降级而非级联,但需要确认。

2. **`CellContents::Via` 的归宿**:C-1 已经把 Via 作为 cell 内容物之一。在 C-2 的模型下,via cell 由 edge 路径隐式占用,玩家是否仍需要"先放 via,再 place edge 穿过"?三种取舍:
   - **保留显式 via**:玩家心智模型清楚("我先布管再走线"),但 C-2 的 place_edge 要先验证 via 已存在;
   - **隐式 via**:place_edge 时遇到 `Empty` 中间 cell 自动当 via 占,但要"清理"时谁负责?(edge 删除后,被占用的 Empty 还原成 Empty 即可,via 不需要独立 entity);
   - **混合**:玩家可以"预占" via 占位(意图表达),place_edge 验证占位与路径吻合。
   我**倾向隐式 via**(选项 b)—— 简化操作流,放大 cell 稀缺的体感(因为玩家不再有"反正先布个 via 占着"的便利)。这一选项可能要小幅修订 C-1 的 `CellContents` 变体集。

3. **EdgeId 分配策略**:单调递增不重用 → 长 session id 可能用到 u32 上限?对单人沙盒不现实(需要十亿次 place 操作),但若将来导出 / 导入要稳定 id,要不要现在就用 UUID?我倾向 u32 + 不重用,导出走 path-shape-derived 字符串 id。

4. **撤销栈**:宪法 §3 明确写了"undo is P0"。C-2 自身要不要内置 op log,还是把 undo 做成独立 crate / module 监听 `EdgeOps` 调用?我倾向独立,但要确认 C-2 的 API 设计成"每个 mutate 返回足够信息以反推 inverse op"(`NeuronRemovalImpact`、`KindReplaceImpact` 已经这样设计)。

5. **分叉的 UX 入口**:"玩家如何画出一个分叉" 是 UI 层问题(`PathTree::from_path` + `graft_branch` 是底层 API),但 spec 是否要在这里**预定**一种合法的 UI 流程,以避免 UI 实现时撞到模型限制?我倾向不预定,把 UX 完全 push 到 UI 子系统。

---

## 7. 设计宪法检查

按宪法 §1–§5 的不变量逐条:

1. **§1 空间是真的;布线有代价**:edge 树存的是**实际占用的 cell 序列**,不是抽象图边。√d 物理在 C-4 编译时展开,但 C-2 已经在数据层把"长度"做成树边数 —— 后续延迟 / 衰减 / 体积都从这里派生。
2. **§2 一条线是一个神经元的私线**:no `Via` entity(via 是 edge 路径段)、`HashMap<CellCoord, EdgeId>` 单值反查、tree 形状结构性禁止 join —— 三条都在 §2 的 invariants 列里直接出处。
3. **§3 连接与端点共生死**:F4 推广 tree、I2 级联(source 整删 / leaf 剪枝)、`PathEndpoint` newtype 包 coord-as-id、`replace_kind` 高频操作、undo P0 列入 §6 —— 全员对齐。
4. **§4 信号分级衰减,学习局部**:`Edge::thickness_d` + `plastic` + `mod_source` 三字段就位;实际数值与 √d 物理留给 C-4。这里只保字段。
5. **§5 意义没有标签**:所有错误类型用物理描述(`PathThroughNeuron`、`ModSourceNotModulator`)而非语义("AvoidanceCircuitBroken")。

---

## 8. 下一步

本文档定义"做什么"。下一步是 `writing-plans` 阶段,产出"怎么做" —— 详细实现计划,task-by-task 落到 `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/*` 或新建 crate(待 plan 阶段决定)。

实现计划必须与 §1 的"显式不在 C-2 作用域"严格对齐:不写 cost、不写横截面、不写 HTML 编译、不写鼠标 UI。
