"""SheetSage2: audio in, an ABC score out.

This one is always a subprocess, even when the server could import it,
because it is documented as needing its own environment: Python 3.10/3.11 and
FFmpeg 6.1, and it loads `m-a-p/MERT-v2-FullSong` itself. Pinning it next to
YuE2's Python 3.12 install is asking for a transformers version fight.

It is the first half of the cover/mashup workflow: transcribe a source track
with melody_only, strip the chord symbols, then hand the score to YuE2 with
cot="melody" and a new target style. That is a re-performance of the tune in a
different style — the model never hears the original recording, and nothing
of the original singer's voice survives, because there is no path for it to.
"""

from __future__ import annotations

import os
import sys

try:
    from . import wire
except ImportError:  # normal case: another virtualenv's python runs this file
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import wire

KEEP = ("abc", "abc_error", "warnings")


def transcribe(model_dir: str, audio_path: str, out_dir: str, melody_only: bool, report) -> dict:
    import torch
    from transformers import AutoModel

    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"audio not found: {audio_path}")
    os.makedirs(out_dir, exist_ok=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    report(f"loading SheetSage2 ({device})", 0.1)
    model = AutoModel.from_pretrained(model_dir, trust_remote_code=True).eval().to(device)

    report("transcribing", 0.4)
    out = model.transcribe(audio_path, output_dir=out_dir, melody_only=melody_only)
    if not isinstance(out, dict):
        raise RuntimeError(f"transcribe() returned {type(out).__name__}, expected a dict with an 'abc' key")

    result = {key: out.get(key) for key in KEEP}
    if not result.get("abc"):
        raise RuntimeError(result.get("abc_error") or "SheetSage2 produced no ABC score for this audio")
    result["out_dir"] = os.path.abspath(out_dir)
    result["melody_only"] = bool(melody_only)
    result["device"] = device
    return result


def _handle(payload: dict, stage) -> dict:
    return transcribe(
        payload["model_dir"], payload["audio"], payload["out_dir"],
        bool(payload.get("melody_only", True)), stage,
    )


if __name__ == "__main__":
    raise SystemExit(wire.main(_handle))
