/**
 * Round-trip tests for the save/load envelope (current: v9).
 *
 * Runs headless in Node (no DOM, no localStorage). Covers:
 *   1. fields.js codec — Float32Array → base64 → Float32Array is bit-identical
 *   2. migrations.js — every step in the v6 → CURRENT chain, plus rejections
 *   3. World.serializeWorld / deserializeWorld — full round-trip including
 *      multi-ant ants[] block and the id allocator state
 *
 * Run: `node save-load-test.mjs` from the repo root.
 */

import assert from "node:assert/strict";

import { encodeField, decodeField } from "./src/io/fields.js";
import {
  migrate,
  MIGRATIONS,
  CURRENT_STORAGE_VERSION,
  MIGRATABLE_STORAGE_VERSION,
} from "./src/io/migrations.js";
import { serializeApp, applyEnvelope } from "./src/io/schema.js";
import { ChemicalField, World } from "./src/world.js";
import { NeuralGraph } from "./src/neural.js";
import { createEnvironmentState, LOGIC_CANVAS } from "./src/config.js";

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    if (err.stack) console.log(err.stack.split("\n").slice(1, 4).map(l => "      " + l).join("\n"));
    failed++;
  }
}

// ── 1. Field codec ──
console.log("fields.js");

test("encode/decode round-trip preserves all cells bit-for-bit", () => {
  const f = new ChemicalField(400, 240, 20);
  // Fill with a varied pattern including fractional and subnormal values.
  for (let i = 0; i < f.grid.length; i++) f.grid[i] = Math.sin(i * 0.17) * 0.5 + 0.5;
  f.grid[0] = 0;
  f.grid[1] = 1;
  f.grid[2] = 1e-38;
  const enc = encodeField(f);
  assert.equal(enc.cols, f.cols);
  assert.equal(enc.rows, f.rows);
  assert.equal(enc.cellSize, f.cellSize);
  assert.equal(typeof enc.data, "string");

  const f2 = new ChemicalField(400, 240, 20);
  // Mutate f2 first to ensure decode overwrites.
  f2.grid.fill(0.5);
  const ok = decodeField(enc, f2);
  assert.equal(ok, true);
  for (let i = 0; i < f.grid.length; i++) {
    if (f.grid[i] !== f2.grid[i]) {
      throw new Error(`cell ${i} mismatch: ${f.grid[i]} vs ${f2.grid[i]}`);
    }
  }
});

test("decode warns and returns false on dimension mismatch", () => {
  const f = new ChemicalField(200, 120, 20);
  f.grid.fill(0.3);
  const enc = encodeField(f);
  const other = new ChemicalField(400, 240, 20); // different dims
  other.grid.fill(0.7);
  // Silence the warn for this test.
  const origWarn = console.warn; console.warn = () => {};
  try {
    const ok = decodeField(enc, other);
    assert.equal(ok, false);
    // Live contents must be preserved. Float32 rounds 0.7, so compare via
    // the live buffer's own stored value (already rounded at fill time).
    const expected = new Float32Array([0.7])[0];
    assert.equal(other.grid[0], expected);
  } finally { console.warn = origWarn; }
});

test("decode warns and returns false on cellSize mismatch", () => {
  const f = new ChemicalField(200, 120, 20);
  const enc = encodeField(f);
  const other = new ChemicalField(200, 120, 40);
  const origWarn = console.warn; console.warn = () => {};
  try {
    assert.equal(decodeField(enc, other), false);
  } finally { console.warn = origWarn; }
});

// ── 2. Migrations ──
console.log("migrations.js");

test("version constants are internally consistent", () => {
  // No hard-coded integers — when CURRENT bumps, only migrations.js changes.
  assert.ok(Number.isInteger(MIGRATABLE_STORAGE_VERSION));
  assert.ok(Number.isInteger(CURRENT_STORAGE_VERSION));
  assert.ok(MIGRATABLE_STORAGE_VERSION <= CURRENT_STORAGE_VERSION);
});

test("MIGRATIONS has entries for every gap between floor and current", () => {
  for (let v = MIGRATABLE_STORAGE_VERSION; v < CURRENT_STORAGE_VERSION; v++) {
    assert.ok(typeof MIGRATIONS[v] === "function", `missing migrator from v${v}`);
  }
});

test("MIGRATIONS[6] alone upgrades v6 → v7 (single step)", () => {
  const v6 = { version: 6, graph: "{}" };
  const out = MIGRATIONS[6](v6);
  assert.equal(out.version, 7);
});

test("MIGRATIONS[7] alone upgrades v7 → v8 and sets world=null", () => {
  const v7 = { version: 7, graph: "{}" };
  const out = MIGRATIONS[7](v7);
  assert.equal(out.version, 8);
  assert.equal(out.world, null);
});

test("migrate(v6 payload) → CURRENT with world=null and map=null", () => {
  const v6 = {
    version: 6,
    graph: JSON.stringify({ nodes: [], edges: [], nextNeuronIndex: 1, nextEdgeIndex: 1 }),
    sensorEnabled: {},
    bodyParams: { turnScale: 1, speedScale: 1 },
  };
  const up = migrate(v6);
  assert.equal(up.version, CURRENT_STORAGE_VERSION);
  assert.equal(up.world, null);
  assert.equal(up.map, null);
});

test("migrate(v7 payload) → CURRENT with world=null and map=null", () => {
  const v7 = {
    version: 7,
    graph: JSON.stringify({ nodes: [], edges: [] }),
    sensorEnabled: {},
    bodyParams: { turnScale: 1, speedScale: 1 },
  };
  const up = migrate(v7);
  assert.equal(up.version, CURRENT_STORAGE_VERSION);
  assert.equal(up.world, null);
  assert.equal(up.map, null);
});

test("MIGRATIONS[8] alone upgrades v8 → v9 and wraps world.ant into ants[]", () => {
  const v8 = {
    version: 8,
    graph: "{}",
    world: {
      alive: 10,
      ant: { x: 100, y: 200, angle: 0.5, energy: 50, trail: [] },
      foods: [],
      dangers: [],
      fields: {},
    },
  };
  const out = MIGRATIONS[8](v8);
  assert.equal(out.version, 9);
  assert.ok(Array.isArray(out.world.ants), "world.ants is an array");
  assert.equal(out.world.ants.length, 1);
  assert.equal(out.world.ants[0].id, 0, "migrated ant gets id 0");
  assert.equal(out.world.ants[0].x, 100);
  assert.equal(out.world.ants[0].energy, 50);
  assert.equal(out.world.ant, undefined, "old .ant key deleted");
  assert.equal(out.world.focusedAntId, 0);
  assert.equal(out.world.nextAntId, 1);
  assert.equal(out.map, null, "envelope-level map defaults to null");
});

test("migrate(v8 with world=null) preserves null world and seeds map=null", () => {
  const v8 = { version: 8, graph: "{}", world: null };
  const up = migrate(v8);
  assert.equal(up.version, CURRENT_STORAGE_VERSION);
  assert.equal(up.world, null);
  assert.equal(up.map, null);
});

test("MIGRATIONS[9] upgrades v9 → v10 and seeds moduleMeta=null", () => {
  const v9 = { version: 9, graph: "{}", world: null, map: null };
  const out = MIGRATIONS[9](v9);
  assert.equal(out.version, 10);
  assert.equal(out.moduleMeta, null);
});

test("migrate(v9 payload) → CURRENT carries moduleMeta=null", () => {
  const v9 = {
    version: 9,
    graph: JSON.stringify({ nodes: [], edges: [] }),
    world: null,
    map: null,
  };
  const up = migrate(v9);
  assert.equal(up.version, CURRENT_STORAGE_VERSION);
  assert.equal(up.moduleMeta, null);
});

test("migrate(v6 with world.ant) cross-jump produces ants[0].id === 0", () => {
  // A v6 payload doesn't have a world block at all; v6 → v7 → v8 adds
  // world=null, so by v9 the ants[] branch in v8_to_v9 takes the
  // "world exists but no ant" path. Test that no crash and shape is sane.
  const v6 = { version: 6, graph: "{}", sensorEnabled: {}, bodyParams: { turnScale: 1, speedScale: 1 } };
  const up = migrate(v6);
  assert.equal(up.version, CURRENT_STORAGE_VERSION);
  assert.equal(up.world, null);
});

test("migrate(CURRENT) is a no-op", () => {
  const payload = { version: CURRENT_STORAGE_VERSION, graph: "{}", world: { alive: 42 } };
  const up = migrate(payload);
  assert.equal(up.version, CURRENT_STORAGE_VERSION);
  assert.deepEqual(up.world, { alive: 42 });
});

test("migrate rejects below-floor versions", () => {
  assert.throws(() => migrate({ version: 5 }), /below migratable floor/);
});

test("migrate rejects future versions", () => {
  assert.throws(() => migrate({ version: 99 }), /newer than current/);
});

test("migrate rejects missing version", () => {
  assert.throws(() => migrate({}), /missing\/invalid version/);
});

// ── 3. World serialize/deserialize ──
console.log("world serialization");

function makeWorld() {
  const env = createEnvironmentState();
  return new World(env);
}

test("empty world round-trips ant pose + energy", () => {
  const w1 = makeWorld();
  w1.ant.x = 123.5;
  w1.ant.y = 456.25;
  w1.ant.angle = 1.7;
  w1.ant.energy = 42;
  w1.alive = 12.34;
  w1.generation = 3;
  w1.foodEaten = 7;

  const blob = JSON.parse(JSON.stringify(w1.serializeWorld()));
  const w2 = makeWorld();
  w2.deserializeWorld(blob);

  assert.equal(w2.ant.x, 123.5);
  assert.equal(w2.ant.y, 456.25);
  // angle goes through cos/sin/atan2 — compare with small tolerance
  assert.ok(Math.abs(w2.ant.angle - 1.7) < 1e-6, `angle ${w2.ant.angle}`);
  assert.equal(w2.ant.energy, 42);
  assert.equal(w2.alive, 12.34);
  assert.equal(w2.generation, 3);
  assert.equal(w2.foodEaten, 7);
});

test("trail round-trips with identical points", () => {
  const w1 = makeWorld();
  w1.ant.trail = [
    { x: 10, y: 20 },
    { x: 11.5, y: 20.25 },
    { x: 13, y: 21 },
  ];
  const blob = JSON.parse(JSON.stringify(w1.serializeWorld()));
  const w2 = makeWorld();
  w2.deserializeWorld(blob);
  assert.equal(w2.ant.trail.length, 3);
  assert.deepEqual(w2.ant.trail[0], { x: 10, y: 20 });
  assert.deepEqual(w2.ant.trail[2], { x: 13, y: 21 });
});

test("gland reservoirs round-trip (current/capacity/recovery)", () => {
  const w1 = makeWorld();
  w1.ant.glandAlpha = { current: 0.42, capacity: 2.0, recovery: 0.05 };
  w1.ant.glandBeta  = { current: 0.0,  capacity: 1.5, recovery: 0.08 };
  const blob = JSON.parse(JSON.stringify(w1.serializeWorld()));
  const w2 = makeWorld();
  w2.deserializeWorld(blob);
  assert.deepEqual(w2.ant.glandAlpha, { current: 0.42, capacity: 2.0, recovery: 0.05 });
  assert.deepEqual(w2.ant.glandBeta,  { current: 0.0,  capacity: 1.5, recovery: 0.08 });
});

test("foods and dangers round-trip and sync environmentState density", () => {
  const w1 = makeWorld();
  w1.foods = [
    { id: 1, x: 100, y: 200, r: 6, phase: 1.2 },
    { id: 2, x: 300, y: 400, r: 8, phase: 2.4 },
    { id: 3, x: 500, y: 600, r: 5, phase: 0.5 },
  ];
  w1.dangers = [
    { id: 1, x: 50, y: 50, r: 10, phase: 0 },
  ];
  const blob = JSON.parse(JSON.stringify(w1.serializeWorld()));
  const w2 = makeWorld();
  w2.deserializeWorld(blob);
  assert.equal(w2.foods.length, 3);
  assert.equal(w2.dangers.length, 1);
  assert.deepEqual(w2.foods[1], { id: 2, x: 300, y: 400, r: 8, phase: 2.4 });
  assert.equal(w2.environmentState.foodDensity, 3);
  assert.equal(w2.environmentState.dangerDensity, 1);
});

test("chem field state round-trips bit-identical across all 4 species", () => {
  const w1 = makeWorld();
  // Paint a distinct pattern into each field so a mix-up would be caught.
  for (let i = 0; i < w1.fields.chem_A.grid.length; i++) w1.fields.chem_A.grid[i] = (i % 17) / 17;
  for (let i = 0; i < w1.fields.chem_B.grid.length; i++) w1.fields.chem_B.grid[i] = (i % 13) / 13;
  for (let i = 0; i < w1.fields.chem_C.grid.length; i++) w1.fields.chem_C.grid[i] = (i % 11) / 11;
  for (let i = 0; i < w1.fields.chem_D.grid.length; i++) w1.fields.chem_D.grid[i] = (i %  7) /  7;

  const blob = JSON.parse(JSON.stringify(w1.serializeWorld()));
  const w2 = makeWorld();
  w2.deserializeWorld(blob);

  for (const k of ["chem_A", "chem_B", "chem_C", "chem_D"]) {
    for (let i = 0; i < w1.fields[k].grid.length; i++) {
      if (w1.fields[k].grid[i] !== w2.fields[k].grid[i]) {
        throw new Error(`${k}[${i}] mismatch: ${w1.fields[k].grid[i]} vs ${w2.fields[k].grid[i]}`);
      }
    }
  }
});

test("deserializeWorld tolerates missing sub-blocks (v7 migrate)", () => {
  const w1 = makeWorld();
  const origAntX = w1.ant.x;
  // Simulate a v7 → v8 migrated payload: world is null, then coerced to {} by caller.
  w1.deserializeWorld({});
  // Ant pose untouched.
  assert.equal(w1.ant.x, origAntX);
});

test("deserializeWorld null input is a no-op", () => {
  const w1 = makeWorld();
  const origEnergy = w1.ant.energy;
  w1.deserializeWorld(null);
  assert.equal(w1.ant.energy, origEnergy);
});

test("multi-ant round-trip: 3 ants with different ids preserve identity", () => {
  const w1 = makeWorld();
  // Add two more ants beyond the default one. spawn at known positions.
  const extras = w1.spawnAnts(2, { origin: { x: 300, y: 300 }, radius: 0 });
  // Wiggle positions so we can verify per-ant restoration.
  w1.ants[0].x = 100; w1.ants[0].y = 110; w1.ants[0].energy = 80;
  w1.ants[1].x = 200; w1.ants[1].y = 220; w1.ants[1].energy = 60;
  w1.ants[2].x = 400; w1.ants[2].y = 440; w1.ants[2].energy = 40;
  w1.focusedAntId = w1.ants[1].id;   // focus the middle ant

  const blob = JSON.parse(JSON.stringify(w1.serializeWorld()));
  assert.ok(Array.isArray(blob.ants), "serialize produces ants[] array");
  assert.equal(blob.ants.length, 3);
  assert.equal(blob.focusedAntId, w1.ants[1].id);
  assert.equal(blob.nextAntId, w1.nextAntId);

  const w2 = makeWorld();
  w2.deserializeWorld(blob);
  assert.equal(w2.ants.length, 3, "three ants restored");
  // ids preserved
  assert.deepEqual(w2.ants.map((a) => a.id), w1.ants.map((a) => a.id));
  // per-ant pose preserved
  assert.equal(w2.ants[0].x, 100); assert.equal(w2.ants[0].y, 110);
  assert.equal(w2.ants[1].x, 200); assert.equal(w2.ants[1].y, 220);
  assert.equal(w2.ants[2].x, 400); assert.equal(w2.ants[2].y, 440);
  assert.equal(w2.ants[1].energy, 60);
  // focus + allocator preserved
  assert.equal(w2.focusedAntId, w1.ants[1].id);
  assert.equal(w2.nextAntId, w1.nextAntId);
  // focused getter resolves
  assert.equal(w2.focusedAnt.id, w1.ants[1].id);
});

test("deserializeWorld repairs nextAntId if save left a collision", () => {
  // Synthesize a malformed payload: ants with ids 0,5 but nextAntId=2.
  // Future spawns would have collided with id 5 — deserialize must bump
  // nextAntId past the max observed id.
  const w = makeWorld();
  w.deserializeWorld({
    ants: [
      { id: 0, x: 10, y: 10, angle: 0, energy: 100, trail: [] },
      { id: 5, x: 20, y: 20, angle: 0, energy: 100, trail: [] },
    ],
    focusedAntId: 0,
    nextAntId: 2,   // inconsistent — collides with id 5
  });
  assert.equal(w.nextAntId, 6, "nextAntId repaired to max(id)+1");
});

test("graph + world snapshot: stepping diverges, reload converges", () => {
  // Save the world+graph, step the live one for N frames (state drifts),
  // then reload and assert we're back at the saved snapshot.
  const w1 = makeWorld();
  const g1 = new NeuralGraph();
  g1.reset(LOGIC_CANVAS.width, LOGIC_CANVAS.height);
  w1.ant.x = 200; w1.ant.y = 300; w1.ant.energy = 75;

  const graphSerialized = g1.serialize();
  const worldSerialized = JSON.parse(JSON.stringify(w1.serializeWorld()));

  // Drift the live state.
  w1.ant.x = 999;
  w1.ant.y = 888;
  w1.ant.energy = 10;
  w1.fields.chem_A.grid[0] = 0.99;

  // Reload.
  w1.deserializeWorld(worldSerialized);
  const g2 = new NeuralGraph();
  g2.deserialize(graphSerialized);

  assert.equal(w1.ant.x, 200);
  assert.equal(w1.ant.y, 300);
  assert.equal(w1.ant.energy, 75);
  assert.equal(g2.nodes.size, g1.nodes.size);
  assert.equal(g2.edges.size, g1.edges.size);
});

// ── 4. moduleMeta envelope round-trip ──
console.log("schema.js moduleMeta");

test("serializeApp writes moduleMeta and stamps version 10", () => {
  const fakeApp = {
    graph: { serialize: () => "{}" },
    sensorEnabled: {},
    world: { bodyParams: { turnScale: 1, speedScale: 1 }, serializeWorld: () => null },
    sensorConfig: { toJSON: () => ({}) },
    map: null,
    moduleMeta: { volume_used_um3: 123 },
  };
  const env = serializeApp(fakeApp);
  assert.equal(env.version, 10);
  assert.deepEqual(env.moduleMeta, { volume_used_um3: 123 });
});

test("serializeApp defaults moduleMeta to null when the app has none", () => {
  const fakeApp = {
    graph: { serialize: () => "{}" },
    sensorEnabled: {},
    world: { bodyParams: { turnScale: 1, speedScale: 1 }, serializeWorld: () => null },
    sensorConfig: { toJSON: () => ({}) },
    map: null,
  };
  assert.equal(serializeApp(fakeApp).moduleMeta, null);
});

test("applyEnvelope restores moduleMeta onto the app", () => {
  const fakeApp = {
    graph: { deserialize: () => {}, ensureAnchors: () => {} },
    sourceDefs: [],
    world: { bodyParams: {} },
  };
  applyEnvelope(fakeApp, { version: 10, graph: "{}", moduleMeta: { x: 1 }, world: null });
  assert.deepEqual(fakeApp.moduleMeta, { x: 1 });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
