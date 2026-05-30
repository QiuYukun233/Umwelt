# Editor increment — camera cluster + rough save/load + undo

- **Date**: 2026-05-31
- **Status**: APPROVED (design), panorbit gate passed
- **Repo**: `D:/dev/umwelt-bevy`, crate `grid_workshop`, branch `master`
- **Target file**: `crates/grid_workshop/examples/eval_viewer.rs` (reworked in place)
- **Builds on**: `2026-05-30-editor-v2-egui-frontface-design.md` (egui front-face, the
  Edit/View toggle, strut wires, fill-not-glow). That spec stays the record of v2;
  this is the next increment.

## 1. Motivation

v2 gave the editor a complete mouse-driven element set, but three usability holes
remain before it can serve its job (hand-build a whole ant as the architecture's
integration test):

1. **Camera is inert.** View-mode has no orbit/zoom/pan; Edit-mode is a fixed
   top-down ortho with no pan/zoom and an *empty-screen failure* — if the current
   layer's content is off the framed area (or the layer is empty), you see nothing.
2. **No persistence.** A hand-built circuit is lost on exit; you cannot save the ant
   or reload it next session.
3. **No undo.** Every misclick (Delete cascades!) is unrecoverable.

This increment closes all three. It is still **glue over the existing engine** — no
engine refactor (see §3).

## 2. Dependency gate (PASSED)

`bevy_panorbit_camera = "0.25"` added as a **dev-dependency** (editor is an example).
Verified: `0.25.0` is the highest release declaring `bevy ^0.15` (v0.34, the latest,
jumped to `bevy ^0.18`). It **compiles clean** against bevy 0.15.3 with our
`default-features=false` feature set (`bevy_render, bevy_pbr, bevy_gizmos,
bevy_winit, tonemapping_luts, ktx2, zstd`) — no missing bevy features, no
`bevy_egui` conflict. Gate method mirrored the egui precedent (smoke example with
`PanOrbitCamera` + `PanOrbitCameraPlugin`, `cargo check`, smoke deleted).

`serde` + `serde_json` are **already** crate dependencies — no gate needed for the
save format.

## 3. Scope boundary — "后端别动" reaffirmed

**This increment adds ZERO backend changes.** The only backend-adjacent additions
in the whole editor remain the two v2 edge setters (`set_edge_thickness` /
`set_edge_weight`). In particular:

- **No new `serde`/`Clone` derives on engine types** (`Grid`, `Routes`, `Edge`,
  `PathTree`, `CellCoord`, `NeuronKind`). Save/load and undo are built entirely in
  the example via a **DTO of primitives** (§6.3) and **replay through `EdgeOps`**.
- Restore (load + undo) goes through the *same* validated construction path the
  interactive tools use (`remove_neuron` cascade → `place_neuron` → `place_edge`).
  The renderer (`sync_cell_entities` is a pure occupancy reconciler) and `Sim`
  (recompiled after) resync through existing seams. No engine code is touched.

If implementation reveals this is genuinely impossible without a backend derive,
**surface it** before adding one — don't quietly widen the boundary.

## 4. Camera cluster (§ block 1)

All camera work is plumbing. Picking math (`viewport_to_world` ray → layer-plane)
is **projection-agnostic and unchanged** — it works for both ortho and perspective,
so pan/zoom/orbit cannot break clicking.

### 4.1 View mode — orbit / zoom / pan
Attach `PanOrbitCamera` to the main camera; perspective projection. It supplies
orbit + zoom + pan for free. Replaces v1/v2's fixed perspective + the
`PerspectiveView` save/restore resource (delete that machinery).

### 4.2 Edit mode — top-down ortho + pan + zoom
Edit stays a straight-down orthographic view of the current layer, now with
**pan + zoom**.

- **Preferred**: drive it with the same `PanOrbitCamera`, constrained — pitch locked
  to straight-down (`pitch_*_limit` equal), orbit disabled, pan + zoom enabled,
  orthographic projection. One camera-control path.
- **Fallback** (if `PanOrbitCamera` 0.25's ortho / pitch-lock turns out fiddly):
  disable `PanOrbitCamera` in edit mode and run a small hand-rolled handler
  (right-drag pans the focus, scroll changes ortho scale) — ~60 lines, fully under
  our control. Still glue.
- Verify 0.25's orthographic + pitch-lock support first; **surface only if BOTH the
  constrained-PanOrbit and the hand-rolled fallback turn out problematic** (unlikely).

### 4.3 Fit / frame-content command (= the empty-screen bug fix, dual-use)
One helper, two jobs. Compute the **world-space AABB of occupied cells** (current
layer in edit mode; all layers in view mode), then frame the camera on it with a
margin (set focus + ortho `scale` / orbit `radius`). **Empty layer → default
framing at origin** with a sane extent. This is *also* the fix for the Edit
empty-screen bug — framing content (or origin when empty) guarantees something is on
screen. Exposed as an egui **Fit** button (+ optional `F` key). Auto-fit once on
startup and on load so you never open to a blank viewport.

## 5. Bounded lattice render (§ block 1)

Replace the v2 radius-10 screen-filling `draw_lattice` (noise) with a bounded window
that hugs the circuit.

- **View**: a **transparent wireframe "rubik's cube"** around the occupied-cell AABB
  + 1 cell of padding — a clean bounded volume you orbit around, that **grows with
  the circuit**. Not an infinite grid.
- **Edit**: the current layer drawn as a **clean 2D grid with a visible boundary
  frame** (the bounded window for that layer), so the editable plane reads clearly.
- The library's translucent per-layer ground planes (`sync_layer_planes`) may stay;
  they're harmless occupancy hints.

**Wrap-up confirmation criteria (visual, user-verified):** after Fit, a neuron cube
reads as ≈ one cell, and the strut wires are visible against the lattice.

## 6. Rough save/load (serde) (§ block 1)

**Rough, single-file, no versioning** — explicitly NOT the constitution's versioned
migration system (that is deferred, §9). Purpose: a hand-built circuit survives exit.

### 6.1 Format — example-owned DTO of primitives
```
SavedCircuit {
  neurons: Vec<SavedNeuron { layer: i32, x: i32, y: i32, kind: String }>,
  edges:   Vec<SavedEdge {
             path: Vec<[i32; 3]>,        // cell path (layer,x,y per cell)
             d: f32, weight: f32,
             plastic: bool,
             mod_source: Option<[i32; 3]>,
           }>,
}
```
`kind` is a stable string (`"sensor_on"` … `"motor"`) mapped by explicit `match`
both ways (robust to enum-order changes). Coords carried as primitives so **no
engine type needs `Serialize`**. Serialized with `serde_json` (already a dep).

### 6.2 Save
Iterate `grid.occupied_cells()` → neurons; `routes.edges()` → edges
(`tree.cells()` → path, `thickness_d`, `weight`, `plastic`,
`mod_source.map(|m| m.coord())`). Write to a fixed file (e.g. `eval_viewer_save.json`
in cwd). egui **Save** button.

### 6.3 Load — restore via replay
egui **Load** button → read json → `restore(SavedCircuit)`:
1. Remove every existing neuron via `EdgeOps::remove_neuron` (cascades its edges) →
   empty grid + routes.
2. Place all neurons (`place_neuron`).
3. Place all edges (`place_edge` with `PathTree::from_path`, carrying d/weight/
   plastic/`PathEndpoint(coord)` for mod_source).
4. `Sim::recompile` + `refresh_cost` + auto-Fit.

Replay order: **all neurons before any edge** (edge endpoints + mod_source must
exist). HashMap iteration order is harmless: a valid layout has non-contending cells
(neurons don't overlap, wires don't share cells), so any order reconstructs the same
layout. Replay is **validated** by `place_*` — a corrupt file fails loudly per-edge
rather than loading an invalid grid.

## 7. Snapshot undo/redo (§ block 1)

**Shares the §6 DTO + replay path** — one mechanism, two uses.

- `undo: Vec<SavedCircuit>`, `redo: Vec<SavedCircuit>`.
- **Before each mutating edit** (Place/Connect/Delete/Replace/Move, edge d/weight
  change, Load), push `capture()` onto `undo`; clear `redo`.
- **Undo**: push current `capture()` → `redo`; pop `undo` → `restore()`.
- **Redo**: symmetric.
- Cheap: circuits are small (tens of cells); a full DTO snapshot per edit is
  negligible. No backend `Clone` needed — `capture()` builds a `SavedCircuit`.
- egui **Undo / Redo** buttons (+ optional `Ctrl+Z` / `Ctrl+Y`).
- **Selection invalidation after restore is acceptable**: replay mints fresh
  `EdgeId`s, so a selected edge may go stale — the inspector already handles
  "edge no longer exists" → `selected = None`. Neuron selection by coord survives.

## 8. egui controls added
A small row (top bar or left panel): **Save · Load · Undo · Redo · Fit**. Keys as
accelerators only (`F`, `Ctrl+Z`, `Ctrl+Y`).

## 9. Deferred roadmap (block 2 — DOCUMENT ONLY, do NOT implement)

These are future work that is **not glue** — each needs real design and/or backend.
Recorded here so they're not re-derived each session; **no code this round.**

### 9.1 Box-select / multi-select
- **What**: drag a rectangle (edit plane) to select multiple neurons + their edges;
  operate on the set (delete, move, later copy).
- **Why later**: needs a selection *set* model (today `selected` is a single
  `Option<Selection>`) and group-aware ops (multi-move re-routing is harder than the
  current single-target limited move).
- **Rough how**: `selected: HashSet<Selection>`; rubber-band rect in screen space →
  cells inside → neurons + fully-contained edges; group delete = iterate; group move
  = the multi-leaf re-route problem (see §9 limited-move note) — non-trivial.

### 9.2 Subcircuit copy / paste (the module system)
- **What**: select a subcircuit, copy it, paste a translated clone; eventually save
  named modules and stamp them.
- **Why later**: this is the **module** concept (`to_module_json` already exists for
  export). Paste needs relocation + collision handling + fresh IDs; named modules
  need a library UI.
- **Rough how**: copy = a `SavedCircuit` fragment (reuse §6 DTO!) relative to an
  anchor; paste = translate all coords by an offset and replay via `EdgeOps`,
  rejecting/pushing on collision. Ties into §9.1 (selection) and the existing
  `to_module_json` schema.

### 9.3 Neuron-param authoring (g_rebound / tau, Tier-3)
- **What**: edit per-neuron `tau` / `g_rebound` (and friends) instead of the
  hardcoded compile defaults; inspector neuron fields become editable.
- **Why later**: a **real backend addition** — params aren't stored anywhere today
  (`compile()` assigns constants; `topology.rs` TODO). The CPG works on defaults, so
  it's not needed yet. Pairs with editing `plastic`/`mod_source`.
- **Rough how**: store params on `CellContents::Neuron` (or a side map keyed by
  coord); `compile()` reads them with the constants as fallback; inspector writes via
  proper setters with clamps. This is the Tier-3 plasticity/param-authoring task.

### 9.4 Versioned save + migration chain
- **What**: the real persistence system — schema version field, forward-migration
  chain, share/leaderboard-grade format (vs §6's rough throwaway dump).
- **Why later**: needed once circuits are shared/long-lived; premature while the
  format churns daily. §6 is deliberately a stopgap.
- **Rough how**: versioned envelope (`{version, payload}`), a migration fn per bump,
  reuse `to_module_json`'s DTO discipline (export only owned fields). Supersedes or
  absorbs §6's `SavedCircuit`.

### 9.5 Arbitrary-axis edit slice
- **What**: today editing is locked to a horizontal `k`-layer (constant layer).
  Later: edit on a slice along any of the three axes (and maybe oblique).
- **Why later**: the ant is fundamentally 3D; some structures are awkward to wire one
  horizontal layer at a time. Needs the picking plane + lattice render + Fit to
  generalize to an arbitrary slice normal.
- **Rough how**: parameterize the edit plane by a normal + offset (not just
  `layer`); generalize ray→plane (already generic), the 2D grid draw, and cell
  snapping to the chosen axis. Camera Fit already AABB-based, so it generalizes.

### 9.6 Player-facing observation UI
- **What**: the *player's* interface — camera feed / monitor mode / data overlays on
  a realistic creature — a separate front-end from this dev editor.
- **Why later**: it's a different product surface (the game's observation view), not
  the circuit-authoring tool. Belongs to the campaign layer.
- **Rough how**: out of this repo's editor scope — **hand to Claude Design** as its
  own brief. Listed here only so it isn't conflated with the editor.

### 9.7 Bulk tissue / cell-volume occupancy / strut-based no-overlap
- **What**: the reserved concept — cell *volume* used for bulk tissue (muscle,
  vessels); axons are struts on the lattice; once tissue occupies cells, the
  no-overlap unit shifts from "cell" to "strut".
- **Why later**: large model change touching the occupancy invariant (constitution
  §2 / `umwelt-grid-atomicity`). The editor already *renders* wires on struts in
  anticipation, but the **routing/occupancy model is unchanged** — do not refactor
  routing for this now (CLAUDE.md reserved-concept note).
- **Rough how**: introduce a tissue cell-content variant; move no-overlap checks from
  cell-occupancy to strut-occupancy; align with the bulk-tissue model when it lands.

## 10. Testing

- **Lib + oracle tests stay green** — no engine change (run `cargo test -p
  grid_workshop`).
- `cargo clippy --all-targets` clean; `cargo check --example eval_viewer`.
- Save/load + undo **round-trip** can get a tiny example-level sanity check if cheap,
  but the primary verification is **user playtest** (rendering, camera feel, the
  rubik's-cube lattice, Fit framing) — CC has no eyes on the window.

## 11. Discipline / surface points

Glue only, look rough, backend untouched. Surface before expanding if any of these
hide a pit: (a) `PanOrbitCamera` 0.25 ortho/pitch-lock for the edit camera (fallback
documented in §4.2), (b) the load/undo restore resyncing renderer + sim (verified:
reconciler-based, should be automatic), (c) any case where save/undo can't be done
without a backend derive (§3 — surface, don't widen the boundary quietly).
