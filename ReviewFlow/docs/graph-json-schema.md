# Graph JSON Schema Notes

This document defines the minimum graph shape for the first ReviewFlow prototype. It is a product/schema note, not a formal JSON Schema file yet.

## Top-Level Shape

```json
{
  "schemaVersion": "0.1",
  "entry": {
    "id": "api.confirmOrder",
    "label": "POST /orders/confirm",
    "source": {
      "file": "src/api/orders.ts",
      "line": 12,
      "symbol": "confirmOrder"
    }
  },
  "nodes": [],
  "edges": [],
  "steps": []
}
```

## Source Location

Source locations make the graph reviewable and trustworthy.

```json
{
  "file": "src/services/orders.ts",
  "line": 44,
  "column": 5,
  "symbol": "confirmOrderService"
}
```

Required fields:

- `file`
- `line`

Optional fields:

- `column`
- `symbol`

## Node Types

Supported initial node types:

- `entry`: API route, controller method, function, or use case entry.
- `function`: internal controller/service/repository function.
- `table`: Prisma model or database table.
- `condition`: branch, guard, validation, permission check, or domain rule.
- `exception`: thrown error or returned error path.
- `external`: external API, queue, email, notification, file, or other side effect.
- `transaction`: transaction boundary or logical unit of work.

Example:

```json
{
  "id": "table.orders",
  "type": "table",
  "label": "orders",
  "operations": ["read", "update"],
  "source": {
    "file": "src/repositories/orders.ts",
    "line": 18
  }
}
```

## Edge Operations

Supported initial edge operations:

- `call`
- `read`
- `create`
- `update`
- `delete`
- `upsert`
- `branch`
- `throw`
- `return_error`
- `external_call`
- `transaction_enter`
- `transaction_exit`

Example:

```json
{
  "id": "edge.confirmOrder.orders.read",
  "from": "api.confirmOrder",
  "to": "table.orders",
  "operation": "read",
  "source": {
    "file": "src/repositories/orders.ts",
    "line": 18
  }
}
```

## Conditions and Exceptions

Condition nodes should preserve the human-readable expression when available.

```json
{
  "id": "condition.stockAvailable",
  "type": "condition",
  "label": "inventory.quantity >= order.quantity",
  "source": {
    "file": "src/services/orders.ts",
    "line": 44
  }
}
```

Exception nodes should include the thrown or returned error name/message when available.

```json
{
  "id": "exception.insufficientStock",
  "type": "exception",
  "label": "InsufficientStockError",
  "source": {
    "file": "src/services/orders.ts",
    "line": 45
  }
}
```

## Replay Steps

Replay steps can be generated from static order first, then enriched by runtime traces.

```json
{
  "id": "step.003",
  "kind": "db.write",
  "nodeId": "table.inventory",
  "edgeId": "edge.confirmOrder.inventory.update",
  "status": "possible",
  "label": "Update inventory",
  "source": {
    "file": "src/repositories/inventory.ts",
    "line": 29
  }
}
```

Initial step statuses:

- `possible`: statically detected but not tied to a runtime trace.
- `executed`: observed in runtime trace.
- `risky`: side effect or operation requiring reviewer attention.
- `failed`: error or exception path.
