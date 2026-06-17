# Local Observer Mode

ReviewFlow can be used as a local-only observer.

In this mode:

- ReviewFlow is not deployed to AWS.
- Trace JSON is not uploaded to S3, a server, or any external service.
- The Python job writes a local JSON file through `REVIEWFLOW_TRACE_FILE`.
- The Ruby/Oracle job can write a local JSON file through `REVIEWFLOW_LEGACY_TRACE_FILE`.
- The React UI reads that JSON through the browser file picker.
- The trace exists only on the company machine unless you intentionally move it.

## Recommended Company Setup

Use a local or test execution environment:

```powershell
$env:PYTHONPATH="D:\tools\ReviewFlow\packages\python;$env:PYTHONPATH"
$env:REVIEWFLOW_TRACE_FILE="D:\tmp\reviewflow\customer-status.trace.json"
```

Run one Lambda handler locally, one Glue job locally, or one test execution wrapper.

Then start ReviewFlow locally:

```powershell
cd D:\tools\ReviewFlow
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Click `AWS Trace`, then `Load Trace JSON`, and choose:

```text
D:\tmp\reviewflow\customer-status.trace.json
```

To compare against Ruby/Oracle, also click `Load Ruby/Oracle JSON` and choose:

```text
D:\tmp\reviewflow\customer-status.legacy.trace.json
```

## Data Boundary

The browser uses the standard local File API. Selecting a JSON file does not upload it anywhere by itself.

Still treat trace files as sensitive:

- Put them under an approved local work directory.
- Do not commit real traces.
- Do not attach real traces to tickets or chat unless approved.
- Keep payloads sanitized.
- Prefer test data or masked data for first trials.

## Runtime Placement

Do not install ReviewFlow into production Lambda layers for the first trial.

Safer first options:

- Run the Lambda handler locally with a captured event.
- Run the Glue script locally against a test database.
- Run in a company-approved dev account with trace output written to local disk or CloudWatch logs copied locally.
- Use masked fixture inputs.

## Current Limitation

The current UI imports one Python/AWS trace and one Ruby/Oracle trace at a time through file pickers. It does not yet persist a trace library.
