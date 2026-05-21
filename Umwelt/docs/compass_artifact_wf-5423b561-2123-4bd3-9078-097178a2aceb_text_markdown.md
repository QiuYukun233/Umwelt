# Umwelt: A Deep Research Report on Grid-Routed Neural Circuits as a Puzzle-Game Substrate

## TL;DR

- **Grid + layer + via routing is the right substrate for "Umwelt"** — it is simultaneously (a) the legibility-maximizing convention proven across the Zachtronics canon (rectilinear paths, footprint and via costs, fixed read-only references) and (b) a defensibly *honest* abstraction of real insect neuropil, which is itself organized into discrete laminae (medulla M1–M10, mushroom-body calyx/lobes) with retinotopic columns, vertical projections, and wire-length-minimizing component placement (Cherniak, *J. Neurosci.* 1994; Bullmore & Sporns, *Nature Rev. Neurosci.* 2012).
- **The "no semantic labels" invariant should be defended with a TIS-100 / SHENZHEN I/O–style reference-circuit pattern**: meaning emerges because the player can *see and diff* the wiring, not because the engine annotates it. Cost metrics (cost / cycles / area in the Opus Magnum tradition, plus a via count and a convex-hull footprint) are what make the cheapest circuit also the most legible — this is mechanically how Zachtronics enforces elegance without ever defining "elegant."
- **The "10 ants → trail" bet is biologically and mechanically grounded**: simple local circuit motifs (lateral inhibition, modulated Hebbian plasticity localized to specific synapses, graded signals) are real (Lin et al. 2014, *Nat. Neurosci.*; Hige et al. 2015, *Neuron*; Cohn et al. 2015, *Cell*), and stigmergy in real ant foraging is the textbook case of "simple local rules → global emergent order" (Theraulaz & Bonabeau 1999; Baltiansky, Frankel & Feinerman 2023, *eLife* 12:e77659). The layer + grid + via + sectioning model serves both legibility and emergence because it constrains *authoring* without constraining *dynamics*.

---

## Key Findings

1. **Rectilinear, grid-snapped routing is the dominant convention in the genre and the legibility evidence is overwhelming.** Every Zachtronics title that involves spatial wiring (SpaceChem reactor grids, SHENZHEN I/O traces, Opus Magnum's hex tracks, Last Call BBS) uses orthogonal, integer-grid routing. The reason is plain in player commentary on SHENZHEN I/O fixed-position puzzles ("those neural processors in the middle of the board are fixed components. Not only are they not movable, I can't route wires under them, either" — LP Archive, NETHUNS board): constraint makes the puzzle. EDA literature (Lienig, *VLSI Physical Design: From Graph Partitioning to Timing Closure*, Ch. 5) and Steven Teig's "The X Architecture: Not your father's diagonal wiring" (SLIP '02, ACM) quantify the trade: "Compared with the traditional, currently ubiquitous, Manhattan architecture, the X Architecture demonstrates a wire length reduction of more than 20% and a via reduction of more 30%." Despite that penalty Manhattan remains the incumbent — chips stayed Manhattan for tooling tractability and *human* readability. This is exactly the trade Umwelt should make.

2. **Multi-layer 3D circuits with vertical vias are an established game-design pattern, but the inspection UX is where most games fail.** SpaceChem's nested reactor + production hierarchy, EXAPUNKS's host/network layers, and Logic World / Virtual Circuit Board / Turing Complete's stacked logic boards all confirm players accept layered structure. The discriminator is whether the read surface is *arbitrary cross-section* (which Umwelt proposes) or *layer-at-a-time toggle* (most games). Cross-section is strictly more powerful for analysis — it is the convention in VLSI tooling (Synopsys IC Compiler congestion maps) and in connectomics (serial-section EM, the technique behind every modern Drosophila brain reconstruction). Umwelt's "write top-down, read on any axis-aligned face" mirrors this exactly.

3. **The Opus Magnum cost/cycles/area triplet is the most-copied scoring model in the genre because it is simultaneously rivalrous, orthogonal, and legibility-correlated.** biggiemac42's tournament analyses make this concrete: the *cheapest* solution (minimum mechanism cost) is almost always the most visually compact and the easiest to read because the cheapest parts (single-gripper arms, fewest bonders) force the player to do less. A top-rated Steam review captures the player experience exactly: "Just finishing it is satisfying BUT the real goal is to make it elegant and competitive." The MechA metric (footprint of arm sweep) is the closest existing analog to a convex-hull / bounding-area cost — and Umwelt should adopt it directly, because **convex-hull footprint is the metric that most punishes spaghetti wiring without penalizing necessary depth.**

4. **The TIS-100 reference manual + corrupted-segment pattern is the proven legible-repair design pattern, and it works precisely because it has NO semantic labels.** TIS-100 nodes are numbered, not named; the manual specifies behavior, not purpose; the player is presented with puzzles that require programming nodes to perform actions on numerical input streams without ever being told what the program "means." Players invent meaning through circuit shape. This is the exact pattern Umwelt should preserve: a semi-transparent read-only reference circuit gives the *target* shape; players repair it without ever being told what the shape *means*.

5. **The biological "layer" abstraction is defensible but treacherous.** Discrete laminar organization is real in insects: the Drosophila medulla has ten genuine strata M1–M10 with retinotopic columns (Pecot et al. 2018, *eLife*: "The medulla comprises ten layers (M1-M10) organized into outer (M1-M6) and inner (M8-M10) regions that are divided by tangential processes that form the serpentine layer (i.e. M7) (Fischbach and Dittrich, 1989)"). But the mushroom body calyx is **convergent/divergent and recurrent, not feedforward** — sparse coding is enforced by *recurrent* GABAergic feedback from the APL neuron (Lin et al. 2014, *Nat. Neurosci.* 17:559–568: "sparseness is controlled by a negative feedback circuit between Kenyon cells and the GABAergic anterior paired lateral (APL) neuron"). The danger of the layer metaphor is that it slides toward feedforward ANN. Umwelt avoids this only if it makes recurrence and lateral inhibition first-class wiring options that show up in the *same* grid as feedforward connections.

6. **Ramón y Cajal's wire-economy laws + Cherniak's component-placement results validate area/wire-length cost metrics as biologically honest.** Cherniak (*J. Neurosci.* 1994, 14(4):2418–2427): "At multiple hierarchical levels—brain, ganglion, individual cell—physical placement of neural components appears consistent with a single, simple goal: minimize cost of connections among the components. The most dramatic instance of this 'save wire' organizing principle is reported for adjacencies among ganglia in the nematode nervous system; among about 40,000,000 alternative layout orderings, the actual ganglion placement in fact requires the least total connection length." Bullmore & Sporns (*Nat. Rev. Neurosci.* 2012, 13:336–349, doi:10.1038/nrn3214) generalize this to the modern view: "We propose that brain organization is shaped by an economic trade-off between minimizing costs and allowing the emergence of adaptively valuable topological patterns of anatomical or functional connectivity between multiple neuronal populations." A wire-length / via / footprint cost metric is therefore not arbitrary gamification; it is the same objective function the C. elegans nervous system was optimized against.

7. **Plasticity in real insect brains is localized to very specific structures, which makes "Hebbian plasticity only at certain ports" a faithful primitive rather than a simplification.** Two distinct sites exist: (i) *structural* PN→Kenyon-cell plasticity at calyx microglomeruli, slow and experience-dependent (Hourcade et al., *J. Neurosci.* 2010, 30:6461–6465: "Microglomerular density is increased in the mushroom body lips when an olfactory memory is formed"; Leiss et al., *J. Comp. Neurol.* 2009, 517:808–824: "each Kenyon cell's claw-like dendritic specialization is highly enriched in filamentous actin, suggesting that this might be a site of plastic reorganization"), and (ii) *fast, dopamine-gated* KC→MBON synaptic plasticity in the lobes (Hige et al., *Neuron* 2015, 88:985–998: "long-term synaptic plasticity at the output site of the Drosophila mushroom body. Pairing an odor with activation of specific dopamine neurons induces both learning and odor-specific synaptic depression"; Cohn et al., *Cell* 2015, 163:1742–1755: "Dopamine bidirectionally modifies synapses in precise domains along Kenyon cell axons"). This is excellent design news: the game's "plasticity is a property of certain ports/microglomeruli, not of all wires" is *more* biologically accurate than uniform plasticity would be.

8. **Dale's Law as a hard constraint is correct, with documented exceptions.** A neuron releases the same transmitter set at all its terminals (Eccles 1976 reformulation). Co-release exceptions exist (Sulzer & Rayport — dopamine + glutamate at separate sites) but they are *exceptions*, not the rule. Enforcing Dale's Law makes the game more honest, not less.

9. **Graded (non-spiking) signaling 0–1 is biologically defensible in the insect context.** Many insect interneurons and most C. elegans neurons signal in graded analog mode (Burrows & Siegler 1978; Schafer 2016 review; the three RIM/AIY/AFD response classes documented in *PLOS One* 2022). Even where insect neurons spike, much of the *computation* — especially in the antennal lobe and the slow chemical-modulator pathways relevant to foraging — is well-modeled by rate-coded graded variables. Umwelt's 0–1 graded signal abstraction is faithful, not a cartoon.

10. **Stigmergy is the canonical "simple local rules → global emergent order" system, and the game's bet rides on it.** Theraulaz & Bonabeau (1999), and a robust modern modeling literature, show pheromone-trail formation emerges from individuals following purely local rules ("If you find food, return to the nest laying trail pheromone" + "preferentially follow trails with more pheromone"). The most recent and directly relevant primary source is Baltiansky, Frankel & Feinerman 2023, *eLife* 12:e77659, "Emergent regulation of ant foraging frequency through a computationally inexpensive forager movement rule," whose explicit conclusion is: "These findings demonstrate how the embedding of individuals in physical space can reduce their cognitive demands without compromising their computational role in the group." This is *exactly* the wager Umwelt is making — put state in the environment, let circuits stay simple — and it is well-founded.

---

## Details

### ANGLE 1 — Game Design Precedent

#### (a) Grid-constrained vs free-form routing — and why grid wins for legibility

Free-form wiring (Logic World, Virtual Circuit Board's bitmap-style traces, Sebastian Lague–style node graphs) is more expressive but degrades in legibility above ~50 nets. The Hacker News thread on Virtual Circuit Board's open-source release (news.ycombinator.com/item?id=46499268) captures the trade-off directly: "I'm not 100% sold on the bitmap editing style of circuit layout vs something like the automatic wire pathing in Turing Complete." Rectilinear grid routing is the established compromise across the Zachtronics canon and across real EDA: it constrains the wire to a finite set of orientations, which makes *visual diff* tractable. Two designs that differ only in a single wire's path will differ visibly in exactly the cells along that path — this is the precondition for player-to-player learning by reading. Umwelt's grid + Manhattan rule is therefore not stylistic; it is the load-bearing legibility primitive.

Within EDA itself, Teig's "The X Architecture" (SLIP '02) measured a >20% wire length penalty for Manhattan but no analogous penalty in *designer cognitive load*; chips remained Manhattan-dominant for tooling reasons. The same trade applies to Umwelt: 20% extra "wire" is a cheap price for a system that humans can read at a glance.

**Design lesson:** Keep the hard grid. Resist the temptation to add 45° diagonals or curves "for naturalism" — they will halve diff-ability and double the area of the visual search players must do to understand a stranger's circuit.

#### (b) Layered / multi-plane structures and inspection UX

The relevant prior art:

- **SpaceChem** uses two-layer reactors (top/bottom waldo planes) and a one-level-up "production" composite. Inspection is by toggle. Players consistently report the toggle as a friction point.
- **EXAPUNKS** stacks host/network layers; navigation is by EXA agent. The cross-layer view is implicit, not graphical.
- **Last Call BBS / 20th Century Food Court** uses 2D boards.
- **Logic World** is full 3D free-form; "inspect" means flying the camera, which is famously disorienting.
- **Factorio circuit network** is single-plane but uses two color-channels (red wire / green wire) which act as cheap parallel layers; players have invented elaborate plain-text notations to describe circuits precisely because the in-game visual is hard to share (Factorio Forums, "Code-Convention for circuit networks").

Umwelt's "cube that slices on any axis-aligned face" is the strict generalization of these. The closest real-world analog is the VLSI cross-section view and the connectomics serial-section EM stack — both of which biology and engineering rely on for exactly this reason: arbitrary planar slices are the only way to read 3D wiring at scale.

**Design lesson:** The "write top-down per layer / read on any axis-aligned face" asymmetry is exactly right. Writing in 3D is hard; reading in 2D slices is humanly tractable; the slicing axis lets the player choose the projection that exposes the structure they care about.

#### (c) Cost / cycles / area metrics and how they push toward elegance

Opus Magnum's three metrics are functionally orthogonal: cost (parts), cycles (time), area (bounding hex). They cannot all be minimized simultaneously, which generates the "three puzzles for the price of one" effect noted on the Steam forums. biggiemac42's tournament analyses document that *cost-minimal* solutions are typically also the most legible because they have the fewest moving arms (often a single-gripper arm), so a reader can trace the entire process from one perspective. A top-rated Steam review of Opus Magnum captures the player experience exactly: "Just finishing it is satisfying BUT the real goal is to make it elegant and competitive." The MechA metric (footprint of arm sweep — closer to convex hull) is a recent addition; players found it terrifying because "Zero Access Everything" solutions are now possible, but it also massively rewards *spatial tidiness*.

For Umwelt, the cost stack should be:
1. **Neurons used** (Opus Magnum "cost" analog)
2. **Cycles to stable behavior** (the time signature)
3. **Bounding box / convex hull of all wired cells** ("area" — punishes spread)
4. **Via count** (cost of crossing layers — biologically real metabolic cost)
5. **Total Manhattan wire length** (Cajal's wire-minimization, made literal)

The empirical observation from Opus Magnum is that none of these need explicit weighting. Three to five separate rivalrous leaderboards generate the optimization gradient by themselves; *players* find the elegant intersections.

**Design lesson:** Do not try to combine cost metrics into a single "score." Show histograms. Let the player invent which metric they care about. The histogram itself is a community legibility artifact — it tells you whether your shape is exotic or mainstream.

#### (d) Routing-as-the-puzzle

Several SHENZHEN I/O puzzles use *fixed obstacles* whose only role is to force routing problems (the NETHUNS board: "those neural processors in the middle of the board are fixed components. Not only are they not movable, I can't route wires under them, either"). This is the same trick the VLSI literature uses: routing congestion is a first-class design problem (Lienig Ch. 5: "Negotiated-Congestion Routing"). The arXiv literature on "Multi-Agent Routing under Crossing Costs" gives the formal underpinning: crossing-cost objectives generate Nash equilibria with desirable global properties — i.e., charging for crossings is sufficient to push players toward planar or near-planar layouts without explicit forbidding.

**Design lesson for Umwelt:** Charge for vias (out-of-plane crossings), don't forbid them. The convex-hull cost will already pressure-test most spaghetti.

#### (e) Reference-circuit / repair pattern, and "no semantic labels"

This is the design pattern Umwelt most needs to get right, and the precedent is unambiguous. TIS-100 nodes have no names — they are numbered (T21 compute, T30 stack memory). Behavior is specified in a printed manual that describes *what nodes do*, never *what they are for*. The corrupted-segment puzzles present a partially-functional layout; the player fills in the missing instructions. Critically, the reference layout itself never tells the player what it is doing — they infer it by reading.

SHENZHEN I/O extends the pattern: components have datasheets, not descriptions. The DX300 is "an output device that takes 0–100"; the player decides what to wire to it.

Baba Is You is the orthogonal precedent: meaning is constructed from physical tile placement, not from engine semantics. "Baba Is You" is true *because the tiles are arranged that way*, not because the engine labels Baba.

**Design lesson:** The Umwelt cube should expose only physical primitives. The reference circuit is a *shape*; the test fixture is a *signal pattern in, signal pattern out*. The word "chemoreceptor" should never appear in the engine. If players want to call layer 3 the "chemoreceptor module," they may write it in their own annotation tool — but the system must not.

This is the same discipline Zach Barth describes in his Giant Bomb interview: "I've got all of my notebooks since high school (about 15 years ago) and design all of my puzzles on paper 'puzzle design worksheets.'" Puzzles are described in terms of inputs, outputs, and constraints — never in terms of what the puzzle "means."

#### (f) Two-tier creator/consumer community structure

The Opus Magnum and TIS-100 communities split naturally: hardcore players post tournament solutions and discuss optimization (biggiemac42's blog, the OM Discord) while casual players consume "puzzle of the week" and finish the main campaign. The infrastructure that makes this work:

1. **Solutions are tiny diffable text files.** SHENZHEN I/O saves are essentially `.txt` (the sunzenshen/shenzhen-io-solutions GitHub repo demonstrates this — the trace map is ASCII art). Umwelt should adopt the same: a circuit is a small textual representation that can be pasted into Discord.
2. **Histograms make local comparison legible without exposing the whole leaderboard.** Players see how their score compares to the distribution, not just the top score.
3. **Reference circuits become a sharing primitive.** When a hardcore player posts "here is a foraging-trail module," casual players can drop it into their puzzles. This is the natural two-tier structure: creators make modules, consumers assemble them.

**Design lesson:** Solution serialization must be plain-text-diff-friendly from day one. This single decision determines whether the community will form.

---

### ANGLE 2 — Neuroscience Grounding

#### (a) Layered/laminar organization in real insect nervous systems

The "discrete layer + 2D grid + vertical via" abstraction maps to real biology with the following honesty rating:

- **Optic lobe (lamina → medulla → lobula complex):** Strongly mapping. The Drosophila medulla has ten anatomically discrete strata M1–M10 organized retinotopically (Fischbach & Dittrich 1989; Pecot et al. 2018, *eLife* 7:e33962: "The medulla comprises ten layers (M1-M10) organized into outer (M1-M6) and inner (M8-M10) regions that are divided by tangential processes that form the serpentine layer (i.e. M7) (Fischbach and Dittrich, 1989)"). Columnar microcircuits perpendicular to the layers create a genuine 2D-grid-per-layer structure. **This is the structure most defensibly modeled by Umwelt's primitives.**

- **Antennal lobe glomeruli:** Mostly mapping, with a caveat. Glomeruli are discrete spherical neuropils, each receiving one olfactory-receptor-type input — i.e., a discrete unit at a position. They are not, however, arranged in a 2D grid; they form a 3D cluster of ~50 units in Drosophila. Modeling them as a 2D layer of grid cells is a *simplification* (you lose topology), but not a *fabrication* (you preserve unit identity and one-input-per-unit).

- **Mushroom body calyx + lobes:** Partially mapping, dangerously seductive. The calyx has stratification (lip / collar / basal ring) and the lobes have compartments (α/β/γ etc.), each receiving distinct dopaminergic modulation. Kenyon cells form microglomeruli with PN boutons in the calyx (Leiss et al. 2009: "Throughout the calyx, these elements constitute synaptic complexes called microglomeruli"). But the calyx is *expansion convergent-divergent* (~150 PNs → ~2000 KCs in Drosophila) with *recurrent* GABAergic feedback from the APL neuron (Lin et al. 2014; Inada et al. 2022, *eLife* 11:e74172: "APL, via inhibitory and reciprocal synapses targeting both PN boutons and KC dendrites, normalizes odour-evoked representations in MGs of the calyx"). **Modeling this as a feedforward "layer 1 → layer 2 → layer 3" stack would be a fabrication.** The honest model is: layers = anatomical strata, but with explicit recurrent and lateral connections living in the same grid.

- **Vertebrate cortical layers (six layers, Brodmann areas) and retina (3 cellular layers + 2 plexiform):** Comparison reference. These are also laminar, also retinotopic in early visual cortex, also recurrent. The cortical column literature has spent 60 years correcting the "feedforward stack" mental error; Umwelt should not import it.

#### (b) The "layer" metaphor as failure mode

The risk is that "discrete 2D layer + via" reads as deep-learning-style feedforward stack. Three biological facts must be preserved in the wiring primitives to prevent this:

1. **Recurrence is everywhere.** Cortical layer-5 pyramidals project back to layer 2/3; APL feeds back onto KCs (Lin et al. 2014); antennal-lobe LNs synapse onto PNs that synapse onto LNs (Wilson 2013; eLife 2021 type I vs type II LN study). Umwelt should allow same-layer and back-layer wiring with no extra friction.

2. **Lateral inhibition is intra-layer.** "Lateral inhibition prevents PN saturation, greatly extending their dynamic range" (Wilson 2013 review). Galizia's review ("Olfactory coding in the insect brain: data and conjectures," 2014) shows that even lateral inhibition is *selective* (heterogeneous LN connectivity), not the textbook uniform Mexican hat. Umwelt's mutual/lateral inhibition primitive is biologically grounded.

3. **Neuromodulation is volume-targeted.** Dopamine compartments in MB lobes target *specific axonal segments* of KCs (Cohn et al. 2015: "Dopamine bidirectionally modifies synapses in precise domains along Kenyon cell axons"). This is the biological argument for Umwelt's "plasticity is a property of specific ports, not of all wires."

#### (c) Wiring economy validates cost metrics

This section is where neuroscience most directly validates the game's design choices:

- **Ramón y Cajal (1899)** proposed that brain structure is optimized to save *space* (wire), *time* (conduction delay), and *matter*. The Frontiers and PLOS Comp Bio modern reanalyses confirm this for real cortical axons, with the caveat that cortex trades modest extra wire for better latency uniformity (Budd & Kisvárday 2010, *PLOS Comput. Biol.* 6:e1000711: "intracortical axons were significantly longer than optimal. The temporal cost of cortical axons was also suboptimal though far superior to wire-minimized arbors").

- **Cherniak (*J. Neurosci.* 1994, 14(4):2418–2427)** showed that the C. elegans nervous system's ganglion layout is the global wire-length optimum out of ~40 million alternatives: "among about 40,000,000 alternative layout orderings, the actual ganglion placement in fact requires the least total connection length." For C. elegans this is a strict result; for mammalian cortex it is approximate (Kaiser & Hilgetag 2006 found rearrangement is possible).

- **Bullmore & Sporns (*Nat. Rev. Neurosci.* 2012, 13:336–349, doi:10.1038/nrn3214)** synthesize this into the modern "economical small-world brain" view: "We propose that brain organization is shaped by an economic trade-off between minimizing costs and allowing the emergence of adaptively valuable topological patterns of anatomical or functional connectivity between multiple neuronal populations."

**The implication for Umwelt is direct:** wire length, footprint, and via count are not arbitrary scoring metrics. They are the actual objective function biology was selected against. A cheapest-in-wire-length circuit is, in a literal evolutionary sense, the most plausible.

#### (d) Does neuron position carry dynamical meaning, or only cost meaning?

This is the most consequential honesty question for Umwelt's design. The honest answer:

- **In rate-coded graded-signal models (which Umwelt uses):** position carries *no* dynamical meaning. The dynamics depend on the connectivity graph and the per-neuron parameters. Two circuits that are graph-isomorphic and have identical neuron parameters will produce identical dynamics regardless of layout. Position therefore *only* affects routing cost.

- **In real biology:** position carries dynamical meaning through conduction delay (axon length → ms-scale delay) and through volume transmission (neuromodulators diffuse in 3D). These matter for fast timing circuits and for slow modulatory state.

- **Umwelt's honest position:** "neurons live on a grid for routing-cost reasons; the dynamics depend on graph topology and per-neuron parameters" is correct *for rate-coded graded models*. The fabrication would be claiming position has *no* effect in real biology. The simplification is omitting conduction delay. The honest middle path is to optionally enable conduction delay proportional to Manhattan path length on plasticity-relevant edges — making the wire-length cost metric literally affect dynamics in late-game puzzles.

#### (e) Dale's Law, graded signaling, mutual inhibition, modulated Hebbian plasticity

All four are biologically defensible primitives:

- **Dale's Law (Eccles 1976 reformulation):** "the same chemical transmitter is released from all the synaptic terminals of a neurone." Modern exceptions (DA + Glu co-release; Sulzer & Rayport) are real but rare. Enforcing Dale's Law as a wiring constraint makes the game honest.

- **Graded 0–1 signaling:** Standard for most insect non-spiking interneurons (Burrows & Siegler 1978), all C. elegans non-spiking neurons (Lockery & Goodman; AIY, RIM, AFD; Schafer 2016), and even AWA odor responses in C. elegans which are "subtle, graded" (Liu et al. 2018, *Cell*). Mean-field rate models in mushroom-body computational literature use exactly this primitive.

- **Mutual / lateral inhibition:** Documented across the antennal lobe (Sachse & Galizia 2002 for the Mexican-hat model; Olsen & Wilson 2008; modern selective-LN connectivity in *eLife* 2021), the MB calyx (APL → KC), and motor circuits. Mutual inhibition is the canonical biological mechanism for winner-take-all and gain control.

- **Modulated Hebbian plasticity localized to microglomeruli and KC→MBON synapses:** Confirmed by Hourcade et al. 2010 (calyx microglomerular density increases with LTM), Hige et al. 2015 (dopamine-gated heterosynaptic plasticity at KC→MBON in lobes: "long-term synaptic plasticity at the output site of the Drosophila mushroom body. Pairing an odor with activation of specific dopamine neurons induces both learning and odor-specific synaptic depression"), Cohn et al. 2015 (compartmentalized modulation). The game's "plasticity is a property of specific ports" rule is *more* biologically faithful than uniform Hebbian rules.

#### (f) Uexküll's Umwelt as the philosophical frame

Jakob von Uexküll's 1909 *Umwelt und Innenwelt der Tiere* and the 1934 *Streifzüge* (translated as *A Foray into the Worlds of Animals and Humans*) establish the tick example: butyric acid + warmth + touch = the entire perceptual world of the tick. Each organism's *Funktionskreis* (perception → action loop) is defined by its sensors and effectors and the wiring between them. The game's title is the philosophical claim that, by wiring an insect's circuits, the player constructs its world — perception is not given by the engine; it is constructed by the wiring. This is the second reason "no semantic labels": there is no "chemoreceptor module" in nature, only a chemoreceptor cell with certain wiring, and that wiring is what *constructs* the meaning of "food smell" for that organism.

---

## Synthesis: Legible Local Parts → Surprising Emergent Wholes

The tension the project worries about — wanting legible, analyzable, authored local structure while betting on emergent global behavior — is not a tension at the design level; it is the central design pattern of every successful work in the genre, and it is also the central organizing principle of insect neurobiology.

**On the game-design side:** Zachtronics's entire body of work demonstrates that humans find emergent complexity *more* satisfying when the local rules are *more* constrained and *more* legible. SpaceChem's emergent factory rhythms, Opus Magnum's emergent loop choreographies, and Factorio's emergent supply chains all rest on rigid local rules. The bet is correct: legibility at the local level is *what makes emergence visible*. If you can't read the parts, you can't appreciate the whole.

**On the neuroscience side:** The same principle obtains. Ant trail formation emerges from two rules per ant; mushroom body sparse coding emerges from an expansion layer plus recurrent APL inhibition (Lin et al. 2014); antennal-lobe gain control emerges from glomerular LNs (Olsen & Wilson 2008). In each case, the local circuit is *simpler* than naive intuition would expect. The complexity lives in the population × time × environment cross-product, not in the per-neuron logic. Baltiansky, Frankel & Feinerman (*eLife* 12:e77659, 2023) put the principle in its most game-relevant form: "These findings demonstrate how the embedding of individuals in physical space can reduce their cognitive demands without compromising their computational role in the group."

**The layer + grid + via + sectioning model serves both:**

- It serves authoring by making each cell of the design a discrete editable unit, snappable to a finite set of neighbors.
- It serves analysis by making cross-sections diff-able, shareable as text, and visually compact.
- It serves emergence by *not* over-constraining dynamics: graded signals, recurrence, neuromodulation, and plasticity all live in the same primitive substrate.
- It serves honesty by mirroring the actual laminar+columnar+via structure of real insect neuropil (optic lobe especially), and by making wire-length cost a literal biological selection pressure rather than an arbitrary score.

The 10-ants-form-a-trail bet is, in this light, not exotic. It is the simplest possible demonstration of the genre's central trick — "constrain the parts hard, watch the whole surprise you" — and it is biologically grounded in Theraulaz, Bonabeau, and the modern stigmergy literature. If 10 ants running identical simple circuits do not form trails, the model is broken; if they do, the player has empirical proof that their wiring is correct, without the engine ever having to label what "correct" means.

---

## Recommendations

### Staged design priorities

**Stage 1 — defend the invariants:**
1. Lock the grid and Manhattan routing for all in-layer wiring. Do not add diagonals "for naturalism."
2. Vias as the *only* inter-layer primitive, with a per-via cost in the histogram. No teleporters, no "magic" cross-layer references.
3. Solution serialization as plain text (ASCII trace + per-neuron parameters) from day one. Test paste-into-Discord on day 30.

**Stage 2 — install the legibility scaffolding:**
4. Cost histograms on five orthogonal metrics: neuron count, wire length (Manhattan), via count, convex-hull footprint, cycles-to-stable. Do not combine into a single score.
5. Cross-section view that snaps to any axis-aligned face, with the option to walk the section plane through the cube. This is the analysis primitive.
6. Reference-circuit overlay (TIS-100 style, semi-transparent): the *shape* is given; the *meaning* is not.

**Stage 3 — preserve neuroscience honesty:**
7. Make recurrence, lateral inhibition, and neuromodulation first-class wiring primitives — same grid, same rules — so the "layer" metaphor cannot slide into feedforward ANN.
8. Localize plasticity to specific *port types* (calyx-microglomerulus analog: structural, slow, per Hourcade 2010; lobe-style: fast, dopamine-gated, per Hige 2015 / Cohn 2015). Make this a wiring rule the player must respect, not a global toggle.
9. Enforce Dale's Law as a wiring constraint at the neuron level: pick excitatory or inhibitory once, all axon terminals inherit. Allow co-release as a rare advanced primitive in late-game puzzles, with a citation in the manual.

**Stage 4 — test the emergence bet:**
10. The 10-ants-foraging-trail puzzle must be playable within the first 4 hours of game time. If it does not produce a visible trail with reasonable wiring, the simulation parameters are wrong, not the design.

### Benchmarks that would change these recommendations

- **If playtesting shows >40% of players cannot read a stranger's circuit at 50 neurons:** the grid is too sparse or the visual encoding of port types is too subtle. Add an alt-mode overlay (Factorio precedent).
- **If the cost/cycles/area/vias/hull stack doesn't generate a Pareto frontier with at least 3 distinct "elegant" solutions per puzzle:** one metric is dominated; cut it.
- **If players hit the no-semantic-labels rule as friction rather than as productive ambiguity:** add an *in-fiction* labeling tool (an in-game notebook the player writes in) but never let labels enter the engine.
- **If 10 ants with identical circuits cannot form trails:** the simulation's pheromone diffusion/evaporation parameters are wrong, or the lateral inhibition gain is wrong — re-tune the *simulation*, do not change the design invariants.

---

## Caveats

1. **The "no semantic labels" invariant will fight tutorial design.** Every successful Zachtronics game has a *manual* that uses informal English to describe what nodes do. Umwelt will need the same. The discipline is: the manual describes mechanism (graded signals 0–1, Dale's Law, lateral inhibition); it never describes purpose (this is the "input layer"). Players construct purpose from wiring.

2. **The layer abstraction's biggest risk is in the mushroom body.** Optic lobe layering (medulla M1–M10) is clean; MB layering is messy (convergent-divergent calyx, lobe compartments with dopaminergic modulation, recurrent APL feedback). Honest design will require some MB puzzles to expose recurrence explicitly so the player cannot mistake the system for a feedforward stack.

3. **Wire length as biological cost is not the *only* biological cost.** Real brains also optimize for conduction latency uniformity (Budd & Kisvárday 2010 — cortical axons trade ~20% extra wire for better timing). Umwelt's cost metric should not be presented to players as "the biologically true objective"; it is *one* honest objective among several. The game can be more transparent about this in the manual than its forerunners typically are.

4. **The Cherniak result is strongest for C. elegans, weaker for mammalian cortex.** Players who read the neuroscience may notice that Kaiser & Hilgetag (2006, *PLOS Comput. Biol.*, "Nonoptimal component placement, but short processing paths…") found cortical areas are *not* at the global wire-length optimum. The honest framing: wire-length minimization is a strong selection pressure, not a strict constraint.

5. **The "10 ants form trails" bet depends on the pheromone-field simulation, not just the circuits.** Baltiansky, Frankel & Feinerman (*eLife* 12:e77659, 2023) make the point bluntly: stigmergy works because *the environment* holds the state. If Umwelt's chemical-field simulation is undertuned, identical-circuit ants will not form trails, and the player will blame the wiring. Tune the field first; verify with a known-good circuit; only then ship.

6. **Two-tier community structures emerge; they cannot be forced.** SHENZHEN I/O and Opus Magnum's communities exist because solutions are tiny text files. If Umwelt's serialization is opaque, no community will form regardless of how good the game is.

7. **Uexküll's Umwelt as philosophical frame is potentially heavy.** The game can wear this lightly: the title is the thesis statement, the wiring is the argument. Avoid in-engine philosophizing; let the players read Uexküll themselves if they want.