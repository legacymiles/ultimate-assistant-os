# Backend: muapi.ai (the only generation route)

This skill is a fork of **oso95/scroll-world** (MIT — see `LICENSE.upstream`). Upstream
drove every generation through the **Higgsfield** CLI, with **Monid** as the default
pay-per-clip biller. Neither is used here.

The owner's standing rule: models that Higgsfield resells are called through
**muapi.ai** (the Open-Generative-AI route) with `MUAPI_API_KEY`. No Higgsfield account,
SDK, CLI or MCP; no Monid CLI. The `higgsfield-models` skill owns that route and ships
the CLI this skill calls.

```bash
MU=~/.claude/skills/higgsfield-models/scripts/muapi.mjs
node $MU models <text>                       # search endpoints + their Inputs column
node $MU upload ./frame.png                  # -> prints the hosted URL
node $MU gen <endpoint> '<json>' --out f.mp4 # submit, poll, download
node $MU gen <endpoint> '<json>' --no-wait   # -> prints request_id (detached)
node $MU poll <request_id> --out f.mp4       # resume
```

Key resolution: `MUAPI_API_KEY` env → nearest `.env.local` (cwd upwards) → the hub's
`.env.local`. It is set in the hub today.

## Call mapping

| Upstream call | Here |
|---|---|
| `higgsfield generate create gpt_image_2` | `gen gpt-image-2-text-to-image` `{prompt, aspect_ratio, resolution}` |
| `higgsfield ... --image <ref>` (style lock) | `gen gpt-image-2-image-to-image` |
| `higgsfield generate create seedance_2_0 --start-image` | `gen seedance-2-image-to-video` `{prompt, images_list:[start], aspect_ratio, duration, high_bitrate}` |
| `... --start-image --end-image` (connectors) | `gen seedance-2-first-last-frame` `{prompt, images_list:[start,end], ...}` |
| `seedance_2_0_mini` (draft tier) | the same two endpoints with **`-fast`** appended |
| `kling3_0` (content-filter fallback) | `kling-v3.0-4k-image-to-video` — takes `image_url` + `last_image`, **not** `images_list` |
| `minimax_hailuo` | `minimax-h3-image-to-video` — but prefer the sibling skill `h3-scroll-world` |
| `monid_frame_url` (sfs upload) | `node $MU upload <file>` |
| `monid balance` / `higgsfield workspace list` | **no equivalent** — muapi has no balance command; quote generation *count*, then read real `cost` off the first result |

## Rules that differ from upstream

1. **Frames are hosted URLs.** Upload every local PNG first. Local paths and base64 are
   rejected.
2. **`images_list` order is `[start, end]`** for `seedance-2-first-last-frame`. Swapping
   them renders the flight backwards.
3. **Output URLs expire.** Always `--out`. Never rely on re-polling an old `request_id`
   days later.
4. **There is no balance to check.** Never quote upstream's credit tiers or Monid's
   token pricing — different biller, different numbers. Render one clip, read
   `cost.value`, extrapolate, re-confirm, then batch.
5. **`cost.refunded: true`** on a failure means it was not charged.
6. **Confirm before batching more than ~5 videos** — these are real per-generation
   charges on the owner's key.

## What did NOT change

The parts that make this skill worth having are backend-agnostic and were kept verbatim:
the seam law (connector endpoints must be the *rendered* neighbouring frames, never the
stills), the camera grammar, the prompt templates, `scrub-engine.js`, `knockout.py`,
`index-template.html`, and the encode/QA steps.
