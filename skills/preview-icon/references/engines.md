# Engines — where the still and the motion come from

A preview icon is made in two stages, and they are deliberately separate:

1. **The still** — an image model draws the subject, lit and framed.
2. **The motion** — that still is brought to life.

Keeping them apart is what makes this cheap. Stills are pennies and arrive in seconds, so a bad
shot is caught before anything expensive happens. It also means the motion tier can change without
touching the part that determines whether an icon is any good, which is the still.

Contents:
- [Stage 1: the still](#stage-1-the-still)
- [Stage 2: the motion](#stage-2-the-motion)
- [Choosing a motion tier](#choosing-a-motion-tier)
- [Local Wan on ComfyUI](#local-wan-on-comfyui)
- [What this skill does not use](#what-this-skill-does-not-use)

## Stage 1: the still

**OpenRouter**, `google/gemini-3.1-flash-image` by default (override with `--image-model`).

`POST https://openrouter.ai/api/v1/chat/completions` with `modalities: ["image","text"]` and
`image_config: { aspect_ratio: "1:1" }`. The image comes back as a data URL, but models disagree
about where: check `choices[0].message.images[0].image_url.url` first, then an `image_url` part
inside a `content` array. `render.mjs` handles both.

Key: `OPENROUTER_API_KEY`, read from the environment then the hub's `.env.local`.

This is the same route the hub's Image Studio uses, so it is a known-good path rather than a new
integration. Cost is a fraction of a cent per still.

## Stage 2: the motion

Three tiers, cheapest first. All produce a clip in `work/raw/<slug>.mp4` that `finish.mjs` then
trims, crops and compresses identically — the tier is invisible downstream.

| Tier | Cost | What it can do |
|---|---|---|
| **ffmpeg motion** | free | move the still: push in, drift, pan, crossfade two stills, overlay a sweep |
| **H3 on the owner's RunPod endpoint** | ~$0.023 per 5s clip at 480p | real generated motion, anything |
| **Local Wan on ComfyUI** | free, slow | real generated motion, limited by a 6GB card |

### ffmpeg motion (free)

ffmpeg does not generate imagery — it only transforms pixels that already exist. That distinction
decides where this tier works.

A seamless loop comes from making the motion periodic over exactly the window `finish.mjs` cuts
(3.0s). A sine with a 72-frame period at 24fps is one full cycle per window, so any cut loops:

```
zoompan=z='1.10+0.055*sin(2*PI*on/72)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=512x512:fps=24
```

### H3 on the owner's RunPod endpoint

`POST https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/run`, poll `/status/<id>`.
Keys: `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`.

Input the worker accepts: `prompt`, `first_frame` (a data URL — this is how the OpenRouter still
becomes the opening frame), `duration`, `aspect_ratio`, `resolution`, `turbo`, `steps`, `seed`.
It returns `video_base64` or `video_url`.

Measured on that endpoint, not estimated: cold start 86s (44.5GB of weights), 5s clip at 480p in
47s, $0.023 warm. Expect silence for the first ~90s of a session; the worker emits progress notes
which `render.mjs` prints.

Use `480p`. Output is 512x512 downscaled to roughly 200px in a grid, so 768p spends money on
detail the downscale discards.

## Choosing a motion tier

Route on the archetype, because the archetype says whether new imagery has to appear:

| Archetype | Tier | Why |
|---|---|---|
| Inhabitation | ffmpeg | a push-in through a corridor still reads as travel |
| Interrogation | ffmpeg | the sweep is an overlay, not new content |
| Transformation | ffmpeg | two stills and a crossfade is a transformation |
| **Accumulation** | **H3** | objects must genuinely converge; a zoom cannot fake it |
| **Emission** | **H3** | form must genuinely appear from nothing |

That puts roughly two thirds of a catalog on the free tier and spends real money only where it
buys something visible. Escalate rather than pre-pay: if an ffmpeg version fails the read test,
re-render that one item on H3.

## Local Wan on ComfyUI

Installed at `C:\pinokio\api\comfy` (9.6GB) via Pinokio, running at `http://localhost:8188`.
Verified: Python 3.10.15, ComfyUI 0.36.0, torch 2.7.0+cu128, RTX 3050 6GB with ~5GB free.

Pinokio's own conda environment matters here: the system Python is 3.14, which torch does not yet
support, so a manual install fails at `pip install torch`. Do not try to bypass the launcher.

The launcher's bundled Wan scripts are in `C:\pinokio\api\comfy\wan\` and pull **Wan 2.1**:

| Script | Model | 6GB? |
|---|---|---|
| `text1.3b.js` | `wan2.1_t2v_1.3B_bf16` | yes — the only bundled one that fits |
| `text14b.js`, `image480p.js`, `image720p.js` | 14B | no |

So the bundled image-to-video models are all 14B and cannot animate a still on this card. Wan 2.2
is not in the launcher; its 5B TI2V variant exists in the same Comfy-Org repackaged format and
does image-to-video, but it is tight on 5GB free.

Start it with `pterm run "C:\pinokio\api\comfy" --default start.js` and confirm the GPU with
`GET http://localhost:8188/system_stats`. Pinokio must be running first — its control plane is on
`127.0.0.1:42000`, and note the config's `access.host` can be a stale LAN address that `pterm`
tries first and times out on.

## What this skill does not use

- **muapi / Higgsfield / Open-Generative-AI.** Ruled out by the owner. The muapi CLI in the
  `higgsfield-models` skill is not called from here.
- **OpenRouter for video.** It has none. Verified against its model API: 447 models, output
  modalities are only `text`, `image` and `audio`. Do not look for a video model there.
- **The `wide-trace/open-higgsfield` repo.** It is a studio UI, not a provider: it ships no
  endpoint and expects a Higgsfield platform key as `id:secret`. No programmatic entry point.
