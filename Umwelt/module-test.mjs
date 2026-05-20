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
