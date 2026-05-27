// tools/dump-oracle-fixtures.mjs
// Run: node tools/dump-oracle-fixtures.mjs
// Writes 5 fixture JSONs to ../umwelt-bevy/crates/grid_workshop/tests/fixtures/eval/
// for the Bevy eval-layer oracle integration tests (C-3 v0.3 Task 7).

// DOM shim — many src files touch document/window during evaluator init.
globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({ addEventListener: () => {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, style: {}, children: [], querySelectorAll: () => [], replaceChildren: () => {} }), createElement: () => ({ className: '', innerHTML: '', textContent: '', style: {}, children: [], firstElementChild: { style: {} }, appendChild: () => {}, cloneNode: () => ({}) }), createDocumentFragment: () => ({ appendChild: () => {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, prompt: () => null, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, innerWidth: 960, innerHeight: 640 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.requestAnimationFrame = () => {};

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { NeuralGraph } from "../src/neural.js";
import { compileTopology, createBatchState, stepBatch } from "../src/neural/batch.js";
import {
  sourceNodeId,
  motorNodeId,
  LOGIC_CANVAS,
  buildSourceDefinitions,
} from "../src/config.js";
import { NEMATODE } from "../src/creatures/nematode.js";

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

// Assign synthetic (layer, x, y) to each node:
//  sensors → (0, idx, 0)
//  non-sensors → (1, idx, 0)
function assignCoords(graph) {
  const nodes = [...graph.nodes.values()];
  const sensors = nodes.filter((n) => (n.neuronType ?? n.type) === "sensor_on");
  const others = nodes.filter((n) => (n.neuronType ?? n.type) !== "sensor_on");
  const coords = new Map();
  sensors.forEach((n, idx) => coords.set(n.id, [0, idx, 0]));
  others.forEach((n, idx) => coords.set(n.id, [1, idx, 0]));
  return coords;
}

const KIND_NAME = {
  sensor_on: "SensorOn",
  inter_exc: "InterExc",
  inter_inh: "InterInh",
  modulator: "Modulator",
  motor: "Motor",
};

// Stepwise 6-connected path: walk layer, then x, then y, one step at a time.
function synthPath([fi, fj, fk], [ti, tj, tk]) {
  const path = [[fi, fj, fk]];
  let [i, j, k] = [fi, fj, fk];
  while (i !== ti) { i += Math.sign(ti - i); path.push([i, j, k]); }
  while (j !== tj) { j += Math.sign(tj - j); path.push([i, j, k]); }
  while (k !== tk) { k += Math.sign(tk - k); path.push([i, j, k]); }
  return path;
}

function buildFixture({
  name,
  source,
  graph,
  inputTimeline,
  motorTrace,
  sensorIds,
  motorIds,
  edgeOverrides,
  extras = {},
}) {
  const coords = assignCoords(graph);
  // Only include nodes referenced as endpoints or as sensors/motors of
  // interest. We keep every node so the Bevy port has the full topology.
  const neurons = [...graph.nodes.values()].map((n) => ({
    coord: coords.get(n.id),
    kind: KIND_NAME[n.neuronType ?? n.type],
    tau: n.tau ?? null,
  }));
  const edges = [...graph.edges.values()].map((e) => {
    const ov = edgeOverrides?.get(e.id) ?? {};
    return {
      from: coords.get(e.fromId),
      to: coords.get(e.toId),
      path: synthPath(coords.get(e.fromId), coords.get(e.toId)),
      thickness_d: 1.0,
      plastic: e.plastic ?? false,
      mod_source: e.mod_source_id ? coords.get(e.mod_source_id) : null,
      delay_ticks_override: ov.delayTicks ?? null,
      attenuation_override: ov.attenuation ?? null,
      init_w_override: ov.initW ?? null,
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

// Default ensureAnchors uses the ant SOURCE_DEFINITIONS, which is what
// delay-test / attenuation-test / batch-parity rely on. The oscillator
// uses the nematode F0 sensor + leftLeg/rightLeg motors.
function withAntAnchors(g) {
  g.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, true);
}

function withNematodeAnchors(g) {
  const sourceDefs = buildSourceDefinitions(NEMATODE.sensors);
  g.ensureAnchors(LOGIC_CANVAS.width, LOGIC_CANVAS.height, true, sourceDefs);
  // Inject leftLeg / rightLeg motor nodes manually (default MOTOR_IDS = ant).
  // The graph still has ant motor anchors from ensureAnchors; that's fine —
  // we don't connect to them. Just add the legs the oscillator needs.
  const motorY = LOGIC_CANVAS.height * 0.5;
  const motorX = LOGIC_CANVAS.width * 0.85;
  for (const m of ["leftLeg", "rightLeg"]) {
    const id = motorNodeId(m);
    if (!g.nodes.has(id)) {
      g.upsertNode(id, {
        id,
        neuronType: "motor",
        sourceId: m,
        label: m,
        kind: "motor",
        x: motorX,
        y: motorY,
      }, true);
    }
  }
  // Inject F0 if missing (it should already be there from nematode defs).
  const f0 = sourceNodeId("F0");
  if (!g.nodes.has(f0)) {
    g.upsertNode(f0, {
      id: f0,
      neuronType: "sensor_on",
      sourceId: "F0",
      label: "F0",
      kind: "food",
      x: 50,
      y: LOGIC_CANVAS.height * 0.5,
    }, true);
  }
}

// ── Oracle 1: delay-echo ────────────────────────────────────────────────
function buildDelayEcho() {
  const g = new NeuralGraph();
  withAntAnchors(g);
  const E = g.addNeuronNode("inter_exc", LOGIC_CANVAS.width * 0.5, LOGIC_CANVAS.height * 0.5, { label: "E", tau: 3 });
  const eIn = g.addEdge(sourceNodeId("L_chem_A"), E.id);
  g.addEdge(E.id, motorNodeId("motor_forward"));
  eIn.delay_ms = 100;

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
  const g = new NeuralGraph();
  withAntAnchors(g);
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
  const g = new NeuralGraph();
  withAntAnchors(g);
  const M = g.addNeuronNode("modulator", LOGIC_CANVAS.width * 0.5, LOGIC_CANVAS.height * 0.3, { label: "M", tau: 15 });
  const I = g.addNeuronNode("inter_exc", LOGIC_CANVAS.width * 0.5, LOGIC_CANVAS.height * 0.6, { label: "I", tau: 3 });
  g.addEdge(sourceNodeId("L_chem_A"), M.id);
  const ep = g.addEdge(sourceNodeId("L_chem_A"), I.id);
  // Match plasticity-unit-test.mjs "saturation" subtest (line 87-104):
  // baseline weight 0.5 then plastic ON, driven by pre=post=mod=1 → w→1.
  // (The "growth-from-zero" subtest C2 deadlocks under stepBatch because a
  // w=0 plastic edge produces post=0, killing Hebbian drive; that test
  // bypasses the evaluator with direct updatePlasticWeights calls.)
  g.updateEdgeWeight(ep.id, 0.5);
  g.setEdgePlastic(ep.id, { plastic: true, modSourceId: M.id });
  g.addEdge(I.id, motorNodeId("motor_forward"));

  const topo = compileTopology(g);
  const batch = createBatchState(topo, 1);
  const sIdx = topo.sensorSourceIds.indexOf("L_chem_A");
  const mIdx = topo.motorNodeIndices[topo.motorSourceIds.indexOf("motor_forward")];

  const inputs = new Float32Array(topo.S);
  inputs[sIdx] = 1.0;

  const inputTimeline = [];
  const motorTrace = [];
  const plasticWTrace = [];
  const plasticEdgeIdx = [...topo.edgePlastic].findIndex((p) => p);
  for (let t = 0; t < 300; t++) {
    stepBatch(topo, batch, inputs, { dt: 1 / 60 });
    inputTimeline.push([1.0]);
    motorTrace.push([batch.output[mIdx]]);
    plasticWTrace.push([batch.plasticW[plasticEdgeIdx]]);
  }

  const edgeOverrides = new Map([[ep.id, { initW: 0.5 }]]);

  const fx = buildFixture({
    name: "hebbian-saturation",
    source: "plasticity-unit-test.mjs C2 (saturation subtest)",
    graph: g,
    inputTimeline,
    motorTrace,
    sensorIds: [sourceNodeId("L_chem_A")],
    motorIds: [motorNodeId("motor_forward")],
    edgeOverrides,
  });
  fx.plastic_w_trace = plasticWTrace;
  return fx;
}

// ── Oracle 4: parity-no-delay ──────────────────────────────────────────
function buildParityNoDelay() {
  const g = new NeuralGraph();
  withAntAnchors(g);
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

// ── Oracle 5: oscillator-mutual-inhibition (pure-circuit) ───────────────
function buildOscillator() {
  const g = new NeuralGraph();
  withNematodeAnchors(g);
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
  if (sIdx < 0) throw new Error("F0 sensor not in compiled topology");
  const leftMSidx = topo.motorSourceIds.indexOf("leftLeg");
  const rightMSidx = topo.motorSourceIds.indexOf("rightLeg");
  if (leftMSidx < 0 || rightMSidx < 0) throw new Error("leftLeg/rightLeg motor missing");
  const leftIdx = topo.motorNodeIndices[leftMSidx];
  const rightIdx = topo.motorNodeIndices[rightMSidx];

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
