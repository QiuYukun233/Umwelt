# Known Risks

## Graph Explosion

Business endpoints can touch many services, repositories, tables, and side effects. Large graphs can become slower to review than code.

Mitigation: add folding, filtering, levels of detail, and entry-scoped views early.

## Dynamic Code and Framework Magic

Dynamic imports, runtime dispatch, decorators, middleware chains, and framework conventions may hide behavior from static analysis.

Mitigation: start with explicit imports and Prisma calls, then mark unresolved calls instead of pretending they were analyzed.

## Dynamic SQL and Raw Queries

Raw SQL may be difficult to map to tables and fields reliably, especially when generated from string concatenation.

Mitigation: classify raw queries separately and extract table names only when confidence is high.

## Field-Level Accuracy

Perfectly tracking field changes through transformations, conditionals, and helper functions is hard.

Mitigation: begin with table/model-level operations and label field inference confidence.

## Source Jump Trust

If graph items cannot jump back to source, reviewers may not trust the output.

Mitigation: make source locations part of the graph schema from the start.

## Runtime Trace Coverage

Runtime tracing only shows paths that were executed.

Mitigation: combine static possible paths with runtime coloring: gray for possible, green for executed, yellow for risky side effects, and red for failures.

## UI Over-Decoration

The game-like metaphor could reduce review speed if the UI becomes too playful.

Mitigation: keep the core review view dense, readable, and source-linked; use motion and replay only where they clarify behavior.
