# Runtime Trace Events

Runtime traces should color and verify the static graph. Static analysis shows possible paths; runtime events show observed paths.

## Event Envelope

```json
{
  "traceId": "trace_01HY...",
  "requestId": "req_01HY...",
  "timestamp": "2026-06-05T00:00:00.000Z",
  "event": "db.write",
  "status": "ok",
  "data": {}
}
```

Required fields:

- `traceId`
- `timestamp`
- `event`
- `status`
- `data`

Optional fields:

- `requestId`
- `source`
- `durationMs`
- `correlation`

## Initial Event Types

### `request.start`

Marks the beginning of an endpoint execution.

```json
{
  "event": "request.start",
  "status": "ok",
  "data": {
    "method": "POST",
    "path": "/orders/confirm"
  }
}
```

### `request.end`

Marks request completion.

```json
{
  "event": "request.end",
  "status": "ok",
  "data": {
    "statusCode": 200
  }
}
```

### `db.read`

Records a database read.

```json
{
  "event": "db.read",
  "status": "ok",
  "data": {
    "model": "Order",
    "operation": "findUnique"
  }
}
```

### `db.write`

Records a database write.

```json
{
  "event": "db.write",
  "status": "ok",
  "data": {
    "model": "Inventory",
    "operation": "update"
  }
}
```

### `branch.hit`

Records that a branch or guard condition was evaluated and which path was taken.

```json
{
  "event": "branch.hit",
  "status": "ok",
  "data": {
    "conditionId": "condition.stockAvailable",
    "result": false
  }
}
```

### `exception.throw`

Records an exception path.

```json
{
  "event": "exception.throw",
  "status": "failed",
  "data": {
    "name": "InsufficientStockError",
    "message": "Not enough inventory"
  }
}
```

### `external.call`

Records an external service or side effect.

```json
{
  "event": "external.call",
  "status": "ok",
  "data": {
    "kind": "http",
    "target": "payment-api",
    "operation": "POST /charges"
  }
}
```

### `transaction.start`

Records a transaction boundary start.

```json
{
  "event": "transaction.start",
  "status": "ok",
  "data": {
    "label": "confirm order transaction"
  }
}
```

### `transaction.rollback`

Records rollback behavior when available.

```json
{
  "event": "transaction.rollback",
  "status": "failed",
  "data": {
    "reason": "InsufficientStockError"
  }
}
```

## Runtime Coloring

- Gray: statically possible but not observed.
- Green: observed and successful.
- Yellow: observed side effect or risky operation.
- Red: failed path, exception, rollback, or rejected request.
