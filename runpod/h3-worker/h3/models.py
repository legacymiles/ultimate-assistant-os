"""Which H3 weight files the worker needs, and getting them onto the volume.

The full official release is ~500 GB and bf16 only. What actually fits on one
serverless GPU is the Comfy-Org repack, and the minimum working set is about
42 GB:

    diffusion transformer   ~21 GB   (pruned + quantised)
    text encoder            ~16 GB   (Qwen3-VL 32B, NVFP4-AWQ)
    video VAE                ~5 GB
    audio VAE                ~0.6 GB
    turbo LoRA               ~2 GB   (8 steps instead of 20)

These land on the RunPod network volume, not in the container image. A
container image carrying 42 GB is punishing to pull on every new host,
whereas the volume is written once and then read by every worker in that
datacenter for as long as the endpoint exists.

Reference-to-video needs a second transformer of its own, so it is opt-in:
downloading it doubles both the wait and the storage bill, and a project that
never attaches a reference image never needs it.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path

REPO = os.environ.get("H3_MODEL_REPO", "Comfy-Org/MiniMax-H3")

# Pinned so a silent upstream re-quantisation cannot change what a worker
# renders. Override only deliberately.
REVISION = os.environ.get("H3_MODEL_REVISION", "main")

# Where ComfyUI expects to find things, relative to a models root.
MODELS_ROOT = Path(os.environ.get("H3_MODELS_DIR", "/runpod-volume/models"))

# Comfy-Org recommend `pruned_int8_convrot` but only on a CUDA 13 PyTorch.
# This worker builds on RunPod's ComfyUI base image, which is CUDA 12.8, so
# the correct default here is `pruned_fp8_scaled` — same size, no cu130
# requirement, and fp8 is native on Ada and Blackwell. Switch to
# `pruned_int8_convrot` only if you rebuild on a cu130 base.
DIT_VARIANT = os.environ.get("H3_DIT_VARIANT", "pruned_fp8_scaled")


@dataclass(frozen=True)
class Weight:
    """One file to fetch. `approx_gb` is only used for progress reporting."""

    path: str
    approx_gb: float
    why: str


def base_weights() -> list[Weight]:
    """Everything needed for text-to-video and first/last-frame video."""
    return [
        Weight(
            f"diffusion_models/minimax_h3_fl2va_{DIT_VARIANT}.safetensors",
            21.0,
            "the diffusion transformer, text/keyframe partition",
        ),
        Weight(
            "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
            15.7,
            "the Qwen3-VL conditioner that reads the prompt",
        ),
        Weight("vae/minimax_h3_video_vae_fp16.safetensors", 5.2, "the video VAE"),
        Weight("vae/minimax_h3_audio_vae_fp32.safetensors", 0.6, "the audio VAE"),
        Weight(
            "loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
            2.0,
            "the turbo LoRA, 8 steps instead of 20",
        ),
    ]


def reference_weights() -> list[Weight]:
    """The extra transformer and LoRA for reference-to-video."""
    return [
        Weight(
            f"diffusion_models/minimax_h3_ref2va_{DIT_VARIANT}.safetensors",
            21.0,
            "the diffusion transformer, reference partition",
        ),
        Weight(
            "loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
            2.0,
            "the reference turbo LoRA, 4 steps",
        ),
    ]


def wanted(include_reference: bool) -> list[Weight]:
    return base_weights() + (reference_weights() if include_reference else [])


def local_path(weight: Weight) -> Path:
    return MODELS_ROOT / weight.path


def missing(include_reference: bool) -> list[Weight]:
    """Which wanted files are not on the volume yet."""
    return [w for w in wanted(include_reference) if not local_path(w).exists()]


def total_gb(weights: list[Weight]) -> float:
    return round(sum(w.approx_gb for w in weights), 1)


def free_gb(path: Path) -> float:
    try:
        return round(shutil.disk_usage(path).free / 1e9, 1)
    except OSError:
        return 0.0


def ensure(include_reference: bool, on_progress=None) -> list[str]:
    """Download whatever is missing. Returns human-readable notes.

    Each file is fetched into place individually rather than with a whole-repo
    snapshot: the repo is ~477 GB and a stray glob would try to pull all of
    it. Failures raise, because a worker that renders with half a model
    produces garbage that looks like a bad prompt.
    """
    from huggingface_hub import hf_hub_download  # imported late; heavy

    MODELS_ROOT.mkdir(parents=True, exist_ok=True)
    todo = missing(include_reference)
    notes: list[str] = []
    if not todo:
        return ["weights already on the volume"]

    need = total_gb(todo)
    have = free_gb(MODELS_ROOT)
    if have and have < need * 1.1:
        raise RuntimeError(
            f"Need about {need} GB for the model but the volume has {have} GB free. "
            "Grow the network volume (its size can be increased but never reduced)."
        )

    for i, w in enumerate(todo, 1):
        note = f"Downloading {i}/{len(todo)}: {Path(w.path).name} (~{w.approx_gb} GB) — {w.why}"
        notes.append(note)
        if on_progress:
            on_progress(note)
        target = local_path(w)
        target.parent.mkdir(parents=True, exist_ok=True)
        cached = hf_hub_download(
            repo_id=REPO,
            filename=w.path,
            revision=REVISION,
            local_dir=str(MODELS_ROOT),
            token=os.environ.get("HF_TOKEN") or None,
        )
        # hf_hub_download with local_dir already writes to the right place;
        # this only matters if a future hub version changes that.
        if Path(cached).resolve() != target.resolve() and not target.exists():
            shutil.copy2(cached, target)

    return notes


def extra_model_paths_yaml() -> str:
    """Point ComfyUI at the volume instead of its own bundled models dir."""
    return (
        "runpod_volume:\n"
        f"  base_path: {MODELS_ROOT}\n"
        "  diffusion_models: diffusion_models\n"
        "  text_encoders: text_encoders\n"
        "  vae: vae\n"
        "  loras: loras\n"
    )
