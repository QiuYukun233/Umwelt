# Feature 2 Scope Confirmation — Multi-ant Batching + Tier 4 Prerequisites + Map Editor

**Status:** approved 2026-05-13. Decisions captured in section 七. Ready to implement.
**Date:** 2026-04-23 (drafted), 2026-05-13 (decisions logged).

Three things are in play at once:
1. Feature 2 (multi-ant batching) — planned.
2. Tier 4 emergence validation (10 ants + nest + food + player-designed
   "follow ChemB / emit ChemB" circuit) — promoted to "immediately after
   Feature 2" on the roadmap.
3. Map editor (developer tool) — new requirement surfaced by Tier 4's
   need for reproducible scenarios.

This doc reconciles them into a single scope before any code lands.

---

## 一、Feature 2 原计划内容清单

Reproduced from the prior plan, with each item's design intent and
expected diff range.

### 1.1 `src/neural/batch.js` (new)

A flat, compiled shadow of `NeuralGraph` used only for evaluation. The
graph itself stays the authoring surface (editor, save/load); the batch
is rebuilt from it on graph edits.

**Design intent.** Remove per-tick allocation and Map lookups from the
hot path. Topology is shared across A ants; per-ant scalars live in flat
`Float32Array`s indexed `ant * N + node` (ant-major; eval loop touches
all N of one ant before advancing).

**Expected diff range.** New file, ~300 LOC:
- `compileTopology(graph) → Topology`
- `createBatchState(topo, A) → BatchState`
- `seedBatchFromGraph(topo, batch, graph, antIndex)`
- `stepBatch(topo, batch, sensorInputs, { dt, noise, commit })`
- `writebackFromBatch(topo, batch, graph, antIndex)`

### 1.2 Topology (shared across ants)

```
N, E
nodeIds:    string[N]
nodeType:   Int8Array(N)        // 0 sensor_on .. 4 motor
tau, tau_charge, tau_discharge,
g_rebound, rebound_threshold,
rebound_gate_center, rebound_gate_slope:
            Float32Array(N) each
evalOrder:  Int32Array(N)       // sensors first, then sort by (x,y) — matches today's order
edgeFrom:   Int32Array(E)
edgeTo:     Int32Array(E)
edgeWeight: Float32Array(E)     // fixed weights; magnitude only
edgeKind:   Int8Array(E)        // 0 exc, 1 inh, 2 mod
edgePlastic:Uint8Array(E)
edgeModSrc: Int32Array(E)       // -1 when not plastic or dangling
```

**Expected diff range.** Defined inside `batch.js`; no changes elsewhere.

### 1.3 BatchState (per-ant)

```
A
state:    Float32Array(A * N)
adapt:    Float32Array(A * N)
hRebound: Float32Array(A * N)
plasticW: Float32Array(A * E)         // only meaningful at edges where plastic=1
nextState / nextAdapt / nextHRebound: Float32Array(A * N)  // scratch, reused
excSum / inhSum / gain:               Float32Array(A * N)  // scratch, reused
output:                                Float32Array(A * N)  // feeds Hebbian update
```

**Expected diff range.** Defined inside `batch.js`; sized once at graph
compile time; never reallocated per tick.

### 1.4 `stepBatch()` — core evaluator

Fuses today's `NeuralGraph.computeSignals` into a single pass with flat
indices:
1. Latch sensor outputs into `state[ant*N + sensorNode]` from `sensorInputs`.
2. For each edge: accumulate `excSum` / `inhSum` / multiply `gain`.
3. For each non-sensor node in evalOrder: compute `netInput = (exc − inh) * gain`,
   apply noise (if provided), run the type-appropriate integrator
   (motor = pass-through, modulator = leaky to netInput, inter_exc =
   leaky integrator, inter_inh = Matsuoka + PIR), write `nextState*`.
4. Compute `output[ant*N + node]` for this tick.
5. Plastic Hebbian update (pre × post × mod) using the current tick's
   output, with decay toward `edge.weight`.
6. If `commit`, swap `nextState*` → `state*`.

**Expected diff range.** Single new function (~120 LOC including the
four integrator branches); pure TypedArray loops, no object creation in
the inner loop.

### 1.5 Noise / perturbation injection

Optional parameter on `stepBatch`:
```
noise = {
  sigma: Float32Array(N) | number,  // per-node or scalar
  rng:   () => number,              // injected for determinism in tests
  mask?: Uint8Array(N)              // default: inter_* only
}
```

Noise is added to `netInput` **before** the integrator — not to state
directly — so the noise contribution is integrated with the same tau
the real signal is. Default `mask`: inter_exc and inter_inh only
(sensors and motors stay noise-free; modulators stay smooth so plastic
learning isn't destabilized by non-physical mod fluctuation).

**Expected diff range.** ~15 LOC inside stepBatch.

### 1.6 v9 save migration

Covered in detail in section 三 below. Summary: wrap `world.ant` into
`world.ants[0]`, add `focusedAntId` and `nextAntId`. One migrator
function (~20 LOC) in `src/io/migrations.js`.

**Expected diff range.** `migrations.js` +20 LOC; `world.js`
serializeWorld / deserializeWorld rewrite for ants[] (~50 LOC modified);
`save-load-test.mjs` +~30 LOC for v9 tests.

### 1.7 Wiring into runtime

- `World` internals: the 59 `this.ant.*` reads inside `src/world.js` flip
  to `for (const ant of this.ants)` loops. `this.ant` field deleted.
  Environmental emission (foods → ChemA, dangers → ChemD) runs once per
  tick. Gland deposition loops over ants. Sensor sampling returns flat
  `Float32Array(A * S_with_proprio)` for `stepBatch`.
- `World.step(dt, motorInputsByAnt, sensorEnabled)` — signature widens.
  A=1 back-compat adapter in `World.step` auto-wraps a single
  `motorInputs` object → `[motorInputs]`.
- `main.js` / `observation-app.js`: replace
  `this.graph.computeSignals(...)` with a call into `stepBatch` via a
  thin wrapper in the main loop. Editor preview path stays on
  `computeSignals` (single-ant, zero perf concern at 60Hz).

**Expected diff range.** `world.js` ~150 LOC modified (biggest single
change); `main.js` / `observation-app.js` each ~30 LOC.

---

## 二、Tier 4 额外基础设施清单

Each item tagged **[原计划已含]** / **[原计划未含需新增]** / **[推迟]**.

### 2.1 多蚂蚁初始位置 / 朝向分布

Current: `World.reset()` spawns one ant at `(w*0.5, h*0.55, -π/2 ± 0.2)`.

Tier 4 needs: N ants spawned around a nest. Minimum useful layout —
uniform random angle, radius drawn from `[0, nest.radius]`, heading set
outward from nest (so ants disperse on t=0). Grid or circle layouts are
nice-to-haves for reproducibility but random-radial is sufficient for
emergence tests.

**Tag: [原计划未含需新增]** — small (~30 LOC in `World.spawnAnts(n, nest)`).
Feature 2 scope additions: this belongs with the ants[] lift so it can
land in the same commit.

### 2.2 多蚂蚁 gland 写入时序

Current: `ChemicalField.inject(x, y, amount)` does
`grid[i] = Math.min(1, grid[i] + amount)` — additive with per-cell
ceiling. Order-independent: `inject(a) ; inject(b)` and `inject(b); inject(a)`
produce the same cell value because both inputs sum before the ceiling
applies. Multiple ants writing the same cell in the same tick are
already well-defined: sum, then clamp.

Order within the tick matters only vs. diffusion/decay. Today:
`for (food) inject ChemA ; for (danger) inject ChemD ; gland_α ; gland_β ;
all four fields update (diffuse + decay)`. For multi-ant: wrap gland_α
and gland_β in `for (const ant of ants)`. Field update stays at the end.

**Tag: [原计划已含]** — the batch-wiring already loops ants for glands
in section 1.7. Documented here so no one re-opens the question.

### 2.3 巢穴物理实体定义

Current: **no nest exists anywhere in the code.** Grep for nest / 巢 /
home / colony returns zero matches in runtime code.

Design options (pick one):
- **α. Pure spawn point.** Nest = `{ x, y, radius }`. Ants spawn
  inside it. No emission, no sink. Tier 4 food homing relies on ants
  following their own ChemB trail backward. **Simplest; matches the
  "emergence over configuration" constitutional principle.**
- **β. Spawn point + ChemA emission.** Nest emits ChemA at a slow rate,
  so ants can use the ChemA gradient to find home. Changes nothing
  constitutionally (ChemA is still "environmental food source" and the
  nest is a standing food source). But if the nest emits the same
  chemical species as food, the player's circuit can't disambiguate
  "go to food" from "go home" without a second cue. **Makes Tier 4
  easier but muddies ChemA semantics.**
- **γ. Spawn point + sink mechanic.** Nest is where ants "unload" food
  (incrementing a colony-level energy pool). Introduces a new game
  mechanic (food transport) that's orthogonal to pure chemotaxis
  emergence. **Probably premature; defer.**

**Recommendation: α for Feature 2 + Tier 4. Homing emerges from the
player's circuit design (e.g., ChemB backtrack with a modulator-gated
turn-around), which is the whole point of the Tier 4 experiment.** If α
turns out to make Tier 4 intractable, promote to β.

**Tag: [原计划未含需新增]** — new `Nest` entity in world (~15 LOC), one
config field on the map schema, spawn/respawn points moved to nest
position. No neural impact.

### 2.4 回巢感受器

Current 14 channels: 8 chem (L/R × A/B/C/D), 2 touch (L/R), 1 mouth
taste, 1 light, plus 2 proprio (energy, damage).

No "nest direction" or "distance from nest" sensor. **Constitutional
principle 2 says emergence, not preset** — so the player uses ChemB
trail backtracking (the ant's own gland deposit records where it's
been) or, under nest option β, the ChemA-from-nest gradient.

**Tag: [原计划已含]** — 14 channels are frozen. No new sensor for Tier
4. This is a design commitment, not a to-do.

### 2.5 群体级观测接口

Current `ChemicalField` exposes `sample(x,y)`, `sampleCone(...)`,
`sampleConePeak(...)`. For Tier 4's "稳定蚁道" success metric you need
to measure: given a line from nest to food, what's the ChemB
concentration profile along it, and what's it off-axis?

Proposed additions on `ChemicalField`:
- `sampleLine(x0, y0, x1, y1, n) → Float32Array(n)` — n equally-spaced
  samples along a line segment.
- (Optional, later) `sampleCorridor(x0,y0,x1,y1,width,n) → {onAxis,offAxis}`
  — for trail-vs-background ratio.

**Tag: [原计划未含需新增]** — small (~20 LOC). Belongs in Tier 4 prep,
not Feature 2. Listed here so the API surface is agreed-on ahead of
time.

### 2.6 Per-ant 死亡 / 重生

Current: `World.handleDeath()` sets `this.dead = true` globally; sim
halts. For 10 ants some will hit ChemD zones and die while others
survive. Handling choices:
- Remove dead ant from `ants[]` (id never reused; nextAntId keeps
  counting). Sim continues while any ant alive.
- Respawn at nest after T seconds.
- Game over only when all ants dead.

**Tag: [原计划未含需新增]** — minor (~30 LOC). Needed for Feature 2 to
not desync (if one ant in a batch dies, the batch entry must be
skipped, not leave stale state).

### 2.7 群体行为日志 / metrics

Current `world.log(tone, message)` appends to a single behaviorLog. For
multi-ant: just prefix `ant:${id}` in the message. `world.metrics` is
per-frame aggregate — needs an explicit choice: focus-ant-only (today's
shape) vs. whole-colony averages. Both are valid; UI shows focus, CSV
export would want both.

**Tag: [推迟]** — ship focus-only metrics in Feature 2; expand when the
Tier 4 observation tools need colony averages.

### 2.8 边界行为 / 化学场 wrap

Current: ants use `wrapValue` (periodic); chem field uses zero-pad
boundary (absorbing). Mismatch means ChemB trails break at world
edges. Matters only if nest or food are within ~50 px of the edge.

**Tag: [推迟]** — document as known behavior; Tier 4 maps keep entities
away from edges. If experiments show it matters, switch the ant to
absorbing boundary or the field to periodic later.

---

## 三、v9 save schema 设计

### 3.1 字段清单

```
envelope v9 = {
  version: 9,
  graph: string,                              // unchanged
  sensorEnabled: Record<sourceId, boolean>,   // unchanged
  bodyParams: { turnScale, speedScale },      // unchanged
  sensorConfig: SensorConfig.toJSON(),        // unchanged
  world: WorldBlockV9 | null,                 // SHAPE CHANGED
  map: MapBlock | null                        // NEW — see section 四.b
}

WorldBlockV9 = {
  alive, generation, foodEaten,               // unchanged
  ants: [AntBlob, AntBlob, ...],              // was: ant: AntBlob
  focusedAntId: number,                       // NEW
  nextAntId: number,                          // NEW (id allocator state)
  foods:   [...], dangers: [...], fields: {...}  // unchanged
}

AntBlob = {
  id: number,                                 // NEW in v9
  x, y, angle, energy, trail,
  glandAlpha, glandBeta                       // unchanged
}
```

### 3.2 v8 → v9 migration

```js
function v8_to_v9(data) {
  if (data.world && typeof data.world === "object") {
    const w = data.world;
    if (w.ant && typeof w.ant === "object") {
      const ant = { id: 0, ...w.ant };
      w.ants = [ant];
      delete w.ant;
      w.focusedAntId = 0;
      w.nextAntId = 1;
    } else {
      // world exists but has no ant — leave empty
      w.ants = w.ants ?? [];
      w.focusedAntId = w.focusedAntId ?? 0;
      w.nextAntId = w.nextAntId ?? 0;
    }
  }
  // map block — new, always default to null; loader leaves current
  // world topography alone, matching v7→v8 world=null semantics.
  data.map = data.map ?? null;
  data.version = 9;
  return data;
}
```

### 3.3 Default策略

- **Old ant → id 0.** The pre-existing ant always lands as `ants[0]`
  with `id=0`, and `focusedAntId=0` so the HUD keeps tracking it. Step
  1 of the Feature 2 groundwork already commits to this — see commit
  `743e8ee`.
- **Missing map → null.** Same shape as v7→v8's `world=null`: the
  loader leaves the freshly-constructed (hardcoded-random) environment
  in place. Tier 4 maps will be explicit maps.
- **Missing focusedAntId after migration** (malformed payload) → fall
  through Step 1's getter which returns `null`. Not a hard error.

### 3.4 Tests to add in `save-load-test.mjs`

- `MIGRATIONS[8]` single-step → v9 with ants[] and focusedAntId
- `migrate(v8 with ant=...)` → ants[0].id === 0
- `migrate(v8 with world=null)` → world stays null, map stays null
- `migrate(v7)` cross-jump → passes through v8→v9 cleanly, world=null
- Round-trip: spawn 3 ants with different ids, serialize, parse,
  deserialize, assert ants[]/focusedAntId survive

---

## 四、地图编辑器

### 四.a 当前生成逻辑位置 + 序列化状态

**Food / danger generation** lives in one place:
- `src/world.js:253–262` `World.rebuildEnvironment()` — randomly places
  `environmentState.foodDensity` food and `environmentState.dangerDensity`
  danger entities. Position via `math.js#respawnPoint` (uniform random
  within world bounds, avoiding an exclusion disk around the ant).
- `src/world.js:253–262` same function clears ChemA/D fields and calls
  `warmupFields()` to prime the gradients.
- `src/config.js:3–50` `CONFIG` — `FOOD_COUNT`, `DANGER_COUNT`,
  `FOOD_EMIT_RATE`, `DANGER_EMIT_RATE`. Emission rates are **global
  constants**, not per-source.

**Chemical sources** are **not independent entities**:
- Food objects emit ChemA every tick: `src/world.js:467-468`
  `for (const food of this.foods) this.fields.chem_A.inject(food.x, food.y, CONFIG.FOOD_EMIT_RATE * dt)`.
- Same for danger → ChemD: `src/world.js:469-470`.
- There is no way today to place a standalone ChemA emitter at
  arbitrary (x,y) with a custom rate. Nor to have a ChemB/ChemC
  environmental source (those are strictly ant-gland-written).

**Serialization status (v8):**
- ✅ Food positions round-trip via the `world.foods[]` block.
- ✅ Danger positions round-trip via `world.dangers[]`.
- ❌ World size `(w=960, h=640)` is hardcoded in `World` constructor,
  not in save. Loading a save on a different canvas size silently
  uses the hardcoded bounds.
- ❌ Emission rates / chem species params are `CONFIG` globals.
- ❌ No nest, no standalone chem sources — these don't exist as
  entities.

So: map positions are already serializable as a side effect of v8's
world block. Bounds and parameters are not. A map schema needs to
capture everything the current code hardcodes.

### 四.b 地图 schema 建议

```
MapBlock = {
  schemaVersion: 1,
  bounds: { width: number, height: number },   // world size, replaces hardcoded 960×640
  entities: [
    { type: "food",       id, x, y, radius?, emitRate? },
    { type: "danger",     id, x, y, radius?, emitRate? },
    { type: "nest",       id, x, y, radius },     // nest option α (see 2.3)
    { type: "chemSource", id, x, y, chem: "chem_A"|"chem_B"|"chem_C"|"chem_D",
                          radius?, emitRate? }    // standalone emitter — new capability
  ],
  spawn: {
    count: number,                 // how many ants to spawn
    origin: "nest" | { x, y },     // center point
    layout: "random_radial"        // only one supported at first
  }
}
```

Omitted `radius` / `emitRate` fall back to `CONFIG.FOOD_*` / `DANGER_*`
constants — so a map can be written with just type + x + y and still
work, matching today's defaults.

### 四.b (续) 地图作为独立块 vs 并入 world

**Recommendation: separate `map: {...}` block in the v9 envelope.**

Reasons:
1. **关注点分离.** `world` is **runtime state** (current ant poses,
   current chem concentrations, sim clock). `map` is the **initial
   configuration** that `world` was seeded from. Restarting the sim
   regenerates the world from the map; the map is untouched.
2. **Editor workflow.** The editor saves/loads `.map.json` (which is
   just `{ map: {...} }` — a subset of the save envelope). A gameplay
   snapshot includes both. Combining them in one block would force
   the editor to carry ant-pose / chem-field state it doesn't care
   about.
3. **Migration clarity.** v8→v9 puts `ants[]` + `focusedAntId` in the
   world block (runtime state); `map` defaults to `null` (config
   absent, loader falls back to the existing random-generation code
   path). The two concerns never cross.
4. **Future extensibility.** When `map` later grows walls / vents /
   biomes, none of it pollutes the runtime `world` block.

Combining into `world` would force every world deserialization to
branch on "is this fresh-edited map data or restored runtime state?"
No reason to take that cost.

### 四.c 最小 UI 需求

Accepted as stated:
- **Place.** Click with mode (`food` / `danger` / `nest` / `chemSource`) selected.
- **Move.** Click to select, drag to reposition.
- **Delete.** Right-click the entity.
- **Save / Load.** Download/upload `.map.json` using the same
  `io/schema.js` helpers (introduce `serializeMap(map)` /
  `parseMapText(text)` siblings of the existing `serializeApp` /
  `parseImportText`).
- **Clear.** Reset to empty map (keeps current bounds).

Not included (per user brief): undo/redo, layers, templates, multi-
select, snap-to-grid, copy/paste.

A mode selector (4 buttons: food / danger / nest / chem), an entities
list (optional; drag-select could suffice), and a bounds field (two
number inputs for width/height) complete the UI. HTML + plain `<button>`
tags are fine — no framework.

### 四.d 共存方式

**Recommendation: independent `map-editor.html` page**, alongside the
existing `index.html` + `observation.html` twin.

Reasons:
1. **状态机复杂度.** The main page already juggles run/pause, neural
   circuit edit, observation HUD. Adding a "map edit mode" raises the
   question "in map-edit mode, are ants frozen? are chem fields live?
   does energy drain?" None have obvious correct answers. A separate
   page short-circuits all of that.
2. **访问频率低.** Developer-tool scope means you edit a map every
   week or two, not every session. Zero-friction switching between
   gameplay and map-edit isn't worth design effort.
3. **数据交换路径.** `map-editor.html` reads/writes
   `localStorage.umwelt_map` (or a file). Main page on boot reads
   `umwelt_map`; if present, `World.reset({ map })` uses it, else
   falls through to today's random generation. A small "load map"
   button in topbar also lets the user pick a `.map.json` file
   directly.
4. **Bevy 迁移清晰.** When the Bevy rewrite arrives, the player-facing
   map editor is designed from scratch in Bevy's UI. This scrappy JS
   editor stays as a dev tool for the JS prototype and gets retired —
   not migrated. Keeping it on its own page makes that clean cut
   trivial.

---

## 五、开工顺序建议

1. **Feature 2 主体** — batch runtime + v9 save migration (with ants[]
   + focusedAntId; map block defaults to null). Drops the `this.ant`
   field, flips World internals to `for (const ant of this.ants)`.
   Commit-sized: moderate; all one PR.
2. **地图编辑器** — independent page, map schema, `map` block
   integration in v9 envelope, `World.reset({ map })` seam.
3. **Tier 4 地图** — use the editor to author a small library of
   reproducible scenarios: open arena, narrow corridor, dual food
   sources at fixed distance.
4. **Tier 4 观测 API** — `ChemicalField.sampleLine` + a small
   `tools/trail-profile.mjs` script that replays a save and prints
   concentration profiles. Per-ant death handling lands here if it
   wasn't already folded into Feature 2.
5. **Tier 4 运行** — run the experiment, evaluate emergence criterion.

Parallelism: (2) and (3) sequential (editor must exist before it's
useful to use). (4)'s sampleLine can land in parallel with (2).

## 六、未决问题（供 review 决策）

1. Nest option α / β / γ — this doc recommends α. Do you agree, or
   want to stage a β fallback in the same commit?
2. Per-ant death (Tier 4 prereq 2.6) — fold into Feature 2, or defer
   to the Tier 4 prep batch?
3. `map-editor.html` file name and top-level URL path — does the
   standalone-page approach match your intent, or did you picture an
   in-app mode switch? Sec 四.d argues for the former; flag if so.
4. Gameplay snapshot relationship — is an exported `.json` expected to
   re-run on a fresh install without its `.map.json`? If yes, keep the
   `map` block inside the gameplay save (recommended). If no, move
   `map` to its own `.map.json`-only envelope.
5. Chem species palette — the map schema admits `chemSource.chem =
   "chem_B" | "chem_C"`, which would give the environment a way to
   write those species independently of ants. That's a new capability
   and a constitutional question ("ChemB 是地面沉积" — is an
   environmental ChemB source honest?). Default: lock chemSource to
   ChemA and ChemD in v1; open up to B/C only if a Tier 4 experiment
   demands it.

---

## 七、Review 决议（2026-05-13）

All five open questions from section 六 resolved. Recommendations
accepted as-is.

1. **巢穴 = 纯出生点 (option α).** Nest is `{ x, y, radius }` with no
   emission and no sink. Homing must emerge from the player's circuit
   (ChemB backtrack). If Tier 4 proves intractable under α, promote to
   β; do not pre-stage β in code.
2. **Per-ant 死亡 folds into Feature 2.** Implementation: remove dead
   ant from `ants[]` (id never reused, `nextAntId` keeps counting),
   batch entry skipped via the topology's `alive` mask. Sim continues
   while any ant alive. Respawn deferred until Tier 4 needs it.
3. **`map-editor.html` is a standalone page.** No in-app mode switch.
   Data exchange via `localStorage.umwelt_map` + file upload/download.
4. **Gameplay save carries the `map` block.** A single `.json` export
   is self-contained: reload on a fresh install reproduces the
   scenario without a separate `.map.json`.
5. **`chemSource` palette locked to ChemA / ChemD in v1.** ChemB and
   ChemC remain ant-gland-exclusive (constitutional principle 1 — no
   "dishonest" environmental gland). Revisit only if a Tier 4
   experiment specifically requires environmental B/C.

Implementation kickoff: section 五 step 1 (Feature 2 main +
per-ant death + v9 migration).
