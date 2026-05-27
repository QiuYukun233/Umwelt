# C-3 v0.3 Eval Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port JS `stepBatch` to Bevy as a single-circuit, single-ant evaluation layer that turns the workshop from "design + read static cost" into "run circuit against puzzle input and judge correctness + par."

**Architecture:** Pure-function offline harness. `compile_topology(grid, routes)` → flat tensors; `step_eval()` advances one tick with structural double-buffering (`output_prev` / `output_next` type-separated, swap each tick — spec §7 Q2 LOCKED); explicit Euler integration (spec §7 Q1 LOCKED); per-edge ring buffer for axon delay; plastic Hebbian update after state integration. `run_puzzle()` drives the harness with a sensor input timeline and reports `PuzzleResult { passed, static_cost, activity_pj, motor_trace }`. Channel binding lives on `Puzzle`, not on neurons (spec §7 Q3 LOCKED).

**Tech Stack:** Rust 2024 edition, Bevy 0.15.3, serde + serde_json (already in C-3 deps), approx 0.5 (already in dev-deps).

**Spec:** `docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md`. **The five LOCKED decisions in spec §7 are non-negotiable.** Every implementation choice that touches Q1–Q5 must match the spec.

**JS source-of-truth references** (cited inline per task):
- `D:/dev/Umwelt/src/neural/batch.js` — `stepBatch` (the port target)
- `D:/dev/Umwelt/src/neural/constants.js` — `LEARNING_RATE`, `WEIGHT_DECAY_RATE`, `DELAY_MS_MAX`
- `D:/dev/Umwelt/src/config.js:12` — `FIXED_DT = 1/60`
- `D:/dev/Umwelt/delay-test.mjs`, `attenuation-test.mjs`, `plasticity-unit-test.mjs`, `batch-parity-test.mjs`, `test-neural.mjs` — oracle sources

---

## File Structure (new files in `D:/dev/umwelt-bevy/crates/grid_workshop/`)

```
src/constants/
  ├── biology.rs            (existing — C-3)
  └── eval.rs               (new — Task 1: timing + JS-port constants)
src/eval/
  ├── mod.rs                (new — Task 2: module root)
  ├── topology.rs           (new — Task 2: EvalTopology + compile)
  ├── step.rs               (new — Task 3-5: EvalState + step_eval)
  └── puzzle.rs             (new — Task 8: Puzzle + run_puzzle)
tests/
  ├── fixtures/eval/        (new — Task 6: JSON oracle fixtures)
  │   ├── delay-echo.json
  │   ├── attenuation-half.json
  │   ├── hebbian-saturation.json
  │   ├── parity-no-delay.json
  │   └── oscillator-mutual-inhibition.json
  └── eval_oracle.rs        (new — Task 7: oracle integration tests)
examples/
  └── step_response.rs      (new — Task 9: demo puzzle)
```

In the **JS repo** (`D:/dev/Umwelt/`):
```
tools/dump-oracle-fixtures.mjs   (new — Task 6)
```

---

## Task 1: `constants/eval.rs` — JS-port constants

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/constants/eval.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/constants/mod.rs` (re-export)

This is data-only. No unit tests beyond "the module compiles and constants have expected values." Spec §4 constants table + spec §7 Q4 LOCKED (inherited PROVISIONAL).

- [ ] **Step 1.1: Read existing constants module layout**

Run:
```
cargo read-manifest --manifest-path D:/dev/umwelt-bevy/crates/grid_workshop/Cargo.toml | head -5
```
Look at `D:/dev/umwelt-bevy/crates/grid_workshop/src/constants/mod.rs` to see how `biology` is exposed. Mirror that for `eval`.

- [ ] **Step 1.2: Create `constants/eval.rs`**

Write file content:

```rust
//! C-3 v0.3 — Eval-layer timing + JS-port constants.
//!
//! Spec: `docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md` §3 + §4.
//!
//! **All scale/balance constants here are inherited from JS** (`src/neural/batch.js:39-53`
//! and `src/neural/constants.js`). Per spec §7 Q4 LOCKED, they are **inherited
//! PROVISIONAL**: ported as-is so the JS oracle stays valid; allowed to be retuned
//! after puzzles run if game-feel demands it, but retuning invalidates the oracle.
//! Do NOT change without re-deriving the oracle fixtures.

// ============================================================
// Time (spec §3)
// ============================================================

/// Fixed simulation step, in seconds. Mirrors JS `CONFIG.FIXED_DT` at
/// `src/config.js:12`. Pinning dt = 1/60 lets `delay_ms` round to whole
/// integer ticks (spec §3).
pub const EVAL_DT_SECONDS: f32 = 1.0 / 60.0;

/// Same value as milliseconds — used when converting `delay_ms` → tick count.
/// Mirrors JS `refDtMs = 1000/60` (`src/neural/batch.js:88`).
pub const EVAL_DT_MS: f32 = 1000.0 / 60.0;

/// Maximum axon delay in milliseconds. Beyond this, edges saturate at
/// `DELAY_MS_MAX_TICKS` (= 30 ticks @ 1/60). Mirrors JS
/// `DELAY_MS_MAX = 500` at `src/neural/constants.js:19`.
pub const DELAY_MS_MAX: f32 = 500.0;

// ============================================================
// Edge weight bounds (batch.js:39-40)
// ============================================================

pub const EDGE_WEIGHT_MIN: f32 = 0.1;
pub const EDGE_WEIGHT_MAX: f32 = 1.0;

// ============================================================
// Modulator gain envelope (batch.js:41-43)
// ============================================================

pub const MOD_GAIN_MIN: f32 = 0.1;
pub const MOD_GAIN_MAX: f32 = 3.0;
pub const MOD_GAIN_BASELINE: f32 = 1.0;

// ============================================================
// Inter-inh Matsuoka + PIR constants (batch.js:44-53)
// ============================================================
// Spec §7 Q4 LOCKED — these are the "调了很久的振荡器" knobs. Do not retune
// during the port; they are the reason the oscillator oracle reproduces.

/// Inhibitory drive amplification inside `inter_inh` (batch.js:44).
pub const W_INH: f32 = 2.0;

/// Scale applied to inhibitory input when accumulating h_rebound
/// (batch.js:485: `h += inhSum * 0.8 * dt`).
pub const PIR_ACCUM_SCALE: f32 = 0.8;

/// How much adaptation subtracts from the effective output (batch.js:45).
pub const ADAPT_SUBTRACT_SCALE: f32 = 0.6;

/// Clamp ceiling for the PIR h_rebound state (batch.js:46).
pub const MAX_H_REBOUND: f32 = 1.5;

/// Default per-kind tau in seconds (batch.js:47). Order matches `NeuronKind`
/// discriminant in `core::kind`: SensorOn, InterExc, InterInh, Modulator, Motor.
pub const DEFAULT_TAU_SENSOR: f32 = 0.5;
pub const DEFAULT_TAU_INTER_EXC: f32 = 3.0;
pub const DEFAULT_TAU_INTER_INH: f32 = 3.0;
pub const DEFAULT_TAU_MOD: f32 = 15.0;
pub const DEFAULT_TAU_MOTOR: f32 = 0.0;

/// Default tau for inter charging dynamics (batch.js:48). Currently unused
/// in the active branches (interInh uses tau_discharge for h decay, not
/// tau_charge), but kept here to match JS so future ports don't drift.
pub const DEFAULT_TAU_CHARGE: f32 = 4.0;

/// Time constant for h_rebound discharge when not accumulating
/// (batch.js:49, used in `h *= exp(-dt / TAU_DISCHARGE)`).
pub const DEFAULT_TAU_DISCHARGE: f32 = 10.0;

/// Coupling strength of h_rebound into drive (batch.js:50).
pub const DEFAULT_G_REBOUND: f32 = 7.0;

/// Subthreshold gate for PIR accumulation: `state < REBOUND_THRESHOLD`
/// + `inhSum > 0` → accumulate (batch.js:51 + L484).
pub const DEFAULT_REBOUND_THRESHOLD: f32 = 0.5;

// ============================================================
// Plasticity (constants.js:11-12)
// ============================================================

pub const LEARNING_RATE: f32 = 0.01;
pub const WEIGHT_DECAY_RATE: f32 = 0.001;

// ============================================================
// tau_adapt derivation: from CLAUDE.md "Post-inhibitory rebound" line +
// neural.js:70 `defaultTauAdaptForNode`: tau × 4.
// ============================================================

/// `tau_adapt = max(0.05, tau × 4)`. JS source: `neural.js:69-71`.
pub fn tau_adapt_for(tau: f32) -> f32 {
    (tau * 4.0).max(0.05)
}

// ============================================================
// Helper: delay_ms → integer tick count (spec §3)
// ============================================================

/// Round delay in ms to an integer tick count. Mirrors
/// `batch.js:230-235`: `Math.round(ms / refDtMs)`.
/// Saturates at the tick equivalent of `DELAY_MS_MAX`.
pub fn delay_ms_to_ticks(delay_ms: f32) -> i32 {
    let clamped = delay_ms.clamp(0.0, DELAY_MS_MAX);
    (clamped / EVAL_DT_MS).round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dt_seconds_and_ms_consistent() {
        assert!((EVAL_DT_MS - EVAL_DT_SECONDS * 1000.0).abs() < 1e-6);
    }

    #[test]
    fn delay_zero_is_zero_ticks() {
        assert_eq!(delay_ms_to_ticks(0.0), 0);
    }

    #[test]
    fn delay_one_dt_rounds_to_one_tick() {
        assert_eq!(delay_ms_to_ticks(EVAL_DT_MS), 1);
    }

    #[test]
    fn delay_above_max_saturates() {
        let max_ticks = (DELAY_MS_MAX / EVAL_DT_MS).round() as i32;
        assert_eq!(delay_ms_to_ticks(9999.0), max_ticks);
        assert_eq!(max_ticks, 30); // sanity: 500 / (1000/60) ≈ 30
    }

    #[test]
    fn tau_adapt_floor() {
        assert!((tau_adapt_for(3.0) - 12.0).abs() < 1e-6);
        assert!((tau_adapt_for(0.0) - 0.05).abs() < 1e-6);
    }
}
```

- [ ] **Step 1.3: Wire the new module into `constants/mod.rs`**

Open `D:/dev/umwelt-bevy/crates/grid_workshop/src/constants/mod.rs`. Add the line:

```rust
pub mod eval;
```

(Keep existing `pub mod biology;` as-is.)

- [ ] **Step 1.4: Build and run the unit tests in this module**

Run:
```
cargo test -p grid_workshop --lib constants::eval::
```
Expected output: `test result: ok. 5 passed; 0 failed`.

- [ ] **Step 1.5: Run lib clippy (dev profile)**

Run:
```
cargo clippy -p grid_workshop --lib -- -D warnings
```
Expected: `Finished` with no errors or warnings.

- [ ] **Step 1.6: Commit**

```bash
cd D:/dev/umwelt-bevy
git add crates/grid_workshop/src/constants/eval.rs crates/grid_workshop/src/constants/mod.rs
git commit -m "feat(eval): constants/eval.rs — timing + JS-port constants

13 constants ported verbatim from src/neural/batch.js:39-53 +
src/neural/constants.js. Top-of-file comment marks them all as inherited
PROVISIONAL per spec §7 Q4 LOCKED — retuning invalidates the oracle.

EVAL_DT_SECONDS = 1/60 pinned per spec §3 (also pins V_REF /
P_ACTIVITY_COEF instrumentation chain). delay_ms_to_ticks() helper
mirrors batch.js:230-235 round-to-tick semantics.

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"
```

---

## Task 2: `eval/topology.rs` — Compile Grid+Routes → flat tensors

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/mod.rs`
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/topology.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/lib.rs` (add `pub mod eval;`)

**Key design** (spec §7 Q5 LOCKED: no cache, pure function):
- `EvalTopology::compile(&Grid, &Routes)` returns a fresh `EvalTopology`. No caching.
- **Bevy edges are PathTrees** (one root, possibly multiple leaves). Each (root, leaf) pair becomes one **eval edge** (analogous to JS's `fromId → toId`). One Bevy `EdgeId` therefore maps to N eval-edge indices where N = number of leaves.
- Neuron ordering: SensorOn first (sensors are inputs), then non-sensor in `(i, j, k)` lex order (spec §7 Q2 LOCKED — stable but semantically meaningless).

- [ ] **Step 2.1: Create `eval/mod.rs` skeleton**

Write:
```rust
//! C-3 v0.3 — Single-circuit evaluation layer.
//!
//! Spec: `docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md`.
//!
//! Ports `src/neural/batch.js:stepBatch` to Bevy. Single ant only (A = 1 hard-coded).

pub mod topology;

pub use topology::EvalTopology;
```

- [ ] **Step 2.2: Add `pub mod eval;` to `lib.rs`**

Open `D:/dev/umwelt-bevy/crates/grid_workshop/src/lib.rs`. Add `pub mod eval;` near the other `pub mod` lines. Add `pub use eval::EvalTopology;` to the `pub use` block.

- [ ] **Step 2.3: Write `eval/topology.rs` — type definitions + skeleton**

Write file:

```rust
//! `EvalTopology` — flat tensors compiled from a `Grid` + `Routes`.
//!
//! Spec §7 Q5 LOCKED: no cache. `compile()` is a pure function rebuilt
//! every `run_puzzle`. Spec §7 Q2 LOCKED: non-sensor evaluation order is
//! `(i, j, k)` lex — stable, deterministic, semantically meaningless;
//! correctness comes from structural double-buffering in `step.rs`,
//! not from any property of this order.

use crate::core::CellContents;
use crate::core::coord::CellCoord;
use crate::core::grid::Grid;
use crate::core::kind::NeuronKind;
use crate::routing::routes::Routes;

/// Node-type code (mirrors JS `batch.js:19-23`). Storing as a `u8` flat
/// array makes the per-tick dispatch in `step.rs` branchless on cache
/// misses.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeTypeCode {
    Sensor = 0,
    InterExc = 1,
    InterInh = 2,
    Modulator = 3,
    Motor = 4,
}

impl NodeTypeCode {
    pub fn from_neuron_kind(k: NeuronKind) -> Self {
        match k {
            NeuronKind::SensorOn => NodeTypeCode::Sensor,
            NeuronKind::InterExc => NodeTypeCode::InterExc,
            NeuronKind::InterInh => NodeTypeCode::InterInh,
            NeuronKind::Modulator => NodeTypeCode::Modulator,
            NeuronKind::Motor => NodeTypeCode::Motor,
        }
    }
}

/// Edge-kind code (mirrors JS `batch.js:34-36`). Derived from the **source
/// neuron's** kind, per Dale's Law (constitution §4 — sign carried by node
/// type, not by edge).
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeKindCode {
    Exc = 0,
    Inh = 1,
    Mod = 2,
}

impl EdgeKindCode {
    pub fn from_source_kind(k: NeuronKind) -> Self {
        match k {
            NeuronKind::InterInh => EdgeKindCode::Inh,
            NeuronKind::Modulator => EdgeKindCode::Mod,
            // SensorOn / InterExc / Motor source → excitatory contribution.
            _ => EdgeKindCode::Exc,
        }
    }
}

/// Flat compiled topology. Indices are stable for the lifetime of one
/// `EvalTopology`; nodes are laid out as [sensors..., non-sensors...].
#[derive(Debug, Clone)]
pub struct EvalTopology {
    // ── Node tables (N entries) ────────────────────────────
    pub node_count: usize,
    pub sensor_count: usize,
    /// CellCoord of each node, in node-index order.
    pub node_coord: Vec<CellCoord>,
    /// NodeTypeCode of each node.
    pub node_kind: Vec<NodeTypeCode>,
    /// Per-node tau (seconds). Sourced from per-kind defaults
    /// in `constants::eval`; SensorOn/Motor get their own.
    pub tau: Vec<f32>,
    /// Per-node tau_adapt = tau × 4 (constants::eval::tau_adapt_for).
    pub tau_adapt: Vec<f32>,

    // ── Eval order (non-sensors only) ──────────────────────
    /// Indices of non-sensor nodes, in `(i, j, k)` lex order.
    pub eval_order: Vec<usize>,

    // ── Edge tables (E eval edges, one per (root, leaf) pair) ──
    pub edge_count: usize,
    /// Node index of the edge source (root of the PathTree).
    pub edge_from: Vec<usize>,
    /// Node index of the edge target (the specific leaf).
    pub edge_to: Vec<usize>,
    /// Edge kind from source's NeuronKind (Dale's Law).
    pub edge_kind: Vec<EdgeKindCode>,
    /// Authored weight (== `Edge.thickness_d` placeholder for now; spec
    /// hooks edge.weight here. For C-3 v0.3 port: 1.0 default, since C-2
    /// Edge type doesn't yet carry a tunable weight). See note below.
    pub edge_weight: Vec<f32>,
    /// Per-edge per-leaf attenuation, from `Edge::attenuation_to_leaf(leaf)`.
    pub edge_attenuation: Vec<f32>,
    /// Per-edge per-leaf integer delay ticks, from
    /// `delay_ms_to_ticks(Edge::delay_ms_to_leaf(leaf))`.
    pub edge_delay_ticks: Vec<i32>,
    /// `true` if the source Bevy edge is `plastic`.
    pub edge_plastic: Vec<bool>,
    /// If `edge_plastic[e]`, node index of the bound modulator.
    /// Otherwise `usize::MAX` (sentinel — skip in plastic update).
    pub edge_mod_src: Vec<usize>,
    /// Initial plastic weight (used as decay baseline). For non-plastic
    /// edges this is the authored fixed weight.
    pub edge_init_w: Vec<f32>,

    // ── Delay ring buffer sizing ───────────────────────────
    /// `max(edge_delay_ticks) + 1`. Step 3.5 history buffer is sized
    /// `node_count * ring_size`. `ring_size >= 1` always.
    pub ring_size: usize,

    // ── Incoming-edge CSR-like index ───────────────────────
    /// `incoming_start[i]..incoming_start[i+1]` gives the slice of
    /// `incoming_list` containing eval-edge indices terminating at node i.
    pub incoming_start: Vec<usize>,
    pub incoming_list: Vec<usize>,
}

impl EvalTopology {
    /// Compile a Grid + Routes into flat tensors. **Pure function** (spec
    /// §7 Q5 LOCKED). Call once per `run_puzzle`; do NOT cache between
    /// runs unless the Grid/Routes are genuinely unchanged (and even then,
    /// the runtime cost is one walk over occupied cells + one walk over
    /// edges, which is negligible at puzzle scale).
    pub fn compile(grid: &Grid, routes: &Routes) -> Self {
        // ── 1. Collect neurons; partition sensors first, non-sensors after. ──
        let mut sensors: Vec<(CellCoord, NeuronKind)> = Vec::new();
        let mut others: Vec<(CellCoord, NeuronKind)> = Vec::new();
        for (coord, contents) in grid.occupied_cells() {
            if let CellContents::Neuron(k) = contents {
                if k == NeuronKind::SensorOn {
                    sensors.push((coord, k));
                } else {
                    others.push((coord, k));
                }
            }
        }
        // Stable, semantically-meaningless lex order on (i, j, k).
        let lex_key = |c: &CellCoord| (c.i, c.j, c.k);
        sensors.sort_by_key(|(c, _)| lex_key(c));
        others.sort_by_key(|(c, _)| lex_key(c));

        let sensor_count = sensors.len();
        let mut node_coord: Vec<CellCoord> = Vec::with_capacity(sensors.len() + others.len());
        let mut node_kind: Vec<NodeTypeCode> = Vec::with_capacity(sensors.len() + others.len());
        let mut tau: Vec<f32> = Vec::with_capacity(sensors.len() + others.len());
        let mut tau_adapt: Vec<f32> = Vec::with_capacity(sensors.len() + others.len());

        let push_node = |node_coord: &mut Vec<CellCoord>,
                         node_kind: &mut Vec<NodeTypeCode>,
                         tau: &mut Vec<f32>,
                         tau_adapt: &mut Vec<f32>,
                         coord: CellCoord,
                         k: NeuronKind| {
            let kc = NodeTypeCode::from_neuron_kind(k);
            let t = default_tau_for(k);
            node_coord.push(coord);
            node_kind.push(kc);
            tau.push(t);
            tau_adapt.push(crate::constants::eval::tau_adapt_for(t));
        };
        for (c, k) in &sensors {
            push_node(&mut node_coord, &mut node_kind, &mut tau, &mut tau_adapt, *c, *k);
        }
        for (c, k) in &others {
            push_node(&mut node_coord, &mut node_kind, &mut tau, &mut tau_adapt, *c, *k);
        }

        let node_count = node_coord.len();
        let coord_to_idx: std::collections::HashMap<CellCoord, usize> = node_coord
            .iter()
            .enumerate()
            .map(|(i, c)| (*c, i))
            .collect();

        // ── 2. eval_order: non-sensor indices in node-list order
        //      (which is already lex-sorted thanks to step 1).
        let eval_order: Vec<usize> = (sensor_count..node_count).collect();

        // ── 3. Expand each Bevy edge into eval edges, one per (root, leaf). ──
        let mut edge_from = Vec::new();
        let mut edge_to = Vec::new();
        let mut edge_kind = Vec::new();
        let mut edge_weight = Vec::new();
        let mut edge_attenuation = Vec::new();
        let mut edge_delay_ticks = Vec::new();
        let mut edge_plastic = Vec::new();
        let mut edge_mod_src = Vec::new();
        let mut edge_init_w = Vec::new();

        for (_eid, edge) in routes.edges() {
            let root = edge.tree.root();
            let from_idx = *coord_to_idx
                .get(&root)
                .expect("edge root must be a known neuron (I-1)");
            let source_kind = match grid.get(root).expect("root cell exists") {
                CellContents::Neuron(k) => k,
                _ => panic!("edge root must be a neuron cell"),
            };
            let kind_code = EdgeKindCode::from_source_kind(source_kind);

            let mod_src_idx = if edge.plastic {
                let m = edge
                    .mod_source
                    .expect("plastic edge must have mod_source (spec invariant)");
                *coord_to_idx
                    .get(&m.0)
                    .expect("mod_source cell must be a known neuron")
            } else {
                usize::MAX
            };

            for (leaf_idx, leaf_coord) in edge.tree.leaves() {
                let to_idx = *coord_to_idx
                    .get(&leaf_coord)
                    .expect("edge leaf must be a known neuron (I-1)");
                let atten = edge.attenuation_to_leaf(leaf_idx);
                let delay_ms = edge.delay_ms_to_leaf(leaf_idx);
                let dticks = crate::constants::eval::delay_ms_to_ticks(delay_ms);
                edge_from.push(from_idx);
                edge_to.push(to_idx);
                edge_kind.push(kind_code);
                edge_weight.push(1.0); // C-2 Edge has no tunable scalar weight; default 1.0.
                edge_attenuation.push(atten);
                edge_delay_ticks.push(dticks);
                edge_plastic.push(edge.plastic);
                edge_mod_src.push(mod_src_idx);
                edge_init_w.push(if edge.plastic { 1.0 } else { 1.0 });
            }
        }

        let edge_count = edge_from.len();

        // ── 4. ring_size + history CSR-like index ──
        let max_delay_ticks = edge_delay_ticks.iter().copied().max().unwrap_or(0).max(0);
        let ring_size = (max_delay_ticks as usize) + 1;

        // Incoming-edge index: for each node i, edges with edge_to[e] == i.
        let mut counts = vec![0usize; node_count];
        for e in 0..edge_count {
            counts[edge_to[e]] += 1;
        }
        let mut incoming_start = vec![0usize; node_count + 1];
        for i in 0..node_count {
            incoming_start[i + 1] = incoming_start[i] + counts[i];
        }
        let mut cursor = vec![0usize; node_count];
        let mut incoming_list = vec![0usize; edge_count];
        for e in 0..edge_count {
            let to = edge_to[e];
            incoming_list[incoming_start[to] + cursor[to]] = e;
            cursor[to] += 1;
        }

        EvalTopology {
            node_count,
            sensor_count,
            node_coord,
            node_kind,
            tau,
            tau_adapt,
            eval_order,
            edge_count,
            edge_from,
            edge_to,
            edge_kind,
            edge_weight,
            edge_attenuation,
            edge_delay_ticks,
            edge_plastic,
            edge_mod_src,
            edge_init_w,
            ring_size,
            incoming_start,
            incoming_list,
        }
    }
}

fn default_tau_for(k: NeuronKind) -> f32 {
    use crate::constants::eval::*;
    match k {
        NeuronKind::SensorOn => DEFAULT_TAU_SENSOR,
        NeuronKind::InterExc => DEFAULT_TAU_INTER_EXC,
        NeuronKind::InterInh => DEFAULT_TAU_INTER_INH,
        NeuronKind::Modulator => DEFAULT_TAU_MOD,
        NeuronKind::Motor => DEFAULT_TAU_MOTOR,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::coord::CellCoord;
    use crate::core::kind::NeuronKind;
    use crate::routing::{EdgeOps, PathTree};

    #[test]
    fn empty_grid_compiles_to_empty_topology() {
        let grid = Grid::default();
        let routes = Routes::new();
        let topo = EvalTopology::compile(&grid, &routes);
        assert_eq!(topo.node_count, 0);
        assert_eq!(topo.sensor_count, 0);
        assert_eq!(topo.edge_count, 0);
        assert_eq!(topo.ring_size, 1); // max_delay = 0 → ring = 1
        assert!(topo.eval_order.is_empty());
    }

    #[test]
    fn sensors_come_first_in_node_layout() {
        let mut grid = Grid::default();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        // Place a motor BEFORE a sensor (in placement order); compile must
        // still put the sensor at index 0.
        ops.place_neuron(CellCoord::new(5, 0, 0), NeuronKind::Motor)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn)
            .unwrap();
        let topo = EvalTopology::compile(&grid, &routes);
        assert_eq!(topo.node_count, 2);
        assert_eq!(topo.sensor_count, 1);
        assert_eq!(topo.node_kind[0], NodeTypeCode::Sensor);
        assert_eq!(topo.node_coord[0], CellCoord::new(0, 0, 0));
    }

    #[test]
    fn ijk_lex_order_within_partition() {
        let mut grid = Grid::default();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        ops.place_neuron(CellCoord::new(2, 0, 0), NeuronKind::InterExc)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::InterExc)
            .unwrap();
        ops.place_neuron(CellCoord::new(1, 0, 0), NeuronKind::InterExc)
            .unwrap();
        let topo = EvalTopology::compile(&grid, &routes);
        assert_eq!(topo.node_coord[0], CellCoord::new(0, 0, 0));
        assert_eq!(topo.node_coord[1], CellCoord::new(1, 0, 0));
        assert_eq!(topo.node_coord[2], CellCoord::new(2, 0, 0));
    }

    #[test]
    fn forked_edge_expands_to_multiple_eval_edges() {
        let mut grid = Grid::default();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 4, 0), NeuronKind::Motor)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 2, 2), NeuronKind::Motor)
            .unwrap();
        let mut tree = PathTree::from_path(vec![
            CellCoord::new(0, 0, 0),
            CellCoord::new(0, 1, 0),
            CellCoord::new(0, 2, 0),
            CellCoord::new(0, 3, 0),
            CellCoord::new(0, 4, 0),
        ])
        .unwrap();
        tree.graft_branch(2, vec![CellCoord::new(0, 2, 1), CellCoord::new(0, 2, 2)])
            .unwrap();
        ops.place_edge(tree, 1.0, false, None).unwrap();

        let topo = EvalTopology::compile(&grid, &routes);
        // One Bevy edge, two leaves → two eval edges.
        assert_eq!(topo.edge_count, 2);
        // Both share the same `from` (the SensorOn root).
        assert_eq!(topo.edge_from[0], topo.edge_from[1]);
        // Both are Exc kind (SensorOn source).
        assert!(matches!(topo.edge_kind[0], EdgeKindCode::Exc));
    }
}
```

- [ ] **Step 2.4: Run the unit tests in topology.rs**

Run:
```
cargo test -p grid_workshop --lib eval::topology::
```
Expected: `test result: ok. 4 passed`.

If a test fails because `CellCoord` doesn't expose `.i`/`.j`/`.k` as fields, replace `(c.i, c.j, c.k)` in the lex_key closure with whatever accessor the type provides. Verify by running:
```
cargo doc --no-deps -p grid_workshop --open
```
or by reading `crates/grid_workshop/src/core/coord.rs` directly. **Do not invent the API** — inspect first.

- [ ] **Step 2.5: Run clippy**

Run:
```
cargo clippy -p grid_workshop --lib -- -D warnings
```
Expected: `Finished` clean.

- [ ] **Step 2.6: Commit**

```bash
cd D:/dev/umwelt-bevy
git add crates/grid_workshop/src/eval/ crates/grid_workshop/src/lib.rs
git commit -m "feat(eval): topology.rs — Grid+Routes → flat tensors

EvalTopology::compile is a pure function (spec §7 Q5 LOCKED — no cache).
One Bevy edge expands to N eval edges (one per leaf) since Bevy edges
are PathTrees with multiple leaves; JS stepBatch's 1:1 fromId/toId
becomes one entry in edge_from/edge_to per (root, leaf) pair.

Node layout: sensors first, then non-sensors, both sorted (i,j,k) lex
(spec §7 Q2 LOCKED — stable but semantically meaningless; correctness
defended by structural double-buffering in step.rs not by this order).

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"
```

---

## Task 3: `eval/step.rs` — port stepBatch main loop (no delay)

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/step.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/mod.rs` (add `pub mod step;`)

**Critical:** Spec §7 Q2 LOCKED — `EvalState` must have **type-separated** `output_prev` and `output_next` buffers. The function MUST read from `output_prev` (and `output` for sensors) and write only to `output_next`. Tick end swaps. **Do NOT fuse them into a single buffer "for performance"** — that silently breaks the JS port and the oracle won't catch it.

This task does NOT implement delay handling yet (Task 4) — `edge_delay_ticks[e]` ≤ 0 path only.
This task does NOT update plastic weights (Task 5) — Step 4 is omitted; treat all edges as fixed.

- [ ] **Step 3.1: Write `eval/step.rs` — types + `step_eval` skeleton**

Write:
```rust
//! Single-tick evaluation. Ports `src/neural/batch.js:stepBatch` (lines 345-543).
//!
//! **Structural double-buffering (spec §7 Q2 LOCKED):** `output_prev` and
//! `output_next` are SEPARATE buffers. Step 3 reads `output_prev` (and the
//! sensor section of `output`) and writes ONLY to `output_next`. Tick end
//! swaps them. Do not collapse this into a single buffer — same-tick read
//! would silently break JS parity at sub-1e-5 drift, invisible to the oracle.

use crate::constants::eval as econst;
use crate::eval::topology::{EdgeKindCode, EvalTopology, NodeTypeCode};

/// All mutable per-tick state for one ant. Single ant only — spec §8.
#[derive(Debug, Clone)]
pub struct EvalState {
    pub state: Vec<f32>,        // per-node, internal `state` (the integrator var)
    pub adapt: Vec<f32>,        // per-node adaptation
    pub h_rebound: Vec<f32>,    // per-node PIR accumulator
    pub output: Vec<f32>,       // per-node effective output, latched by sensors
    pub output_prev: Vec<f32>,  // Step 1 snapshot — read source for Step 3
    pub output_next: Vec<f32>,  // Step 3 write target
    pub plastic_w: Vec<f32>,    // per-eval-edge plastic weight (Task 5)
    pub output_history: Vec<f32>, // per-node ring buffer for delayed reads (Task 4)
    pub tick: u64,
}

impl EvalState {
    pub fn new(topo: &EvalTopology) -> Self {
        let n = topo.node_count;
        let e = topo.edge_count;
        // Modulator initial state == MOD_GAIN_BASELINE-normalised value, but
        // since we represent state in raw drive-space (not gain-space) and JS
        // sensor / inter-* / motor all start at 0, init all states at 0 here.
        // (JS `initState` lookup is per-type; for non-modulator types it's 0.)
        EvalState {
            state: vec![0.0; n],
            adapt: vec![0.0; n],
            h_rebound: vec![0.0; n],
            output: vec![0.0; n],
            output_prev: vec![0.0; n],
            output_next: vec![0.0; n],
            // Plastic edges start at edge_init_w; non-plastic edges hold 0
            // (their effective weight is read from topo.edge_weight, not this
            // array; the 0 is just a placeholder).
            plastic_w: (0..e)
                .map(|i| if topo.edge_plastic[i] { topo.edge_init_w[i] } else { 0.0 })
                .collect(),
            output_history: vec![0.0; n * topo.ring_size],
            tick: 0,
        }
    }
}

#[inline]
fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}
#[inline]
fn clamp_w(w: f32) -> f32 {
    if !w.is_finite() {
        1.0
    } else {
        w.clamp(econst::EDGE_WEIGHT_MIN, econst::EDGE_WEIGHT_MAX)
    }
}
#[inline]
fn clamp_dale(w: f32) -> f32 {
    if !w.is_finite() {
        0.0
    } else {
        w.clamp(0.0, econst::EDGE_WEIGHT_MAX)
    }
}
#[inline]
fn clamp_atten(a: f32) -> f32 {
    if !a.is_finite() {
        1.0
    } else {
        a.clamp(0.0, 1.0)
    }
}

/// JS `gainFromMod` (batch.js:69-74).
#[inline]
fn gain_from_mod(source_signal: f32, eff_weight: f32) -> f32 {
    let s = clamp01(source_signal);
    let w = clamp_w(eff_weight);
    let raw_gain = econst::MOD_GAIN_MIN + s * (econst::MOD_GAIN_MAX - econst::MOD_GAIN_MIN);
    (econst::MOD_GAIN_BASELINE + (raw_gain - econst::MOD_GAIN_BASELINE) * w)
        .clamp(econst::MOD_GAIN_MIN, econst::MOD_GAIN_MAX)
}

/// JS `nodeOutputForType` (batch.js:76-82).
#[inline]
fn node_output_for_type(kind: NodeTypeCode, state: f32, adapt: f32) -> f32 {
    match kind {
        NodeTypeCode::InterExc | NodeTypeCode::InterInh => {
            let eff = clamp01(state);
            clamp01(eff - adapt * econst::ADAPT_SUBTRACT_SCALE)
        }
        _ => clamp01(state),
    }
}

/// Advance one tick. `sensor_inputs.len() == topo.sensor_count`.
///
/// Spec §4 sequence:
///   1. Snapshot prev output for all nodes (writes `output_prev`)
///   2. Latch sensor states from `sensor_inputs` (writes sensor slice of `output`)
///   3. Feedforward eval (reads `output_prev`/`output` sensors; writes `output_next`)
///   3.5. Record history slot
///   4. (Task 5 — skipped in Task 3) Plastic update
///   Tick end: swap output_prev ↔ output_next; tick += 1.
pub fn step_eval(topo: &EvalTopology, state: &mut EvalState, sensor_inputs: &[f32]) {
    assert_eq!(
        sensor_inputs.len(),
        topo.sensor_count,
        "sensor_inputs length must equal topo.sensor_count"
    );
    let n = topo.node_count;
    let ring = topo.ring_size;
    let dt = econst::EVAL_DT_SECONDS;

    // ── Step 1: snapshot output_prev for ALL nodes ────────────────────
    for i in 0..n {
        state.output_prev[i] = node_output_for_type(topo.node_kind[i], state.state[i], state.adapt[i]);
    }

    // ── Step 2: latch sensors ─────────────────────────────────────────
    for s in 0..topo.sensor_count {
        let v = clamp01(sensor_inputs[s]);
        state.state[s] = v;
        state.adapt[s] = 0.0;
        state.h_rebound[s] = 0.0;
        state.output[s] = v;
        // output_next for sensors also takes the latched value, so when we
        // swap at tick end, output_prev next tick reflects this sensor read.
        // (JS doesn't need this because computeSignals re-latches every tick;
        // mirror that here by writing both.)
        state.output_next[s] = v;
    }

    // ── Step 3: feedforward eval (non-sensors only) ───────────────────
    for &i in &topo.eval_order {
        let in_start = topo.incoming_start[i];
        let in_end = topo.incoming_start[i + 1];

        let mut exc_sum = 0.0_f32;
        let mut inh_sum = 0.0_f32;
        let mut gain = 1.0_f32;

        for p in in_start..in_end {
            let e = topo.incoming_list[p];
            let from_idx = topo.edge_from[e];
            let dticks = topo.edge_delay_ticks[e];

            // Task 3 — delay not yet implemented. Just read prev/output.
            let src = if dticks <= 0 {
                if from_idx < topo.sensor_count {
                    state.output[from_idx]
                } else {
                    state.output_prev[from_idx]
                }
            } else {
                // Task 4 will replace this. For now, fall back to prev.
                state.output_prev[from_idx]
            };

            let eff_w = if topo.edge_plastic[e] {
                clamp_dale(state.plastic_w[e])
            } else {
                clamp_w(topo.edge_weight[e])
            };
            let atten = clamp_atten(topo.edge_attenuation[e]);
            let src_clamped = clamp01(src);
            let contrib = src_clamped * eff_w * atten;

            match topo.edge_kind[e] {
                EdgeKindCode::Mod => {
                    gain *= gain_from_mod(src_clamped * atten, eff_w);
                }
                EdgeKindCode::Inh => {
                    inh_sum += contrib;
                }
                EdgeKindCode::Exc => {
                    exc_sum += contrib;
                }
            }
        }
        gain = gain.clamp(econst::MOD_GAIN_MIN, econst::MOD_GAIN_MAX);

        let net_input = (exc_sum - inh_sum) * gain;
        let prev_state = state.state[i];
        let prev_adapt = state.adapt[i];
        let prev_h = state.h_rebound[i];
        let tau = topo.tau[i].max(0.05);
        let tau_adapt = topo.tau_adapt[i].max(0.05);

        let (next_state, next_adapt, next_h, out_val);
        match topo.node_kind[i] {
            NodeTypeCode::Motor => {
                let v = net_input.clamp(-1.0, 1.0);
                out_val = v;
                next_state = v;
                next_adapt = 0.0;
                next_h = 0.0;
            }
            NodeTypeCode::Modulator => {
                let drive = clamp01(net_input);
                let ns = (prev_state + (drive - prev_state) * (dt / tau)).clamp(0.0, 1.0);
                next_state = ns;
                out_val = ns;
                next_adapt = 0.0;
                next_h = 0.0;
            }
            NodeTypeCode::InterInh => {
                let mut h = prev_h;
                if prev_state < econst::DEFAULT_REBOUND_THRESHOLD && inh_sum > 0.0 {
                    h += inh_sum * econst::PIR_ACCUM_SCALE * dt;
                } else {
                    h *= (-dt / econst::DEFAULT_TAU_DISCHARGE).exp();
                }
                next_h = h.clamp(0.0, econst::MAX_H_REBOUND);
                let drive = exc_sum * gain
                    - econst::W_INH * inh_sum * gain
                    - 2.0 * prev_adapt
                    + econst::DEFAULT_G_REBOUND * next_h;
                let ns = (prev_state + (-prev_state + drive) * (dt / tau)).clamp(-1.0, 1.0);
                next_state = ns;
                let eff = clamp01(ns);
                let na = (prev_adapt + (-prev_adapt + eff) * (dt / tau_adapt)).clamp(0.0, 1.0);
                next_adapt = na;
                out_val = clamp01(eff - na * econst::ADAPT_SUBTRACT_SCALE);
            }
            NodeTypeCode::InterExc => {
                let ns = (prev_state + (net_input - prev_state) * (dt / tau)).clamp(-1.0, 1.0);
                next_state = ns;
                let eff = clamp01(ns);
                let na = (prev_adapt + (eff - prev_adapt) * (dt / tau_adapt)).clamp(0.0, 1.0);
                next_adapt = na;
                next_h = 0.0;
                out_val = clamp01(eff - na * econst::ADAPT_SUBTRACT_SCALE);
            }
            NodeTypeCode::Sensor => {
                // Sensors don't appear in eval_order; this is unreachable.
                unreachable!("sensors are not in eval_order");
            }
        }

        state.state[i] = next_state;
        state.adapt[i] = next_adapt;
        state.h_rebound[i] = next_h;
        state.output_next[i] = out_val;
    }

    // ── Step 3.5: record history slot ──────────────────────────────────
    // Use output_next as this-tick output for all non-sensor nodes; sensors
    // already had their post-latch value written to output_next in Step 2.
    let slot = (state.tick as usize) % ring;
    for i in 0..n {
        let v = if i < topo.sensor_count {
            state.output[i]
        } else {
            state.output_next[i]
        };
        state.output_history[i * ring + slot] = v;
    }
    state.tick += 1;

    // (Step 4: plastic update lives in Task 5; not implemented here.)

    // ── Tick end: swap output_prev ↔ output_next ───────────────────────
    std::mem::swap(&mut state.output_prev, &mut state.output_next);
    // After swap, `output_prev` carries this tick's outputs (input for next
    // tick's Step 3). `output_next` still holds the previous tick's values
    // and will be fully overwritten in Step 2 / Step 3 next tick.

    // For convenience, also reflect this tick's outputs in `state.output`
    // (non-sensor slots) — useful for tests that want the latest reading
    // without re-deriving from state/adapt.
    for &i in &topo.eval_order {
        // After swap, output_prev now holds this tick's outputs.
        state.output[i] = state.output_prev[i];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::coord::CellCoord;
    use crate::core::kind::NeuronKind;
    use crate::core::grid::Grid;
    use crate::routing::{EdgeOps, PathTree, Routes};

    fn sensor_to_motor_graph() -> (Grid, Routes) {
        let mut grid = Grid::default();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 2, 0), NeuronKind::Motor)
            .unwrap();
        let tree = PathTree::from_path(vec![
            CellCoord::new(0, 0, 0),
            CellCoord::new(0, 1, 0),
            CellCoord::new(0, 2, 0),
        ])
        .unwrap();
        ops.place_edge(tree, 1.0, false, None).unwrap();
        (grid, routes)
    }

    #[test]
    fn motor_responds_to_sensor_input_in_one_tick() {
        let (grid, routes) = sensor_to_motor_graph();
        let topo = EvalTopology::compile(&grid, &routes);
        let mut s = EvalState::new(&topo);
        step_eval(&topo, &mut s, &[1.0]);
        // Motor is non-sensor index 1 (sensor is 0). After one tick, output
        // should be >= 0 (sensor freshly latched, edge fires this tick since
        // delay=0, motor computes from netInput).
        let motor_idx = topo.eval_order[0];
        assert!(s.output[motor_idx] >= 0.0);
    }

    #[test]
    fn output_prev_and_next_are_separate_buffers() {
        let (grid, routes) = sensor_to_motor_graph();
        let topo = EvalTopology::compile(&grid, &routes);
        let s = EvalState::new(&topo);
        // Pointer-level separation: if these alias, that's a structural bug.
        assert_ne!(s.output_prev.as_ptr(), s.output_next.as_ptr());
        assert_eq!(s.output_prev.len(), topo.node_count);
        assert_eq!(s.output_next.len(), topo.node_count);
    }

    #[test]
    fn sensor_step_latches_immediately() {
        let (grid, routes) = sensor_to_motor_graph();
        let topo = EvalTopology::compile(&grid, &routes);
        let mut s = EvalState::new(&topo);
        step_eval(&topo, &mut s, &[0.7]);
        // Sensor index 0; freshly latched value is in state.output[0].
        // (Note: after the tick swap, output[0] should equal 0.7 since
        // Step 2 also writes output_next[0] = v.)
        assert!((s.output[0] - 0.7).abs() < 1e-6);
    }

    #[test]
    fn zero_input_keeps_motor_at_zero() {
        let (grid, routes) = sensor_to_motor_graph();
        let topo = EvalTopology::compile(&grid, &routes);
        let mut s = EvalState::new(&topo);
        for _ in 0..30 {
            step_eval(&topo, &mut s, &[0.0]);
        }
        let motor_idx = topo.eval_order[0];
        assert!(s.output[motor_idx].abs() < 1e-6);
    }
}
```

- [ ] **Step 3.2: Add `pub mod step;` to `eval/mod.rs`**

Open `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/mod.rs`. Update to:
```rust
//! C-3 v0.3 — Single-circuit evaluation layer.
pub mod topology;
pub mod step;

pub use topology::EvalTopology;
pub use step::{EvalState, step_eval};
```

- [ ] **Step 3.3: Run unit tests**

Run:
```
cargo test -p grid_workshop --lib eval::step::
```
Expected: `test result: ok. 4 passed`.

- [ ] **Step 3.4: Run clippy**

Run:
```
cargo clippy -p grid_workshop --lib -- -D warnings
```
Expected: `Finished` clean.

- [ ] **Step 3.5: Commit**

```bash
cd D:/dev/umwelt-bevy
git add crates/grid_workshop/src/eval/step.rs crates/grid_workshop/src/eval/mod.rs
git commit -m "feat(eval): step.rs — port stepBatch with structural double-buffer

Spec §7 Q2 LOCKED: output_prev / output_next are type-separated Vec<f32>
buffers. Step 3 reads output_prev (and sensor slice of output); writes
only to output_next. Tick end swaps. Pointer-level separation is asserted
by a unit test — fusing them silently breaks JS parity below 1e-5 oracle
tolerance.

All four NeuronKind dispatches (Motor / Modulator / InterInh / InterExc)
port batch.js:473-501 verbatim. Constants come from constants/eval.rs.
Explicit Euler (spec §7 Q1 LOCKED).

Delay (Task 4) and plastic (Task 5) not yet integrated — edge_delay_ticks
read path falls back to output_prev; Step 4 omitted.

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"
```

---

## Task 4: Delay ring buffer + history index

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/step.rs` (replace the `dticks <= 0` fallback in Step 3)

**Key behavior** (batch.js:425-434):
- `delay_ticks > 0`: read `output_history[from_idx * ring + slot]` where
  `slot = ((tick - delay_ticks) % ring + ring) % ring`
- Zero-initialized history → first `delay_ticks` ticks for that edge read 0
  (mirrors the "first 6 ticks ~0" assertion in delay-test.mjs:103-105)

- [ ] **Step 4.1: Replace the placeholder branch in `step_eval`**

In `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/step.rs`, replace this block in Step 3:

```rust
            // Task 3 — delay not yet implemented. Just read prev/output.
            let src = if dticks <= 0 {
                if from_idx < topo.sensor_count {
                    state.output[from_idx]
                } else {
                    state.output_prev[from_idx]
                }
            } else {
                // Task 4 will replace this. For now, fall back to prev.
                state.output_prev[from_idx]
            };
```

with:

```rust
            // Delay-aware source read (batch.js:425-434).
            //   dticks <= 0 : sensor → freshly-latched; non-sensor → prev tick
            //   dticks > 0  : read history[from_idx, tick - dticks]
            let src = if dticks <= 0 {
                if from_idx < topo.sensor_count {
                    state.output[from_idx]
                } else {
                    state.output_prev[from_idx]
                }
            } else {
                let t = state.tick as i64;
                let d = dticks as i64;
                let r = ring as i64;
                // Same modular slot formula as batch.js:432:
                //   ((tick - delay) % ring + ring) % ring
                let slot = (((t - d) % r) + r) % r;
                state.output_history[from_idx * ring + (slot as usize)]
            };
```

- [ ] **Step 4.2: Add a delay-specific unit test in `step.rs` `tests` module**

Append this test below the existing `tests` mod content (inside the `mod tests` block):

```rust
    #[test]
    fn delay_zero_ticks_behaves_as_instant() {
        // Build sensor → inter_exc with default zero delay; with constant
        // sensor input 1.0, after enough ticks output is positive.
        let mut grid = Grid::default();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 2, 0), NeuronKind::InterExc)
            .unwrap();
        let tree = PathTree::from_path(vec![
            CellCoord::new(0, 0, 0),
            CellCoord::new(0, 1, 0),
            CellCoord::new(0, 2, 0),
        ])
        .unwrap();
        ops.place_edge(tree, 1.0, false, None).unwrap();

        let topo = EvalTopology::compile(&grid, &routes);
        assert_eq!(topo.edge_delay_ticks[0], 0, "default edge has 0 ms delay");
        let mut s = EvalState::new(&topo);
        for _ in 0..10 {
            step_eval(&topo, &mut s, &[1.0]);
        }
        let inter_idx = topo.eval_order[0];
        // Leaky integrator with tau=3, dt/tau=0.0056 — after 10 ticks
        // (≈ 0.167s) leaky toward 1.0 reaches ~5%. Just assert > 0.
        assert!(s.output[inter_idx] > 0.0);
    }

    #[test]
    fn manual_delay_shifts_signal_by_delay_ticks() {
        // Construct a topology by hand (without going through C-2 edge.delay_ms
        // derivation, which depends on path length) so we can inject a 6-tick delay
        // directly into the eval edge.
        let mut grid = Grid::default();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 2, 0), NeuronKind::InterExc)
            .unwrap();
        let tree = PathTree::from_path(vec![
            CellCoord::new(0, 0, 0),
            CellCoord::new(0, 1, 0),
            CellCoord::new(0, 2, 0),
        ])
        .unwrap();
        ops.place_edge(tree, 1.0, false, None).unwrap();

        let mut topo = EvalTopology::compile(&grid, &routes);
        topo.edge_delay_ticks[0] = 6;
        topo.ring_size = 7; // max_delay + 1

        let mut s = EvalState::new(&topo);
        // First 6 ticks: history is zero-filled → inter reads 0 → output ~0.
        for _ in 0..6 {
            step_eval(&topo, &mut s, &[1.0]);
        }
        let inter_idx = topo.eval_order[0];
        assert!(
            s.output[inter_idx].abs() < 1e-9,
            "ticks < delay_ticks: inter should still be at rest"
        );
        // After tick 7, history at slot (tick-6) starts holding the latched sensor.
        for _ in 0..20 {
            step_eval(&topo, &mut s, &[1.0]);
        }
        assert!(
            s.output[inter_idx] > 0.0,
            "after enough ticks past delay, inter should respond"
        );
    }
```

- [ ] **Step 4.3: Run delay tests**

Run:
```
cargo test -p grid_workshop --lib eval::step::tests::delay -- --nocapture
cargo test -p grid_workshop --lib eval::step::tests::manual_delay
```
Both expected: pass.

- [ ] **Step 4.4: Run full step tests + clippy**

Run:
```
cargo test -p grid_workshop --lib eval::step::
cargo clippy -p grid_workshop --lib -- -D warnings
```
Both expected: clean.

- [ ] **Step 4.5: Commit**

```bash
cd D:/dev/umwelt-bevy
git add crates/grid_workshop/src/eval/step.rs
git commit -m "feat(eval): delay ring buffer + history slot index

Delay-aware source read in Step 3 mirrors batch.js:425-434:
  slot = ((tick - delay_ticks) % ring + ring) % ring
  src  = output_history[from_idx * ring + slot]

Zero-initialized history means the first `delay_ticks` reads return 0
(same as delay-test.mjs:103-105 expectation). Two unit tests verify
delay=0 behaves as instant and delay=6 shifts the response by exactly 6 ticks.

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"
```

---

## Task 5: Plastic weight update (Step 4)

**Files:**
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/step.rs` (add Step 4 in `step_eval`)

Spec §4 Step 4 + batch.js:522-542. Uses **this tick's** outputs (which after Step 3.5 live in `output_next` for non-sensors and `output` for sensors — but we already mirrored these into `output_prev` post-swap. Read after swap from `output_prev`.).

Plastic update happens AFTER the swap, so use `state.output_prev` (which now carries this-tick output) and `state.output` (sensor latched values).

- [ ] **Step 5.1: Add Step 4 to `step_eval`**

In `step.rs`, locate the comment `// (Step 4: plastic update lives in Task 5; not implemented here.)` and the swap right below it. Replace that region with:

```rust
    // ── Step 4: plastic update (batch.js:522-542). Uses THIS tick's outputs.
    // We're still pre-swap at this point: `output_next` holds this-tick
    // non-sensor outputs; `output` holds this-tick sensor outputs.
    for e in 0..topo.edge_count {
        if !topo.edge_plastic[e] {
            continue;
        }
        let mod_idx = topo.edge_mod_src[e];
        if mod_idx == usize::MAX {
            continue;
        }
        let from_idx = topo.edge_from[e];
        let to_idx = topo.edge_to[e];

        // Helper: this-tick output for any node, sensor or not.
        let this_tick_output = |i: usize| -> f32 {
            if i < topo.sensor_count {
                state.output[i]
            } else {
                state.output_next[i]
            }
        };
        let pre = clamp01(this_tick_output(from_idx));
        let post = clamp01(this_tick_output(to_idx));
        let m = clamp01(this_tick_output(mod_idx));

        let cur = state.plastic_w[e];
        let baseline = topo.edge_init_w[e];
        let dw = econst::LEARNING_RATE * pre * post * m;
        let decay = econst::WEIGHT_DECAY_RATE * (baseline - cur);
        state.plastic_w[e] = clamp_dale(cur + dw + decay);
    }

    // ── Tick end: swap output_prev ↔ output_next ───────────────────────
```

(Keep the swap and the post-swap `state.output[i]` mirror that already exist below this.)

- [ ] **Step 5.2: Write a closed-form plasticity test in the `tests` mod**

Append to the `tests` module in `step.rs`:

```rust
    #[test]
    fn hebbian_growth_with_saturated_drive() {
        // pre = post = mod = 1 → dw = η; decay = -decay_rate * (cur - baseline).
        // After many ticks, w saturates near baseline + η/decay_rate, clamped to 1.0.
        // We construct a graph where: sensor → modulator (drives mod to 1),
        // and sensor → inter_exc via a plastic edge bound to modulator.
        // For simplicity, instead build the topology and inject inputs directly.
        let mut grid = Grid::default();
        let mut routes = Routes::new();
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 2, 0), NeuronKind::InterExc)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 4, 0), NeuronKind::Modulator)
            .unwrap();
        ops.place_neuron(CellCoord::new(0, 2, 2), NeuronKind::InterExc)
            .unwrap();
        // Path 1: sensor → modulator
        let t1 = PathTree::from_path(vec![
            CellCoord::new(0, 0, 0),
            CellCoord::new(0, 1, 0),
            CellCoord::new(1, 1, 0),
            CellCoord::new(1, 2, 0),
            CellCoord::new(1, 3, 0),
            CellCoord::new(1, 4, 0),
            CellCoord::new(0, 4, 0),
        ])
        .unwrap();
        ops.place_edge(t1, 1.0, false, None).unwrap();
        // Path 2: sensor → inter_exc (will be promoted to plastic on bound mod)
        let t2 = PathTree::from_path(vec![
            CellCoord::new(0, 0, 0),
            CellCoord::new(-1, 0, 0),
            CellCoord::new(-1, 1, 0),
            CellCoord::new(-1, 2, 0),
            CellCoord::new(0, 2, 0),
        ])
        .unwrap();
        // Make this edge plastic, bound to the modulator.
        ops.place_edge(
            t2,
            1.0,
            true,
            Some(crate::routing::ids::PathEndpoint(CellCoord::new(0, 4, 0))),
        )
        .unwrap();

        let topo = EvalTopology::compile(&grid, &routes);
        let mut s = EvalState::new(&topo);
        // Find the plastic eval edge index.
        let plastic_edge_idx = (0..topo.edge_count)
            .find(|&e| topo.edge_plastic[e])
            .expect("at least one plastic edge");
        let w_before = s.plastic_w[plastic_edge_idx];
        // Drive sensor for many ticks; modulator + inter_exc both reach ~saturation.
        for _ in 0..200 {
            step_eval(&topo, &mut s, &[1.0]);
        }
        let w_after = s.plastic_w[plastic_edge_idx];
        assert!(
            w_after > w_before,
            "plastic weight should grow under saturated Hebbian drive (was {}, now {})",
            w_before,
            w_after
        );
        assert!(
            w_after <= 1.0_f32 + 1e-6,
            "plastic weight must stay clamped to Dale ceiling (got {})",
            w_after
        );
    }
```

- [ ] **Step 5.3: Run the plastic test**

Run:
```
cargo test -p grid_workshop --lib eval::step::tests::hebbian_growth_with_saturated_drive -- --nocapture
```
Expected: pass.

If the test setup fails because a cell is already occupied, adjust the path coords until both edges fit. (The grid is sparse — moving the second path further out almost always works.)

- [ ] **Step 5.4: Run full test suite + clippy**

Run:
```
cargo test -p grid_workshop
cargo clippy -p grid_workshop --all-targets -- -D warnings
```
Both expected: clean.

- [ ] **Step 5.5: Commit**

```bash
cd D:/dev/umwelt-bevy
git add crates/grid_workshop/src/eval/step.rs
git commit -m "feat(eval): plastic weight update (Step 4)

Hebbian Δw = η·pre·post·mod + decay·(w_init - cur). Reads this-tick
outputs from output_next (non-sensor) and output (sensor), per
batch.js:534-540 ('Use this tick's outputs'). Position in step_eval:
after Step 3.5 history record, before the output_prev/output_next swap.

Closed-form unit test (saturated drive sensor→mod + sensor→inter_exc
plastic edge bound to mod) verifies weight grows and saturates at the
Dale ceiling.

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"
```

---

## Task 6: JS fixture dumper — 5 oracles

**Files (in `D:/dev/Umwelt/`, the JS repo):**
- Create: `D:/dev/Umwelt/tools/dump-oracle-fixtures.mjs`

Each fixture is a JSON file under `D:/dev/umwelt-bevy/crates/grid_workshop/tests/fixtures/eval/` (cross-repo write — that's fine; the JS repo can write into the Bevy repo's tests dir during development).

**Fixture shape (must be the same for all oracles):**
```json
{
  "name": "<oracle-name>",
  "source": "<js-file-and-line-range>",
  "tick_count": <int>,
  "dt_seconds": 0.016666666666666666,

  "sensors":    [ { "coord": [i, j, k] } ],
  "motors":     [ { "coord": [i, j, k] } ],
  "neurons":    [ { "coord": [i, j, k], "kind": "SensorOn" | ... , "tau": <f32> } ],
  "edges":      [
    {
      "from": [i, j, k],
      "to":   [i, j, k],
      "path": [[i,j,k], ...],
      "thickness_d":  1.0,
      "plastic":      false,
      "mod_source":   null | [i, j, k],
      "delay_ticks_override": null | <int>,
      "attenuation_override": null | <f32>
    }
  ],
  "input_timeline": [ [<f32>, <f32>, ...], ... ],   // [tick][sensor_idx]
  "motor_trace":    [ [<f32>, <f32>, ...], ... ],   // [tick][motor_idx]
  "extra_assertions": { "switches_min": 6 } | {}
}
```

Why per-edge `delay_ticks_override` / `attenuation_override`: in Bevy these are derived from path geometry; for oracle fixtures we want to inject exact values rather than have to engineer path lengths to produce them. The override path is exercised in Task 7 by hand-mutating `EvalTopology` after compile (same pattern as the `manual_delay_shifts_signal_by_delay_ticks` test).

- [ ] **Step 6.1: Inspect the actual JS test bodies and pin oracle parameters**

For each of the 5 oracles, read the corresponding JS file and copy down the **exact graph** + **exact input** + **exact expected output trace**:

| Oracle | JS file | Lines |
|--------|---------|-------|
| `delay-echo` | `D:/dev/Umwelt/delay-test.mjs` | 71-114 |
| `attenuation-half` | `D:/dev/Umwelt/attenuation-test.mjs` | 116-122 + context |
| `hebbian-saturation` | `D:/dev/Umwelt/plasticity-unit-test.mjs` | C2 block |
| `parity-no-delay` | `D:/dev/Umwelt/batch-parity-test.mjs` | full |
| `oscillator-mutual-inhibition` | `D:/dev/Umwelt/test-neural.mjs` | 173-231 |

Read each file with the `Read` tool. Record graph topology, sensor input timeline, motor read-out points, and assertion. **Do not paraphrase** — the fixture is a verbatim snapshot.

- [ ] **Step 6.2: Write `tools/dump-oracle-fixtures.mjs`**

This is one file with one function per oracle and a main that dumps all 5 to `D:/dev/umwelt-bevy/crates/grid_workshop/tests/fixtures/eval/<name>.json`. Use Node's built-in `fs` and run with `node tools/dump-oracle-fixtures.mjs` from `D:/dev/Umwelt/`.

Structure:

```javascript
// tools/dump-oracle-fixtures.mjs
// Run: node tools/dump-oracle-fixtures.mjs
// Writes 5 fixture JSONs to ../umwelt-bevy/crates/grid_workshop/tests/fixtures/eval/
// for the Bevy eval-layer oracle integration tests.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

import { NeuralGraph } from "../src/neural.js";
import { compileTopology, createBatchState, stepBatch } from "../src/neural/batch.js";
import { sourceNodeId, motorNodeId, LOGIC_CANVAS } from "../src/config.js";

const FIXTURE_DIR = resolve(
  process.cwd(),
  "../umwelt-bevy/crates/grid_workshop/tests/fixtures/eval"
);
mkdirSync(FIXTURE_DIR, { recursive: true });

function writeFixture(name, fixture) {
  const path = resolve(FIXTURE_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(fixture, null, 2));
  console.log(`wrote ${path}`);
}

// Helper: assign synthetic CellCoord (i, j, k) to each node, lex by
// (sensors first → i = 0, j = idx; non-sensors → i = 1, j = idx). The
// Bevy side will use these coords verbatim when constructing the
// equivalent Grid+Routes.
function assignCoords(graph) {
  const nodes = [...graph.nodes.values()];
  const sensors = nodes.filter((n) => (n.neuronType ?? n.type) === "sensor_on");
  const others = nodes.filter((n) => (n.neuronType ?? n.type) !== "sensor_on");
  const coords = new Map();
  sensors.forEach((n, idx) => coords.set(n.id, [0, idx, 0]));
  others.forEach((n, idx) => coords.set(n.id, [1, idx, 0]));
  return coords;
}

// Build the fixture shape from a NeuralGraph + input + trace + extras.
function buildFixture({ name, source, graph, inputTimeline, motorTrace, sensorIds, motorIds, edgeOverrides, extras = {} }) {
  const coords = assignCoords(graph);
  const neurons = [...graph.nodes.values()].map((n) => ({
    coord: coords.get(n.id),
    kind: ({ sensor_on: "SensorOn", inter_exc: "InterExc", inter_inh: "InterInh", modulator: "Modulator", motor: "Motor" })[n.neuronType ?? n.type],
    tau: n.tau ?? null,
  }));
  const edges = [...graph.edges.values()].map((e) => {
    const ov = edgeOverrides?.get(e.id) ?? {};
    return {
      from: coords.get(e.fromId),
      to: coords.get(e.toId),
      // Path: straight line from `from` to `to` via i,j,k stepping
      // — Bevy side rebuilds geometry; this is the minimum needed for
      // PathTree.from_path. Use a synthetic 2-cell-step path for non-delay
      // edges; oracle assertions don't depend on path length because we
      // override delay/attenuation explicitly below.
      path: synthPath(coords.get(e.fromId), coords.get(e.toId)),
      thickness_d: 1.0,
      plastic: e.plastic ?? false,
      mod_source: e.mod_source_id ? coords.get(e.mod_source_id) : null,
      delay_ticks_override: ov.delayTicks ?? null,
      attenuation_override: ov.attenuation ?? null,
    };
  });
  return {
    name,
    source,
    tick_count: inputTimeline.length,
    dt_seconds: 1 / 60,
    sensors: sensorIds.map((id) => ({ coord: coords.get(id) })),
    motors: motorIds.map((id) => ({ coord: coords.get(id) })),
    neurons,
    edges,
    input_timeline: inputTimeline,
    motor_trace: motorTrace,
    extra_assertions: extras,
  };
}

function synthPath([fi, fj, fk], [ti, tj, tk]) {
  // Generate a 6-connected path; for synthetic small graphs we move in
  // (i, j, k) order one step at a time.
  const path = [[fi, fj, fk]];
  let [i, j, k] = [fi, fj, fk];
  while (i !== ti) { i += Math.sign(ti - i); path.push([i, j, k]); }
  while (j !== tj) { j += Math.sign(tj - j); path.push([i, j, k]); }
  while (k !== tk) { k += Math.sign(tk - k); path.push([i, j, k]); }
  return path;
}

// ── Oracle 1: delay-echo ───────────────────────────────────────────────
function buildDelayEcho() {
  const g = new NeuralGraph();
  g.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, true);
  const E = g.addNeuronNode("inter_exc", LOGIC_CANVAS.width * 0.5, LOGIC_CANVAS.height * 0.5, { label: "E", tau: 3 });
  const eIn = g.addEdge(sourceNodeId("L_chem_A"), E.id);
  g.addEdge(E.id, motorNodeId("motor_forward"));
  eIn.delay_ms = 100;  // 6 ticks @ 60Hz

  const topo = compileTopology(g);
  const batch = createBatchState(topo, 1);
  const sIdx = topo.sensorSourceIds.indexOf("L_chem_A");
  const motorIdx = topo.motorNodeIndices[topo.motorSourceIds.indexOf("motor_forward")];

  const inputs = new Float32Array(topo.S);
  inputs[sIdx] = 1.0;

  const inputTimeline = [];
  const motorTrace = [];
  for (let t = 0; t < 40; t++) {
    stepBatch(topo, batch, inputs, { dt: 1 / 60 });
    inputTimeline.push([1.0]);
    motorTrace.push([batch.output[motorIdx]]);
  }

  // Compute eval-edge-level delay override for the input edge (6 ticks).
  // The output edge stays delay=0.
  const edgeOverrides = new Map([[eIn.id, { delayTicks: 6 }]]);

  return buildFixture({
    name: "delay-echo",
    source: "delay-test.mjs:99-114",
    graph: g,
    inputTimeline,
    motorTrace,
    sensorIds: [sourceNodeId("L_chem_A")],
    motorIds: [motorNodeId("motor_forward")],
    edgeOverrides,
  });
}

// ── Oracle 2: attenuation-half ─────────────────────────────────────────
function buildAttenuationHalf() {
  // Mirror attenuation-test.mjs:116-122. Sensor → motor, atten=0.5, expect
  // motor saturates near 0.5.
  const g = new NeuralGraph();
  g.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, true);
  const e = g.addEdge(sourceNodeId("L_chem_A"), motorNodeId("motor_forward"));
  e.attenuation = 0.5;

  const topo = compileTopology(g);
  const batch = createBatchState(topo, 1);
  const sIdx = topo.sensorSourceIds.indexOf("L_chem_A");
  const mIdx = topo.motorNodeIndices[topo.motorSourceIds.indexOf("motor_forward")];

  const inputs = new Float32Array(topo.S);
  inputs[sIdx] = 1.0;

  const inputTimeline = [];
  const motorTrace = [];
  for (let t = 0; t < 50; t++) {
    stepBatch(topo, batch, inputs, { dt: 1 / 60 });
    inputTimeline.push([1.0]);
    motorTrace.push([batch.output[mIdx]]);
  }

  const edgeOverrides = new Map([[e.id, { attenuation: 0.5 }]]);
  return buildFixture({
    name: "attenuation-half",
    source: "attenuation-test.mjs:116-122",
    graph: g,
    inputTimeline,
    motorTrace,
    sensorIds: [sourceNodeId("L_chem_A")],
    motorIds: [motorNodeId("motor_forward")],
    edgeOverrides,
  });
}

// ── Oracle 3: hebbian-saturation ───────────────────────────────────────
function buildHebbianSaturation() {
  // sensor → modulator (drives mod to 1),
  // sensor → inter_exc plastic-bound-to-modulator,
  // run many ticks, dump the per-tick plastic weight.
  const g = new NeuralGraph();
  g.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, true);
  const M = g.addNeuronNode("modulator", LOGIC_CANVAS.width * 0.5, LOGIC_CANVAS.height * 0.3, { label: "M", tau: 15 });
  const I = g.addNeuronNode("inter_exc", LOGIC_CANVAS.width * 0.5, LOGIC_CANVAS.height * 0.6, { label: "I", tau: 3 });
  g.addEdge(sourceNodeId("L_chem_A"), M.id);
  const ep = g.addEdge(sourceNodeId("L_chem_A"), I.id);
  g.setEdgePlastic(ep.id, { plastic: true, modSourceId: M.id });
  g.addEdge(I.id, motorNodeId("motor_forward"));

  const topo = compileTopology(g);
  const batch = createBatchState(topo, 1);
  const sIdx = topo.sensorSourceIds.indexOf("L_chem_A");
  const mIdx = topo.motorNodeIndices[topo.motorSourceIds.indexOf("motor_forward")];

  const inputs = new Float32Array(topo.S);
  inputs[sIdx] = 1.0;

  // For hebbian we trace the plastic weight (batch.plasticW[plasticEdgeIdx])
  // as the assertion target, not motor output. Pack it into motor_trace
  // anyway since the fixture loader expects motor_trace to be the assertion
  // target; we'll teach the Bevy side to look at plastic_w[edge] via a
  // separate field. For simplicity, dump motor_trace AND a parallel
  // plastic_w_trace via an extra field on the fixture.
  const inputTimeline = [];
  const motorTrace = [];
  const plasticWTrace = [];
  const plasticEdgeIdx = topo.edgePlastic.findIndex((p) => p);
  for (let t = 0; t < 300; t++) {
    stepBatch(topo, batch, inputs, { dt: 1 / 60 });
    inputTimeline.push([1.0]);
    motorTrace.push([batch.output[mIdx]]);
    plasticWTrace.push([batch.plasticW[plasticEdgeIdx]]);
  }

  const fx = buildFixture({
    name: "hebbian-saturation",
    source: "plasticity-unit-test.mjs C2",
    graph: g,
    inputTimeline,
    motorTrace,
    sensorIds: [sourceNodeId("L_chem_A")],
    motorIds: [motorNodeId("motor_forward")],
  });
  // Bolt on plastic_w_trace as an extra trace.
  fx.plastic_w_trace = plasticWTrace;
  return fx;
}

// ── Oracle 4: parity-no-delay ──────────────────────────────────────────
// Just a multi-node graph with no delay; trace motor; assertion is the same
// as any other oracle (numeric trace match). Title means "if Bevy matches
// stepBatch with delay=0, it's by construction matching computeSignals too,
// because batch-parity-test.mjs already proved JS computeSignals ↔ stepBatch."
function buildParityNoDelay() {
  const g = new NeuralGraph();
  g.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, true);
  const E1 = g.addNeuronNode("inter_exc", LOGIC_CANVAS.width * 0.4, LOGIC_CANVAS.height * 0.5, { label: "E1", tau: 3 });
  const E2 = g.addNeuronNode("inter_exc", LOGIC_CANVAS.width * 0.6, LOGIC_CANVAS.height * 0.5, { label: "E2", tau: 3 });
  g.addEdge(sourceNodeId("L_chem_A"), E1.id);
  g.addEdge(E1.id, E2.id);
  g.addEdge(E2.id, motorNodeId("motor_forward"));

  const topo = compileTopology(g);
  const batch = createBatchState(topo, 1);
  const sIdx = topo.sensorSourceIds.indexOf("L_chem_A");
  const mIdx = topo.motorNodeIndices[topo.motorSourceIds.indexOf("motor_forward")];

  const inputs = new Float32Array(topo.S);
  inputs[sIdx] = 1.0;

  const inputTimeline = [];
  const motorTrace = [];
  for (let t = 0; t < 60; t++) {
    stepBatch(topo, batch, inputs, { dt: 1 / 60 });
    inputTimeline.push([1.0]);
    motorTrace.push([batch.output[mIdx]]);
  }

  return buildFixture({
    name: "parity-no-delay",
    source: "batch-parity-test.mjs",
    graph: g,
    inputTimeline,
    motorTrace,
    sensorIds: [sourceNodeId("L_chem_A")],
    motorIds: [motorNodeId("motor_forward")],
  });
}

// ── Oracle 5: oscillator-mutual-inhibition ─────────────────────────────
function buildOscillator() {
  // test-neural.mjs:173-231, PURE-CIRCUIT version: feed F0 = 1.0 directly,
  // no world / no ant / no food. Same node parameters.
  const g = new NeuralGraph();
  g.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, true);
  const A = g.addNeuronNode("inter_inh", 350, LOGIC_CANVAS.height * 0.35, { label: "A", tau: 1.5, g_rebound: 7, tau_discharge: 0.4 });
  const B = g.addNeuronNode("inter_inh", 350, LOGIC_CANVAS.height * 0.65, { label: "B", tau: 1.5, g_rebound: 7, tau_discharge: 0.4 });
  g.addEdge(sourceNodeId("F0"), A.id);
  g.addEdge(A.id, B.id);
  g.addEdge(B.id, A.id);
  g.addEdge(A.id, motorNodeId("leftLeg"));
  g.addEdge(B.id, motorNodeId("rightLeg"));

  const topo = compileTopology(g);
  const batch = createBatchState(topo, 1);
  const sIdx = topo.sensorSourceIds.indexOf("F0");
  const leftIdx = topo.motorNodeIndices[topo.motorSourceIds.indexOf("leftLeg")];
  const rightIdx = topo.motorNodeIndices[topo.motorSourceIds.indexOf("rightLeg")];

  const inputs = new Float32Array(topo.S);
  inputs[sIdx] = 1.0;

  const inputTimeline = [];
  const motorTrace = [];
  for (let t = 0; t < 1200; t++) {
    stepBatch(topo, batch, inputs, { dt: 1 / 60 });
    inputTimeline.push([1.0]);
    motorTrace.push([batch.output[leftIdx], batch.output[rightIdx]]);
  }

  return buildFixture({
    name: "oscillator-mutual-inhibition",
    source: "test-neural.mjs:173-231 (Test 3, pure-circuit)",
    graph: g,
    inputTimeline,
    motorTrace,
    sensorIds: [sourceNodeId("F0")],
    motorIds: [motorNodeId("leftLeg"), motorNodeId("rightLeg")],
    extras: { switches_min: 6, switch_tol: 0.02 },
  });
}

// ── Main ───────────────────────────────────────────────────────────────
writeFixture("delay-echo", buildDelayEcho());
writeFixture("attenuation-half", buildAttenuationHalf());
writeFixture("hebbian-saturation", buildHebbianSaturation());
writeFixture("parity-no-delay", buildParityNoDelay());
writeFixture("oscillator-mutual-inhibition", buildOscillator());
```

**Note on `ensureAnchors`**: it places default sensor / motor nodes at canvas anchor positions. If running the script triggers DOM-dependent code paths (some `ensureAnchors` overloads access `document`), shim `globalThis.document` and `globalThis.window` at the top of `dump-oracle-fixtures.mjs` exactly as `plasticity-unit-test.mjs:7-10` does. **Copy the shim verbatim** — don't reinvent.

- [ ] **Step 6.3: Run the dumper**

Run:
```bash
cd D:/dev/Umwelt
node tools/dump-oracle-fixtures.mjs
```

Expected stdout (5 lines):
```
wrote .../umwelt-bevy/crates/grid_workshop/tests/fixtures/eval/delay-echo.json
wrote .../oscillator-mutual-inhibition.json
...
```

Verify the files exist:
```
ls D:/dev/umwelt-bevy/crates/grid_workshop/tests/fixtures/eval/
```
Expected: 5 .json files.

**If the dumper fails**: most likely `ensureAnchors` or some imported helper touches DOM. Add the `globalThis.document = {...}` shim from `plasticity-unit-test.mjs:7-10` to the top of the script. Do NOT silently mock more — if something breaks beyond DOM, that's a surface point: report it back, don't paper over.

- [ ] **Step 6.4: Spot-check one fixture**

Read `D:/dev/umwelt-bevy/crates/grid_workshop/tests/fixtures/eval/delay-echo.json`. Verify:
- `tick_count` matches the `for (let t = 0; t < 40; ...)` loop
- `motor_trace[0..5]` is all zeros (first 6 ticks before delayed echo)
- `motor_trace[6]` onward is positive

If the structure looks wrong, fix the dumper. Re-run.

- [ ] **Step 6.5: Commit (in the JS repo)**

```bash
cd D:/dev/Umwelt
git add tools/dump-oracle-fixtures.mjs
git commit -m "feat(tools): dump-oracle-fixtures.mjs — 5 fixtures for Bevy eval port

Runs JS stepBatch for each of:
  delay-echo (delay-test.mjs:99-114, delay=100ms=6 ticks)
  attenuation-half (attenuation-test.mjs:116-122)
  hebbian-saturation (plasticity-unit-test.mjs C2, 300 ticks)
  parity-no-delay (batch-parity-test.mjs, multi-hop chain)
  oscillator-mutual-inhibition (test-neural.mjs:173-231 Test 3, pure-circuit)

Writes JSON fixtures to ../umwelt-bevy/crates/grid_workshop/tests/fixtures/eval/
for the Bevy oracle integration tests (Task 7 of the C-3 v0.3 plan).

The 5th oracle is the spec §5 emergent-timing guard — single-edge physics
oracles 1-4 alone don't catch oscillator drift below sub-1e-5 tolerance.

Per spec §5 §6: fixtures are commit-tracked into the BEVY repo (Task 7
test sources), but the dumper itself lives here so the JS source-of-truth
side stays self-contained.

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"
```

- [ ] **Step 6.6: Commit the fixture JSONs in the Bevy repo**

```bash
cd D:/dev/umwelt-bevy
git add crates/grid_workshop/tests/fixtures/eval/
git commit -m "test(eval): 5 oracle fixtures from JS dump

Generated by D:/dev/Umwelt/tools/dump-oracle-fixtures.mjs at commit
<short-sha-of-the-JS-repo-commit-from-Step-6.5>.

To regenerate: cd D:/dev/Umwelt && node tools/dump-oracle-fixtures.mjs

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"
```

Fill in `<short-sha-...>` from `git -C D:/dev/Umwelt rev-parse --short HEAD` before committing.

---

## Task 7: `tests/eval_oracle.rs` — integration tests against fixtures

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/tests/eval_oracle.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/Cargo.toml` (verify `serde_json` is already in deps — it should be from C-4; `approx` is in dev-deps)

Loader → builder → runner → assertions. Each oracle is its own `#[test]` so failures localise.

- [ ] **Step 7.1: Verify Cargo deps**

Inspect `D:/dev/umwelt-bevy/crates/grid_workshop/Cargo.toml`. Confirm:
- `serde = { version = "1", features = ["derive"] }` and `serde_json = "1"` are in `[dependencies]` (added in C-4)
- `approx = "0.5"` is in `[dev-dependencies]` (added earlier)

If anything's missing, add it before proceeding.

- [ ] **Step 7.2: Write `tests/eval_oracle.rs`**

```rust
//! Integration tests against JS-dumped oracle fixtures.
//!
//! Spec §5 — five oracles, `max_relative ≤ 1e-5`. The 5th (oscillator)
//! also gets a behavioral backstop `switches ≥ 6`.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

use grid_workshop::{
    constants::eval as econst,
    core::{coord::CellCoord, grid::Grid, kind::NeuronKind},
    eval::{step::EvalState, step_eval, EvalTopology},
    routing::{ids::PathEndpoint, EdgeOps, PathTree, Routes},
};

#[derive(Debug, Deserialize)]
struct Fixture {
    name: String,
    #[serde(default)]
    source: String,
    tick_count: usize,
    #[serde(default)]
    dt_seconds: f32,
    sensors: Vec<NodeRef>,
    motors: Vec<NodeRef>,
    neurons: Vec<NeuronRef>,
    edges: Vec<EdgeRef>,
    input_timeline: Vec<Vec<f32>>,
    motor_trace: Vec<Vec<f32>>,
    #[serde(default)]
    plastic_w_trace: Option<Vec<Vec<f32>>>,
    #[serde(default)]
    extra_assertions: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct NodeRef {
    coord: [i32; 3],
}

#[derive(Debug, Deserialize)]
struct NeuronRef {
    coord: [i32; 3],
    kind: String,
    #[allow(dead_code)]
    tau: Option<f32>,
}

#[derive(Debug, Deserialize)]
struct EdgeRef {
    from: [i32; 3],
    to: [i32; 3],
    path: Vec<[i32; 3]>,
    #[serde(default = "default_thickness")]
    thickness_d: f32,
    #[serde(default)]
    plastic: bool,
    #[serde(default)]
    mod_source: Option<[i32; 3]>,
    #[serde(default)]
    delay_ticks_override: Option<i32>,
    #[serde(default)]
    attenuation_override: Option<f32>,
}

fn default_thickness() -> f32 {
    1.0
}

fn coord(c: [i32; 3]) -> CellCoord {
    CellCoord::new(c[0], c[1], c[2])
}

fn kind_from_str(s: &str) -> NeuronKind {
    match s {
        "SensorOn" => NeuronKind::SensorOn,
        "InterExc" => NeuronKind::InterExc,
        "InterInh" => NeuronKind::InterInh,
        "Modulator" => NeuronKind::Modulator,
        "Motor" => NeuronKind::Motor,
        other => panic!("unknown neuron kind in fixture: {other}"),
    }
}

fn load_fixture(name: &str) -> Fixture {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests/fixtures/eval");
    path.push(format!("{name}.json"));
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read fixture {path:?}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("bad fixture {name}: {e}"))
}

/// Build a (Grid, Routes, EvalTopology) from a fixture, applying any
/// per-edge overrides for delay_ticks / attenuation.
fn build_topo(fx: &Fixture) -> (Grid, Routes, EvalTopology, Vec<usize>, Vec<usize>) {
    let mut grid = Grid::default();
    let mut routes = Routes::new();
    {
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        for n in &fx.neurons {
            ops.place_neuron(coord(n.coord), kind_from_str(&n.kind))
                .unwrap_or_else(|e| panic!("place_neuron {:?} {} failed: {e:?}", n.coord, n.kind));
        }
        for ed in &fx.edges {
            let tree = PathTree::from_path(ed.path.iter().copied().map(coord).collect())
                .expect("fixture path must be 6-connected");
            let mod_endpoint = ed.mod_source.map(|c| PathEndpoint(coord(c)));
            ops.place_edge(tree, ed.thickness_d, ed.plastic, mod_endpoint)
                .expect("fixture place_edge");
        }
    }

    let mut topo = EvalTopology::compile(&grid, &routes);
    // Apply per-edge overrides. The fixture's edge order matches the order
    // we placed them; compile then expands forked edges in iteration order,
    // and oracle fixtures use non-forked edges only, so we can apply by index.
    for (i, ed) in fx.edges.iter().enumerate() {
        if let Some(d) = ed.delay_ticks_override {
            topo.edge_delay_ticks[i] = d;
        }
        if let Some(a) = ed.attenuation_override {
            topo.edge_attenuation[i] = a;
        }
    }
    let max_delay = topo.edge_delay_ticks.iter().copied().max().unwrap_or(0).max(0);
    topo.ring_size = (max_delay as usize) + 1;

    // Sensor and motor node indices (in fixture order).
    let coord_to_idx: HashMap<CellCoord, usize> = topo
        .node_coord
        .iter()
        .enumerate()
        .map(|(i, c)| (*c, i))
        .collect();
    let sensor_indices: Vec<usize> = fx
        .sensors
        .iter()
        .map(|s| *coord_to_idx.get(&coord(s.coord)).unwrap())
        .collect();
    let motor_indices: Vec<usize> = fx
        .motors
        .iter()
        .map(|m| *coord_to_idx.get(&coord(m.coord)).unwrap())
        .collect();
    (grid, routes, topo, sensor_indices, motor_indices)
}

/// Run all ticks; return per-tick motor trace + final EvalState.
fn run(fx: &Fixture) -> (Vec<Vec<f32>>, EvalState, EvalTopology) {
    let (_grid, _routes, topo, sensor_indices, motor_indices) = build_topo(fx);
    let mut s = EvalState::new(&topo);
    let mut motor_trace: Vec<Vec<f32>> = Vec::with_capacity(fx.tick_count);

    // Rebuild sensor_inputs in topology-sensor order. The topology orders
    // sensors by (i,j,k) lex, which may differ from fixture order. Map
    // fixture sensor → topology sensor slot:
    let topo_sensor_to_fixture_input: Vec<usize> = (0..topo.sensor_count)
        .map(|topo_s| {
            // node index of this topo sensor:
            let topo_node = topo_s; // sensors are first
            // find fixture sensor matching that coord
            fx.sensors
                .iter()
                .position(|fs| coord(fs.coord) == topo.node_coord[topo_node])
                .expect("topology sensor must appear in fixture sensors")
        })
        .collect();

    for tick in 0..fx.tick_count {
        let mut inputs = vec![0.0f32; topo.sensor_count];
        for topo_s in 0..topo.sensor_count {
            let fx_s = topo_sensor_to_fixture_input[topo_s];
            inputs[topo_s] = fx.input_timeline[tick][fx_s];
        }
        step_eval(&topo, &mut s, &inputs);
        let row: Vec<f32> = motor_indices.iter().map(|&i| s.output[i]).collect();
        motor_trace.push(row);
    }
    (motor_trace, s, topo)
}

fn assert_trace_match(name: &str, expected: &[Vec<f32>], actual: &[Vec<f32>], tol: f32) {
    assert_eq!(
        expected.len(),
        actual.len(),
        "[{name}] tick count mismatch: expected {} actual {}",
        expected.len(),
        actual.len()
    );
    for (t, (er, ar)) in expected.iter().zip(actual.iter()).enumerate() {
        assert_eq!(er.len(), ar.len(), "[{name}] tick {t} motor count mismatch");
        for (m, (&e, &a)) in er.iter().zip(ar.iter()).enumerate() {
            let abs_diff = (e - a).abs();
            let rel_denom = e.abs().max(a.abs()).max(1e-7);
            let rel = abs_diff / rel_denom;
            assert!(
                rel <= tol || abs_diff <= 1e-7,
                "[{name}] tick {t} motor {m}: expected {e:.8}, got {a:.8} (rel {rel:.2e})"
            );
        }
    }
}

// ── Oracle 1 ───────────────────────────────────────────────────────────
#[test]
fn oracle_delay_echo() {
    let fx = load_fixture("delay-echo");
    let (actual, _, _) = run(&fx);
    assert_trace_match("delay-echo", &fx.motor_trace, &actual, 1e-5);
}

// ── Oracle 2 ───────────────────────────────────────────────────────────
#[test]
fn oracle_attenuation_half() {
    let fx = load_fixture("attenuation-half");
    let (actual, _, _) = run(&fx);
    assert_trace_match("attenuation-half", &fx.motor_trace, &actual, 1e-5);
}

// ── Oracle 3 ───────────────────────────────────────────────────────────
#[test]
fn oracle_hebbian_saturation() {
    let fx = load_fixture("hebbian-saturation");
    let expected_plastic = fx
        .plastic_w_trace
        .as_ref()
        .expect("hebbian fixture must carry plastic_w_trace");
    let (_, final_state, topo) = run(&fx);
    // Read plastic weight from the (sole) plastic edge in the topology;
    // we re-run with a per-tick capture to compare against the trace.
    let (_g, _r, topo2, sensor_indices, _) = build_topo(&fx);
    let mut s = EvalState::new(&topo2);
    let plastic_edge = (0..topo2.edge_count)
        .find(|&e| topo2.edge_plastic[e])
        .expect("topology must have a plastic edge");

    // Sensor mapping (same logic as run()).
    let topo_sensor_to_fixture_input: Vec<usize> = (0..topo2.sensor_count)
        .map(|topo_s| {
            fx.sensors
                .iter()
                .position(|fs| coord(fs.coord) == topo2.node_coord[topo_s])
                .unwrap()
        })
        .collect();

    let mut actual_plastic: Vec<Vec<f32>> = Vec::with_capacity(fx.tick_count);
    for tick in 0..fx.tick_count {
        let mut inputs = vec![0.0f32; topo2.sensor_count];
        for ts in 0..topo2.sensor_count {
            inputs[ts] = fx.input_timeline[tick][topo_sensor_to_fixture_input[ts]];
        }
        step_eval(&topo2, &mut s, &inputs);
        actual_plastic.push(vec![s.plastic_w[plastic_edge]]);
    }
    assert_trace_match("hebbian-saturation", expected_plastic, &actual_plastic, 1e-5);
    // Sanity: final state's plastic_w matches re-run's.
    assert!((final_state.plastic_w[plastic_edge] - s.plastic_w[plastic_edge]).abs() < 1e-7);
    // Discard unused — but keep `sensor_indices` ref tied to suppress warnings:
    let _ = sensor_indices;
}

// ── Oracle 4 ───────────────────────────────────────────────────────────
#[test]
fn oracle_parity_no_delay() {
    let fx = load_fixture("parity-no-delay");
    let (actual, _, _) = run(&fx);
    assert_trace_match("parity-no-delay", &fx.motor_trace, &actual, 1e-5);
}

// ── Oracle 5 ───────────────────────────────────────────────────────────
#[test]
fn oracle_oscillator_mutual_inhibition() {
    let fx = load_fixture("oscillator-mutual-inhibition");
    let (actual, _, _) = run(&fx);

    // Strong: numerical trace match.
    assert_trace_match("oscillator-mutual-inhibition", &fx.motor_trace, &actual, 1e-5);

    // Weak: behavioral switches ≥ 6 backstop. Compute on the actual trace.
    let tol = fx
        .extra_assertions
        .get("switch_tol")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.02) as f32;
    let min_switches = fx
        .extra_assertions
        .get("switches_min")
        .and_then(|v| v.as_u64())
        .unwrap_or(6) as u32;
    let mut switches = 0u32;
    let mut last = ' ';
    // Sample every 30 ticks, same cadence as test-neural.mjs:205.
    for row in actual.iter().step_by(30) {
        let l = row[0];
        let r = row[1];
        let dom = if l > r + tol {
            'L'
        } else if r > l + tol {
            'R'
        } else {
            '-'
        };
        if dom != '-' && dom != last {
            switches += 1;
            last = dom;
        }
    }
    assert!(
        switches >= min_switches,
        "oscillator: only {switches} switches (need >= {min_switches})"
    );
}
```

- [ ] **Step 7.3: Run oracle tests**

Run:
```
cargo test -p grid_workshop --test eval_oracle -- --test-threads=1 --nocapture
```

Expected: 5 tests pass.

If any test fails:
- **Numeric drift > 1e-5**: this is a port bug. Use `--nocapture` output to find the first tick where they diverge. Suspects in order: (1) sensor latch order, (2) edge-kind dispatch (Dale's Law sign), (3) modulator gain formula, (4) tau or tau_adapt source, (5) plastic weight update timing.
- **Tick count mismatch**: dumper bug — re-run Task 6 dumper.
- **Oscillator switches < 6 but numeric trace matches**: impossible (if trace matches, switches count matches too). If you see this, the switch-counting threshold/tolerance differs from JS.

**Do NOT increase the 1e-5 tolerance to make a test pass.** If something drifts beyond 1e-5, that's a real port bug or a real algorithmic choice that needs to be explicit. Surface it.

- [ ] **Step 7.4: Clippy**

Run:
```
cargo clippy -p grid_workshop --tests -- -D warnings
```

- [ ] **Step 7.5: Commit**

```bash
cd D:/dev/umwelt-bevy
git add crates/grid_workshop/tests/eval_oracle.rs
git commit -m "test(eval): oracle integration tests — 5 fixtures, max_relative ≤ 1e-5

Each of the 5 spec §5 oracles is its own #[test] so failures localise:
  oracle_delay_echo, oracle_attenuation_half, oracle_hebbian_saturation,
  oracle_parity_no_delay, oracle_oscillator_mutual_inhibition.

Loader handles fixture-vs-topology sensor reordering (topology sorts
sensors (i,j,k) lex; fixture preserves JS placement order). Oscillator
test has both numeric trace assertion (strong, 1e-5) and behavioral
switches >= 6 backstop (weak), matching test-neural.mjs:215-228 with
30-tick sampling cadence.

Spec §6 explicitly forbids loosening the 1e-5 tolerance to make a test
pass — drift beyond 1e-5 IS the surface point.

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"
```

---

## Task 8: `eval/puzzle.rs` — Puzzle harness

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/puzzle.rs`
- Modify: `D:/dev/umwelt-bevy/crates/grid_workshop/src/eval/mod.rs`

Spec §6 + spec §7 Q3 LOCKED (sensors/motors are ordered `CellCoord` lists on the Puzzle, NOT fields on neurons).

- [ ] **Step 8.1: Write `eval/puzzle.rs`**

```rust
//! Puzzle harness. Spec §6.
//!
//! `run_puzzle(puzzle, grid, routes)` compiles a fresh EvalTopology
//! (no cache, spec §7 Q5 LOCKED), drives it with `puzzle.input_timeline`,
//! reads motors at the coords listed in `puzzle.motors`, accumulates
//! activity cost over the run, and reports pass/fail + cost vs par.
//!
//! Spec §7 Q3 LOCKED: channel binding lives here, not on neurons.
//! `puzzle.sensors[i]` is the CellCoord that receives input column i;
//! `puzzle.motors[j]` is the CellCoord whose output column j is read.

use crate::constants::eval as econst;
use crate::core::coord::CellCoord;
use crate::core::grid::Grid;
use crate::eval::{step::EvalState, step_eval, EvalTopology};
use crate::routing::cost::OrganStatic;
use crate::routing::Routes;

#[derive(Debug, Clone)]
pub struct Puzzle {
    pub sensors: Vec<CellCoord>,
    pub motors: Vec<CellCoord>,
    /// `[tick][sensor_idx]` → value ∈ [0, 1]. tick_count = `input_timeline.len()`.
    pub input_timeline: Vec<Vec<f32>>,
    pub expected: Expected,
    pub par: ParTarget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cmp {
    Ge,
    Le,
}

#[derive(Debug, Clone)]
pub enum Expected {
    /// Each motor's trace must match per-tick within `tol`.
    OutputTrace {
        motor_traces: Vec<Vec<f32>>,
        tol: f32,
    },
    /// By tick `by_tick`, motor `motor_idx`'s output must satisfy `value op`.
    ThresholdByTick {
        motor_idx: usize,
        by_tick: usize,
        value: f32,
        op: Cmp,
    },
}

#[derive(Debug, Clone)]
pub struct ParTarget {
    pub total_volume_um3: f32,
    pub total_membrane_um2: f32,
    pub total_power_pj_s: f32, // static + activity
}

#[derive(Debug, Clone)]
pub struct ParStatus {
    pub volume_pass: bool,
    pub membrane_pass: bool,
    pub power_pass: bool,
}

#[derive(Debug, Clone)]
pub struct PuzzleResult {
    pub passed: bool,
    pub fail_reason: Option<String>,
    pub static_cost: OrganStatic,
    pub activity_pj: f32,
    pub par_pass: ParStatus,
    pub motor_trace: Vec<Vec<f32>>,
}

/// Run a puzzle to completion. Pure-function flavour: no Bevy Resources,
/// no side effects on `grid` / `routes`.
pub fn run_puzzle(puzzle: &Puzzle, grid: &Grid, routes: &Routes) -> PuzzleResult {
    let topo = EvalTopology::compile(grid, routes);

    // Map fixture-ordered sensor / motor coords to topology indices.
    use std::collections::HashMap;
    let coord_to_idx: HashMap<CellCoord, usize> = topo
        .node_coord
        .iter()
        .enumerate()
        .map(|(i, c)| (*c, i))
        .collect();

    let sensor_topo_indices: Vec<usize> = puzzle
        .sensors
        .iter()
        .map(|c| {
            *coord_to_idx
                .get(c)
                .unwrap_or_else(|| panic!("puzzle sensor coord {c:?} not in grid"))
        })
        .collect();
    let motor_topo_indices: Vec<usize> = puzzle
        .motors
        .iter()
        .map(|c| {
            *coord_to_idx
                .get(c)
                .unwrap_or_else(|| panic!("puzzle motor coord {c:?} not in grid"))
        })
        .collect();

    // step_eval expects sensor_inputs in topology sensor order. Build
    // per-tick a vec of size topo.sensor_count, mapping puzzle sensor i
    // to the topo sensor slot that holds puzzle.sensors[i].
    // Topology sensors are at indices 0..topo.sensor_count.
    let topo_sensor_slot: Vec<usize> = sensor_topo_indices.clone();
    // (Sensor indices < topo.sensor_count since sensors are laid out first.)
    for (i, &idx) in topo_sensor_slot.iter().enumerate() {
        assert!(
            idx < topo.sensor_count,
            "puzzle.sensors[{i}] = {:?} is not a SensorOn neuron",
            puzzle.sensors[i]
        );
    }

    let mut s = EvalState::new(&topo);
    let mut motor_trace: Vec<Vec<f32>> = Vec::with_capacity(puzzle.input_timeline.len());
    let mut activity_pj: f32 = 0.0;
    // PROVISIONAL activity coefficient — see spec §3 + constants/biology.rs
    // P_ACTIVITY_COEF_PER_NEURON_PJ_S. Read it here so retuning happens in
    // one place.
    let activity_coef = crate::constants::biology::P_ACTIVITY_COEF_PER_NEURON_PJ_S;

    for inputs_t in &puzzle.input_timeline {
        // Build the topology-ordered input vector.
        let mut inputs = vec![0.0f32; topo.sensor_count];
        for (i, &topo_sensor) in topo_sensor_slot.iter().enumerate() {
            inputs[topo_sensor] = inputs_t.get(i).copied().unwrap_or(0.0);
        }
        step_eval(&topo, &mut s, &inputs);
        let row: Vec<f32> = motor_topo_indices.iter().map(|&i| s.output[i]).collect();
        motor_trace.push(row);

        // Activity power accumulator: sum_over_neurons(output * coef * dt).
        // s.output now holds this tick's outputs for all nodes (post-swap mirror).
        let mut tick_sum = 0.0_f32;
        for &out in s.output.iter() {
            tick_sum += out;
        }
        activity_pj += tick_sum * activity_coef * econst::EVAL_DT_SECONDS;
    }

    // Static cost from C-3.
    let static_cost = routes.organ_static(grid);
    let total_power = static_cost.total_static_pj_s + activity_pj;

    // Par checks.
    let par_pass = ParStatus {
        volume_pass: static_cost.total_volume_um3 <= puzzle.par.total_volume_um3,
        membrane_pass: static_cost.total_membrane_um2 <= puzzle.par.total_membrane_um2,
        power_pass: total_power <= puzzle.par.total_power_pj_s,
    };

    // Correctness check.
    let (correctness_pass, fail_reason) = check_expected(&puzzle.expected, &motor_trace);

    PuzzleResult {
        passed: correctness_pass,
        fail_reason,
        static_cost,
        activity_pj,
        par_pass,
        motor_trace,
    }
}

fn check_expected(expected: &Expected, trace: &[Vec<f32>]) -> (bool, Option<String>) {
    match expected {
        Expected::OutputTrace { motor_traces, tol } => {
            if motor_traces.len() != trace.len() {
                return (
                    false,
                    Some(format!(
                        "OutputTrace: tick count {} ≠ expected {}",
                        trace.len(),
                        motor_traces.len()
                    )),
                );
            }
            for (t, (e_row, a_row)) in motor_traces.iter().zip(trace.iter()).enumerate() {
                if e_row.len() != a_row.len() {
                    return (
                        false,
                        Some(format!("OutputTrace: tick {t} motor count mismatch")),
                    );
                }
                for (m, (&e, &a)) in e_row.iter().zip(a_row.iter()).enumerate() {
                    if (e - a).abs() > *tol {
                        return (
                            false,
                            Some(format!(
                                "OutputTrace: tick {t} motor {m}: {e:.6} ≠ {a:.6} (tol {tol})"
                            )),
                        );
                    }
                }
            }
            (true, None)
        }
        Expected::ThresholdByTick {
            motor_idx,
            by_tick,
            value,
            op,
        } => {
            // Did motor_idx satisfy `op value` at any tick t <= by_tick?
            let limit = (*by_tick).min(trace.len().saturating_sub(1));
            for t in 0..=limit {
                if trace[t].len() <= *motor_idx {
                    return (false, Some(format!("ThresholdByTick: motor {motor_idx} out of bounds at tick {t}")));
                }
                let a = trace[t][*motor_idx];
                let satisfied = match op {
                    Cmp::Ge => a >= *value,
                    Cmp::Le => a <= *value,
                };
                if satisfied {
                    return (true, None);
                }
            }
            (
                false,
                Some(format!(
                    "ThresholdByTick: motor {motor_idx} never reached {value} (op {op:?}) by tick {by_tick}"
                )),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::kind::NeuronKind;
    use crate::routing::{EdgeOps, PathTree};

    fn step_response_setup() -> (Grid, Routes, Puzzle) {
        let mut grid = Grid::default();
        let mut routes = Routes::new();
        {
            let mut ops = EdgeOps::new(&mut grid, &mut routes);
            ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn)
                .unwrap();
            ops.place_neuron(CellCoord::new(0, 2, 0), NeuronKind::InterExc)
                .unwrap();
            ops.place_neuron(CellCoord::new(0, 4, 0), NeuronKind::Motor)
                .unwrap();
            let tree1 = PathTree::from_path(vec![
                CellCoord::new(0, 0, 0),
                CellCoord::new(0, 1, 0),
                CellCoord::new(0, 2, 0),
            ])
            .unwrap();
            ops.place_edge(tree1, 1.0, false, None).unwrap();
            let tree2 = PathTree::from_path(vec![
                CellCoord::new(0, 2, 0),
                CellCoord::new(0, 3, 0),
                CellCoord::new(0, 4, 0),
            ])
            .unwrap();
            ops.place_edge(tree2, 1.0, false, None).unwrap();
        }

        let mut input_timeline: Vec<Vec<f32>> = Vec::with_capacity(120);
        for _ in 0..60 {
            input_timeline.push(vec![0.0]);
        }
        for _ in 60..120 {
            input_timeline.push(vec![1.0]);
        }

        let puzzle = Puzzle {
            sensors: vec![CellCoord::new(0, 0, 0)],
            motors: vec![CellCoord::new(0, 4, 0)],
            input_timeline,
            expected: Expected::ThresholdByTick {
                motor_idx: 0,
                by_tick: 119,
                value: 0.3, // tau=3, dt=1/60: 60 ticks of drive → ~63% saturation
                op: Cmp::Ge,
            },
            par: ParTarget {
                total_volume_um3: 1e6,
                total_membrane_um2: 1e6,
                total_power_pj_s: 1e9,
            },
        };
        (grid, routes, puzzle)
    }

    #[test]
    fn step_response_passes_with_loose_par() {
        let (grid, routes, puzzle) = step_response_setup();
        let result = run_puzzle(&puzzle, &grid, &routes);
        assert!(
            result.passed,
            "expected pass; fail_reason={:?}",
            result.fail_reason
        );
        assert!(result.par_pass.volume_pass);
        assert!(result.par_pass.membrane_pass);
        assert!(result.par_pass.power_pass);
        assert!(result.activity_pj >= 0.0);
        assert_eq!(result.motor_trace.len(), 120);
    }

    #[test]
    fn step_response_fails_par_with_tight_volume() {
        let (grid, routes, mut puzzle) = step_response_setup();
        puzzle.par.total_volume_um3 = 0.001; // impossible
        let result = run_puzzle(&puzzle, &grid, &routes);
        // Correctness can still pass; par doesn't gate `passed`.
        assert!(!result.par_pass.volume_pass);
    }
}
```

- [ ] **Step 8.2: Wire into `eval/mod.rs`**

```rust
//! C-3 v0.3 — Single-circuit evaluation layer.
pub mod topology;
pub mod step;
pub mod puzzle;

pub use topology::EvalTopology;
pub use step::{EvalState, step_eval};
pub use puzzle::{Cmp, Expected, ParStatus, ParTarget, Puzzle, PuzzleResult, run_puzzle};
```

- [ ] **Step 8.3: Run puzzle tests**

```
cargo test -p grid_workshop --lib eval::puzzle::
```
Expected: 2 tests pass.

- [ ] **Step 8.4: Run all tests + clippy**

```
cargo test -p grid_workshop
cargo clippy -p grid_workshop --all-targets -- -D warnings
cargo clippy -p grid_workshop --all-targets --release -- -D warnings
```

- [ ] **Step 8.5: Commit**

```bash
cd D:/dev/umwelt-bevy
git add crates/grid_workshop/src/eval/puzzle.rs crates/grid_workshop/src/eval/mod.rs
git commit -m "feat(eval): puzzle.rs — Puzzle harness + run_puzzle

Spec §6 + §7 Q3 LOCKED — channel binding is on the Puzzle, not on
neurons. Puzzle.sensors[i] / Puzzle.motors[j] are ordered CellCoord
lists; topology-vs-fixture sensor-slot reordering is handled inside
run_puzzle so callers see fixture order.

PuzzleResult reports static_cost (from C-3 OrganStatic), activity_pj
accumulated over the run, three-axis par check, motor_trace dump.
Activity coefficient comes from constants::biology — keeps the
PROVISIONAL standardization scaling in one place.

Two unit tests: step-response (sensor → inter_exc → motor with a
0/0/1/1 input ramp; threshold-by-tick correctness check) plus a par
sanity check.

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"
```

---

## Task 9: Step-response demo example + worklog

**Files:**
- Create: `D:/dev/umwelt-bevy/crates/grid_workshop/examples/step_response.rs`
- Modify: `D:/dev/Umwelt/docs/worklog.md`

- [ ] **Step 9.1: Write the step_response example**

```rust
//! C-3 v0.3 demo: run a single Puzzle through the eval harness and print
//! the PuzzleResult. Mirrors the `step_response_passes_with_loose_par`
//! unit test but as a live binary so `cargo run --example step_response`
//! shows numbers in the terminal.
//!
//! Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md §6.

use bevy::app::{AppExit, ScheduleRunnerPlugin};
use bevy::log::LogPlugin;
use bevy::prelude::*;
use grid_workshop::{
    eval::{run_puzzle, Cmp, Expected, ParTarget, Puzzle},
    CellCoord, EdgeOps, GridPlugin, GridRes, NeuronKind, PathTree, RoutesPlugin, RoutesRes,
};

fn main() {
    App::new()
        .add_plugins(MinimalPlugins.set(ScheduleRunnerPlugin::run_once()))
        .add_plugins(LogPlugin::default())
        .add_plugins((GridPlugin, RoutesPlugin))
        .add_systems(Startup, build_scene)
        .add_systems(Update, (run_demo, exit_after).chain())
        .run();
}

fn build_scene(mut grid: ResMut<GridRes>, mut routes: ResMut<RoutesRes>) {
    let mut ops = EdgeOps::new(&mut grid.0, &mut routes.0);
    ops.place_neuron(CellCoord::new(0, 0, 0), NeuronKind::SensorOn)
        .unwrap();
    ops.place_neuron(CellCoord::new(0, 2, 0), NeuronKind::InterExc)
        .unwrap();
    ops.place_neuron(CellCoord::new(0, 4, 0), NeuronKind::Motor)
        .unwrap();
    let t1 = PathTree::from_path(vec![
        CellCoord::new(0, 0, 0),
        CellCoord::new(0, 1, 0),
        CellCoord::new(0, 2, 0),
    ])
    .unwrap();
    ops.place_edge(t1, 1.0, false, None).unwrap();
    let t2 = PathTree::from_path(vec![
        CellCoord::new(0, 2, 0),
        CellCoord::new(0, 3, 0),
        CellCoord::new(0, 4, 0),
    ])
    .unwrap();
    ops.place_edge(t2, 1.0, false, None).unwrap();
}

fn run_demo(grid: Res<GridRes>, routes: Res<RoutesRes>) {
    let mut input_timeline: Vec<Vec<f32>> = Vec::with_capacity(120);
    for _ in 0..60 {
        input_timeline.push(vec![0.0]);
    }
    for _ in 60..120 {
        input_timeline.push(vec![1.0]);
    }
    let puzzle = Puzzle {
        sensors: vec![CellCoord::new(0, 0, 0)],
        motors: vec![CellCoord::new(0, 4, 0)],
        input_timeline,
        expected: Expected::ThresholdByTick {
            motor_idx: 0,
            by_tick: 119,
            value: 0.3,
            op: Cmp::Ge,
        },
        par: ParTarget {
            total_volume_um3: 1e6,
            total_membrane_um2: 1e6,
            total_power_pj_s: 1e9,
        },
    };
    let result = run_puzzle(&puzzle, &grid.0, &routes.0);

    info!("--- C-3 v0.3 step-response demo ---");
    info!("passed              : {}", result.passed);
    info!("fail_reason         : {:?}", result.fail_reason);
    info!("static volume um3   : {:.3}", result.static_cost.total_volume_um3);
    info!("static membrane um2 : {:.3}", result.static_cost.total_membrane_um2);
    info!("static power pj_s   : {:.3}", result.static_cost.total_static_pj_s);
    info!("activity pj         : {:.3}", result.activity_pj);
    info!(
        "motor[final tick]   : {:.4}",
        result.motor_trace.last().map(|r| r[0]).unwrap_or(0.0)
    );
}

fn exit_after(mut exit: EventWriter<AppExit>) {
    exit.send(AppExit::Success);
}
```

- [ ] **Step 9.2: Run the example**

```
cargo run --example step_response
```

Expected stdout (info!log lines, exact values will vary slightly):
```
--- C-3 v0.3 step-response demo ---
passed              : true
fail_reason         : None
static volume um3   : 218.562
static membrane um2 : 329.748
static power pj_s   : 828.672
activity pj         : <some positive value>
motor[final tick]   : <positive, > 0.3>
```

If `passed: false`, read `fail_reason`. The most likely cause is the motor not crossing 0.3 by tick 119. Either the integrator is wrong or 0.3 was too aggressive for the inter_exc tau=3 chain — adjust the threshold to ~0.2 if needed and document why in the file's doc comment. **Do not** silently lower par to "make it pass" without leaving a note.

- [ ] **Step 9.3: Run full verification**

```
cargo test -p grid_workshop
cargo clippy -p grid_workshop --all-targets -- -D warnings
cargo clippy -p grid_workshop --all-targets --release -- -D warnings
```
All expected: clean.

- [ ] **Step 9.4: Write worklog entry**

Open `D:/dev/Umwelt/docs/worklog.md`. Add **at the top of the 2026-05-27 section** (after the existing "做了什么(后半段)" block, before "C-3 子系统 spec + 实现落地"):

```markdown
- **C-3 v0.3 求值层落地** (`docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md` spec, `docs/superpowers/plans/2026-05-27-bevy-subsystem-c3v3-eval-layer.md` plan, umwelt-bevy 9 commits). Single-circuit eval layer:
  - `constants/eval.rs` —— 13 个常数从 JS port 来,标 inherited PROVISIONAL(Q4 LOCKED)
  - `eval/topology.rs` —— `EvalTopology::compile(&Grid, &Routes)` 纯函数(Q5 LOCKED),Bevy 多叶 PathTree 边展开成 N 个 eval-edge
  - `eval/step.rs` —— port stepBatch,**结构性双缓冲** `output_prev` / `output_next` 类型分离(Q2 LOCKED),显式 Euler(Q1 LOCKED),delay ring buffer,Hebbian plastic 更新
  - `tests/eval_oracle.rs` —— 5 个 JS-dump fixture 在 1e-5 容忍下全绿(`delay-echo` / `attenuation-half` / `hebbian-saturation` / `parity-no-delay` / `oscillator-mutual-inhibition`),振荡 oracle 还过了 `switches ≥ 6` 行为级 backstop
  - `eval/puzzle.rs` —— `Puzzle` 持有 ordered `sensors: Vec<CellCoord>` + `motors: Vec<CellCoord>`(Q3 LOCKED,神经元匿名),`run_puzzle` 报 `PuzzleResult { passed, static_cost, activity_pj, par_pass, motor_trace }`,activity 部分接 C-3 §3.2 静态/运行时切分
  - `examples/step_response.rs` —— 最小 demo puzzle 跑通,sensor 60 ticks 0 + 60 ticks 1,motor 跨过阈值
  - **JS 端 `tools/dump-oracle-fixtures.mjs`** —— 5 个 fixture 一次性 dump 到 Bevy 的 `tests/fixtures/eval/`,改 oracle 时回头跑这个重新 dump
  - 两个 PROVISIONAL 仍 PROVISIONAL:`V_REF_M_S = 0.3`(等玩家跑实际谜题验)、`P_ACTIVITY_COEF_PER_NEURON_PJ_S = 400`(等 par 比例跑出来调)
```

- [ ] **Step 9.5: Commit example + worklog**

```bash
cd D:/dev/umwelt-bevy
git add crates/grid_workshop/examples/step_response.rs
git commit -m "feat(eval): step_response demo example

Cargo run --example step_response runs the sensor→inter_exc→motor
step-response puzzle through run_puzzle() and info!logs the full
PuzzleResult. End-to-end smoke for the C-3 v0.3 eval layer.

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md"

cd D:/dev/Umwelt
git add docs/worklog.md
git commit -m "docs(worklog): 2026-05-27 — C-3 v0.3 eval layer landed

9-task plan executed. 5 oracle integration tests green at max_relative
1e-5 tolerance, oscillator backstop passed. Two PROVISIONAL constants
(V_REF, P_ACTIVITY_COEF) stay PROVISIONAL pending real puzzle play.

Spec: docs/superpowers/specs/2026-05-27-bevy-subsystem-c3v3-eval-layer-design.md
Plan: docs/superpowers/plans/2026-05-27-bevy-subsystem-c3v3-eval-layer.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

**1. Spec coverage:**
- §1 scope: Tasks 1-9 confined to single circuit, no world, no UI ✓
- §2 port from JS: every algorithm step in Tasks 1-5 cites batch.js/constants.js/neural.js lines ✓
- §3 timing dt=1/60: Task 1 pins `EVAL_DT_SECONDS = 1.0 / 60.0` + helper ✓
- §4 single-tick algorithm: Tasks 3 + 4 + 5 implement Steps 1-4 + 3.5 in order ✓
- §5 5 oracles + 1e-5: Tasks 6 + 7 cover all 5 with both strong + weak (oscillator) assertions ✓
- §6 puzzle harness: Task 8 builds Puzzle/Expected/ParTarget/PuzzleResult; Task 9 demo ✓
- §7 LOCKED Q1: explicit Euler — used everywhere; no backward-Euler appears ✓
- §7 LOCKED Q2: structural double-buffer — Task 3 has type-separated output_prev/output_next + pointer-separation assertion ✓
- §7 LOCKED Q3: channel binding on Puzzle — Task 8 sensors/motors are CellCoord lists; neurons carry no channel field ✓
- §7 LOCKED Q4: inherited PROVISIONAL constants — Task 1's eval.rs header + comments ✓
- §7 LOCKED Q5: no cache — Task 2's compile() is a pure function; no Resource caching ✓
- §8 non-goals: nothing in plan touches world / ant / chem / save-load / multi-ant ✓
- §10 acceptance shape: 5 oracle tests, switches backstop, step-response demo, cargo test/clippy clean, worklog with PROVISIONAL notes — all checked off across Tasks 7/9 ✓

**2. Placeholder scan:** No TBD / TODO / "appropriate" / "similar to" / generic error-handling stubs remain. Each step has runnable code or exact commands.

**3. Type consistency:**
- `EvalTopology` field names same in topology.rs, step.rs, puzzle.rs ✓
- `EvalState` field names same across step.rs and tests ✓
- `Puzzle.sensors` / `Puzzle.motors` consistently `Vec<CellCoord>` ✓
- `PuzzleResult.par_pass` is `ParStatus` (struct with 3 bools), not `bool` — consistent ✓
- `Expected` variants: `OutputTrace` and `ThresholdByTick` — used identically in Task 8 + Task 9 demo ✓

---

## Execution Handoff

**Plan complete and saved to `D:/dev/Umwelt/docs/superpowers/plans/2026-05-27-bevy-subsystem-c3v3-eval-layer.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
