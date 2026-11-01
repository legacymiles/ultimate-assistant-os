---
name: realtime-lucy-app
description: "Realtime Lucy — live webcam → LingBot-World-V2 causal-fast world model over WebRTC; hub app at /apps/realtime-lucy, GPU server in tools/realtime-lucy; licence is CC BY-NC-SA (non-commercial); laptop is 6 GB VRAM / 11.7 GB RAM"
metadata: 
  node_type: memory
  type: project
  originSessionId: 95168764-9dfd-48e4-903b-1a5d43975689
  modified: 2026-09-20T02:48:23.078Z
---

Realtime Lucy (2026-09-14): `/apps/realtime-lucy` + `tools/realtime-lucy/` (vendored
robbyant/lingbot-world-v2 @ 1895d30 with streaming changes applied in place, diff in
`lingbot/NOTICE.md`; `server/server.py` aiohttp+aiortc, `server/bench.py`, `wan/streaming.py`).

**Why:** the user wanted real model inference on the webcam, not effects. The model is an
image-to-video *world model* (anchor image + prompt + camera poses), so the webcam enters as
SDEdit: each chunk's camera frames are VAE-encoded, noised to schedule index k ("strength"),
denoised against the live KV cache, written into the cache, VAE-decoded. VAE stream ==
batch bit-exact (test_streaming.py). Licence CC BY-NC-SA 4.0 on code AND weights:
non-commercial only; commercial use needs Robbyant.

**How to apply:**
- Python env + weights live OUTSIDE the repo/OneDrive: `C:\Users\honey\realtime-lucy\{venv,models,prompt-cache}`.
  `$LOCALAPPDATA` inside this Claude shell points at the Claude app's sandbox — never use it for user files.
- This laptop: RTX 3050 6 GB, 11.7 GB RAM (~1.7 free). `low_mem` loaders are mandatory here
  (T5 mmap + block-wise GPU, DiT tensor-by-tensor). **The argparse default 288*384 / local_attn 9
  does NOT fit this card** — 7.2 GB allocated, the driver spills to system RAM, 20.7 s per chunk,
  which looks like the app is broken. Use 192*256 / local_attn 6 / sink 2 (5.2 GB, ~2.6 s/chunk,
  ~1 gen fps, 4 s glass-to-glass). Bigger GPUs: raise --size/--local_attn_size, 14B via --task i2v-A14B.
- Run: `powershell -File tools/realtime-lucy/start.ps1` (added 2026-09-19) — reads VRAM from
  nvidia-smi and picks the size that fits. The page talks to http://localhost:8765 directly;
  `/api/realtime-lucy/[...path]` proxies health/offer to LUCY_SERVER_URL only for remote GPU boxes.
- **Nothing generates unless that server is running.** The page is only a WebRTC client: with the
  server down it shows the local webcam and "Go live" is disabled, which reads as "the prompt does
  nothing". That was the whole of the 2026-09-19 bug report.
- **A prompt the T5 has not encoded costs 35–60 s and blocks the inference loop** — mid-stream the
  picture just freezes. Encodes are cached forever in `~/realtime-lucy/prompt-cache`. The server now
  warms the six page presets while idle (`PRESET_PROMPTS` in `server/common.py`, must stay
  byte-identical to `src/lib/realtime-lucy/protocol.ts`).
- Third `cond_mode` **"masked"** (2026-09-19, from cp-cp/LiveEdit's region idea): after every
  denoising step the camera's own latents are pasted back where the mask is 0 (`torch.lerp(z, x0, m)`
  in `wan/streaming.py`), *before* the KV write and the decode, so the held region never drifts.
  Mask comes over the data channel as base64 `w*h` bytes; browser-side MediaPipe selfie segmenter
  (CPU delegate on purpose — the WebGL one would steal VRAM from the DiT), vendored in
  `public/mediapipe/` so there is no CDN. Verified: held half 1.8/255 vs free half 10.6
  (`test_streaming.py --live`). It does NOT implement LiveEdit's compute reuse — same cost per
  chunk as SDEdit, buys control not speed.
- An https page calling http://localhost is Private Network Access: the server must answer
  `Access-Control-Allow-Private-Network: true` or /health and /offer fail from the deployed site.
- In PowerShell 5.1 never do `& nativeexe ... 2>$null` under `$ErrorActionPreference = "Stop"` —
  it becomes a terminating NativeCommandError and silently skips the assignment.
- Python stdout is block-buffered when redirected: run bench with `python -u` to watch progress.
- umt5-xxl has per-block relative position embeddings (encoder-level pos_embedding is None).
- Preview server for this app: launch.json `lucy-preview-3233` (see [[hub-parallel-dev-servers]]).
- Benchmark numbers: `tools/realtime-lucy/bench/RESULTS.md`.
