# Auteur on your own RunPod endpoint

Runs the **open-weight MiniMax H3** on a RunPod Serverless endpoint you own, so
Auteur renders shots on your hardware instead of paying MiniMax per second.

---

## Read this first: the licence excludes the United States

The open weights ship under the **MiniMax H3 Community License**. Its
"Applicable Territory" **excludes the United States, the European Union, the
United Kingdom and South Korea**, and the agreement says you may not use,
reproduce, modify, distribute or display the works outside that territory.

The files are not gated — they download freely — so nothing technical stops
you. The restriction is contractual, and it is real.

Three lawful ways forward:

| Option | What it means |
| --- | --- |
| **Apply for authorisation** | MiniMax review deployments from restricted regions at <https://platform.minimax.io/h3-license>. Their own Q&A frames the limit as "not yet", not "not ever". |
| **Use the hosted API instead** | `MINIMAX_API_KEY` in `.env.local`. Available worldwide, no licence question, and Auteur already supports it. |
| **Operate from inside the territory** | Whether renting an in-territory GPU satisfies the licence for a US-domiciled person is **not addressed** by any official document. Do not assume it does. |

Everything below is built and ready. Whether you are permitted to run it is a
call for you and, if it matters commercially, your lawyer.

---

## What it costs, honestly

You asked for something that bills nothing when you are not using it. That is
achievable, with one asterisk.

**Compute — bills only while a job runs.** The endpoint is created with
`workers.min = 0`, so when you are not rendering there is no worker and no
compute charge. But RunPod bills from worker start to worker stop, which
includes the **cold start** and the short **idle timeout**. You are not billed
per second of video; you are billed per second the machine exists.

**Storage — off by default, so nothing bills at idle.** A network volume would
cache the ~42 GB of weights between renders, but it bills about $0.07/GB/month
whether or not you ever use it. That is the only line item that charges while
you sleep, so it is **not** created by default. Instead the weights are fetched
onto the worker's own disk on each cold start, and that disk exists only while
the worker does.

The trade is a slower first shot per session, and it favours the no-volume
setup unless you render very often:

| Sessions per month | With a volume | No volume |
| --- | --- | --- |
| 4 | $5.76 | **$0.58** |
| 15 | $6.19 | **$2.17** |
| 30 | $6.79 | **$4.34** |
| 60 | **$7.97** | $8.69 |

Turn the volume on with `RUNPOD_VOLUME_GB=80` if you end up rendering daily.

Estimates on an RTX 5090 at $1.58/hr, for one ~5 second clip:

| Situation | Billed time | Cost |
| --- | --- | --- |
| Warm worker, another shot right after | ~95 s | **~$0.04** |
| First shot of a session, no volume | ~5.5 min | **~$0.14** |
| First shot of a session, with a volume | ~1.5 min | **~$0.04** |
| MiniMax hosted API, same clip | — | **~$0.41** |

The practical consequence: **render a storyboard in one sitting.** Ten shots
in a row pay one cold start. Ten shots spread across ten days pay ten.

These are estimates built from published pricing and third-party benchmarks,
not measurements from your account. Treat the first month as the real test,
and watch the spend limit in the RunPod console.

---

## Setting it up

### 1. Get an API key

Create one at <https://console.runpod.io/user/settings> and put it in
`.env.local` at the repo root:

```
RUNPOD_API_KEY=rpa_your_key_here
```

That file is gitignored. The setup script reads the key from there and never
prints it.

### 2. The worker image builds itself

You do not need Docker, a Docker Hub account, or any local build. Pushing to
this repository triggers `.github/workflows/build-h3-worker.yml`, which builds
`runpod/h3-worker/` on GitHub's runners and publishes it to this repo's own
container registry as:

```
ghcr.io/<your-github-owner>/auteur-h3:latest
```

Public repositories get free Actions minutes, so this costs nothing. Watch it
under the repository's Actions tab. The first build takes roughly twenty
minutes because it pulls a large base image; later builds are cached and take
a couple of minutes.

The published image is **public and anonymously pullable**, which is what
RunPod needs. Verified against the registry:

```
ghcr.io/legacymiles/auteur-h3:latest   33 layers, 14.7 GB compressed
```

If you ever make the repository private, the package follows it, and you would
then need to give RunPod registry credentials in the console.

### 3. Create the endpoint

Look before you leap. This prints the exact payload and creates nothing:

```bash
node runpod/setup.mjs --dry-run
```

Then, for real:

```bash
RUNPOD_DATACENTER=US-KS-2 node runpod/setup.mjs --yes
```

The image name is worked out from your git remote, so there is nothing to
pass unless you want to override it. The script creates the network volume
and an endpoint with `workers.min = 0`, FlashBoot on and a five second idle
timeout, then prints the endpoint id.

### 4. Point Auteur at it

```
RUNPOD_ENDPOINT_ID=the_id_it_printed
```

Auteur now prefers your endpoint over every other backend. The order is
RunPod, then MiniMax hosted, then the Vercel AI Gateway, then animatics. Pin
one explicitly with `AUTEUR_VIDEO_BACKEND=runpod`.

### Handy afterwards

```bash
node runpod/setup.mjs --status     # is anything running (i.e. billing) right now
node runpod/setup.mjs --teardown --yes   # delete the endpoint; volume is kept
```

`--teardown` deliberately leaves the volume alone so you do not lose 42 GB of
downloads by accident. Delete it in the console when you are truly done — it
is the thing that keeps billing.

---

## How the worker runs H3

MiniMax released no Python inference script and no single-file pipeline; the
official path is "serve, then HTTP". This worker uses **ComfyUI**, which is the
only route that runs H3 comfortably on one GPU, because the quantised weights
and the turbo LoRAs are packaged for it.

The minimum working set is about **42 GB**:

| File | Size | Role |
| --- | --- | --- |
| `minimax_h3_fl2va_pruned_fp8_scaled` | ~21 GB | the diffusion transformer |
| `qwen3vl_32b_minimax_h3_nvfp4_awq` | ~16 GB | the conditioner that reads the prompt |
| `minimax_h3_video_vae_fp16` | ~5 GB | video decoder |
| `minimax_h3_audio_vae_fp32` | ~0.6 GB | audio decoder |
| `minimax_h3_fl2v_turbo_8step` | ~2 GB | 8 sampling steps instead of 20 |

Reference-to-video needs a second transformer (+23 GB) and is downloaded only
when a job actually attaches reference images.

**On quantisation:** `pruned_fp8_scaled` is the default because RunPod's
ComfyUI base image is CUDA 12.8. `pruned_int8_convrot` is marginally better but
requires a CUDA 13 build. Set `H3_DIT_VARIANT` to change it.

**On node names:** ComfyUI 0.34 ships two unrelated families of MiniMax nodes.
The `MinimaxHailuo03*` ones are **cloud API nodes** that call Comfy.org and
bill you again — exactly what you are trying to avoid. This worker uses the
local-weight `MiniMaxH3*` nodes. The workflow builder resolves every socket
name from ComfyUI's own `/object_info` at run time rather than hardcoding a
guess, so a renamed input produces a precise error naming the real sockets
instead of a wasted render.

### What the worker accepts

```jsonc
{
  "input": {
    "prompt": "the full H3 brief",     // required
    "duration": 6,                      // seconds; snapped to H3's 17n+5 grid
    "aspect_ratio": "16:9",
    "resolution": "768P",              // or "draft" for a smaller, faster canvas
    "references": [                     // image references, in prompt order
      { "label": "Subject 1", "kind": "image", "data_url": "data:image/png;base64,..." }
    ],
    "first_frame": "data:image/png;base64,...",  // mutually exclusive with references
    "steps": 8,
    "seed": 12345,
    "turbo": true,
    "workflow": { }                     // optional: a full ComfyUI graph, bypassing the builder
  }
}
```

It returns `{ "video_base64": ... }` for small clips, or `{ "video_url": ... }`
when S3-compatible storage is configured. A job result is capped at 10 MB, so
for longer or larger renders set `BUCKET_ENDPOINT_URL`,
`BUCKET_ACCESS_KEY_ID` and `BUCKET_SECRET_ACCESS_KEY` on the endpoint. The
bucket URL must include the region or the presigned links will not sign.

---

## Known limits

- **Audio and video references are dropped** with a warning. H3 supports them;
  wiring them through ComfyUI's loaders is not done here. Image references,
  first frames and text all work.
- **No 2K.** MiniMax did not open-source the upscaler, so the open weights are
  768p-native. `"2K"` maps to the full 768p canvas rather than pretending.
- **No prompt rewriting.** The hosted API silently improves prompts through a
  component that was not released. Auteur's own director already writes the
  structured brief H3 wants, so this matters less here than it would elsewhere.
- **The first real render is the true test.** The workflow is assembled against
  a live ComfyUI's schema, and the geometry and decoding are unit-tested, but
  no end-to-end render has been run on a GPU from this machine.
