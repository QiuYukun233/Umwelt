# Project Log

## 2026-06-05

### Progress

- Created the initial project documentation plan for ReviewFlow.
- Locked MVP analysis target to Node.js + Prisma.
- Decided to keep setup lightweight: documentation, tracking files, graph schema notes, and trace event conventions only.
- Imported `antonio-lazaro/prisma-express-typescript-boilerplate` into `templates/prisma-express-typescript-boilerplate` as a reference starter for Phase 0.
- Created a focused Phase 0 sample backend in the project root using Express, TypeScript, Prisma, and SQLite.
- Added `POST /orders/:orderId/confirm` as the first analyzer target endpoint.
- Installed dependencies, generated Prisma Client, pushed the SQLite schema, seeded demo data, and verified the API.
- Added the first static analyzer CLI with `npm run analyze:order`.
- Generated `graph-output/order-confirm.graph.json` for `POST /orders/:orderId/confirm`.
- Added the Phase 2 React graph viewer powered by Vite.
- Added graph filters for all nodes, writes, errors, and external calls.
- Added a details panel for selected nodes with source locations, connected edges, and replay steps.
- Completed Phase 2.1 readability pass: wider nodes, clearer column layout, external calls moved before branch/error columns, selected-path highlighting, muted unrelated edges, and grouped edge details.
- Added Phase 3 replay controls for graph steps: play/pause, previous/next, reset, slider scrubbing, active node/edge highlighting, and failed/risky step styling.
- Added Phase 4 local review assistant guidance for selected graph areas: summary, risks, tests, and checklist.
- Added a demonstrable data movement table that changes with replay steps, showing order, inventory, payment log, and external authorization state over time.
- Added source manifest generation and a right-side source preview panel with highlighted source lines.
- Added Phase 5 Operation Ledger as the faster storyboard-first review entry.
- Added source-backed certainty and evidence metadata to analyzer output for nodes, edges, and replay steps.
- Added an Evidence panel with reachability, entity identity, field patch, source anchor, static rule, source ref, and degrade reasons.
- Upgraded the data movement table from `before/after` to `before/patch/after`, including explicit `omitted` and static-only uncertainty semantics.
- Added spreadsheet-style selected-table review: clicking or replaying into a table shows a grid with selected before/patch/after lanes, plus a cell-level trace bridge from source cell through processing into target cell.
- Added a collapsible right details panel so the table/graph review surface can take more space during visual inspection.

### Findings

- `D:\dev\ReviewFlow` is the project workspace.
- The git repository root is `D:\dev`, so ReviewFlow work must avoid parent-directory changes.
- The current project directory started empty.
- The imported starter includes Express, TypeScript, Prisma, controllers, routes, services, tests, Docker files, auth, validation, Swagger, and logging.
- The starter is useful as a structural reference, but it is broader than the ReviewFlow demo needs.
- The root sample app is intentionally smaller than the imported starter and keeps controller, service, repository, and external-call layers visible.
- `POST /orders/1/confirm` returns a successful confirmation for actor `101`.
- `POST /orders/2/confirm` returns a `409 Conflict` for insufficient inventory.
- The analyzer extracts the endpoint, call chain, Prisma table operations, branch conditions, thrown exceptions, transaction boundary, external call, source locations, and replay-style steps.
- The UI reads the generated graph JSON via Vite raw import, so `npm run analyze:order` should be run before frontend build when graph output changes.
- In-app Browser verification was attempted, but node_repl initialization failed in this Windows sandbox with `windows sandbox failed: spawn setup refresh`.
- HTTP verification confirmed the Vite dev server returns the app at `http://127.0.0.1:5173`.
- Phase 2.1 HTTP verification confirmed the active Vite dev server returns the app at `http://127.0.0.1:5175`.
- Phase 3 uses static analyzer steps only; runtime trace replay is not implemented yet.
- Phase 4 is deterministic and local. It does not call an external LLM yet, but the generator is isolated in `src/ui/reviewAssistant.ts` for future replacement.
- The data movement table is a deterministic demo lane, not runtime tracing. It exists to make the static replay explainable during demos.
- `npm run analyze:order` now writes both `order-confirm.graph.json` and `order-confirm.sources.json`.
- Phase 5 keeps graph rendering as a structural index, while the Operation Ledger becomes the primary fast-reading path.
- Runtime trace has not been attached yet, so Phase 5 certainty is static-only; no step is marked `observed`.
- Static Prisma writes are source-backed at model/table level, but field patches are still marked approximate until runtime trace or deeper data-flow extraction exists.
- Cell-level trace links are currently demo mappings for the sample endpoint; the next analyzer milestone should generate them from runtime trace or deeper static field projection.

### Blockers

- No blockers for documentation setup.
- Application implementation has not started.

### Next Steps

- Define a small Node/Prisma CRUD demo for Phase 0.
- Decide which parts of the imported starter to keep for the actual demo and which to discard.
- Consider an LLM-backed explanation mode after the local rules prove useful.
- Add export/copy actions for generated review checklists.
- Replace deterministic demo snapshots with real runtime trace snapshots when Phase A+B tracing is added.
- Add copy/open actions for source preview locations.
- Consider making the analyzer configurable after the first graph UI is useful.
- Keep all generated outputs under ignored ReviewFlow artifact directories.
- Add runtime trace events that can upgrade static certainty from `exact_static` or `approximate` to `observed`.
- Add diff-aware risk lenses for AI coding review, especially wrong model writes, external side effects before commit, and missing rollback/compensation.
- Replace demo-only cell trace mappings with extracted state projections once runtime instrumentation exists.

## 2026-06-17

### Progress

- Repositioned the real-world adoption path around Python AWS stateless batch migration work.
- Added AWS Batch Trace schema documentation for Lambda, Glue, S3, Step Functions, EventBridge, Lambda calls, PostgreSQL SQL events, transactions, exceptions, and state projections.
- Added a company-machine quickstart for using ReviewFlow when the real project cannot be shared in this workspace.
- Added a lightweight Python SDK skeleton in `packages/python/reviewflow_trace`.
- Added `lambda_trace`, `trace_execution`, psycopg connection/cursor wrappers, and boto3 client wrappers.
- Added a sample AWS batch trace at `samples/aws-batch-trace/example.trace.json`.
- Added an AWS Trace UI mode with an execution timeline, PostgreSQL state projection sheet, AWS side-effect cards, active event details, and collapsible details.
- Added local observer support: the AWS Trace UI can load a trace JSON from the company machine through a browser file picker, without uploading to AWS or any ReviewFlow backend.
- Added local observer documentation clarifying the no-upload data boundary.
- Added local Ruby/Oracle legacy trace support for migration comparison.
- Added Ruby/Oracle trace schema, sample legacy trace, and a minimal Ruby recorder skeleton.
- Added UI support for loading both Python/AWS and Ruby/Oracle trace JSON files locally, then comparing mapped Oracle cells to PostgreSQL cells.

### Findings

- For Ruby/Oracle to Python/AWS/PostgreSQL migration, runtime trace should lead; static analysis can follow later.
- The most useful unit is a single job execution, not a web endpoint.
- State projections are the bridge between runtime evidence and the spreadsheet-like review surface.
- psycopg and boto3 can be wrapped with low intrusion by duck typing instead of requiring framework-specific hooks.
- Local File API trace loading is a safer first adoption path than deploying any ReviewFlow component into AWS.
- Legacy comparison needs explicit field/value mapping; otherwise ReviewFlow should mark cells as missing or mismatched instead of guessing equivalence.

### Next Steps

- Add a trace import command that copies a real JSON trace into a ReviewFlow-visible location.
- Add a trace history/library for multiple local files after the one-file picker proves useful.
- Add an Oracle/Ruby legacy trace or mapping importer.
- Add field mapping comparison: legacy Oracle cell to target PostgreSQL cell.
- Add old/new side-effect parity comparison, not just table-cell comparison.
- Decide how much before/after DB value capture should happen inside the SDK versus a safer post-run database snapshot.
