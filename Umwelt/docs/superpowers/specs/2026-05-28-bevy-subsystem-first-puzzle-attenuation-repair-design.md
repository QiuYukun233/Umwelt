# First Zach-like puzzle — single-path attenuation repair

**Date:** 2026-05-28
**Repo:** `D:/dev/umwelt-bevy`, crate `grid_workshop`
**Status:** approved, ready for implementation plan
**Depends on:** C-3 v0.3 eval layer, C-2 Edge authored weight (both landed)

## Purpose

The first *real* Zach-like single-circuit puzzle — the one used to test whether the
core wiring mechanic is fun. Code-level only, no UI: the designer plays it inside the
test runner by calling `EdgeOps` to route a repair edge, then `run_puzzle`. This is
**not** necessarily the literal first level of the shipped game (the real opening will
be gentler); it is the first probe of "is routing fun?"

Verification is **signal-level**, framing is **behavioral**: results are read off the
motor trace (the advance-motor channel interpreted as "the ant moves forward"), and the
spec prose is written in behavioral terms. No world / body / rendering is built here —
seeing the ant actually walk is the next layer, after this puzzle proves the mechanic.
The behavioral framing is written into the prose now so a future rendering layer plugs
straight in.

## Model finding that fixed the basis (record this)

Delay is **sub-tick at puzzle scale**. Same-layer cell = `CELL_PITCH_UM` = 5 μm;
conduction velocity `V_REF` = 0.3 m/s (×√d). Delay per cell (d=1) ≈ 0.017 ms; one tick
= `EVAL_DT_MS` ≈ 16.7 ms. So `delay_ms_to_ticks` rounds to **0 ticks** until a path is
~1000 cells long — in a tens-of-cells puzzle, delay is always 0.

This delimits what the model can compute: it lives in the **amplitude / slow-dynamics**
regime, not the **fine-timing** regime. Oscillation, inhibition, gating, attenuation are
all available; **timing-based computation (coincidence detection, Reichardt-style motion
detection) is out** at this tick resolution. Making delay resolvable would require
slowing conduction ~1000× (≈0.3 mm/s), which is biologically dishonest (insect axons are
~0.1–several m/s; 0.3 m/s is already plausibly slow) — so we do not fake it. This finding
is also recorded in the worklog beside the §4 physics so a future delay-puzzle idea does
not re-hit this wall.

## Mechanic (verified against `eval/step.rs`)

The **motor node is instantaneous**: `out = (exc_sum − inh_sum)·gain`, clamped to
[−1, 1]. For a single excitatory edge from a sensor (delay 0 ticks, gain 1):

```
motor_out = clamp01( sensor · weight · attenuation(len, d) )
```

with `attenuation(len, d) = exp(−len_um / λ(d))`, `λ(d) = 300·√d` μm. With the sensor
pulsed to 1.0 and weight authored at 1.0, `motor_out = attenuation(len, d)`.

**Pass criterion:** `motor_out ≥ threshold`. The puzzle uses **threshold = 0.5**.
At d=1, λ = 300 μm, so the passing length budget is `300·ln 2 ≈ 208 μm ≈ 41 same-layer
cells`. A route ≤ 41 cells (at d=1, weight 1) passes; longer fails.

No integration timing is involved — this is pure passive-cable amplitude attenuation.

## Levers and intended difficulty

- **Primary lever — routing.** The straight short corridor is blocked; the player must
  detour through a gap. An efficient route stays under the 41-cell budget (passes); a
  careless / wrapping route exceeds it (fails).
- **Secondary lever — thickness `d`.** `λ ∝ √d` buys signal headroom for a longer route,
  but volume ∝ d² and membrane ∝ d make it par-expensive. So thickening is an escape
  hatch, and routing-short is the elegant solution. (This is the C-3 multi-axis tension
  in miniature.)
- **weight** is dominated here: the player will pick weight = 1.0 (its max), so it is not
  a meaningful lever in this puzzle. It matters in later summation / inhibition puzzles.

## Geometry — v1 candidate (implementation-tuned)

Layer 0, x–y plane. Candidate coords (final values tuned at implementation to satisfy
the two guard tests below):

- `sensor` (SensorOn, ChemA channel) at `(0, 0, 0)`.
- `motor` (advance) at `(0, 0, 24)`.
- **Wall** of inert obstacle cells: a row at `y = 12` spanning `x ∈ [−3, 3]` (7 cells),
  blocking the straight corridor at `x = 0`. The player routes around either end
  (`x > 3` or `x < −3`).
- **Reference (intended) route:** up to `y = 11`, sideways to `x = 4`, through the gap to
  `y = 13`, back to `x = 0`, up to the motor — ≈ 32 cells ≈ 160 μm → atten ≈ 0.59 ≥ 0.5
  (**passes at d=1 with margin**).
- **A careless wrap** (e.g. around to `x = 10`) ≈ 44 cells → atten ≈ 0.48 < 0.5
  (**fails at d=1**). Such a route only wins by thickening `d`, paying par.

**Damage** = ship the grid with sensor, motor, and wall placed, the original edge
**absent**, and the straight corridor blocked. The player adds the repair edge.

**v1 geometry caveat (your fork C):** one wall + one gap is the **minimal** v1 form and
may be easy (shortest-path-around-one-wall). Testing whether routing is *fun* requires,
at the play-tuning stage, geometry with **multiple viable routes each carrying a cost
trade-off** — do not conclude "routing isn't fun" from a too-simple geometry. v1 exists
to stand the mechanic up end-to-end, not to be the final fun-test.

## Obstacle representation (your fork A)

`CellContents` has no wall type today (Empty / Neuron only). v1 uses **inert obstacle
neurons** (no edges) to block cells — simplest, no new type.

**Honesty patch:** walls made of neurons carry neuron metabolism cost. par is *relative*
(the wall is identical in the reference baseline and the player's grid, so the comparison
is fair), but the **absolute** power figure in `PuzzleResult` mixes in the wall's
metabolism. v1 resolution: **mark this as a v1-representation artifact** in code + spec
prose (the displayed absolute cost includes wall metabolism; the par comparison is
unaffected). Excluding obstacle cells from the reported cost is the alternative if it ever
bites. A proper `Blocked` cell type in `Grid` is recorded as the **upgrade path** (clean
long-term, deferred — too big for v1).

## Harness usage (your fork B)

The minimal puzzle needs only **one positive case**: pulse the sensor, assert
`motor ≥ 0.5` by tick T via `Expected::ThresholdByTick { op: Cmp::Ge }` (already
supported). Input timeline (candidate): 30 ticks, first 5 = 0.0, next 25 = 1.0; the
instantaneous motor reaches `atten` at tick 5, so `by_tick = 29` with EXISTS-satisfied
semantics passes iff `atten ≥ 0.5`.

The "negative control" is **not** a no-input case (a feedforward motor is trivially 0
with no input). It is a **too-long-route case**, expressed as a *different circuit* run
through the *same* puzzle:

- **Guard test A:** damaged state + reference route → `passed: true`, all three par axes
  met.
- **Guard test B:** damaged state + deliberately-long route → `passed: false`.

So **no harness change is needed** for puzzle #1. The `Vec<Case>` battery and the
`StaysBelowThrough` Expected variant (TODO already at `eval/puzzle.rs:33`) become
necessary only for behavioral negative controls *within one circuit* (the parked
two-antenna / inhibition versions). **Deferred — confirmed YAGNI.**

## par (your item #5)

Three-axis target = the **reference solution's** actual cost:
`total_volume_um3`, `total_membrane_um2`, `total_power_pj_s` (static + activity),
computed from the ≈32-cell, d=1, weight=1 reference route at implementation. Meeting par
= a solution as lean as the reference; beating it = the optimization game. (Note the par
baseline includes the wall neurons, per the obstacle artifact above — fair because
identical across all attempts.)

## Code shape

A new puzzle-definition module, isolated from the generic harness (`eval/puzzle.rs`):
`eval/puzzles/repair_attenuation.rs` (with `eval/puzzles/mod.rs`).

- `pub fn damaged() -> (Grid, Routes, Puzzle)` — builds body + wall + input timeline +
  `Expected::ThresholdByTick` + `ParTarget`; no repair edge.
- `pub fn reference_solution(grid: &mut Grid, routes: &mut Routes) -> EdgeId` — adds the
  intended winning route (proves solvability; defines par). Uses `EdgeOps`.
- Guard tests A and B (above).

Each puzzle definition is one focused file; the harness stays generic.

## Inscription — passive cable theory (your item #8, corrected lineage)

This puzzle's `exp(−len/λ)` is **passive cable theory** — the electrotonic decay of a
graded signal along the length constant λ. It is **not** logic (McCulloch–Pitts threshold
logic follows the *deferred logic-gate puzzle*), and **not** the Hodgkin–Huxley 1952
active action-potential model (our signal is non-spiking and lives outside that regime).

- Inscription lineage for this puzzle: passive cable theory — **Hodgkin & Rushton (1946),
  "The electrical constants of a crustacean nerve fibre"** (first measurement of a nerve
  fibre's length constant λ — the exact constant governing `exp(−len/λ)` here), with
  Rall's dendritic cable theory as the neuronal-cable companion. Final signatory chosen in
  the spec: **Hodgkin & Rushton 1946** as primary (they measured λ).
- Placement: a "specimen card" section in this spec + a module doc-comment on
  `repair_attenuation.rs`. In-game display deferred to the UI / campaign layer.
- **Honesty caveat (kept):** the inscription describes the *physics this puzzle embodies*
  (passive-cable attenuation along λ), not a claim about any neuron type. The motor is a
  graded (analog-clamp) node; the "advance threshold" is a behavioral-layer reading
  imposed by the designer, not a property inside the neuron.

### Specimen card text (draft)

> **Specimen — Repair: the fading signal.**
> A severed neurite must be regrown. The graded signal decays electrotonically along its
> length: `V(x) = V₀·e^(−x/λ)`. Route it too far and it arrives too faint to move the
> animal. The length constant λ was first measured in a living nerve fibre by Hodgkin &
> Rushton (1946). — *passive cable theory.*

## Out of scope / parked

- Two-antenna "both sides must detect" version (needs a second path / inhibition).
- `Vec<Case>` battery + `StaysBelowThrough` Expected variant.
- Proper `Blocked` cell type in `Grid`.
- Any timing-based puzzle (sub-tick delay — see model finding).
- In-game rendering / body / world.
