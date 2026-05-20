# HTML `edge.delay_ms` Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the HTML main world the one runtime concept the Bevy workshop needs to land — per-edge axon conduction delay (`edge.delay_ms`) — plus a loader that installs a `umwelt-module-v1` JSON export onto the ant.

**Architecture:** A new `delay_ms` field on every neural edge (default `0` = instant, the pre-v10 behaviour). The authoritative batched evaluator (`stepBatch`) gains a per-node output-history ring buffer; an edge with `delay_ms` rounding to ≥1 tick reads its source's output from that many ticks ago instead of "now / last tick". A `delay_ms` of 0 is a bit-exact no-op, so existing circuits and the batch↔reference parity invariant are untouched. Save schema bumps v9→v10. A new `src/io/module.js` parses workshop module exports; the editor toolbar gets a "load module" entry that deserialises the module's graph onto the live circuit.

**Tech Stack:** JavaScript (ES modules), Vite, no test framework — tests are plain `.mjs` files run with `node` from the repo root.

**Design decisions made in this plan** (deferred or unspecified in the spec):
- **Delay model.** Each edge carries `delay_ms`. `delay_ticks = round(delay_ms / refDtMs)` where `refDtMs` is the fixed-step duration in ms. The evaluator keeps a ring buffer of every node's committed `output` per tick; a delayed edge reads `history[now − delay_ticks]`. `delay_ticks === 0` keeps the *exact* current read (sensor source → this tick's freshly-latched output; non-sensor source → last tick's output) — and because history at `now − 1` equals last tick's output, there is no discontinuity for non-sensor sources between 0 and 1 tick of delay.
- **Only `stepBatch` gets delay.** `stepBatch` is the authoritative runtime evaluator. `NeuralGraph.computeSignals` stays delay-free; it remains the parity reference (for delay-0 graphs, which is all the parity test uses) and drives the editor's *preview* metrics. Consequence: the editor preview ignores delay. This is an accepted MVP gap — it disappears when the whole game moves to Bevy and HTML is retired. The actual simulated ant behaviour (driven by `stepBatch`) is correct.
- **Plasticity reads undelayed output.** The Hebbian update uses each node's current-tick `output`; delay is an axon-transmission property, not a synaptic one.
- **Receptor remapping deferred.** `umwelt-module-v1` carries `receptors[]` with workshop body positions. Remapping those onto HTML's fixed 14-channel sensor hardware is out of scope here — no Bevy workshop exists yet to emit a real module, so the loader trusts the module graph's sensor `sourceId`s as-is.
- **`DELAY_MS_MAX = 500`.** ~30 ticks at 60 Hz; generous headroom over real insect axon delays, chosen so "near vs far" neuron placement is perceptible.

---

## File Structure

| File | Created / Modified | Responsibility |
|------|--------------------|----------------|
| `src/neural/constants.js` | Modify | Add `DELAY_MS_MAX`. |
| `src/neural.js` | Modify | `edge.delay_ms` field: `addEdge` default, `serialize`/`deserialize` round-trip + clamp. |
| `src/io/migrations.js` | Modify | Save schema v9 → v10. |
| `src/neural/batch.js` | Modify | Delay ring buffer: `compileTopology` `edgeDelayTicks`/`ringSize`, `createBatchState` `outputHistory`/`tick`, `stepBatch` delayed read + history write. |
| `src/io/module.js` | **Create** | Parse `umwelt-module-v1` workshop exports. |
| `src/io/schema.js` | Modify | Persist `moduleMeta` in the save envelope. |
| `src/observation-app.js` | Modify | Pass `refDtMs` to `compileTopology`; `_loadModule` method; `moduleMeta` field. |
| `src/ui/editor.js` | Modify | Wire the "load module" button + file input. |
| `index.html` | Modify | "load module" button + hidden file input in the editor toolbar. |
| `delay-test.mjs` | **Create** | Field round-trip + ring-buffer time-shift tests. |
| `module-test.mjs` | **Create** | `parseModuleText` + end-to-end module-load delay test. |
| `save-load-test.mjs` | Modify | v9→v10 migration + `moduleMeta` round-trip tests. |

Tests run headless: `node <file>.mjs` from the repo root. `save-load-test.mjs` already imports `./src/neural.js` with no DOM stubs and is green, so the new test files use plain static imports too.

---

## Task 1: `edge.delay_ms` field on NeuralGraph

**Files:**
- Modify: `src/neural/constants.js`
- Modify: `src/neural.js`
- Test: `delay-test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `delay-test.mjs` at the repo root:

```js
/**
 * Tests for axon conduction delay (edge.delay_ms) and the stepBatch delay
 * ring buffer. Run: `node delay-test.mjs` from the repo root.
 */
import assert from "node:assert/strict";

import { NeuralGraph } from "./src/neural.js";
import { compileTopology, createBatchState, stepBatch } from "./src/neural/batch.js";
import { sourceNodeId, motorNodeId, LOGIC_CANVAS } from "./src/config.js";
import { DELAY_MS_MAX } from "./src/neural/constants.js";

const W = LOGIC_CANVAS.width, H = LOGIC_CANVAS.height;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

// ── 1. edge.delay_ms field ──
console.log("edge.delay_ms field");

test("new edges default delay_ms to 0", () => {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const e = g.addEdge(sourceNodeId("L_chem_A"), motorNodeId("motor_forward"));
  assert.equal(e.delay_ms, 0);
});

test("serialize/deserialize round-trips delay_ms", () => {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const e = g.addEdge(sourceNodeId("L_chem_A"), motorNodeId("motor_forward"));
  e.delay_ms = 120;
  const g2 = new NeuralGraph();
  g2.deserialize(g.serialize());
  assert.equal(g2.edges.get(e.id).delay_ms, 120);
});

test("deserialize clamps delay_ms above DELAY_MS_MAX", () => {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const e = g.addEdge(sourceNodeId("L_chem_A"), motorNodeId("motor_forward"));
  e.delay_ms = 99999;
  const g2 = new NeuralGraph();
  g2.deserialize(g.serialize());
  assert.equal(g2.edges.get(e.id).delay_ms, DELAY_MS_MAX);
});

test("deserialize defaults missing delay_ms to 0", () => {
  const g = new NeuralGraph();
  g.deserialize({
    nodes: [
      { id: "node:s", neuronType: "sensor_on", sourceId: "L_chem_A", x: 0, y: 0 },
      { id: "node:m", neuronType: "motor", sourceId: "motor_forward", x: 100, y: 0 },
    ],
    edges: [{ id: "edge:1", fromId: "node:s", toId: "node:m", weight: 1 }],
  });
  assert.equal(g.edges.get("edge:1").delay_ms, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node delay-test.mjs`
Expected: FAIL — `DELAY_MS_MAX` is not exported from `src/neural/constants.js` (import error), or the field tests fail because `delay_ms` is `undefined`.

- [ ] **Step 3: Add the `DELAY_MS_MAX` constant**

In `src/neural/constants.js`, append after the `WEIGHT_DECAY_RATE` line:

```js

// Maximum axon conduction delay, in milliseconds. edge.delay_ms is clamped
// to [0, DELAY_MS_MAX]. The Bevy workshop computes delay_ms from axon
// length / conduction speed; HTML only consumes it. 500ms is ~30 ticks at
// the 60 Hz fixed step — generous headroom over real insect axon delays,
// chosen so "near vs far" neuron placement is perceptible in the main world.
export const DELAY_MS_MAX = 500;
```

- [ ] **Step 4: Add the `delay_ms` field to NeuralGraph**

In `src/neural.js`:

(a) Extend the constants import (line 20):

```js
import { LEARNING_RATE, WEIGHT_DECAY_RATE, DELAY_MS_MAX } from "./neural/constants.js";
```

(b) Add a clamp helper immediately after `clampToDaleLaw` (after its closing `}` near line 108):

```js

// Axon conduction delay clamp. delay_ms ∈ [0, DELAY_MS_MAX]; absent or
// invalid → 0 (instant — the pre-v10 default).
function clampDelayMs(ms) {
  return clamp(Number.isFinite(ms) ? ms : 0, 0, DELAY_MS_MAX);
}
```

(c) In `addEdge`, add `delay_ms: 0` to the new-edge object literal:

```js
    const edge = { id: `edge:${this.nextEdgeIndex++}`, fromId, toId, weight: 1, plastic: false, mod_source_id: null, delay_ms: 0 };
```

(d) In `serialize`, add `delay_ms` to the edge map (the `.map((edge) => ({ ...edge, weight: ... }))` block):

```js
      edges: [...this.edges.values()].map((edge) => ({
        ...edge,
        weight: edge.plastic ? clampToDaleLaw(edge.weight) : clampWeight(edge.weight),
        delay_ms: clampDelayMs(edge.delay_ms)
      })),
```

(e) In `deserialize`, add `delay_ms` to the `normalized` edge object (alongside `mod_source_id: edge.mod_source_id ?? null,`):

```js
        const normalized = {
          ...edge,
          fromId: edge.fromId ?? edge.from,
          toId: edge.toId ?? edge.to,
          plastic: edge.plastic === true,
          mod_source_id: edge.mod_source_id ?? null,
          delay_ms: clampDelayMs(edge.delay_ms)
        };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node delay-test.mjs`
Expected: PASS — `4 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add src/neural/constants.js src/neural.js delay-test.mjs
git commit -m "$(cat <<'EOF'
feat(neural): add edge.delay_ms field (axon conduction delay)

New edges default to 0 (instant). serialize/deserialize round-trip and
clamp delay_ms to [0, DELAY_MS_MAX]. First HTML-side piece of the Bevy
workshop A-lite contract (spec §7.4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Save schema v9 → v10

**Files:**
- Modify: `src/io/migrations.js`
- Test: `save-load-test.mjs:96-211` (the migrations section)

- [ ] **Step 1: Write the failing test**

In `save-load-test.mjs`, in the migrations section, add these two tests immediately after the existing `test("migrate(v8 with world=null) ...")` block (before `test("migrate(v6 with world.ant) ...")`):

```js
test("MIGRATIONS[9] upgrades v9 → v10 and seeds moduleMeta=null", () => {
  const v9 = { version: 9, graph: "{}", world: null, map: null };
  const out = MIGRATIONS[9](v9);
  assert.equal(out.version, 10);
  assert.equal(out.moduleMeta, null);
});

test("migrate(v9 payload) → CURRENT carries moduleMeta=null", () => {
  const v9 = {
    version: 9,
    graph: JSON.stringify({ nodes: [], edges: [] }),
    world: null,
    map: null,
  };
  const up = migrate(v9);
  assert.equal(up.version, CURRENT_STORAGE_VERSION);
  assert.equal(up.moduleMeta, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node save-load-test.mjs`
Expected: FAIL — `MIGRATIONS[9]` is `undefined` (so `MIGRATIONS[9](v9)` throws), and `migrate` rejects v9 as below... no — v9 ≤ current(9) so `migrate` is a no-op leaving `version: 9 !== 10`. Either way the two new tests fail.

- [ ] **Step 3: Add the v9 → v10 migrator**

In `src/io/migrations.js`:

(a) Bump the current version constant:

```js
export const CURRENT_STORAGE_VERSION = 10;
```

(b) Add a `v10` entry to the `Versions:` doc comment, after the `v9` entry:

```
 *   v10 — edges may carry `delay_ms` (axon conduction delay, default 0).
 *         The envelope grows an optional top-level `moduleMeta` block (null
 *         until a Bevy-workshop module is loaded). delay_ms needs no graph
 *         rewriting — NeuralGraph.deserialize defaults it.
```

(c) Add the migrator function after `v8_to_v9`:

```js
function v9_to_v10(data) {
  // v10: edges may carry `delay_ms`. Old edges lack the field; NeuralGraph
  // .deserialize defaults it to 0 (instant), so the graph string needs no
  // rewriting — this is a version bump plus the new optional top-level
  // `moduleMeta` block (null = no workshop module loaded), mirroring how
  // v9 introduced `map`.
  data.moduleMeta = data.moduleMeta ?? null;
  data.version = 10;
  return data;
}
```

(d) Register it in the `MIGRATIONS` table:

```js
export const MIGRATIONS = {
  6: v6_to_v7,
  7: v7_to_v8,
  8: v8_to_v9,
  9: v9_to_v10,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node save-load-test.mjs`
Expected: PASS — all tests green, including the new two and the pre-existing `MIGRATIONS has entries for every gap` / `migrate(v8 payload) → CURRENT` (which now resolve to v10 automatically).

- [ ] **Step 5: Commit**

```bash
git add src/io/migrations.js save-load-test.mjs
git commit -m "$(cat <<'EOF'
feat(io): bump save schema to v10 (edge.delay_ms + moduleMeta)

v9_to_v10 is a version bump — delay_ms defaults via NeuralGraph
.deserialize — plus the optional top-level moduleMeta block.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Delay ring buffer in the batched evaluator

**Files:**
- Modify: `src/neural/batch.js`
- Modify: `src/observation-app.js:150`
- Test: `delay-test.mjs` (extend)

- [ ] **Step 1: Write the failing test**

In `delay-test.mjs`, add a ring-buffer section just before the final `console.log(\`\n${passed} passed ...\`)` line:

```js
// ── 2. stepBatch delay ring buffer ──
console.log("stepBatch delay ring buffer");

// Build sensor(L_chem_A) → inter_exc E → motor_forward, run E with a
// constant 1.0 sensor input, and return E's per-tick output trace.
function runEcho(delayMs, ticks) {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const E = g.addNeuronNode("inter_exc", W * 0.5, H * 0.5, { label: "E", tau: 3 });
  const eIn = g.addEdge(sourceNodeId("L_chem_A"), E.id);
  g.addEdge(E.id, motorNodeId("motor_forward"));
  eIn.delay_ms = delayMs;

  const topo = compileTopology(g);           // default refDtMs = 1000/60
  const batch = createBatchState(topo, 1);
  const Eidx = topo.nodeIds.indexOf(E.id);
  const sIdx = topo.sensorSourceIds.indexOf("L_chem_A");
  const inputs = new Float32Array(topo.S);
  inputs[sIdx] = 1.0;

  const trace = [];
  for (let t = 0; t < ticks; t++) {
    stepBatch(topo, batch, inputs, { dt: 1 / 60 });
    trace.push(batch.output[Eidx]);
  }
  return trace;
}

test("delay_ms=0 leaves the trajectory unchanged (instant)", () => {
  const trace = runEcho(0, 5);
  assert.ok(trace[0] > 0, `E should respond at tick 0, got ${trace[0]}`);
});

test("delayed edge echoes the undelayed trajectory shifted by delay_ticks", () => {
  const undelayed = runEcho(0, 40);
  const delayed = runEcho(100, 40);           // 100ms / (1000/60) = 6 ticks
  // First 6 ticks: E reads zero-filled history → stays at rest.
  for (let t = 0; t < 6; t++) {
    assert.ok(delayed[t] < 1e-9, `delayed[${t}]=${delayed[t]} should be ~0`);
  }
  assert.ok(undelayed[3] > delayed[3], "undelayed responds before delayed");
  // Steady shift: delayed[t] === undelayed[t-6] (bit-for-bit).
  for (let t = 6; t < 40; t++) {
    assert.ok(
      Math.abs(delayed[t] - undelayed[t - 6]) < 1e-6,
      `delayed[${t}]=${delayed[t]} vs undelayed[${t - 6}]=${undelayed[t - 6]}`
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node delay-test.mjs`
Expected: FAIL — `delayed` and `undelayed` traces are identical (no delay applied yet), so `delayed[0] < 1e-9` fails.

- [ ] **Step 3: Add `edgeDelayTicks` + `ringSize` to `compileTopology`**

In `src/neural/batch.js`, change the `compileTopology` signature to accept a reference dt:

```js
export function compileTopology(graph, refDtMs = 1000 / 60) {
```

Then, immediately before the `// CSR-like incoming-edge index` comment block, add the delay-tick computation:

```js
  // Per-edge conduction delay, rounded to whole ticks at the fixed step.
  // ringSize covers the longest delay so the history buffer never aliases.
  const edgeDelayTicks = new Int32Array(E);
  let maxDelayTicks = 0;
  for (let e = 0; e < E; e++) {
    const ms = Number.isFinite(allEdges[e].delay_ms) ? Math.max(0, allEdges[e].delay_ms) : 0;
    const ticks = Math.round(ms / refDtMs);
    edgeDelayTicks[e] = ticks;
    if (ticks > maxDelayTicks) maxDelayTicks = ticks;
  }
  const ringSize = maxDelayTicks + 1;
```

Add both to the returned object — extend the `edgeFrom, edgeTo, ...` line of the `return { ... }`:

```js
    edgeFrom, edgeTo, edgeWeight, edgeKind, edgePlastic, edgeModSrc,
    edgeInitW, edgeDelayTicks, ringSize,
    edgeIncomingStart, edgeIncomingList,
```

- [ ] **Step 4: Add the history buffer to `createBatchState`**

In `createBatchState`, extend the destructure and the returned object:

```js
export function createBatchState(topo, A) {
  const { N, E, initState, ringSize } = topo;
```

In the returned object, add three fields after `plasticW,`:

```js
    plasticW,
    // Delay ring buffer: outputHistory[a*N*ringSize + i*ringSize + slot]
    // holds node i of ant a, written once per tick at slot = tick % ringSize.
    outputHistory: new Float32Array(A * N * ringSize),
    ringSize,
    tick: 0,
```

- [ ] **Step 5: Apply delay in `stepBatch`**

In `stepBatch`, extend the `topo` destructure to include `edgeDelayTicks` and `ringSize`:

```js
  const {
    N, E, S,
    nodeType, tau, tauDischarge, tauAdapt, gRebound, reboundThreshold,
    sensorNodeIndices,
    evalNodeIndices,
    edgeFrom, edgeWeight, edgeKind, edgePlastic, edgeModSrc,
    edgeDelayTicks, ringSize,
    edgeIncomingStart, edgeIncomingList,
  } = topo;
```

Extend the `batch` destructure to include `outputHistory`:

```js
  const { state, adapt, hRebound, output, prevOutput, plasticW, outputHistory } = batch;
```

In the feedforward eval loop (step 3), replace the `src` read. The current lines are:

```js
        const e = edgeIncomingList[p];
        const fromIdx = edgeFrom[e];
        // Sensors live at indices [0, S); the rest are eval targets.
        const src = fromIdx < S
          ? output[baseN + fromIdx]      // fresh-latched sensor signal
          : prevOutput[baseN + fromIdx]; // prev-tick output, computeSignals-style
```

Replace with:

```js
        const e = edgeIncomingList[p];
        const fromIdx = edgeFrom[e];
        // Delayed edges read the source's output delay_ticks ago from the
        // history ring. delay_ticks === 0 keeps the original read exactly:
        // sensor → this tick's freshly-latched output; non-sensor → last
        // tick's output (== history[now-1], so 0→1 tick is continuous for
        // non-sensor sources).
        const dTicks = edgeDelayTicks[e];
        let src;
        if (dTicks <= 0) {
          src = fromIdx < S
            ? output[baseN + fromIdx]      // fresh-latched sensor signal
            : prevOutput[baseN + fromIdx]; // prev-tick output, computeSignals-style
        } else {
          const slot = ((batch.tick - dTicks) % ringSize + ringSize) % ringSize;
          src = outputHistory[a * N * ringSize + fromIdx * ringSize + slot];
        }
```

Then add a new step between step 3 (the `for (let k ...)` eval loop's closing `}`) and step 4 (`// 4. Plastic weight updates.`). Insert immediately before the `// 4. Plastic weight updates.` comment:

```js
  // 3.5 Record this tick's outputs into the delay ring buffer, then advance
  //     the tick counter. Delayed edges (step 3) read past slots from here.
  const histSlot = batch.tick % ringSize;
  for (let a = 0; a < A; a++) {
    const baseN = a * N;
    const baseH = a * N * ringSize;
    for (let i = 0; i < N; i++) {
      outputHistory[baseH + i * ringSize + histSlot] = output[baseN + i];
    }
  }
  batch.tick++;

```

Finally, update the bit-equivalence note in the file header. Change the line `// Math must stay bit-equivalent to NeuralGraph.computeSignals — see the` block ending `// parity test in batch-parity-test.mjs.` to:

```js
// Math must stay bit-equivalent to NeuralGraph.computeSignals for graphs
// with no edge delays — see the parity test in batch-parity-test.mjs.
// edge.delay_ms is honoured here but not in computeSignals; a delayed
// graph is intentionally outside the parity contract (see delay-test.mjs).
```

- [ ] **Step 6: Pass `refDtMs` from the app**

In `src/observation-app.js`, in `_rebuildBatch` (line 150), pass the fixed-step duration so `delay_ms` rounds against the real sim dt:

```js
    this.topology = compileTopology(this.graph, 1000 * CONFIG.FIXED_DT);
```

(`CONFIG` is already imported at the top of `observation-app.js`.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `node delay-test.mjs`
Expected: PASS — `8 passed, 0 failed`.

- [ ] **Step 8: Run the regression suites — delay 0 must be a no-op**

Run each and confirm the pass counts hold:

```bash
node batch-parity-test.mjs
node save-load-test.mjs
node multi-ant-smoke-test.mjs
```

Expected: `batch-parity-test.mjs` ends `... passed, 0 failed`; `save-load-test.mjs` ends `... passed, 0 failed`; `multi-ant-smoke-test.mjs` ends `... passed, 0 failed`. Any failure means delay-0 stopped being a bit-exact no-op — fix before continuing.

- [ ] **Step 9: Commit**

```bash
git add src/neural/batch.js src/observation-app.js delay-test.mjs
git commit -m "$(cat <<'EOF'
feat(neural): honour edge.delay_ms in stepBatch via output-history ring

Delayed edges read their source's output delay_ticks ago. delay_ms=0 is
a bit-exact no-op — parity, save-load and multi-ant suites stay green.
computeSignals stays delay-free (editor preview only); stepBatch is
authoritative.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `umwelt-module-v1` parser

**Files:**
- Create: `src/io/module.js`
- Test: `module-test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `module-test.mjs` at the repo root:

```js
/**
 * Tests for the workshop module loader (umwelt-module-v1).
 * Run: `node module-test.mjs` from the repo root.
 */
import assert from "node:assert/strict";

import { parseModuleText, MODULE_SCHEMA } from "./src/io/module.js";
import { NeuralGraph } from "./src/neural.js";
import { compileTopology, createBatchState, stepBatch } from "./src/neural/batch.js";
import { sourceNodeId, motorNodeId, LOGIC_CANVAS } from "./src/config.js";

const W = LOGIC_CANVAS.width, H = LOGIC_CANVAS.height;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}`); console.log(`    ${err.message}`); failed++; }
}
function silenceWarn(fn) {
  const orig = console.warn; console.warn = () => {};
  try { return fn(); } finally { console.warn = orig; }
}

// Build a sensor → inter_exc(delayed) → motor graph and wrap it as a module.
function makeModuleJSON(delayMs) {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const E = g.addNeuronNode("inter_exc", W * 0.5, H * 0.5, { label: "E", tau: 3 });
  const eIn = g.addEdge(sourceNodeId("L_chem_A"), E.id);
  g.addEdge(E.id, motorNodeId("motor_forward"));
  eIn.delay_ms = delayMs;
  return {
    json: JSON.stringify({
      schema: MODULE_SCHEMA,
      level_id: "chemotaxis-l1",
      compiled_at: new Date().toISOString(),
      receptors: [],
      graph: JSON.parse(g.serialize()),
      meta: { volume_used_um3: 1000, metabolic_cost_pj_s: 50, max_path_delay_ms: 100 },
    }),
    edgeId: eIn.id,
    nodeId: E.id,
  };
}

console.log("parseModuleText");

test("parses a valid umwelt-module-v1 export", () => {
  const { json } = makeModuleJSON(100);
  const mod = parseModuleText(json);
  assert.ok(mod, "module parsed");
  assert.equal(mod.levelId, "chemotaxis-l1");
  assert.equal(typeof mod.graph, "object");
  assert.equal(mod.meta.volume_used_um3, 1000);
});

test("rejects malformed JSON", () => {
  assert.equal(parseModuleText("{not json"), null);
});

test("rejects an unknown schema", () => {
  const bad = JSON.stringify({ schema: "something-else", graph: {} });
  assert.equal(silenceWarn(() => parseModuleText(bad)), null);
});

test("rejects a module with no graph block", () => {
  const bad = JSON.stringify({ schema: MODULE_SCHEMA, level_id: "x" });
  assert.equal(silenceWarn(() => parseModuleText(bad)), null);
});

console.log("module → runnable delayed graph (end to end)");

test("a loaded module's delay_ms drives delayed behaviour in stepBatch", () => {
  const { json, edgeId, nodeId } = makeModuleJSON(100);   // 100ms = 6 ticks
  const mod = parseModuleText(json);
  const g = new NeuralGraph();
  g.deserialize(mod.graph);
  assert.equal(g.edges.get(edgeId).delay_ms, 100, "delay survived the round-trip");

  const topo = compileTopology(g);            // default refDtMs = 1000/60
  const batch = createBatchState(topo, 1);
  const Eidx = topo.nodeIds.indexOf(nodeId);
  const sIdx = topo.sensorSourceIds.indexOf("L_chem_A");
  const inputs = new Float32Array(topo.S);
  inputs[sIdx] = 1.0;

  for (let t = 0; t < 6; t++) {
    stepBatch(topo, batch, inputs, { dt: 1 / 60 });
    assert.ok(batch.output[Eidx] < 1e-9, `tick ${t}: E should still be silent`);
  }
  stepBatch(topo, batch, inputs, { dt: 1 / 60 });   // tick 6
  assert.ok(batch.output[Eidx] > 0, "E responds once the 6-tick delay elapses");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node module-test.mjs`
Expected: FAIL — `src/io/module.js` does not exist (import error).

- [ ] **Step 3: Create the module parser**

Create `src/io/module.js`:

```js
/**
 * Workshop module loader. The Bevy 3D neural workshop exports a designed
 * organ as a `umwelt-module-v1` JSON file; this parses it for the HTML
 * main world. See docs/superpowers/specs/2026-05-20-bevy-workshop-design.md §7.1.
 *
 * The module's `graph` field is the standard NeuralGraph serialization (the
 * same nested-object shape JSON.parse(NeuralGraph.serialize()) produces),
 * with edges optionally carrying `delay_ms`. `receptors` and `meta` are
 * workshop-side metadata; receptor → sensor-channel remapping is deferred
 * (no workshop exists yet, so emitted graphs already use HTML sensor
 * sourceIds).
 */

export const MODULE_SCHEMA = "umwelt-module-v1";

/**
 * Parse a workshop module export. Returns
 *   { levelId, graph, receptors, meta }
 * or null if `text` is not a structurally valid umwelt-module-v1 payload.
 * `graph` is handed to NeuralGraph.deserialize as-is.
 */
export function parseModuleText(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  if (raw.schema !== MODULE_SCHEMA) {
    console.warn(`parseModuleText: unknown schema "${raw.schema}" (expected ${MODULE_SCHEMA})`);
    return null;
  }
  if (!raw.graph || typeof raw.graph !== "object") {
    console.warn("parseModuleText: module has no graph block");
    return null;
  }
  return {
    levelId: typeof raw.level_id === "string" ? raw.level_id : null,
    graph: raw.graph,
    receptors: Array.isArray(raw.receptors) ? raw.receptors : [],
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node module-test.mjs`
Expected: PASS — `12 passed, 0 failed` (4 parser tests + 1 e2e test asserting silence for ticks 0–5 plus the tick-6 response = 6+1+... count is informational; confirm `0 failed`).

- [ ] **Step 5: Commit**

```bash
git add src/io/module.js module-test.mjs
git commit -m "$(cat <<'EOF'
feat(io): parse umwelt-module-v1 workshop exports

parseModuleText validates the schema and graph block of a Bevy-workshop
module export. End-to-end test confirms a loaded module's edge.delay_ms
drives delayed behaviour in stepBatch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Persist `moduleMeta` in the save envelope

**Files:**
- Modify: `src/io/schema.js`
- Test: `save-load-test.mjs` (extend)

- [ ] **Step 1: Write the failing test**

In `save-load-test.mjs`, add `serializeApp, applyEnvelope` to the schema imports. The file currently imports from `./src/io/migrations.js`; add a new import line after it:

```js
import { serializeApp, applyEnvelope } from "./src/io/schema.js";
```

Then add a new test section immediately before the final `console.log(\`\n${passed} passed ...\`)` line:

```js
// ── 4. moduleMeta envelope round-trip ──
console.log("schema.js moduleMeta");

test("serializeApp writes moduleMeta and stamps version 10", () => {
  const fakeApp = {
    graph: { serialize: () => "{}" },
    sensorEnabled: {},
    world: { bodyParams: { turnScale: 1, speedScale: 1 }, serializeWorld: () => null },
    sensorConfig: { toJSON: () => ({}) },
    map: null,
    moduleMeta: { volume_used_um3: 123 },
  };
  const env = serializeApp(fakeApp);
  assert.equal(env.version, 10);
  assert.deepEqual(env.moduleMeta, { volume_used_um3: 123 });
});

test("serializeApp defaults moduleMeta to null when the app has none", () => {
  const fakeApp = {
    graph: { serialize: () => "{}" },
    sensorEnabled: {},
    world: { bodyParams: { turnScale: 1, speedScale: 1 }, serializeWorld: () => null },
    sensorConfig: { toJSON: () => ({}) },
    map: null,
  };
  assert.equal(serializeApp(fakeApp).moduleMeta, null);
});

test("applyEnvelope restores moduleMeta onto the app", () => {
  const fakeApp = {
    graph: { deserialize: () => {}, ensureAnchors: () => {} },
    sourceDefs: [],
    world: { bodyParams: {} },
  };
  applyEnvelope(fakeApp, { version: 10, graph: "{}", moduleMeta: { x: 1 }, world: null });
  assert.deepEqual(fakeApp.moduleMeta, { x: 1 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node save-load-test.mjs`
Expected: FAIL — `serializeApp` output has no `moduleMeta` key (so `env.moduleMeta` is `undefined`, not `null`/the object), and `applyEnvelope` never sets `fakeApp.moduleMeta`.

- [ ] **Step 3: Add `moduleMeta` to the envelope**

In `src/io/schema.js`:

(a) Update the doc-comment envelope shape. Change the `* Save/load envelope for the Umwelt circuit (schema v9).` line to `... (schema v10).` and add a `moduleMeta` line to the `Outer shape:` block, after the `map:` line:

```
 *     map:           MapBlock | null,        // v9+; reserved for the map editor (step 2)
 *     moduleMeta:    object | null           // v10+; meta of a loaded Bevy-workshop module
```

(b) In `serializeApp`, add `moduleMeta` to the returned object, after the `map:` line:

```js
    map: app.map ?? null,
    // moduleMeta surfaces in v10: the volume / metabolic / delay metadata of
    // a loaded Bevy-workshop module (display-only; null when none loaded).
    moduleMeta: app.moduleMeta ?? null,
  };
```

(c) In `applyEnvelope`, add a restore line after the `if (data.world) { ... }` block:

```js
  if (data.moduleMeta !== undefined) {
    app.moduleMeta = data.moduleMeta;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node save-load-test.mjs`
Expected: PASS — all tests green including the three new `moduleMeta` tests.

- [ ] **Step 5: Commit**

```bash
git add src/io/schema.js save-load-test.mjs
git commit -m "$(cat <<'EOF'
feat(io): persist moduleMeta in the v10 save envelope

serializeApp / applyEnvelope round-trip the display-only metadata of a
loaded Bevy-workshop module (volume / metabolic cost / max path delay).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: "Load module" UI entry

**Files:**
- Modify: `index.html:44-50`
- Modify: `src/ui/editor.js`
- Modify: `src/observation-app.js`
- Verification: `vite build` + manual browser check

This task is DOM/file-input glue — the parser, ring buffer and persistence it relies on are all covered by Tasks 1–5. Verification is a build check plus a manual load.

- [ ] **Step 1: Add the toolbar button + file input to `index.html`**

In `index.html`, in the `<div id="editor-actions">` block (lines 44–49), add a "load module" button as the first child, before the `import` button:

```html
    <div id="editor-actions">
      <button class="btn mono" id="editor-load-module-btn" type="button">load module</button>
      <button class="btn mono" id="editor-import-btn" type="button">import</button>
      <button class="btn mono" id="editor-export-btn" type="button">export</button>
      <button class="btn mono" id="editor-reset-btn" type="button">reset</button>
      <button class="btn primary mono" id="editor-run-btn" type="button">▶ run</button>
    </div>
```

And add a hidden file input immediately after the existing `editor-import-file` input (line 50):

```html
    <input type="file" id="editor-import-file" accept=".json" style="display:none">
    <input type="file" id="editor-module-file" accept=".json" style="display:none">
```

- [ ] **Step 2: Wire the button in `src/ui/editor.js`**

In the `NeuralEditor` constructor, add two element refs after `this.importFile = document.getElementById("editor-import-file");`:

```js
    this.loadModuleBtn = document.getElementById("editor-load-module-btn");
    this.moduleFile = document.getElementById("editor-module-file");
```

In `bind()`, add the click/change wiring after the `this.importFile.addEventListener("change", ...)` block (after its closing `});`):

```js
    this.loadModuleBtn?.addEventListener("click", () => this.moduleFile.click());
    this.moduleFile?.addEventListener("change", () => {
      const file = this.moduleFile.files[0];
      if (file) {
        file.text().then((text) => this.callbacks.onLoadModule?.(text));
        this.moduleFile.value = "";
      }
    });
```

- [ ] **Step 3: Add `_loadModule` to `src/observation-app.js`**

(a) Add `parseModuleText` to the imports. After the `import { ... } from "./io/schema.js";` block, add:

```js
import { parseModuleText } from "./io/module.js";
```

(b) In the constructor, initialise the field. After `this.deathShown = false;`:

```js
    this.deathShown = false;
    this.moduleMeta = null;
```

(c) In the `NeuralEditor` callbacks object (the `new NeuralEditor({ ... })` argument), add `onLoadModule` after `onImport`:

```js
      onImport: (text) => this._importCircuit(text),
      onLoadModule: (text) => this._loadModule(text),
```

(d) Add the `_loadModule` method immediately after `_importCircuit`:

```js
  _loadModule(text) {
    const mod = parseModuleText(text);
    if (!mod) {
      this.world.log("danger", "装载模块：文件不是有效的 umwelt-module 导出");
      return;
    }
    // The module graph is the standard NeuralGraph serialization; install
    // it like an imported circuit. ensureAnchors re-pins sensor/motor nodes
    // to the current sensor config. moduleMeta is display-only metadata.
    this.graph.deserialize(mod.graph);
    this.graph.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, false, this.sourceDefs);
    this.moduleMeta = mod.meta;
    this._handleGraphChange();
  }
```

- [ ] **Step 4: Verify the build passes**

Run: `npx vite build`
Expected: build completes with no errors (the `dist/` bundle is written).

- [ ] **Step 5: Manual browser verification**

Start the dev server: `npm run dev`, open `index.html` in the browser.

Create a test module file `module-fixture.json` anywhere on disk:

```json
{
  "schema": "umwelt-module-v1",
  "level_id": "chemotaxis-l1",
  "compiled_at": "2026-05-21T00:00:00.000Z",
  "receptors": [],
  "graph": {
    "nodes": [
      { "id": "node:s", "neuronType": "sensor_on", "sourceId": "L_chem_A", "x": 80, "y": 200 },
      { "id": "node:e", "neuronType": "inter_exc", "sourceId": null, "x": 480, "y": 200, "tau": 3, "label": "E" },
      { "id": "node:m", "neuronType": "motor", "sourceId": "motor_forward", "x": 880, "y": 200 }
    ],
    "edges": [
      { "id": "edge:1", "fromId": "node:s", "toId": "node:e", "weight": 1, "delay_ms": 300 },
      { "id": "edge:2", "fromId": "node:e", "toId": "node:m", "weight": 1, "delay_ms": 0 }
    ],
    "nextNeuronIndex": 2,
    "nextEdgeIndex": 3
  },
  "meta": { "volume_used_um3": 1000, "metabolic_cost_pj_s": 50, "max_path_delay_ms": 300 }
}
```

Confirm, in order:
1. Open the neural editor overlay → the toolbar shows a **load module** button.
2. Click **load module**, pick `module-fixture.json` → the circuit is replaced by the 3-node graph (sensor → E → motor_forward); no console errors.
3. Click **▶ run** → the ant moves; behaviour reflects the 300 ms (~18-tick) delay on the sensor→E edge (forward thrust visibly lags a change in `L_chem_A`).
4. Pick a non-module JSON file (e.g. a normal `umwelt-circuit-*.json` save) via **load module** → a `装载模块：…` danger entry appears in the log and the circuit is left unchanged.
5. Reload the page → the loaded circuit persists (it was saved through `_handleGraphChange` → `saveCircuit`).

- [ ] **Step 6: Commit**

```bash
git add index.html src/ui/editor.js src/observation-app.js
git commit -m "$(cat <<'EOF'
feat(ui): add "load module" entry for Bevy-workshop exports

Editor toolbar button parses a umwelt-module-v1 file and installs its
graph onto the live ant; invalid files log a warning and no-op.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage** (against `2026-05-20-bevy-workshop-design.md` §7.4 — "HTML 侧的局部改动"):

| Spec §7.4 requirement | Task |
|---|---|
| `NeuralGraph` edge struct gains `delay_ms` (default 0, backward-compatible) | Task 1 |
| evaluator implements a ring buffer | Task 3 (`stepBatch`) |
| save schema v9 → v10 (delay_ms + optional module-loaded metadata block) | Tasks 2 (version + moduleMeta migrator) + 5 (envelope field) |
| main-world UI gains a "load module" entry accepting workshop JSON export | Tasks 4 (parser) + 6 (UI) |
| main world's chem field / ant kinematics / plasticity rules unchanged | Honoured — no task touches `world.js` or the plasticity update logic |

Module JSON format (`umwelt-module-v1`, §7.1) — the parser (Task 4) consumes `schema` / `level_id` / `graph` / `receptors` / `meta`. `receptors` remapping is explicitly deferred (documented in the decisions block and `module.js`).

**2. Placeholder scan:** No "TBD" / "handle edge cases" / "similar to Task N" / bare descriptions — every code step carries complete code. Manual steps (Task 6 §5) list concrete, checkable conditions and a full fixture file. ✓

**3. Type consistency:** `delay_ms` (edge field) — same name everywhere. `edgeDelayTicks` / `ringSize` — added to the `compileTopology` return, destructured under the same names in `stepBatch`, and `ringSize` re-read in `createBatchState`. `outputHistory` / `tick` — added to `createBatchState` output, read in `stepBatch` as `batch.outputHistory` (destructured) and `batch.tick` (direct). `parseModuleText` / `MODULE_SCHEMA` — exported from `module.js`, imported under the same names in `module-test.mjs` and `observation-app.js`. `moduleMeta` — same key in `serializeApp`, `applyEnvelope`, `v9_to_v10`, and `observation-app` field. `compileTopology(graph, refDtMs)` — new optional param; the only non-default caller is `observation-app` (passes `1000 * CONFIG.FIXED_DT`); `batch-parity-test.mjs` and the new test files use the default `1000/60`, valid because their graphs are delay-free or explicitly 60 Hz. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-html-edge-delay.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
