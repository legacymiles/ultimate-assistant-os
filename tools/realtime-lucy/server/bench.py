"""Realtime Lucy benchmark: real camera frames through the real model.

    python server/bench.py --chunks 8 --chunk_size 1 --strength 2

Captures from the webcam (or a video file), runs N streaming steps, and
writes:
  * bench-<tag>.json  — per-chunk timings, fps, VRAM, config
  * bench-<tag>.mp4   — camera | generated, side by side, at 16 fps

Capture time is excluded from the timings; each step is timed end to end
from uint8 frames in to uint8 frames out (VAE encode, denoise, KV update,
VAE decode) with CUDA synchronised at every boundary.
"""

import argparse
import json
import logging
import os
import sys
import time

import numpy as np

from common import (FrameRing, MODEL_FPS, add_model_args, build_pipeline,
                    open_stream)


def grab_frames(cap, n, is_cam, fps=MODEL_FPS):
    """Read n frames sampled to `fps` (RGB uint8): by wall clock from a
    camera, by frame stride from a video file."""
    import cv2
    out = []
    if is_cam:
        period = 1.0 / fps
        last = 0.0
        while len(out) < n:
            ok, bgr = cap.read()
            if not ok:
                raise RuntimeError("camera returned no frame")
            now = time.perf_counter()
            if now - last >= period * 0.98:
                last = now
                out.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    else:
        stride = max(1, round((cap.get(cv2.CAP_PROP_FPS) or fps) / fps))
        while len(out) < n:
            for _ in range(stride):
                ok, bgr = cap.read()
                if not ok:
                    raise RuntimeError("video ended before enough frames were read")
            out.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    return np.stack(out)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_model_args(p)
    p.add_argument("--chunks", type=int, default=8)
    p.add_argument("--source", default="0", help="webcam index or a video file")
    p.add_argument("--cam_width", type=int, default=640)
    p.add_argument("--cam_height", type=int, default=480)
    p.add_argument("--out_dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bench"))
    p.add_argument("--tag", default=None)
    p.add_argument("--keys", default="", help="comma-separated keys held for the whole run, e.g. w or arrowright")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s",
                        handlers=[logging.StreamHandler(sys.stdout)])
    import cv2
    import torch

    src = int(args.source) if args.source.isdigit() else args.source
    cap = cv2.VideoCapture(src, cv2.CAP_DSHOW if isinstance(src, int) and os.name == "nt" else 0)
    if isinstance(src, int):
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.cam_width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.cam_height)
    if not cap.isOpened():
        raise SystemExit(f"could not open camera/video {args.source}")
    ok, first = cap.read()
    if not ok:
        raise SystemExit("camera gave no frame")
    logging.info(f"camera frame {first.shape[1]}x{first.shape[0]}")

    pipe = build_pipeline(args)
    tag = args.tag or f"{args.size.replace('*', 'x')}_cs{args.chunk_size}_s{args.strength}_kv{args.local_attn_size}"
    os.makedirs(args.out_dir, exist_ok=True)

    t0 = time.perf_counter()
    anchor = cv2.cvtColor(first, cv2.COLOR_BGR2RGB)
    stream = open_stream(pipe, args, anchor)
    if args.keys:
        stream.set_keys([k.strip() for k in args.keys.split(",") if k.strip()])
    open_ms = (time.perf_counter() - t0) * 1000
    logging.info(f"stream opened in {open_ms:.0f} ms: {stream.describe()}")

    rows = []
    cam_frames = []
    gen_frames = []
    pending = [anchor]  # the anchor is frame 0 of chunk 0
    for i in range(args.chunks):
        need = stream.frames_needed
        while len(pending) < need:
            pending.extend(list(grab_frames(cap, need - len(pending), isinstance(src, int))))
        frames = np.stack(pending[:need])
        pending = pending[need:]
        out, stats = stream.step(frames)
        rows.append(stats)
        cam_frames.extend(list(frames))
        gen_frames.extend(list(out))
        logging.info(
            f"chunk {stats['chunk_id']}: total {stats['total_ms']:.0f} ms "
            f"(enc {stats['encode_ms']:.0f} / denoise {stats['denoise_ms']:.0f} / "
            f"kv {stats['kv_update_ms']:.0f} / dec {stats['decode_ms']:.0f}), "
            f"{stats['frames_out']} frames -> {stats['gen_fps']:.2f} fps, "
            f"peak VRAM {stats['peak_vram_mb']:.0f} MB")
    cap.release()

    steady = rows[1:] if len(rows) > 1 else rows
    summary = {
        "config": {
            **{k: v for k, v in vars(args).items()},
            "stream": stream.describe(),
            "gpu": torch.cuda.get_device_name(0),
            "torch": torch.__version__,
        },
        "open_ms": open_ms,
        "chunks": rows,
        "steady_state": {
            "mean_total_ms": float(np.mean([r["total_ms"] for r in steady])),
            "mean_denoise_ms": float(np.mean([r["denoise_ms"] for r in steady])),
            "mean_decode_ms": float(np.mean([r["decode_ms"] for r in steady])),
            "mean_encode_ms": float(np.mean([r["encode_ms"] for r in steady])),
            "mean_kv_update_ms": float(np.mean([r["kv_update_ms"] for r in steady])),
            "gen_fps": float(np.mean([r["gen_fps"] for r in steady])),
            "realtime_factor": float(np.mean([r["gen_fps"] for r in steady])) / MODEL_FPS,
            "peak_vram_mb": float(max(r["peak_vram_mb"] for r in rows)),
            "chunk_capture_ms": 1000 * 4 * args.chunk_size / MODEL_FPS,
            "min_glass_to_glass_ms": 1000 * 4 * args.chunk_size / MODEL_FPS
            + float(np.mean([r["total_ms"] for r in steady])),
        },
    }
    json_path = os.path.join(args.out_dir, f"bench-{tag}.json")
    with open(json_path, "w") as f:
        json.dump(summary, f, indent=2)

    # side-by-side proof video
    import imageio
    h, w = gen_frames[0].shape[:2]
    mp4_path = os.path.join(args.out_dir, f"bench-{tag}.mp4")
    with imageio.get_writer(mp4_path, fps=MODEL_FPS, codec="libx264", quality=8,
                            macro_block_size=1) as wr:
        for cam, gen in zip(cam_frames, gen_frames):
            cam_r = cv2.resize(cam, (w, h), interpolation=cv2.INTER_AREA)
            wr.append_data(np.concatenate([cam_r, gen], axis=1))
    s = summary["steady_state"]
    print("\n=== Realtime Lucy benchmark ===")
    print(f"GPU: {summary['config']['gpu']}  size {stream.w}x{stream.h}  chunk {args.chunk_size} latent "
          f"({4 * args.chunk_size} frames)  strength {args.strength} ({stream.STRENGTH_LABELS[args.strength]})")
    print(f"steady-state step: {s['mean_total_ms']:.0f} ms  (denoise {s['mean_denoise_ms']:.0f}, "
          f"kv {s['mean_kv_update_ms']:.0f}, decode {s['mean_decode_ms']:.0f}, encode {s['mean_encode_ms']:.0f})")
    print(f"generated fps: {s['gen_fps']:.2f}  ({s['realtime_factor'] * 100:.0f}% of real time at 16 fps)")
    print(f"min glass-to-glass: {s['min_glass_to_glass_ms']:.0f} ms  peak VRAM: {s['peak_vram_mb']:.0f} MB")
    print(f"wrote {json_path}\nwrote {mp4_path}")


if __name__ == "__main__":
    main()
