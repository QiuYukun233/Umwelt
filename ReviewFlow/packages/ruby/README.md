# reviewflow_trace for Ruby

Minimal local trace recorder for legacy Ruby + Oracle migration comparison.

This is intentionally framework-light. It does not require Rails, OCI8, or ActiveRecord.

## Basic Use

```ruby
require_relative "reviewflow_trace/reviewflow_trace"

ENV["REVIEWFLOW_LEGACY_TRACE_FILE"] = "D:/tmp/reviewflow/customer-status.legacy.trace.json"

ReviewFlowTrace.trace(name: "customer-status-migration", input: { sourceFile: "customers.csv" }) do |rf|
  read = rf.record_sql(
    "SELECT CUSTOMER_ID, STATUS_CD FROM CUSTOMER WHERE CUSTOMER_ID = :1",
    rowcount: 1
  )

  write = rf.record_sql(
    "UPDATE CUSTOMER SET STATUS_CD = :1 WHERE CUSTOMER_ID = :2",
    rowcount: 1
  )

  rf.projection(
    event_id: write[:id],
    table: "CUSTOMER",
    record: "CUSTOMER_ID=1001",
    field: "STATUS_CD",
    before: "A",
    patch: "kept A",
    after: "A",
    target: {
      table: "customers",
      field: "status",
      value: "active"
    },
    source: {
      sqlSummary: "UPDATE CUSTOMER SET STATUS_CD = :1 WHERE CUSTOMER_ID = :2"
    }
  )
end
```

Then open ReviewFlow locally, click `AWS Trace`, and load this file with `Load Ruby/Oracle JSON`.

## First Trial

For the first migration review, it is fine to manually add projections around one critical old-system write. The goal is to compare business behavior, not to instrument the entire legacy application on day one.
