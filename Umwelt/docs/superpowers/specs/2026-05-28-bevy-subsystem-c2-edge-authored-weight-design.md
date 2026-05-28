# C-2 Edge authored weight — design

**Date:** 2026-05-28
**Repo:** `D:/dev/umwelt-bevy`, crate `grid_workshop`
**Status:** approved, ready for implementation plan

## Goal

Give `Edge` a player-authored synaptic `weight` so single-circuit puzzles can use
non-trivial weights. This replaces the two hardcoded `1.0` values in
`eval/topology.rs:197,202`, which were placeholders pending a C-2 weight field.

Magnitude-only model is preserved: the sign of an edge's contribution comes from
the **source neuron type** (Dale's Law), never from the weight. The weight carries
magnitude only.

## Data model

One new field on `Edge` (`routing/edge.rs`):

```rust
pub weight: f32,
```

Per the JS reference (`src/neural/batch.js:202–207`) and CLAUDE.md, a **single**
authored number is sufficient:

- **Fixed edge** → the runtime weight. Valid range `[0.1, 1.0]`.
- **Plastic edge** → the innate baseline *and* the default starting value. Valid
  range `[0, 1]` (so the "learn from zero" scenario with `w_init = 0` is reachable).

The eval layer's two existing arrays are kept:

- `edge_weight` — plastic decay baseline (the value `w` decays toward), also the
  fixed-edge runtime weight;
- `edge_init_w` — plastic starting value at tick 0.

In `compile()` **both** populate from the single authored `edge.weight`
(`edge_weight = edge_init_w = edge.weight`). The `init_w ≠ baseline` divergence
remains a **test / save-state seam only** (the oracle fixtures' `init_w_override`),
not a second authoring knob. No save/load path exists yet, so no "current learned
`w`" field is added (YAGNI). The JS optional runtime `edge.w` (batch.js:207) is
exactly that save-state replay value, deliberately out of scope here.

## Boundary validation — reject

`place_edge` validates the plastic-aware range and returns a new error variant:

```rust
PlaceEdgeError::WeightOutOfRange { weight: f32, plastic: bool }
```

This matches the existing reject style at this boundary (`InvalidThickness`,
`PlasticModSourceMismatch`). Fail loud at authoring time; do not silently clamp
authored input.

The runtime `clampWeight` / `clampDale` calls in `eval/step.rs` are **untouched**
and remain the Dale safety net during evaluation (faithful to JS, which also
clamps at runtime). Authoring-time reject and runtime clamp are two distinct
layers and both stay.

**NaN/inf handling — implementation note.** The range check MUST be written in
accept-if-in-range form:

```rust
let (lo, hi) = if plastic { (0.0, 1.0) } else { (0.1, 1.0) };
if !(weight >= lo && weight <= hi) {
    return Err(PlaceEdgeError::WeightOutOfRange { weight, plastic });
}
```

The negated reject-if-out form (`weight < lo || weight > hi`) would let NaN through
(all NaN comparisons are false). A NaN test case pins the accept-if-in-range form.

## Signature change

`weight` threads through both layers, inserted after `thickness_d`:

- `EdgeOps::place_edge` (public, `routing/ops.rs`)
- `Routes::place_edge` (`pub(crate)`, `routing/routes.rs`)

All call sites are updated explicitly (tests in `routes.rs` / `ops.rs`, the
`step_response` example, and the puzzle harness). This is local trunk
development — no back-compat shim, no defaulted overload.

## Confirmed invariants (verified, not changed — stated for the record)

These two properties are why the magnitude-only design is correct; both already
hold and this change must not regress them.

- **Magnitude-only is structural, not a runtime check.** The non-negative valid
  ranges mean a sign can never enter the weight; the sign lives permanently in the
  source neuron type (Dale's Law). This is enforced by the data shape, not by a
  guard — which is exactly what the constitution requires.
- **Clean composition with `replace_kind`.** Weight is pure magnitude, so changing
  a neuron's type flips the downstream sign while the magnitude is untouched — no
  weight re-authoring needed. `replace_kind` is a high-frequency §3 experiment
  operation; this field adds no friction to it. Verified.

## Granularity boundary (a boundary, not a fork, not a bug)

Weight is **per-edge**: one axon tree shares a single weight across all its leaves.
This matches the JS model and is the same tier of simplification as §4's "one `d`
per edge" — collapsing "each synapse has its own strength" down to one value per
edge. A future request for "same neuron, different weight to different targets"
is a **per-target weight upgrade path** (analogous to the §2 dendrite upgrade),
not a defect. Recorded here so that request is not later mistaken for a bug.

## Testing

- **Shared-boundary accept:** `0.0` (plastic only), `0.1`, `1.0` accepted on the
  appropriate flag.
- **Cross-range pair (the key test):** `0.05` is **accepted when plastic, rejected
  when fixed**. Same number, opposite outcome by the plastic flag — this proves the
  range actually branches on `plastic`.
- **Reject side:** `> 1.0`, `< 0`, and `NaN` / `inf` all rejected. The NaN case
  specifically pins the accept-if-in-range form.
- **compile() propagation:** an authored `weight` reaches both `edge_weight` and
  `edge_init_w` in the compiled `EvalTopology` (no longer hardcoded `1.0`).
- **Oracle regression:** the existing 5 oracle tests stay green. They drive weights
  through the `init_w_override` seam and are unaffected by the authoring path.
- The `init_w = 0.1` hack at `step.rs:570` can now be expressed through the authored
  field on the path that routes through `compile()`.

## Files touched

- `routing/edge.rs` — `weight` field + `WeightOutOfRange` error variant
- `routing/routes.rs` — `place_edge` signature + validation; call-site test updates
- `routing/ops.rs` — `place_edge` signature passthrough; call-site test updates
- `eval/topology.rs` — `compile()` reads `edge.weight` into `edge_weight` /
  `edge_init_w`
- `examples/step_response.rs`, puzzle-harness call sites — pass explicit weight
