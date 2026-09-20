---
name: auteur-app
description: Auteur at /apps/auteur — the AI film studio for MiniMax H3 (idea → references → AI Director → storyboard → H3 prompts → generate → retake → timeline); H3 API facts and design decisions
metadata: 
  node_type: memory
  type: project
  originSessionId: 32404d78-4815-4365-8573-d6fd87b0088d
  modified: 2026-09-07T21:29:08.763Z
---

**Auteur** is the hub's AI filmmaking studio at `/apps/auteur` (catalog slug `auteur`, category Video), built 2026-09-07 from the user's brief (OpenArt Director / Higgsfield-style, MiniMax H3 focus). Spec: `docs/superpowers/specs/2026-09-07-auteur-film-studio-design.md`. Code: `src/lib/auteur/` (types, constants, repo, media, client, `director/{heuristic,h3prompt,retake,llm}.ts`), `src/components/auteur/`, routes `src/app/api/auteur/{director,generate}/route.ts`.

**MiniMax H3 facts (researched Sept 2026, official docs):**
- v2 API: `POST https://api.minimax.io/v2/video_generation` with `model: "MiniMax-H3"`, `resolution: "768P"|"2K"`, `duration` 4–15, `ratio`, and a `content[]` array (text + `image_url` role `reference_image`/`first_frame`/`last_frame`, `video_url` role `reference_video`, `audio_url` role `reference_audio`). Poll `GET /v2/query/video_generation/{task_id}` → `task.status` queued/running/succeeded/failed, `content.url` (time-limited). Limits: 9 images, 3 videos, 3 audio, 12 files; keyframe mode and reference mode are mutually exclusive.
- H3 does NOT use the old `[Push in]` bracket camera syntax (that is Hailuo 02/2.3/Director on v1). H3 reads a production brief: `[Shot 1]`, camera as a prose sentence with amplitude + speed, dialogue as `<d>[English] …</d>` with `(S1)` speaker ids, `overall_soundscape:` + `non_diegetic_music:` (audio is always generated). Reference mode is six sections: `subject_definitions / summary: [reference generation] / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music` with `<Subject N>/<Video N>/<Audio N>` labels in attach order and retention markers (`fully_preserved`, `attribute_transfer`, …).
- Also on the Vercel AI Gateway as `minimax/minimax-h3` (AI SDK `experimental_generateVideo`, `inputReferences`).
- Pricing ~$0.08/s at 768P, ~$0.13/s at 2K; 2K renders take minutes (poll every ~8–10s).

**Design decisions:**
- Templates (what kind of film) and genres (how it feels) are separate axes; both in `constants.ts`.
- Every director stage (develop, breakdown, prompt polish, retake, describe-image) has an LLM path via the gateway AND a heuristic fallback, so the app is fully usable with no key; without `MINIMAX_API_KEY`/`AI_GATEWAY_API_KEY` generation yields animatic placeholder takes.
- Retakes are a `ShotPatch` on structured fields (camera/lighting/expression/wardrobe override), never a prompt rewrite, so the rest of the project is untouched; every take is kept.
- Media bytes (references, clips, music) live in IndexedDB (`media.ts`); project JSON is localStorage + `app_state` sync under key `auteur:v1`.
- **Gotcha:** in `studio.tsx`, writers must go through `commit()`/refs — two `update()` calls in one tick would otherwise read a stale project and drop the first write (this bit us: takes vanished). Interrupted takes are settled on LOAD (`repo.normalize`), never on save.
- Unit tests: `node --import ./scripts/ts-test-hooks.mjs --test src/lib/auteur/director/director.test.ts` (the hook resolves extensionless TS imports for Node's ESM loader).
- Reference repos studied: two are GPL/AGPL (ComfyUI-MiniMaxH3-Director, AIMovieStudiov2) — ideas only, no code; two MIT (H3-StoryBoard, h3-studio).

Related: [[seedance-studio-app]] (the older timeline prompt builder), [[hub-deployment-supabase]], [[ultimate-assistant-os-portfolio]].

**Self-hosted backend (2026-09-07).** Auteur can render on the user's own RunPod
Serverless endpoint: `runpod/h3-worker/` (ComfyUI + Comfy-Org quants, ~42GB on a
network volume) and `runpod/setup.mjs` (REST API **v2** at `api.runpod.io/v2` —
v1 retires 2026-11-15). Video backends now live in `src/lib/auteur/server/video/`
(runpod | minimax | gateway | placeholder behind one interface); task ids are
prefixed with their backend so polls route back correctly.

Key facts learned:
- **LICENCE BLOCKER: the open H3 weights exclude the US, EU, UK and South Korea**
  from their "Applicable Territory". The user is US-based. Files are ungated, so
  the restriction is contractual only. Application form: platform.minimax.io/h3-license.
  The hosted API has no such restriction.
- RunPod bills **worker wall-clock including cold start and idle timeout**, not
  GPU-busy time. `workers.min = 0` is what makes idle free. The **network volume
  (~$0.07/GB/mo) is the one thing that bills while idle** — ~$5.60/mo for 80GB.
- Estimated per 5s clip on an RTX 5090 ($1.58/hr): ~$0.04 warm, ~$0.17 cold, vs
  ~$0.41 on MiniMax's hosted API. Break-even vs the volume ≈ 16 clips/month.
  So: render a whole storyboard in one sitting, not one shot a day.
- **ComfyUI 0.34 ships TWO MiniMax node families.** `MinimaxHailuo03*` in
  `comfy_api_nodes/` are CLOUD API nodes (call Comfy.org, bill again). The
  local-weight ones are `MiniMaxH3ImageToVideo` / `MiniMaxH3ReferenceToVideo` /
  `MiniMaxH3SigmaShift`. Do not confuse them.
- `runpod/worker-comfyui:5.10.0-base` = ComfyUI 0.34, torch 2.11 **cu128**, no
  models, ComfyUI at `/comfyui`. Because it is cu128, use `pruned_fp8_scaled`,
  NOT `pruned_int8_convrot` (that needs cu130).
- H3 geometry: 24fps, frames on a **17n+5** grid, trained window **124–362**
  frames; canvas multiples of 32, max 1032192 px (=1344x768). Unit-tested in
  `runpod/h3-worker/test_worker.py` (`python -m unittest`).
- The workflow builder resolves socket names from ComfyUI's `/object_info` at
  runtime rather than hardcoding them, because a wrong guess only fails after
  the GPU is already billing.
- **Never verified on a real GPU** — no end-to-end render has been run.
- Docker Desktop is installed on this machine but the daemon is NOT running and
  no registry is logged in, hence the RunPod Hub (build-from-GitHub) path.

**Image builds on GitHub Actions, not locally (2026-09-07).**
`.github/workflows/build-h3-worker.yml` builds `runpod/h3-worker/` and pushes to
`ghcr.io/legacymiles/auteur-h3:latest`. This exists because the user has no
working Docker daemon and no registry account, and the base image is ~15GB.
Notes:
- The repo is PUBLIC, so Actions minutes are free AND the Actions REST API can be
  read unauthenticated (`api.github.com/repos/legacymiles/ultimate-assistant-os/
  actions/runs`) — useful since `gh` CLI is NOT installed on this machine.
- The runner needs `Free disk space` (rm -rf dotnet/android/ghc/CodeQL) or the
  15GB base image blows the ~14GB default disk.
- `setup.mjs` derives the image name from `git remote get-url origin`, and reads
  all settings from `.env.local` via an `env()` helper, so the only thing the
  user must supply is `RUNPOD_API_KEY`.
- ghcr packages pushed from a PUBLIC repo come out PUBLIC — verified with an
  anonymous ghcr token: tags/list and the OCI manifest both return 200 with no
  credentials. No visibility click was needed (I had wrongly predicted one).
  Check access with: curl "https://ghcr.io/token?scope=repository:<owner>/<img>:pull&service=ghcr.io"
  then GET /v2/<owner>/<img>/tags/list with that bearer token. The manifest needs
  Accept: application/vnd.oci.image.manifest.v1+json or it 404s misleadingly.
- Build #1 succeeded in ~7 min; image is 33 layers / 14.7GB compressed.

**User preference (2026-09-07, stated firmly):** they want to do things "open
source with GitHub" and they are NOT comfortable running build/publish steps
themselves — "all i can do is add runpod key to env local". Do the operational
work for them; do not hand back a list of manual steps. They also pushed back on
being told to resolve the H3 licence first: flag a legal/licence concern ONCE,
then proceed and leave the note in the docs.

**No network volume by default (2026-09-07).** The user pushed back hard on the
~$5.60/mo network-volume charge: "it should not charge me if i dont use it".
`RUNPOD_VOLUME_GB` now defaults to **0** = no volume. Weights are fetched onto
the worker's own container disk (`disk: 90`) each cold start; that disk lives
only as long as the worker, so idle really is $0.
- Break-even maths: no-volume wins below ~50 render *sessions*/month. At 4
  sessions/mo it is $0.58 vs $5.76. Cold start ~5.5 min vs ~1.5 min with a volume.
- `h3/models.py::_default_models_root()` picks `/runpod-volume/models` when a
  volume is mounted, else `/models`. The Dockerfile must NOT set `H3_MODELS_DIR`
  or it overrides that (this was a real bug, fixed and verified in the published
  image config via the ghcr blob API).
- Tell the user: render a whole storyboard in one sitting, not one shot a day.

**RunPod account gates hit (exact messages):**
- Network volume: "You must have at least $5 in your account to create a network volume"
- Endpoint: "You must have at least $0.01 in your account balance to create an endpoint."
Account balance was $0.00 as of 2026-09-07; user said they would add credit.
Recommended $10. Nothing has been created yet: `/v2/network-volumes` and
`/v2/serverless` both empty, `/v2/billing` totals $0.00.

**RunPod API gotchas learned the hard way (all verified live):**
- `api.runpod.io` rejects Node/undici default UA with a **Cloudflare 1010**; send
  a normal `User-Agent`. Cost me a false "auth failed" diagnosis.
- Full OpenAPI spec is at `https://api.runpod.io/v2/openapi.json` (~220KB) —
  use it instead of guessing. Paths in it are keyed WITH the `/v2` prefix.
- `/v2/catalog/gpus` returns `{gpus:[{id,name,memory,pool,price:{secure,community},...}]}`.
  There is **no `price.serverless`**, and `pool` is **null** for many cards.
  Real pool ids: ADA_24, ADA_32_PRO, ADA_48_PRO, ADA_80_PRO, AMPERE_16/24/48/80,
  BLACKWELL_32/96/180, HOPPER_141.
- `/v2/catalog/datacenters` entries have `networkVolumeTypes` (not a storage
  flag). Several DCs (AP-IN-1, US-MD-1, US-TX-4...) support NO volumes.
- **Exclude AMPERE_* pools** when using fp8 weights — fp8 is native on Ada/
  Hopper/Blackwell only. Sort pools by smallest-VRAM-that-fits, not by price,
  or you get a 96GB card for a 27GB job.

**WORKING END TO END (2026-09-07).** Endpoint `7s0p4sqpuy1m2x` renders real H3
clips. First success: 5.17s / 864x480 / 124 frames / 8 turbo steps, valid MP4
with avc1 video + mp4a audio (H3 generates audio natively).

**Measured, not estimated:**
- Cold start (download 44.5GB + load model): **86s** (~520 MB/s). Far faster
  than the ~5.5 min I projected. Cold start ≈ $0.038, not $0.14.
- Render 124 frames @ 8 steps @ 864x480: **47s** → 47.4 ms/frame/step (I had
  estimated 72 ms, i.e. 1.5x pessimistic).
- Warm per clip: $0.023 draft / $0.050 full 768p for 5s vs $0.41 hosted.
  30s video = $0.17–$0.32 vs $2.35 hosted.
- This confirms **no network volume** is right: a volume saves ~4c/session and
  costs $5.60/mo.

**The four ComfyUI bugs that cost four failed renders** (all "I could not see
how ComfyUI serializes things"):
1. `KSamplerSelect.sampler_name has no selectable options` — combo widgets are
   emitted as `["COMBO", {"options":[...]}]` in newer ComfyUI, not only the
   classic `[[choices], {}]`.
2. Inserted a `MiniMaxH3SigmaShift` node that Comfy Org's own templates omit.
3. Reference images use `COMFY_AUTOGROW_V3`: object_info shows only the
   container `ref_images` + a template naming the item, but a workflow
   addresses slots as **`ref_images.ref_image_0`** (dotted, zero-indexed).
4. `SaveVideo.format` is `COMFY_DYNAMICCOMBO_V3`. THE VALUE MUST BE A PLAIN KEY
   STRING. `DynamicCombo._expand_schema_for_dynamic` does `key = live_inputs[id]`
   then `if option["key"] == key`, so a dict matches nothing, the socket never
   enters the finalized schema, and the node is called without it → "missing
   required positional argument" even though the graph set it. Inputs the chosen
   option unlocks are nested under the parent id via `finalize_prefix`, i.e.
   dotted. Correct, FLAT: **`"format":"auto"`, `"format.codec":"auto"`**.
   (Source: `comfy_api/latest/_io.py`; `execution.py::get_input_data` shows the
   drop.) Cost SIX failed renders because I kept guessing instead of reading it.
5. `_boot()` was once-per-worker, so a worker warmed by a TEXT job never fetched
   the ref2va weights for a later REFERENCE job → ComfyUI "value not in list".
   Weight checks must run per job, keyed to what that job needs, then refresh
   ComfyUI's cached model lists.

**Plus one non-ComfyUI trap:** RunPod caches images by tag, so pushing a fix to
`:latest` leaves warm workers on old bytes — the symptom is the SAME error in
~150ms on the SAME workerId. Always pin the endpoint to a commit SHA and use
`node runpod/setup.mjs --update-image --yes` after each worker change.

**LESSON (user called this out, correctly):** build live introspection FIRST.
Reading `/object_info` from the actual worker and reading ComfyUI's source
answered in seconds what four paid renders answered slowly. Gold sources:
- Official local-weight templates: `github.com/Comfy-Org/workflow_templates`
  → `templates/video_minimax_h3_{t2v,i2v,r2v}.json` (the `api_*` ones are the
  CLOUD nodes — wrong family).
- ComfyUI source `comfy_extras/nodes_video.py` for save/mux node signatures.
- The worker's own `{"introspect":[...]}` mode.

**BOTH MODES CONFIRMED WORKING (2026-09-07, image `runpod/setup.mjs --update-image`).**
- text-to-video: 5.17s / 864x480 / 8 steps → 617KB mp4, avc1+mp4a.
- reference-to-video: 5.17s / 864x480 / **4 steps** (ref2v turbo) → 521KB mp4.
  Reference weights (+23GB) downloaded onto an already-warm worker in **48s**.
- Warm reference render billed **79s ≈ $0.035**. Text with cold start ≈ $0.084.

**Process lesson worth keeping:** I claimed success once on a stale warm worker
and had to retract it. After ANY image change, always
`node runpod/setup.mjs --update-image --yes` and confirm the worker is new
(check `workerId` changes) before trusting a result. maxWorkers is now 1.

**Debug tools that finally worked** (in the worker, both cheap):
- `{"introspect":["NodeName",...]}` → weights on disk, comfy up, node list, raw
  input specs.
- `{"build_only":true, ...}` → returns the assembled graph JSON without sampling.
Use these BEFORE spending a render.
