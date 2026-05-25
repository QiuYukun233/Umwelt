# Bevy 子系统 C-2 — 布线 / 边模型 设计规格

> **状态**:草案 v0.2(post-review)
> **日期**:2026-05-26(v0.1 → v0.2 同日修订)
> **v0.2 修订要点**:
> - **单值反查索引修正**:`cell_to_edge` 只索引线格(端点神经元 cell 不进索引);加 `endpoint_to_edges` 多值反查;否则三神经元一条链都建不出来(v0.1 漏)。
> - **Via 改隐式**:删 `CellContents::Via` 变体(C-1 改动)、删 `PathThroughEmpty` 错误;穿 `Empty` 合法,即"该格是这根轴突的 via 段",删边时还原 `Empty`。
> - **Modulator 失效定为降级**:`plastic→false`、`mod_source→None`,拓扑不动。
> - **`PathTree` 改单一扁平表示**:始终 `cells + parent` 一种形态,"分没分叉"做成查询;省掉归一化维护成本(review §五 #2 建议)。
> - **删神经元设为唯一入口**:Grid 的 neuron mutator 改私有 / 路径绑定到 `EdgeOps`,从结构上禁止绕过级联。
> - 新增:`~6 fan-in 上限是有意约束`(spec §2.3、§7 #2 自检补)。
> **上位**:`docs/umwelt_design_constitution.md`(五条物理真理,本文档每个不变量都引用其出处)、`docs/superpowers/specs/2026-05-22-bevy-workshop-grid-substrate-design.md`(工坊 spec v2)
> **依赖**:`docs/superpowers/plans/2026-05-24-bevy-subsystem-c1-grid-substrate.md`(C-1 已落地:`Grid` + `CellContents` + `CellCoord`)
> **下位**:`writing-plans` 阶段产出 C-2 实现计划。

---

## 1. 目标

在 C-1 网格基质之上,加一层**布线 / 边模型**,让玩家(及后续编辑器 UI)能在两个神经元之间放一条轴突 —— 但作为本子系统,**不含交互式 UI**,只提供数据 API + Bevy 插件 + 极简可视化(用 gizmo 把已放的边画出来,供 demo 验证)。

C-2 的产出物是一个**头脑可全部装得下**的数据模型:Edge = 树、线格走单值反查 + 端点走多值反查、级联删除有源/叶不对称、modulator 失效降级、`replace_kind` 高频操作、隐式 via。后续 C-3(横截面 / 成本)、C-4(编译到 HTML)、UI 层(鼠标画线)都在这个模型上接。

**外部前置(C-2 实现计划 task 0)**:C-1 已落地的 `CellContents::Via` 变体在 v0.2 决定走隐式 via 后变得多余,要从 `grid_workshop::core::kind` 中删除;C-1 计划文档(`2026-05-24-bevy-subsystem-c1-grid-substrate.md`)对应章节加注"v0.2 起 Via 变体作废"。这是宪法 §2 的回归校正,不是新功能。

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
    pub tree: PathTree,                   // 见 §2.2 — 始终用单一扁平表示
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

**选定:单一扁平表示**(v0.2 改:v0.1 的两变体 enum 归一化维护成本太高,review §五 #2)。

```rust
pub struct PathTree {
    /// 所有占用的 cell,扁平,index 即节点 id
    cells: Vec<CellCoord>,
    /// parent[i] = cells[i] 的 parent index;parent[0] = None(root),其余指向 < i
    parent: Vec<Option<u16>>,
}
```

**退化形式 = 单端 path**:`parent` 是单调链 `None, Some(0), Some(1), ..., Some(n-1)`,`cells` 就是从源到目标的有序坐标列表。宪法 §3 行 42 列的"单端 case 是 `Vec<CellCoord>`"在这个表示下是查询而非存储变体——`is_path(&self) -> bool` 检查 fork 数是否为 0 即可。

**为什么单一表示**:

1. v0.1 两变体每次结构变更(graft / prune)要跑"分叉<2 塌回 Path"的归一化,漏一次就出现同形状两种编码 → 序列化不确定、`PartialEq` 不传递;
2. MVP 规模下单形态省不下多少内存(单 edge 至多几十 cell),`Vec<Option<u16>>` 比 `enum { Path(Vec), Tree {...} }` 的 padding 还省;
3. 后续算法(剪枝、求叶集、计算各叶 path 长度)统一处理一种结构,代码量减半;
4. `u16` 节点 index 上限 65k cell 一棵树,实际单根轴突远小于这个上限,放心。

**构造与变更**:

```rust
impl PathTree {
    pub fn from_path(cells: Vec<CellCoord>) -> Self;     // 单调链
    pub fn graft_branch(&mut self, attach_at: u16, branch_cells: Vec<CellCoord>); // 从已有 index 派生新分支
    pub fn prune_to_node(&mut self, leaf: u16);          // 剪到最近 fork,见 §3.2.3
    pub fn root(&self) -> CellCoord;                     // = cells[0]
    pub fn leaves(&self) -> impl Iterator<Item = (u16, CellCoord)>;
    pub fn is_path(&self) -> bool;                       // fork 数为 0
    pub fn wire_cells(&self) -> impl Iterator<Item = CellCoord>;   // 除 root 与 leaves 外的 cell
    pub fn endpoint_cells(&self) -> impl Iterator<Item = CellCoord>; // root + 所有 leaves
}
```

`wire_cells` 与 `endpoint_cells` 严格不相交;并集 = `cells`。这两个分类决定下面 §2.3 哪些进单值索引、哪些进多值索引。

### 2.3 Routes 全局结构

```rust
pub struct Routes {
    edges: HashMap<EdgeId, Edge>,
    /// 单值反查索引(宪法 §2 行 27):**只索引线格**(`PathTree::wire_cells()`),
    /// 不索引端点神经元 cell。每个线格至多被一条边占用 ——
    /// 这条单值不变量管的是「线不能挤同格」,不管「神经元被多条边碰」。
    /// place_edge 时检查冲突;remove_edge 时清理。
    cell_to_edge: HashMap<CellCoord, EdgeId>,
    /// 多值反查索引:神经元 cell → 把它当端点(根或叶)的所有 edge。
    /// SmallVec 长度上限 = neighbor cell 数(~6,见下文「有意约束」)。
    endpoint_to_edges: HashMap<CellCoord, SmallVec<[EdgeId; 6]>>,
    /// 单调递增分配器。删除不重用 id —— 避免 stale EdgeId 静默指向新边
    next_id: u32,
}
```

`Routes` **独立于 `Grid`**(不塞进 `CellContents`)。两者通过 `CellCoord` 关联。Grid 管"哪些 cell 是神经元 / 空",Routes 管"哪些 cell 被边的线格占用 / 哪些边把某神经元当端点"。它们共享 cell 命名空间,但持久化和 mutate 流分离。

**v0.2 索引修正的来意**:v0.1 让 `cell_to_edge` 单值索引覆盖所有 edge cells(含神经元两头) → 一个神经元那一格最多能被一条边碰 → **三神经元一条链都建不出来**(S→I 把 I 占了,I→M 不能再放)。修正:神经元 cell 不进单值索引,而是进多值 `endpoint_to_edges`;单值索引保留给线格,守的是宪法 §2 真正要的"线不挤同格"。

**有意的 ~6 fan-in 上限**(宪法 §2 行 31 的把树突塌进胞体):每条边都通过神经元旁边一个**单独的线格**去碰它,一个 cell 周围 6 个邻格 → **碰一个神经元的边最多 ~6 条**。这是宪法 §2 写明的"honest simplification":想要更高 fan-in,玩家用中继神经元搭一个漏斗(自己重搭树突,同型于自己搭 OFF-cell)。**不要为了让一个神经元多连几条边就放开索引**(那等价于偷偷重新引入"共享 cell" 的隐藏语义)—— C-2 通过"端点不入单值索引、线格必经神经元的某个邻格"双约束把这个上限做进数据形状,不靠运行时阈值。

**不变量集**(任一公开 mutate 入口结束时必须成立):

- I-1 (宪法 §3):`edge.tree.root()` 和 every leaf cell 必须在 Grid 上是 `CellContents::Neuron(_)`。
- I-2 (宪法 §2):`cell_to_edge` 的每个 entry `(c, eid)` 满足 `c ∈ Routes::edges[eid].tree.wire_cells()`;反之亦然(线格双向覆盖)。**端点 cell 不出现在 `cell_to_edge` 中**。
- I-3 (宪法 §2):`endpoint_to_edges[c]` 中的每个 `eid` 满足 `c ∈ Routes::edges[eid].tree.endpoint_cells()`;反之亦然(端点双向覆盖)。
- I-4:任意 `c ∈ Grid` 上是 `Empty` 的 cell,**可以**出现在 `cell_to_edge` 中(隐式 via,§3.4);**不会**出现在 `endpoint_to_edges` 中(端点必为神经元)。
- I-5 (宪法 §4):`edge.thickness_d > 0`;`edge.mod_source` 若 `Some(c)`,则 Grid 上 `c` 必须是 `CellContents::Neuron(NeuronKind::Modulator)`。
- I-6:`PathTree` 的 `parent` 长度等于 `cells` 长度,且恰一个 None(根),其余指向更小 index(拓扑序),无环。
- I-7 (fan-in 上限的结构表达):每个神经元 cell `c` 的 `endpoint_to_edges[c].len() ≤ 6`(由「每条入边必从 c 的某个邻格进入,邻格 ≤ 6」推出,place_edge 在线格冲突检查时已隐含强制)。

破坏不变量 = bug,而不是合法运行时态。任何"看起来想 dangling"的需求都应该回到宪法 §3 的 conflict surface 流程。

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
    /// 路径中某线格已被其他边占用 (I-2 / 宪法 §2 no-overlap)
    CellOccupied { cell: CellCoord, by: EdgeId },
    /// 路径中某中间 cell 是 Neuron(不能借另一神经元胞体中转)
    PathThroughNeuron(CellCoord),
    /// mod_source 指向的 cell 不是 Modulator 神经元 (I-5)
    ModSourceNotModulator(CellCoord),
    /// 路径不连续(相邻 cell 不是 6-邻居)
    Discontinuous { from: CellCoord, to: CellCoord },
    /// tree 拓扑非法(有环、parent 索引越界等)
    InvalidTreeTopology,
    /// 厚度非正
    InvalidThickness(f32),
}
```

**`PathThroughNeuron` 的来意**:轴突路径中间格只能是 `Empty`(隐式 via,见 §3.4),不能从一个无关神经元的胞体上经过 —— 等价于"另一神经元给你的轴突当中转",违反宪法 §2 "wire is one neuron's private line"。**根 / 叶 cell 必须是 Neuron**(I-1),**线格中间 cell 必须是 Empty**(隐式 via),没有"显式 via"这一形态。

**`PathThroughEmpty` 已删除**(v0.2):穿 `Empty` 现在合法,即"该线格是这条轴突的 via 段"。删边时该格还原 `Empty`,不需要任何 via entity。

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
- 删一个 cell **同时是某条 edge 的 mod_source**(被某条 plastic edge 引用作 modulator)→ **降级**:那条 edge 的 `plastic` 设为 false,`mod_source` 设为 None,边的拓扑不动。理由:mod_source 不是这条边的端点(既非根也非叶),它是第三个神经元负责给学习开关,§3 的级联讲的是"端点死了边跟着死";真正的两端点还活着,连接还在,只丢学习开关。

**端点定位靠 `endpoint_to_edges[coord]`**(v0.2 新增,见 §2.3)。v0.1 用线格反查找受影响边的写法是错的 —— 神经元 cell 不进单值索引,得用多值端点索引。

接口形态:

```rust
impl Routes {
    /// Grid 在 remove_neuron(coord) 时调用,在 Grid 实际清除前。
    /// 返回受影响的 edge 列表(给 undo / UI 报告用)。
    pub fn on_neuron_removed(&mut self, coord: CellCoord) -> NeuronRemovalImpact;
}

pub struct NeuronRemovalImpact {
    pub removed_edges: Vec<(EdgeId, Edge)>,         // 整条删的(被删神经元是 source)
    pub pruned_branches: Vec<(EdgeId, PrunedBranch)>, // 部分剪枝的(被删神经元是某 leaf)
    pub demoted_plastic: Vec<DemoteRecord>,         // mod_source 失效降级的
}

/// undo 用:回插这段被剪的分支需要的全部信息
pub struct PrunedBranch {
    pub fork_attach_cell: CellCoord,   // 剪到的最近 fork 点
    pub branch_cells: Vec<CellCoord>,  // 被剪掉的 cell 序列(从 fork 出发到 leaf)
    pub branch_parent: Vec<Option<u16>>, // 被剪段的 parent(用于回插时重建拓扑)
}

/// undo 用:恢复降级前的 plastic / mod_source 配置
pub struct DemoteRecord {
    pub edge: EdgeId,
    pub was_plastic: bool,
    pub was_mod_source: Option<PathEndpoint>,
}
```

#### 3.2.3 叶剪枝算法:剪到最近 fork

设 leaf cell 在 tree 的节点 index 是 `L`,沿 `parent` 链向上走,直到遇到一个**有 ≥ 2 个 child** 的节点 `F`(fork),把 `F → ... → L` 这一段从 tree 移除。

**特殊情况**:

- 若一路上行到 root 都没遇到 fork(树本就是单端 path) → 整棵删除(等价于 §3.2.1 整边删)。
- 若 fork `F` 只剩两支,剪掉一支后只剩单链 → tree 拓扑上 fork 数变 0,`is_path()` 自动返回 true。**单一扁平表示下无需"塌回"操作**(v0.2:删了两变体表示后,这层归一化负担消失)。
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

**移动神经元(同种,改坐标)**:当前 spec **不暴露该操作**。理由:coord-as-id 的代价是"神经元不可移动",这正是宪法 §3 选 F1 时接受的取舍。玩家有移位需求的话用"删 + 重放" + undo 救场。**review §五 提醒**:若以后挪连着线的神经元变常见,那正是动用 `PathEndpoint` → 显式 NeuronId 那个预留口的信号 —— 现在保持留口,不实现。

**via 走隐式**(v0.2 决定):

宪法 §2 行 26 原话:"A via is a per-edge path segment that crosses layers. There is no `Via` entity"。一个可独立放置的 `CellContents::Via` 恰恰是个 via entity → 与宪法冲突。物理上也没有任何东西对应"可放置的 via":分层网格是编辑用的画法,via 只是某根轴突路径换层那一段的叫法。

**模型**:

- 路径中间 cell 在 Grid 上必须是 `Empty`(I-1 强制),`place_edge` 把这些 `Empty` 线格记进 `cell_to_edge`(占用语义,但不修改 Grid 状态)。
- `remove_edge` / 叶剪枝时,这些线格从 `cell_to_edge` 移除即可,Grid 上仍是 `Empty`(本来就是)。
- 玩家无法"先放 via 占位"—— 放置动作只有"放神经元"和"画边"两种,via 是后者的副产物。
- `cell_to_edge` 占用记录的"虚拟性"恰好对应宪法说的"via 不是 entity":你看不到它,只能通过"这条边经过这里"知道。

**C-1 改动(阻塞)**:删除 `CellContents::Via` 变体,`CellContents` 缩到 `Empty | Neuron(NeuronKind)` 两变体。C-1 计划文档与已落地的 `grid_workshop` crate 都需同步调整。这条作为 C-2 实现计划的 **task 0**(前置改 C-1)。

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

`RoutesPlugin` 必须在 `GridPlugin` 之后注册。两个 resource 由 high-level 的"操作系统"(后续 UI 子系统)同时 mutate;C-2 提供 `EdgeOps` helper 把"删神经元 + 触发 cascade"封装成原子调用,**并把它作为唯一入口**——review §五 #1 的强约束。

```rust
pub struct EdgeOps<'a> {
    grid: &'a mut Grid,
    routes: &'a mut Routes,
}

impl<'a> EdgeOps<'a> {
    pub fn remove_neuron(&mut self, c: CellCoord) -> NeuronRemovalImpact;
    pub fn replace_kind(&mut self, c: CellCoord, k: NeuronKind) -> KindReplaceImpact;
    pub fn place_neuron(&mut self, c: CellCoord, k: NeuronKind) -> Result<(), PlaceError>;
    pub fn place_edge(&mut self, tree: PathTree, d: f32, plastic: bool, mod_src: Option<PathEndpoint>) -> Result<EdgeId, PlaceEdgeError>;
    pub fn remove_edge(&mut self, eid: EdgeId) -> Option<Edge>;
}
```

**结构性强制**(v0.2 新增):

- `Grid` 上修改神经元的方法(`Grid::place_neuron / remove_neuron / replace_kind` 等)改为 **crate-private**(`pub(crate)`),只在 `routes` crate 内可见。
- 公开 API 上,这些操作只能经 `EdgeOps` 调用 —— UI / 其它 system 拿不到直接 mutate `Grid` 神经元的句柄,从结构上禁止"绕过级联"破坏 I-1。
- Grid 上 `Empty` cell 的读和"中间格占用"由 routes 写, Grid 的物理读取(渲染、查询)仍然 `pub`。

这把 review §五 #1 的"必须是唯一入口"做进类型可见性,而不是靠纪律。

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

- `EdgeOps::place_edge` 所有错误分支都有对应的 should_fail 测试。
- **三神经元一条链 S → I → M**(v0.2 review §一 的关键回归用例):验证 I 这个神经元同时作 E1 叶和 E2 根能成立、`endpoint_to_edges[I]` 含两个 EdgeId。
- **一个神经元被 ≥2 条边当目标**(同型 S1→T, S2→T):确认 T 的 `endpoint_to_edges` 含两条边,各自走 T 的不同邻格作末段线格。
- **fan-in 上限测试**:对一个神经元从 7 个不同方向同时入边,第 7 条 place_edge 返回 `CellOccupied`(因第 7 条必复用前 6 条已占的某邻格)。
- 删 source / 删 leaf / 删既源又叶的神经元三种 cascade 路径分别测。
- 叶剪枝后 `is_path()` 返回正确;fork 仅剩一支时拓扑 fork 数变 0。
- mod_source 失效降级 → plastic=false, mod_source=None,拓扑不动;`demoted_plastic` 含正确 `DemoteRecord`。
- `replace_kind` 不动 edge tree,但 `Modulator → 非 Modulator` 触发降级。
- 路径连续性 / 神经元中转 两种非法路径单独测(`PathThroughEmpty` 已删除,不再是错误)。
- **隐式 via 测试**:place_edge 穿一串 `Empty` cell 成功,删除后那些 cell 仍是 `Empty`(未被改写),且不再在 `cell_to_edge` 中。

### 5.2 插件 smoke 测试

App + `GridPlugin + RoutesPlugin` 起来后,API 操作通过 `EdgeOps` 可达;`debug_assertions` 下的 invariant 检查跑一遍不 panic。

### 5.3 不变量 prop test

`proptest` 生成随机操作序列(`EdgeOps::place_neuron / place_edge / remove_neuron / replace_kind / remove_edge`),每步后检查 I-1..I-7。**关键**:生成器要覆盖"一个神经元被多条边端点引用"的情形(v0.1 missing this case 才漏了单值索引 bug),不能只生成线性链。

---

## 6. 已决定的设计点(v0.2 review 后)

**v0.1 的开放问题在 review 中全部定调,这里改成"已决定"清单留给实现计划参考**:

1. **Modulator 失效 → 降级,不级联** ✓
   - `plastic=false, mod_source=None`,拓扑不动。`DemoteRecord` 给 undo 恢复用。
   - **留给 C-4 / 存档**:降级时学到的权重冻结值 vs 弹回 `w_init`?权重持久化归属?C-2 的 `Edge` 故意不存权重,这两件事是求值层的事 —— **明确记到 C-4 的 spec 输入,不许丢**。

2. **Via 走隐式** ✓
   - `CellContents` 缩到 `Empty | Neuron(NeuronKind)`,删 `Via` 变体。
   - C-1 已落地代码同步改 —— C-2 实现计划的 task 0。
   - `PathThroughEmpty` 错误已删,穿 `Empty` 合法,被占线格记入 `cell_to_edge` 但不修改 Grid 状态。删边时记录消失,Grid 仍是 `Empty`。

3. **EdgeId = u32 + 不重用** ✓
   - 对单人沙盒长 session 远不到 u32 上限。
   - 导出/导入的稳定 id 不依赖 EdgeId,而是用**根+叶集合**派生(因为不强制"一神经元一条出边",源坐标本身不唯一标识一条边)。导出 key 形如 `edge:<root_coord>-><sorted_leaf_coords>`,collision 在合法 grid 上不可能(同根同叶集合的两条边必然路径占用冲突)。

4. **撤销栈外置** ✓
   - C-2 不内置 op log;每个 `EdgeOps` mutate 返回的 Impact / Record 已含逆操作所需全部信息(`PrunedBranch.fork_attach_cell + branch_cells + branch_parent`、`DemoteRecord.was_plastic + was_mod_source`)。
   - undo 子系统作为独立 module,**与 C-2 同期但独立追踪**。

5. **分叉 UX 入口推给 UI** ✓
   - `PathTree::graft_branch(attach_at, branch_cells)` 是底层 API,UI 层把"玩家从已有边某 cell 拉一根新分支"翻译成此调用。spec 不预定 UI 流程。

6. **`PathTree` 用单一扁平表示** ✓(v0.2 改,review §五 #2)
   - 不要 enum 两变体。`is_path()` 是查询,不是存储形态。

7. **不强制"一神经元一条出边"** ✓(v0.2,review §五 #4)
   - 现状:同一源神经元可起 N 棵独立 edge(各占不同邻格)。生物上少见但动力学无害。
   - 若将来证明强制更好(主干合并省线、强忠实),改 `EdgeOps::place_edge` 加一行检查即可,低代价。先不加。

8. **删神经元的唯一入口** ✓(v0.2,review §五 #1)
   - Grid 上 neuron mutator 改 `pub(crate)`,与 routes 模块同 crate;公开 API 只有 `EdgeOps`。结构性禁止绕过级联。
   - 这要求 routes 与 grid 数据层在同一 crate(`grid_workshop`),routing 作为子模块挂在 `crates/grid_workshop/src/routing/` 下,而不是单独 crate。**实现计划据此组织文件结构**。

---

## 7. 设计宪法检查

按宪法 §1–§5 的不变量逐条:

1. **§1 空间是真的;布线有代价**:edge 树存的是**实际占用的 cell 序列**,不是抽象图边。√d 物理在 C-4 编译时展开,但 C-2 已经在数据层把"长度"做成树边数 —— 后续延迟 / 衰减 / 体积都从这里派生。
2. **§2 一条线是一个神经元的私线**:no `Via` entity(via 是 edge 路径段,v0.2 起删 `CellContents::Via`)、单值反查只覆盖**线格**且端点用多值索引(v0.2 修正:这才真正实现"线不挤同格"而非误伤"一神经元被多线碰")、tree 形状结构性禁止 join、~6 fan-in 是有意约束(宪法 §2 honest simplification,玩家高 fan-in 时用中继神经元搭漏斗)。
3. **§3 连接与端点共生死**:F4 推广 tree、I2 级联(source 整删 / leaf 剪枝)、`PathEndpoint` newtype 包 coord-as-id、`replace_kind` 高频操作、undo P0 列入 §6 —— 全员对齐。
4. **§4 信号分级衰减,学习局部**:`Edge::thickness_d` + `plastic` + `mod_source` 三字段就位;实际数值与 √d 物理留给 C-4。这里只保字段。
5. **§5 意义没有标签**:所有错误类型用物理描述(`PathThroughNeuron`、`ModSourceNotModulator`)而非语义("AvoidanceCircuitBroken")。

---

## 8. 下一步

本文档定义"做什么"。下一步是 `writing-plans` 阶段,产出"怎么做" —— 详细实现计划,task-by-task 落到 `D:/dev/umwelt-bevy/crates/grid_workshop/src/routing/*` 或新建 crate(待 plan 阶段决定)。

实现计划必须与 §1 的"显式不在 C-2 作用域"严格对齐:不写 cost、不写横截面、不写 HTML 编译、不写鼠标 UI。
