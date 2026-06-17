from __future__ import annotations

import contextlib
import contextvars
import json
import os
import time
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, Optional


_current_recorder: contextvars.ContextVar[Optional["TraceRecorder"]] = contextvars.ContextVar(
    "reviewflow_current_recorder",
    default=None,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sanitize_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value

    if isinstance(value, str):
        if len(value) <= 120:
            return value
        return f"{value[:117]}..."

    if isinstance(value, (list, tuple)):
        return {"type": type(value).__name__, "length": len(value)}

    if isinstance(value, dict):
        safe: Dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            lowered = key_text.lower()
            if any(token in lowered for token in ("password", "secret", "token", "credential")):
                safe[key_text] = "[redacted]"
            else:
                safe[key_text] = sanitize_value(item)
        return safe

    return type(value).__name__


@dataclass
class TraceRecorder:
    name: str
    kind: str = "batch"
    execution_id: str = field(default_factory=lambda: f"rf-exec-{uuid.uuid4().hex[:12]}")
    output_file: Optional[str] = None
    input_summary: Dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    state_projections: list[dict[str, Any]] = field(default_factory=list)
    resources: dict[str, dict[str, Any]] = field(default_factory=dict)
    status: str = "running"
    started_at: str = field(default_factory=utc_now)
    ended_at: Optional[str] = None

    def add_resource(self, resource_id: str, resource_type: str, label: str, **details: Any) -> None:
        self.resources[resource_id] = {
            "id": resource_id,
            "type": resource_type,
            "label": label,
            "details": sanitize_value(details),
        }

    def event(self, event_type: str, label: str, **details: Any) -> dict[str, Any]:
        event = {
            "id": f"event.{len(self.events) + 1:04d}",
            "type": event_type,
            "timestamp": utc_now(),
            "label": label,
            "details": sanitize_value(details),
        }
        self.events.append(event)
        return event

    def projection(
        self,
        event_id: str,
        table: str,
        record: str,
        field_name: str,
        before: Any,
        patch: Any,
        after: Any,
        certainty: str = "approximate",
        **source: Any,
    ) -> dict[str, Any]:
        item = {
            "id": f"projection.{table}.{record}.{field_name}.{len(self.state_projections) + 1}",
            "eventId": event_id,
            "table": table,
            "record": record,
            "field": field_name,
            "before": sanitize_value(before),
            "patch": sanitize_value(patch),
            "after": sanitize_value(after),
            "certainty": certainty,
            "source": sanitize_value(source),
        }
        self.state_projections.append(item)
        return item

    def finish(self, status: str = "success") -> None:
        self.status = status
        self.ended_at = utc_now()
        self.event("execution.end", f"{self.name} ended", status=status)
        self.flush()

    def flush(self) -> None:
        output_file = self.output_file or os.environ.get("REVIEWFLOW_TRACE_FILE")
        if not output_file:
            return

        payload = self.to_dict()
        path = Path(output_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": "reviewflow.awsBatchTrace.v0.1",
            "execution": {
                "id": self.execution_id,
                "name": self.name,
                "kind": self.kind,
                "status": self.status,
                "startedAt": self.started_at,
                "endedAt": self.ended_at,
                "input": self.input_summary,
            },
            "resources": list(self.resources.values()),
            "events": self.events,
            "stateProjections": self.state_projections,
        }


def current_recorder() -> Optional[TraceRecorder]:
    return _current_recorder.get()


def record_event(event_type: str, label: str, **details: Any) -> Optional[dict[str, Any]]:
    recorder = current_recorder()
    if recorder is None:
        return None
    return recorder.event(event_type, label, **details)


@contextlib.contextmanager
def trace_execution(
    name: str,
    kind: str = "batch",
    input_summary: Optional[dict[str, Any]] = None,
    output_file: Optional[str] = None,
) -> Iterator[TraceRecorder]:
    recorder = TraceRecorder(name=name, kind=kind, output_file=output_file, input_summary=input_summary or {})
    token = _current_recorder.set(recorder)
    recorder.event("execution.start", f"{name} started", input=recorder.input_summary)
    start = time.perf_counter()
    try:
        yield recorder
    except Exception as error:
        recorder.event(
            "exception.throw",
            f"{type(error).__name__}: {error}",
            traceback=traceback.format_exc(limit=8),
        )
        recorder.status = "failed"
        recorder.ended_at = utc_now()
        recorder.flush()
        raise
    else:
        recorder.event("execution.duration", f"{name} duration", elapsedMs=round((time.perf_counter() - start) * 1000, 2))
        recorder.finish("success")
    finally:
        _current_recorder.reset(token)


def lambda_trace(name: Optional[str] = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def decorator(handler: Callable[..., Any]) -> Callable[..., Any]:
        trace_name = name or handler.__name__

        def wrapper(event: Any, context: Any) -> Any:
            request_id = getattr(context, "aws_request_id", None)
            input_summary = {
                "awsRequestId": request_id,
                "event": sanitize_value(event),
            }
            with trace_execution(trace_name, kind="lambda", input_summary=input_summary) as recorder:
                recorder.event("lambda.invoke", trace_name, awsRequestId=request_id)
                return handler(event, context)

        return wrapper

    return decorator
