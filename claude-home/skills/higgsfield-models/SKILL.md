---
name: higgsfield-models
description: Generate images, video, lip-sync and audio with the models Higgsfield offers (Kling 3, Veo 3.1/4, Sora 2, Seedance 2, Hailuo 2.3, MiniMax H3, Wan 2.7, Nano Banana, Seedream 5, GPT Image, Flux Kontext) through the owner's unofficial route, the muapi.ai API that powers Anil-matcha/Open-Generative-AI, using a MUAPI_API_KEY instead of a Higgsfield account. Use this WHENEVER a repo, README, prompt, skill, tutorial or video mentions Higgsfield, higgsfield.ai, the Higgsfield MCP, "Higgsfield models", Higgsfield Soul/DoP/effects, or Open-Generative-AI / Open-Higgsfield / muapi. Also use it when a build calls for Higgsfield-style generation (cinematic shots, image-to-video, product ads, character video) and no other provider is set. The skill swaps the Higgsfield call for the same model on muapi, and says so when a model is Higgsfield-only.
---

# Higgsfield models via muapi.ai (Open-Generative-AI route)

The owner does not use Higgsfield directly. They use the API behind
**github.com/Anil-matcha/Open-Generative-AI** (MIT; formerly "Open-Higgsfield-ai"),
an open-source Higgsfield alternative. It calls **muapi.ai**, which hosts about 550 of the
same third-party models Higgsfield resells. The owner calls this their "unofficial way": they
pay per generation with their own muapi key.

## When a repo or prompt says "Higgsfield"

1. **Do not** set up the Higgsfield MCP (`mcp.higgsfield.ai`), the Higgsfield SDK, or a
   Higgsfield account/key. Replace that step with muapi.
2. Map the named model to its muapi endpoint (table below; full list in
   `references/models.md`, searchable with `node scripts/muapi.mjs models <text>`).
3. Keep everything else in the repo's plan as written: prompts, shot lists, durations, aspect ratios.
4. Tell the owner in one line which Higgsfield step was swapped and which endpoint replaced it.

## Key

`MUAPI_API_KEY`. The CLI reads it from the env, then the nearest `.env.local`/`.env`, then the
hub's `.env.local`. If it's missing, add a blank `MUAPI_API_KEY=` line to the relevant
`.env.local` (and `.env.example`), open that file at that line for the owner, and point them to
muapi.ai for the key. Never paste the key into chat, URLs, or committed files.

## API (all requests use the `x-api-key: <key>` header, base `https://api.muapi.ai`)

| Step | Call |
|---|---|
| Submit | `POST /api/v1/<endpoint>` with a JSON payload. Returns `{ request_id }` |
| Poll | `GET /api/v1/predictions/<request_id>/result` every 2-3 s. `status` becomes `completed`/`succeeded`/`success`, or `failed`/`error`/`cancelled` |
| Output | `outputs[0]` (or `url`, `output.url`). A hosted URL, so download it if it needs to be kept |
| Upload | `POST /api/v1/upload_file` multipart field `file`. Returns `{ url }`. Use it for any `image_url`, `images_list`, `video_url`, `audio_url` input |
| Failures | `error`/`message` holds the detail. `cost.refunded: true` means the credits were returned |

Browsers hit CORS on api.muapi.ai. In a web app, proxy the call through a server route (Next.js
`src/app/api/<app>/…`) and keep the key server-side, as Open-Generative-AI's `/api/*` proxy does.
Video can take several minutes, so poll with a limit of up to 30 min and never block a serverless
request on it. Return the `request_id` and let the client poll a status route.

## CLI (no install needed, Node 18+)

```bash
node ~/.claude/skills/higgsfield-models/scripts/muapi.mjs models seedance
node ~/.claude/skills/higgsfield-models/scripts/muapi.mjs upload ./still.png
node ~/.claude/skills/higgsfield-models/scripts/muapi.mjs gen nano-banana-pro '{"prompt":"…","aspect_ratio":"16:9"}' --out out/hero.png
node ~/.claude/skills/higgsfield-models/scripts/muapi.mjs gen seedance-2-image-to-video '{"prompt":"…","image_url":"<uploaded url>","duration":5}' --out out/shot1.mp4
node ~/.claude/skills/higgsfield-models/scripts/muapi.mjs poll <request_id> --out out/shot1.mp4
```

`gen` accepts `@payload.json` in place of inline JSON. Use `--no-wait` to print only the id.
Paid generations cost the owner money, so confirm before running a big batch (more than about 5
videos). A single test render the task clearly needs is fine.

## Higgsfield name → muapi endpoint

| Higgsfield offers | muapi endpoint(s) |
|---|---|
| Kling 3.0 | `kling-v3.0-pro-text-to-video`, `kling-v3.0-pro-image-to-video`, `kling-v3.0-4k-*`, `kling-v3.0-omni-*`, motion: `kling-v3.0-pro-motion-control` |
| Veo 3.1 / Veo 4 | `veo3.1-text-to-video`, `veo3.1-image-to-video`, `veo3.1-fast-*`, `veo3.1-reference-to-video`, `veo3.1-extend-video`, `veo-4-text-to-video`, `veo-4-image-to-video` |
| Sora 2 | `openai-sora-2-text-to-video`, `openai-sora-2-image-to-video`, `openai-sora-2-pro-*` |
| Seedance 2 | `seedance-2-text-to-video`, `seedance-2-image-to-video`, `seedance-2-first-last-frame`, `seedance-2-omni-reference*`, `seedance-2-character`, `-fast` variants |
| Hailuo / MiniMax | `minimax-hailuo-2.3-pro-t2v`/`-i2v`, `minimax-hailuo-2.3-fast`, **H3**: `minimax-h3-text-to-video`, `minimax-h3-image-to-video`, `minimax-h3-reference-to-video` |
| Wan | `wan2.7-text-to-video`, `wan2.7-image-to-video`, `wan2.7-reference-to-video`, `wan2.7-video-edit`, `wan2.2-animate` |
| Nano Banana | `nano-banana-pro`, `nano-banana-pro-edit`, `nano-banana-2`, `nano-banana-2-edit` |
| Seedream | `seedream-5.0-pro`, `seedream-5.0-pro-edit`, `bytedance-seedream-v4.5` |
| GPT Image | `gpt-image-2-text-to-image`, `gpt-image-2-image-to-image`, `gpt-image-1.5` |
| Flux Kontext | `flux-kontext-pro-t2i`, `flux-kontext-max-i2i`, … |
| Effects / viral presets | `image-effects`, `nano-banana-effects`, `flux-kontext-effects`, `generate_wan_ai_effects`, `ai-dance-effects` (preset `name` values listed in Open-Generative-AI `models.js`) |
| Lip sync / talking avatar | the `lipsyncModels`, `imageLipSyncModels`, `videoLipSyncModels` sections in `references/models.md` |

**Higgsfield-only models** (Higgsfield Soul, DoP camera-motion presets, Higgsfield's own
Speak/Popcorn) are **not** on muapi. Say so, then offer the closest substitute: Soul →
`nano-banana-pro` or `seedream-5.0-pro`; DoP camera moves → Kling 3.0 or Veo 3.1 with the camera
move written into the prompt, or `kling-v3.0-pro-motion-control`.

Payload fields differ per model. Check the model's `Inputs` column in `references/models.md`
before building a payload. Common fields: `prompt`, `aspect_ratio`, `duration`, `resolution`,
`image_url`, `images_list`, `generate_audio`, `seed`. For exact defaults and enums, read
`packages/studio/src/models.js` in the repo (clone with `git clone --depth 1`).

## Inside the hub (this repo)

Put muapi calls behind a small server helper (e.g. `src/lib/muapi/client.ts` + a
`src/app/api/<app>/…` route) that follows the hub rules: with no key, degrade visibly and never
return a 500. If a hub app already has its own provider (MiniMax H3 via RunPod, OpenRouter
images, AI Gateway video), keep it. Add muapi only as an option or fallback, unless the owner
asks for Higgsfield-model output specifically.

## Caveats to tell the owner once, not every time

- This is a third-party reseller, not Higgsfield. Output, pricing and uptime come from muapi.
- The repo markets itself as "unrestricted", with `spicy` endpoints. Use those only when the owner
  asks for them explicitly.
- Output URLs are hosted by muapi and may expire. Download anything that needs to be kept.
