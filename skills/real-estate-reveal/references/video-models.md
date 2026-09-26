# Video engine: which model makes the clips

> **Status: placeholder.** The owner plans a proper hierarchy of image and video models. Until
> it exists, use the working default below and **ask** before spending money on a paid render.
> When the hierarchy lands, replace the "Order" table and leave everything else as it is. The
> rest of the skill only reads `{{VIDEO_ENGINE}}` from here.

## What a clip needs, whatever the model

| Need | Why |
|---|---|
| **Image-to-video** anchored on a real listing photo | Keeps the house real (source of truth) |
| **First + last frame control** if the model has it | Lets clips chain with no cut. Last frame of N = first frame of N+1 |
| 16:9, 1080p or higher, 5–8 s, **no audio** | The desktop scrub source |
| Slow, single-direction camera | Scrubbing backwards has to look as good as forwards |
| No people, text or logos | They warp while scrubbing and date the footage |

Per-clip prompt shape (engine-neutral):
```
[start frame: <image file>] [end frame: <next image file or last frame of previous clip>]
Slow cinematic <push-in | glide | orbit | crane up | pull back> <from → to>, steady gimbal,
real estate film, architecture unchanged, same furniture/finishes/landscaping, natural
<dusk | daylight | night> light, subtle <water | foliage | light> motion, no people, no text, no audio.
```

## Order (placeholder: owner to rank)

| # | Engine | How it is reached from here | First/last frame | Notes |
|---|---|---|---|---|
| 1 | **Seedance 2** (`bytedance/seedance-2.0`) | The hub's AI Gateway path. See `src/app/api/seedance/route.ts` (`AI_VIDEO_MODEL`, `AI_GATEWAY_API_KEY`) | first frame (image) | Used in the video. The presenter picked it for speed, cost and quality |
| 2 | MiniMax H3 | The hub's Auteur backends in `src/lib/auteur/server/video/` (`MINIMAX_API_KEY`) | yes | Already wired in the hub |
| 3 | Higgsfield MCP (`https://mcp.higgsfield.ai/mcp`) | An MCP connector. Optional, and the owner does not want it required | model-dependent | The video's route. It exposes Seedance and other models behind one account. **Owner uses the `higgsfield-models` skill (muapi.ai, MUAPI_API_KEY) instead of the MCP** |
| 4 | Your own GPU (RunPod) | The Auteur `runpod` backend | model-dependent | Owner's hardware first, once set up |
| — | **Stills fallback, no key** | `scripts/prep-clips.mjs --kenburns` turns a photo into a slow push clip | n/a | Always works. The site stays complete and the clips can be swapped later |

Rules while this is a placeholder:
1. No key set means use the stills fallback, and tell the owner which clips are stand-ins.
2. A paid render needs a yes first: say the engine, the clip count and a rough cost.
3. If a key is missing, add the blank line to `.env.local` and show the owner that exact line.
4. After any engine run, put every clip through `scripts/prep-clips.mjs` before the site uses it.
