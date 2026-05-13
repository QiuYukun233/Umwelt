# Step 5 — Plastic Synapses (Associative Learning)

## Scope & Goal

Add modulated Hebbian plasticity to the neural graph. A connection can be marked as **plastic**, which means its weight is updated every tick based on pre-synaptic activity, post-synaptic activity, and a modulator signal. Over time, the weight decays back toward its player-set initial value (innate baseline).

**Definition of done:** The minimal associative-learning demo (see §7) passes reliably, and the plastic synapse state survives save/load round-trips.

---

## Design Principles (non-negotiable)

These come from the design constitution. Implementation must not violate them:

1. **Physical layer only, no semantic layer.** A plastic connection is a physical property of a wire. It is not "a memory cell" or "an associative slot" — it is a synapse whose weight can change. No naming, no labels, no affordances beyond what the math does.

2. **Decay toward player-set initial weight, not zero.** Biological synapses relax toward a developmental baseline, not toward absence. `w_init` is that baseline and is set by the player when they wire the connection.

3. **Dale's Law is preserved through learning.** If the source node is excitatory (sensor, inter_exc, modulator, motor source in future), weight stays in `[0, 1]`. If inhibitory (inter_inh), weight stays in `[-1, 0]`. Plasticity never flips sign — clamping enforces this every tick.

4. **Modulator binding is explicit.** Every plastic connection is bound to exactly one modulator node in the same graph. No implicit global modulator. No unbound plastic connections.

5. **Biological plausibility as design filter.** Learning rate and decay constants are chosen so that the timescale of learning is faster than decay by roughly an order of magnitude — matching the mushroom-body microglomeruli remodeling timescale (learning over minutes, forgetting over hours/days).

6. **Forward compatibility.** MVP implements plasticity at the connection level. A future extension (not in this step) may introduce "mushroom-body-type nodes" where all incoming connections are plastic by default. The data structure should not preclude this — in particular, per-connection plasticity flag should live on the connection, and the same field should be usable when it's derived from a node type in the future.

---

## Data Model Changes

### Connection fields (extend existing)

```
Connection {
  id, from_node_id, to_node_id,
  w_init: number,            // initial weight, set by player, already exists
  // NEW fields below
  plastic: boolean,          // default false
  mod_source_id: string|null,// required when plastic=true, else null
  w: number,                 // runtime current weight — when plastic, != w_init
}
```

**Semantics:**
- When `plastic = false`: `w` is always equal to `w_init` at every tick. No learning, no decay. This matches existing behavior — all existing circuits keep working unchanged.
- When `plastic = true`: `w` evolves according to the update rule (§4). `w_init` is the fixed decay target and is not mutated at runtime.

### Constants (internal, not exposed to player)

Define in `src/neural/constants.js` or similar:

```
LEARNING_RATE     = 0.01      // η
WEIGHT_DECAY_RATE = 0.001     // decay per tick toward w_init
```

These are not per-connection parameters. They are hardcoded constants. Rationale: exposing these to players turns the game into a parameter-tuning exercise, not a circuit-design exercise. If emergence tests later prove these values wrong, adjust them globally and document the reason in CLAUDE.md.

---

## Validation Rules

When a connection is marked plastic:

1. `mod_source_id` must reference an existing node in the same graph.
2. The referenced node's `type` must be `modulator`. Reject otherwise.
3. When the modulator node is deleted, any plastic connections bound to it are automatically reverted to `plastic: false`, `mod_source_id: null` — with a console warning. Do not silently break graph evaluation.
4. Self-loops are allowed (a node's output modulating its own upstream weights is biologically attested — recurrent modulation). Don't add artificial restrictions.

---

## Update Rule (per tick, per plastic connection)

Execute **after** the graph has been evaluated for the current tick (so `pre` and `post` reflect this tick's activations, and `mod` reflects this tick's modulator output).

```
For each connection c where c.plastic == true:
  pre  = output of c.from_node at this tick        // 0..1 or -1..0 depending on source type
  post = output of c.to_node   at this tick        // 0..1
  mod  = output of node[c.mod_source_id] at tick   // 0..1 (modulator is always excitatory-range)

  dw = LEARNING_RATE * pre * post * mod            // Hebbian, gated by modulator
  c.w = c.w + dw
  c.w = c.w + WEIGHT_DECAY_RATE * (c.w_init - c.w) // relax toward baseline
  c.w = clampToDaleLaw(c.w, c.from_node.type)      // [0,1] or [-1,0]
```

**Order matters.** Evaluate graph first, then update weights. The weights used during this tick's evaluation are the weights as they stood at the end of the *previous* tick. This prevents feedback artifacts and matches standard online learning.

### clampToDaleLaw helper

```
clampToDaleLaw(w, sourceType):
  if sourceType in {sensor, inter_exc, modulator}:
    return clamp(w, 0, 1)
  if sourceType == inter_inh:
    return clamp(w, -1, 0)
  // motor nodes don't have outgoing connections; not a concern
```

Sign of `w_init` must already respect this when the player sets it — that's enforced at edit time, not at learning time. Learning just maintains the invariant.

---

## Save / Load

- `plastic`, `mod_source_id`, and `w` are all serialized.
- On load, validate: every plastic connection's `mod_source_id` still points to an existing modulator node in the loaded graph. If validation fails, revert that connection to `plastic: false` with a console warning (same as node-deletion path).
- Bump `schemaVersion`. Write a migration for old saves: all existing connections become `plastic: false`, `mod_source_id: null`, `w = w_init`. Old saves must continue to load and produce identical behavior.

---

## UI Changes (minimum viable)

This step is about mechanics, not UI polish. Do the minimum that lets the player create and observe plastic connections.

1. **Connection inspector** (the panel that appears when a connection is selected) gains two new controls:
   - Checkbox: `plastic` (default off)
   - Dropdown: `mod source` — lists all `modulator` nodes in the graph by id. Disabled when `plastic` is off. Required when `plastic` is on.

2. **Visual distinction in GraphRenderer:**
   - Fixed connections: solid line (unchanged)
   - Plastic connections: dashed line
   - Additionally, when a plastic connection is displayed, draw a faint thin line from the bound modulator node to the midpoint of the connection — this shows "which modulator is influencing this wire". Keep it visually subtle (low alpha, thin stroke) so it doesn't clutter the graph.

3. **Runtime weight display:**
   - For plastic connections, display the current `w` value next to the connection (already done for fixed connections; same code path).
   - When `w` differs from `w_init` by more than a small threshold (say 0.05), render the number in a slightly highlighted color so the player can see learning happening at a glance.

4. **No UI for η or decay.** These are not adjustable.

Do NOT add:
- A separate "learning mode" or "training mode"
- Auto-layout of modulator connections
- Graphs/charts of weight-over-time (that's future polish)
- Per-connection learning rate or decay knobs

---

## Emergence Test (acceptance criterion)

Build this as an automated regression test. This is the thing that must pass before Step 5 is called done.

### Setup

- 1 ant in a world with 1 ChemC source placed to the ant's left-front.
- Circuit:
  - `sensor_on`: L antenna ChemC channel
  - `modulator`: bound to internal `hunger` signal (energy deficit proxy — high when energy low)
  - `motor`: `turn_L`
  - Connection: `sensor → turn_L`, `plastic = true`, `mod_source = hunger_modulator`, `w_init = 0.0`
- The ant has food available elsewhere so energy can rise and fall.

### Behavior sequence (automated)

1. **t = 0..30s (hungry phase):** Energy drained to low. Hunger modulator output is high (~0.8). Ant is placed near ChemC source repeatedly with turn_L manually forced by a separate training stimulus circuit, so that `pre`, `post`, and `mod` are simultaneously high for many ticks.
   - Expected: `w` for the plastic connection rises from 0.0 toward a positive value, settling somewhere in (0.2, 0.8) range depending on exposure time.

2. **t = 30..45s (learned phase, hungry):** Remove the training stimulus. Place ant near ChemC only.
   - Expected: Ant now turns left in response to ChemC alone. The `sensor → turn_L` connection has a learned weight > 0.1. Behavior change is measurable as turn rate correlated with ChemC concentration.

3. **t = 45..90s (sated phase):** Feed the ant until energy is full. Hunger modulator output drops to near 0.
   - Expected: Weight decay now dominates because `mod ≈ 0` kills the Hebbian term. `w` slowly relaxes toward `w_init = 0`. The ant's ChemC-induced turning fades over tens of seconds.

4. **t = 90s+ (forgotten):** `w` should be within 0.05 of `w_init`. Ant is back to ignoring ChemC.

Test passes if all four phases produce the expected weight ranges and behavioral signatures, reproducibly, with fixed random seed.

### Secondary sanity tests

- **No modulator ⇒ no learning.** A plastic connection whose modulator is always at 0 should have `w` monotonically decay toward `w_init` and never increase. Confirms mod gating.
- **Dale's Law preserved.** Starting with `sensor → turn_L` plastic connection at `w_init = 0.5`, run 10 000 ticks of maximum Hebbian drive. `w` must stay in `[0, 1]`. Never crosses zero, never exceeds 1.
- **Save/load round-trip.** In the middle of phase 2 (learned state, `w ≈ 0.5`), save. Load. Continue simulation. Behavior and `w` value must be identical to not having saved.

---

## File-Level Plan

Proposed changes, roughly in dependency order:

1. `src/neural/constants.js` — new file with `LEARNING_RATE`, `WEIGHT_DECAY_RATE`.
2. `src/neural/graph.js` (or wherever Connection is defined) — add `plastic`, `mod_source_id`, `w` fields. Add validation. Add `updatePlasticWeights(tick)` method called from the graph evaluation loop after node evaluation.
3. `src/neural/evaluate.js` (or equivalent) — ensure evaluation uses `c.w` not `c.w_init`. Call `updatePlasticWeights()` after the evaluation pass.
4. `src/io/save.js` / `src/io/load.js` — extend serialization, add migration for schemaVersion bump, add load-time validation with fallback.
5. `src/ui/connection-inspector.js` (or wherever connection editing UI lives) — add plastic checkbox and mod_source dropdown. Wire up to graph state.
6. `src/render/graph-renderer.js` — render plastic connections as dashed, draw modulator influence lines, highlight weight-changed connections.
7. `tests/plasticity.test.js` — emergence test (§7) + secondary sanity tests.
8. `CLAUDE.md` — append a section on plasticity:
   - The rule and constants.
   - The "MVP is per-connection flag; future is per-node-type 'mushroom body' nodes" extensibility note.
   - The biological grounding (mushroom-body microglomeruli remodeling) as a one-line rationale.

---

## Out of Scope (explicit non-goals)

- Mushroom-body-type nodes with default-plastic inputs. Future step.
- Multiple modulators gating a single connection. Keep it one-to-one for now.
- Spike-timing-dependent plasticity (STDP). Graded-signal version only.
- Weight-over-time graphs in the UI.
- Player-adjustable η or decay.
- Long-term potentiation / consolidation (protein-synthesis-like multi-timescale decay). Single decay constant is enough for MVP.
- Multi-agent learning coordination. Each ant learns in isolation. Multi-agent is Step 6.

---

## Risks to Watch

1. **Runaway Hebbian.** If `pre`, `post`, and `mod` all saturate at 1.0 indefinitely, `w` pins at the Dale's Law ceiling. This is biologically realistic (synapses have max strength), but if it happens too fast it's a gameplay problem. The 0.01 learning rate should keep saturation well beyond 100 ticks even under full drive. Monitor in emergence tests.

2. **Silent decay dominating learning.** If `decay * |w_init - w|` ever exceeds `η * pre * post * mod`, the connection can never learn. Given constants, this happens when `mod * pre * post < 0.1 * |w_init - w|`, which for `w_init = 0`, saturated drive means `w` asymptotes around `η / decay = 10` — way above the Dale's Law ceiling of 1.0, which means decay is correctly weak relative to learning. Good. But document this in constants.js.

3. **Modulator node deletion during simulation.** If the player deletes a modulator node while simulation is running and that modulator is bound to plastic connections, don't crash. Revert those connections to fixed with a warning, continue running.

4. **Save during mid-learning.** The `w` field has to be saved — if we only saved `w_init` and `plastic`, we'd lose all learned state on reload. Make sure this isn't accidentally skipped.

---

## Commit Hygiene

Single logical change per commit. Suggested sequence:

1. `feat(neural): add plastic connection data model and constants`
2. `feat(neural): implement modulated Hebbian weight update`
3. `feat(io): save/load plastic synapse state with schema migration`
4. `feat(ui): add plastic checkbox and mod source selector to connection inspector`
5. `feat(render): visual distinction for plastic connections and learned weights`
6. `test(neural): emergence test — associative learning of ChemC → turn_L`
7. `docs(claude): append plasticity design section`

Codex review checkpoint after commit 3 and after commit 7. Don't merge to main until the emergence test is green on a fresh clone.
