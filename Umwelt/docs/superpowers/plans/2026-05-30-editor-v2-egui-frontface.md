# Editor v2 — egui front-face Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the keyboard-modal + console editor front-end with a mouse-driven egui dev tool over the existing engine: multi-layer wireframe lattice, wires on struts, activation-as-fill, and a full panel set (tools, type palette, inspector, cost, playback, edit/view).

**Architecture:** Front-face swap only. The engine — `route_same_layer`, `EdgeOps`, `EvalTopology::compile`, `step_eval`, picking math — is untouched. The only backend additions are two thin clamped edge setters (`Routes::set_edge_weight` / `set_edge_thickness`). All UI lives in `examples/eval_viewer.rs`: `bevy_egui` panels overlay a 3D scene drawn with Bevy gizmos + per-neuron fill cubes.

**Tech Stack:** Rust 2024, Bevy 0.15.3 (`default-features=false`), `bevy_egui 0.31` (dev-dependency, gate passed), Bevy gizmos.

**Spec:** `docs/superpowers/specs/2026-05-30-editor-v2-egui-frontface-design.md`

**Coordinate facts (from `core/coord.rs`):** `CELL_PITCH=1.0`, `LAYER_PITCH=2.0`. `CellCoord{layer,x,y}.to_world() = (x, layer*2, y)`. Min-corner of a cell (for strut rendering) = `to_world() - Vec3(0.5, 1.0, 0.5)`.

---

## File Structure

- `crates/grid_workshop/src/routing/edge.rs` — add `SetEdgeParamError` enum (Task 1).
- `crates/grid_workshop/src/routing/routes.rs` — add `set_edge_weight` / `set_edge_thickness` + tests (Task 1).
- `crates/grid_workshop/Cargo.toml` — `bevy_egui = "0.31"` dev-dep (already added during gate; committed in Task 2).
- `crates/grid_workshop/examples/eval_viewer.rs` — the reworked editor (Tasks 2–7).
- `CLAUDE.md` — reserved-concept note (Task 8).

The editor stays a single example file; each task adds one capability and leaves it runnable.

---

## Task 1: Edge param setters (backend, TDD)

**Files:**
- Modify: `crates/grid_workshop/src/routing/edge.rs`
- Modify: `crates/grid_workshop/src/routing/routes.rs`

- [ ] **Step 1: Add the error enum**

In `edge.rs`, after the `PlaceEdgeError` enum, add:

```rust
/// Error for in-place edits of an existing edge's authored scalar params
/// (UI inspector setters). Mirrors the relevant `PlaceEdgeError` checks.
#[derive(Debug, Clone, PartialEq)]
pub enum SetEdgeParamError {
    /// No edge with this id (e.g. selection went stale).
    EdgeNotFound(EdgeId),
    /// thickness 非正 / 非有限
    InvalidThickness(f32),
    /// weight 超出 plastic-aware 区间;NaN/inf 也走这里
    WeightOutOfRange { weight: f32, plastic: bool },
}
```

- [ ] **Step 2: Write the failing tests**

In `routes.rs` `mod tests`, add:

```rust
    #[test]
    fn set_edge_weight_in_range_mutates() {
        use crate::routing::edge::SetEdgeParamError;
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::InterExc),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let eid = r.place_edge(&grid, tree, 1.0, 1.0, false, None).unwrap();
        assert_eq!(r.set_edge_weight(eid, 0.4), Ok(()));
        assert_eq!(r.get(eid).unwrap().weight, 0.4);
        // out of fixed range rejected, value unchanged
        assert!(matches!(
            r.set_edge_weight(eid, 0.05),
            Err(SetEdgeParamError::WeightOutOfRange { plastic: false, .. })
        ));
        assert_eq!(r.get(eid).unwrap().weight, 0.4);
        // NaN rejected (accept-if-in-range)
        assert!(matches!(
            r.set_edge_weight(eid, f32::NAN),
            Err(SetEdgeParamError::WeightOutOfRange { .. })
        ));
        // missing edge
        assert!(matches!(
            r.set_edge_weight(EdgeId(999), 0.5),
            Err(SetEdgeParamError::EdgeNotFound(_))
        ));
    }

    #[test]
    fn set_edge_thickness_validates() {
        use crate::routing::edge::SetEdgeParamError;
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::InterExc),
        ]);
        let tree = PathTree::from_path(vec![c(0, 0, 0), c(0, 1, 0), c(0, 2, 0)]).unwrap();
        let mut r = Routes::new();
        let eid = r.place_edge(&grid, tree, 1.0, 1.0, false, None).unwrap();
        assert_eq!(r.set_edge_thickness(eid, 2.5), Ok(()));
        assert_eq!(r.get(eid).unwrap().thickness_d, 2.5);
        assert!(matches!(
            r.set_edge_thickness(eid, 0.0),
            Err(SetEdgeParamError::InvalidThickness(_))
        ));
        assert!(matches!(
            r.set_edge_thickness(eid, f32::INFINITY),
            Err(SetEdgeParamError::InvalidThickness(_))
        ));
        assert_eq!(r.get(eid).unwrap().thickness_d, 2.5); // unchanged
    }
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p grid_workshop set_edge_ 2>&1 | tail -20`
Expected: FAIL — `set_edge_weight` / `set_edge_thickness` not found.

- [ ] **Step 4: Implement the setters**

In `routes.rs`, add to `impl Routes` (after `edges_at_endpoint`), and update the `use` of edge errors to include `SetEdgeParamError`:

```rust
    /// UI inspector: edit an edge's synaptic weight in place. Plastic-aware
    /// range, mirroring `place_edge` (fixed [0.1,1.0] / plastic [0,1]; NaN/inf
    /// rejected via accept-if-in-range). weight is not indexed — touches only
    /// the edge record; no grid, no reindex.
    pub fn set_edge_weight(&mut self, eid: EdgeId, weight: f32) -> Result<(), SetEdgeParamError> {
        let edge = self
            .edges
            .get_mut(&eid)
            .ok_or(SetEdgeParamError::EdgeNotFound(eid))?;
        let plastic = edge.plastic;
        let (w_lo, w_hi) = if plastic {
            (0.0, EDGE_WEIGHT_MAX)
        } else {
            (EDGE_WEIGHT_MIN, EDGE_WEIGHT_MAX)
        };
        if !(weight >= w_lo && weight <= w_hi) {
            return Err(SetEdgeParamError::WeightOutOfRange { weight, plastic });
        }
        edge.weight = weight;
        Ok(())
    }

    /// UI inspector: edit an edge's thickness `d` in place. Mirrors
    /// `place_edge`'s positivity/finiteness check. thickness is not indexed.
    pub fn set_edge_thickness(&mut self, eid: EdgeId, d: f32) -> Result<(), SetEdgeParamError> {
        let edge = self
            .edges
            .get_mut(&eid)
            .ok_or(SetEdgeParamError::EdgeNotFound(eid))?;
        if !d.is_finite() || d <= 0.0 {
            return Err(SetEdgeParamError::InvalidThickness(d));
        }
        edge.thickness_d = d;
        Ok(())
    }
```

Update the top-of-file import:

```rust
use crate::routing::edge::{
    DemoteRecord, Edge, KindReplaceImpact, NeuronRemovalImpact, PlaceEdgeError, PrunedBranch,
    SetEdgeParamError,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p grid_workshop set_edge_ 2>&1 | tail -20`
Expected: PASS (2 tests).

- [ ] **Step 6: Full lib test + clippy**

Run: `cargo test -p grid_workshop --lib 2>&1 | tail -5 && cargo clippy -p grid_workshop --lib 2>&1 | tail -5`
Expected: all green, no clippy warnings.

- [ ] **Step 7: Commit**

```bash
git -C D:/dev/umwelt-bevy add crates/grid_workshop/src/routing/edge.rs crates/grid_workshop/src/routing/routes.rs
git -C D:/dev/umwelt-bevy commit -m "feat(routes): thin clamped edge param setters (d/weight) for inspector"
```

---

## Task 2: egui integration + top bar (cost / tick / playback / edit-view)

Adds `bevy_egui`, a top egui panel with the cost readout (off console), tick, Play/Pause/Step/Reset buttons, and an Edit/View toggle. Existing 3D rendering and keyboard accelerators stay this task.

**Files:**
- Modify: `crates/grid_workshop/Cargo.toml` (dev-dep already present from gate)
- Modify: `crates/grid_workshop/examples/eval_viewer.rs`

- [ ] **Step 1: Confirm the dev-dependency is present**

Run: `cargo tree -p grid_workshop -i bevy_egui 2>&1 | head -3`
Expected: shows `bevy_egui v0.31.x`. If absent, run `cargo add bevy_egui@0.31 --dev -p grid_workshop`.

- [ ] **Step 2: Add the plugin and a cost-readout resource**

In `eval_viewer.rs`, add imports near the top:

```rust
use bevy_egui::{egui, EguiContexts, EguiPlugin};
use grid_workshop::OrganStatic; // organ_static return type; see grid_workshop re-exports
```

(If `OrganStatic` is not re-exported at the crate root, import it from its module — check `grid_workshop::routing` or wherever `organ_static` returns it; adjust the path so it compiles.)

Add a resource to hold the latest cost, recomputed on edits:

```rust
#[derive(Resource, Default)]
struct CostReadout {
    volume_um3: f32,
    membrane_um2: f32,
    static_pj_s: f32,
}
```

- [ ] **Step 3: Register plugin, resource, and the egui system**

Edit the `main()` app builder:

```rust
fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins(EguiPlugin)
        .add_plugins((GridPlugin, GridRenderPlugin, RoutesPlugin, RoutesRenderPlugin))
        .init_resource::<EditState>()
        .init_resource::<CostReadout>()
        .add_systems(Startup, (build_scene, spawn_camera_and_light))
        .add_systems(
            Update,
            (handle_keys, handle_edit_click, advance_sim, color_by_activation).chain(),
        )
        .add_systems(Update, ui_top_bar)
        .run();
}
```

- [ ] **Step 4: Recompute cost where the sim recompiles**

In `build_scene`, after computing `cost`, insert the readout resource:

```rust
    commands.insert_resource(CostReadout {
        volume_um3: cost.total_volume_um3,
        membrane_um2: cost.total_membrane_um2,
        static_pj_s: cost.total_static_pj_s,
    });
```

Add a helper and call it from every edit branch that currently calls `sim.recompile(...)`. Add this free function:

```rust
fn refresh_cost(grid: &grid_workshop::Grid, routes: &grid_workshop::Routes, cost: &mut CostReadout) {
    let c = routes.organ_static(grid);
    cost.volume_um3 = c.total_volume_um3;
    cost.membrane_um2 = c.total_membrane_um2;
    cost.static_pj_s = c.total_static_pj_s;
}
```

Add `mut cost: ResMut<CostReadout>` to `handle_edit_click`'s params and, in each branch right after `sim.recompile(&grid.0, &routes.0);`, add `refresh_cost(&grid.0, &routes.0, &mut cost);`.

- [ ] **Step 5: Write the top-bar system**

```rust
fn ui_top_bar(
    mut contexts: EguiContexts,
    mut sim: ResMut<Sim>,
    mut edit: ResMut<EditState>,
    cost: Res<CostReadout>,
) {
    egui::TopBottomPanel::top("top_bar").show(contexts.ctx_mut(), |ui| {
        ui.horizontal(|ui| {
            if ui.button(if sim.playing { "⏸ Pause" } else { "▶ Play" }).clicked() {
                sim.playing = !sim.playing;
            }
            if ui.button("⏭ Step").clicked() {
                sim.step();
            }
            if ui.button("⟲ Reset").clicked() {
                sim.reset();
            }
            ui.separator();
            ui.label(format!("tick {}", sim.state.tick));
            ui.separator();
            let mut em = edit.edit_mode;
            if ui.selectable_label(em, "Edit").clicked() {
                em = true;
            }
            if ui.selectable_label(!em, "View").clicked() {
                em = false;
            }
            edit.edit_mode = em;
            ui.separator();
            ui.label(format!(
                "cost  vol {:.0} µm³   memb {:.0} µm²   static {:.0} pJ/s",
                cost.volume_um3, cost.membrane_um2, cost.static_pj_s
            ));
        });
    });
}
```

Note: this `edit_mode` toggle does not swap the camera (the Tab key still does that via `handle_keys`). Camera-follow on the egui toggle is out of scope; leave it.

- [ ] **Step 6: Build + smoke**

Run: `cargo run -p grid_workshop --example eval_viewer` (windowed; user closes it).
Expected: window opens, a top bar shows Play/Step/Reset/Edit/View + tick + cost; clicking Play advances the tick; no panic in console.

- [ ] **Step 7: Commit**

```bash
git -C D:/dev/umwelt-bevy add crates/grid_workshop/Cargo.toml crates/grid_workshop/Cargo.lock crates/grid_workshop/examples/eval_viewer.rs
git -C D:/dev/umwelt-bevy commit -m "feat(editor): egui top bar — playback, edit/view, in-window cost readout"
```

---

## Task 3: Tool + Type side panel; add Select tool; picking gate

egui left panel with tool buttons (incl. new `Select`) and the 5 type swatches in warm colors. Gate world-clicks so panel clicks don't also hit the grid.

**Files:**
- Modify: `crates/grid_workshop/examples/eval_viewer.rs`

- [ ] **Step 1: Add `Select` to the `Tool` enum and a selection field**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tool {
    Select,
    Place,
    Connect,
    Delete,
    Replace,
    Move,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Selection {
    Neuron(CellCoord),
    Edge(grid_workshop::EdgeId),
}
```

Add `selected: Option<Selection>` to `EditState` and default it to `None`; set the default `tool` to `Tool::Select`. (Update the `Default for EditState` impl accordingly.)

Ensure `EdgeId` is importable: add `EdgeId` to the `grid_workshop::{...}` import list (it is re-exported at the crate root; if not, import `grid_workshop::routing::EdgeId`).

- [ ] **Step 2: Warm-color helper**

```rust
fn kind_color(kind: NeuronKind) -> egui::Color32 {
    match kind {
        NeuronKind::SensorOn => egui::Color32::from_rgb(0xD8, 0xB0, 0x60),
        NeuronKind::InterExc => egui::Color32::from_rgb(0x8F, 0xAE, 0x58),
        NeuronKind::InterInh => egui::Color32::from_rgb(0xC8, 0x70, 0x50),
        NeuronKind::Modulator => egui::Color32::from_rgb(0xA8, 0x90, 0xBC),
        NeuronKind::Motor => egui::Color32::from_rgb(0xC6, 0x8A, 0x5E),
    }
}

/// Same palette as bevy Color for 3D rendering (linear-ish srgb 0..1).
fn kind_color_bevy(kind: NeuronKind) -> Color {
    let c = kind_color(kind);
    Color::srgb(c.r() as f32 / 255.0, c.g() as f32 / 255.0, c.b() as f32 / 255.0)
}
```

- [ ] **Step 3: Left panel system**

```rust
fn ui_left_panel(mut contexts: EguiContexts, mut edit: ResMut<EditState>) {
    egui::SidePanel::left("left_panel").show(contexts.ctx_mut(), |ui| {
        ui.heading("Tools");
        for (tool, label) in [
            (Tool::Select, "Select"),
            (Tool::Place, "Place"),
            (Tool::Connect, "Connect"),
            (Tool::Delete, "Delete"),
            (Tool::Move, "Move"),
            (Tool::Replace, "Replace"),
        ] {
            if ui.selectable_label(edit.tool == tool, label).clicked() {
                edit.tool = tool;
                edit.connect_from = None;
                edit.move_from = None;
            }
        }
        ui.separator();
        ui.heading("Type");
        for (kind, label) in [
            (NeuronKind::SensorOn, "sensor"),
            (NeuronKind::InterExc, "inter+"),
            (NeuronKind::InterInh, "inter−"),
            (NeuronKind::Modulator, "modulator"),
            (NeuronKind::Motor, "motor"),
        ] {
            let selected = edit.place_kind == kind;
            let text = egui::RichText::new(label).color(kind_color(kind));
            if ui.selectable_label(selected, text).clicked() {
                edit.place_kind = kind;
            }
        }
    });
}
```

Register it: add `.add_systems(Update, ui_left_panel)` in `main()`.

- [ ] **Step 4: Gate world-clicks behind egui**

In `handle_edit_click`, add `mut contexts: EguiContexts` to the params and, immediately after the `edit_mode` / mouse-pressed early-returns, add:

```rust
    if contexts.ctx_mut().wants_pointer_input() {
        return; // egui consumed this click
    }
```

- [ ] **Step 5: Build + smoke**

Run: `cargo run -p grid_workshop --example eval_viewer`
Expected: left panel with Tools + colored Type swatches; selecting a tool/type highlights it; clicking a panel button does NOT place/delete in the 3D grid; clicking the grid (in Edit mode, Place tool) still places. No panic.

- [ ] **Step 6: Commit**

```bash
git -C D:/dev/umwelt-bevy add crates/grid_workshop/examples/eval_viewer.rs
git -C D:/dev/umwelt-bevy commit -m "feat(editor): egui tool/type panel, Select tool, egui pointer gate"
```

---

## Task 4: Multi-layer wireframe lattice + layer switching

Draw empty cells as gizmo wireframe boxes (reserved volume) for a window of layers; highlight the current layer; add layer up/down (buttons + keys).

**Files:**
- Modify: `crates/grid_workshop/examples/eval_viewer.rs`

- [ ] **Step 1: Lattice gizmo system**

```rust
/// Draw the cell lattice as empty wireframe boxes over a fixed window, for the
/// current layer (bright) and its immediate neighbors (dim). Reserved volume.
fn draw_lattice(mut gizmos: Gizmos, edit: Res<EditState>) {
    const HALF: i32 = 10; // window radius in cells (x and y)
    for dl in -1..=1 {
        let layer = edit.layer + dl;
        let bright = dl == 0;
        let color = if bright {
            Color::srgba(0.55, 0.55, 0.62, 0.9)
        } else {
            Color::srgba(0.30, 0.30, 0.35, 0.25)
        };
        for x in -HALF..=HALF {
            for y in -HALF..=HALF {
                let center = CellCoord::new(layer, x, y).to_world();
                gizmos.cuboid(
                    Transform::from_translation(center)
                        .with_scale(Vec3::new(CELL_PITCH, LAYER_PITCH, CELL_PITCH)),
                    color,
                );
            }
        }
    }
}
```

Register: `.add_systems(Update, draw_lattice)`.

- [ ] **Step 2: Layer up/down keys**

In `handle_keys`, add (using `BracketLeft`/`BracketRight`):

```rust
    if keys.just_pressed(KeyCode::BracketRight) {
        edit.layer += 1;
        info!("[]] layer = {}", edit.layer);
    }
    if keys.just_pressed(KeyCode::BracketLeft) {
        edit.layer -= 1;
        info!("[[] layer = {}", edit.layer);
    }
```

- [ ] **Step 3: Layer up/down buttons in the left panel**

In `ui_left_panel`, after the Type section add:

```rust
        ui.separator();
        ui.heading("Layer");
        ui.horizontal(|ui| {
            if ui.button("− down").clicked() {
                edit.layer -= 1;
            }
            ui.label(format!("{}", edit.layer));
            if ui.button("+ up").clicked() {
                edit.layer += 1;
            }
        });
```

- [ ] **Step 4: Build + smoke**

Run: `cargo run -p grid_workshop --example eval_viewer`
Expected: a wireframe cell lattice is visible; one layer is brighter; `[` / `]` and the Layer buttons shift which layer is highlighted; placing on the current layer lands in the bright frame. No panic. (Perspective view shows the cage clearly; you may need to look via the default camera.)

- [ ] **Step 5: Commit**

```bash
git -C D:/dev/umwelt-bevy add crates/grid_workshop/examples/eval_viewer.rs
git -C D:/dev/umwelt-bevy commit -m "feat(editor): multi-layer wireframe lattice + layer switching"
```

---

## Task 5: Neuron rendering — fill not glow + type-color outline

Replace emissive glow with fill (base_color = warm type color scaled by activation) and draw a type-color wireframe outline around each neuron.

**Files:**
- Modify: `crates/grid_workshop/examples/eval_viewer.rs`

- [ ] **Step 1: Rewrite `color_by_activation` as fill**

```rust
/// Activation = FILL (not glow). Each neuron's fill cube shows the warm type
/// color at intensity = its activation; dark when idle. No emissive. The kind
/// comes from the grid (avoids depending on eval's NodeTypeCode).
fn color_by_activation(
    sim: Res<Sim>,
    grid: Res<GridRes>,
    cells: Res<CellEntities>,
    q: Query<&MeshMaterial3d<StandardMaterial>>,
    mut mats: ResMut<Assets<StandardMaterial>>,
) {
    for i in 0..sim.topo.node_count {
        let coord = sim.topo.node_coord[i];
        let act = sim.state.output[i].clamp(0.0, 1.0);
        let CellContents::Neuron(kind) = grid.0.get(coord) else { continue };
        let Some(&ent) = cells.0.get(&coord) else { continue };
        let Ok(math) = q.get(ent) else { continue };
        let Some(m) = mats.get_mut(&math.0) else { continue };
        let base = kind_color_bevy(kind).to_srgba();
        let floor = 0.12; // dim but visible when idle
        let k = floor + (1.0 - floor) * act;
        m.base_color = Color::srgb(base.red * k, base.green * k, base.blue * k);
        m.emissive = LinearRgba::BLACK; // ensure no glow remains
    }
}
```

- [ ] **Step 2: Neuron outline gizmos**

```rust
/// Wireframe outline around each neuron in its full type color (always on),
/// so the marker reads even when the fill is dim.
fn draw_neuron_outlines(grid: Res<GridRes>, mut gizmos: Gizmos) {
    for (coord, contents) in grid.0.occupied_cells() {
        if let CellContents::Neuron(kind) = contents {
            gizmos.cuboid(
                Transform::from_translation(coord.to_world())
                    .with_scale(Vec3::splat(0.9)),
                kind_color_bevy(kind),
            );
        }
    }
}
```

Register: `.add_systems(Update, draw_neuron_outlines)`.

- [ ] **Step 3: Build + smoke**

Run: `cargo run -p grid_workshop --example eval_viewer`
Expected: neurons show warm type colors with a colored outline; idle neurons are dim, active ones brighten (run Play and watch the oscillator pair brighten alternately) — a FILL change, no bloom/glow halo. No panic.

- [ ] **Step 4: Commit**

```bash
git -C D:/dev/umwelt-bevy add crates/grid_workshop/examples/eval_viewer.rs
git -C D:/dev/umwelt-bevy commit -m "feat(editor): activation as fill (not glow) + type-color neuron outlines"
```

---

## Task 6: Wires on struts (not center-to-center)

Stop using `RoutesRenderPlugin` (center-to-center edge gizmos) and draw each wire as a polyline lying on lattice struts via the min-corner rule. This is the spec's visual命脉: struts, not centers.

**Files:**
- Modify: `crates/grid_workshop/examples/eval_viewer.rs`

- [ ] **Step 1: Remove RoutesRenderPlugin from the app**

In `main()`, change the plugin tuple to drop `RoutesRenderPlugin`:

```rust
        .add_plugins((GridPlugin, GridRenderPlugin, RoutesPlugin))
```

Remove `RoutesRenderPlugin` from the `grid_workshop::{...}` import (keep `RoutesPlugin`, `RoutesRes`).

- [ ] **Step 2: Strut polyline helper + draw system**

```rust
/// Min-corner of a cell in world space (rides the lattice corner lattice, NOT
/// the cell center). Two adjacent cells' min-corners differ by exactly one
/// strut, so a cell path lifts to a strut-connected polyline.
fn cell_min_corner(c: CellCoord) -> Vec3 {
    c.to_world() - Vec3::new(CELL_PITCH * 0.5, LAYER_PITCH * 0.5, CELL_PITCH * 0.5)
}

/// Draw each edge's path as a polyline ON THE STRUTS (min-corner nodes), with
/// short stubs from the endpoint neuron centers onto the strut grid. Colored by
/// the source neuron's type. NOT center-to-center (that is the rejected look).
///
/// `PathTree::cells()` returns the ordered cell path. Every editor-created edge
/// is a single linear path (`route_same_layer` → `PathTree::from_path`), so one
/// linestrip per edge over `cells()` is correct. (Fan-out trees are not produced
/// by the UI; if they ever are, per-branch strut drawing is a future addition —
/// surface then, don't pre-build it.)
fn draw_struts(routes: Res<RoutesRes>, grid: Res<GridRes>, mut gizmos: Gizmos) {
    for (_eid, edge) in routes.0.edges() {
        let cells = edge.tree.cells();
        if cells.len() < 2 {
            continue;
        }
        let color = match grid.0.get(edge.tree.root()) {
            CellContents::Neuron(k) => kind_color_bevy(k),
            _ => Color::srgb(0.7, 0.7, 0.7),
        };
        let mut pts: Vec<Vec3> = Vec::with_capacity(cells.len() + 2);
        pts.push(cells[0].to_world()); // stub from source center
        for c in cells {
            pts.push(cell_min_corner(*c));
        }
        pts.push(cells[cells.len() - 1].to_world()); // stub to target center
        gizmos.linestrip(pts, color);
    }
}
```

Register: `.add_systems(Update, draw_struts)`. (`PathTree::cells()` and `root()` are confirmed-existing accessors; no tree API is added.)

- [ ] **Step 3: Build + smoke (visual crux)**

Run: `cargo run -p grid_workshop --example eval_viewer`
Expected: wires run along the cage edges (struts), offset from cell centers — NOT straight lines through cell centers. They connect to neuron markers via short stubs. No panic.

- [ ] **Step 4: Commit**

```bash
git -C D:/dev/umwelt-bevy add crates/grid_workshop/examples/eval_viewer.rs
git -C D:/dev/umwelt-bevy commit -m "feat(editor): render wires on lattice struts (min-corner), drop center-to-center"
```

> **Playtest note for the controller:** wires-on-struts is the visual the user specifically called out. After this task, the user must eyeball whether it reads as "on the struts." If the min-corner rule looks wrong (e.g. a corridor hugs an unexpected edge), surface per spec §5.1 rather than guessing a different rule.

---

## Task 7: Inspector panel (right) — select + edit edge d/weight

Right egui panel. `Select` tool click sets `EditState.selected`. Neuron → read-only. Edge → edit `d`/`weight` via the Task 1 setters (then recompile); `plastic`/`mod_source` read-only.

**Files:**
- Modify: `crates/grid_workshop/examples/eval_viewer.rs`

- [ ] **Step 1: Handle the Select tool in `handle_edit_click`**

Add a `Tool::Select` arm to the `match edit.tool` (clicking a neuron selects it; clicking a wire cell selects that edge; else clears):

```rust
        Tool::Select => {
            edit.selected = match contents {
                CellContents::Neuron(_) => Some(Selection::Neuron(cell)),
                _ => routes.0.edge_at_wire_cell(cell).map(Selection::Edge),
            };
            info!("[Select] {:?}", edit.selected);
        }
```

- [ ] **Step 2: Inspector system**

```rust
fn ui_inspector(
    mut contexts: EguiContexts,
    mut edit: ResMut<EditState>,
    grid: Res<GridRes>,
    mut routes: ResMut<RoutesRes>,
    mut sim: ResMut<Sim>,
    mut cost: ResMut<CostReadout>,
) {
    egui::SidePanel::right("inspector").show(contexts.ctx_mut(), |ui| {
        ui.heading("Inspector");
        match edit.selected {
            None => {
                ui.label("(Select tool: click a neuron or a wire)");
            }
            Some(Selection::Neuron(coord)) => {
                let kind = match grid.0.get(coord) {
                    CellContents::Neuron(k) => Some(k),
                    _ => None,
                };
                match kind {
                    None => {
                        ui.label("neuron no longer exists");
                        edit.selected = None;
                    }
                    Some(k) => {
                        ui.label(format!("Neuron {:?}", k));
                        ui.label(format!("coord: layer {} x {} y {}", coord.layer, coord.x, coord.y));
                        ui.separator();
                        ui.label("read-only params (engine defaults):");
                        // Display the compile-time defaults for this kind.
                        let (tau, g_rebound) = default_display_params(k);
                        ui.label(format!("tau = {tau}"));
                        ui.label(format!("g_rebound = {g_rebound}"));
                        ui.label("(neuron-param authoring deferred to Tier-3)");
                    }
                }
            }
            Some(Selection::Edge(eid)) => {
                let Some(edge) = routes.0.get(eid) else {
                    ui.label("edge no longer exists");
                    edit.selected = None;
                    return;
                };
                let plastic = edge.plastic;
                let mut d = edge.thickness_d;
                let mut w = edge.weight;
                ui.label(format!("Edge {:?}", eid));
                let (w_lo, w_hi) = if plastic { (0.0, 1.0) } else { (0.1, 1.0) };
                let mut changed = false;
                if ui.add(egui::Slider::new(&mut d, 0.1..=5.0).text("d (µm)")).changed() {
                    let _ = routes.0.set_edge_thickness(eid, d);
                    changed = true;
                }
                if ui.add(egui::Slider::new(&mut w, w_lo..=w_hi).text("weight")).changed() {
                    let _ = routes.0.set_edge_weight(eid, w);
                    changed = true;
                }
                ui.separator();
                ui.label(format!("plastic: {plastic}  (read-only)"));
                ui.label(format!("mod_source: {:?}  (read-only)", edge.mod_source.map(|m| m.coord())));
                if changed {
                    sim.recompile(&grid.0, &routes.0);
                    refresh_cost(&grid.0, &routes.0, &mut cost);
                }
            }
        }
    });
}

/// Display-only: the per-kind defaults `compile()` assigns (constants/eval.rs).
fn default_display_params(kind: NeuronKind) -> (f32, f32) {
    use grid_workshop::constants::eval as e;
    let tau = match kind {
        NeuronKind::SensorOn => e::DEFAULT_TAU_SENSOR,
        NeuronKind::InterExc => e::DEFAULT_TAU_INTER_EXC,
        NeuronKind::InterInh => e::DEFAULT_TAU_INTER_INH,
        NeuronKind::Modulator => e::DEFAULT_TAU_MOD,
        NeuronKind::Motor => e::DEFAULT_TAU_MOTOR,
    };
    (tau, e::DEFAULT_G_REBOUND)
}
```

If `grid_workshop::constants::eval` is not public at that path, adjust the import to the correct module path so the default constants are reachable (they are defined in `src/constants/eval.rs`).

Register: `.add_systems(Update, ui_inspector)`.

- [ ] **Step 3: Highlight the selection in 3D (optional, cheap)**

Add to `draw_neuron_outlines` (or a small system) a brighter/larger outline when `edit.selected == Some(Selection::Neuron(coord))`. Keep it rough; skip if it complicates. (No test.)

- [ ] **Step 4: Build + smoke**

Run: `cargo run -p grid_workshop --example eval_viewer`
Expected: with Select tool, clicking a neuron shows its kind/coord + read-only tau/g_rebound; clicking a wire shows the edge with d/weight sliders that, when dragged, change the value and recompile (cost updates); plastic/mod_source shown read-only. Dragging weight below 0.1 on a fixed edge is prevented by the slider range. No panic.

- [ ] **Step 5: Commit**

```bash
git -C D:/dev/umwelt-bevy add crates/grid_workshop/examples/eval_viewer.rs
git -C D:/dev/umwelt-bevy commit -m "feat(editor): inspector — select + edit edge d/weight; neuron/plastic read-only"
```

---

## Task 8: CLAUDE.md reserved-concept note

**Files:**
- Modify: `D:/dev/Umwelt/CLAUDE.md`

- [ ] **Step 1: Add the note**

In `CLAUDE.md`, in the architecture/constraints area near §2 grid atomicity (e.g. under "## 架构约束"), add:

```markdown
### 预留概念:格体积 = 体块组织(未来)

格子的体积将来用于**体块组织**(肌肉、血管等);神经轴突是沿格点阵的**棱**走线
(编辑器 v2 已按此渲染)。已知的将来对齐点:一旦体块占了格,no-overlap 的单位会
从"格"(现在宪法 §2)变为"棱"。**现在不做体块、后端照跑,不要为此重构路由** ——
留到将来跟体块一起对齐。
```

- [ ] **Step 2: Commit**

```bash
git -C D:/dev add Umwelt/CLAUDE.md
git -C D:/dev commit -m "docs(claude): reserved concept — cell volume = bulk tissue; axon = strut routing" -- Umwelt/CLAUDE.md
```

(Repo root for `Umwelt/CLAUDE.md` is `D:/dev`; commit only that path to avoid the staged `.tmp.driveupload` files.)

---

## Task 9: Final verification + handoff

**Files:** none (verification only)

- [ ] **Step 1: Full test + clippy**

Run: `cargo test -p grid_workshop 2>&1 | tail -10 && cargo clippy -p grid_workshop --all-targets 2>&1 | tail -10`
Expected: lib + oracle tests green (no engine change); clippy clean (warnings on the example are acceptable if minor, but prefer clean).

- [ ] **Step 2: Run smoke**

Run: `cargo run -p grid_workshop --example eval_viewer`
Expected: window opens; top bar (playback/edit-view/cost), left panel (tools/types/layer), right inspector, wireframe lattice, neuron fill+outline, wires on struts. No panic on launch.

- [ ] **Step 3: Hand off to user playtest**

The interaction feel and rendering correctness (strut look, fill readability, picking accuracy across layers, inspector edit→recompile) cannot be auto-verified by CC. Hand to the user to playtest: build the half-center CPG by hand and confirm it reads + oscillates. Fix whatever is clumsy per their report.

---

## Self-Review

**Spec coverage:**
- §3 bevy_egui dev-dep + gate → Task 2 (confirm/commit). ✓
- §5.1 lattice (wireframe, current-layer highlight, layer switch) → Task 4. ✓
- §5.1 neuron marker in type color → Task 5. ✓
- §5.1 wires on struts (not center) → Task 6. ✓
- §5.1 activation = fill not glow → Task 5. ✓
- §5.2 tool panel + Select → Task 3. ✓
- §5.3 type palette warm colors → Task 3. ✓
- §5.4 inspector (edge d/weight edit; plastic/mod_source + neuron read-only) → Task 7. ✓
- §5.5 cost readout in-window, no par → Task 2. ✓
- §5.6 playback bar → Task 2. ✓
- §5.7 edit/view toggle → Task 2. ✓
- §6 two thin setters → Task 1. ✓
- §7 CLAUDE.md note → Task 8. ✓
- §9 testing (setters unit-tested; UI playtested) → Tasks 1, 9. ✓

**Placeholder scan:** Tasks contain real code. Resolved during planning: `OrganStatic` is re-exported at the crate root (lib.rs:15); `PathTree::cells()` + `root()` exist and cover all editor edges (no `path_to_leaf` needed); Task 5 reads kind from the grid (no `NodeTypeCode` dependency). Remaining verify-on-build notes: `EdgeId` crate-root re-export (fallback: `grid_workshop::routing::EdgeId`) and `constants::eval` public path — each with a concrete fallback, not deferred work.

**Type consistency:** `Tool` (with `Select`), `Selection`, `CostReadout`, `kind_color`/`kind_color_bevy`, `refresh_cost`, `cell_min_corner` are defined once and used consistently. `set_edge_weight`/`set_edge_thickness` signatures match between Task 1 and Task 7.

**Open risk:** none load-bearing. The min-corner strut rule (Task 6) is deterministic and concrete; whether it *reads* as "on struts" is a user playtest judgment (spec §5.1 surface-clause), not a code unknown.
