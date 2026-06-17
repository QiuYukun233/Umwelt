from __future__ import annotations

import re
import time
from typing import Any, Optional

from .core import current_recorder, sanitize_value


SQL_TABLE_PATTERNS = [
    re.compile(r"\bfrom\s+([a-zA-Z_][\w.]*)(?:\s|$)", re.IGNORECASE),
    re.compile(r"\bjoin\s+([a-zA-Z_][\w.]*)(?:\s|$)", re.IGNORECASE),
    re.compile(r"\bupdate\s+([a-zA-Z_][\w.]*)(?:\s|$)", re.IGNORECASE),
    re.compile(r"\binsert\s+into\s+([a-zA-Z_][\w.]*)(?:\s|$)", re.IGNORECASE),
    re.compile(r"\bdelete\s+from\s+([a-zA-Z_][\w.]*)(?:\s|$)", re.IGNORECASE),
    re.compile(r"\bcopy\s+([a-zA-Z_][\w.]*)(?:\s|$|\()", re.IGNORECASE),
]


def normalize_sql(sql: Any) -> str:
    text = str(sql)
    return " ".join(text.split())


def operation_for_sql(sql: str) -> str:
    lowered = sql.lstrip().lower()
    if lowered.startswith(("select", "with")):
        return "read"
    if lowered.startswith(("insert", "update", "delete", "merge", "copy")):
        return "write"
    if lowered.startswith(("begin", "start transaction")):
        return "transaction.begin"
    if lowered.startswith("commit"):
        return "transaction.commit"
    if lowered.startswith("rollback"):
        return "transaction.rollback"
    return "query"


def tables_for_sql(sql: str) -> list[str]:
    tables: list[str] = []
    for pattern in SQL_TABLE_PATTERNS:
        for match in pattern.finditer(sql):
            table = match.group(1).strip('"')
            if table not in tables:
                tables.append(table)
    return tables


class ReviewFlowCursor:
    def __init__(self, cursor: Any):
        self._cursor = cursor

    def execute(self, query: Any, params: Any = None, *args: Any, **kwargs: Any) -> Any:
        recorder = current_recorder()
        sql = normalize_sql(query)
        operation = operation_for_sql(sql)
        tables = tables_for_sql(sql)
        start = time.perf_counter()
        try:
            result = self._cursor.execute(query, params, *args, **kwargs)
        except Exception as error:
            if recorder:
                recorder.event(
                    "exception.throw",
                    f"PostgreSQL {type(error).__name__}",
                    sqlSummary=sql,
                    operation=operation,
                    tables=tables,
                )
            raise

        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        rowcount = getattr(self._cursor, "rowcount", None)
        if recorder:
            event_type = "db.query"
            if operation == "read":
                event_type = "db.read"
            elif operation == "write":
                event_type = "db.write"
            elif operation.startswith("transaction."):
                event_type = operation

            recorder.event(
                event_type,
                sql_label(operation, tables),
                sqlSummary=sql,
                operation=operation,
                tables=tables,
                rowcount=rowcount,
                elapsedMs=elapsed_ms,
                params=sanitize_params(params),
            )
        return result

    def executemany(self, query: Any, params_seq: Any, *args: Any, **kwargs: Any) -> Any:
        recorder = current_recorder()
        sql = normalize_sql(query)
        operation = operation_for_sql(sql)
        tables = tables_for_sql(sql)
        start = time.perf_counter()
        try:
            result = self._cursor.executemany(query, params_seq, *args, **kwargs)
        except Exception as error:
            if recorder:
                recorder.event(
                    "exception.throw",
                    f"PostgreSQL batch {type(error).__name__}",
                    sqlSummary=sql,
                    operation=operation,
                    tables=tables,
                )
            raise
        if recorder:
            recorder.event(
                "db.write" if operation == "write" else "db.query",
                sql_label(operation, tables),
                sqlSummary=sql,
                operation=operation,
                tables=tables,
                rowcount=getattr(self._cursor, "rowcount", None),
                elapsedMs=round((time.perf_counter() - start) * 1000, 2),
                params={"batch": True, "count": safe_len(params_seq)},
            )
        return result

    def __enter__(self) -> "ReviewFlowCursor":
        if hasattr(self._cursor, "__enter__"):
            self._cursor.__enter__()
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> Any:
        if hasattr(self._cursor, "__exit__"):
            return self._cursor.__exit__(exc_type, exc, tb)
        return None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cursor, name)


class ReviewFlowConnection:
    def __init__(self, connection: Any):
        self._connection = connection

    def cursor(self, *args: Any, **kwargs: Any) -> ReviewFlowCursor:
        return ReviewFlowCursor(self._connection.cursor(*args, **kwargs))

    def commit(self) -> Any:
        recorder = current_recorder()
        try:
            result = self._connection.commit()
        except Exception as error:
            if recorder:
                recorder.event("exception.throw", f"PostgreSQL commit failed: {type(error).__name__}")
            raise
        if recorder:
            recorder.event("transaction.commit", "PostgreSQL commit")
        return result

    def rollback(self) -> Any:
        recorder = current_recorder()
        try:
            result = self._connection.rollback()
        except Exception as error:
            if recorder:
                recorder.event("exception.throw", f"PostgreSQL rollback failed: {type(error).__name__}")
            raise
        if recorder:
            recorder.event("transaction.rollback", "PostgreSQL rollback")
        return result

    def __enter__(self) -> "ReviewFlowConnection":
        if hasattr(self._connection, "__enter__"):
            self._connection.__enter__()
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> Any:
        if hasattr(self._connection, "__exit__"):
            return self._connection.__exit__(exc_type, exc, tb)
        return None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._connection, name)


def wrap_connection(connection: Any) -> ReviewFlowConnection:
    return ReviewFlowConnection(connection)


def sanitize_params(params: Any) -> Any:
    if params is None:
        return None
    if isinstance(params, dict):
        return {key: "[value]" for key in params.keys()}
    if isinstance(params, (list, tuple)):
        return {"count": len(params)}
    return sanitize_value(params)


def safe_len(value: Any) -> Optional[int]:
    try:
        return len(value)
    except TypeError:
        return None


def sql_label(operation: str, tables: list[str]) -> str:
    table_text = ", ".join(tables) if tables else "unknown table"
    return f"PostgreSQL {operation} on {table_text}"
