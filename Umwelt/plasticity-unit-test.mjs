// Plasticity unit tests. Exercises data model invariants, Hebbian math
// (closed-form), Dale's Law clamp, evaluator use of runtime vs authored
// weight, and save/load migration against NeuralGraph's public API.
// The closed-loop §7 emergence demo lives in plasticity-test.mjs.
//
// Run: node plasticity-unit-test.mjs
globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({ addEventListener: () => {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, style: {}, children: [], querySelectorAll: () => [], replaceChildren: () => {} }), createElement: () => ({ className: '', innerHTML: '', textContent: '', style: {}, children: [], firstElementChild: { style: {} }, appendChild: () => {}, cloneNode: () => ({}) }), createDocumentFragment: () => ({ appendChild: () => {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, prompt: () => null, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, innerWidth: 960, innerHeight: 640 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.requestAnimationFrame = () => {};

const { NeuralGraph } = await import('./src/neural.js');
const { LEARNING_RATE, WEIGHT_DECAY_RATE } = await import('./src/neural/constants.js');

let fails = 0;
function assert(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { console.log(`  FAIL ${name} ${detail}`); fails += 1; }
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

function makeGraph() {
  const g = new NeuralGraph();
  g.nodes.clear();
  g.edges.clear();
  g.nextNeuronIndex = 1;
  g.nextEdgeIndex = 1;
  return g;
}

// ─── C1 invariants (regression) ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  assert('addEdge defaults plastic=false', e.plastic === false);
  const origWarn = console.warn;
  let warns = [];
  console.warn = (...args) => { warns.push(args.join(' ')); };
  assert('setEdgePlastic rejects non-modulator', g.setEdgePlastic(e.id, { plastic: true, modSourceId: a.id }) === null);
  warns = [];
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  assert('setEdgePlastic accepts modulator', e.plastic === true && e.w === 1);
  g.updateEdgeWeight(e.id, 0);
  assert('plastic updateEdgeWeight allows w=0', e.weight === 0 && e.w === 0);
  warns = [];
  g.removeNode(m.id);
  assert('removeNode reverts bound plastic edge', e.plastic === false && e.w === undefined && warns.length === 1);
  console.warn = origWarn;
}

// ─── C2: Hebbian growth with pre=post=mod=1 ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  // Order matters: fixed-edge clamp is [0.1, 1.0]; only the plastic branch
  // allows weight=0. Toggle plastic on first, then lower weight to 0.
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  g.updateEdgeWeight(e.id, 0); // w_init = 0, w = 0
  assert('initial w = 0 (after plastic toggle then weight)', e.w === 0);

  // Drive pre=post=mod=1 for 50 ticks. Expected: w climbs roughly like
  // closed-form fixed-point of w_{t+1} = w_t + η - decay * w_t → w_∞ = η/decay.
  // Over short horizons (~50 ticks), w grows approximately linearly.
  for (let t = 0; t < 50; t++) {
    g.updatePlasticWeights({ [a.id]: 1, [b.id]: 1, [m.id]: 1 });
  }
  // Analytic: w_{t+1} = w_t(1 - decay) + (η + decay * w_init), w_init = 0.
  // w_50 = η * ((1 - (1-decay)^50) / decay). With η=0.01, decay=0.001:
  // w_50 ≈ 0.01 * (1 - 0.999^50) / 0.001 ≈ 0.01 * 0.04879 / 0.001 ≈ 0.4879
  const expected = LEARNING_RATE * (1 - Math.pow(1 - WEIGHT_DECAY_RATE, 50)) / WEIGHT_DECAY_RATE;
  assert('Hebbian growth matches closed-form', near(e.w, expected, 1e-4), `got ${e.w} vs ${expected}`);

  // Now mod=0, pre=post=1: decay only, w should trend back toward 0.
  const wBefore = e.w;
  for (let t = 0; t < 50; t++) {
    g.updatePlasticWeights({ [a.id]: 1, [b.id]: 1, [m.id]: 0 });
  }
  assert('decay pulls w down when mod=0', e.w < wBefore && e.w > 0);
}

// ─── C2: Dale's Law invariant under 10k ticks of forced drive ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  g.updateEdgeWeight(e.id, 0.5);
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  let min = e.w, max = e.w;
  for (let t = 0; t < 10000; t++) {
    g.updatePlasticWeights({ [a.id]: 1, [b.id]: 1, [m.id]: 1 });
    if (e.w < min) min = e.w;
    if (e.w > max) max = e.w;
  }
  assert("Dale's Law: w stays in [0, 1] over 10k ticks", min >= 0 && max <= 1, `min=${min} max=${max}`);
  assert('w saturates near 1 under max drive', e.w > 0.99, `w=${e.w}`);
}

// ─── C2: inhibitory-sourced plastic edge also learns (magnitude model) ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_inh', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  g.updateEdgeWeight(e.id, 0.1);
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  for (let t = 0; t < 100; t++) {
    g.updatePlasticWeights({ [a.id]: 1, [b.id]: 1, [m.id]: 1 });
  }
  assert('inhibitory plastic edge grows magnitude', e.w > 0.1 && e.w <= 1);
}

// ─── C2: plastic evaluator uses edge.w, not edge.weight ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  g.updateEdgeWeight(e.id, 1);
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  // Manually force the runtime w to diverge from weight.
  e.w = 0.3;
  // Inject node states so computeSignals picks up a=1.0.
  a.state = 1;
  const { edgeSignals } = g.computeSignals({}, {}, { commit: false, dt: 1 / 60 });
  // edgeSignals[e.id] = sourceSignal * effectiveWeight; sourceSignal from `a.state`=1.
  // With plastic, effectiveWeight = clampToDaleLaw(0.3) = 0.3.
  assert('plastic evaluator uses edge.w', near(edgeSignals[e.id], 0.3, 1e-6), `got ${edgeSignals[e.id]}`);

  // Non-plastic comparison: same topology, no plasticity, weight=0.3.
  const g2 = makeGraph();
  const a2 = g2.addNeuronNode('inter_exc', 100, 100);
  const b2 = g2.addNeuronNode('inter_exc', 300, 100);
  const e2 = g2.addEdge(a2.id, b2.id);
  g2.updateEdgeWeight(e2.id, 0.3);
  a2.state = 1;
  const { edgeSignals: es2 } = g2.computeSignals({}, {}, { commit: false, dt: 1 / 60 });
  assert('fixed evaluator uses edge.weight', near(es2[e2.id], 0.3, 1e-6), `got ${es2[e2.id]}`);
}

// ─── C2: non-plastic edge is NOT mutated by updatePlasticWeights ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id); // fixed, plastic=false
  g.updateEdgeWeight(e.id, 0.5);
  g.updatePlasticWeights({ [a.id]: 1, [b.id]: 1 });
  assert('fixed edge.weight unchanged by plastic update', e.weight === 0.5);
  assert('fixed edge has no edge.w', e.w === undefined);
}

// ─── C2: commit=false does NOT trigger plasticity ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  g.updateEdgeWeight(e.id, 0);
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  // Force nodeSignals via state priming.
  a.state = 1; b.state = 1; m.state = 1;
  const wBefore = e.w;
  g.computeSignals({}, {}, { commit: false, dt: 1 / 60 });
  assert('commit=false leaves plastic w untouched', e.w === wBefore);
}

// ─── C3: serialize preserves plastic weight=0 (doesn't snap to 0.1) ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  g.updateEdgeWeight(e.id, 0);
  const json = g.serialize();
  const parsed = JSON.parse(json);
  const edgeJson = parsed.edges.find((x) => x.id === e.id);
  assert('serialize preserves plastic weight=0', edgeJson.weight === 0, `got ${edgeJson.weight}`);
  assert('serialize emits plastic=true', edgeJson.plastic === true);
  assert('serialize emits mod_source_id', edgeJson.mod_source_id === m.id);
  assert('serialize emits w for plastic edge', edgeJson.w === 0);
}

// ─── C3: round-trip preserves mid-learning w bit-identical ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  // Drive w into mid-range.
  for (let t = 0; t < 100; t++) {
    g.updatePlasticWeights({ [a.id]: 1, [b.id]: 1, [m.id]: 0.8 });
  }
  const wSaved = e.w;
  const weightSaved = e.weight;
  const json = g.serialize();

  const g2 = makeGraph();
  g2.deserialize(json);
  const e2 = g2.edges.get(e.id);
  assert('round-trip preserves plastic flag', e2.plastic === true);
  assert('round-trip preserves mod_source_id', e2.mod_source_id === m.id);
  assert('round-trip preserves w bit-identical', e2.w === wSaved, `got ${e2.w} vs ${wSaved}`);
  assert('round-trip preserves weight (baseline)', e2.weight === weightSaved);
}

// ─── C3: v6 migration — edges lacking plastic fields default cleanly ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  g.updateEdgeWeight(e.id, 0.5);
  // Hand-craft a v6-shape payload: strip plastic/mod_source_id fields.
  const legacy = JSON.parse(g.serialize());
  for (const ed of legacy.edges) {
    delete ed.plastic;
    delete ed.mod_source_id;
    delete ed.w;
  }
  const g2 = makeGraph();
  g2.deserialize(JSON.stringify(legacy));
  const e2 = g2.edges.get(e.id);
  assert('v6 migration defaults plastic=false', e2.plastic === false);
  assert('v6 migration defaults mod_source_id=null', e2.mod_source_id === null);
  assert('v6 migration has no w', e2.w === undefined);
  assert('v6 migration preserves weight', e2.weight === 0.5);
}

// ─── C3: dangling mod_source_id reverts plastic edge with warn ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  const blob = JSON.parse(g.serialize());
  // Simulate: modulator node was removed from the save payload externally
  blob.nodes = blob.nodes.filter((n) => n.id !== m.id);
  const origWarn = console.warn;
  let warns = [];
  console.warn = (...args) => { warns.push(args.join(' ')); };
  const g2 = makeGraph();
  g2.deserialize(JSON.stringify(blob));
  console.warn = origWarn;
  const e2 = g2.edges.get(e.id);
  assert('dangling mod_source_id reverts to fixed', e2.plastic === false);
  assert('dangling mod_source_id clears mod_source_id', e2.mod_source_id === null);
  assert('dangling mod_source_id drops w', e2.w === undefined);
  assert('dangling mod_source_id warns', warns.some((w) => /reverting plastic edge/.test(w)));
}

// ─── C3: mod_source_id pointing to non-modulator reverts ───
{
  const g = makeGraph();
  const a = g.addNeuronNode('inter_exc', 100, 100);
  const m = g.addNeuronNode('modulator', 200, 100);
  const b = g.addNeuronNode('inter_exc', 300, 100);
  const e = g.addEdge(a.id, b.id);
  g.setEdgePlastic(e.id, { plastic: true, modSourceId: m.id });
  const blob = JSON.parse(g.serialize());
  // Simulate: modulator node's neuronType got corrupted / was never a modulator
  const modNode = blob.nodes.find((n) => n.id === m.id);
  modNode.neuronType = 'inter_exc';
  modNode.type = 'inter_exc';
  const origWarn = console.warn;
  let warns = [];
  console.warn = (...args) => { warns.push(args.join(' ')); };
  const g2 = makeGraph();
  g2.deserialize(JSON.stringify(blob));
  console.warn = origWarn;
  const e2 = g2.edges.get(e.id);
  assert('non-modulator mod_source_id reverts', e2.plastic === false && warns.length >= 1);
}

console.log(fails === 0 ? '\nplasticity-unit-test OK' : `\nFAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
