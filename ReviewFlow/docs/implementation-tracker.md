# Implementation Tracker

## Current Status

Phase 6 scaffold is in progress. The project now has the original Node/Prisma demo plus an AWS Batch Trace sample mode for Python + psycopg + boto3 migration review.

## Phase 0: Sample Project Definition

- Status: Complete
- Goal: Create a small Node/Prisma CRUD demo with 3-5 models and representative business behavior.
- Acceptance criteria:
  - Done: Demo contains at least one success path.
  - Done: Demo contains validation or permission failure.
  - Done: Demo contains one simulated domain error.
  - Done: Demo contains one external mock API or side effect.
  - Done: Imported starter is treated as reference material rather than carried forward as a broad production boilerplate.
  - Done: Dependencies installed and TypeScript build passes.
  - Done: Prisma Client generation, SQLite schema push, and seed run successfully.
  - Done: Success path and insufficient-inventory error path were verified through the HTTP API.

## Phase 1: Minimal Static Graph Extraction

- Status: Complete
- Goal: Given an endpoint, extract entrypoint, call flow, Prisma reads/writes, branches, and exceptions into JSON.
- Acceptance criteria:
  - Done: Extracts `POST /orders/:orderId/confirm`.
  - Done: Resolves same-repo explicit imports across route, controller, service, repository, and external-call layers.
  - Done: Identifies Prisma operations at model/table level.
  - Done: Emits source locations for extracted graph items.
  - Done: Writes graph JSON to `graph-output/order-confirm.graph.json`.
  - Done: Writes source preview manifest to `graph-output/order-confirm.sources.json`.

## Phase 2: Frontend Graph Display

- Status: Complete
- Goal: Render the graph in a React UI with useful review interactions.
- Acceptance criteria:
  - Done: Shows nodes and edges for entries, functions, transactions, tables, branches, exceptions, and side effects.
  - Done: Supports selecting a node to inspect details.
  - Done: Supports filters for writes, errors, and external calls.
  - Done: Phase 2.1 improves layout readability, selected-path highlighting, unrelated edge muting, node text handling, and grouped edge details.
  - Done: Shows source preview snippets for selected nodes with highlighted source lines.
  - Caveat: Browser tool automation still fails to initialize through node_repl in the current Windows sandbox, but the user confirmed the screenshot visually and HTTP checks pass.

## Phase 3: Replay Mode

- Status: Complete
- Goal: Replay static or runtime trace steps through the graph.
- Acceptance criteria:
  - Done: Uses the analyzer-generated `steps` array from `graph-output/order-confirm.graph.json`.
  - Done: Supports step forward/back, play/pause, reset, and slider scrubbing.
  - Done: Highlights the active node and edge for the current step.
  - Done: Colors failed and risky replay steps distinctly.
  - Done: Shows a demonstrable data movement table that updates as replay steps advance.
  - Deferred: Runtime trace execution and rollback animation remain future work.

## Phase 4: AI Review Assistant

- Status: Complete
- Goal: Explain selected graph regions and generate review guidance.
- Acceptance criteria:
  - Done: Summarizes selected graph nodes and connected path context.
  - Done: Flags likely review risks for writes, branches, exceptions, transactions, and external calls.
  - Done: Suggests focused tests for selected graph areas.
  - Done: Produces a review checklist for the selected node/path.
  - Note: This is a deterministic local assistant, not an external LLM integration yet.

## Phase 5: Operation Ledger and Evidence Model

- Status: Complete
- Goal: Make review faster and more honest by moving from graph-first inspection toward source-backed storyboard review.
- Acceptance criteria:
  - Done: Adds four-dimensional certainty metadata for reachability, entity identity, field patch, and source anchor.
  - Done: Adds evidence refs for source anchors and static extraction rules.
  - Done: Marks static-only field patches as approximate instead of pretending they are exact.
  - Done: Adds an Operation Ledger that lets reviewers scan and select behavior steps before using the graph.
  - Done: Upgrades the data movement table to `before / patch / after`.
  - Done: Adds right-side Evidence details with certainty dimensions and degrade reasons.
  - Deferred: Runtime trace observations are not attached yet, so no behavior is marked `observed`.

## Phase 6: AWS Batch Migration Trace Mode

- Status: Scaffold Complete
- Goal: Make ReviewFlow usable for Python AWS stateless batch migration projects without requiring local access to the company codebase.
- Acceptance criteria:
  - Done: Documents AWS batch trace schema for Lambda, Glue, S3, Step Functions, EventBridge, Lambda side effects, and PostgreSQL.
  - Done: Adds company-machine quickstart for Python + psycopg + boto3 trace capture.
  - Done: Adds a dependency-light Python trace SDK skeleton under `packages/python/reviewflow_trace`.
  - Done: Adds psycopg connection/cursor wrappers for SQL event capture.
  - Done: Adds boto3 client wrapper for S3, Step Functions, EventBridge, and Lambda calls.
  - Done: Adds sample AWS batch trace JSON under `samples/aws-batch-trace`.
  - Done: Adds an AWS Trace UI mode with execution timeline, PostgreSQL state projection sheet, side effects, and collapsible details.
  - Done: Adds Ruby/Oracle legacy trace schema and sample trace for local comparison.
  - Done: Adds a minimal Ruby legacy trace recorder skeleton for local/manual instrumentation.
  - Done: Adds UI loading for one local Python/AWS trace and one local Ruby/Oracle trace.
  - Done: Adds migration comparison table for mapped Oracle cells versus PostgreSQL cells.
  - Deferred: Drag-and-drop trace library and saved trace history.
  - Deferred: Persisted trace library and multi-run comparison.
  - Deferred: Automatic before/after DB value capture beyond explicit state projections.
