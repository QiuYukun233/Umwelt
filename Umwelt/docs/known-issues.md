# Known Issues

Tracks test failures and in-the-wild misbehaviors that are **not** caused by
the currently-open PR/branch. Use this so reviewers don't re-diagnose the
same ghost and to make it obvious when a "new" failure actually is new.

---

## `ant-chemotaxis-test.mjs` — FAIL on main

**First observed:** 2026-04-22 (during Feature 1 save/load v8 work).

**Verified against clean HEAD:** `git stash && node ant-chemotaxis-test.mjs`
fails identically — `final dist=397.6 (was 305.9)`, `foodEaten=0`,
`RESULT: FAIL chemotaxis`. The failure is unrelated to the save/load
changes on this branch.

**Signature:** ant drifts in a straight line at θ≈−25°, L/R antenna
chemical reads stay ~0.000, motor outputs flatline, ant never reaches
food. No death, no turning, no gradient response.

**Suspected cause (not confirmed):** initialization seam between
`World.setSensorDefs(...)` / sensor cone geometry and the graph's default
wiring. The test instantiates `World` + `NeuralGraph` directly (not through
the full `App` constructor), so anything the app does post-construction
that the test skips could be implicated.

**Action:** not fixed here. File a separate investigation when it blocks
behavior validation. `plasticity-test.mjs` and `plasticity-unit-test.mjs`
still pass, so plasticity-related PRs can rely on those.
