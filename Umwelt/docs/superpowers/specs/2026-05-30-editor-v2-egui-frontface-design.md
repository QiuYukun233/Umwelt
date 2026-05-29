# Editor v2 — egui front-face over the existing engine

- **Date**: 2026-05-30
- **Status**: APPROVED (design), gate passed
- **Repo**: `D:/dev/umwelt-bevy`, crate `grid_workshop`, branch `master`
- **Target file**: `crates/grid_workshop/examples/eval_viewer.rs` (reworked in place)

## 1. Motivation

The v1 editor pushed "rough" (粗) in the wrong dimension: it dropped *structure*
(the grid canvas, mouse-driven UI) and kept only a keyboard-modal + console
front-end. Result: it neither resembles the target Zach-like nor serves as a tool
to refine interaction (you cannot playtest circuit-handling feel through a console).

v2 corrects this: **complete element set, mouse-driven, ugly is fine — but every
listed element must be present and clickable.** The failure mode is the opposite of
v1: do not cut elements to "stay rough." A missing element defeats the purpose
(refining interaction feel). Ugly OK, missing NOT OK.

This is a **front-face swap only**. The engine — `route_same_layer` (pathfinder),
`EdgeOps`, `EvalTopology::compile`, `step_eval`, and the ray→plane picking math —
is good and stays.

## 2. Scope boundary: what "后端别动" means

- **Out of bounds**: refactoring the engine — routing, cell-occupancy model, eval
  model. Do not touch `route_same_layer`, `EdgeOps` semantics, `compile`,
  `step_eval`, or the picking math.
- **In bounds**: thin, clamped setters for *already-authored* `Edge` fields. The
  inspector edits edge `d`/`weight` through new `Routes::set_edge_thickness` /
  `Routes::set_edge_weight` that mirror place-time range validation. These are
  setters, not an engine change. They are the **only** backend-adjacent additions.

## 3. Dependency gate (PASSED)

`bevy_egui = "0.31"` added as a **dev-dependency** (the editor is an example;
keeps egui out of the library's deps). Verified: it resolves and compiles against
bevy 0.15.3 with our `default-features=false` feature set
(`bevy_render, bevy_pbr, bevy_gizmos, bevy_winit, tonemapping_luts, ktx2, zstd`),
and `EguiPlugin` / `EguiContexts` / `egui::Window` type-check. bevy_egui does not
require `bevy_ui`/`bevy_text`. It ships its own font (no font yak-shave).

## 4. Architecture

Two layers in one app:

1. **3D world** (Bevy render + gizmos): the cell lattice and the circuit.
2. **egui overlay**: all panels, drawn on top each frame via `EguiContexts`.

The existing `Sim` resource (`topo` + `EvalState` + `playing`) and its
`step()` / `reset()` / `recompile()` stay. After any edit, recompile `Sim` as
before. Picking math stays; it is gated so clicks consumed by egui do not also
hit the 3D grid (`ctx.wants_pointer_input()` → skip world pick that frame).

## 5. Element set

### 5.1 3D lattice (the structure v1 dropped)

- Draw a multi-layer cell lattice as **empty wireframe boxes** = reserved volume.
  Render a window of layers around the current layer (rough: occupied layers plus
  the current layer's empty frame; a fixed ±N window is acceptable).
- **Current layer highlighted** (brighter frame); other layers dimmed.
- **Layer up/down**: egui buttons **and** keys (`[` / `]` or PageUp/PageDown).
  This is the hole v1 left (edit layer was locked at 0).
- **Neurons** = a marker at the cell, drawn in its type color (§5.3). Rough soma
  marker; do not agonize over occupy-cell vs land-on-node — pick a reasonable
  rough form.
- **Wires** run along the lattice **struts** (segment per cell-to-cell hop in the
  path), not filling cells.
- **Activation = fill, not glow** (fixes v1's emissive glow): each neuron marker is
  an outline always (type color); an inner fill is shown at intensity = the
  neuron's activation value (`s.output[i]`). No bloom/glow.

### 5.2 Tool panel (clickable buttons, current highlighted)

`Select` · `Place` · `Connect` · `Delete` · `Move` · `Replace`.

- **Select** is the resting tool (added so the inspector has a selection
  mechanism — completes the element set, not scope creep). Click a neuron/edge to
  select it for the inspector.
- `Place` (+ type from §5.3) → click empty cell on current layer.
- `Connect` → click source neuron, click target neuron; `route_same_layer` lays
  the wire.
- `Delete` → click neuron; cascade via existing `EdgeOps`.
- `Move` → click neuron, click empty destination (existing limited-move rules:
  refuse plastic / multi-leaf / bound-modulator with a panel message).
- `Replace` (+ type) → click neuron; `EdgeOps::replace_kind`.

### 5.3 Type palette (clickable swatches, warm colors — given, not designed)

| Kind | Label | Hex |
|------|-------|-----|
| SensorOn | sensor | `#D8B060` (gold) |
| InterExc | inter+ | `#8FAE58` (olive) |
| InterInh | inter− | `#C87050` (ochre-red) |
| Modulator | modulator | `#A890BC` (lavender) |
| Motor | motor | `#C68A5E` (copper) |

Current kind highlighted. These hex values are applied as given; no color design.

### 5.4 Inspector

- **Click an edge** → edit **d** and **weight** via clamped egui widgets
  (fixed `weight ∈ [0.1,1.0]`, plastic `∈ [0,1]`; `d > 0`), writing through the
  §2 thin setters, then recompile. Show **`plastic`** and **`mod_source`**
  **read-only** this round.
- **Click a neuron** → **all read-only**: kind, coord, and the default
  `tau` / `g_rebound` (the values `compile()` assigns). No editing.
- Rationale for read-only plastic/mod_source + neuron params: editing those needs
  either per-node param storage (g_rebound/tau — not stored anywhere; a real
  backend addition) or remove+re-place (plastic/mod_source — changes EdgeId, the
  one awkward mechanism). CPG needs neither. Deferred to the future Tier-3
  plasticity / neuron-param-authoring task, which will add proper setters.

### 5.5 Cost + par readout

Three-axis static cost (`organ_static`: volume µm³, membrane µm², static pJ/s)
shown **in-window** (egui), off the console.

### 5.6 Playback bar

Visible buttons: **Play / Pause / Step / Reset**. (Keyboard Space/S/R may remain
as accelerators, but the buttons are the required element.)

### 5.7 Edit / View toggle

A visible egui switch for edit-mode vs view-mode (replacing v1's Tab-only toggle;
Tab may remain as an accelerator).

## 6. Backend additions (the only ones)

`Routes::set_edge_thickness(id, d: f32) -> Result<(), ...>` and
`Routes::set_edge_weight(id, w: f32, plastic_aware) -> Result<(), ...>`:
mutate the existing `Edge` field after the same range validation `place_edge`
applies (`InvalidThickness`, `WeightOutOfRange`). The egui widgets also clamp, so
the setter's validation is a safety net, not the primary guard. Unit-tested.

Nothing else in the engine changes.

## 7. CLAUDE.md reserved-concept note (deliverable)

Record in CLAUDE.md (near §2 grid atomicity / the architecture section):

> **预留概念:格体积 = 体块组织(未来)。** 格子的体积将来用于体块组织(肌肉、血管
> 等);神经轴突是沿格点阵的**棱**走线。已知的将来对齐点:一旦体块占了格,
> no-overlap 的单位会从"格"(现在宪法 §2)变为"棱"。**现在不做体块、后端照跑,
> 不要为此重构路由** —— 留到将来跟体块一起对齐。

## 8. Out of scope (deferred)

- Neuron-param authoring (g_rebound / tau) + its backend wiring.
- Editing `plastic` / `mod_source` (→ Tier-3 plasticity task).
- Player-facing observation UI: camera feed, realistic creature, monitor mode,
  overlays (→ future Claude Design).
- Bulk tissue / cell-volume occupancy / strut-based no-overlap.

## 9. Testing

- The two thin setters get unit tests (in-range mutates, out-of-range rejects,
  NaN/inf rejects — mirroring the `place_edge` weight tests).
- Existing lib + oracle tests stay green (no engine change).
- The UI itself is **manually playtested by the user**; the rendering and
  interaction feel cannot be auto-verified by CC (no eyes on the window).

## 10. Invariants checked-not-changed

- Magnitude-only weight model (sign from source type) — setters keep non-negative
  ranges; sign never enters `weight`.
- `plastic` ⟺ `mod_source.is_some()` pairing — untouched (those fields read-only
  this round).
- Eval double-buffering / oracle parity — no engine change.

## 11. Discipline

egui's default look + the lattice lines are the target appearance. No art, color
design, spacing, or animation work. Elements complete, look rough. Surface before
expanding if any of these turn out to hide a pit: egui version compat (gate passed),
soma drawing, or the inspector edit → recompile seam.
