# Ruby Oracle Trace Schema

ReviewFlow legacy Oracle trace is a local JSON format for observing old Ruby + Oracle behavior during migration review.

It is designed for local comparison against `reviewflow.awsBatchTrace.v0.1`.

The first useful question is:

```text
For the same input, did Ruby/Oracle and Python/PostgreSQL/AWS produce equivalent table changes and side effects?
```

## Top-Level Shape

```json
{
  "schemaVersion": "reviewflow.rubyOracleTrace.v0.1",
  "execution": {
    "id": "legacy-exec-001",
    "name": "customer-status-migration",
    "kind": "ruby-batch",
    "status": "success",
    "startedAt": "2026-06-17T09:58:00.000Z",
    "endedAt": "2026-06-17T09:58:04.000Z",
    "input": {
      "sourceFile": "customers/status_20260617.csv"
    }
  },
  "events": [],
  "stateProjections": []
}
```

## Event Types

Minimum event names:

- `execution.start`
- `execution.end`
- `oracle.query`
- `oracle.read`
- `oracle.write`
- `transaction.begin`
- `transaction.commit`
- `transaction.rollback`
- `ruby.method`
- `exception.throw`
- `file.read`
- `file.write`

## State Projection

```json
{
  "id": "legacy.customer.1001.status_cd",
  "eventId": "legacy.event.0004",
  "table": "CUSTOMER",
  "record": "CUSTOMER_ID=1001",
  "field": "STATUS_CD",
  "before": "A",
  "patch": "kept A",
  "after": "A",
  "certainty": "observed",
  "target": {
    "table": "customers",
    "field": "status",
    "value": "active"
  },
  "source": {
    "sqlSummary": "UPDATE CUSTOMER SET STATUS_CD = :1 WHERE CUSTOMER_ID = :2"
  }
}
```

`target.value` is optional but useful. It stores the mapped PostgreSQL meaning of the legacy value. Example: Oracle `A` maps to PostgreSQL `active`.

## Local-Only Use

The trace can be produced by:

- a lightweight Ruby wrapper,
- parsing existing Oracle SQL logs,
- manually summarizing one execution,
- or exporting from a test harness.

Do not commit real trace files. Keep them under an approved local work directory.
