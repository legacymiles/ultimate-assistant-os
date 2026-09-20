"""Correctness checks for the streaming changes (GPU + weights required for
the VAE test; the ring/camera tests run anywhere).

    python server/test_streaming.py

1. FrameRing samples a 30 fps feed down to 16 fps and hands out the newest frames.
2. CameraController: no keys → identity pose; W → unit step along +z.
3. VAE streaming == VAE batch: encoding 13 frames as [1] + [4] + [4] + [4]
   through encode_stream, and decoding the 4 latents one at a time through
   decode_stream, reproduces encode()/decode() of the whole clip within
   bf16 tolerance. This is what makes chunk-by-chunk generation the same
   computation as one long clip.
"""

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DEFAULT_ASSETS, FrameRing, LINGBOT_DIR  # noqa: E402


def test_ring():
    ring = FrameRing(fps=16, capacity=64)
    t = 1000.0
    for i in range(60):  # 2 s at 30 fps
        ring.push(np.full((2, 2, 3), i, dtype=np.uint8), t + i / 30)
    assert 30 <= ring.kept <= 34, ring.kept
    latest = ring.take_latest(4)
    assert latest is not None and len(latest) == 4
    assert latest[-1][0][0, 0, 0] >= 57, "newest frame must be near the end of the feed"
    assert ring.take_latest(1) is None, "take_latest drains the ring"
    print("ring ok:", ring.kept, "kept of", ring.received)


def test_camera():
    import torch
    from wan.streaming import CameraController
    cam = CameraController(move_step=1.0, turn_step_deg=2.0)
    assert not cam.moving
    assert torch.allclose(cam.relative_pose(), torch.eye(4))
    cam.set_keys(["w"])
    p = cam.relative_pose()
    assert torch.allclose(p[:3, 3], torch.tensor([0.0, 0.0, 1.0]))
    cam.set_keys(["ArrowRight"])
    p = cam.relative_pose()
    assert abs(float(p[0, 2])) > 0.03 and torch.allclose(p[:3, 3], torch.zeros(3))
    print("camera ok")


def test_vae_stream():
    import torch
    from wan.modules.vae2_1 import Wan2_1_VAE
    path = os.path.join(DEFAULT_ASSETS, "Wan2.1_VAE.pth")
    if not os.path.isfile(path):
        print("vae test skipped (no weights at", path, ")")
        return
    dev = torch.device("cuda")
    vae = Wan2_1_VAE(vae_pth=path, dtype=torch.bfloat16, device=dev)
    torch.manual_seed(0)
    # a smooth moving pattern, 13 frames, 96x128
    T, H, W = 13, 96, 128
    yy, xx = torch.meshgrid(torch.linspace(-1, 1, H), torch.linspace(-1, 1, W), indexing="ij")
    frames = []
    for i in range(T):
        f = torch.stack([torch.sin(3 * xx + 0.2 * i), torch.cos(2 * yy - 0.15 * i), torch.sin(xx * yy * 4 + 0.1 * i)])
        frames.append(f)
    video = torch.stack(frames, 1).to(dev)  # [3, T, H, W]

    with torch.no_grad():
        z_batch = vae.encode([video])[0]  # [16, 4, 12, 16]
        vae.stream_reset()
        z_stream = torch.cat([
            vae.encode_stream(video[:, 0:1]),
            vae.encode_stream(video[:, 1:5]),
            vae.encode_stream(video[:, 5:9]),
            vae.encode_stream(video[:, 9:13]),
        ], dim=1)
        enc_err = (z_batch - z_stream).abs().max().item()
        enc_scale = z_batch.abs().max().item()

        x_batch = vae.decode([z_batch])[0]  # [3, 13, H, W]
        vae.stream_reset()
        x_stream = torch.cat([vae.decode_stream(z_batch[:, i:i + 1]) for i in range(4)], dim=1)
        dec_err = (x_batch - x_stream).abs().max().item()
        recon_err = (x_batch - video).abs().mean().item()
    assert z_stream.shape == z_batch.shape and x_stream.shape == x_batch.shape
    assert enc_err <= 0.02 * enc_scale + 1e-3, f"stream encode differs from batch: {enc_err} (scale {enc_scale})"
    assert dec_err <= 0.03, f"stream decode differs from batch: {dec_err}"
    print(f"vae stream ok: encode max|diff|={enc_err:.4g} (scale {enc_scale:.3g}), "
          f"decode max|diff|={dec_err:.4g}, batch reconstruction mean|err|={recon_err:.3f}")
    # a timing hint for the benchmark
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    with torch.no_grad():
        for _ in range(3):
            vae.decode_stream(z_batch[:, 1:2])
    torch.cuda.synchronize()
    print(f"decode_stream 1 latent @ {W}x{H}: {(time.perf_counter() - t0) / 3 * 1000:.1f} ms")


def test_mask():
    """set_mask resamples to the latent grid, and the region lock is exactly
    `keep the camera where the mask is 0`. No GPU weights needed."""
    import torch
    from wan.streaming import CausalStream

    s = CausalStream.__new__(CausalStream)
    s.device = "cuda" if torch.cuda.is_available() else "cpu"
    s.lat_h, s.lat_w = 24, 32

    # A half-and-half mask at a different resolution than the latent grid:
    # left half editable, right half pinned to the camera.
    src = np.zeros((48, 64), dtype=np.uint8)
    src[:, :32] = 255
    s.set_mask(src)
    assert tuple(s.mask.shape) == (1, 1, 24, 32), s.mask.shape
    assert 0.45 <= s.mask_coverage <= 0.55, s.mask_coverage
    assert s.mask[0, 0, 12, 2] > 0.9, "left half should be editable"
    assert s.mask[0, 0, 12, 29] < 0.1, "right half should be pinned"
    edge = s.mask[0, 0, 12, 14:18]
    assert ((edge > 0.01) & (edge < 0.99)).any(), "the edge must be feathered, not hard"

    # The blend the step loop performs.
    z = torch.zeros(16, 1, 24, 32, device=s.device)       # "camera"
    gen = torch.ones(16, 1, 24, 32, device=s.device)      # "model"
    out = torch.lerp(z, gen, s.mask)
    assert out[:, :, :, 0].max() > 0.9, "model output must survive inside the mask"
    assert out[:, :, :, -1].abs().max() < 0.1, "camera must survive outside the mask"

    # uint8 and float inputs must agree, and None clears.
    s.set_mask(src.astype(np.float32) / 255.0)
    assert 0.45 <= s.mask_coverage <= 0.55, s.mask_coverage
    s.set_mask(None)
    assert s.mask is None and s.mask_coverage == 1.0
    print(f"mask ok: {s.lat_w}x{s.lat_h} latent grid, feathered edge, blend verified")


def test_mask_live(args=None):
    """The region lock end to end on the real model: with a half-and-half
    mask, the pinned half of the generated frame must come back as the camera
    while the free half is visibly repainted. Needs the GPU and the weights.
    """
    import argparse

    import torch
    from common import DEFAULT_CKPT, add_model_args, build_pipeline, open_stream

    if not os.path.isdir(DEFAULT_CKPT):
        print("mask_live skipped (no weights at", DEFAULT_CKPT, ")")
        return
    if args is None:
        p = argparse.ArgumentParser()
        add_model_args(p)
        args = p.parse_args(["--size", "192*256", "--local_attn_size", "6", "--sink_size", "2"])
    args.cond_mode = "masked"

    pipe = build_pipeline(args)
    rng = np.random.default_rng(0)

    def camera_frames(n, t):
        """A frame with structure on both halves so a repaint is obvious."""
        h, w = 192, 256
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        base = (np.sin(xx / 9 + t) * 0.5 + 0.5) * (np.cos(yy / 11 - t) * 0.5 + 0.5)
        img = np.stack([base, base * 0.6 + 0.2, 1 - base], -1) * 255
        return np.repeat(img[None].astype(np.uint8), n, axis=0)

    anchor = camera_frames(1, 0.0)[0]
    stream = open_stream(pipe, args, anchor, prompt=args.prompt)

    # Left half free, right half pinned to the camera.
    mask = np.zeros((48, 64), dtype=np.uint8)
    mask[:, :32] = 255
    stream.set_mask(mask)

    held_err = free_err = None
    for step in range(3):
        frames = camera_frames(stream.frames_needed, 0.3 * (step + 1))
        out, stats = stream.step(frames)
        # Compare the last generated frame against the camera frame that fed it.
        gen = out[-1].astype(np.float32)
        cam = frames[-1].astype(np.float32)
        if gen.shape != cam.shape:  # the stream may run at its own size
            continue
        mid = gen.shape[1] // 2
        free_err = np.abs(gen[:, :mid] - cam[:, :mid]).mean()
        held_err = np.abs(gen[:, mid:] - cam[:, mid:]).mean()

    assert held_err is not None, "no comparable frame came back"
    print(f"mask_live: held half mean|gen-cam| = {held_err:.1f}, "
          f"free half = {free_err:.1f} (0-255 scale), coverage {stream.mask_coverage:.2f}")
    assert held_err < 12, f"pinned half drifted from the camera: {held_err:.1f}"
    assert free_err > held_err * 2, (
        f"free half was not repainted: free {free_err:.1f} vs held {held_err:.1f}")


if __name__ == "__main__":
    sys.path.insert(0, LINGBOT_DIR)
    test_ring()
    test_camera()
    test_mask()
    if "--live" in sys.argv:
        test_mask_live()
    else:
        test_vae_stream()
    print("all checks passed")
