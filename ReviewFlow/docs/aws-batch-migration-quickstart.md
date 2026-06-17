# AWS Batch Migration Quickstart

This guide is for using ReviewFlow on a company machine where the real project lives. The recommended first setup is local-only: generate a trace JSON on disk, then load it in the ReviewFlow browser UI.

Target stack:

- Python Lambda or Glue jobs
- PostgreSQL through `psycopg`
- AWS services through `boto3`
- S3, Step Functions, EventBridge, and Lambda side effects
- Legacy comparison later: Ruby + Oracle

## 1. Install ReviewFlow Locally

Clone the ReviewFlow repository on the company machine.

```powershell
git clone <your-reviewflow-repo-url>
cd ReviewFlow
npm install
npm run build
```

The Python trace SDK is intentionally dependency-light and lives in:

```text
packages/python/reviewflow_trace
```

For a first trial, copy `packages/python/reviewflow_trace` into the Python job repository or add `packages/python` to `PYTHONPATH`.

## 2. Pick One Review Unit

Do not start with the whole batch estate.

Pick one execution:

- one Lambda handler
- one Glue job
- one Step Functions execution branch
- one EventBridge-triggered batch
- one S3-file-driven import

## 3. Enable Trace Output

Set an output path before running a local or test execution.

```powershell
$env:REVIEWFLOW_TRACE_FILE="D:\tmp\reviewflow-trace.json"
```

On Linux/macOS:

```bash
export REVIEWFLOW_TRACE_FILE=/tmp/reviewflow-trace.json
```

## 4. Wrap Lambda

```python
from reviewflow_trace import lambda_trace

@lambda_trace(name="customer-status-migration")
def handler(event, context):
    ...
```

## 5. Wrap psycopg

```python
import psycopg
from reviewflow_trace import wrap_connection

conn = psycopg.connect(...)
conn = wrap_connection(conn)

with conn.cursor() as cur:
    cur.execute("update customers set status = %s where customer_id = %s", ("active", 1001))
conn.commit()
```

The wrapper records SQL operation type, table hints, row counts, commit/rollback, and errors. It does not store raw parameters by default.

## 6. Wrap boto3 Clients

```python
import boto3
from reviewflow_trace import wrap_boto3_client

s3 = wrap_boto3_client(boto3.client("s3"))
sfn = wrap_boto3_client(boto3.client("stepfunctions"))
events = wrap_boto3_client(boto3.client("events"))

s3.get_object(Bucket="input-bucket", Key="customers.csv")
sfn.start_execution(stateMachineArn="...", input="{}")
events.put_events(Entries=[...])
```

## 7. Open Trace in ReviewFlow Locally

```powershell
npm run dev
```

Open `http://127.0.0.1:5173`, click `AWS Trace`, then click `Load Trace JSON`.

Choose:

```text
D:\tmp\reviewflow-trace.json
```

The browser reads the file locally. ReviewFlow does not upload it.

The first company-machine trial can also compare your real JSON to:

```text
samples/aws-batch-trace/example.trace.json
```

## 8. Migration Review Sequence

For Ruby + Oracle to Python + PostgreSQL migration, use this sequence:

1. Capture one Python/PostgreSQL/AWS execution trace.
2. Confirm ReviewFlow shows DB writes and side effects in the right order.
3. Add a hand-made legacy mapping for the same use case.
4. Import old Ruby/Oracle SQL logs or a manually summarized legacy trace.
5. Compare state projections field by field.

The important review question is:

```text
For the same input, did the new Python/AWS/PostgreSQL job produce equivalent table changes and side effects?
```
