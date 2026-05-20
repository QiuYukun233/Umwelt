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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
