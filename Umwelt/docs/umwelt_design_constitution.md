# Umwelt — Design Constitution: Five Physical Truths

> For `CLAUDE.md`. Every design decision in this project resolves to one move: **be honest to the physical layer** — 削繁就简而非撒谎虚构 (*simplify rather than fabricate*). The recurring result is that the biologically honest choice is almost always the best game choice too. The five truths below are load-bearing, not flavor. Each generates hard invariants. Do not relax an invariant "to be helpful" — if a request seems to need that, surface the conflict instead.

---

## 1. Space is real; wiring costs

**Why (biology).** Neurons occupy 3D space; axons cost material and energy. Real brains minimize total wire length (Cajal's conservation principle; the *C. elegans* ganglion layout is the global wire-length optimum among ~40M orderings, Cherniak 1994). Neural tissue is genuinely laminar (*Drosophila* medulla M1–M10).

**Invariants.**
- The organ is an infinite, layer-stacked 3D grid. No sculpted shell — the organ's extent is *emergent* from neuron positions.
- Convex-hull footprint is a **cost metric, never a wall**. Compute it per-layer (Σ of each layer's footprint × h), not as one combined-footprint prism.
- Conduction delay ∝ Manhattan path length (`edge.delay_ms`).
- Placing things far / spread out = slower + more metabolically expensive. Space is budget, not decoration.

**Game payoff.** This is the 3D analog of Opus Magnum's `area` metric. Spatial scarcity — wires blocking each other — is the entire source of routing-puzzle difficulty.

---

## 2. A wire is one neuron's private line

**Why (biology).** Each axon carries exactly one neuron's output. Summation happens *at the neuron* (dendrites/soma), never in the wire. Dale's Law: a neuron is excitatory or inhibitory uniformly across all its terminals.

**Invariants.**
- A via is a **per-edge path segment** that crosses layers. There is **no `Via` entity, no shared conductor, no net/bus.** PCB is borrowed for *geometry* (rectilinear routing, vias-as-crossings, via cost) — never for *electrical* behavior.
- **No same-layer overlap: at most one edge per cell.** The cell→edge reverse index is therefore `HashMap<CellCoord, EdgeId>` (single-valued, not `Vec`); it is built within routing and enforces no-overlap at place-time.
- Signals combine **only at neuron nodes.** Any point that sums signals must carry weights / sign / threshold — and *that is the definition of a neuron*. A combining via would be a hidden, un-neuroned compute node: forbidden.
- Dale's Law is a wiring constraint: choose excitatory/inhibitory once per neuron; all outgoing edges inherit the sign.
- An edge carries one neuron's signal to *all* its targets — copied, never combined; its branch (fork) points are pure geometry, no params. Because the edge is a tree (§3) and a tree node has exactly one parent, a **join** (two signals merging into one wire) is *structurally unrepresentable* — the rule is enforced by the data shape, not by runtime checks.
- Merging happens only **inside** a neuron — faithfully, in its dendrite (an input-collecting tree). **Honest simplification (MVP):** collapse the dendrite to the soma; inputs land directly on the neuron cell. Consequence: fan-in (inputs to one neuron) is capped by free neighbor cells (~6); for more, the player builds a funnel of relay neurons — reconstructing a dendrite *out of neurons* (same spirit as building OFF-cells), not a limitation to route around. This *omits* a real structure (allowed); it never *fabricates* — the hard line is that different neurons' signals never combine in a wire (no shared-conductor via). Upgrade path if the in/out asymmetry ever bites: give neurons an inward dendrite tree to symmetrize.

**Game payoff.** No-overlap is the *engine* of the puzzle, not a limitation (free overlap = trivial routing; cf. SHENZHEN I/O). Crossing is done by going up a layer (via), not by sharing a cell. "Want to merge signals? place a neuron" = no hidden semantics.

---

## 3. A connection is a relationship; it dies with its endpoints

**Why (biology).** An axon is *part of* its neuron, not a free-standing object. Kill the neuron and its axon undergoes Wallerian degeneration — it is cleared, not preserved "awaiting rewire." A synapse needs both partners alive; lose either and the connection ceases to exist.

**Invariants.**
- An edge **is** one neuron's axon: a **tree** of cells rooted at the source neuron, with leaves on the target neurons (form **F4**, generalized from path to tree). The unbranched, single-target case is a plain path (`Vec<CellCoord>`) — the common case at MVP, but the type is a tree from the start so high fan-out never forces a rewrite. Endpoints are derived (root = source, leaves = targets), not stored redundantly.
- Deleting a neuron **cascades** (**I2**): deleting the *source* removes the whole tree; deleting a *target* leaf prunes only the branch reaching it, back to the nearest fork, leaving sibling branches alive. No "dangling" or "deactivated" edge state — it contradicts F4's invariant and mismodels the biology.
- Neuron identity = its coordinate (coord-as-id), wrapped behind a `PathEndpoint` newtype so an eventual move to explicit IDs is a local change, not a sweep.
- `replace_kind(coord, new_kind)`: swap a neuron's type in place — coordinate unchanged, edges untouched, Dale sign auto-flips. This is the **high-frequency experimental op**; implement it.
- Because I2 is forced, **undo is P0** — not a deferrable cross-cutting concern. Interim guard before undo lands: confirm deletion **only for high-degree nodes**; low-degree deletes stay silent so emergence experiments aren't interrupted.

**Game payoff.** Clean cascade (Logisim/Scratch feel) + undo, with no confusing dangling state. "Excitatory or inhibitory? swap and look" runs at one keystroke — the core motion of emergence experiments.

---

## 4. Signals are graded and attenuating; learning is localized

**Why (biology).** Many insect interneurons and *C. elegans* neurons are non-spiking, using graded 0–1 signals. Graded signals attenuate electrotonically along the axon (length constant λ). Diameter sets *both* speed and resilience: conduction velocity ∝ √d **and** λ ∝ √d — two faces of one cable-theory root. Plasticity is localized to specific synapses (mushroom-body microglomeruli; dopamine-gated KC→MBON), not uniform.

**Invariants.**
- Signals are continuous 0–1, **no spikes.** (Precondition for attenuation being honest — spikes are regenerative and do *not* attenuate.)
- Attenuation: `distal = input × exp(−pathlen / λ)`.
- Metabolic budget is a **sustained-power cap (pJ/s)**: resting + activity + synapse maintenance. The activity term is **instantaneous power ∝ mean activation, NOT a time-integral** — an integral would couple metabolism to runtime and break orthogonality with the delay/cycles axis.
- Thickness `d` is one lever coupling four costs: velocity ∝ √d, λ ∝ √d, volume ∝ d²·len → metabolism. **One `d` per edge** (a branching tree shares one d). Comment that velocity and λ ride the same √d.
- Plasticity is a per-edge property (`plastic`, `mod_source`). MVP allows it anywhere (a simplification); leave room to later gate *which* edges may be plastic by node type (mushroom-body locality).
- Real units throughout (λ in μm, m/s, pJ/s, μm³). Centralize in `constants/biology.rs` with citations; estimate where insect data is thin and note it. Tuning changes numbers, never the unit system.

**Game payoff.** Position has real dynamical consequence (far = slow *and* weak), so layout is a genuine decision, not a leaderboard score. One `d` knob carries a legible bundle of coupled costs. Learning is confined to where the player deliberately puts it.

---

## 5. Meaning has no label; it is built

**Why (biology).** There is no "obstacle detector" or "chemoreceptor module" in nature — only cells wired a certain way. Function emerges from circuit motifs, not from names. (Uexküll's *Umwelt*: an organism's world is constituted by its sensors, effectors, and the wiring between them.)

**Invariants.**
- **No functional names at the system level.** Level I/O contracts use physical channels only (`ChemA` receptor, `turn_L` port) — never "avoidance module" or the like. Player-side naming lives in the player's own notes, never in the engine.
- A reference circuit gives **shape, never meaning** (TIS-100 style). MVP level 1 (`chemotaxis-l1`) ships with *no* reference — from scratch.
- Cost numbers are shown as **orthogonal quantities, never combined** into one "efficiency score." A per-level static `par` is the solo optimization target; comparison histograms are a post-community feature.
- Early-game framing — a failed colony; the player reconstructs neural structures from fragments and repairs the surviving ants:
  - Fragments are catalogued by **provenance** (specimen / body region), never by function.
  - A fragment **is a grid sub-circuit** (same wiring verb), not a jigsaw piece — no second core mechanic.
  - Many fragment sets reconstruct **a** viable circuit, never **the** canonical one. "Correct form" must not collapse into one authoritative answer.

**Game payoff.** Players learn neurons by reconstructing and repairing — inverse neuroscience (a lesion study run backward). Meaning belongs to the player, not the engine. This repair-to-understand loop *is* the teaching engine.

---

## The convergence

Across all five, the biologically honest choice was, almost every time, the best game choice. Not luck — biology and good puzzle design are the same thing underneath: **simple, legible local rules under spatial scarcity, generating complex emergent behavior.** True of one circuit; true of ten ants that, running identical simple circuits, lay a foraging trail through a shared chemical field. Umwelt is that one sentence demonstrated at two scales.

**Decision heuristic for CC:** on any new design question, first ask *what is the physically honest version?* and check it against these five. The honest version is almost always also the one that makes the better game. When the request appears to require violating an invariant, do not quietly comply — surface the conflict.

*(Operational specifics — two-stage testing, parametric superposable static fields, level format, save/load migration chains — live in the spec, not this constitution.)*
