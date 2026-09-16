"""AuK: speech. A reference clip plus some text, and it says the text in that
voice.

Read this before wiring anything to it: **AuK does not sing.** It is a
1.5B speech foundation model. It does text-to-speech with zero-shot voice
cloning, speech editing, and source separation. It has no notion of melody,
key or tempo, and pointing it at a song's vocal will get you speech in that
timbre, not a vocal take. The singing in this app comes from YuE2 and only
from YuE2; the two are combined, when they are combined at all, by mixing two
finished files together.

Zero-shot means exactly that: nothing is trained per voice. The "voice
profile" the website shows is a wav file on disk and a name. Generation
conditions on that clip each time.

Memory: roughly 24.8 GiB peak in bf16, about a third less with cpu_offload.
Qwen/Qwen2.5-Omni-3B has to be available too — AuK loads it as part of the
stack, so the first run downloads it if the cache is cold.
"""

from __future__ import annotations

import inspect
import os
import sys

try:
    from . import wire
except ImportError:  # run as a script by another virtualenv's python
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import wire

# The instruction sentence from AuK's own example. The reference clip goes in
# as a second content part; the model is told to reuse its voice.
DEFAULT_LEAD = "Say the following with the same voice"

SEPARATION_METHODS = ("separate", "source_separation", "separate_audio", "denoise")


def load(config_path: str, ckpt_path: str, cpu_offload: bool = False):
    """Construct AukInfer, passing cpu_offload only if this build takes it."""
    from auk.infer.infer_auk import AukInfer

    kwargs, warnings = {}, []
    if cpu_offload:
        try:
            params = inspect.signature(AukInfer).parameters
        except (TypeError, ValueError):
            params = {}
        if "cpu_offload" in params:
            kwargs["cpu_offload"] = True
        else:
            warnings.append("this AuK build's AukInfer does not accept cpu_offload; "
                            "the flag was ignored and the model is fully resident")
            print(warnings[-1], file=sys.stderr)
    engine = AukInfer(config_path, ckpt_path, **kwargs)
    engine._music_creator_warnings = warnings  # surfaced in the job result
    return engine


def _messages(text: str, reference_path: str, instruction: str | None) -> tuple[list, str]:
    lead = (instruction or DEFAULT_LEAD).strip().rstrip(":")
    prompt = f"{lead}: '{text}'"
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "audio", "audio": reference_path},
        ],
    }]
    return messages, prompt


def _duration(audio, sample_rate) -> float | None:
    try:
        count = audio.shape[-1] if hasattr(audio, "shape") else len(audio)
        return round(float(count) / float(sample_rate), 3)
    except Exception:
        return None


def run_speak(engine, spec: dict, report) -> dict:
    from auk.infer.infer_auk import save_audio

    text = spec["text"]
    reference = spec["reference_path"]
    if not os.path.exists(reference):
        raise FileNotFoundError(f"reference clip not found: {reference}")
    out_path = spec["out_path"]
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    messages, prompt = _messages(text, reference, spec.get("instruction"))
    kwargs = {}
    if spec.get("gen_seconds") is not None:
        kwargs["gen_seconds"] = float(spec["gen_seconds"])

    report("generating speech", 0.3)
    audio, sample_rate = engine.generate(messages, **kwargs)

    report("writing wav", 0.9)
    save_audio(audio, sample_rate, out_path)
    return {
        "audio_path": os.path.abspath(out_path),
        "sample_rate": int(sample_rate) if sample_rate else None,
        "duration_s": _duration(audio, sample_rate),
        "prompt": prompt,
        "reference_path": os.path.abspath(reference),
        "warnings": list(getattr(engine, "_music_creator_warnings", [])),
    }


def run_separate(engine, spec: dict, report) -> dict:
    """Best effort against an entry point this server did not design.

    AuK's model card lists separation as a capability but the published
    example only covers generation, so the calling convention here is derived
    from whatever method the installed build actually exposes: its first
    positional parameter gets the input path, and any parameter obviously
    meaning "mode" or "output path" gets filled in. If the return value is not
    a shape this can save, it says so instead of writing a file and calling it
    a stem. The endpoint returns 501 when no such method exists at all.
    """
    from auk.infer.infer_auk import save_audio

    method = next((getattr(engine, name) for name in SEPARATION_METHODS
                   if callable(getattr(engine, name, None))), None)
    if method is None:
        raise RuntimeError("this AuK build exposes no separation method on AukInfer")

    source = spec["audio_path"]
    out_path = spec["out_path"]
    mode = spec.get("mode", "vocals")
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    try:
        params = list(inspect.signature(method).parameters)
    except (TypeError, ValueError):
        params = []
    kwargs = {}
    for name in params[1:]:
        low = name.lower()
        if low in ("mode", "task", "target", "stem"):
            kwargs[name] = mode
        elif low in ("output", "out_path", "output_path", "save_path", "out_file"):
            kwargs[name] = out_path

    report(f"separating ({mode}) with {method.__name__}()", 0.3)
    returned = method(source, **kwargs)

    report("writing wav", 0.9)
    written = None
    if isinstance(returned, str) and os.path.exists(returned):
        written = returned
    elif isinstance(returned, tuple) and len(returned) == 2:
        audio, sample_rate = returned
        save_audio(audio, sample_rate, out_path)
        written = out_path
    elif isinstance(returned, dict):
        for key in (mode, "audio", "wav", "output"):
            value = returned.get(key)
            if isinstance(value, str) and os.path.exists(value):
                written = value
                break
            if isinstance(value, tuple) and len(value) == 2:
                save_audio(value[0], value[1], out_path)
                written = out_path
                break
    elif os.path.exists(out_path):
        written = out_path

    if not written:
        raise RuntimeError(
            f"{method.__name__}() returned {type(returned).__name__}, which this server does not know "
            "how to save. Nothing was written. See the README section 'Separation'."
        )
    return {"audio_path": os.path.abspath(written), "mode": mode, "method": method.__name__,
            "warnings": list(getattr(engine, "_music_creator_warnings", []))}


def _handle(payload: dict, stage) -> dict:
    task = payload.get("task")
    stage("loading AuK", 0.05)
    engine = load(payload["config"], payload["ckpt"], cpu_offload=bool(payload.get("cpu_offload")))
    if task == "speak":
        return run_speak(engine, payload, stage)
    if task == "separate":
        return run_separate(engine, payload, stage)
    raise ValueError(f"unknown task {task!r}")


if __name__ == "__main__":
    raise SystemExit(wire.main(_handle))
