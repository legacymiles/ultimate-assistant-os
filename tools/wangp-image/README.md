# wangp-image — the free picture drawer

Draws images on the owner's own graphics card instead of paying a model for
them. WanGP is already installed under Pinokio with **Flux 2 Klein 4B** on
disk, so this needs no key, no account and no download.

Measured on the owner's laptop (RTX 3050, 6 GB VRAM, 32 GB RAM):

| | Time | What happens |
|---|---|---|
| **Cold** (first picture) | **~128 s** | Flux 2 Klein + the Qwen3 text encoder load and pin to RAM |
| **Warm** (every one after) | **~18 s** | Model stays loaded; only the 4 steps and the VAE decode run |

That 7× gap is the whole reason this is a long-lived service and not a script.
WanGP's Python API is built to keep the last model alive across requests, so
the server holds **one** Python worker and feeds it jobs, rather than spawning
one per picture.

## Run it

```bash
node tools/wangp-image/server.mjs
```

It binds **127.0.0.1 only** — it runs an expensive GPU job on an
unauthenticated request, so it must never be reachable from another machine.

| Flag | Default | |
|---|---|---|
| `--port` | `3391` | `WANGP_IMAGE_PORT` |
| `--root` | `C:/pinokio/api/wan/app` | `WANGP_ROOT` |
| `--model` | `flux2_klein_4b` | `WANGP_IMAGE_MODEL` |
| `--timeout` | 10 min | `WANGP_IMAGE_TIMEOUT` |

## Endpoints

```
GET  /health    -> { ok, model, busy, loaded, hasWanGP, root }
POST /generate  -> { ok, image: "data:image/jpeg;base64,…", ms, bytes, model }
```

`loaded` tells you whether the next picture is a cold one or a warm one, so a
UI can say "about two minutes" the first time and "about twenty seconds" after.

The data URL's type is read from the bytes, not assumed: WanGP picks its own
format and currently returns **JPEG** even though the output path asks for
`.png`. Callers that store the picture should trust the declared type.

**Prompts may contain blank lines.** WanGP's default reads a blank line as
"draw another picture" and then refuses a job that parses into more than one
request, so the worker sets `multi_prompts_gen_type: "FG"` -- line breaks
belong to one prompt. Without it, every multi-paragraph prompt fails.

One job at a time: a 6 GB card cannot hold two renders, and two at once means
both die of out-of-memory instead of one finishing. A second request while busy
gets a `429` and a plain sentence.

## The Python side

`generate.py` has two modes:

```bash
# one-shot, for testing — pays the full load every time
python generate.py --prompt "a paper receipt on a wooden table" --out out.png

# worker — what the server uses
python generate.py --serve
```

Run it with **WanGP's own venv**, not a system Python:
`C:/pinokio/api/wan/app/venv/Scripts/python.exe`.

Either mode prints exactly one line of JSON per job on stdout. WanGP's console
noise goes to stderr, so stdout stays parseable.

## How the hub uses it

`src/lib/images/lanes.ts` (pure, tested) decides which lane draws a picture:

1. **local** — this service. Free, unwatermarked, private.
2. **free** — a keyless public drawer. Free but **watermarked**, so it is only
   ever offered for placeholders, never for anything carrying the owner's or a
   client's name.
3. **paid** — the model in `src/lib/image-studio/agents.ts`. Last resort.

`src/lib/images/server/draw.ts` runs that plan and returns `null` when nothing
free could help, at which point the caller does whatever it did before. Adding
this can remove cost; it can never remove capability.

**Reference pictures (mockups).** `/generate` takes `refs`: up to three of
`{ image: dataURL }`, `{ url }` or `{ html }`. A `url` or `html` is photographed with
headless Chrome at the size being drawn; the first reference is the scene Flux edits
(WanGP mode `KI`). This is what the mockup edits use — a screenshot of the live page
with the change painted on. The hub's general image lanes (`draw.ts` `refs`) still
send reference jobs to the paid model; only the PC mockup path (`drawOnPc`) uses these.

```
POST /shot      { url | html, width, height } -> { ok, image, ms }   # photograph a page
POST /generate  { prompt, width, height, seed, refs?, fresh? }       # refs as above
```

- **Who may photograph what** (`guard.mjs`, tested): a program on this PC (no Origin)
  may photograph anything, a dev server included; a web page may photograph public
  sites and its own origin, never someone else's private address.
- **Cache:** seeded requests are kept in `~/.cache/wangp-image` by prompt, size, seed
  and reference, and answered even while the GPU is busy — so the chat command and the
  hub share pictures. A picture painted from a page address expires after 6 hours
  (the page may have changed); `fresh: true` skips the cache.
- **Speed with a reference** (RTX 3050, 1024x656): ~40 s to ~3 min a picture depending
  on free RAM; ~4 min for the first after a start. 768 px halves it but blurs small text.

## Notes

- `--profile 4` is WanGP's low-VRAM profile, which is what a 6 GB card wants.
  mmgp still shuttles weights between RAM and VRAM; that is where the warm
  18 s goes.
- Use of the WanGP API is subject to the WanGP Terms and Conditions. Anything
  built on it should say that it uses WanGP.
