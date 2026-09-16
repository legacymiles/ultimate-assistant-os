# Realtime Lucy — Design Spec

**Date:** 2026-09-14
**Status:** Implemented in the same session (autonomous run; assumptions listed in §6)
**One-liner:** A hub app that streams the webcam to LingBot-World-V2's causal-fast world model on the user's GPU and streams the model's generated frames back over WebRTC — real inference, KV cache and VAE state kept between chunks, no visual tricks.

---

## 1. Goal & key facts

- **Upstream:** `robbyant/lingbot-world-v2` (code) + `robbyant/lingbot-world-v2-1.3b-causal-fast` / `-14b-causal-fast` (weights). Both **CC BY-NC-SA 4.0** → non-commercial only, share-alike. The portfolio use is non-commercial; any commercial deployment needs Robbyant's licence.
- **What the model is:** an image-to-video *world model* (Wan2.2-derived DiT with camera-control Plücker conditioning). `causal_fast` is a distilled 4-step, CFG-free variant sampled chunk-by-chunk with a rolling KV cache (local window + attention sink). It is **not** a video-to-video model: its inputs are one anchor image, a text prompt and a camera trajectory.
- **Machine at hand:** RTX 3050 Laptop 6 GB, 11.7 GB RAM (1.7 GB free), Python 3.12, no flash-attn. This sets the resolution/window defaults and forced the low-memory loaders.

## 2. Where a webcam stream can enter the model

Three genuine options were considered:

1. **SDEdit per chunk (chosen).** VAE-encode the last 4 camera frames (1 latent frame), noise the latent to the k-th timestep of the model's own 4-step schedule, run the remaining steps against the live KV cache, write the clean chunk into the cache, decode. Structure comes from the camera, look from the prompt and the model's memory of its own output. This is the same mechanism StreamDiffusion-style systems use, applied to a causal world model.
2. **Keyframe conditioning.** Feed the camera latents through the i2v conditioning channel `y` with the mask set to 1 for every frame. Cheap to add, but the model was trained with the mask on frame 0 only, so it is exposed as an experimental toggle, not the default.
3. **Re-anchor every chunk.** Restart the stream on every camera frame. Throws the KV memory away each time and costs a full T5/VAE prefix per chunk. Rejected.

## 3. Architecture

```
browser (Next.js /apps/realtime-lucy)
  getUserMedia → RTCPeerConnection (video sendrecv + "control" data channel)
  POST /offer (direct to http://localhost:8765, or via /api/realtime-lucy proxy when remote)
        │                                                ▲
        ▼ camera track                                   │ generated track + stats
tools/realtime-lucy/server/server.py  (aiohttp + aiortc, one GPU thread)
  FrameRing (samples 30 fps → 16 fps, keeps newest)
  CausalStream.step(frames) ── wan/streaming.py ── WanI2VCausal (vendored, modified)
  GeneratedTrack (paces frames at 16 fps, holds last frame if the GPU is behind)
```

**Components**

- `tools/realtime-lucy/lingbot/` — vendored upstream with in-place changes (`NOTICE.md` has the diff): streaming VAE, SDPA-capable cross-attn, extendable RoPE, low-memory T5/DiT loaders, `encode_prompt`, `open_stream`.
- `wan/streaming.py` — `CausalStream` (per-session state: caches, prefix condition, positions, schedule, generator) and `CameraController` (keys → framewise relative poses).
- `server/common.py` — pipeline factory from CLI flags; `FrameRing`.
- `server/bench.py` — real camera → N steps → JSON + side-by-side MP4.
- `server/server.py` — signalling, tracks, control channel, session lifecycle, re-anchoring.
- Hub: `src/lib/realtime-lucy/{protocol,client}.ts`, `src/components/realtime-lucy/RealtimeLucy.tsx`, `src/app/apps/realtime-lucy/page.tsx`, `src/app/api/realtime-lucy/[...path]/route.ts`, catalog entry.

## 4. Data flow per chunk (chunk_size = 1 latent)

1. Ring holds ≥4 sampled camera frames (≥1 for chunk 0: the anchor). Newest are taken; older ones dropped.
2. `encode_stream` → `z` [16,1,h/8,w/8] (encoder cache carried).
3. `y` = [mask; prefix latent for this position] (or [1; z] in keyframe mode); Plücker from the controller (identity when no keys).
4. `x_k = add_noise(z, ε, t_k)`; for i = k..3: `pred = DiT(x_i, t_i, kv_cache…)`; `x0 = x_i − σ_i·pred`; `x_{i+1} = add_noise(x0, ε', t_{i+1})`.
5. `DiT(x0, t=0)` to write the chunk into the KV cache (as upstream).
6. `decode_stream(x0)` → 4 frames (1 on chunk 0) → uint8 → output queue → WebRTC.
7. Stats (encode/denoise/kv/decode ms, fps, VRAM, position, glass-to-glass) → data channel.

## 5. Error handling & limits

- Model not loaded → `/offer` 503 with the reason; page shows "model loading" / "failed to load".
- A second browser replaces the running session (one GPU).
- Camera track ends / peer disconnects → session closed, GPU thread idles.
- Position reaches `max_stream_latents` (default 1000 ≈ 4 min) → automatic re-anchor on the live frame (visible cut; count shown in the UI). `extend_rope` also allows longer horizons, untested past training length.
- Prompt change → T5 encode (10–20 s block-streamed on a low-memory host, cached on disk after) while the stream keeps the old prompt; cross-attn cache refilled on the next forward.

## 6. Assumptions made autonomously

- Named **Realtime Lucy**, category Video, no hub-carousel preview (needs a camera permission).
- Default GPU config tuned for 6 GB: 288×384 (4:3 camera), chunk 1 latent, KV window 9 latents, sink 3, bf16 VAE. Flags cover larger GPUs; 14B via `--task i2v-A14B`.
- Default strength "Balanced" (start at schedule index 2, 3 denoise steps).
- The venv and weights live in `~/realtime-lucy` (outside OneDrive), not in the repo.

## 7. Testing

- `npx tsc --noEmit` for the hub.
- `server/bench.py` with the real laptop webcam: per-chunk timings, fps, peak VRAM, and an MP4 that shows camera | generated so the "real model output" claim is verifiable by eye.
- Browser: `/apps/realtime-lucy` → Go live against the local server; stats panel populated from the data channel.
