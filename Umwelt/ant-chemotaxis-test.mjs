// Integration test: default ant circuit should produce chemotaxis.
globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({ addEventListener: () => {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, style: {}, children: [], querySelectorAll: () => [], replaceChildren: () => {} }), createElement: () => ({ className:'', innerHTML:'', textContent:'', style:{}, children:[], firstElementChild:{style:{}}, appendChild:()=>{}, cloneNode:()=>({}) }), createDocumentFragment: () => ({ appendChild: () => {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, prompt: () => null, innerWidth: 960, innerHeight: 640 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.requestAnimationFrame = () => {};

const { NeuralGraph } = await import('./src/neural.js');
const { World } = await import('./src/world.js');
const { CONFIG, createEnvironmentState, SENSOR_DEFINITIONS, SOURCE_ORDER, LOGIC_CANVAS } = await import('./src/config.js');

const env = createEnvironmentState();
env.foodDensity = 0;
env.dangerDensity = 0;
const w = new World(env);
w.setSize(960, 640);
w.setSensorDefs(SENSOR_DEFINITIONS, SOURCE_ORDER, SENSOR_DEFINITIONS.map(s=>s.id));

// Default circuit
const g = new NeuralGraph();
g.reset(LOGIC_CANVAS.width, LOGIC_CANVAS.height);

// Place ant at (300,400) facing right. Food 300px forward, 60px left (up-screen).
w.ant.x = 300; w.ant.y = 400; w.ant.angle = 0;
w.foods = [{ id: 1, x: 600, y: 340, r: 7, phase: 0 }];
w.warmupFields();

const enabled = Object.fromEntries(SENSOR_DEFINITIONS.map(s => [s.id, true]));
const DT = CONFIG.FIXED_DT;
const initDist = Math.hypot(w.foods[0].x - w.ant.x, w.foods[0].y - w.ant.y);
console.log(`initial: ant=(${w.ant.x},${w.ant.y}) food=(${w.foods[0].x},${w.foods[0].y}) dist=${initDist.toFixed(1)}`);

for (let step = 0; step < 1800; step++) {   // 30s
  const src = w.composeSourceOutputs(enabled, DT, true);
  const sig = g.computeSignals(src, enabled, { commit: true, dt: DT });
  const motors = g.getMotorOutputs(sig.nodeSignals);
  w.step(DT, motors, enabled, src);
  if (step % 60 === 0) {
    const d = Math.hypot(w.foods[0].x - w.ant.x, w.foods[0].y - w.ant.y);
    const heading = Math.atan2(w.ant.forward.y, w.ant.forward.x);
    console.log(`t=${(step*DT).toFixed(1)}s  pos=(${w.ant.x.toFixed(0)},${w.ant.y.toFixed(0)})  θ=${(heading*180/Math.PI).toFixed(0)}°  dist=${d.toFixed(1)}  L=${src.L_chem_A.toFixed(3)} R=${src.R_chem_A.toFixed(3)}  mL=${motors.motor_turn_L.toFixed(3)} mR=${motors.motor_turn_R.toFixed(3)} mF=${motors.motor_forward.toFixed(3)}`);
  }
  if (w.foodEaten > 0) {
    console.log(`ATE FOOD at t=${(step*DT).toFixed(2)}s`);
    break;
  }
}
const finalDist = Math.hypot(w.foods[0].x - w.ant.x, w.foods[0].y - w.ant.y);
console.log(`\nfinal dist=${finalDist.toFixed(1)} (was ${initDist.toFixed(1)})`);
console.log(`foodEaten=${w.foodEaten}`);
console.log(`RESULT: ${(w.foodEaten > 0 || finalDist < initDist * 0.5) ? 'PASS chemotaxis' : 'FAIL chemotaxis'}`);
