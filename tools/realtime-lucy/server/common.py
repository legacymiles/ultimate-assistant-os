"""Shared pieces for the Realtime Lucy server and benchmark: pipeline
construction from CLI flags, and a frame ring that samples a live camera
down to the model's 16 fps."""

import argparse
import logging
import os
import sys
import threading
import time
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
LINGBOT_DIR = os.path.join(os.path.dirname(HERE), "lingbot")
if LINGBOT_DIR not in sys.path:
    sys.path.insert(0, LINGBOT_DIR)

DEFAULT_ROOT = os.path.join(os.path.expanduser("~"), "realtime-lucy")
DEFAULT_CKPT = os.path.join(DEFAULT_ROOT, "models", "lingbot-world-v2-1.3b-causal-fast")
DEFAULT_ASSETS = os.path.join(DEFAULT_ROOT, "models", "lingbot-world-v2-assets")
DEFAULT_PROMPT_CACHE = os.path.join(DEFAULT_ROOT, "prompt-cache")

MODEL_FPS = 16  # wan_shared_cfg.sample_fps — the frame rate the model was trained at

DEFAULT_PROMPT = (
    "A person in a softly lit room, cinematic film look, natural motion, "
    "rich colour, gentle depth of field."
)


def add_model_args(p: argparse.ArgumentParser):
    p.add_argument("--task", default="i2v-1.3B", choices=["i2v-1.3B", "i2v-A14B"])
    p.add_argument("--ckpt_dir", default=DEFAULT_CKPT)
    p.add_argument("--assets_dir", default=DEFAULT_ASSETS,
                   help="folder with Wan2.1_VAE.pth, models_t5_umt5-xxl-enc-bf16.pth, google/umt5-xxl")
    p.add_argument("--size", default="288*384",
                   help="H*W budget; the actual size keeps the camera's aspect ratio")
    p.add_argument("--chunk_size", type=int, default=1,
                   help="latent frames per step (1 latent = 4 pixel frames = 250 ms at 16 fps)")
    p.add_argument("--local_attn_size", type=int, default=9, help="KV window in latent frames")
    p.add_argument("--sink_size", type=int, default=3, help="latent frames pinned at the start of the KV window")
    p.add_argument("--strength", type=int, default=2,
                   help="0=free (ignore camera after anchor), 1=dreamy, 2=balanced, 3=faithful")
    p.add_argument("--cond_mode", default="sdedit", choices=["sdedit", "keyframe"])
    p.add_argument("--shift", type=float, default=None, help="flow shift (default: model config)")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--max_stream_latents", type=int, default=1000,
                   help="latent frames before the stream re-anchors on the live frame")
    p.add_argument("--vae_dtype", default="bf16", choices=["bf16", "fp32"])
    p.add_argument("--no_low_mem", action="store_true",
                   help="load T5 and the DiT the upstream way (needs ~20 GB host RAM)")
    p.add_argument("--prompt", default=DEFAULT_PROMPT)
    p.add_argument("--prompt_cache_dir", default=DEFAULT_PROMPT_CACHE)
    p.add_argument("--move_step", type=float, default=1.0)
    p.add_argument("--turn_step_deg", type=float, default=2.0)


def parse_size(size: str) -> int:
    h, w = size.replace("x", "*").split("*")
    return int(h) * int(w)


def build_pipeline(args):
    import torch
    import wan
    from wan.configs import WAN_CONFIGS

    cfg = WAN_CONFIGS[args.task]
    vae_dtype = torch.bfloat16 if args.vae_dtype == "bf16" else torch.float32
    t0 = time.perf_counter()
    pipe = wan.WanI2VCausal(
        config=cfg,
        checkpoint_dir=args.ckpt_dir,
        device_id=0,
        rank=0,
        t5_cpu=True,
        convert_model_dtype=True,
        local_attn_size=args.local_attn_size,
        sink_size=args.sink_size,
        infer_mode="causal_fast",
        assets_dir=args.assets_dir,
        low_mem=not args.no_low_mem,
        vae_dtype=vae_dtype,
    )
    logging.info(f"pipeline ready in {time.perf_counter() - t0:.1f}s; "
                 f"VRAM allocated {torch.cuda.memory_allocated() / 1e9:.2f} GB")
    return pipe


def open_stream(pipe, args, anchor, prompt=None):
    from wan.streaming import CameraController
    return pipe.open_stream(
        prompt=prompt or args.prompt,
        anchor=anchor,
        chunk_size=args.chunk_size,
        max_area=parse_size(args.size),
        shift=args.shift,
        seed=args.seed,
        strength=args.strength,
        cond_mode=args.cond_mode,
        max_stream_latents=args.max_stream_latents,
        camera=CameraController(args.move_step, args.turn_step_deg),
        prompt_cache_dir=args.prompt_cache_dir,
    )


class FrameRing:
    """Latest camera frames, sampled to `fps`, with capture timestamps.

    The inference loop always takes the newest frames it needs and drops the
    rest: when the GPU is slower than real time, the generated video follows
    what the camera sees now rather than replaying a growing backlog. The KV
    cache carries continuity on the generated side, so skipped input frames
    do not break the stream.
    """

    def __init__(self, fps=MODEL_FPS, capacity=64):
        self.period = 1.0 / fps
        self.frames = deque(maxlen=capacity)
        self.lock = threading.Lock()
        self.last_kept = 0.0
        self.received = 0
        self.kept = 0

    def push(self, frame, ts=None):
        ts = ts if ts is not None else time.time()
        self.received += 1
        if ts - self.last_kept < self.period * 0.98:
            return False
        self.last_kept = ts
        with self.lock:
            self.frames.append((frame, ts))
        self.kept += 1
        return True

    def take_latest(self, n):
        """Pop the newest n frames (oldest first) or None if not enough yet."""
        with self.lock:
            if len(self.frames) < n:
                return None
            items = list(self.frames)[-n:]
            self.frames.clear()
        return items

    def clear(self):
        with self.lock:
            self.frames.clear()

    def __len__(self):
        with self.lock:
            return len(self.frames)
