"""YuE2: a style description plus lyrics (and optionally an ABC melody) in,
a finished song out.

What the model is: `m-a-p/YuE2-3B` generates the song, `m-a-p/YuE2-Vae`
decodes the latent into audio you can listen to. (`m-a-p/YuE2-Vae-legacy`
exists only to reproduce the paper's benchmark numbers; it is not what you
want for listening.) One request at a time, BF16, ~24 GB of VRAM.

What the model is not: there is no audio-reference argument, no voice
cloning, no phoneme alignment, no inpainting. The only ways to steer it are
`style`, `lyrics`, `cot`, `seed`, `cfg_scale` and an `abc` score. If the
website offers "make it sound like this singer", it is offering something
YuE2 cannot do.

Why the one-shot call and not the staged API: the pipeline does expose
`plan()` / `generate_semantic()` / `synthesize()` / `decode()`, which would
give finer progress. But `save_artifacts()` belongs to the Song object the
one-shot call returns, and stitching the staged pieces back into the same
artifact set means guessing at how they join. Coarse-but-true stages beat a
finer progress bar built on a guess, so this calls the pipeline the way the
README documents it.
"""

from __future__ import annotations

import json
import os
import sys

try:
    from . import wire
except ImportError:  # run as a script by another virtualenv's python
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import wire

ARTIFACTS = ("audio.flac", "score.abc", "plan.json", "result.json", "latent.npy")


def load(model: str, vae: str, device: str = "cuda"):
    """Build the pipeline. Minutes, and about 24 GB of VRAM."""
    from yue2 import YuE2Pipeline
    return YuE2Pipeline.from_pretrained(model, vae=vae, device=device)


def _read_text(path: str, limit: int = 200_000) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read(limit)
    except OSError:
        return None


def _read_json(path: str):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def run_song(pipe, request: dict, out_dir: str, report) -> dict:
    """Generate one song and write its artifacts to out_dir."""
    os.makedirs(out_dir, exist_ok=True)
    report("generating (plan, semantic, synthesis, decode)", 0.15)
    song = pipe(**request)

    report("writing artifacts", 0.9)
    song.save_artifacts(out_dir)

    written = {name: os.path.join(out_dir, name)
               for name in ARTIFACTS if os.path.exists(os.path.join(out_dir, name))}

    truncated = getattr(song, "truncated", None)
    if truncated is not None and not isinstance(truncated, dict):
        truncated = {"value": str(truncated)}

    payload = {
        "id": request.get("id"),
        "seed": request.get("seed"),
        "cot": request.get("cot"),
        "out_dir": os.path.abspath(out_dir),
        "audio_path": written.get("audio.flac"),
        "artifacts": {name: os.path.abspath(path) for name, path in written.items()},
        "abc": _read_text(written["score.abc"]) if "score.abc" in written else None,
        "plan": _read_json(written["plan.json"]) if "plan.json" in written else None,
        "result": _read_json(written["result.json"]) if "result.json" in written else None,
        "truncated": truncated,
    }
    if not payload["audio_path"]:
        # The pipeline finished but there is no audio. Say so rather than
        # handing the website a job it thinks succeeded.
        raise RuntimeError(f"YuE2 wrote no audio.flac into {out_dir}; artifacts present: "
                           f"{sorted(written) or 'none'}")
    return payload


def _handle(payload: dict, stage) -> dict:
    if payload.get("task") != "song":
        raise ValueError(f"unknown task {payload.get('task')!r}")
    stage("loading YuE2", 0.05)
    pipe = load(payload["model"], payload["vae"], device=payload.get("device", "cuda"))
    try:
        return run_song(pipe, payload["request"], payload["out_dir"], stage)
    finally:
        # This process is about to exit, but close the pipeline properly anyway
        # so a half-written CUDA context is not what the operator debugs later.
        closer = getattr(pipe, "close", None) or getattr(pipe, "__exit__", None)
        if callable(closer):
            try:
                closer() if closer.__name__ == "close" else closer(None, None, None)
            except Exception as exc:  # noqa: BLE001
                print(f"pipeline close failed: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(wire.main(_handle))
