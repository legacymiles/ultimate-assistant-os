"""Stop the pod when nobody has used it for a while.

The website can now WAKE a stopped pod when someone presses Render, which
makes "who stops it?" the whole cost question: a pod woken for one song and
then forgotten bills about $12 a day. So the server stops its own pod once it
has been idle — no job running, nothing queued, and no authorised request —
for `--idle-stop-minutes`.

Activity is any authorised request. /health does not count: the site polls it
while a tab is open, and an open tab is not someone making music.

Stopping uses RunPod's own tools from inside the pod: `runpodctl stop pod
$RUNPOD_POD_ID` (every RunPod pod ships runpodctl with a pod-scoped key), or,
when that is missing, the REST API with RUNPOD_API_KEY if the pod has one.
Off RunPod (no RUNPOD_POD_ID) there is nothing to stop and this does nothing.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
import urllib.request

log = logging.getLogger("music.idle")

CHECK_EVERY_S = 60


class IdleStopper:
    def __init__(self, minutes: float, jobs):
        self.limit_s = max(0.0, float(minutes)) * 60
        self.jobs = jobs
        self.last = time.monotonic()
        self.pod_id = os.environ.get("RUNPOD_POD_ID", "")
        self.stopping = False

    @property
    def enabled(self) -> bool:
        return self.limit_s > 0 and bool(self.pod_id)

    def touch(self):
        self.last = time.monotonic()

    def idle_seconds(self) -> float:
        return time.monotonic() - self.last

    def state(self) -> dict:
        return {
            "enabled": self.enabled,
            "limit_minutes": round(self.limit_s / 60, 1),
            "idle_minutes": round(self.idle_seconds() / 60, 1),
        }

    def start(self):
        if self.limit_s <= 0:
            log.info("idle stop: off")
            return
        if not self.pod_id:
            log.info("idle stop: no RUNPOD_POD_ID, so not on RunPod — nothing to stop")
            return
        log.info(f"idle stop: the pod stops itself after {self.limit_s / 60:.0f} idle minutes")
        threading.Thread(target=self._loop, name="idle-stop", daemon=True).start()

    def _busy(self) -> bool:
        snap = self.jobs.snapshot()
        return bool(snap.get("running")) or int(snap.get("pending") or 0) > 0

    def _loop(self):
        while not self.stopping:
            time.sleep(CHECK_EVERY_S)
            if self._busy():
                self.touch()  # a long render is activity, even with no one polling
                continue
            if self.idle_seconds() >= self.limit_s:
                self.stopping = True
                log.warning(f"idle for {self.idle_seconds() / 60:.0f} min — stopping pod {self.pod_id}")
                self._stop()

    def _stop(self):
        ctl = shutil.which("runpodctl")
        if ctl:
            try:
                subprocess.run([ctl, "stop", "pod", self.pod_id], check=True, timeout=60)
                return
            except Exception as exc:  # noqa: BLE001
                log.error(f"runpodctl stop failed: {exc}")
        key = os.environ.get("RUNPOD_API_KEY", "")
        if not key:
            log.error("cannot stop the pod: no runpodctl and no RUNPOD_API_KEY — it will keep billing")
            self.stopping = False
            self.touch()
            return
        req = urllib.request.Request(
            f"https://api.runpod.io/v2/pods/{self.pod_id}/action",
            data=json.dumps({"action": "stop"}).encode(),
            method="POST",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                     "User-Agent": "music-creator-server/idle-stop"},
        )
        try:
            urllib.request.urlopen(req, timeout=60).read()
        except Exception as exc:  # noqa: BLE001
            log.error(f"REST stop failed: {exc} — retrying after the next idle window")
            self.stopping = False
            self.touch()
