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


if __name__ == "__main__":
    sys.path.insert(0, LINGBOT_DIR)
    test_ring()
    test_camera()
    test_vae_stream()
    print("all checks passed")
