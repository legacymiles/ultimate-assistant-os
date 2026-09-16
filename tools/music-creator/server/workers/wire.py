"""The three-line protocol between the server and a worker subprocess.

    stdin   one JSON object, one line: the payload
    stdout  @@STAGE@@  {"stage": "...", "progress": 0.4}   zero or more times
            @@RESULT@@ {...}                                exactly one, on success
            @@ERROR@@  {"error": "..."}                     exactly one, on failure
    stderr  whatever the model prints; the server keeps the tail for error text

Markers exist because model code prints to stdout whenever it feels like it —
progress bars, tokenizer warnings, "Loading checkpoint shards" — and the
result has to be findable in the middle of that.
"""

from __future__ import annotations

import json
import sys
import traceback

STAGE_MARK = "@@STAGE@@"
RESULT_MARK = "@@RESULT@@"
ERROR_MARK = "@@ERROR@@"


def read_payload() -> dict:
    line = sys.stdin.readline()
    if not line.strip():
        raise SystemExit("no payload on stdin")
    return json.loads(line)


def stage(name: str, progress: float | None = None) -> None:
    sys.stdout.write(STAGE_MARK + json.dumps({"stage": name, "progress": progress}) + "\n")
    sys.stdout.flush()


def result(payload: dict) -> None:
    sys.stdout.write(RESULT_MARK + json.dumps(payload, default=str) + "\n")
    sys.stdout.flush()


def fail(exc: BaseException) -> None:
    traceback.print_exc(file=sys.stderr)
    sys.stdout.write(ERROR_MARK + json.dumps({"error": f"{type(exc).__name__}: {exc}"}) + "\n")
    sys.stdout.flush()


def main(handler) -> int:
    """Read the payload, run `handler(payload, stage)`, print the result."""
    try:
        payload = read_payload()
    except Exception as exc:  # noqa: BLE001
        fail(exc)
        return 2
    try:
        result(handler(payload, stage))
        return 0
    except Exception as exc:  # noqa: BLE001
        fail(exc)
        return 1
