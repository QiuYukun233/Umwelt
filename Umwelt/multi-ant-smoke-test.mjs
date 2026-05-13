/**
 * Multi-ant smoke test for sub-step 1b of Feature 2.
 *
 * Verifies that World can host >1 ants concurrently, per-ant death is
 * localised, and the focused-ant accessors stay coherent. Does NOT exercise
 * stepBatch (1d wires that); each ant in this test gets the same
 * motorInputs object, which matches the 1b transition contract.
 *
 * Run: node multi-ant-smoke-test.mjs
 */

globalThis.document = { documentElement: { dataset: {} }, getElementById: () => ({ addEventListener: () => {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, style: {}, children: [], querySelectorAll: () => [], replaceChildren: () => {} }), createElement: () => ({ className: "", innerHTML: "", textContent: "", style: {}, children: [], firstElementChild: { style: {} }, appendChild: () => {}, cloneNode: () => ({}) }), createDocumentFragment: () => ({ appendChild: () => {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, prompt: () => null, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, innerWidth: 960, innerHeight: 640 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
globalThis.requestAnimationFrame = () => {};

const { World } = await import('./src/world.js');
const { CONFIG, createEnvironmentState, SENSOR_DEFINITIONS, SOURCE_ORDER, SENSOR_ORDER } = await import('./src/config.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL  ${msg}`); }
}

function makeWorld() {
  const env = createEnvironmentState();
  env.foodDensity = 0;
  env.dangerDensity = 0;
  const w = new World(env);
  w.setSize(960, 640);
  w.setSensorDefs(SENSOR_DEFINITIONS, SOURCE_ORDER, SENSOR_ORDER);
  w.foods = [];
  w.dangers = [];
  return w;
}

// ── 1: fresh world has exactly one ant with id 0 ──────────────────────
console.log("Test 1: fresh world spawns single ant");
{
  const w = makeWorld();
  assert(w.ants.length === 1, "ants[] has one entry");
  assert(w.ants[0].id === 0, "first ant id is 0");
  assert(w.focusedAntId === 0, "focusedAntId is 0");
  assert(w.focusedAnt === w.ants[0], "focusedAnt is the spawned ant");
  assert(w.ant === w.ants[0], "back-compat `ant` alias resolves to focused");
  assert(w.nextAntId === 1, "nextAntId advanced past 0");
}

// ── 2: spawnAnts adds ants with fresh ids ─────────────────────────────
console.log("Test 2: spawnAnts allocates fresh ids");
{
  const w = makeWorld();
  const spawned = w.spawnAnts(3, { origin: { x: 200, y: 200 }, radius: 50 });
  assert(w.ants.length === 4, "ants[] grew to 4");
  assert(spawned.map(a => a.id).join(",") === "1,2,3", "new ants got ids 1,2,3");
  assert(w.nextAntId === 4, "nextAntId advanced to 4");
  for (const ant of spawned) {
    const dx = ant.x - 200, dy = ant.y - 200;
    assert(Math.hypot(dx, dy) <= 50 + 1e-6, `ant ${ant.id} spawned within radius (r=${Math.hypot(dx,dy).toFixed(1)})`);
  }
}

// ── 3: killAnt removes by id; id is not reused ────────────────────────
console.log("Test 3: killAnt removes one ant, id never reused");
{
  const w = makeWorld();
  w.spawnAnts(2, { origin: { x: 200, y: 200 }, radius: 30 });
  assert(w.ants.length === 3, "three ants alive");
  const killed = w.killAnt(1);
  assert(killed === true, "killAnt(1) returns true");
  assert(w.ants.length === 2, "ants[] shrunk to 2");
  assert(w.ants.find(a => a.id === 1) === undefined, "id 1 gone from ants[]");
  // Spawn another — should get id 3 (since nextAntId was 3 after 0/1/2 spawn)
  const more = w.spawnAnts(1, { origin: { x: 300, y: 300 } });
  assert(more[0].id === 3, "new ant after kill gets id 3 (no reuse)");
}

// ── 4: focused ant dies → focusedAnt is null, others continue ─────────
console.log("Test 4: focused ant death leaves focusedAnt null");
{
  const w = makeWorld();
  w.spawnAnts(2, { origin: { x: 200, y: 200 }, radius: 30 });
  // focusedAntId is 0 (the original ant). Drain its energy to zero.
  const focus = w.focusedAnt;
  focus.energy = 0.01;
  // Step once with neutral motors — handleDeath should fire for ant 0.
  const enabled = Object.fromEntries(SOURCE_ORDER.map(id => [id, true]));
  const motors = { motor_forward: 0, motor_turn_L: 0, motor_turn_R: 0, gland_alpha: 0, gland_beta: 0, mandible: 0 };
  // Step a few ticks to let energy decay finish the kill.
  for (let i = 0; i < 5; i++) w.step(CONFIG.FIXED_DT, motors, enabled);
  assert(w.ants.length === 2, "two ants remain (only the focused one died)");
  assert(w.focusedAnt === null, "focusedAnt is null after focused-ant death");
  assert(w.ant === null, "back-compat `ant` alias is also null");
  assert(w.dead === false, "world not globally dead — other ants alive");
}

// ── 5: all-ant death flips world.dead ─────────────────────────────────
console.log("Test 5: all-ant death flips world.dead = true");
{
  const w = makeWorld();
  w.spawnAnts(1, { origin: { x: 400, y: 400 } });
  for (const a of w.ants) a.energy = 0.01;
  const enabled = Object.fromEntries(SOURCE_ORDER.map(id => [id, true]));
  const motors = { motor_forward: 0, motor_turn_L: 0, motor_turn_R: 0, gland_alpha: 0, gland_beta: 0, mandible: 0 };
  for (let i = 0; i < 10; i++) w.step(CONFIG.FIXED_DT, motors, enabled);
  assert(w.ants.length === 0, "ants[] empty after all dead");
  assert(w.dead === true, "world.dead = true");
}

// ── 6: A=1 backward-compat — single-ant step matches expected motion ──
console.log("Test 6: A=1 step still moves the ant forward under motor_forward");
{
  const w = makeWorld();
  const ant = w.ants[0];
  const startX = ant.x, startY = ant.y;
  const enabled = Object.fromEntries(SOURCE_ORDER.map(id => [id, true]));
  const motors = { motor_forward: 1, motor_turn_L: 0, motor_turn_R: 0, gland_alpha: 0, gland_beta: 0, mandible: 0 };
  for (let i = 0; i < 30; i++) w.step(CONFIG.FIXED_DT, motors, enabled);
  const moved = Math.hypot(ant.x - startX, ant.y - startY);
  assert(moved > 10, `ant moved > 10 px (moved=${moved.toFixed(1)})`);
  assert(w.ants.length === 1 && w.focusedAnt === ant, "single ant still focused");
}

// ── Summary ──
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
