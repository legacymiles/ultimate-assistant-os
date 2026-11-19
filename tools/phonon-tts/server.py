"""
Phonon TTS - a tiny local HTTP server that gives Jarvis a voice with no cloud.

Loads one Phonon checkpoint into memory and keeps it warm, so a request costs
only synthesis (~5x realtime on the owner's laptop) instead of a model load.
The Next.js route /api/tts talks to this when TTS_BACKEND=phonon.

Stdlib only, apart from `ptts` (and the numpy it pulls in). No torch, no CUDA:
the xn runtime is CPU-only, which is why this never touches the 6 GB GPU.

    POST /v1/tts    {"text": "...", "voice": "Easton", "format": "wav"|"mp3",
                     "speed": 1.0, "temperature": 0.3, "seed": 123}
                    -> audio bytes (audio/wav or audio/mpeg)
    GET  /health    -> {"ok": true, "model": ..., "voice": ..., "voices": N, ...}
    GET  /v1/voices -> {"voices": [...]}

Config comes from the environment:

    PHONON_MODEL           hf://... or a local dir   (default: phonon-40m-en)
    PHONON_FALLBACK_MODEL  used when the above is gated/unreachable
    PHONON_VOICE           default voice name        (default: Easton)
    PHONON_LANG            normalisation language    (default: en)
    PHONON_QUANT           weight format             (default: q8_0)
    PHONON_PORT            listen port               (default: 8123)
    PHONON_THREADS         synthesis threads         (default: library default)
    PHONON_KEY             if set, require Authorization: Bearer <key>
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import ptts

# phonon-31m-en by choice, not by default: it is Apache 2.0, so it is the only
# one of the family that may ship commercially, and on Gradium's own English
# benchmarks it beats the multilingual 40M. The 40M models are gated on HF and
# CC BY-NC - set PHONON_MODEL to one if you have accepted its terms and want
# fr/de/es/pt for personal use.
DEFAULT_MODEL = "hf://gradium/phonon-31m-en"
FALLBACK_MODEL = "hf://gradium/phonon-31m-en"
MAX_TEXT = 5000

MODEL = os.environ.get("PHONON_MODEL") or DEFAULT_MODEL
FALLBACK = os.environ.get("PHONON_FALLBACK_MODEL") or FALLBACK_MODEL
VOICE = os.environ.get("PHONON_VOICE") or "Easton"
LANG = os.environ.get("PHONON_LANG") or "en"
QUANT = os.environ.get("PHONON_QUANT") or "q8_0"
PORT = int(os.environ.get("PHONON_PORT") or 8123)
KEY = os.environ.get("PHONON_KEY") or ""

# The Rust runtime is not reentrant per model, so synthesis is single-flight.
# Requests queue instead of racing; at ~5x realtime the queue drains fast.
_lock = threading.Lock()
_tts: ptts.TTS | None = None
_loaded_model = ""
_ffmpeg = shutil.which("ffmpeg")


def log(msg: str) -> None:
    print("[phonon] " + msg, flush=True)


def load() -> None:
    """Load the configured checkpoint, falling back when it is gated."""
    global _tts, _loaded_model

    threads = os.environ.get("PHONON_THREADS")
    if threads:
        ptts.set_num_threads(int(threads))

    tried: list[str] = []
    for candidate in (MODEL, FALLBACK):
        # The fallback is only a second attempt when it is a different model —
        # which it is not while both are the default. Retrying the same
        # checkpoint would just print the same failure twice.
        if not candidate or candidate in tried:
            continue
        tried.append(candidate)
        t0 = time.time()
        try:
            log("loading " + candidate + " (" + QUANT + ") ...")
            _tts = ptts.TTS(candidate, lang=LANG, quant=QUANT, voice=VOICE)
            _loaded_model = candidate
            log(
                "ready in {:.1f}s - device={} quant={} sr={} threads={} cloning={}".format(
                    time.time() - t0,
                    _tts.device,
                    _tts.quant,
                    _tts.sample_rate,
                    ptts.get_num_threads(),
                    _tts.supports_voice_cloning,
                )
            )
            if candidate != MODEL:
                log("NOTE: " + MODEL + " was unavailable - running on " + candidate + " instead.")
            return
        except Exception as err:  # noqa: BLE001 - any load failure should try the fallback
            detail = str(err)
            gated = "GatedRepo" in detail or "Authentication required" in detail
            why = "gated (accept its terms on HF, then set HF_TOKEN)" if gated else detail[:300]
            log("could not load " + candidate + ": " + why)

    log("FATAL: no checkpoint could be loaded.")
    sys.exit(1)


def to_wav(pcm: np.ndarray, sample_rate: int) -> bytes:
    """Pack float32 PCM in [-1, 1] as a mono 16-bit WAV."""
    pcm16 = (np.clip(pcm, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm16.tobytes())
    return buf.getvalue()


def transcode(wav: bytes, fmt: str, speed: float) -> tuple[bytes, str]:
    """Apply speed and/or mp3 with ffmpeg when it is available.

    Phonon has no speed control of its own, so tempo is an ffmpeg atempo pass
    (which keeps the pitch). Without ffmpeg the audio is returned untouched: a
    WAV at normal speed beats failing the request.
    """
    want_speed = abs(speed - 1.0) > 0.01
    if not _ffmpeg or (fmt != "mp3" and not want_speed):
        return wav, "audio/wav"

    args = [_ffmpeg, "-hide_banner", "-loglevel", "error", "-i", "pipe:0"]
    if want_speed:
        args += ["-filter:a", "atempo={:.3f}".format(max(0.5, min(2.0, speed)))]
    if fmt == "mp3":
        args += ["-f", "mp3", "-b:a", "128k", "pipe:1"]
    else:
        args += ["-f", "wav", "pipe:1"]

    try:
        done = subprocess.run(args, input=wav, capture_output=True, timeout=60, check=True)
        return done.stdout, "audio/mpeg" if fmt == "mp3" else "audio/wav"
    except Exception as err:  # noqa: BLE001 - a transcode failure must not lose the audio
        log("ffmpeg failed ({}); returning WAV".format(err))
        return wav, "audio/wav"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "phonon-tts"

    def log_message(self, fmt: str, *args) -> None:
        log(fmt % args)

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: dict) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _authed(self) -> bool:
        if not KEY:
            return True
        return self.headers.get("Authorization", "") == "Bearer " + KEY

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's spelling
        if self.path.startswith("/health"):
            if _tts is None:
                self._json(503, {"ok": False, "error": "Model not loaded"})
                return
            self._json(
                200,
                {
                    "ok": True,
                    "model": _loaded_model,
                    "requested_model": MODEL,
                    "running_requested": _loaded_model == MODEL,
                    "voice": VOICE,
                    "voices": len(_tts.voices),
                    "lang": LANG,
                    "device": _tts.device,
                    "quant": _tts.quant,
                    "sample_rate": _tts.sample_rate,
                    "cloning": _tts.supports_voice_cloning,
                    "ffmpeg": bool(_ffmpeg),
                },
            )
            return
        if self.path.startswith("/v1/voices"):
            if not self._authed():
                self._json(401, {"error": "Unauthorized"})
                return
            self._json(200, {"voices": ptts.catalog_voices()})
            return
        self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/v1/tts"):
            self._json(404, {"error": "Not found"})
            return
        if not self._authed():
            self._json(401, {"error": "Unauthorized"})
            return
        if _tts is None:
            self._json(503, {"error": "Model not loaded"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:  # noqa: BLE001
            self._json(400, {"error": "Invalid JSON body"})
            return

        text = (body.get("text") or "").strip()
        if not text:
            self._json(400, {"error": "Text is required"})
            return
        if len(text) > MAX_TEXT:
            self._json(400, {"error": "Text too long (max {} characters)".format(MAX_TEXT)})
            return

        voice = body.get("voice") or VOICE
        fmt = "mp3" if body.get("format") == "mp3" else "wav"
        try:
            speed = float(body.get("speed") or 1.0)
        except (TypeError, ValueError):
            speed = 1.0

        kwargs: dict = {"voice": voice}
        if body.get("temperature") is not None:
            kwargs["temperature"] = float(body["temperature"])
        if body.get("seed") is not None:
            kwargs["seed"] = int(body["seed"])

        t0 = time.time()
        try:
            with _lock:
                pcm = _tts.synth(text, **kwargs)
            sample_rate = _tts.sample_rate
        except Exception as err:  # noqa: BLE001 - report, never crash the server
            log("synth failed: {}".format(err))
            self._json(500, {"error": "Synthesis failed: {}".format(err)[:300]})
            return

        wav = to_wav(pcm, sample_rate)
        audio, ctype = transcode(wav, fmt, speed)
        dur = len(pcm) / sample_rate
        elapsed = max(time.time() - t0, 1e-6)
        log(
            "{} chars -> {:.2f}s audio in {:.2f}s ({:.1f}x realtime) voice={} {}".format(
                len(text), dur, elapsed, dur / elapsed, voice, ctype
            )
        )
        self._send(200, audio, ctype)


def main() -> None:
    load()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log("listening on http://127.0.0.1:{}  (POST /v1/tts, GET /health)".format(PORT))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
