# h3-render — one H3 render, two places to run it

```bash
node tools/h3-render/render.mjs --where local  --ref photo.jpg --prompt-file examples/car-rain-ref2va.txt
node tools/h3-render/render.mjs --where runpod --ref photo.jpg --prompt-file examples/car-rain-ref2va.txt
```

| | `--where local` | `--where runpod` |
|---|---|---|
| Runs on | WanGP (Pinokio) on this PC, via its MCP server on :42004 | The RunPod Serverless endpoint in `runpod/` (`RUNPOD_ENDPOINT_ID`) |
| Model | H3 Ref2VA / FL2VA **Pruned 20B int8** + 4-step turbo LoRA | Full H3 via ComfyUI, turbo, reference mode when `--ref` is given |
| Output | 832x480, 124 frames, audio | 864x480 ("draft"), 124 frames, audio |
| Cost | $0 | per billed worker second |

## Measured (same photo, same prompt, same seed — 2026-09-21)

| | Local (RTX 3050 6 GB, 12 GB RAM) | RunPod |
|---|---|---|
| One clip, first of the session | 13.4 min render ($0) → **5.7 min** after the 32 GB RAM upgrade | **7.1 min, $0.185** (cold start: 67.5 GB fetched in 272 s) |
| Each further clip while warm | 5.7 min ($0) | ~47 s render ≈ **$0.021** |
| 31 clips | ~3 hours, $0 | ~30 min, ~$0.81 |

The RunPod rate is the $1.58/h used in `runpod/README.md`. Warm = the worker is
still up; the endpoint's idle timeout is 5 s, so send a batch together rather
than one clip at a time or every clip pays the cold start.

Local needs WanGP's MCP server running:

```bash
cd C:\pinokio\api\wan\app
venv\Scripts\python.exe wgp.py --mcp --mcp-transport streamable-http --mcp-port 42004 --mcp-allow-read-file-system
```

Licence: the H3 open weights exclude the US/EU/UK/KR — see `runpod/README.md`.
It applies to both modes.
