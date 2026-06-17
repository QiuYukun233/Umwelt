from __future__ import annotations

import time
from typing import Any, Callable, Optional

from .core import current_recorder, sanitize_value


METHOD_EVENT_TYPES = {
    ("s3", "get_object"): "s3.read",
    ("s3", "put_object"): "s3.write",
    ("s3", "copy_object"): "s3.write",
    ("stepfunctions", "start_execution"): "stepfunctions.start_execution",
    ("stepfunctions", "send_task_success"): "stepfunctions.task",
    ("stepfunctions", "send_task_failure"): "stepfunctions.task",
    ("events", "put_events"): "eventbridge.event",
    ("lambda", "invoke"): "lambda.invoke_external",
}


class ReviewFlowBoto3Client:
    def __init__(self, client: Any, service_name: Optional[str] = None):
        self._client = client
        self._service_name = service_name or infer_service_name(client)

    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self._client, name)
        if not callable(attribute):
            return attribute
        return self._wrap_call(name, attribute)

    def _wrap_call(self, method_name: str, method: Callable[..., Any]) -> Callable[..., Any]:
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            recorder = current_recorder()
            event_type = METHOD_EVENT_TYPES.get((self._service_name, method_name), f"aws.{self._service_name}.{method_name}")
            start = time.perf_counter()
            if recorder:
                recorder.event(
                    event_type,
                    f"{self._service_name}.{method_name}",
                    phase="start",
                    resource=resource_hint(self._service_name, method_name, kwargs),
                    request=sanitize_request(self._service_name, method_name, kwargs),
                )
            try:
                result = method(*args, **kwargs)
            except Exception as error:
                if recorder:
                    recorder.event(
                        "exception.throw",
                        f"AWS {self._service_name}.{method_name} failed: {type(error).__name__}",
                        resource=resource_hint(self._service_name, method_name, kwargs),
                    )
                raise
            if recorder:
                recorder.event(
                    event_type,
                    f"{self._service_name}.{method_name}",
                    phase="end",
                    elapsedMs=round((time.perf_counter() - start) * 1000, 2),
                    resource=resource_hint(self._service_name, method_name, kwargs),
                    response=sanitize_response(result),
                )
            return result

        return wrapped


def wrap_boto3_client(client: Any, service_name: Optional[str] = None) -> ReviewFlowBoto3Client:
    return ReviewFlowBoto3Client(client, service_name=service_name)


def infer_service_name(client: Any) -> str:
    meta = getattr(client, "meta", None)
    service_model = getattr(meta, "service_model", None)
    service_name = getattr(service_model, "service_name", None)
    if service_name:
        return str(service_name)
    return "aws"


def resource_hint(service_name: str, method_name: str, kwargs: dict[str, Any]) -> dict[str, Any]:
    if service_name == "s3":
        return {"bucket": kwargs.get("Bucket"), "key": kwargs.get("Key")}
    if service_name == "stepfunctions":
        return {
            "stateMachineArn": kwargs.get("stateMachineArn"),
            "executionArn": kwargs.get("executionArn"),
            "taskToken": bool(kwargs.get("taskToken")),
        }
    if service_name == "events":
        entries = kwargs.get("Entries") or []
        return {"entryCount": len(entries) if isinstance(entries, list) else None}
    if service_name == "lambda":
        return {"functionName": kwargs.get("FunctionName"), "invocationType": kwargs.get("InvocationType")}
    return {"method": method_name}


def sanitize_request(service_name: str, method_name: str, kwargs: dict[str, Any]) -> dict[str, Any]:
    safe = dict(kwargs)
    for key in ("Body", "Payload", "Input", "Detail", "SecretString"):
        if key in safe:
            safe[key] = payload_summary(safe[key])
    return sanitize_value(safe)


def sanitize_response(result: Any) -> Any:
    if isinstance(result, dict):
        safe = {}
        for key, value in result.items():
            if key in ("Body", "Payload"):
                safe[key] = payload_summary(value)
            else:
                safe[key] = sanitize_value(value)
        return safe
    return sanitize_value(result)


def payload_summary(value: Any) -> dict[str, Any]:
    try:
        length = len(value)
    except TypeError:
        length = None
    return {"type": type(value).__name__, "length": length}
