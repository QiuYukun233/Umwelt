# ReviewFlow

ReviewFlow turns backend business code into a replayable dataflow graph so reviewers can quickly understand where data comes from, how it changes, where it is written, and where failures or side effects occur.

## MVP Direction

The original demo focuses on **Node.js + Prisma + React**.

The practical migration path now adds **Python + AWS batch trace + PostgreSQL** for Ruby/Oracle to Python/AWS/PostgreSQL migration review.

Given one backend endpoint or use case, ReviewFlow should produce a business behavior graph that shows:

- API or function entrypoint
- Controller, service, and repository call flow
- Prisma model reads and writes at table/model level
- Conditional branches, guard clauses, and thrown errors
- External calls and other side effects
- Source file and line references for trust and review speed

## Current Scope

The repository now contains:

- Node/Prisma sample backend and static analyzer demo.
- React review UI with graph replay, source preview, table-sheet interaction, and collapsible details panel.
- AWS Batch Trace sample mode for Lambda/S3/PostgreSQL/EventBridge/Step Functions review.
- Lightweight Python tracing SDK skeleton under `packages/python/reviewflow_trace`.
- Trace schema and migration quickstart docs.

## Planned Phases

- Phase 0: Create a small CRUD demo with 3-5 tables and representative success/error paths.
- Phase 1: Extract a minimal static graph from Node/Prisma endpoint code.
- Phase 2: Render the graph in a React UI.
- Phase 3: Add replay mode from static order or runtime trace events.
- Phase 4: Add AI explanations, risk notes, test suggestions, and review checklists.
- Phase 5: Add operation ledger, source-backed evidence, and spreadsheet-style table review.
- Phase 6: Add AWS batch migration trace mode for Python + psycopg + boto3 projects.

## Development Notes

Keep all project work inside `D:\dev\ReviewFlow`. The git repository root is currently `D:\dev`, and the parent workspace may contain unrelated changes that must not be modified or reverted.

## Current Commands

- `npm run build`: compile the TypeScript project.
- `npm run dev`: start the React graph viewer at `http://127.0.0.1:5173`.
- `npm run dev:api`: start the sample Express API.
- `npm run prisma:generate`: generate Prisma Client.
- `npm run db:push`: sync the local SQLite schema.
- `npm run db:seed`: seed deterministic demo orders.
- `npm run analyze:order`: generate the first static graph at `graph-output/order-confirm.graph.json`.
  This also generates `graph-output/order-confirm.sources.json` for source preview.
- `python -m compileall packages\python\reviewflow_trace`: check the Python trace SDK syntax.

## Current UI Features

- Graph filters for all nodes, writes, errors, and external calls.
- Clickable graph nodes with source location details.
- Source preview snippets with highlighted source lines.
- Selected-path highlighting and unrelated node/edge dimming.
- Replay controls for analyzer-generated steps: play, pause, previous, next, reset, and scrub.
- Data movement demo table showing business records before/after each replay stage.
- Local review assistant output for selected nodes: summary, risks, focused tests, and checklist.
- AWS Trace mode using `samples/aws-batch-trace/example.trace.json`.
- PostgreSQL state projection sheet for AWS batch traces.
- AWS side-effect timeline for S3, EventBridge, Step Functions, and Lambda calls.
- Local Ruby/Oracle legacy trace loading and field-level migration comparison.

## Company Machine AWS Batch Trial

On the company machine, start with one Lambda or Glue execution. ReviewFlow can run as a local-only observer; it does not need to be deployed into AWS.

1. Clone this repository.
2. Add `packages/python` to `PYTHONPATH` or copy `packages/python/reviewflow_trace` into the target Python job.
3. Set `REVIEWFLOW_TRACE_FILE` to a local JSON path.
4. Wrap the Lambda handler with `@lambda_trace(...)`.
5. Wrap psycopg connections with `wrap_connection(...)`.
6. Wrap boto3 clients with `wrap_boto3_client(...)`.
7. Run one local or dev test execution.
8. Open ReviewFlow locally, click `AWS Trace`, and choose the generated JSON through `Load Python/AWS JSON`.
9. Optionally choose a Ruby/Oracle trace through `Load Ruby/Oracle JSON` to compare old and new behavior.

See [docs/local-observer-mode.md](docs/local-observer-mode.md), [docs/migration-compare-mode.md](docs/migration-compare-mode.md), [docs/aws-batch-migration-quickstart.md](docs/aws-batch-migration-quickstart.md), [docs/aws-batch-trace-schema.md](docs/aws-batch-trace-schema.md), and [docs/ruby-oracle-trace-schema.md](docs/ruby-oracle-trace-schema.md).
