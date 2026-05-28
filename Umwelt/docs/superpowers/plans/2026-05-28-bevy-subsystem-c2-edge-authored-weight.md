# C-2 Edge authored weight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a player-authored, magnitude-only synaptic `weight` field to `Edge` and feed it into the eval layer, replacing the two hardcoded `1.0` placeholders in `eval/topology.rs`.

**Architecture:** One scalar `Edge.weight` field. Fixed edges use range `[0.1, 1.0]`; plastic edges use `[0, 1]` (where the single value is both the innate decay baseline and the tick-0 start). Authoring rejects out-of-range input at `place_edge` (a new `WeightOutOfRange` error); the existing runtime clamps in `eval/step.rs` stay as the Dale safety net. The eval's two arrays (`edge_weight`, `edge_init_w`) both populate from the single authored value; their divergence remains a test/save-state seam only.

**Tech Stack:** Rust 2024, Bevy 0.15.3, crate `grid_workshop` in `D:/dev/umwelt-bevy`. Work from `D:/dev/umwelt-bevy`.

**Spec:** `D:/dev/Umwelt/docs/superpowers/specs/2026-05-28-bevy-subsystem-c2-edge-authored-weight-design.md`

---

## File Structure

- `crates/grid_workshop/src/routing/edge.rs` — add `weight: f32` to `Edge`; add `WeightOutOfRange` to `PlaceEdgeError`.
- `crates/grid_workshop/src/routing/routes.rs` — `Routes::place_edge` gains a `weight` param + validation + `Edge` construction; in-file test call sites updated.
- `crates/grid_workshop/src/routing/ops.rs` — `EdgeOps::place_edge` gains a `weight` passthrough param; in-file test call sites updated.
- `crates/grid_workshop/src/eval/topology.rs` — `compile()` reads `edge.weight` into `edge_weight` and `edge_init_w`.
- `crates/grid_workshop/examples/step_response.rs` — call-site update.
- Any puzzle-harness call site (`eval/puzzle.rs` tests, if present) — call-site update.

---

## Task 1: Add `weight` field and thread it through both `place_edge` signatures

This task is mechanical: add the field, widen both signatures with a `weight` param inserted **after `thickness_d`**, construct `Edge` with it, and update every call site to pass an explicit weight. No validation yet — that is Task 2. Goal: crate compiles and the full existing test suite stays green.

**Files:**
- Modify: `crates/grid_workshop/src/routing/edge.rs:7-14`
- Modify: `crates/grid_workshop/src/routing/routes.rs:48-55` (signature), `:105` (construction), test call sites
- Modify: `crates/grid_workshop/src/routing/ops.rs:80-89` (signature + passthrough), test call sites
- Modify: `crates/grid_workshop/examples/step_response.rs` (call site)

- [ ] **Step 1: Add the field to `Edge`**

In `routing/edge.rs`, the struct becomes:

```rust
pub struct Edge {
    pub tree: PathTree,
    /// 真实单位 μm;C-2 只存,√d 物理在 C-4 编译时展开(宪法 §4)。
    pub thickness_d: f32,
    /// 玩家授权的突触权重(magnitude-only)。固定边 ∈ [0.1, 1.0];可塑边 ∈ [0, 1]
    /// (单值同时充当先天 baseline 与 tick-0 起点)。符号由源神经元类型定,不进 weight。
    pub weight: f32,
    pub plastic: bool,
    /// None → 固定连接;Some(coord) → 可塑且绑该 modulator。
    pub mod_source: Option<PathEndpoint>,
}
```

- [ ] **Step 2: Widen `Routes::place_edge` signature and construction**

In `routing/routes.rs`, change the signature (insert `weight` after `thickness_d`):

```rust
    pub(crate) fn place_edge(
        &mut self,
        grid: &Grid,
        tree: PathTree,
        thickness_d: f32,
        weight: f32,
        plastic: bool,
        mod_source: Option<PathEndpoint>,
    ) -> Result<EdgeId, PlaceEdgeError> {
```

And change the construction line (was `routes.rs:105`):

```rust
        let edge = Edge { tree, thickness_d, weight, plastic, mod_source };
```

- [ ] **Step 3: Widen `EdgeOps::place_edge` signature and passthrough**

In `routing/ops.rs`:

```rust
    pub fn place_edge(
        &mut self,
        tree: PathTree,
        thickness_d: f32,
        weight: f32,
        plastic: bool,
        mod_source: Option<PathEndpoint>,
    ) -> Result<EdgeId, PlaceEdgeError> {
        self.routes
            .place_edge(self.grid, tree, thickness_d, weight, plastic, mod_source)
    }
```

- [ ] **Step 4: Update all call sites to pass an explicit weight**

Find every call: `cargo build --tests` will list each error location. Insert a weight argument after the `thickness_d` argument. For existing tests/example that don't care about weight, pass `1.0`:

- `routes.rs` tests: `r.place_edge(&grid, tree, 1.0, 1.0, false, None)` (the new `1.0` is `weight`).
- `ops.rs` tests: `ops.place_edge(t, 1.0, 1.0, false, None)`; the plastic one `ops.place_edge(t, 1.0, 1.0, true, Some(PathEndpoint(c(0, 5, 0))))`.
- `examples/step_response.rs`: same insertion.
- Any `eval/puzzle.rs` test call sites: same insertion.

- [ ] **Step 5: Verify it compiles and all existing tests pass**

Run: `cargo test -p grid_workshop`
Expected: PASS — same test count as before this task, no new failures.

- [ ] **Step 6: Commit**

```bash
git add crates/grid_workshop/src/routing/edge.rs crates/grid_workshop/src/routing/routes.rs crates/grid_workshop/src/routing/ops.rs crates/grid_workshop/examples/step_response.rs
git commit -m "feat(routing): add authored weight field to Edge, thread through place_edge"
```

(If `eval/puzzle.rs` was touched, add it to the `git add` line too.)

---

## Task 2: Plastic-aware range validation with reject

Add the `WeightOutOfRange` error and validate at `place_edge`. The range branches on the `plastic` flag. The check MUST be accept-if-in-range so NaN is rejected.

**Files:**
- Modify: `crates/grid_workshop/src/routing/edge.rs` (`PlaceEdgeError` enum, near `:36`)
- Modify: `crates/grid_workshop/src/routing/routes.rs` (validation block, after the plastic/mod_source pairing check at `:92`)
- Test: `crates/grid_workshop/src/routing/routes.rs` (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Add the error variant**

In `routing/edge.rs`, add to `PlaceEdgeError`:

```rust
    /// weight 超出 plastic-aware 合法区间(固定 [0.1,1.0] / 可塑 [0,1]);NaN/inf 也走这里
    WeightOutOfRange { weight: f32, plastic: bool },
```

- [ ] **Step 2: Write the failing tests**

Add to the `tests` module in `routing/routes.rs`. These assume a helper that builds a simple 1-wire tree between two neurons; mirror the existing tests' setup (e.g. `single_edge_place_and_query` around `routes.rs:405-419`). Use a sensor→inter pair for fixed edges and a pair plus a Modulator for plastic edges.

```rust
    #[test]
    fn weight_cross_range_005_plastic_accepts_fixed_rejects() {
        // 0.05: accepted as plastic, rejected as fixed — proves range branches on `plastic`.
        // fixed edge with weight 0.05 → reject
        {
            let grid = neuron_grid_with(&[
                (c(0, 0, 0), NeuronKind::SensorOn),
                (c(0, 2, 0), NeuronKind::InterExc),
            ]);
            let mut r = Routes::new();
            let tree = straight_tree(c(0, 0, 0), c(0, 2, 0));
            let err = r.place_edge(&grid, tree, 1.0, 0.05, false, None).unwrap_err();
            assert!(matches!(err, PlaceEdgeError::WeightOutOfRange { plastic: false, .. }));
        }
        // plastic edge with weight 0.05 → accept
        {
            let grid = neuron_grid_with(&[
                (c(0, 0, 0), NeuronKind::SensorOn),
                (c(0, 2, 0), NeuronKind::InterExc),
                (c(0, 5, 0), NeuronKind::Modulator),
            ]);
            let mut r = Routes::new();
            let tree = straight_tree(c(0, 0, 0), c(0, 2, 0));
            r.place_edge(&grid, tree, 1.0, 0.05, true, Some(PathEndpoint(c(0, 5, 0))))
                .unwrap();
        }
    }

    #[test]
    fn weight_shared_boundaries_accepted() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::InterExc),
            (c(0, 5, 0), NeuronKind::Modulator),
        ]);
        // fixed: 0.1 and 1.0 accepted
        for w in [0.1_f32, 1.0] {
            let mut r = Routes::new();
            r.place_edge(&grid, straight_tree(c(0, 0, 0), c(0, 2, 0)), 1.0, w, false, None)
                .unwrap();
        }
        // plastic: 0.0 and 1.0 accepted
        for w in [0.0_f32, 1.0] {
            let mut r = Routes::new();
            r.place_edge(
                &grid,
                straight_tree(c(0, 0, 0), c(0, 2, 0)),
                1.0,
                w,
                true,
                Some(PathEndpoint(c(0, 5, 0))),
            )
            .unwrap();
        }
    }

    #[test]
    fn weight_out_of_range_rejected() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::InterExc),
        ]);
        for w in [1.5_f32, -0.1, f32::INFINITY, f32::NEG_INFINITY] {
            let mut r = Routes::new();
            let err = r
                .place_edge(&grid, straight_tree(c(0, 0, 0), c(0, 2, 0)), 1.0, w, false, None)
                .unwrap_err();
            assert!(matches!(err, PlaceEdgeError::WeightOutOfRange { .. }), "w={w}");
        }
    }

    #[test]
    fn weight_nan_rejected() {
        // Pins accept-if-in-range form: reject-if-out (w<lo||w>hi) would let NaN through.
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::InterExc),
        ]);
        let mut r = Routes::new();
        let err = r
            .place_edge(&grid, straight_tree(c(0, 0, 0), c(0, 2, 0)), 1.0, f32::NAN, false, None)
            .unwrap_err();
        assert!(matches!(err, PlaceEdgeError::WeightOutOfRange { .. }));
    }
```

If a `straight_tree(from, to)` helper does not already exist in the test module, add one next to `neuron_grid_with` mirroring how existing tests build a `PathTree` (see `single_edge_place_and_query`). Do not invent a new tree API — reuse whatever the existing passing tests use to construct a two-endpoint tree.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p grid_workshop weight_`
Expected: FAIL — `WeightOutOfRange` is produced nowhere yet, so the reject tests fail (edges place successfully or the matches! fails).

- [ ] **Step 4: Add the validation block**

In `routing/routes.rs`, insert **after** the plastic/mod_source pairing check (currently ending at `:92`, before `// 分配 id 并落地`):

```rust
        // weight 范围:plastic-aware。accept-if-in-range 形式 → NaN 自动落入拒绝分支
        // (NaN 的所有比较为 false)。固定 [0.1,1.0] / 可塑 [0,1](宪法:可塑允许从 0 学起)。
        let (w_lo, w_hi) = if plastic { (0.0, 1.0) } else { (0.1, 1.0) };
        if !(weight >= w_lo && weight <= w_hi) {
            return Err(PlaceEdgeError::WeightOutOfRange { weight, plastic });
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p grid_workshop weight_`
Expected: PASS — all four weight tests green.

- [ ] **Step 6: Run the full suite**

Run: `cargo test -p grid_workshop`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add crates/grid_workshop/src/routing/edge.rs crates/grid_workshop/src/routing/routes.rs
git commit -m "feat(routing): plastic-aware weight range validation, reject out-of-range incl NaN"
```

---

## Task 3: Feed authored weight into the eval topology

Replace the two hardcoded `1.0`s in `compile()` with the authored `edge.weight`, populating both `edge_weight` (baseline) and `edge_init_w` (start) from the single field. The oracle tests use the override seam and must remain green.

**Files:**
- Modify: `crates/grid_workshop/src/eval/topology.rs:194-202`
- Test: `crates/grid_workshop/src/eval/topology.rs` (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `eval/topology.rs`. Build a tiny grid with one fixed edge authored at a distinctive weight, compile, and assert the value propagated to both arrays. Mirror an existing `compile()` test's setup in that module for grid/routes construction.

```rust
    #[test]
    fn compile_propagates_authored_weight_to_both_arrays() {
        let grid = neuron_grid_with(&[
            (c(0, 0, 0), NeuronKind::SensorOn),
            (c(0, 2, 0), NeuronKind::InterExc),
        ]);
        let mut routes = Routes::new();
        routes
            .place_edge(&grid, straight_tree(c(0, 0, 0), c(0, 2, 0)), 1.0, 0.6, false, None)
            .unwrap();
        let topo = EvalTopology::compile(&grid, &routes);
        assert_eq!(topo.edge_count, 1);
        assert_eq!(topo.edge_weight[0], 0.6);
        assert_eq!(topo.edge_init_w[0], 0.6);
    }
```

Reuse the test module's existing helpers (`neuron_grid_with`, `c`, a straight-tree builder). If they are not in scope in `topology.rs`'s test module, build the grid/routes the same way the existing `compile()` tests in this file already do — do not introduce a new construction API.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p grid_workshop compile_propagates_authored_weight`
Expected: FAIL — `edge_weight[0]` is `1.0`, not `0.6`.

- [ ] **Step 3: Replace the hardcoded weights**

In `eval/topology.rs`, in the leaf loop, replace the placeholder comment and the two `1.0` pushes (currently `:194-197` and `:202`):

```rust
                edge_from.push(from_idx);
                edge_to.push(to_idx);
                edge_kind.push(kind_code);
                // 单一授权值同时充当固定权重 / 可塑 baseline(edge_weight)与可塑 tick-0 起点
                // (edge_init_w)。两者发散仅是 test/save-state seam(oracle override),非授权旋钮。
                edge_weight.push(edge.weight);
                edge_attenuation.push(atten);
                edge_delay_ticks.push(dticks);
                edge_plastic.push(edge.plastic);
                edge_mod_src.push(mod_src_idx);
                edge_init_w.push(edge.weight);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p grid_workshop compile_propagates_authored_weight`
Expected: PASS.

- [ ] **Step 5: Run the full suite incl. oracle regression**

Run: `cargo test -p grid_workshop`
Expected: PASS — including the 5 `eval_oracle` integration tests (they drive weights through the `init_w_override` seam, unaffected by this change).

- [ ] **Step 6: Verify clippy is clean and the demo still runs**

Run: `cargo clippy -p grid_workshop --all-targets -- -D warnings`
Expected: no warnings.

Run: `cargo run -p grid_workshop --example step_response`
Expected: runs, reports `passed: true` (weight is `1.0` at that call site, so behavior is unchanged from before).

- [ ] **Step 7: Commit**

```bash
git add crates/grid_workshop/src/eval/topology.rs
git commit -m "feat(eval): compile() feeds authored Edge.weight into edge_weight/edge_init_w"
```

---

## Self-Review

- **Spec coverage:** data model (single field) → Task 1; reject-at-boundary + NaN accept-if-in-range → Task 2; compile() propagation + oracle regression → Task 3; magnitude-only/replace_kind invariants are checked-not-changed (asserted in spec, no code change needed — magnitude-only is enforced by the non-negative ranges added in Task 2; replace_kind is untouched and weight is type-independent); per-edge granularity is a recorded boundary, no task. All spec sections map to a task or are explicitly no-op.
- **Type consistency:** `weight: f32` field name and `WeightOutOfRange { weight, plastic }` variant used identically across Tasks 1–3; `place_edge` arg order `(.., thickness_d, weight, plastic, mod_source)` consistent in both `Routes` and `EdgeOps`.
- **Placeholders:** none — all code shown; the only deferred detail is reusing the existing test-module tree helper, with explicit instruction not to invent a new API.
