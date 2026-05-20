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
