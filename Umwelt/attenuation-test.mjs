/**
 * Tests for per-edge signal attenuation (edge.attenuation) — the §7.4 HTML
 * companion to the Bevy workshop's distance → attenuation honest chain.
 *
 * Sits in the same lane as delay_ms: a scalar baked onto the edge that the
 * evaluator multiplies into the transmitted contribution. Default 1.0
 * (full passthrough) so pre-existing graphs are unchanged.
 *
 * Run: `node attenuation-test.mjs` from the repo root.
 */
import assert from "node:assert/strict";

import { NeuralGraph } from "./src/neural.js";
import { compileTopology, createBatchState, stepBatch } from "./src/neural/batch.js";
import { sourceNodeId, motorNodeId, LOGIC_CANVAS } from "./src/config.js";
import {
  MIGRATIONS,
  CURRENT_STORAGE_VERSION,
} from "./src/io/migrations.js";

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

// ── 1. edge.attenuation field on NeuralGraph ──
console.log("edge.attenuation field");

test("new edges default attenuation to 1.0", () => {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const e = g.addEdge(sourceNodeId("L_chem_A"), motorNodeId("motor_forward"));
  assert.equal(e.attenuation, 1.0);
});

test("serialize/deserialize round-trips attenuation", () => {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const e = g.addEdge(sourceNodeId("L_chem_A"), motorNodeId("motor_forward"));
  e.attenuation = 0.4;
  const g2 = new NeuralGraph();
  g2.deserialize(g.serialize());
  assert.equal(g2.edges.get(e.id).attenuation, 0.4);
});

test("deserialize clamps attenuation to [0,1]", () => {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const e = g.addEdge(sourceNodeId("L_chem_A"), motorNodeId("motor_forward"));
  e.attenuation = 5;
  const g2 = new NeuralGraph();
  g2.deserialize(g.serialize());
  assert.equal(g2.edges.get(e.id).attenuation, 1);

  const g3 = new NeuralGraph();
  g3.ensureAnchors(W, H, true);
  const e3 = g3.addEdge(sourceNodeId("R_chem_A"), motorNodeId("motor_forward"));
  e3.attenuation = -0.2;
  const g4 = new NeuralGraph();
  g4.deserialize(g3.serialize());
  assert.equal(g4.edges.get(e3.id).attenuation, 0);
});

test("deserialize defaults missing attenuation to 1.0 (back-compat)", () => {
  const g = new NeuralGraph();
  g.deserialize({
    nodes: [
      { id: "node:s", neuronType: "sensor_on", sourceId: "L_chem_A", x: 0, y: 0 },
      { id: "node:m", neuronType: "motor", sourceId: "motor_forward", x: 100, y: 0 },
    ],
    edges: [{ id: "edge:1", fromId: "node:s", toId: "node:m", weight: 1 }],
  });
  assert.equal(g.edges.get("edge:1").attenuation, 1.0);
});

// ── 2. Evaluator honours attenuation in stepBatch ──
console.log("stepBatch attenuation");

// sensor(L_chem_A) → motor_forward, driven by 1.0 sensor input. Returns the
// motor's tick-by-tick output trace.
function runDirect(attenuation, ticks) {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const e = g.addEdge(sourceNodeId("L_chem_A"), motorNodeId("motor_forward"));
  e.attenuation = attenuation;

  const topo = compileTopology(g);
  const batch = createBatchState(topo, 1);
  const motorIdx = topo.nodeIds.indexOf(motorNodeId("motor_forward"));
  const sIdx = topo.sensorSourceIds.indexOf("L_chem_A");
  const inputs = new Float32Array(topo.S);
  inputs[sIdx] = 1.0;

  const trace = [];
  for (let t = 0; t < ticks; t++) {
    stepBatch(topo, batch, inputs, { dt: 1 / 60 });
    trace.push(batch.output[motorIdx]);
  }
  return trace;
}

test("attenuation=1.0 — full signal passes through (baseline)", () => {
  const trace = runDirect(1.0, 50);
  // edge.weight defaults to 1, attenuation 1 → motor sees full source.
  // Motor is direct (no leaky integrator), so steady-state is reached tick 0.
  assert.ok(trace[49] > 0.99, `motor[49]=${trace[49]} should be ≈1.0`);
});

test("attenuation=0.5 halves the transmitted signal", () => {
  const baseline = runDirect(1.0, 50);
  const halved = runDirect(0.5, 50);
  // Motor: outVal = clamp(netInput, -1, 1) and netInput = srcSignal * weight * atten.
  // weight defaults to 1, src=1, so baseline[t] ≈ 1 and halved[t] ≈ 0.5.
  assert.ok(Math.abs(halved[49] - 0.5) < 1e-5, `halved[49]=${halved[49]} should be ≈0.5`);
  assert.ok(baseline[49] > halved[49] + 0.4, "baseline visibly exceeds halved");
});

test("attenuation=0 blocks the signal", () => {
  const trace = runDirect(0, 50);
  for (let t = 0; t < 50; t++) {
    assert.ok(trace[t] < 1e-9, `blocked[${t}]=${trace[t]} should be ~0`);
  }
});

// ── 3. computeSignals also honours attenuation (editor preview path) ──
console.log("computeSignals attenuation");

test("computeSignals multiplies contribution by attenuation", () => {
  const g = new NeuralGraph();
  g.ensureAnchors(W, H, true);
  const e = g.addEdge(sourceNodeId("L_chem_A"), motorNodeId("motor_forward"));
  e.attenuation = 0.3;

  // Drive the sensor by sourceOutputs map. motor_forward is direct, so its
  // first-tick output ≈ source * weight * attenuation.
  const sourceOutputs = { L_chem_A: 1.0 };
  const { nodeSignals } = g.computeSignals(sourceOutputs, {}, { commit: true, dt: 1 / 60 });
  const motorId = motorNodeId("motor_forward");
  assert.ok(Math.abs(nodeSignals[motorId] - 0.3) < 1e-5,
    `motor=${nodeSignals[motorId]} should be ≈0.3`);
});

// ── 4. Save-schema v10 → v11 migration ──
console.log("save schema v11");

test("CURRENT_STORAGE_VERSION is 11", () => {
  assert.equal(CURRENT_STORAGE_VERSION, 11);
});

test("MIGRATIONS[10] upgrades v10 → v11 (version bump)", () => {
  const v10 = { version: 10, graph: "{}", world: null, map: null, moduleMeta: null };
  const out = MIGRATIONS[10](v10);
  assert.equal(out.version, 11);
});

test("v10 payload migrates cleanly — edges get attenuation=1.0 default on graph deserialize", () => {
  // A v10 save with one edge that lacks attenuation. After migration +
  // NeuralGraph.deserialize, the edge should carry attenuation = 1.0.
  const graphJSON = JSON.stringify({
    nodes: [
      { id: "node:s", neuronType: "sensor_on", sourceId: "L_chem_A", x: 0, y: 0 },
      { id: "node:m", neuronType: "motor", sourceId: "motor_forward", x: 100, y: 0 },
    ],
    edges: [{ id: "edge:1", fromId: "node:s", toId: "node:m", weight: 1, delay_ms: 0 }],
    nextNeuronIndex: 1,
    nextEdgeIndex: 2,
  });
  const g = new NeuralGraph();
  g.deserialize(graphJSON);
  assert.equal(g.edges.get("edge:1").attenuation, 1.0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
