# Decision Log

## DEC-001: Use Node.js + Prisma as the First Analyzer Target

- Date: 2026-06-05
- Status: Accepted

### Decision

The MVP will target Node.js backend code that uses Prisma for database access.

### Rationale

Prisma calls are structured enough for early static extraction. Calls such as `prisma.order.findUnique`, `prisma.inventory.update`, and `prisma.paymentLog.create` expose model names and operations more directly than many dynamic ORM or raw SQL patterns.

Using Node also keeps the eventual React frontend and analyzer tooling close together.

### Consequences

- Initial graph extraction can focus on Prisma model-level read/write operations.
- Python SQLAlchemy and Java JPA support are out of scope for the first prototype.
- Raw SQL and highly dynamic access patterns should be tracked as known limitations.

## DEC-002: Prioritize Table-Level Dataflow Before Field-Level Precision

- Date: 2026-06-05
- Status: Accepted

### Decision

The first extractor should identify table/model-level reads and writes before attempting perfect field-level tracking.

### Rationale

Table-level behavior is already valuable for AI coding review, onboarding, and impact analysis. Field-level precision is harder and can be layered on after source-linked graph trust is established.

### Consequences

- Field changes may be shown only when confidently inferred.
- Unknown or partial field inference should be marked explicitly instead of guessed.

## DEC-003: Require Source Locations for Trust

- Date: 2026-06-05
- Status: Accepted

### Decision

Graph nodes, edges, branches, exceptions, and side effects that come from source code should include `file`, `line`, and optional symbol/function metadata where possible.

### Rationale

Reviewers need to jump from graph behavior back to code. Without source locations, the graph risks feeling like a decorative summary instead of a review artifact.

### Consequences

- Graph JSON schema must include source location fields.
- UI design should reserve interaction affordances for source jumps or code references.

## DEC-004: Import an Express + Prisma Starter as a Reference, Not a Final App

- Date: 2026-06-05
- Status: Accepted

### Decision

Use `antonio-lazaro/prisma-express-typescript-boilerplate` as a local reference starter under `templates/prisma-express-typescript-boilerplate`.

### Rationale

The project is a public GitHub template for Node.js, TypeScript, Express, and Prisma. It has a familiar backend structure with routes, controllers, services, Prisma schema, and tests, which makes it useful for shaping Phase 0.

### Consequences

- The imported template should be treated as source material, not the final ReviewFlow app.
- Auth, Swagger, PM2, Docker, and broad production boilerplate should be removed or ignored unless they directly help the demo.
- The actual Phase 0 demo should stay focused on the order confirmation dataflow scenario.
