"""realtime-lucy: live causal streaming on top of WanI2VCausal.

`WanI2VCausal._generate_causal_fast` is a one-shot job: one anchor image and a
complete camera trajectory go in, every chunk is denoised in a loop with a
rolling KV cache, and the whole latent video is VAE-decoded at the end.

`CausalStream` keeps the same model calls, the same KV-cache bookkeeping and
the same few-step schedule, but turns the loop inside out:

  * open_stream() does the per-generation setup once (text context, i2v
    conditioning prefix, KV/cross-attention caches, VAE stream state, RoPE
    horizon) and then waits;
  * step(frames) consumes the next 4·chunk_size webcam frames (4·chunk_size-3
    on the first call, whose first frame is the anchor), VAE-encodes them
    with the encoder's causal cache carried over, noises them to the chosen
    point of the distilled 4-step schedule (SDEdit), runs the remaining
    denoising steps against the live KV cache, writes the clean chunk into
    the cache exactly as generate() does, and VAE-decodes it with the
    decoder's causal cache carried over — returning pixel frames immediately.

Nothing here is a visual effect: every output frame is the DiT's own
prediction decoded by the VAE. The only conceptual change versus generate()
is where the noisy input of each chunk comes from — a noised encoding of the
real camera frames instead of pure Gaussian noise — and that the camera
trajectory is produced incrementally (static by default, or from held keys)
instead of being read from poses.npy up front.
"""

import logging
import math
import os
import sys
import time
from contextlib import contextmanager

import numpy as np
import torch
import torch.nn.functional as F
from einops import rearrange

from .utils.cam_utils import get_Ks_transformed, get_plucker_embeddings

_DEFAULT_INTRINSICS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "examples", "03", "intrinsics.npy")


def _rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def _rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


class CameraController:
    """Turns held keys into per-latent-frame relative camera poses.

    generate() feeds the DiT framewise relative poses (pose of latent frame i
    expressed in the frame of latent frame i-1, OpenCV axes: x right, y down,
    z forward) with translations normalised so the largest step has norm 1.
    A stream cannot normalise over a trajectory it has not seen, so the step
    size is fixed instead: `move_step` is the translation norm of one latent
    frame of steady motion (1.0 matches what normalisation produces for a
    steady example trajectory).
    """

    MOVE = {
        "w": (0, 0, 1), "s": (0, 0, -1), "a": (-1, 0, 0), "d": (1, 0, 0),
        "q": (0, -1, 0), "e": (0, 1, 0),
    }
    TURN = {"arrowleft": (0, -1), "arrowright": (0, 1),
            "arrowup": (-1, 0), "arrowdown": (1, 0)}

    def __init__(self, move_step=1.0, turn_step_deg=2.0):
        self.move_step = float(move_step)
        self.turn_step = math.radians(turn_step_deg)
        self.keys = set()

    def set_keys(self, keys):
        self.keys = {k.lower() for k in keys}

    @property
    def moving(self):
        return any(k in self.MOVE or k in self.TURN for k in self.keys)

    def relative_pose(self):
        """One latent frame's delta pose as a 4x4 matrix (float32 tensor)."""
        t = np.zeros(3)
        pitch = yaw = 0.0
        for k in self.keys:
            if k in self.MOVE:
                t += np.array(self.MOVE[k], dtype=np.float64)
            if k in self.TURN:
                dp, dy = self.TURN[k]
                pitch += dp * self.turn_step
                yaw += dy * self.turn_step
        n = np.linalg.norm(t)
        if n > 0:
            t = t / n * self.move_step
        pose = np.eye(4)
        pose[:3, :3] = _rot_y(yaw) @ _rot_x(pitch)
        pose[:3, 3] = t
        return torch.from_numpy(pose).float()

    def relative_poses(self, n):
        return torch.stack([self.relative_pose() for _ in range(n)])


class CausalStream:
    """A live generation session. Create through `WanI2VCausal.open_stream`."""

    STRENGTH_LABELS = {0: "free", 1: "dreamy", 2: "balanced", 3: "faithful"}

    def __init__(
        self,
        pipe,
        prompt,
        anchor,
        chunk_size=1,
        max_area=288 * 384,
        shift=None,
        seed=42,
        strength=2,
        cond_mode="sdedit",
        timesteps_index=(0, 250, 500, 750),
        max_stream_latents=1000,
        camera=None,
        intrinsics_path=None,
        prompt_cache_dir=None,
        max_sequence_length=512,
    ):
        assert pipe.infer_mode == "causal_fast", "streaming needs the distilled causal_fast model"
        assert cond_mode in ("sdedit", "keyframe")
        assert 0 <= strength <= len(timesteps_index) - 1
        assert chunk_size >= 1
        self.pipe = pipe
        self.chunk_size = int(chunk_size)
        self.strength = int(strength)
        self.cond_mode = cond_mode
        self.max_stream_latents = int(max_stream_latents)
        self.camera = camera or CameraController()
        self.prompt_cache_dir = prompt_cache_dir
        self.device = pipe.device
        cfg = pipe.config
        shift = cfg.sample_shift if shift is None else shift

        # --- geometry: identical derivation to generate() ------------------
        img = self._image_to_tensor(anchor)  # [3, H, W] in [-1, 1]
        H, W = img.shape[1:]
        aspect_ratio = H / W
        self.lat_h = round(np.sqrt(max_area * aspect_ratio) // pipe.vae_stride[1]
                           // pipe.patch_size[1] * pipe.patch_size[1])
        self.lat_w = round(np.sqrt(max_area / aspect_ratio) // pipe.vae_stride[2]
                           // pipe.patch_size[2] * pipe.patch_size[2])
        self.h = self.lat_h * pipe.vae_stride[1]
        self.w = self.lat_w * pipe.vae_stride[2]
        self.frame_seqlen = self.lat_h * self.lat_w // (pipe.patch_size[1] * pipe.patch_size[2])
        self.max_seq_len = self.chunk_size * self.frame_seqlen
        self.input_hw = (H, W)

        # --- text -----------------------------------------------------------
        self.prompt = None
        self.context = None
        self._cross_init = False
        self.set_prompt(prompt)

        # --- schedule (same scheduler object and indices as generate()) -----
        pipe.scheduler.set_timesteps(pipe.num_train_timesteps, shift=shift)
        self.timesteps = pipe.scheduler.timesteps[list(timesteps_index)]
        self.sigmas = [float(pipe.scheduler.sigmas[i]) for i in timesteps_index]

        seed = seed if seed >= 0 else int(torch.randint(0, 2**31 - 1, (1,)))
        self.gen = torch.Generator(device=self.device)
        self.gen.manual_seed(seed)

        # --- i2v conditioning prefix ---------------------------------------
        # generate() encodes [anchor, zeros × (F-1)] once and pairs latent 0
        # with a ones mask. The causal encoder settles into a steady state
        # a few latent frames into the zeros, so a short prefix is encoded
        # and its last latent stands in for every later chunk.
        n_prefix = max(8, 2 * self.chunk_size)
        anchor_resized = F.interpolate(img[None], size=(self.h, self.w),
                                       mode="bicubic", antialias=True)[0]
        self.anchor_resized = anchor_resized
        with torch.no_grad():
            self.y_lat = pipe.vae.encode([
                torch.cat([anchor_resized[:, None],
                           torch.zeros(3, 4 * (n_prefix - 1), self.h, self.w,
                                       device=self.device)], dim=1)
            ])[0]  # [16, n_prefix, lat_h, lat_w]

        # --- KV caches ------------------------------------------------------
        model_args = pipe.model.config
        if pipe.local_attn_size > -1:
            self.kv_latents = pipe.local_attn_size
        else:
            self.kv_latents = self.max_stream_latents + self.chunk_size
        self.kv_size = self.frame_seqlen * self.kv_latents
        head_dim = model_args.dim // model_args.num_heads
        self.self_kv = pipe._initialize_self_kv_cache(
            num_layers=model_args.num_layers,
            shape=[1, self.kv_size, model_args.num_heads // pipe.sp_size, head_dim],
            dtype=pipe.pipe_dtype, device=self.device)
        self.cross_kv = pipe._initialize_crossattn_cache(
            num_layers=model_args.num_layers,
            shape=[1, max_sequence_length, model_args.num_heads, head_dim],
            dtype=pipe.pipe_dtype, device=self.device)

        # --- positions / RoPE horizon --------------------------------------
        pipe.model.extend_rope(self.max_stream_latents + self.chunk_size)
        self.chunk_id = 0
        self.latent_pos = 0
        self.frames_in = 0
        self.frames_out = 0

        # --- camera ---------------------------------------------------------
        Ks = torch.from_numpy(np.load(intrinsics_path or _DEFAULT_INTRINSICS)).float()
        Ks = get_Ks_transformed(Ks, height_org=480, width_org=832,
                                height_resize=self.h, width_resize=self.w,
                                height_final=self.h, width_final=self.w)
        self.Ks = Ks[0:1].to(self.device)  # [1, 4]
        self._static_plucker = None

        # --- VAE stream state ----------------------------------------------
        pipe.vae.stream_reset()

        logging.info(
            f"CausalStream open: {self.w}x{self.h} (lat {self.lat_w}x{self.lat_h}, "
            f"{self.frame_seqlen} tok/frame), chunk={self.chunk_size} latent "
            f"frames, kv window={self.kv_latents} latents, strength={self.strength} "
            f"({self.STRENGTH_LABELS.get(self.strength)}, sigma="
            f"{self.sigmas[self.strength]:.3f}), cond={self.cond_mode}, "
            f"steps/chunk={len(self.timesteps) - self.strength}+1")

    # ------------------------------------------------------------------
    # controls
    # ------------------------------------------------------------------

    def set_prompt(self, prompt):
        if prompt == self.prompt:
            return
        self.prompt = prompt
        self.context = self.pipe.encode_prompt(prompt, disk_cache_dir=self.prompt_cache_dir)
        # the cross-attention K/V are recomputed from the new context on the
        # next DiT forward (WanCrossAttention refills the cache when told it
        # is the first call).
        self._cross_init = False

    def set_strength(self, k):
        k = int(k)
        assert 0 <= k < len(self.timesteps)
        self.strength = k

    def set_keys(self, keys):
        self.camera.set_keys(keys)

    @property
    def frames_needed(self):
        """Pixel frames the next step() call must receive."""
        return 4 * self.chunk_size - 3 if self.chunk_id == 0 else 4 * self.chunk_size

    @property
    def needs_reanchor(self):
        return self.latent_pos + self.chunk_size > self.max_stream_latents

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    def _image_to_tensor(self, img):
        if isinstance(img, torch.Tensor):
            t = img
        else:
            arr = np.asarray(img)
            t = torch.from_numpy(np.ascontiguousarray(arr)).permute(2, 0, 1)
        t = t.to(self.device)
        if t.dtype == torch.uint8:
            t = t.float().div_(127.5).sub_(1.0)
        return t

    def _frames_to_tensor(self, frames):
        """uint8 [T, H, W, 3] -> float [3, T, h, w] in [-1, 1] on device."""
        t = torch.from_numpy(np.ascontiguousarray(frames)).to(self.device)
        t = t.permute(0, 3, 1, 2).float().div_(127.5).sub_(1.0)  # [T, 3, H, W]
        if t.shape[-2:] != (self.h, self.w):
            t = F.interpolate(t, size=(self.h, self.w), mode="bicubic", antialias=True)
        return t.permute(1, 0, 2, 3).contiguous()

    def _plucker(self, rel_poses):
        """[cs, 4, 4] framewise relative poses -> [1, 384, cs, lat_h, lat_w]."""
        cs = rel_poses.shape[0]
        emb = get_plucker_embeddings(rel_poses.to(self.device),
                                     self.Ks.repeat(cs, 1), self.h, self.w)
        emb = rearrange(emb, "f (h c1) (w c2) c -> (f h w) (c c1 c2)",
                        c1=self.h // self.lat_h, c2=self.w // self.lat_w)[None]
        emb = rearrange(emb, "b (f h w) c -> b c f h w",
                        f=cs, h=self.lat_h, w=self.lat_w)
        return emb.to(self.pipe.param_dtype)

    def _plucker_for_chunk(self):
        if not self.camera.moving:
            if self._static_plucker is None:
                self._static_plucker = self._plucker(
                    torch.eye(4).repeat(self.chunk_size, 1, 1))
            return self._static_plucker
        return self._plucker(self.camera.relative_poses(self.chunk_size))

    def _condition(self, z):
        cs = self.chunk_size
        if self.cond_mode == "keyframe":
            mask = torch.ones(4, cs, self.lat_h, self.lat_w, device=self.device)
            return torch.cat([mask, z])
        i0 = self.chunk_id * cs
        idx = torch.arange(i0, i0 + cs, device=self.device).clamp_(max=self.y_lat.shape[1] - 1)
        y = self.y_lat[:, idx]
        mask = torch.zeros(4, cs, self.lat_h, self.lat_w, device=self.device)
        if self.chunk_id == 0:
            mask[:, 0] = 1.0
        return torch.cat([mask, y])

    # ------------------------------------------------------------------
    # the step
    # ------------------------------------------------------------------

    @torch.no_grad()
    def step(self, frames):
        """Consume `frames_needed` webcam frames (uint8 [T, H, W, 3]) and
        return (generated uint8 [T, h, w, 3], stats dict)."""
        pipe = self.pipe
        cs = self.chunk_size
        n_expected = self.frames_needed
        assert frames.shape[0] == n_expected, (
            f"step() expected {n_expected} frames for chunk {self.chunk_id}, got {frames.shape[0]}")
        if self.needs_reanchor:
            raise RuntimeError("stream reached max_stream_latents; re-anchor")

        @contextmanager
        def noop():
            yield

        no_sync = getattr(pipe.model, "no_sync", noop)
        timings = {}
        torch.cuda.synchronize(self.device)
        torch.cuda.reset_peak_memory_stats(self.device)
        t_start = time.perf_counter()

        with torch.amp.autocast("cuda", dtype=pipe.param_dtype), no_sync():
            x = self._frames_to_tensor(frames)
            z = pipe.vae.encode_stream(x)  # [16, cs, lat_h, lat_w] fp32
            torch.cuda.synchronize(self.device)
            t_enc = time.perf_counter()
            timings["encode_ms"] = (t_enc - t_start) * 1000

            y = self._condition(z)
            plucker = self._plucker_for_chunk()
            kwargs = {
                "context": [self.context[0]],
                "seq_len": self.max_seq_len,
                "y": [y],
                "dit_cond_dict": {"c2ws_plucker_emb": plucker.chunk(1, dim=0)},
                "kv_cache": self.self_kv,
                "crossattn_cache": self.cross_kv,
                "current_start": self.latent_pos * self.frame_seqlen,
                "max_attention_size": self.kv_size,
                "frame_seqlen": self.frame_seqlen,
            }

            k = self.strength
            noise = torch.randn(z.shape, generator=self.gen, device=self.device, dtype=torch.float32)
            if k == 0:
                current = noise
            else:
                current = pipe.scheduler.add_noise(z, noise, self.timesteps[k])

            x0 = None
            for ti in range(k, len(self.timesteps)):
                t = torch.stack([self.timesteps[ti]]).to(self.device)
                pred = pipe.model(x=[current], t=t,
                                  cross_attn_first_call=not self._cross_init,
                                  **kwargs)[0]
                self._cross_init = True
                x0 = pipe._convert_flow_pred_to_x0(
                    flow_pred=pred, xt=current, timestep=self.timesteps[ti],
                    scheduler=pipe.scheduler)
                if ti < len(self.timesteps) - 1:
                    current = pipe.scheduler.add_noise(
                        x0, torch.randn(x0.shape, generator=self.gen,
                                        device=x0.device, dtype=x0.dtype),
                        self.timesteps[ti + 1])
            torch.cuda.synchronize(self.device)
            t_den = time.perf_counter()
            timings["denoise_ms"] = (t_den - t_enc) * 1000

            # Write the clean chunk into the KV cache (t = 0 forward), as
            # generate() does after every chunk.
            t0 = torch.stack([self.timesteps[-1] * 0.0]).to(self.device)
            pipe.model(x=[x0], t=t0, cross_attn_first_call=False, **kwargs)
            torch.cuda.synchronize(self.device)
            t_kv = time.perf_counter()
            timings["kv_update_ms"] = (t_kv - t_den) * 1000

            out = pipe.vae.decode_stream(x0)  # [3, T_out, h, w]
            torch.cuda.synchronize(self.device)
            t_dec = time.perf_counter()
            timings["decode_ms"] = (t_dec - t_kv) * 1000

        frames_out = out.permute(1, 2, 3, 0).add_(1.0).mul_(127.5).round_() \
            .clamp_(0, 255).to(torch.uint8).cpu().numpy()

        self.chunk_id += 1
        self.latent_pos += cs
        self.frames_in += n_expected
        self.frames_out += frames_out.shape[0]
        total_ms = (time.perf_counter() - t_start) * 1000
        stats = {
            **timings,
            "total_ms": total_ms,
            "chunk_id": self.chunk_id - 1,
            "latent_pos": self.latent_pos,
            "frames_in": n_expected,
            "frames_out": int(frames_out.shape[0]),
            "gen_fps": frames_out.shape[0] / (total_ms / 1000),
            "peak_vram_mb": torch.cuda.max_memory_allocated(self.device) / 1e6,
            "strength": self.strength,
            "steps": len(self.timesteps) - self.strength,
        }
        return frames_out, stats

    def describe(self):
        return {
            "width": self.w, "height": self.h,
            "lat_w": self.lat_w, "lat_h": self.lat_h,
            "frame_seqlen": self.frame_seqlen,
            "chunk_size": self.chunk_size,
            "frames_per_chunk": 4 * self.chunk_size,
            "kv_latents": self.kv_latents,
            "kv_tokens": self.kv_size,
            "strength": self.strength,
            "sigmas": self.sigmas,
            "cond_mode": self.cond_mode,
            "max_stream_latents": self.max_stream_latents,
            "prompt": self.prompt,
        }
