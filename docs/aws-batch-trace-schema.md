# AWS Batch Trace Schema

ReviewFlow AWS Batch Trace is a runtime evidence format for stateless Python jobs that run through Lambda, Glue, S3, Step Functions, EventBridge, and PostgreSQL.

The goal is not to reproduce every local variable. The goal is to capture reviewable business behavior:

- Which execution ran.
- Which AWS resources were touched.
- Which SQL statements read or wrote PostgreSQL tables.
- Which table cells changed from before to after.
- Which side effects happened before or after database writes.
- Which evidence is observed, approximate, or unknown.

## Top-Level Shape

```json
{
  "schemaVersion": "reviewflow.awsBatchTrace.v0.1",
  "execution": {
    "id": "rf-exec-20260617-001",
    "name": "customer-status-migration",
    "kind": "lambda",
    "status": "success",
    "startedAt": "2026-06-17T10:00:00.000Z",
    "endedAt": "2026-06-17T10:00:07.000Z",
    "input": {
      "eventSource": "aws.s3",
      "s3": "s3://reviewflow-input/customers/status_20260617.csv"
    }
  },
  "resources": [],
  "events": [],
  "stateProjections": []
}
```

## Event Types

Minimum supported event names:

- `execution.start`
- `execution.end`
- `lambda.invoke`
- `glue.job.start`
- `eventbridge.event`
- `s3.read`
- `s3.write`
- `stepfunctions.start_execution`
- `stepfunctions.task`
- `lambda.invoke_external`
- `db.query`
- `db.read`
- `db.write`
- `transaction.begin`
- `transaction.commit`
- `transaction.rollback`
- `exception.throw`

## State Projection

State projections drive the spreadsheet-style review view.

```json
{
  "id": "projection.customers.1001.status",
  "eventId": "event.db.write.customers",
  "table": "customers",
  "record": "customer_id=1001",
  "field": "status",
  "before": "A",
  "patch": "A -> active",
  "after": "active",
  "certainty": "observed",
  "source": {
    "eventId": "event.db.write.customers",
    "sqlSummary": "UPDATE customers SET status = $1 WHERE customer_id = $2"
  }
}
```

Certainty values:

- `observed`: captured from runtime trace or database before/after snapshot.
- `exact_static`: source-backed static extraction, but not runtime-confirmed.
- `approximate`: table/entity is known, but exact field patch needs review.
- `unknown`: ReviewFlow cannot safely infer this value.

## Sanitization Rules

Do not write raw secrets, personal data, tokens, or full payloads into trace files.

Recommended defaults:

- Keep SQL text normalized and parameter placeholders intact.
- Store parameter shape or hash, not raw values.
- Keep S3 bucket/key only when company policy allows it.
- Redact EventBridge detail payloads unless explicitly approved.
- Store row counts and field names; store sample values only in controlled test runs.

## Migration Review Mapping

For Ruby + Oracle to Python + PostgreSQL migration review, add a mapping file later:

```json
{
  "legacy": "CUSTOMER.STATUS_CD",
  "target": "customers.status",
  "valueMap": {
    "A": "active",
    "C": "confirmed"
  }
}
```

This lets ReviewFlow compare old and new traces without pretending that table and field names are identical.
