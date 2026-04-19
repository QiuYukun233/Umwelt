// Regression tests for the three bug fixes Codex flagged.
// 1. Removed sensor slots survive SensorConfig.toJSON()/fromJSON() round-trip.
// 2. World.setSize() re-warms ChemA/ChemD after a dimension change.
// 3. (covered in main.js — not reachable from pure-node test, verified by
//    code inspection; the shared _installSensorConfig path now runs for
//    both applySensorConfig and importCircuit.)

globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({ addEventListener: () => {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, style: {}, children: [], querySelectorAll: () => [], replaceChildren: () => {} }), createElement: () => ({ className:'', innerHTML:'', textContent:'', style:{}, children:[], firstElementChild:{style:{}}, appendChild:()=>{}, cloneNode:()=>({}) }), createDocumentFragment: () => ({ appendChild: () => {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, prompt: () => null, innerWidth: 960, innerHeight: 640 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.requestAnimationFrame = () => {};

const { SensorConfig } = await import('./src/sensor-config.js');
const { World } = await import('./src/world.js');
const { CONFIG, createEnvironmentState } = await import('./src/config.js');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) { console.log(`  PASS ${label}`); pass++; } else { console.log(`  FAIL ${label}`); fail++; } };

console.log("── Fix 1: removed sensor slots persist round-trip ──");
{
  const c = SensorConfig.createDefault();
  check("starts with all 12 slots populated", c.countInstalled() === 12);
  c.removeSensor("L_chem_B");
  c.removeSensor("R_chem_D");
  check("after removing two: countInstalled() === 10", c.countInstalled() === 10);

  // Round-trip through JSON.
  const json = JSON.parse(JSON.stringify(c.toJSON()));
  const restored = SensorConfig.fromJSON(json);

  check("JSON preserves null for L_chem_B", json.slots.L_chem_B === null);
  check("JSON preserves null for R_chem_D", json.slots.R_chem_D === null);
  check("restored config has 10 installed (not 12)", restored.countInstalled() === 10);
  check("restored L_chem_B still removed", restored.slots.L_chem_B === null);
  check("restored R_chem_D still removed", restored.slots.R_chem_D === null);
  check("restored L_chem_A still installed", restored.slots.L_chem_A === "chem_A");

  // Also: an empty {} object should fall back to the full default (legacy import).
  const blankRestored = new SensorConfig({});
  check("empty slots map falls back to 12 installed", blankRestored.countInstalled() === 12);
}

console.log("\n── Fix 2: setSize re-warms ChemA/ChemD ──");
{
  const env = createEnvironmentState();
  env.foodDensity = 5;
  env.dangerDensity = 2;
  const w = new World(env);
  w.setSize(960, 640);

  // After init, ChemA/ChemD should have non-trivial peaks near their sources.
  const peak = (g) => { let p = 0; for (const v of g) if (v > p) p = v; return p; };
  const peakA0 = peak(w.fields.chem_A.grid);
  const peakD0 = peak(w.fields.chem_D.grid);
  check(`ChemA has initial plumes (peak=${peakA0.toFixed(3)})`, peakA0 > 0.05);
  check(`ChemD has initial plumes (peak=${peakD0.toFixed(3)})`, peakD0 > 0.05);

  // Drop some ChemB (gland deposit) so we can verify it's expected to be lost.
  w.fields.chem_B.writeAt(w.foods[0]?.x ?? 100, w.foods[0]?.y ?? 100, 1.0);
  const peakB_before = peak(w.fields.chem_B.grid);

  // Resize — this changes dimensions and triggers rewarm.
  w.setSize(1280, 800);

  const peakA1 = peak(w.fields.chem_A.grid);
  const peakD1 = peak(w.fields.chem_D.grid);
  const peakB1 = peak(w.fields.chem_B.grid);
  check(`ChemA plumes rebuilt after resize (peak=${peakA1.toFixed(3)})`, peakA1 > 0.05);
  check(`ChemD plumes rebuilt after resize (peak=${peakD1.toFixed(3)})`, peakD1 > 0.05);
  check(`ChemB transient secretion discarded on resize (was ${peakB_before.toFixed(3)}, now ${peakB1.toFixed(3)})`, peakB1 < 0.01);

  // Same dimensions → no rewarm needed, no change.
  const snapshotA = peakA1;
  w.setSize(1280, 800);
  const peakA2 = peak(w.fields.chem_A.grid);
  check("same-size setSize() preserves field contents", Math.abs(peakA2 - snapshotA) < 0.01);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAIL"}  (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
