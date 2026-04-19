// Plasticity emergence test — spec §7 from docs/step5-plastic-synapses.md.
//
// The spec describes a "hunger modulator bound to the internal hunger
// signal." The ant has no such channel: `energy` (1.0 = full,
// 0.0 = depleted) is the only internal state, and ant.js:137 explicitly
// refuses a "hunger semantic" on that channel. Inverting `energy` to
// produce "hunger-high when energy-low" is awkward in this codebase's
// magnitude-only weight model (inter_inh outputs a positive magnitude
// that acts inhibitorily at the sink, so "double inhibition = net
// excitation" doesn't work the way the spec's signed-weight mental
// model implies).
//
// Resolution agreed with the designer: this test feeds the modulator
// from a synthetic test_hunger sensor driven directly from the harness,
// rather than growing the ant's body plan for the sake of one test or
// contorting the circuit to invert a magnitude signal. The test still
// exercises the real plasticity update on a real NeuralGraph — only
// the *source* of the modulator's input is synthetic.
//
// Run: node plasticity-test.mjs

globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({ addEventListener: () => {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, style: {}, children: [], querySelectorAll: () => [], replaceChildren: () => {} }), createElement: () => ({ className: '', innerHTML: '', textContent: '', style: {}, children: [], firstElementChild: { style: {} }, appendChild: () => {}, cloneNode: () => ({}) }), createDocumentFragment: () => ({ appendChild: () => {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, prompt: () => null, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, innerWidth: 960, innerHeight: 640 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.requestAnimationFrame = () => {};

const { NeuralGraph } = await import('./src/neural.js');

const W = 960, H = 640;
const DT = 1 / 60;
const TICKS_PER_SEC = Math.round(1 / DT);

let fails = 0;
function assert(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { console.log(`  FAIL ${name} ${detail}`); fails += 1; }
}

function buildEmergenceGraph() {
  const g = new NeuralGraph();
  g.reset(W, H);            // populates all sensor/motor anchors
  g.edges.clear();           // but start with no wiring
  // Remove the default-circuit helper inter_exc nodes (E1..E5) so the test
  // topology is minimal and the only path ChemC → turn_L is the one we wire.
  for (const node of [...g.nodes.values()]) {
    if ((node.neuronType ?? node.type) === "inter_exc") g.nodes.delete(node.id);
  }
  g.resetState();

  // Minimal test circuit.
  const hungerSensor = g.addNeuronNode("sensor_on", 80, 560, {
    sourceId: "test_hunger", label: "SHUN"
  });
  const modulator = g.addNeuronNode("modulator", 260, 560, { label: "MHUN" });
  const teacher = g.addNeuronNode("inter_exc", 320, 420, { label: "TEACH", tau: 1.5 });

  const chemCL = [...g.nodes.values()].find((n) => n.sourceId === "L_chem_C");
  const turnL = [...g.nodes.values()].find((n) => n.sourceId === "motor_turn_L");
  if (!chemCL) throw new Error("L_chem_C sensor anchor not found — check sensorDefs");
  if (!turnL) throw new Error("motor_turn_L anchor not found");

  // Hunger sensor → modulator (excitatory). sensor_on output becomes the
  // modulator's integrated state (leaky, smoothed by tau).
  g.addEdge(hungerSensor.id, modulator.id);

  // The plastic synapse under test: ChemC (L) → turn_L, starts at w_init = 0.
  const plasticEdge = g.addEdge(chemCL.id, turnL.id);
  g.setEdgePlastic(plasticEdge.id, { plastic: true, modSourceId: modulator.id });
  g.updateEdgeWeight(plasticEdge.id, 0); // on plastic edge: allowed

  // Teacher path: ChemC → inter_exc → turn_L. Forces post>0 during phase 1
  // so that pre * post * mod is all-positive whenever ChemC + hunger coincide.
  // Removed at the start of phase 2 so the plastic synapse is the only
  // remaining ChemC → turn_L pathway.
  g.addEdge(chemCL.id, teacher.id);
  const teacherOut = g.addEdge(teacher.id, turnL.id);

  return { g, plasticId: plasticEdge.id, teacherOutId: teacherOut.id, turnL, modulator };
}

function stepOnce(g, { chemC, hunger }) {
  g.computeSignals(
    { L_chem_C: chemC, test_hunger: hunger },
    {},
    { commit: true, dt: DT }
  );
}

function probeMotor(g, turnLId, { chemC, hunger }) {
  // Non-committing probe: does not mutate node state or plastic weights.
  const { nodeSignals } = g.computeSignals(
    { L_chem_C: chemC, test_hunger: hunger },
    {},
    { commit: false, dt: DT }
  );
  return nodeSignals[turnLId] ?? 0;
}

function runSteps(g, n, sourceFn) {
  for (let t = 0; t < n; t++) stepOnce(g, sourceFn(t));
}

// ─── Emergence test (spec §7) ───
{
  console.log("\n═══ Emergence test: associative learning of ChemC → turn_L ═══");
  const { g, plasticId, teacherOutId, turnL } = buildEmergenceGraph();
  const plastic = () => g.edges.get(plasticId);

  const w_initial = plastic().w;
  assert("Phase 0: starts with w_init = 0", w_initial === 0);

  // ── Phase 1: training. ChemC present, hungry, teacher active. ──
  // Durations are test-friendly (shorter than the spec's narrative) but
  // preserve ordinal behaviour: long enough to learn, not long enough
  // to saturate.
  runSteps(g, 5 * TICKS_PER_SEC, () => ({ chemC: 0.6, hunger: 0.9 }));
  const w_phase1 = plastic().w;
  console.log(`  phase 1 end: w = ${w_phase1.toFixed(3)}`);
  assert("Phase 1: w grew substantially from baseline", w_phase1 > 0.2, `got ${w_phase1.toFixed(3)}`);
  assert("Phase 1: w did not hit the Dale's Law ceiling", w_phase1 < 1.0);

  // ── Phase 2: learned. Remove teacher. Still hungry, ChemC still present. ──
  g.removeEdge(teacherOutId);
  // A couple of seconds to let turn_L motor read the new equilibrium
  // (motor output is instantaneous, but upstream node state smooths out).
  runSteps(g, 2 * TICKS_PER_SEC, () => ({ chemC: 0.6, hunger: 0.9 }));
  const w_phase2 = plastic().w;
  const turnL_on = probeMotor(g, turnL.id, { chemC: 0.6, hunger: 0.9 });
  const turnL_off = probeMotor(g, turnL.id, { chemC: 0, hunger: 0.9 });
  console.log(`  phase 2 end: w = ${w_phase2.toFixed(3)}, turn_L(ChemC on) = ${turnL_on.toFixed(3)}, turn_L(ChemC off) = ${turnL_off.toFixed(3)}`);
  assert("Phase 2: plastic edge alone drives turn_L above baseline",
    turnL_on > turnL_off + 0.05,
    `diff = ${(turnL_on - turnL_off).toFixed(3)}`);
  assert("Phase 2: w > 0.1 — learning persisted after teacher removal",
    w_phase2 > 0.1,
    `got ${w_phase2.toFixed(3)}`);

  // ── Phase 3: sated. Hunger drops to 0 → modulator → 0 → Hebbian term dies. ──
  // Only decay drives w now. Runs long enough for w to return to within
  // 0.05 of w_init (= 0).
  runSteps(g, 60 * TICKS_PER_SEC, () => ({ chemC: 0, hunger: 0 }));
  const w_phase3 = plastic().w;
  console.log(`  phase 3 end: w = ${w_phase3.toFixed(3)}`);
  assert("Phase 3: w decayed strictly below phase-2 value",
    w_phase3 < w_phase2 * 0.5,
    `phase2 = ${w_phase2.toFixed(3)}, phase3 = ${w_phase3.toFixed(3)}`);

  // ── Phase 4: forgotten. A bit more idle time, check we're near baseline. ──
  runSteps(g, 30 * TICKS_PER_SEC, () => ({ chemC: 0, hunger: 0 }));
  const w_phase4 = plastic().w;
  console.log(`  phase 4 end: w = ${w_phase4.toFixed(3)}`);
  assert("Phase 4: w within 0.05 of w_init = 0", Math.abs(w_phase4) < 0.05, `got ${w_phase4.toFixed(3)}`);
}

// ─── Secondary: no modulator ⇒ no learning (only decay) ───
{
  console.log("\n═══ Secondary: mod=0 yields monotonic decay, never increase ═══");
  const { g, plasticId, teacherOutId, modulator } = buildEmergenceGraph();
  const plastic = () => g.edges.get(plasticId);
  // Isolate the plastic edge: no teacher (so post stays ~0 from ChemC alone
  // while w is still near baseline) and force the modulator hard to 0
  // (sensor input alone takes several tau to decay off the initial state).
  g.removeEdge(teacherOutId);
  plastic().w = 0.5;
  modulator.state = 0;
  let prev = plastic().w;
  let everIncreased = false;
  for (let t = 0; t < 3000; t++) {
    stepOnce(g, { chemC: 0.8, hunger: 0 });
    modulator.state = 0; // hold mod pinned at zero — "no modulator" regime
    const now = plastic().w;
    if (now > prev + 1e-9) everIncreased = true;
    prev = now;
  }
  assert("mod=0: w never increased over 3000 ticks", !everIncreased);
  assert("mod=0: w strictly decreased below 0.5", plastic().w < 0.5);
}

// ─── Secondary: save/load round-trip in the middle of learning ───
{
  console.log("\n═══ Secondary: save mid-phase, load, continue behaves identically ═══");
  const fixture = buildEmergenceGraph();
  const plastic1 = () => fixture.g.edges.get(fixture.plasticId);
  // Train to mid-range.
  runSteps(fixture.g, 3 * TICKS_PER_SEC, () => ({ chemC: 0.6, hunger: 0.9 }));
  const w_mid = plastic1().w;
  const saved = fixture.g.serialize();

  // Continue on the original.
  runSteps(fixture.g, 1 * TICKS_PER_SEC, () => ({ chemC: 0.6, hunger: 0.9 }));
  const w_afterA = plastic1().w;

  // Reload and continue on the clone.
  const cloneG = new NeuralGraph();
  cloneG.deserialize(saved);
  const plastic2 = () => cloneG.edges.get(fixture.plasticId);
  assert("round-trip: mid-learning w preserved bit-identical", plastic2().w === w_mid, `got ${plastic2().w} vs ${w_mid}`);
  runSteps(cloneG, 1 * TICKS_PER_SEC, () => ({ chemC: 0.6, hunger: 0.9 }));
  const w_afterB = plastic2().w;

  // Because node state (modulator, teacher inter_exc, sensor adapt) is also
  // serialized, the post-reload trajectory matches within floating-point.
  assert("round-trip: resumed trajectory matches original", Math.abs(w_afterA - w_afterB) < 1e-6, `A=${w_afterA} B=${w_afterB}`);
}

console.log(fails === 0 ? "\nplasticity-test OK" : `\nplasticity-test FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
