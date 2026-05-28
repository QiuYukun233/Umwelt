# First puzzle — single-path attenuation repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Zach-like single-circuit puzzle — a repair puzzle where the player reconnects a severed sensor→motor axon, and wire length attenuates the signal (pass iff it arrives ≥ threshold).

**Architecture:** A new isolated puzzle-definition module (`eval/puzzles/repair_attenuation.rs`) that builds the damaged grid (sensor, advance-motor, an inert-neuron wall blocking the straight corridor) and a `Puzzle` (one positive `ThresholdByTick` case). A `reference_solution()` adds the intended winning route. Two guard tests prove the puzzle is solvable (reference passes + meets par) and that an over-long route fails. No harness changes; no UI.

**Tech Stack:** Rust 2024, Bevy 0.15.3, crate `grid_workshop` in `D:/dev/umwelt-bevy`. Work from `D:/dev/umwelt-bevy`, branch `master` (trunk-local). Run cargo with `-p grid_workshop`.

**Spec:** `D:/dev/Umwelt/docs/superpowers/specs/2026-05-28-bevy-subsystem-first-puzzle-attenuation-repair-design.md`

**Windows notes:** harmless `Permission denied` worktree-gc warnings may print on commit (ignore). A pre-existing PDB linker lock can fail *example* builds only — if `cargo test -p grid_workshop` fails solely on linking an example `.exe`, use `cargo test -p grid_workshop --lib` instead. A subagent's `git commit` to `master` may be blocked by an auto-mode classifier; if so, leave changes staged and report — the controller commits.

---

## Reference numbers (used throughout — derived from the geometry, all at d=1, weight=1)

- Cell pitch (same layer) = 5 μm; λ(d=1) = 300 μm; attenuation = `exp(−len_um/300)`.
- Threshold = 0.5 → passing budget ≈ 41 same-layer cells (300·ln2 = 208 μm).
- `sensor` = `CellCoord::new(0, 10, 0)` (SensorOn). `motor` = `CellCoord::new(0, 10, 24)` (Motor).
- Wall = inert `InterExc` neurons at `(0, x, 12)` for `x ∈ 7..=13` (blocks the straight x=10 corridor).
- **Reference route** ≈ 32 cells = 160 μm → atten ≈ **0.587 ≥ 0.5 (passes)**.
- **Too-long route** ≈ 44 cells = 220 μm → atten ≈ **0.480 < 0.5 (fails)**.

---

## File Structure

- Create `crates/grid_workshop/src/eval/puzzles/mod.rs` — `pub mod repair_attenuation;`
- Create `crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs` — `damaged()`, `reference_solution()`, path builders, guard tests, calibration test, module doc-comment (inscription).
- Modify `crates/grid_workshop/src/eval/mod.rs` — add `pub mod puzzles;`
- Modify `crates/grid_workshop/src/constants/biology.rs` — one doc-comment line recording the sub-tick-delay model finding.
- Modify (Umwelt repo) `D:/dev/Umwelt/docs/worklog.md` — model-finding + puzzle entry.

---

## Task 1: Scaffold the puzzle module and `damaged()` builder

**Files:**
- Create: `crates/grid_workshop/src/eval/puzzles/mod.rs`
- Create: `crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs`
- Modify: `crates/grid_workshop/src/eval/mod.rs`

- [ ] **Step 1: Wire the module tree**

Create `crates/grid_workshop/src/eval/puzzles/mod.rs`:

```rust
//! Concrete puzzle definitions, isolated from the generic harness in `eval/puzzle.rs`.

pub mod repair_attenuation;
```

In `crates/grid_workshop/src/eval/mod.rs`, add after `pub mod puzzle;`:

```rust
pub mod puzzles;
```

- [ ] **Step 2: Write `damaged()` and its build smoke test**

Create `crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs`:

```rust
//! First Zach-like puzzle: single-path attenuation repair.
//! Spec: docs/superpowers/specs/2026-05-28-bevy-subsystem-first-puzzle-attenuation-repair-design.md

use crate::core::coord::CellCoord;
use crate::core::grid::Grid;
use crate::core::kind::NeuronKind;
use crate::eval::puzzle::{Cmp, Expected, ParTarget, Puzzle};
use crate::routing::{EdgeId, EdgeOps, PathTree, Routes};

/// Advance-motor channel: the "ant moves forward" output (behavioral framing).
pub const SENSOR: CellCoord = CellCoord { layer: 0, x: 10, y: 0 };
pub const MOTOR: CellCoord = CellCoord { layer: 0, x: 10, y: 24 };

/// Build the DAMAGED scenario: sensor, advance-motor, and an inert-neuron wall
/// blocking the straight corridor. The original axon is absent — the player
/// repairs it. (v1 obstacle representation: inert InterExc neurons. Their
/// metabolism is included in the absolute reported cost — a v1-representation
/// artifact; the par comparison is unaffected because the wall is identical in
/// every attempt. A proper Blocked cell type is the upgrade path.)
pub fn damaged() -> (Grid, Routes, Puzzle) {
    let mut grid = Grid::default();
    let mut routes = Routes::new();
    {
        let mut ops = EdgeOps::new(&mut grid, &mut routes);
        ops.place_neuron(SENSOR, NeuronKind::SensorOn).unwrap();
        ops.place_neuron(MOTOR, NeuronKind::Motor).unwrap();
        for x in 7..=13 {
            ops.place_neuron(CellCoord::new(0, x, 12), NeuronKind::InterExc)
                .unwrap();
        }
    }

    // One positive case: 5 silent ticks then 25 ticks of full sensor drive.
    // The motor is instantaneous (delay 0), so it reaches `attenuation` at the
    // first pulse tick; EXISTS-satisfied ThresholdByTick::Ge passes iff atten ≥ 0.5.
    let mut input_timeline: Vec<Vec<f32>> = Vec::with_capacity(30);
    for _ in 0..5 {
        input_timeline.push(vec![0.0]);
    }
    for _ in 5..30 {
        input_timeline.push(vec![1.0]);
    }

    let puzzle = Puzzle {
        sensors: vec![SENSOR],
        motors: vec![MOTOR],
        input_timeline,
        expected: Expected::ThresholdByTick {
            motor_idx: 0,
            by_tick: 29,
            value: 0.5,
            op: Cmp::Ge,
        },
        // par set to give the d=1 reference route margin while punishing the
        // d-thickening escape (a d≥2 long route blows membrane/volume/power).
        // Calibration test `print_reference_cost` prints the exact reference
        // figures; tighten here toward those if desired.
        par: ParTarget {
            total_volume_um3: 800.0,
            total_membrane_um2: 1350.0,
            total_power_pj_s: 2500.0,
        },
    };

    (grid, routes, puzzle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::kind::CellContents;

    #[test]
    fn damaged_builds_body_and_wall_without_repair_edge() {
        let (grid, routes, puzzle) = damaged();
        // sensor + motor present
        assert_eq!(grid.get(SENSOR), CellContents::Neuron(NeuronKind::SensorOn));
        assert_eq!(grid.get(MOTOR), CellContents::Neuron(NeuronKind::Motor));
        // wall present, straight corridor blocked at x=10,y=12
        assert_eq!(
            grid.get(CellCoord::new(0, 10, 12)),
            CellContents::Neuron(NeuronKind::InterExc)
        );
        // no repair edge yet
        assert_eq!(routes.edges().count(), 0);
        // puzzle wiring
        assert_eq!(puzzle.sensors, vec![SENSOR]);
        assert_eq!(puzzle.motors, vec![MOTOR]);
        assert_eq!(puzzle.input_timeline.len(), 30);
    }
}
```

Note: confirm `CellContents` and `NeuronKind` import paths against the crate (the eval tests use `crate::core::kind::NeuronKind`; `CellContents` is re-exported at `crate::CellContents` per `lib.rs` — use whichever resolves). `Grid::get` returns `CellContents`; if the API differs, match the existing pattern used in `routing/routes.rs` tests.

- [ ] **Step 3: Run the smoke test**

Run: `cargo test -p grid_workshop --lib repair_attenuation::tests::damaged_builds`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/grid_workshop/src/eval/mod.rs crates/grid_workshop/src/eval/puzzles/mod.rs crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs
git commit -m "feat(puzzles): scaffold repair_attenuation module + damaged() builder"
```

---

## Task 2: `reference_solution()` + guard test A (reference passes)

**Files:**
- Modify: `crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs`

- [ ] **Step 1: Write the failing guard test A**

Add to the `tests` module in `repair_attenuation.rs`:

```rust
    #[test]
    fn reference_route_passes_and_meets_par() {
        use crate::eval::puzzle::run_puzzle;
        let (mut grid, mut routes, puzzle) = damaged();
        let _eid = reference_solution(&mut grid, &mut routes);
        let result = run_puzzle(&puzzle, &grid, &routes);
        assert!(
            result.passed,
            "reference should pass; fail_reason={:?}",
            result.fail_reason
        );
        assert!(result.par_pass.volume_pass, "volume {} > par", result.static_cost.total_volume_um3);
        assert!(result.par_pass.membrane_pass, "membrane {} > par", result.static_cost.total_membrane_um2);
        assert!(result.par_pass.power_pass, "power over par");
    }
```

- [ ] **Step 2: Run to verify it fails (no `reference_solution` yet)**

Run: `cargo test -p grid_workshop --lib reference_route_passes`
Expected: FAIL to compile (`reference_solution` not found).

- [ ] **Step 3: Implement `reference_solution()` and the path builder**

Add to `repair_attenuation.rs` (module body, not tests):

```rust
/// The intended winning route: ≈32 cells, routes around the wall's right end
/// (gap at x=14), staying under the 41-cell budget. Proves solvability and
/// defines par. Authored at d=1, weight=1.0 (a fixed excitatory edge).
pub fn reference_solution(grid: &mut Grid, routes: &mut Routes) -> EdgeId {
    let tree = PathTree::from_path(reference_path()).unwrap();
    let mut ops = EdgeOps::new(grid, routes);
    ops.place_edge(tree, 1.0, 1.0, false, None).unwrap()
}

fn reference_path() -> Vec<CellCoord> {
    let mut p = Vec::new();
    for y in 0..=11 {
        p.push(CellCoord::new(0, 10, y)); // up the near column to just below the wall
    }
    for x in 11..=14 {
        p.push(CellCoord::new(0, x, 11)); // sideways to clear the wall's right end
    }
    for y in 12..=13 {
        p.push(CellCoord::new(0, 14, y)); // through the gap (x=14 is open)
    }
    for x in (10..=13).rev() {
        p.push(CellCoord::new(0, x, 13)); // back to the motor column
    }
    for y in 14..=24 {
        p.push(CellCoord::new(0, 10, y)); // up to the motor
    }
    p
}
```

- [ ] **Step 4: Run guard test A to verify it passes**

Run: `cargo test -p grid_workshop --lib reference_route_passes`
Expected: PASS. (If `passed` is false, the route exceeds budget — recheck `reference_path`. If a par axis fails, run the calibration test in Task 3 and raise the corresponding `ParTarget` field.)

- [ ] **Step 5: Commit**

```bash
git add crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs
git commit -m "feat(puzzles): reference_solution route + guard test (reference passes, meets par)"
```

---

## Task 3: Guard test B (over-long route fails) + calibration test

**Files:**
- Modify: `crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs`

- [ ] **Step 1: Write the failing guard test B + a deliberately-long path builder**

Add to the `tests` module:

```rust
    #[test]
    fn too_long_route_fails_correctness() {
        use crate::eval::puzzle::run_puzzle;
        let (mut grid, mut routes, puzzle) = damaged();
        // Wrap far around (x=20) → ≈44 cells → atten ≈ 0.48 < 0.5.
        let tree = PathTree::from_path(too_long_path()).unwrap();
        {
            let mut ops = EdgeOps::new(&mut grid, &mut routes);
            ops.place_edge(tree, 1.0, 1.0, false, None).unwrap();
        }
        let result = run_puzzle(&puzzle, &grid, &routes);
        assert!(
            !result.passed,
            "over-long route should fail correctness (signal too attenuated)"
        );
    }
```

Add the path builder to the module body (not tests):

```rust
#[cfg(test)]
fn too_long_path() -> Vec<CellCoord> {
    let mut p = Vec::new();
    for y in 0..=11 {
        p.push(CellCoord::new(0, 10, y));
    }
    for x in 11..=20 {
        p.push(CellCoord::new(0, x, 11)); // wrap far past the wall's end
    }
    for y in 12..=13 {
        p.push(CellCoord::new(0, 20, y));
    }
    for x in (10..=19).rev() {
        p.push(CellCoord::new(0, x, 13));
    }
    for y in 14..=24 {
        p.push(CellCoord::new(0, 10, y));
    }
    p
}
```

- [ ] **Step 2: Run to verify it fails (no `too_long_path` yet → compile error, then logic)**

Run: `cargo test -p grid_workshop --lib too_long_route_fails`
Expected: FAIL to compile first; after adding the builder it must PASS (i.e. the assertion `!result.passed` holds). If it does NOT pass — meaning the long route still crosses threshold — the budget math is off; recheck cell count vs λ.

- [ ] **Step 3: Add the calibration test (prints exact reference cost)**

Add to the `tests` module:

```rust
    #[test]
    #[ignore = "calibration: prints reference cost to tune ParTarget"]
    fn print_reference_cost() {
        use crate::eval::puzzle::run_puzzle;
        let (mut grid, mut routes, puzzle) = damaged();
        reference_solution(&mut grid, &mut routes);
        let r = run_puzzle(&puzzle, &grid, &routes);
        println!(
            "REFERENCE COST: volume_um3={} membrane_um2={} static_pj_s={} activity_pj={} total_power={}",
            r.static_cost.total_volume_um3,
            r.static_cost.total_membrane_um2,
            r.static_cost.total_static_pj_s,
            r.activity_pj,
            r.static_cost.total_static_pj_s + r.activity_pj,
        );
    }
```

- [ ] **Step 4: Run the calibration test and confirm par sanity**

Run: `cargo test -p grid_workshop --lib print_reference_cost -- --ignored --nocapture`
Expected: prints the three reference figures (ballpark: volume ≈ 711, membrane ≈ 1209, total_power ≈ 1900). Confirm each is below the corresponding `ParTarget` in `damaged()` (800 / 1350 / 2500). If any exceeds par, raise that `ParTarget` field to just above the printed value and re-run guard test A.

- [ ] **Step 5: Run the full module + suite**

Run: `cargo test -p grid_workshop --lib repair_attenuation`
Expected: PASS (build smoke + guard A + guard B; calibration is `#[ignore]`).
Run: `cargo test -p grid_workshop --lib`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs
git commit -m "feat(puzzles): guard test for over-long route + reference-cost calibration"
```

---

## Task 4: Inscription + model-finding record

**Files:**
- Modify: `crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs` (doc-comment)
- Modify: `crates/grid_workshop/src/constants/biology.rs` (one doc line)
- Modify: `D:/dev/Umwelt/docs/worklog.md`

- [ ] **Step 1: Add the specimen-card inscription to the module doc-comment**

Replace the top doc-comment of `repair_attenuation.rs` with:

```rust
//! First Zach-like puzzle: single-path attenuation repair.
//! Spec: docs/superpowers/specs/2026-05-28-bevy-subsystem-first-puzzle-attenuation-repair-design.md
//!
//! Specimen — Repair: the fading signal.
//! A severed neurite must be regrown. The graded signal decays electrotonically
//! along its length: V(x) = V0 · e^(−x/λ). Route it too far and it arrives too
//! faint to move the animal. The length constant λ was first measured in a living
//! nerve fibre by Hodgkin & Rushton (1946), "The electrical constants of a
//! crustacean nerve fibre". — passive cable theory.
//!
//! Honesty note: this inscription names the physics the puzzle embodies (passive
//! cable attenuation along λ), NOT a claim about any neuron type. The motor is a
//! graded (analog-clamp) node; the "advance" threshold is a behavioral reading
//! imposed when interpreting the motor channel, not a property inside the neuron.
//! McCulloch–Pitts threshold logic belongs to the (deferred) logic-gate puzzle,
//! not here; Hodgkin–Huxley 1952 (active spikes) is a different regime — our
//! signal is non-spiking.
```

- [ ] **Step 2: Record the sub-tick-delay model finding in `biology.rs`**

In `crates/grid_workshop/src/constants/biology.rs`, near `V_REF_M_S` (the conduction-velocity constant), add a doc-comment line:

```rust
/// MODEL FINDING (2026-05-28): at puzzle scale (5 μm cells, 16.7 ms ticks),
/// conduction delay is sub-tick (~1000 cells per tick), so `delay_ms_to_ticks`
/// is ~0 for any normal circuit. This model computes in the amplitude / slow-
/// dynamics regime (attenuation, oscillation, inhibition, gating), NOT fine
/// timing (coincidence / Reichardt detection). Don't design timing puzzles here.
```

Place it immediately above the existing `pub const V_REF_M_S` line (do not alter the constant's value).

- [ ] **Step 3: Build to confirm doc comments compile**

Run: `cargo build -p grid_workshop --lib`
Expected: clean.

- [ ] **Step 4: Add the worklog entry (Umwelt repo)**

In `D:/dev/Umwelt/docs/worklog.md`, add a `## 2026-05-28` "做了什么" bullet (or append to the existing 2026-05-28 section if present) covering: first attenuation-repair puzzle landed (spec + plan + module + guard tests); and the **model finding** (delay sub-tick → amplitude/slow-dynamics regime, timing puzzles out). Keep it to a few lines in the existing worklog style.

- [ ] **Step 5: Commit (two repos)**

```bash
# bevy repo
git -C D:/dev/umwelt-bevy add crates/grid_workshop/src/eval/puzzles/repair_attenuation.rs crates/grid_workshop/src/constants/biology.rs
git -C D:/dev/umwelt-bevy commit -m "docs(puzzles): passive-cable inscription + sub-tick-delay model finding"
# Umwelt repo (worklog) — commit only the worklog path
git -C D:/dev/Umwelt add docs/worklog.md
git -C D:/dev/Umwelt commit -m "docs(worklog): first attenuation-repair puzzle + sub-tick-delay model finding"
```

- [ ] **Step 6: Final verification**

Run: `cargo test -p grid_workshop --lib` → PASS.
Run: `cargo clippy -p grid_workshop --lib -- -D warnings` → clean.

---

## Self-Review

- **Spec coverage:** mechanic (instantaneous motor, atten≥threshold) → Task 2 reference + Task 3 budget; geometry (sensor/motor/wall) → Task 1 `damaged()`; obstacle = inert neurons + artifact note → Task 1 doc-comment; harness fork B deferred (single positive case, no `Vec<Case>`) → Task 1 `Expected::ThresholdByTick`; negative control = too-long-route circuit → Task 3 guard B; par = reference cost (margin + calibration) → Task 1 `ParTarget` + Task 3 calibration; inscription = passive cable / Hodgkin & Rushton 1946 → Task 4; model finding recorded → Task 4. All spec sections map to a task.
- **Placeholder scan:** geometry coords, path builders, par numbers, and test code are all concrete. par is set to concrete values with a calibration test to verify/tighten — a real procedure, not a fill-in.
- **Type consistency:** `damaged() -> (Grid, Routes, Puzzle)`, `reference_solution(&mut Grid, &mut Routes) -> EdgeId`, `SENSOR`/`MOTOR` consts, `Expected::ThresholdByTick`, `Cmp::Ge`, `ParTarget{total_volume_um3,total_membrane_um2,total_power_pj_s}`, `PuzzleResult{passed,fail_reason,static_cost,par_pass}`, `OrganStatic{total_volume_um3,total_membrane_um2,total_static_pj_s}` — all match `eval/puzzle.rs` and the C-3 cost types as used here. `place_edge(tree, thickness_d, weight, plastic, mod_source)` matches the C-2 signature.
