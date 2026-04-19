/**
 * Fibra Neural System Integration Tests
 * Run: node test-neural.mjs
 */

// Minimal DOM stubs for modules that reference document
globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({ addEventListener: () => {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, style: {}, children: [], querySelectorAll: () => [], replaceChildren: () => {} }), createElement: (t) => ({ className: '', innerHTML: '', textContent: '', style: {}, children: [], firstElementChild: { style: {} }, appendChild: () => {}, cloneNode: () => ({}) }), createDocumentFragment: () => ({ appendChild: () => {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, prompt: () => null, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, innerWidth: 960, innerHeight: 640 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.requestAnimationFrame = () => {};

const { NeuralGraph, cloneSensorEnabled, cloneSensorModes } = await import('./src/neural.js');
const { World } = await import('./src/world.js');
const { CONFIG, createEnvironmentState, sourceNodeId, motorNodeId, DEFAULT_SENSOR_ENABLED, DEFAULT_SENSOR_MODES, SOURCE_ORDER } = await import('./src/config.js');
const { clamp } = await import('./src/math.js');

const DT = CONFIG.FIXED_DT;
const W = 960, H = 640;

function makeGraph() {
  const g = new NeuralGraph();
  g.nodes.clear();
  g.edges.clear();
  g.nextNeuronIndex = 1;
  g.nextEdgeIndex = 1;
  g.ensureAnchors(W, H, true);
  return g;
}

function makeWorld() {
  const env = createEnvironmentState();
  env.foodDensity = 0;
  env.dangerDensity = 0;
  const w = new World(env);
  w.setSize(W, H);
  w.foods = [];
  w.dangers = [];
  return w;
}

function makeSensorState() {
  const enabled = {};
  const modes = {};
  for (const id of SOURCE_ORDER) {
    enabled[id] = true;
    modes[id] = 'absolute';
  }
  return { enabled, modes };
}

function simulate(graph, world, sensorState, steps) {
  const log = [];
  for (let i = 0; i < steps; i++) {
    const src = world.composeSourceOutputs(sensorState.enabled, sensorState.modes, DT, true);
    const sig = graph.computeSignals(src, sensorState.enabled, { commit: true, dt: DT });
    const motors = graph.getMotorOutputs(sig.nodeSignals);
    world.step(DT, motors, sensorState.enabled, sensorState.modes, src);
    if (i % 30 === 0) {
      log.push({
        t: ((i + 1) * DT).toFixed(2),
        x: world.ant.x.toFixed(1),
        y: world.ant.y.toFixed(1),
        speed: world.ant.speed.toFixed(1),
        energy: world.ant.energy.toFixed(1),
        L: world.metrics.leftLeg.toFixed(3),
        R: world.metrics.rightLeg.toFixed(3)
      });
    }
  }
  return log;
}

// ─────────────────────────────────────────────────
// TEST 1: Same-side inhibition → approach behavior
// F5 → inter_inh → 右腿, F1 → inter_inh → 左腿
// ─────────────────────────────────────────────────
function test1() {
  console.log('\n═══ TEST 1: Same-side inhibition → approach ═══');
  const g = makeGraph();
  const midX = 400;

  const in1 = g.addNeuronNode('inter_inh', midX, H * 0.34, { label: 'IN1', tau: 3 });
  g.addEdge(sourceNodeId('F5'), in1.id);
  g.addEdge(in1.id, motorNodeId('rightLeg'));

  const in2 = g.addNeuronNode('inter_inh', midX, H * 0.66, { label: 'IN2', tau: 3 });
  g.addEdge(sourceNodeId('F1'), in2.id);
  g.addEdge(in2.id, motorNodeId('leftLeg'));

  g.resetState();

  const w = makeWorld();
  // Ant at center, facing up
  w.ant.x = W / 2; w.ant.y = H / 2; w.ant.angle = -Math.PI / 2;
  // Food 150px in front (above)
  w.foods = [{ id: 1, x: W / 2, y: H / 2 - 150, r: 7, phase: 0 }];

  const ss = makeSensorState();
  const initDist = Math.hypot(w.foods[0].x - w.ant.x, w.foods[0].y - w.ant.y);

  const log = simulate(g, w, ss, 15 * 60);
  const finalDist = Math.hypot(w.foods[0].x - w.ant.x, w.foods[0].y - w.ant.y);
  const ate = w.foodEaten > 0;
  const distReduced = ((initDist - finalDist) / initDist * 100).toFixed(1);

  console.log(`  Initial dist: ${initDist.toFixed(1)}px`);
  console.log(`  Final dist:   ${finalDist.toFixed(1)}px (${distReduced}% closer)`);
  console.log(`  Food eaten:   ${w.foodEaten}`);
  console.log(`  Sample: t=2s L=${log[4]?.L} R=${log[4]?.R}`);

  const pass = ate || (initDist - finalDist) > initDist * 0.5;
  console.log(`  RESULT: ${pass ? '✅ PASS' : '❌ FAIL'}`);
  return pass;
}

// ─────────────────────────────────────────────────
// TEST 2: Time integration → short-term memory
// F0 → inter_exc(τ=5s) → 左腿 + 右腿
// ─────────────────────────────────────────────────
function test2() {
  console.log('\n═══ TEST 2: Time integration → short-term memory ═══');
  const g = makeGraph();
  const ex = g.addNeuronNode('inter_exc', 400, H * 0.5, { label: 'EX1', tau: 5 });
  g.addEdge(sourceNodeId('F0'), ex.id);
  g.addEdge(ex.id, motorNodeId('leftLeg'));
  g.addEdge(ex.id, motorNodeId('rightLeg'));
  g.resetState();

  const w = makeWorld();
  w.ant.x = W / 2; w.ant.y = H / 2; w.ant.angle = -Math.PI / 2;
  w.foods = [{ id: 1, x: W / 2, y: H / 2 - 100, r: 7, phase: 0 }];

  const ss = makeSensorState();

  // Phase 1: run 5s with food in front
  for (let i = 0; i < 5 * 60; i++) {
    const src = w.composeSourceOutputs(ss.enabled, ss.modes, DT, true);
    const sig = g.computeSignals(src, ss.enabled, { commit: true, dt: DT });
    const motors = g.getMotorOutputs(sig.nodeSignals);
    w.step(DT, motors, ss.enabled, ss.modes, src);
  }
  const speedBefore = w.ant.speed;
  console.log(`  Speed at t=5s (food present): ${speedBefore.toFixed(1)}`);

  // Phase 2: move food far away, run 8s
  w.foods[0].x = 50; w.foods[0].y = 50;
  const speedLog = [];
  for (let i = 0; i < 8 * 60; i++) {
    const src = w.composeSourceOutputs(ss.enabled, ss.modes, DT, true);
    const sig = g.computeSignals(src, ss.enabled, { commit: true, dt: DT });
    const motors = g.getMotorOutputs(sig.nodeSignals);
    w.step(DT, motors, ss.enabled, ss.modes, src);
    if (i % 60 === 0) speedLog.push({ t: 5 + (i / 60), speed: w.ant.speed.toFixed(1) });
  }

  console.log('  Speed after food removed:');
  for (const s of speedLog) console.log(`    t=${s.t.toFixed(0)}s speed=${s.speed}`);

  const speedAt1s = parseFloat(speedLog[1]?.speed ?? '0');
  const speedAt5s = parseFloat(speedLog[5]?.speed ?? '0');
  const baseline = CONFIG.BASE_SPEED * CONFIG.TONIC_DRIVE;
  const decayedSlowly = speedAt1s > baseline * 1.05;
  const eventuallyDecayed = speedAt5s < speedAt1s;

  console.log(`  Baseline speed: ${baseline.toFixed(1)}`);
  console.log(`  Speed 1s after: ${speedAt1s} (>${(baseline * 1.05).toFixed(1)}? ${decayedSlowly})`);
  const pass = decayedSlowly && eventuallyDecayed;
  console.log(`  RESULT: ${pass ? '✅ PASS' : '❌ FAIL'}`);
  return pass;
}

// ─────────────────────────────────────────────────
// TEST 3: Two inter_inh mutual inhibition → oscillation
// F0 → A(inter_inh τ=1.5), A↔B mutual, A→左腿, B→右腿
// ─────────────────────────────────────────────────
function test3() {
  console.log('\n═══ TEST 3: Mutual inhibition → oscillation ═══');
  const g = makeGraph();

  const nodeA = g.addNeuronNode('inter_inh', 350, H * 0.35, { label: 'A', tau: 1.5, g_rebound: 7, tau_discharge: 0.4 });
  const nodeB = g.addNeuronNode('inter_inh', 350, H * 0.65, { label: 'B', tau: 1.5, g_rebound: 7, tau_discharge: 0.4 });

  g.addEdge(sourceNodeId('F0'), nodeA.id);
  g.addEdge(nodeA.id, nodeB.id);
  g.addEdge(nodeB.id, nodeA.id);
  g.addEdge(nodeA.id, motorNodeId('leftLeg'));
  g.addEdge(nodeB.id, motorNodeId('rightLeg'));
  g.resetState();

  const w = makeWorld();
  w.ant.x = W / 2; w.ant.y = H / 2; w.ant.angle = -Math.PI / 2;
  // Constant food stimulus in front
  w.foods = [{ id: 1, x: W / 2, y: H / 2 - 80, r: 7, phase: 0 }];

  const ss = makeSensorState();
  const leftLog = [], rightLog = [];

  for (let i = 0; i < 20 * 60; i++) {
    const src = w.composeSourceOutputs(ss.enabled, ss.modes, DT, true);
    // Keep food in front
    w.ant.x = W / 2; w.ant.y = H / 2; w.ant.angle = -Math.PI / 2; w.ant.speed = 0;
    const sig = g.computeSignals(src, ss.enabled, { commit: true, dt: DT });
    const motors = g.getMotorOutputs(sig.nodeSignals);
    // Don't step world (keep food position stable for clean test)
    if (i % 30 === 0) {
      leftLog.push(clamp(CONFIG.TONIC_DRIVE + (motors.leftLeg ?? 0) * CONFIG.SENSOR_GAIN, 0, 1));
      rightLog.push(clamp(CONFIG.TONIC_DRIVE + (motors.rightLeg ?? 0) * CONFIG.SENSOR_GAIN, 0, 1));
    }
    if (i === 120) { // t=2s
      console.log(`  @2s: A_state=${nodeA.state?.toFixed(3)} A_h=${nodeA.h_rebound?.toFixed(3)} A_adapt=${nodeA.adapt?.toFixed(3)}`);
      console.log(`  @2s: B_state=${nodeB.state?.toFixed(3)} B_h=${nodeB.h_rebound?.toFixed(3)} B_adapt=${nodeB.adapt?.toFixed(3)}`);
    }
  }

  // Count switches: when dominant leg changes
  let switches = 0, lastDom = '';
  for (let i = 0; i < leftLog.length; i++) {
    const dom = leftLog[i] > rightLog[i] + 0.02 ? 'L' : rightLog[i] > leftLog[i] + 0.02 ? 'R' : '-';
    if (dom !== '-' && dom !== lastDom) { switches++; lastDom = dom; }
  }

  console.log('  Sample (every 2s):');
  for (let i = 0; i < leftLog.length; i += 4) {
    console.log(`    t=${(i * 0.5).toFixed(0)}s L=${leftLog[i].toFixed(3)} R=${rightLog[i].toFixed(3)}`);
  }
  console.log(`  Switches: ${switches}`);

  const pass = switches >= 6; // 3 full cycles = 6 switches
  console.log(`  RESULT: ${pass ? '✅ PASS' : '❌ FAIL'}`);
  return pass;
}

// ─────────────────────────────────────────────────
// TEST 4: Modulator changes behavior intensity
// F0 → inter_exc(τ=2) → L+R, P_hunger → modulator → inter_exc
// ─────────────────────────────────────────────────
function test4() {
  console.log('\n═══ TEST 4: Modulator changes behavior intensity ═══');

  function runCondition(energy, label) {
    const g = makeGraph();
    // Modulator BEFORE excitatory (lower x) so it's processed first
    const mod = g.addNeuronNode('modulator', 250, H * 0.6, { label: 'MD1', tau: 2 });
    const ex = g.addNeuronNode('inter_exc', 400, H * 0.4, { label: 'EX1', tau: 2 });

    g.addEdge(sourceNodeId('F0'), ex.id);
    g.addEdge(ex.id, motorNodeId('leftLeg'));
    g.addEdge(ex.id, motorNodeId('rightLeg'));
    g.addEdge(sourceNodeId('P_hunger'), mod.id);
    g.addEdge(mod.id, ex.id);
    g.resetState();

    const w = makeWorld();
    w.ant.x = W / 2; w.ant.y = H / 2; w.ant.angle = -Math.PI / 2;
    w.ant.energy = energy;
    w.foods = [{ id: 1, x: W / 2, y: H / 2 - 120, r: 7, phase: 0 }];

    const ss = makeSensorState();
    let totalSpeed = 0, samples = 0;

    // Keep ant stationary — only compute signals, measure motor output
    let totalMotor = 0, motorSamples = 0;
    for (let i = 0; i < 10 * 60; i++) {
      w.ant.energy = energy;
      // Keep ant in place facing food
      w.ant.x = W / 2; w.ant.y = H / 2; w.ant.angle = -Math.PI / 2; w.ant.speed = 0;
      const src = w.composeSourceOutputs(ss.enabled, ss.modes, DT, true);
      const sig = g.computeSignals(src, ss.enabled, { commit: true, dt: DT });
      const motors = g.getMotorOutputs(sig.nodeSignals);
      const level = clamp(CONFIG.TONIC_DRIVE + (motors.leftLeg ?? 0) * CONFIG.SENSOR_GAIN, 0, 1);
      if (i >= 3 * 60) {
        totalMotor += level;
        motorSamples++;
      }
    }
    const avgMotor = totalMotor / motorSamples;
    const avgSpeed = CONFIG.BASE_SPEED * avgMotor;
    console.log(`  ${label}: energy=${energy}, avg motor=${avgMotor.toFixed(3)}, avg speed=${avgSpeed.toFixed(2)}`);
    return avgSpeed;
  }

  const speedA = runCondition(100, 'Condition A (full)');
  const speedB = runCondition(20, 'Condition B (hungry)');
  const diff = ((speedB - speedA) / speedA * 100).toFixed(1);
  console.log(`  Difference: ${diff}%`);

  const pass = speedB > speedA * 1.2;
  console.log(`  RESULT: ${pass ? '✅ PASS' : '❌ FAIL'}`);
  return pass;
}

// ─────────────────────────────────────────────────
// Run all tests
// ─────────────────────────────────────────────────
console.log('Fibra Neural System Integration Tests\n');
const results = [];
results.push(['Test 1: Approach', test1()]);
results.push(['Test 2: Memory', test2()]);
results.push(['Test 3: Oscillation', test3()]);
results.push(['Test 4: Modulation', test4()]);

console.log('\n═══ SUMMARY ═══');
for (const [name, pass] of results) {
  console.log(`  ${pass ? '✅' : '❌'} ${name}`);
}
const allPass = results.every(r => r[1]);
console.log(`\n${allPass ? 'ALL TESTS PASSED ✅' : 'SOME TESTS FAILED ❌'}`);
process.exit(allPass ? 0 : 1);
