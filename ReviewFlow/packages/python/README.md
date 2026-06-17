# reviewflow_trace

Lightweight Python helpers for capturing ReviewFlow runtime evidence from AWS batch projects.

This package is intentionally small:

- no required runtime dependencies
- wraps existing `psycopg` connections by duck typing
- wraps existing `boto3` clients by duck typing
- writes a JSON trace to `REVIEWFLOW_TRACE_FILE`

## Lambda

```python
from reviewflow_trace import lambda_trace

@lambda_trace(name="customer-status-migration")
def handler(event, context):
    ...
```

## psycopg

```python
from reviewflow_trace import wrap_connection

conn = wrap_connection(conn)
with conn.cursor() as cur:
    cur.execute("update customers set status = %s where customer_id = %s", ("active", 1001))
conn.commit()
```

## boto3

```python
from reviewflow_trace import wrap_boto3_client

s3 = wrap_boto3_client(boto3.client("s3"))
s3.get_object(Bucket="bucket", Key="key.csv")
```

Trace values are sanitized by default. Do not enable raw payload capture unless your company data policy allows it.
