"""Shared pieces for the Music Creator server: defaults, the request
validation that mirrors YuE2's own protocol, base64 upload handling, and the
probes /health uses to say what is installed.

Nothing here imports torch, yue2 or auk at module level, and none of the
probes load a model. The server has to start and answer /health on a laptop
with no GPU and nothing installed — that is exactly how the website's
"server offline / model not installed" states get tested — so every heavy
import happens inside a function, behind a try/except, at the moment a job
actually needs it.
"""

from __future__ import annotations

import base64
import binascii
import importlib.util
import os
import random
import re
import subprocess

VERSION = "1.0.0"
SERVER_NAME = "music-creator"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # tools/music-creator

# Defaults. The model paths are deliberately the ids/paths the upstream repos
# document, so a box that followed their READMEs needs no flags at all.
DEFAULT_DATA_DIR = os.path.join(ROOT, "data")
DEFAULT_YUE2_MODEL = "m-a-p/YuE2-3B"
DEFAULT_YUE2_VAE = "m-a-p/YuE2-Vae"          # the listening decoder; -legacy is only for benchmarks
DEFAULT_AUK_CKPT = os.path.join("ckpts", "AuK", "auk_base.safetensors")
DEFAULT_AUK_CONFIG = os.path.join("ckpts", "AuK", "config.yaml")
DEFAULT_AUK_FLASH_CKPT = os.path.join("ckpts", "AuK-Flash", "auk_flash.safetensors")
DEFAULT_AUK_FLASH_CONFIG = os.path.join("ckpts", "AuK-Flash", "config.yaml")
DEFAULT_SHEETSAGE_DIR = os.path.join("models", "SheetSage2")

# YuE2's SongRequest rules, copied from src/yue2/protocol.py so a bad request
# comes back as a 400 with a sentence the website can show, instead of an
# exception thrown deep inside the pipeline after it has already been queued.
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$")
COT_CHOICES = ("full", "melody", "off")
SEED_MAX = 2 ** 63
CFG_SCALE_RANGE = (0.0, 20.0)

# Audio container sniffing. Browsers send whatever MediaRecorder produced
# (usually webm/opus), phones send m4a, and people upload wav/mp3/flac; we
# only need the extension right so ffmpeg and the model loaders behave.
_MAGIC = (
    (b"RIFF", ".wav"),
    (b"fLaC", ".flac"),
    (b"OggS", ".ogg"),
    (b"ID3", ".mp3"),
    (b"\x1a\x45\xdf\xa3", ".webm"),
)

CONTENT_TYPES = {
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".webm": "audio/webm",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".abc": "text/plain; charset=utf-8",
    ".json": "application/json",
    ".npy": "application/octet-stream",
}


class BadRequest(Exception):
    """Something the caller sent is wrong. Becomes a 400 with this message."""


class Unavailable(Exception):
    """What the caller asked for is not installed on this box. 503."""


class Unsupported(Exception):
    """The installed build genuinely cannot do this. 501 — never faked."""


# --- request validation -------------------------------------------------

def _require_str(body, field, allow_empty=False):
    value = body.get(field)
    if not isinstance(value, str):
        raise BadRequest(f"{field} is required and must be a string")
    if not allow_empty and not value.strip():
        raise BadRequest(f"{field} must not be empty")
    return value


def validate_song_request(body: dict, fallback_id: str) -> dict:
    """Build a YuE2 SongRequest dict, or raise BadRequest.

    The returned dict is passed straight to the pipeline as **request, so it
    holds only keys YuE2 knows: id, style, lyrics, cot, seed and the two
    optional ones. There is no audio-reference, voice-clone, phoneme-alignment
    or inpainting argument here because YuE2 does not have one.
    """
    style = _require_str(body, "style")
    lyrics = _require_str(body, "lyrics", allow_empty=True)

    cot = body.get("cot", "full")
    if cot is None:
        cot = "full"
    if cot not in COT_CHOICES:
        raise BadRequest("cot must be one of " + ", ".join(COT_CHOICES))

    seed = body.get("seed")
    if seed is None:
        seed = random.randrange(SEED_MAX)
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise BadRequest("seed must be an integer")
    if not 0 <= seed < SEED_MAX:
        raise BadRequest("seed must be in [0, 2**63)")

    request = {"id": "", "style": style, "lyrics": lyrics, "cot": cot, "seed": seed}

    abc = body.get("abc")
    if abc is not None:
        if not isinstance(abc, str) or not abc.strip():
            raise BadRequest("abc must be a non-empty ABC score, or omitted")
        if cot == "off":
            raise BadRequest('abc needs cot "full" or "melody" — the score is read during the chain of thought')
        request["abc"] = abc

    cfg = body.get("cfg_scale")
    if cfg is not None:
        if isinstance(cfg, bool) or not isinstance(cfg, (int, float)):
            raise BadRequest("cfg_scale must be a number")
        lo, hi = CFG_SCALE_RANGE
        if not lo <= float(cfg) <= hi:
            raise BadRequest(f"cfg_scale must be in [{lo:g}, {hi:g}]")
        request["cfg_scale"] = float(cfg)

    song_id = body.get("id") or fallback_id
    if not isinstance(song_id, str) or not ID_RE.match(song_id):
        raise BadRequest("id must match [A-Za-z0-9][A-Za-z0-9_.-]{0,179}")
    request["id"] = song_id
    return request


# --- uploads ------------------------------------------------------------

def decode_b64_audio(value, field: str, max_bytes: int) -> bytes:
    """Decode a base64 (or data-URL) upload, with honest errors."""
    if not isinstance(value, str) or not value.strip():
        raise BadRequest(f"{field} must be a base64-encoded audio string")
    payload = value.strip()
    if payload.startswith("data:"):
        comma = payload.find(",")
        if comma < 0:
            raise BadRequest(f"{field} looks like a data URL but has no comma")
        payload = payload[comma + 1:]
    payload = "".join(payload.split())
    if len(payload) // 4 * 3 > max_bytes:
        raise BadRequest(f"{field} is larger than this server's upload limit of {max_bytes // (1024 * 1024)} MB")
    try:
        data = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise BadRequest(f"{field} is not valid base64: {exc}")
    if not data:
        raise BadRequest(f"{field} decoded to zero bytes")
    return data


def guess_audio_ext(data: bytes, filename: str | None = None) -> str:
    """Extension from the container's magic bytes, falling back to the name."""
    head = data[:16]
    for magic, ext in _MAGIC:
        if head.startswith(magic):
            if ext == ".wav" and b"WAVE" not in head:
                continue
            return ext
    if head[4:8] == b"ftyp":
        return ".m4a"
    if head[:2] in (b"\xff\xfb", b"\xff\xf3"):
        return ".mp3"
    if filename:
        ext = os.path.splitext(filename)[1].lower()
        if ext in CONTENT_TYPES:
            return ext
    return ".bin"


def content_type_for(path: str) -> str:
    return CONTENT_TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")


# --- what is installed --------------------------------------------------

def module_available(name: str) -> bool:
    """True if `import name` would find something. Does not import it."""
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, ModuleNotFoundError, AttributeError):
        return False


def hf_cache_dir() -> str:
    for var in ("HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE"):
        value = os.environ.get(var)
        if value:
            return value
    home = os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface")
    return os.path.join(home, "hub")


_REPO_RE = re.compile(r"^[A-Za-z0-9][\w.-]*/[\w.-]+$")


def weights_state(spec: str | None) -> str:
    """'local' | 'cached' | 'not-downloaded' | 'missing' | 'not-set'.

    Never touches the network. A Hugging Face id that is not in the local hub
    cache is reported as not-downloaded rather than missing, because the first
    job would fetch it — we just cannot promise how long that takes, and the
    website should be able to warn about it.
    """
    if not spec:
        return "not-set"
    if os.path.exists(spec):
        return "local"
    if _REPO_RE.match(spec):
        folder = "models--" + spec.replace("/", "--")
        return "cached" if os.path.isdir(os.path.join(hf_cache_dir(), folder)) else "not-downloaded"
    return "missing"


def gpu_info() -> dict:
    """{name, vram_gb, free_gb} — all None when there is no GPU or no torch."""
    try:
        import torch
        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            return {
                "name": torch.cuda.get_device_name(0),
                "vram_gb": round(total / 2 ** 30, 1),
                "free_gb": round(free / 2 ** 30, 1),
            }
    except Exception:
        pass
    # No torch, or a CPU-only build: ask the driver instead, so a box that has
    # a card but has not installed the model venvs yet still reports the truth.
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0 and out.stdout.strip():
            name, total, free = (p.strip() for p in out.stdout.strip().splitlines()[0].split(","))
            return {"name": name, "vram_gb": round(float(total) / 1024, 1), "free_gb": round(float(free) / 1024, 1)}
    except Exception:
        pass
    return {"name": None, "vram_gb": None, "free_gb": None}


def strip_chords(abc: str) -> str:
    """Remove guitar-chord annotations from an ABC score.

    In ABC a chord symbol is a double-quoted token in front of a note ("Am",
    "G7/B"). The cover workflow wants the melody only, so the chords come out
    before the score is handed to YuE2 with cot="melody" — otherwise the model
    is being told the source harmony as well as the source tune, which is not
    what "render this melody in a new style" means.
    """
    without = re.sub(r'"[^"\n]*"', "", abc)
    return re.sub(r"[ \t]{2,}", " ", without)
