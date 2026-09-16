# Realtime Lucy — live webcam → LingBot-World-V2 causal-fast

The GPU side of the **Realtime Lucy** app (`/apps/realtime-lucy` in the hub).
It turns the one-shot `causal_fast` inference of
[robbyant/lingbot-world-v2](https://github.com/robbyant/lingbot-world-v2) into a
continuous stream: webcam frames in over WebRTC, model-generated frames out
over WebRTC, with the DiT's KV cache and the VAE's causal-convolution state
carried across chunks. Nothing is faked — every output frame is the DiT's
prediction decoded by the VAE.

```
tools/realtime-lucy/
  lingbot/          vendored copy of lingbot-world-v2 @ 1895d30 (CC BY-NC-SA 4.0) with the
                    streaming changes applied in place — see NOTICE.md for the exact diff
  server/common.py  pipeline construction, frame ring
  server/bench.py   real-camera benchmark: timings, fps, VRAM, side-by-side proof video
  server/server.py  aiohttp + aiortc WebRTC server
  bench/            benchmark outputs (json + mp4)
```

## What had to change in the upstream pipeline

`WanI2VCausal._generate_causal_fast` is a job: one anchor image, a complete
camera trajectory (`poses.npy`), a fixed `frame_num`; it allocates noise for
the whole video, denoises chunk by chunk with a rolling KV cache, and only
then VAE-decodes everything. To accept a webcam stream:

| Part | Upstream | Streaming change |
| --- | --- | --- |
| Loop structure | one function does setup → N chunks → decode | `wan/streaming.py: CausalStream` — `open_stream()` does the setup once, `step(frames)` runs one chunk and returns pixels immediately |
| Chunk input | pure Gaussian noise at σ=1 | the chunk's real camera frames, VAE-encoded and noised to a chosen point of the same distilled 4-step schedule (SDEdit); `strength` picks the point (3 = 1 denoising step from σ≈0.62, 2 = 2 steps, 1 = 3 steps, 0 = all 4 from pure noise) |
| i2v condition `y` | VAE-encode of `[anchor, zeros × F-1]` for all F frames | a short prefix is encoded once; the causal encoder's steady-state latent stands in for later chunks (mask 1 on latent 0 only, as trained). Optional `keyframe` mode conditions every chunk on its camera latents |
| KV cache | allocated per `generate()`, positions from `chunk_id` | allocated per stream, `current_start` advances with the stream; same eviction/sink logic untouched |
| RoPE horizon | 1024 latent frames, fixed at construction | `WanModelFast.extend_rope()`; streams re-anchor at `max_stream_latents` |
| Camera poses | full trajectory interpolated up front | `CameraController` yields framewise relative poses per chunk (static by default, WASD/arrow keys live) |
| VAE | `encode()`/`decode()` clear the causal-conv cache every call | `encode_stream()`/`decode_stream()` keep it (`wan/modules/vae2_1.py`), so a 4-frame chunk is encoded/decoded exactly as inside one long clip |
| Text | T5 run inside `generate()` | `encode_prompt()` with a memory + disk cache; prompt swaps mid-stream refill the cross-attn cache on the next forward |
| Cross-attention | called `flash_attention` directly (hard requirement) | uses `attention()` which falls back to PyTorch SDPA — flash-attn is not needed |
| Memory | fp32 DiT state dict staged in RAM (6.9 GB); T5 fully resident (11.4 GB) | `low_mem`: DiT tensors streamed to the GPU in bf16 one at a time; T5 memory-mapped and run block-by-block on the GPU (<1 GB VRAM, no RAM copy) |

Not touched: the DiT forward, the self-attention KV bookkeeping, the flow →
x0 conversion, the re-noising between steps, the schedule indices
`[0, 250, 500, 750]`, the VAE weights/architecture, the camera Plücker
embedding. `generate.py` and the original `generate()` still work.

## Install (Windows or Linux, one NVIDIA GPU)

```bash
python -m venv ~/realtime-lucy/venv && source ~/realtime-lucy/venv/bin/activate   # Windows: venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -r tools/realtime-lucy/requirements.txt

# weights (~19 GB): the 1.3B causal-fast DiT plus the VAE / T5 / tokenizer shared with the 14B release
hf download robbyant/lingbot-world-v2-1.3b-causal-fast --local-dir ~/realtime-lucy/models/lingbot-world-v2-1.3b-causal-fast
hf download robbyant/lingbot-world-v2-14b-causal-fast --include "Wan2.1_VAE.pth" "models_t5_umt5-xxl-enc-bf16.pth" "google/*" "config.json" \
   --local-dir ~/realtime-lucy/models/lingbot-world-v2-assets
```

`flash-attn` is optional (the code falls back to SDPA). On Linux with an
80 GB GPU you can also point `--task i2v-A14B --ckpt_dir <14b dir>` at the
14B checkpoint; the streaming code does not depend on the model size.

## Run

```bash
python tools/realtime-lucy/server/server.py --port 8765 --size 288*384 --chunk_size 1 --local_attn_size 9 --sink_size 3
```

Then open `/apps/realtime-lucy` in the hub, click **Go live**. The page talks
to `http://localhost:8765` directly (Chrome treats localhost as a secure
origin even from an https page). For a GPU on another machine, either put
the server behind https, or set `LUCY_SERVER_URL` on the site and leave the
page's URL field empty so the site proxies the two signalling calls; the
media still flows browser ↔ GPU box directly. `--token X` protects `/offer`.

Useful flags: `--strength 0-3`, `--cond_mode keyframe`, `--chunk_size 2`
(fewer, larger steps), `--vae_dtype fp32`, `--no_low_mem` (upstream loaders,
needs ~20 GB host RAM), `--max_stream_latents`.

## Benchmark

```bash
python tools/realtime-lucy/server/bench.py --chunks 8 --chunk_size 1 --strength 2 --size 288*384
```

Writes `bench/bench-<tag>.json` (per-chunk encode / denoise / KV-update /
decode ms, fps, peak VRAM) and `bench/bench-<tag>.mp4` (camera | generated).
See `bench/RESULTS.md` for measured numbers.

## Licence

lingbot-world-v2 — code **and** the weights on Hugging Face — is released
under **CC BY-NC-SA 4.0**. The vendored copy keeps `LICENSE.txt`; the
modifications in this folder are derivative works and are offered under the
same licence. That means: personal / portfolio / research use is fine with
attribution; **any commercial deployment needs a separate licence from
Robbyant** (the README points to Reactor and LingGuang as their licensed
real-time platforms). The Realtime Lucy hub app and this server therefore
stay non-commercial.
