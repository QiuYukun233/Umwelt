# Migration Compare Mode

Migration Compare Mode loads two local trace files:

1. New system trace: Python + AWS + PostgreSQL
2. Legacy trace: Ruby + Oracle

Both are loaded through browser file pickers. ReviewFlow does not upload either file.

## File Inputs

New system:

```text
reviewflow.awsBatchTrace.v0.1
```

Legacy system:

```text
reviewflow.rubyOracleTrace.v0.1
```

## How Comparison Works

ReviewFlow compares state projections.

New PostgreSQL projection:

```json
{
  "table": "customers",
  "field": "status",
  "after": "active",
  "legacy": {
    "table": "CUSTOMER",
    "field": "STATUS_CD",
    "value": "A"
  }
}
```

Legacy Oracle projection:

```json
{
  "table": "CUSTOMER",
  "field": "STATUS_CD",
  "after": "A",
  "target": {
    "table": "customers",
    "field": "status",
    "value": "active"
  }
}
```

The comparison table uses `target.value` when present. This supports value mappings such as:

```text
Oracle A -> PostgreSQL active
Oracle C -> PostgreSQL confirmed
Oracle NULL -> PostgreSQL null
```

## First Trial Recommendation

Start with one business input:

- one S3 input file,
- one Lambda/Glue execution,
- one old Ruby/Oracle execution,
- one customer/order/account record.

Then inspect:

- missing legacy projection,
- missing target projection,
- value mismatch,
- new side effect not present in legacy,
- changed transaction order.

## Current Limits

- The UI compares fields that have explicit state projections.
- Automatic Ruby instrumentation is minimal; SQL logs or manual summaries may be faster for the first trial.
- Side-effect parity is shown separately for now; direct old/new side-effect diff is a later step.
