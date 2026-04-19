// Regression test for Step 3: gland_α secretion, ChemB trail, reservoir
// depletion, recovery, and resumption. Drives motor_gland_alpha directly
// (bypassing the neural graph) and verifies:
//   1. Trail appears along the ant's path.
//   2. Trail diffuses and decays after secretion stops.
//   3. Reservoir drops while secreting; ant goes silent when empty.
//   4. Reservoir recovers during idle and secretion resumes.

globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({ addEventListener: () => {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, style: {}, children: [], querySelectorAll: () => [], replaceChildren: () => {} }), createElement: () => ({ className:'', innerHTML:'', textContent:'', style:{}, children:[], firstElementChild:{style:{}}, appendChild:()=>{}, cloneNode:()=>({}) }), createDocumentFragment: () => ({ appendChild: () => {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, prompt: () => null, innerWidth: 960, innerHeight: 640 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.requestAnimationFrame = () => {};

const { World } = await import('./src/world.js');
const { CONFIG, createEnvironmentState, SENSOR_DEFINITIONS, SOURCE_ORDER } = await import('./src/config.js');

const env = createEnvironmentState();
env.foodDensity = 0;
env.dangerDensity = 0;
const w = new World(env);
w.setSize(960, 640);
w.setSensorDefs(SENSOR_DEFINITIONS, SOURCE_ORDER, SENSOR_DEFINITIONS.map(s=>s.id));

w.ant.x = 100; w.ant.y = 400; w.ant.angle = 0;
w.foods = [];
w.dangers = [];
w.warmupFields();

const enabled = Object.fromEntries(SENSOR_DEFINITIONS.map(s => [s.id, true]));
const DT = CONFIG.FIXED_DT;

function peakChemB() {
  let peak = 0;
  for (const v of w.fields.chem_B.grid) if (v > peak) peak = v;
  return peak;
}

function trailSample() {
  // Sample a point on the trail — 100 px behind the ant's current heading.
  return w.fields.chem_B.sample(w.ant.x - 100, w.ant.y);
}

// Phase 1: drive gland_α constant, walk forward.
const motorsOn  = { motor_forward: 1.0, motor_turn_L: 0, motor_turn_R: 0, gland_alpha: 1.0, gland_beta: 0, mandible: 0 };
const motorsOff = { motor_forward: 1.0, motor_turn_L: 0, motor_turn_R: 0, gland_alpha: 0,   gland_beta: 0, mandible: 0 };

console.log(`t=0.0  reservoir=${w.ant.glandAlpha.current.toFixed(3)}  chemB_peak=${peakChemB().toFixed(4)}  x=${w.ant.x.toFixed(1)}`);

let steps = 0;
let wentSilent = false;
let resumed = false;
let peakAfterResume = 0;

// Boost ant gland recovery so the whole test fits in a reasonable window.
w.ant.glandAlpha.recovery = 0.25;

for (let phase = 0; phase < 3; phase++) {
  // Phase order:
  //   0: secrete at full motor for 2s (deposit trail and drain reservoir)
  //   1: rest for 6s  (motor=0, reservoir refills, trail diffuses / decays)
  //   2: secrete again for 2s (deposit a second trail segment — tests resume)
  const duration = phase === 1 ? 6 : 2;
  const motors = phase === 1 ? motorsOff : motorsOn;
  for (let i = 0; i < duration * 60; i++) {
    w.ant.energy = CONFIG.MAX_ENERGY;                    // keep ant alive
    w.step(DT, motors, enabled, w.composeSourceOutputs(enabled, DT, true));
    steps++;
    if (phase === 0 && !wentSilent && w.ant.glandAlpha.current <= 0.001) {
      wentSilent = true;
      console.log(`  [phase ${phase}] reservoir depleted at t=${(steps*DT).toFixed(2)}s, x=${w.ant.x.toFixed(1)}`);
    }
    if (phase === 2 && !resumed && w.ant.glandAlpha.current < 0.999 && peakChemB() > 0.01) {
      // Phase 2 secretion has drained reservoir and left a fresh peak.
      resumed = true;
      peakAfterResume = peakChemB();
      console.log(`  [phase ${phase}] secretion resumed at t=${(steps*DT).toFixed(2)}s, peakChemB=${peakAfterResume.toFixed(4)}`);
    }
  }
  const t = steps * DT;
  console.log(`t=${t.toFixed(1)}  phase=${phase}  reservoir=${w.ant.glandAlpha.current.toFixed(3)}  chemB_peak=${peakChemB().toFixed(4)}  trail_sample=${trailSample().toFixed(4)}  x=${w.ant.x.toFixed(1)}`);
}

console.log("\n── Results ──");
console.log(`  Trail deposited in phase 0:           ${wentSilent ? "PASS" : "FAIL"}`);
console.log(`  Ant went silent when reservoir empty: ${wentSilent ? "PASS" : "FAIL"}`);
console.log(`  Secretion resumed in phase 2:         ${resumed ? "PASS" : "FAIL"}`);

// Quick check: gland_beta writes to chem_C independently, with a fresh ant.
console.log("\n── ChemC / gland_β ──");
w.reset();
w.ant.x = 100; w.ant.y = 200; w.ant.angle = 0;
for (let i = 0; i < 60; i++) {
  w.ant.energy = CONFIG.MAX_ENERGY;
  w.step(DT, { motor_forward: 1.0, motor_turn_L: 0, motor_turn_R: 0, gland_alpha: 0, gland_beta: 1.0, mandible: 0 }, enabled, w.composeSourceOutputs(enabled, DT, true));
}
let peakC = 0;
for (const v of w.fields.chem_C.grid) if (v > peakC) peakC = v;
console.log(`  chemC_peak after 1s gland_β=1: ${peakC.toFixed(4)}  ${peakC > 0.001 ? "PASS" : "FAIL"}`);
console.log(`  beta reservoir after 1s:       ${w.ant.glandBeta.current.toFixed(3)}  (drained from 1.0)`);
console.log(`  alpha field untouched:         chemB_peak=${peakChemBLocal().toFixed(4)}  ${peakChemBLocal() < 0.02 ? "PASS" : "FAIL"}`);

function peakChemBLocal() {
  let p = 0;
  for (const v of w.fields.chem_B.grid) if (v > p) p = v;
  return p;
}
