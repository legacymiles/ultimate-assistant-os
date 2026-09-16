"""The job queue.

There is one GPU, one model resident at a time, and generations that take
minutes, so the design is the least clever one that works: every request is
recorded, put on a FIFO, and run by a single worker thread, strictly in order.
The HTTP handler returns a job id immediately and the client polls
GET /jobs/{id}.

Progress is coarse and honest. The upstream pipelines do not expose a
per-step callback that means anything to a human, so what moves is the stage
name ("planning", "semantic", "synthesis", "decoding"), and `progress` is the
fraction of stages done — not an estimate of time, and never a number that
was made up to look like motion.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
import uuid

from common import BadRequest, Unavailable, Unsupported

log = logging.getLogger("music.jobs")

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_ERROR = "error"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class Job:
    def __init__(self, kind: str, params: dict, handler):
        self.id = uuid.uuid4().hex[:16]
        self.kind = kind
        self.params = params
        self.handler = handler
        self.status = STATUS_QUEUED
        self.progress = 0.0
        self.stage = "queued"
        self.result = None
        self.error = None
        self.error_kind = None
        self.queued_at = _now()
        self.started_at = None
        self.finished_at = None
        self.lock = threading.Lock()

    def report(self, stage: str, progress: float | None = None):
        """Called from inside a handler as the work moves on."""
        with self.lock:
            self.stage = stage
            if progress is not None:
                self.progress = max(0.0, min(1.0, float(progress)))
        log.info(f"job {self.id} [{self.kind}] {self.stage} {self.progress:.0%}")

    def to_dict(self) -> dict:
        with self.lock:
            return {
                "job_id": self.id,
                "kind": self.kind,
                "status": self.status,
                "progress": round(self.progress, 3),
                "stage": self.stage,
                "result": self.result,
                "error": self.error,
                "error_kind": self.error_kind,
                "queued_at": self.queued_at,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
            }


class JobStore:
    """FIFO + record keeping. One worker thread; the GPU cannot share itself."""

    def __init__(self, max_jobs: int = 200):
        self.max_jobs = max_jobs
        self.jobs: dict[str, Job] = {}
        self.order: list[str] = []
        self.queue: queue.Queue[Job] = queue.Queue()
        self.lock = threading.Lock()
        self.running: Job | None = None
        self.thread = threading.Thread(target=self._run, name="music-worker", daemon=True)

    def start(self):
        self.thread.start()

    def submit(self, kind: str, params: dict, handler) -> Job:
        job = Job(kind, params, handler)
        with self.lock:
            self.jobs[job.id] = job
            self.order.append(job.id)
            self._evict_locked()
        self.queue.put(job)
        log.info(f"job {job.id} [{kind}] queued ({self.queue.qsize()} pending)")
        return job

    def get(self, job_id: str) -> Job | None:
        with self.lock:
            return self.jobs.get(job_id)

    def snapshot(self) -> dict:
        with self.lock:
            running = self.running
            return {
                "running": running.id if running and running.status == STATUS_RUNNING else None,
                "running_kind": running.kind if running and running.status == STATUS_RUNNING else None,
                "pending": self.queue.qsize(),
            }

    def recent(self, limit: int = 25) -> list[dict]:
        with self.lock:
            ids = self.order[-limit:][::-1]
            jobs = [self.jobs[i] for i in ids if i in self.jobs]
        return [j.to_dict() for j in jobs]

    def _evict_locked(self):
        """Drop the oldest finished jobs once the record count is over the cap.

        Queued and running jobs are never evicted, however old they look: a
        long generation must not lose its own record while it is still going.
        """
        while len(self.order) > self.max_jobs:
            for index, job_id in enumerate(self.order):
                job = self.jobs.get(job_id)
                if job is None or job.status in (STATUS_DONE, STATUS_ERROR):
                    self.order.pop(index)
                    self.jobs.pop(job_id, None)
                    break
            else:
                return  # everything is queued or running; let the cap slip

    def _run(self):
        while True:
            job = self.queue.get()
            with self.lock:
                self.running = job
            with job.lock:
                job.status = STATUS_RUNNING
                job.started_at = _now()
                job.stage = "starting"
                job.progress = 0.01
            started = time.perf_counter()
            try:
                result = job.handler(job)
                with job.lock:
                    job.result = result
                    job.status = STATUS_DONE
                    job.stage = "done"
                    job.progress = 1.0
                log.info(f"job {job.id} [{job.kind}] done in {time.perf_counter() - started:.1f}s")
            except (BadRequest, Unavailable, Unsupported) as exc:
                self._fail(job, exc, type(exc).__name__.lower())
            except Exception as exc:  # noqa: BLE001 - the worker must survive anything
                log.exception(f"job {job.id} [{job.kind}] crashed")
                self._fail(job, exc, "failed")
            finally:
                with job.lock:
                    job.finished_at = _now()
                with self.lock:
                    self.running = None
                    # Also trim here, not just on submit: a burst of jobs can
                    # push the record count over the cap while every one of
                    # them is still unfinished and therefore not evictable.
                    self._evict_locked()

    @staticmethod
    def _fail(job: Job, exc: Exception, kind: str):
        message = f"{type(exc).__name__}: {exc}" if kind == "failed" else str(exc)
        with job.lock:
            job.status = STATUS_ERROR
            job.error = message
            job.error_kind = kind
            job.stage = "error"
        log.error(f"job {job.id} [{job.kind}] {kind}: {message}")
