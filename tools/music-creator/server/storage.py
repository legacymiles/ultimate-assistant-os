"""On-disk state: produced files, and the voice reference clips.

Both stores keep a small JSON index next to the files so the server can be
restarted without the website's links going dead. Neither is a database and
neither is trying to be; they are dictionaries that survive a reboot, guarded
by a lock because the HTTP loop and the GPU worker thread both touch them.

About voices: a "voice profile" here is a stored reference clip plus a name.
AuK is zero-shot — it conditions on the reference audio at generation time —
so there is no training step, no checkpoint per voice, and nothing to "finish
training". Deleting a voice deletes a wav file. That is the whole thing.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid

import audio
from common import guess_audio_ext

log = logging.getLogger("music.storage")

ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _new_id() -> str:
    return uuid.uuid4().hex[:16]


def _write_json(path: str, payload) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(tmp, path)


def _read_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default
    except Exception as exc:
        log.warning(f"{path} is unreadable ({exc}); starting from empty")
        return default


class FileStore:
    """Everything the server produced that a client can download.

    Files live wherever the job wrote them (a song keeps its whole artifact
    folder), so the index maps an id to an absolute path rather than assuming
    one flat directory. Ids are opaque; paths never come from the client.
    """

    def __init__(self, data_dir: str):
        self.dir = os.path.join(data_dir, "files")
        os.makedirs(self.dir, exist_ok=True)
        self.index_path = os.path.join(data_dir, "files.json")
        self.lock = threading.Lock()
        self.items = _read_json(self.index_path, {})

    def path_for(self, ext: str) -> tuple[str, str]:
        """Reserve an id and a path under the store's own directory."""
        file_id = _new_id()
        return file_id, os.path.join(self.dir, file_id + ext)

    def register(self, file_id: str, path: str, name: str | None = None, kind: str = "audio") -> str:
        record = {
            "file_id": file_id,
            "path": os.path.abspath(path),
            "name": name or os.path.basename(path),
            "kind": kind,
            "created": _now(),
            "bytes": os.path.getsize(path) if os.path.exists(path) else None,
        }
        with self.lock:
            self.items[file_id] = record
            _write_json(self.index_path, self.items)
        return file_id

    def add(self, path: str, name: str | None = None, kind: str = "audio") -> str:
        return self.register(_new_id(), path, name=name, kind=kind)

    def get(self, file_id: str) -> dict | None:
        if not ID_RE.match(file_id or ""):
            return None
        with self.lock:
            record = self.items.get(file_id)
        if not record or not os.path.exists(record["path"]):
            return None
        return record


class VoiceStore:
    """Reference clips for AuK's zero-shot voice cloning.

    Each clip is stored twice when ffmpeg is available: the original upload
    (whatever container the browser produced) and a 16 kHz mono wav, which is
    what gets handed to the model. Without ffmpeg the original is kept as-is
    and the record says so, because a webm blob passed to a wav loader is a
    failure worth seeing rather than hiding.
    """

    TARGET_SR = 16000

    def __init__(self, data_dir: str):
        self.dir = os.path.join(data_dir, "voices")
        os.makedirs(self.dir, exist_ok=True)
        self.index_path = os.path.join(self.dir, "voices.json")
        self.lock = threading.Lock()
        self.items = _read_json(self.index_path, {})

    def _save(self):
        _write_json(self.index_path, self.items)

    def add(self, name: str, data: bytes, filename: str | None = None, transcript: str | None = None) -> dict:
        voice_id = _new_id()
        ext = guess_audio_ext(data, filename)
        source_path = os.path.join(self.dir, voice_id + ext)
        with open(source_path, "wb") as handle:
            handle.write(data)

        wav_path, converted, note = source_path, False, None
        if ext != ".wav" or audio.ffmpeg_path():
            candidate = os.path.join(self.dir, voice_id + ".16k.wav")
            try:
                audio.to_wav(source_path, candidate, sample_rate=self.TARGET_SR, mono=True)
                wav_path, converted = candidate, True
            except audio.FfmpegMissing:
                note = "ffmpeg is not installed, so the clip is stored as uploaded and not resampled"
            except Exception as exc:
                note = f"could not convert to wav ({exc}); the clip is stored as uploaded"

        probed = audio.probe(wav_path)
        if not converted and probed["sample_rate"] and probed["sample_rate"] != self.TARGET_SR and not note:
            note = (f"stored at {probed['sample_rate']} Hz without resampling (ffmpeg is not installed); "
                    f"AuK is normally fed {self.TARGET_SR} Hz mono")
        record = {
            "voice_ref_id": voice_id,
            "name": (name or "Untitled voice").strip()[:120],
            "created": _now(),
            "duration_s": probed["duration_s"],
            "sample_rate": probed["sample_rate"],
            "channels": probed["channels"],
            "transcript": (transcript or "").strip() or None,
            "source_path": os.path.abspath(source_path),
            "path": os.path.abspath(wav_path),
            "converted": converted,
            "bytes": len(data),
            "note": note,
        }
        with self.lock:
            self.items[voice_id] = record
            self._save()
        log.info(f"stored voice reference {voice_id} '{record['name']}' "
                 f"({record['duration_s']}s @ {record['sample_rate']}Hz)")
        return record

    def get(self, voice_id: str) -> dict | None:
        if not ID_RE.match(voice_id or ""):
            return None
        with self.lock:
            return self.items.get(voice_id)

    def list(self) -> list[dict]:
        with self.lock:
            return sorted(self.items.values(), key=lambda r: r["created"], reverse=True)

    def rename(self, voice_id: str, name: str) -> dict | None:
        with self.lock:
            record = self.items.get(voice_id)
            if not record:
                return None
            record["name"] = name.strip()[:120]
            self._save()
            return record

    def delete(self, voice_id: str) -> bool:
        with self.lock:
            record = self.items.pop(voice_id, None)
            if record:
                self._save()
        if not record:
            return False
        for key in ("path", "source_path"):
            try:
                if record.get(key) and os.path.exists(record[key]):
                    os.remove(record[key])
            except OSError as exc:
                log.warning(f"could not delete {record.get(key)}: {exc}")
        return True


def public_voice(record: dict) -> dict:
    """The subset of a voice record the website is written against."""
    return {
        "voice_ref_id": record["voice_ref_id"],
        "name": record["name"],
        "created": record["created"],
        "duration_s": record["duration_s"],
        "sample_rate": record["sample_rate"],
        "transcript": record.get("transcript"),
        "note": record.get("note"),
    }
