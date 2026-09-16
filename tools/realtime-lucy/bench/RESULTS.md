# Realtime Lucy — measured numbers

All runs: real laptop webcam (640×480, sampled to 16 fps) → `CausalStream.step()`
→ generated frames. Model `lingbot-world-v2-1.3b-causal-fast` (bf16 DiT, bf16
VAE, block-streamed T5), strength 2 ("balanced": 2 denoising steps + 1
KV-update forward per chunk), chunk = 1 latent frame = 4 pixel frames. Times
are CUDA-synchronised per stage; "steady state" = mean of chunks 1–7. Raw
per-chunk data in the `bench-*.json` files next to this note.

**Machine:** NVIDIA GeForce RTX 3050 6 GB Laptop GPU (5.1 GB usable next to
the Windows desktop), 11.7 GB RAM, torch 2.11.0+cu128, no flash-attn (SDPA
fallback), Windows 11.

| config | size | KV window | step (ms) | encode | denoise | KV upd | decode | gen fps | % of 16 fps | glass-to-glass* | peak VRAM |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `288*384 --local_attn_size 9 --sink_size 3` | 384×288 | 9 latents (3 888 tok) | 20 678 | 9 320 | 1 418 | 724 | 9 214 | 0.20 | 1 % | ≈ 20.9 s | **7 209 MB — over the card** |
| `192*256 --local_attn_size 6 --sink_size 2` | 256×192 | 6 latents (1 152 tok) | 2 604 | 525 | 549 | 317 | 1 213 | 1.59 | 10 % | ≈ 2.85 s | 5 211 MB |

\* minimum glass-to-glass = time to capture one chunk (250 ms at 16 fps) + one
step; the live server measures it directly (capture time of the chunk's last
camera frame → first generated frame handed to WebRTC) and reports it on the
data channel.

Other numbers from the same runs:

- model load with the low-memory loaders: 19–26 s, 3.68 GB VRAM resident (DiT 3.4 GB + VAE 0.25 GB);
- first prompt encode through the memory-mapped T5 (11.4 GB read from disk block by block): 73 s, then cached on disk — a re-open of the stream with a cached prompt takes 2.5 s;
- first chunk pays kernel warm-up: 4.5 s / 1.8 s in the two configs.

## Reading the numbers

- **The 288×384 run is memory-bound, not compute-bound.** 7.2 GB allocated on a 6 GB card means the Windows driver spilled tensors into shared system RAM: the VAE encode and decode went from a few hundred ms to ~9 s each while the DiT stayed at ~1.4 s. The Wan 2.1 VAE keeps several full-resolution activations for the 4 frames it decodes at once; that, not the DiT, is what overflows here.
- **At 192×256 everything fits (5.2 GB) and the split is: VAE 67 %, DiT denoise 21 %, KV update 12 %.** The DiT forward at 192 tokens/frame is ~180 ms on this GPU, i.e. launch-overhead-bound (30 layers of small kernels); it barely changes between the two resolutions once the spill is removed.
- **This laptop is ~10 % of real time.** Enough to prove the loop is real (the proof videos show the model re-rendering the room and inventing lighting and a face the camera never showed) but not a demo of realtime. "Faithful" (strength 3: 1 denoising forward + the KV update) trims ~180 ms per chunk; nothing else on this card closes a 10× gap.

## What a real GPU needs (estimates, not measurements)

Scaling the measured per-forward costs by published bf16 throughput and
removing the spill:

| GPU | 1.3B @ 288×384 | 1.3B @ 480×832 (the model's native size) | 14B @ 480×832 |
| --- | --- | --- | --- |
| RTX 4090 24 GB | ≈ 12–16 fps (≈ real time), glass-to-glass ≈ 0.5–0.6 s | ≈ 4–6 fps | not resident in bf16 (28 GB) |
| H100 80 GB, flash-attn | > 16 fps | ≈ 16 fps | ≈ 4–8 fps single GPU; the paper's 60 fps@720p figure is 8×H100 with Ulysses sequence parallel |

VRAM to keep in mind: 1.3B DiT 3.4 GB + VAE 0.25 GB + KV cache (2 × layers ×
window × tokens/frame × heads × 128 × 2 B: 0.7 GB for 9 latents at 288×384,
≈ 5 GB for 18 latents at 480×832) + VAE activations (≈ 2.5 GB for 4 frames at
288×384, scaling with pixels). A 12 GB card runs 288×384 comfortably; 480×832
with the reference 18-latent window wants 16 GB+.

The glass-to-glass floor is structural: 250 ms to collect one latent frame's
worth of camera video + one step. Below ~350 ms needs chunk_size 1, strength
3 (one denoising forward plus the KV update) and a GPU that does a DiT
forward in well under 50 ms.

## Live server over WebRTC (same laptop, 192×256 config)

`server/client_test.py` (an aiortc client sending the real webcam, exactly
the page's handshake) against `server/server.py`, 35 s:

| | |
| --- | --- |
| first generated frame back at the client | 0.8 s after the offer (prompt already cached) |
| camera frames sent / generated frames received | 499 / 392 (313 distinct) |
| stats messages on the data channel | 18 (one per chunk plus one per emitted chunk) |
| mean step while also encoding/decoding WebRTC video | 3 385 ms (vs 2 604 ms in the offline benchmark: the VP8 codec and the camera pump share the CPU) |
| glass-to-glass, measured by the server | min 1 229 ms, mean 3 474 ms |

The mean is higher than the minimum because the ring always hands the newest
frames to a GPU that is 10× slower than real time: the chunk being computed
is already ~3 s old when its output leaves. On a GPU that keeps up, the
number converges to 250 ms + one step + codec/display.

## Correctness checks that back the numbers

- `server/test_streaming.py`: streaming VAE encode/decode == batch encode/decode, max |Δ| = 0 at bf16 (so chunked generation is the same computation as one long clip).
- `bench-*.mp4` (not committed — they contain webcam footage): camera | generated, side by side, 16 fps.
- `server/client_test.py`: full WebRTC round trip (aiortc client → server → generated track + stats), see `client-test.log` when run.
