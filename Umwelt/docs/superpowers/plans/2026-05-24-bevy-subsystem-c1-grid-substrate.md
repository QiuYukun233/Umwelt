# Bevy 子系统 C-1 — 网格基质运行时 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `umwelt-bevy/` 工作区新增 `grid_workshop` crate,实现 spec v2 §2 的网格基质数据层 —— 堆叠的 2D 层、稀疏存储的格子、§3 的 5 种神经元 + via 两种格子内容物;Bevy 插件 + 极简 3D 渲染让"摆放了东西"可视化。不含布线、不含交互式 UI、不含成本读出(都在 C-2/C-3)。

**Architecture:**
- crate `grid_workshop/`,与 `chem_field/` 并列在 `umwelt-bevy/crates/` 下。
- `core/` 纯 Rust 数据模型:`CellCoord{layer:i32, x:i32, y:i32}`、`NeuronKind`(5 变体)、`CellContents{Empty|Neuron(NeuronKind)|Via}`、`Grid`(`HashMap<CellCoord, CellContents>` 稀疏存储)、`PlaceError`(occupied/out-of-bounds)。
- 坐标系约定固定一次:cell.x→world.x、cell.y→world.z、cell.layer→world.y(层垂直堆叠,匹配 §2"自上而下逐层写")。
- `bevy_plugin/`:`GridPlugin` 把 `Grid` 暴露为 Resource,`render` 系统每帧根据 grid 状态 spawn/update 彩色立方体 entity;层平面用半透明 quad 标识 stratification。
- `examples/`:程序化搭一个 3 层小场景,目视验证。

**Tech Stack:** Rust 2024、Bevy 0.15.3、glam(workspace 已有)、approx(dev)。

---

## File Structure

`D:/dev/umwelt-bevy/crates/grid_workshop/`:
```
Cargo.toml
src/
├─ lib.rs                       # 模块声明 + re-export
├─ core/
│  ├─ mod.rs
│  ├─ coord.rs                  # CellCoord + 常量 (CELL_PITCH/LAYER_PITCH) + world_pos 映射
│  ├─ kind.rs                   # NeuronKind, CellContents
│  └─ grid.rs                   # Grid struct + place/remove/get + PlaceError
├─ plugin.rs                    # GridPlugin + GridRes resource
├─ render.rs                    # cube-per-cell + layer-plane systems
└─ debug.rs                     # placeholder for C-3 cross-section; empty for now
tests/
└─ grid_smoke.rs                # plugin smoke (place via API, query via resource)
examples/
└─ three_layer_demo.rs
```

Workspace 改动:
- Modify: `D:/dev/umwelt-bevy/Cargo.toml`(添加 `crates/grid_workshop` 到 members 自动通过 `crates/*` 通配,不用改;再加一个 workspace dep `bevy_egui` 不需要 —— 渲染纯 mesh)。

---

## Task 1: 新建 grid_workshop crate 骨架

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/Cargo.toml`
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/lib.rs`
- Create: `src/core/mod.rs`, `src/core/{coord,kind,grid}.rs`, `src/plugin.rs`, `src/render.rs`, `src/debug.rs`(全是 `// placeholder` 单行注释)

- [ ] **Step 1: 建目录与文件**

```powershell
cd D:/dev/umwelt-bevy
mkdir crates/grid_workshop
cd crates/grid_workshop
mkdir src
mkdir src/core
```

`crates/grid_workshop/Cargo.toml`:
```toml
[package]
name = "grid_workshop"
edition.workspace = true
version.workspace = true
license.workspace = true

[dependencies]
bevy = { workspace = true }
glam = { workspace = true }

[dev-dependencies]
approx = "0.5"
```

- [ ] **Step 2: 写最小 lib.rs**

`src/lib.rs`:
```rust
pub mod core;
pub mod plugin;
pub mod render;
pub mod debug;
```

`src/core/mod.rs`:
```rust
pub mod coord;
pub mod kind;
pub mod grid;
```

剩下 6 个文件(`coord.rs`、`kind.rs`、`grid.rs`、`plugin.rs`、`render.rs`、`debug.rs`)各写 `// placeholder`。

- [ ] **Step 3: cargo check**

Run: `cargo check -p grid_workshop`(从 `D:/dev/umwelt-bevy/`)
Expected: 编译通过,无错误。

- [ ] **Step 4: Commit**

```powershell
cd D:/dev/umwelt-bevy
git add crates/grid_workshop
git commit -m "chore(grid_workshop): bootstrap crate skeleton"
```

---

## Task 2: CellCoord + 世界坐标映射

**File:** `src/core/coord.rs`

数据契约:`CellCoord{layer:i32, x:i32, y:i32}`。世界坐标映射 `to_world(cell) -> Vec3` 按常量 `CELL_PITCH=1.0`、`LAYER_PITCH=2.0`(层间距比格距大,视觉上 stratification 明显)。映射:cell.x→world.x、cell.layer→world.y、cell.y→world.z。

- [ ] **Step 1: 失败测试**

`src/core/coord.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use glam::Vec3;

    #[test]
    fn origin_cell_maps_to_origin() {
        let c = CellCoord { layer: 0, x: 0, y: 0 };
        let w = c.to_world();
        assert_relative_eq!(w.x, 0.0);
        assert_relative_eq!(w.y, 0.0);
        assert_relative_eq!(w.z, 0.0);
    }

    #[test]
    fn x_axis_maps_via_cell_pitch() {
        let c = CellCoord { layer: 0, x: 3, y: 0 };
        assert_relative_eq!(c.to_world().x, 3.0 * CELL_PITCH);
    }

    #[test]
    fn y_axis_maps_to_world_z_via_cell_pitch() {
        let c = CellCoord { layer: 0, x: 0, y: 4 };
        assert_relative_eq!(c.to_world().z, 4.0 * CELL_PITCH);
    }

    #[test]
    fn layer_maps_to_world_y_via_layer_pitch() {
        let c = CellCoord { layer: 2, x: 0, y: 0 };
        assert_relative_eq!(c.to_world().y, 2.0 * LAYER_PITCH);
    }

    #[test]
    fn negative_coords_work() {
        let c = CellCoord { layer: -1, x: -2, y: -3 };
        let w = c.to_world();
        assert_relative_eq!(w.x, -2.0 * CELL_PITCH);
        assert_relative_eq!(w.y, -1.0 * LAYER_PITCH);
        assert_relative_eq!(w.z, -3.0 * CELL_PITCH);
    }

    #[test]
    fn coord_is_hashable() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        set.insert(CellCoord { layer: 0, x: 0, y: 0 });
        set.insert(CellCoord { layer: 0, x: 0, y: 0 });
        assert_eq!(set.len(), 1);
    }
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cargo test -p grid_workshop coord`
Expected: FAIL — `CellCoord`、常量未定义。

- [ ] **Step 3: 实现**

替换 `src/core/coord.rs`:
```rust
use glam::Vec3;

pub const CELL_PITCH: f32 = 1.0;
pub const LAYER_PITCH: f32 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CellCoord {
    pub layer: i32,
    pub x: i32,
    pub y: i32,
}

impl CellCoord {
    pub fn new(layer: i32, x: i32, y: i32) -> Self {
        Self { layer, x, y }
    }

    pub fn to_world(self) -> Vec3 {
        Vec3::new(
            self.x as f32 * CELL_PITCH,
            self.layer as f32 * LAYER_PITCH,
            self.y as f32 * CELL_PITCH,
        )
    }
}
```

- [ ] **Step 4: 测试通过**

Run: `cargo test -p grid_workshop coord`
Expected: PASS(6 tests)。

- [ ] **Step 5: Commit**

```powershell
git add crates/grid_workshop/src/core/coord.rs
git commit -m "feat(grid_workshop): CellCoord + world-space mapping"
```

---

## Task 3: NeuronKind + CellContents

**File:** `src/core/kind.rs`

5 种神经元(§3 不新增):sensor_on、inter_exc、inter_inh、modulator、motor。格子内容物三态:空、神经元、via。

- [ ] **Step 1: 失败测试**

`src/core/kind.rs`:
```rust
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
    fn cell_contents_via_distinguishable() {
        assert_ne!(CellContents::Via, CellContents::Empty);
        assert_ne!(CellContents::Via, CellContents::Neuron(NeuronKind::Motor));
    }

    #[test]
    fn is_occupied_distinguishes_empty_from_filled() {
        assert!(!CellContents::Empty.is_occupied());
        assert!(CellContents::Via.is_occupied());
        assert!(CellContents::Neuron(NeuronKind::SensorOn).is_occupied());
    }
}
```

- [ ] **Step 2: cargo test -p grid_workshop kind** — FAIL.

- [ ] **Step 3: 实现**

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
    Via,
}

impl CellContents {
    pub fn is_occupied(self) -> bool {
        !matches!(self, CellContents::Empty)
    }
}
```

- [ ] **Step 4: PASS(5 tests)。**

- [ ] **Step 5: Commit**

```powershell
git add crates/grid_workshop/src/core/kind.rs
git commit -m "feat(grid_workshop): NeuronKind + CellContents"
```

---

## Task 4: Grid 稀疏存储 + place/remove/get + PlaceError

**File:** `src/core/grid.rs`

`Grid` 用 `HashMap<CellCoord, CellContents>` 稀疏存储 —— 只存非空格子。`place` 在已占用格子上返回 `Err(PlaceError::Occupied)`;`remove` 在空格上 idempotent(返回 `Ok(None)`)。

- [ ] **Step 1: 失败测试**

`src/core/grid.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::coord::CellCoord;
    use crate::core::kind::{CellContents, NeuronKind};

    fn c(layer: i32, x: i32, y: i32) -> CellCoord { CellCoord::new(layer, x, y) }

    #[test]
    fn empty_grid_get_returns_empty() {
        let g = Grid::new();
        assert_eq!(g.get(c(0, 0, 0)), CellContents::Empty);
    }

    #[test]
    fn place_neuron_then_get_returns_neuron() {
        let mut g = Grid::new();
        g.place(c(0, 1, 2), CellContents::Neuron(NeuronKind::Motor)).unwrap();
        assert_eq!(g.get(c(0, 1, 2)), CellContents::Neuron(NeuronKind::Motor));
    }

    #[test]
    fn place_on_occupied_cell_returns_error() {
        let mut g = Grid::new();
        g.place(c(0, 0, 0), CellContents::Via).unwrap();
        let err = g.place(c(0, 0, 0), CellContents::Neuron(NeuronKind::Modulator));
        assert!(matches!(err, Err(PlaceError::Occupied)));
    }

    #[test]
    fn place_empty_is_rejected() {
        let mut g = Grid::new();
        let err = g.place(c(0, 0, 0), CellContents::Empty);
        assert!(matches!(err, Err(PlaceError::EmptyContents)));
    }

    #[test]
    fn remove_existing_returns_old_contents() {
        let mut g = Grid::new();
        g.place(c(0, 0, 0), CellContents::Via).unwrap();
        let removed = g.remove(c(0, 0, 0));
        assert_eq!(removed, Some(CellContents::Via));
        assert_eq!(g.get(c(0, 0, 0)), CellContents::Empty);
    }

    #[test]
    fn remove_empty_returns_none() {
        let mut g = Grid::new();
        assert_eq!(g.remove(c(0, 0, 0)), None);
    }

    #[test]
    fn occupied_cells_iter_lists_all_placed() {
        let mut g = Grid::new();
        g.place(c(0, 0, 0), CellContents::Via).unwrap();
        g.place(c(1, 2, 3), CellContents::Neuron(NeuronKind::Motor)).unwrap();
        let mut got: Vec<_> = g.occupied_cells().collect();
        got.sort_by_key(|(coord, _)| (coord.layer, coord.x, coord.y));
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].0, c(0, 0, 0));
        assert_eq!(got[0].1, CellContents::Via);
        assert_eq!(got[1].0, c(1, 2, 3));
        assert_eq!(got[1].1, CellContents::Neuron(NeuronKind::Motor));
    }

    #[test]
    fn len_counts_only_occupied() {
        let mut g = Grid::new();
        assert_eq!(g.len(), 0);
        g.place(c(0, 0, 0), CellContents::Via).unwrap();
        assert_eq!(g.len(), 1);
        g.remove(c(0, 0, 0));
        assert_eq!(g.len(), 0);
    }
}
```

- [ ] **Step 2: cargo test -p grid_workshop grid** — FAIL.

- [ ] **Step 3: 实现**

```rust
use crate::core::coord::CellCoord;
use crate::core::kind::CellContents;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlaceError {
    Occupied,
    EmptyContents,
}

#[derive(Debug, Default)]
pub struct Grid {
    cells: HashMap<CellCoord, CellContents>,
}

impl Grid {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, coord: CellCoord) -> CellContents {
        self.cells.get(&coord).copied().unwrap_or(CellContents::Empty)
    }

    pub fn place(&mut self, coord: CellCoord, contents: CellContents) -> Result<(), PlaceError> {
        if contents == CellContents::Empty {
            return Err(PlaceError::EmptyContents);
        }
        if self.cells.contains_key(&coord) {
            return Err(PlaceError::Occupied);
        }
        self.cells.insert(coord, contents);
        Ok(())
    }

    pub fn remove(&mut self, coord: CellCoord) -> Option<CellContents> {
        self.cells.remove(&coord)
    }

    pub fn occupied_cells(&self) -> impl Iterator<Item = (CellCoord, CellContents)> + '_ {
        self.cells.iter().map(|(c, k)| (*c, *k))
    }

    pub fn len(&self) -> usize {
        self.cells.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }
}
```

- [ ] **Step 4: PASS(8 tests)。**

- [ ] **Step 5: Commit**

```powershell
git add crates/grid_workshop/src/core/grid.rs
git commit -m "feat(grid_workshop): sparse Grid with place/remove/iter"
```

---

## Task 5: Bevy plugin + GridRes resource + plugin smoke test

**Files:**
- `src/plugin.rs`
- `src/lib.rs`(加 re-export)
- `tests/grid_smoke.rs`(新建)

- [ ] **Step 1: 写 plugin**

`src/plugin.rs`:
```rust
use crate::core::grid::Grid;
use bevy::prelude::*;

#[derive(Resource, Default, Deref, DerefMut)]
pub struct GridRes(pub Grid);

pub struct GridPlugin;

impl Plugin for GridPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<GridRes>();
    }
}
```

更新 `src/lib.rs`:
```rust
pub mod core;
pub mod plugin;
pub mod render;
pub mod debug;

pub use core::coord::{CellCoord, CELL_PITCH, LAYER_PITCH};
pub use core::grid::{Grid, PlaceError};
pub use core::kind::{CellContents, NeuronKind};
pub use plugin::{GridPlugin, GridRes};
```

- [ ] **Step 2: 写 smoke 测试**

`tests/grid_smoke.rs`:
```rust
use bevy::prelude::*;
use grid_workshop::{CellContents, CellCoord, GridPlugin, GridRes, NeuronKind};

#[test]
fn plugin_initializes_empty_grid_resource() {
    let mut app = App::new();
    app.add_plugins(GridPlugin);
    app.update();
    let grid = &app.world().resource::<GridRes>().0;
    assert_eq!(grid.len(), 0);
}

#[test]
fn plugin_lets_callers_place_via_resource_mut() {
    let mut app = App::new();
    app.add_plugins(GridPlugin);
    {
        let mut grid = app.world_mut().resource_mut::<GridRes>();
        grid.0
            .place(CellCoord::new(0, 0, 0), CellContents::Neuron(NeuronKind::Motor))
            .unwrap();
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

- [ ] **Step 3: cargo test -p grid_workshop --test grid_smoke**

Expected: PASS(2 tests)。

- [ ] **Step 4: Commit**

```powershell
git add crates/grid_workshop/src/plugin.rs crates/grid_workshop/src/lib.rs crates/grid_workshop/tests/grid_smoke.rs
git commit -m "feat(grid_workshop): GridPlugin + GridRes resource"
```

---

## Task 6: Cube renderer — 每个 cell 一个彩色立方体 entity

**File:** `src/render.rs`

每帧扫描 `GridRes`,根据当前格子内容物 spawn / despawn / update 一个彩色 cube entity。颜色映射:
- SensorOn:浅绿
- InterExc:橙
- InterInh:蓝
- Modulator:紫
- Motor:红
- Via:灰白

实现策略(简洁起见):用一个 `HashMap<CellCoord, Entity>` 资源跟踪已 spawn 的 entity。每帧 diff:grid 里有但 map 里没有的 → spawn;map 里有但 grid 里没了的 → despawn;两边都有的 → 不动(static cells)。

- [ ] **Step 1: 写 render 模块**

`src/render.rs`:
```rust
use crate::core::coord::CellCoord;
use crate::core::kind::{CellContents, NeuronKind};
use crate::plugin::GridRes;
use bevy::prelude::*;
use std::collections::HashMap;

#[derive(Resource, Default)]
pub struct CellEntities(pub HashMap<CellCoord, Entity>);

pub struct GridRenderPlugin;

impl Plugin for GridRenderPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<CellEntities>()
            .add_systems(Update, sync_cell_entities);
    }
}

fn color_for(contents: CellContents) -> Color {
    match contents {
        CellContents::Empty => Color::NONE,
        CellContents::Via => Color::srgb(0.85, 0.85, 0.85),
        CellContents::Neuron(NeuronKind::SensorOn) => Color::srgb(0.55, 0.85, 0.45),
        CellContents::Neuron(NeuronKind::InterExc) => Color::srgb(0.95, 0.65, 0.25),
        CellContents::Neuron(NeuronKind::InterInh) => Color::srgb(0.30, 0.55, 0.90),
        CellContents::Neuron(NeuronKind::Modulator) => Color::srgb(0.70, 0.40, 0.85),
        CellContents::Neuron(NeuronKind::Motor) => Color::srgb(0.85, 0.30, 0.30),
    }
}

fn sync_cell_entities(
    mut commands: Commands,
    grid: Res<GridRes>,
    mut tracked: ResMut<CellEntities>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    use std::collections::HashSet;

    let grid_coords: HashSet<CellCoord> =
        grid.0.occupied_cells().map(|(c, _)| c).collect();

    // Despawn entities for removed cells
    let removed: Vec<CellCoord> = tracked
        .0
        .keys()
        .filter(|c| !grid_coords.contains(c))
        .copied()
        .collect();
    for coord in removed {
        if let Some(entity) = tracked.0.remove(&coord) {
            commands.entity(entity).despawn();
        }
    }

    // Spawn entities for new cells
    for (coord, contents) in grid.0.occupied_cells() {
        if tracked.0.contains_key(&coord) {
            continue;
        }
        let mesh = meshes.add(Cuboid::new(0.85, 0.85, 0.85));
        let material = materials.add(StandardMaterial {
            base_color: color_for(contents),
            ..default()
        });
        let entity = commands
            .spawn((
                Mesh3d(mesh),
                MeshMaterial3d(material),
                Transform::from_translation(coord.to_world()),
            ))
            .id();
        tracked.0.insert(coord, entity);
    }
}
```

- [ ] **Step 2: cargo check**

Run: `cargo check -p grid_workshop`
Expected: 无错误。若 Bevy 0.15.3 `Cuboid`/`Mesh3d`/`MeshMaterial3d`/`commands.entity().despawn()` API 与上面不一致,按 0.15.3 文档调整(report 改了什么)。

- [ ] **Step 3: Commit**

```powershell
git add crates/grid_workshop/src/render.rs
git commit -m "feat(grid_workshop): GridRenderPlugin syncing cube entities to grid state"
```

---

## Task 7: 层平面可视化(半透明 quad 标识 stratification)

**File:** `src/render.rs`(在 Task 6 之上扩展)

为每个有 cell 的 layer 画一块半透明 quad,让玩家直观看到 stratification。quad 范围由 layer 内 cell 的 bounding box 决定;为简洁实现 v1,固定为以 cell 重心为中心、±5 cells 的 quad(即 10×10 area)。

- [ ] **Step 1: 扩展 render 模块**

在 `src/render.rs` 顶部加 `LayerPlaneEntities` tracker,并加新 system:

```rust
#[derive(Resource, Default)]
pub struct LayerPlaneEntities(pub HashMap<i32, Entity>);
```

在 `GridRenderPlugin::build` 里 `.init_resource::<LayerPlaneEntities>()` 并 `.add_systems(Update, sync_layer_planes)`。

加 system:
```rust
fn sync_layer_planes(
    mut commands: Commands,
    grid: Res<GridRes>,
    mut tracked: ResMut<LayerPlaneEntities>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    use std::collections::HashSet;
    use crate::core::coord::{CELL_PITCH, LAYER_PITCH};

    let active_layers: HashSet<i32> =
        grid.0.occupied_cells().map(|(c, _)| c.layer).collect();

    // Despawn planes for layers with no cells
    let removed: Vec<i32> = tracked
        .0
        .keys()
        .filter(|l| !active_layers.contains(l))
        .copied()
        .collect();
    for layer in removed {
        if let Some(entity) = tracked.0.remove(&layer) {
            commands.entity(entity).despawn();
        }
    }

    // Spawn planes for new layers
    for layer in active_layers {
        if tracked.0.contains_key(&layer) {
            continue;
        }
        let mesh = meshes.add(Plane3d::default().mesh().size(10.0 * CELL_PITCH, 10.0 * CELL_PITCH));
        let material = materials.add(StandardMaterial {
            base_color: Color::srgba(0.4, 0.4, 0.45, 0.18),
            alpha_mode: AlphaMode::Blend,
            ..default()
        });
        let entity = commands
            .spawn((
                Mesh3d(mesh),
                MeshMaterial3d(material),
                Transform::from_translation(Vec3::new(
                    0.0,
                    layer as f32 * LAYER_PITCH - 0.45,
                    0.0,
                )),
            ))
            .id();
        tracked.0.insert(layer, entity);
    }
}
```

(plane 略低于 cell 中心位置 0.45,这样 cube 浮在 plane 上方,视觉更清晰。)

- [ ] **Step 2: cargo check**

Run: `cargo check -p grid_workshop`
Expected: 无错误。若 `Plane3d::default().mesh().size(w,h)` API 在 0.15.3 不可用,改用 `Rectangle::new(w, h).mesh()` 或就用 `Cuboid::new(10, 0.02, 10)` 当薄板。报告所改之处。

- [ ] **Step 3: Commit**

```powershell
git add crates/grid_workshop/src/render.rs
git commit -m "feat(grid_workshop): translucent layer planes"
```

---

## Task 8: Example — 三层程序化场景 + 相机 + 光

**File:** `crates/grid_workshop/examples/three_layer_demo.rs`

目视验证:跑起来应看到三层半透明平面、上面散落多种颜色的立方体,层间垂直分开。

- [ ] **Step 1: 写 example**

```rust
use bevy::prelude::*;
use grid_workshop::{
    CellContents, CellCoord, GridPlugin, GridRes, NeuronKind,
};
use grid_workshop::render::GridRenderPlugin;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins((GridPlugin, GridRenderPlugin))
        .add_systems(Startup, (populate_grid, spawn_camera_and_light))
        .run();
}

fn populate_grid(mut grid: ResMut<GridRes>) {
    // Layer 0: a few sensors and inter-excitatory
    grid.0.place(CellCoord::new(0, -2, 0), CellContents::Neuron(NeuronKind::SensorOn)).unwrap();
    grid.0.place(CellCoord::new(0,  2, 0), CellContents::Neuron(NeuronKind::SensorOn)).unwrap();
    grid.0.place(CellCoord::new(0,  0, 1), CellContents::Neuron(NeuronKind::InterExc)).unwrap();

    // Layer 1: inhibitory + modulator, with via from below
    grid.0.place(CellCoord::new(1,  0, 1), CellContents::Via).unwrap();
    grid.0.place(CellCoord::new(1, -1, 2), CellContents::Neuron(NeuronKind::InterInh)).unwrap();
    grid.0.place(CellCoord::new(1,  1, 2), CellContents::Neuron(NeuronKind::Modulator)).unwrap();

    // Layer 2: motor output
    grid.0.place(CellCoord::new(2,  0, 2), CellContents::Neuron(NeuronKind::Motor)).unwrap();
}

fn spawn_camera_and_light(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(7.0, 7.0, 7.0).looking_at(Vec3::new(0.0, 2.0, 1.0), Vec3::Y),
    ));
    commands.spawn((
        PointLight {
            intensity: 8000.0,
            shadows_enabled: false,
            ..default()
        },
        Transform::from_xyz(5.0, 10.0, 5.0),
    ));
    commands.spawn((
        DirectionalLight {
            illuminance: 6000.0,
            shadows_enabled: false,
            ..default()
        },
        Transform::from_xyz(0.0, 10.0, 0.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}
```

- [ ] **Step 2: cargo build --example three_layer_demo**

Run: `cargo build --example three_layer_demo -p grid_workshop`
Expected: 编译通过。若 `PointLight`/`DirectionalLight` 0.15.3 API 不同,调整。

- [ ] **Step 3: cargo run --example three_layer_demo**(目视验证)

Run: `cargo run --example three_layer_demo -p grid_workshop`
Expected:
- 看到 3 个半透明灰色平面,垂直堆叠间距 2 单位。
- 每个平面上分布多个彩色立方体:Layer 0 有 2 个绿色 + 1 个橙色;Layer 1 有 1 个灰白 via + 1 个蓝色 + 1 个紫色;Layer 2 有 1 个红色 motor。
- 相机看下去能看清三层 stratification。

如目视不符预期(比如平面看不到、cubes 飞到错位置),修复后重跑。

- [ ] **Step 4: Commit**

```powershell
git add crates/grid_workshop/examples/three_layer_demo.rs
git commit -m "feat(grid_workshop): three_layer_demo example for visual verification"
```

---

## Self-Review 小记

- **Spec 覆盖**:
  - §2 网格基质 + 堆叠 2D 层 + via 跨层原语 → Task 2 + 3 + 4 + 7。**横截面读取**留给 C-3(`src/debug.rs` 占位)。
  - §3 5 种节点类型 → Task 3 完整。**布线、可塑性标记**留 C-2。
  - §4 物理约束 → 不在 C-1 范围(成本读出与计算在 C-3,§7 编译在 C-4)。
  - §6 MVP scope 中"网格放置神经元 / via"那一行 → C-1 完整覆盖;"逐格曼哈顿布线、via、轴突粗细、可塑性指定、横截面、相机控制"在 C-2/C-3。
- **占位扫描**:`src/debug.rs` 仅作 C-3 的预声明占位,空 placeholder。无 TBD / 待补 / "类似前任务"。
- **类型一致性**:`CellCoord`、`NeuronKind`、`CellContents`、`Grid`、`PlaceError`、`GridRes`、`GridPlugin`、`GridRenderPlugin`、`CellEntities`、`LayerPlaneEntities` 在所有任务里拼写、字段、方法签名一致。`coord.to_world()` 一处定义,渲染处复用。
- **风险**:Bevy 0.15.3 渲染 API(Mesh3d / Cuboid / Plane3d / PointLight)版本敏感,实现期按文档微调;不动数据层语义。
