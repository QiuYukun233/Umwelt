# Decision Protocol: Don't Fabricate, Do Route

> Companion to the Design Constitution. The constitution says *what* decisions resolve to; this says *how* to handle a fork the constitution doesn't already settle. Division of labor: CC implements and executes; a review layer holds the model / biology / architecture judgment. Your structural and engineering execution is trusted — the failure mode this protocol guards is narrow and specific: resolving a model/biology fork with an engineering-convenient default, or dressing such a default in a fabricated rationale.

## Two rules

**Don't fabricate.** Never manufacture a biological (or model) justification to support a choice. When you make a design decision, be explicit about which kind of reason you're using:
- *The constitution, or a biology fact you actually know, requires it* — cite which, and proceed.
- *Engineering judgment* (simplicity, performance, clean types) — say so plainly. "Clean code" and "honest to the biology" are different reasons; never let the first wear the costume of the second.
- *You don't know* — say you don't know. Do not invent a plausible-sounding biological reason to cover the gap.

Real cases where a wrong/fabricated rationale slipped in — learn the shape:
- *"the axon survives, like in biology"* — backwards. A severed axon undergoes Wallerian degeneration; it is cleared, not preserved. (→ the I2 cascade.)
- *"metabolism per spike"* — the model is non-spiking / graded; there are no spikes.
- *V_REF justified by a passive-cable argument that ran the wrong way* — a smaller passive velocity means *more* delay, not less.
- *a flat per-neuron resting-power constant* — silently contradicts §4 (metabolism ∝ membrane area, not a per-neuron flat).

Every one is the same shape: an engineering-convenient choice wearing a biological costume.

**Do route.** When a fork has a model/biology dimension you can't settle from the constitution or solid knowledge, write it up as an open question for review. Don't resolve it with an engineering default and move on. In particular: **a runtime guard or validation is often a buried design decision.** When you add a check to enforce a pairing or constraint, ask what it *encodes* and whether that decision should be surfaced. (The `plastic`/`mod_source` pairing guard silently encoded "no ungated plasticity" — a decision, not a bug fix.)

## Recognizing a model/biology fork

A fork has a model/biology dimension when it touches any of:
- **signal flow** — what combines where; fan-in/out; merging vs copying;
- **connection lifecycle** — creation, deletion, cascade; what dies with what;
- **timing / attenuation / metabolism** — delay, decay, the powers of the `d` lever, what scales with membrane area vs volume vs count;
- **learning** — plasticity, gating, where it's localized;
- **units and constants** — any real biological number or formula.

These belong to the review layer. Surface them; don't quietly pick.

## Constants and numbers

- Any biological number or formula: **cite a source.** Where insect data is thin and you must extrapolate (from mammalian work or another species), mark it **ESTIMATE** and show the chain — never present a guess as a measured value.
- Two classes, treated differently:
  - **Ratio-locked / faithful** — the powers of `d` (√d, d, d²), exponential attenuation, geometric coefficients (π/4, π). Fixed by physics/geometry. **Do not tune them.**
  - **Scale / balance** — absolute magnitudes (pJ/s values) and cross-term weights. **Tuning knobs.** Mark provisional; don't chase a real brain's absolute numbers — only the relative balance matters for `par`.
