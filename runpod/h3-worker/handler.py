"""RunPod Serverless worker: one MiniMax H3 render per job.

Lifecycle, and why it is shaped this way:

  cold start ─ ensure ~42 GB of weights exist on the network volume
             ─ boot ComfyUI once, keep it for the life of the worker
  each job   ─ upload references, build the graph, render, return the clip

Everything expensive happens once. ComfyUI stays up between jobs, so a second
shot rendered while the worker is still warm skips both the download and the
model load — which is the whole reason to render a storyboard in one sitting
rather than one shot an hour.

Progress is reported continuously. On a cold start the caller would otherwise
watch a silent spinner for several billed minutes with no way to tell loading
from hanging.
"""

from __future__ import annotations

import base64
import binascii
import os
import re
import time
import traceback
from pathlib import Path

import runpod

from h3 import comfy, models
from h3.geometry import seconds_for_frames
from h3.workflow import build

# RunPod caps a job result at 10 MB on /run and 20 MB on /runsync. Base64
# inflates by a third, so anything near the cap goes to object storage
# instead. Kept well under to leave room for the rest of the payload.
INLINE_LIMIT_BYTES = int(os.environ.get("H3_INLINE_LIMIT_BYTES", 6_500_000))

DEFAULT_STEPS_TURBO = 8
DEFAULT_STEPS_BASE = 20

_ready = False
_boot_notes: list[str] = []


def _progress(job, message: str) -> None:
    """Surface a note on /status, and log it for the RunPod console."""
    print(f"[h3] {message}", flush=True)
    try:
        runpod.serverless.progress_update(job, message)
    except Exception:
        # Progress is a convenience; never let it fail a render.
        pass


def _decode_data_url(data_url: str) -> tuple[bytes, str]:
    """Split a data URL into bytes and a file extension."""
    match = re.match(r"^data:([^;,]+)(;base64)?,(.*)$", data_url, re.DOTALL)
    if not match:
        raise ValueError("reference is not a data URL")
    mime, is_b64, payload = match.group(1), bool(match.group(2)), match.group(3)
    if not is_b64:
        raise ValueError("only base64 data URLs are supported")
    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as e:
        raise ValueError(f"reference is not valid base64: {e}") from e
    ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
    }.get(mime.lower(), ".bin")
    return raw, ext


def _boot(job, want_reference: bool) -> None:
    """Cold-start work: weights, then ComfyUI. Runs at most once per worker."""
    global _ready
    if _ready and comfy.is_up():
        return

    started = time.time()
    _progress(job, "Warming up — checking model weights")

    todo = models.missing(want_reference)
    if todo:
        gb = models.total_gb(todo)
        _progress(job, f"Downloading {gb} GB of weights (first run only)")
        models.ensure(want_reference, on_progress=lambda n: _progress(job, n))
        _boot_notes.append(f"downloaded {gb} GB")
    else:
        _boot_notes.append("weights already on volume")

    _progress(job, "Starting ComfyUI")
    comfy.start(extra_model_paths=models.extra_model_paths_yaml())
    comfy.wait_until_ready(
        timeout_s=int(os.environ.get("H3_BOOT_TIMEOUT_S", "1800")),
        on_progress=lambda n: _progress(job, n),
    )
    _ready = True
    _boot_notes.append(f"ready in {int(time.time() - started)}s")
    _progress(job, f"Model ready ({int(time.time() - started)}s)")


def _upload_references(job, references: list[dict]) -> tuple[list[str], str | None]:
    """Put reference media into ComfyUI. Returns (image names, first frame)."""
    names: list[str] = []
    for i, ref in enumerate(references):
        data_url = ref.get("data_url") or ref.get("dataUrl") or ""
        if not data_url:
            continue
        kind = (ref.get("kind") or "image").lower()
        if kind != "image":
            # Video and audio references need a different ComfyUI loader path;
            # dropping them loudly beats silently rendering something else.
            _progress(job, f"Skipping {kind} reference — this worker handles image references only")
            continue
        raw, ext = _decode_data_url(data_url)
        label = re.sub(r"[^a-zA-Z0-9_.-]", "_", str(ref.get("label") or f"ref{i + 1}"))
        names.append(comfy.upload_image(f"{label}{ext}", raw))
    return names, None


def _return_video(job, data: bytes, summary: dict) -> dict:
    """Hand the clip back inline when small, via object storage when not."""
    size = len(data)
    bucket_configured = bool(os.environ.get("BUCKET_ENDPOINT_URL"))

    if bucket_configured:
        try:
            from runpod.serverless.utils import rp_upload

            tmp = Path("/tmp") / f"h3_{job.get('id', 'out')}.mp4"
            tmp.write_bytes(data)
            url = rp_upload.upload_file_to_bucket(file_name=tmp.name, file_location=str(tmp))
            tmp.unlink(missing_ok=True)
            return {"video_url": url, "bytes": size, **summary}
        except Exception as e:
            _progress(job, f"Upload to object storage failed ({e}); falling back to inline")

    if size > INLINE_LIMIT_BYTES:
        return {
            "error": (
                f"The clip is {size / 1e6:.1f} MB, over the {INLINE_LIMIT_BYTES / 1e6:.1f} MB a job result can "
                "carry. Configure BUCKET_ENDPOINT_URL / BUCKET_ACCESS_KEY_ID / BUCKET_SECRET_ACCESS_KEY on the "
                "endpoint so clips are uploaded instead, or render a shorter or smaller shot."
            ),
            "bytes": size,
            **summary,
        }

    return {"video_base64": base64.b64encode(data).decode("ascii"), "bytes": size, **summary}


def handler(job):
    job_input = job.get("input") or {}
    try:
        prompt = str(job_input.get("prompt") or "").strip()
        if not prompt:
            return {"error": "prompt is required"}

        references = [r for r in (job_input.get("references") or []) if isinstance(r, dict)]
        image_refs = [r for r in references if (r.get("kind") or "image").lower() == "image"]
        first_frame = job_input.get("first_frame") or job_input.get("firstFrame")
        want_reference = bool(image_refs) and not first_frame

        _boot(job, want_reference)

        # A caller can hand over a complete graph and bypass the builder.
        override = job_input.get("workflow")
        uploaded, _ = _upload_references(job, image_refs) if image_refs else ([], None)

        first_frame_name = None
        if first_frame:
            raw, ext = _decode_data_url(first_frame)
            first_frame_name = comfy.upload_image(f"first_frame{ext}", raw)

        if isinstance(override, dict) and override:
            graph, summary = override, {"mode": "custom workflow", "nodes": len(override)}
        else:
            use_lora = bool(job_input.get("turbo", True))
            steps = int(job_input.get("steps") or (DEFAULT_STEPS_TURBO if use_lora else DEFAULT_STEPS_BASE))
            lora = None
            if use_lora:
                lora = (
                    "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"
                    if want_reference
                    else "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
                )
                if want_reference:
                    steps = int(job_input.get("steps") or 4)

            dit = (
                f"minimax_h3_ref2va_{models.DIT_VARIANT}.safetensors"
                if want_reference
                else f"minimax_h3_fl2va_{models.DIT_VARIANT}.safetensors"
            )
            graph, summary = build(
                prompt=prompt,
                duration_sec=float(job_input.get("duration") or job_input.get("duration_sec") or 6),
                aspect_ratio=str(job_input.get("aspect_ratio") or job_input.get("aspectRatio") or "16:9"),
                resolution=str(job_input.get("resolution") or "768P"),
                dit_filename=dit,
                clip_filename="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                video_vae_filename="minimax_h3_video_vae_fp16.safetensors",
                audio_vae_filename="minimax_h3_audio_vae_fp32.safetensors",
                lora_filename=lora,
                steps=steps,
                seed=int(job_input.get("seed") or int(time.time() * 1000) % 2**31),
                first_frame_name=first_frame_name,
                reference_names=uploaded,
            )

        summary["seconds"] = seconds_for_frames(summary.get("frames", 0)) if summary.get("frames") else None
        summary["boot"] = "; ".join(_boot_notes[-3:])

        _progress(job, f"Rendering {summary.get('width', '?')}x{summary.get('height', '?')}, {summary.get('frames', '?')} frames")
        prompt_id = comfy.submit(graph)
        outputs = comfy.wait_for(
            prompt_id,
            timeout_s=int(job_input.get("timeout") or os.environ.get("H3_RENDER_TIMEOUT_S", "1800")),
            on_progress=lambda n: _progress(job, n),
        )

        found = comfy.find_video(outputs)
        if not found:
            return {"error": f"Render finished but produced no video. Outputs: {list(outputs)[:5]}", **summary}
        data = comfy.fetch_output(*found)
        return _return_video(job, data, summary)

    except Exception as e:
        traceback.print_exc()
        return {"error": f"{type(e).__name__}: {e}"}


def adjust_concurrency(_current: int) -> int:
    """One render per worker. H3 saturates the GPU it runs on."""
    return 1


runpod.serverless.start({"handler": handler, "concurrency_modifier": adjust_concurrency})
