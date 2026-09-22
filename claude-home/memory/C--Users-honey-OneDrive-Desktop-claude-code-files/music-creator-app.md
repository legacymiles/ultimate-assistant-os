---
name: music-creator-app
description: Music Creator studio at /apps/music-creator — YuE2 songs + AuK voice cloning through a remote 24 GB GPU server (tools/music-creator); add tools via the registry in src/lib/music-creator/tools.ts; AuK cannot sing and YuE2 has no voice input
metadata: 
  node_type: memory
  type: project
  originSessionId: f450113d-b774-4bf7-89fc-ffbce4f0dd8c
  modified: 2026-09-20T01:28:07.000Z
---

Music Creator (2026-09-15): `/apps/music-creator`, a STUDIO container — the user will keep
adding differently-shaped music apps inside it, so V1 is architecture first.

**Add a tool** = 3 edits, nothing else: an entry in `src/lib/music-creator/tools.ts` (TOOLS),
a component under `src/components/music-creator/tools/` taking `ToolProps`, and one lazy line
in `LOADERS` in `MusicCreator.tsx`. Per-tool state goes in `project.data` (opaque bag), never
in shared types. V1 tools: song-creator, hook-creator, mashup, remix-stems, artist-voice.

**The two model facts that shape everything** (do not let a future session forget these):
- **YuE2 has NO voice-reference / cloning / inpainting input.** Style + lyrics + optional ABC
  score only. A mashup therefore transfers the MELODY, never the original singer or recording.
- **AuK is a SPEECH model — it cannot sing.** Artist Voice Studio produces spoken/rapped
  vocals over a YuE2 bed, mixed with ffmpeg. Sung cloned vocals would need a singing-voice
  conversion engine added behind `speak()` in `studio.tsx`. Never imply otherwise in UI copy.

**How to apply:**
- Neither model fits this laptop (RTX 3050 6 GB): YuE2 wants 24 GB + Linux + Python 3.12,
  AuK ~25 GB and they cannot be co-resident on a 24 GB card (server loads one at a time).
  GPU server is `tools/music-creator/`, reached via `MUSIC_SERVER_URL` / `MUSIC_TOKEN` through
  the allow-listed proxy at `/api/music-creator/[...path]`. Same shape as [[realtime-lucy-app]].
- Everything except rendering works with no GPU and is the reason the app is usable today:
  writing (`/api/music-creator/write`, via [[hub-ai-provider]]), artist search (iTunes, keyless),
  preview fetch + in-browser decode/trim to WAV, score editing, projects, Voice Library.
- YuE2 API: `YuE2Pipeline.from_pretrained("m-a-p/YuE2-3B", vae="m-a-p/YuE2-Vae")`, request is
  `{id, style, lyrics, cot: full|melody|off, seed, abc?, cfg_scale?}`, `song.save_artifacts()`.
  `cot="full"` is what makes Remix/Stems possible — it returns a readable ABC score.
  Cover/mashup path = SheetSage2 (own venv, Py 3.10/3.11 + FFmpeg 6.1) → strip chords →
  `cot="melody"`. Weights are **CC BY-NC 4.0: non-commercial only** (code Apache 2.0). AuK is MIT.
- A Voice Library entry is a reference CLIP plus metadata (AuK is zero-shot — no per-voice
  checkpoint exists). The clip stays device-local and is NOT synced; `serverRefId` is a cache,
  and `ensureVoiceOnServer()` re-uploads after a server rebuild. That is what makes "never
  process the artist again" true.
- Preview server: launch.json `music-creator-preview-3237` (see [[hub-parallel-dev-servers]]).

**AI Producer (2026-09-18, commit d29b8a3):** Song Creator takes ONLY style + lyrics. Per prompt the
user picks "AI Producer" or "Exactly as typed" (owner requirement: optimisation is optional, raw
prompt must be sendable untouched). Pipeline in `src/lib/music-creator/producer.ts` + NDJSON route
`/api/music-creator/produce`: producer plan → engineer (style ≤1,000 chars, lyrics, vocal/production
direction, arrangement, optimized prompt) → code QC (intent-concept preservation, filler, BPM, names,
placeholders) → one revision → clause-drop `fitStyle` last resort. Owner's taste refs live in `TASTE`.
Gotcha: Opus hidden reasoning ate a 6,000 max_tokens budget and truncated the JSON — route now caps
`reasoning.max_tokens` 1500 and gives 12k output; whole run ~2 min on a 285 s budget.

**GPU wake (same commit, NOT yet tested against a real pod — none existed on 2026-09-18):**
`/api/music-creator/gpu` (pod.ts) reads/starts the pod via RUNPOD_API_KEY + MUSIC_POD_ID; server URL
is derived from the pod id if MUSIC_SERVER_URL is unset; `studio.watch` calls `ensureServer` which
wakes + polls /health up to 20 min. Pod create sets `cmd` to run `/workspace/autostart.sh` (written
by bootstrap) then `/start.sh`; server `--idle-stop-minutes` (idle.py, default 20) stops its own pod.
v2 API schema is at `https://api.runpod.io/v2/openapi.json`; SSH keys can be registered via
`PUT /v2/account/ssh-keys` instead of the console.

**The real pod (created 2026-09-18):** owner wants to pay ONLY while using it; chose a 60 GB network
volume (~$4.20/mo) over zero-storage (40-60 min cold start). Volume `3brz3utue0` in **EU-RO-1**, pod
`music-creator` on **RTX PRO 4500 Blackwell 32 GB ~$0.72/hr** (no A40 exists at any volume-capable
site; US-TX-3 had no 48 GB card at all). `pickPlacement()` in setup.mjs now picks GPU+site together
from `/catalog/gpus?include=AVAILABILITY`, ranked by stock then price. Blackwell = sm_120 needs cu128
torch: bootstrap `fit_torch_to_card` swaps any venv's torch to cu128. pip cache moved off the volume.
v2 volume API field is `dataCenter` (not `dataCenterId`). pod.ts finds the pod BY NAME and, if a
stopped pod won't start (host GPU taken), terminates it and creates a replacement on the volume.
.env.local has MUSIC_TOKEN, MUSIC_POD_ID, MUSIC_MIN_VRAM=32, MUSIC_VOLUME_GB=60; the owner's Vercel
CLI login had expired, so the live site's RUNPOD_API_KEY + MUSIC_TOKEN need the owner (or `vercel login`).
VERIFIED LIVE 2026-09-18: full install fits 57 GB, so SheetSage2 was SKIPPED to stay on 60 GB (Mashup
shows "not installed"; growing the volume ~+$1.40/mo would allow it). A 3:34 song rendered in ~2.5 min.
Stopped→woken from the site→server answering in 36 s. Vercel prod env now has RUNPOD_API_KEY,
MUSIC_TOKEN, MUSIC_POD_ID, MUSIC_MIN_VRAM (owner re-ran `vercel login` via device link). A pre-existing
bug made EVERY render fail on first poll (jobId TDZ in studio.watch) — fixed in 34155a1.
Unrelated: an old stopped pod "LiveAvatar-Agent-Pro" (A100, 100 GB disk) exists on the account.

**RunPod (chosen 2026-09-15):** a **Pod**, not Serverless like [[auteur-app]] — the server is
stateful (job queue, produced files, voice reference clips) and the weights are 50-60 GB, so a
per-request worker would lose the library and re-download everything. Cost of that choice: it
bills every second it is RUNNING (~$0.49/hr for the 48 GB A40 the script picks), so `--stop` is
the habit to keep. `tools/music-creator/runpod/setup.mjs` (REST API **v2**, `https://api.runpod.io/v2`;
v1 retires 2026-11-15) does dry-run/create/deploy/status/stop/teardown and was verified live
against the catalog. Facts learned the hard way:
- catalog GPU shape is `{memory: GB, price: {secure, community, serverless}, maxCount, manufacturer}`
  — `price` is an OBJECT, and filtering to `manufacturer === "NVIDIA"` matters or an MI300X wins on RAM.
- the datacenter catalog does NOT say which GPUs a site has; the volume pins the site, so a
  capacity failure means "wrong card for that site", not "RunPod is full".
- pod URL is `https://<id without the pod_ prefix>-8770.proxy.runpod.net`, behind Cloudflare with a
  **100-second cap** — fine because every long op is submit-then-poll; the site's proxy waits 95 s.
- a pod only accepts SSH keys registered on the account BEFORE it was created; this machine had
  no `~/.ssh` key at all, so `--deploy` needs `ssh-keygen` + the console first.
- **Residency rule, easy to get wrong twice:** the pod runs the server FROM the YuE2 venv (no
  `--yue2-python`, which would force subprocess mode and reload 7.3 GB per song), so YuE2 is
  in-process and stays resident between songs. AuK/SheetSage2 stay subprocesses and `free_gpu`
  unloads YuE2 before they start — so the two models are NEVER co-resident and the peak is
  ~25 GiB, not ~49. Therefore `--keep-loaded one` is correct on any 48 GB card and `both` is an
  OOM there (it makes `free_gpu` a no-op); `both` needs 80 GB. That also means the A40/A6000
  "48 GB vs 46068 MiB" gap does NOT matter here: cheapest-at-48 wins, the A40 at ~$0.49/hr.
  32 GB cards cost MORE per hour than the A40, so there is nothing below 48 worth taking.

**Song library (2026-09-19, shipped as a283a2c on main, deployed 2026-09-19 after the owner said "push it"; the same changes also sit uncommitted on fno-v2-foundation):** takes used to play only from the GPU pod
(`/api/music-creator/files/<id>`), so they went silent whenever the pod idle-stopped — the owner's first
song "Sigh Bloom" hit exactly this. Now every take with a fileId is copied right after render into the
private Supabase bucket `music-creator` at `<uid>/<renderId>.<ext>` (`src/lib/music-creator/library.ts`,
POST `/api/music-creator/library`; uid from the Supabase session, NOT the editable hub_uid cookie) and
`Render.saved` records it. GET `/api/music-creator/library/<file>` 302s to a signed Storage URL (Range
seeking works; never streams 28 MB through a function). Unsaved takes auto-backfill when the GPU is found
awake (never wakes it for that) or via the take's "Save to my account" button (wakes it). UI:
`Library.tsx` FinishedSongs = dense list + one sticky player; home shows all with per-tool filter chips,
each tool page shows its own at the bottom; ToolFrame has "Your song is ready" banner + "Create another
song" (= openTool, fresh project) + "New song" header button. Sigh Bloom was rescued into the owner's
real account by a one-off script. Preview config `music-creator-storage-3238` (--no-auth-keep-storage)
saves under `local/`.
Saved copies are re-encoded to 256k MP3 via `ffmpeg-static` in library.ts (28 MB FLAC → 5.1 MB; falls back
to the original if ffmpeg fails); next.config `outputFileTracingIncludes` bundles the binary into the save route.
RunPod answers a STOPPED pod with a bare (non-JSON) 404 — only a JSON 404 means the file is really gone.
Untouched empty projects (no renders, updated === created) are pruned on load and when leaving them;
"Pick up where you left off" lists only projects with a finished song; typed drafts stay in Projects.

**Mashup rebuilt (2026-09-19):** the tool now takes TWO songs instead of one-song-plus-prose.
One prompt line → writer task `mashup-find` extracts two SEARCH QUERIES (never song facts — the
iTunes catalogue decides what the records are, a model asked to name a track invents plausible
ones) → both looked up → user confirms. Then a blend panel decides what comes from which record
(melody, lyrics, chords, drums, instruments, vocal, tempo, plus a dominance slider), and every
finished take is appended to `project.data.versions` as a `MashupVersion` holding the exact style
+ lyrics that produced it — so "change the chorus" adds v2 without destroying v1, and every
version plays, downloads and can be re-rendered on its own. Pure logic in
`src/lib/music-creator/mashup.ts` (tested); the card for one side is `tools/SongPicker.tsx`.
Three new writer tasks: `mashup-find`, `mashup-blend`, `mashup-revise`.

**Two routes, and why the screen makes you pick:** GENERATED = SheetSage2 score + YuE2 melody mode
(a new recording; no original audio survives). LAYERED = AuK splits one record's vocal and the
other's backing, ffmpeg lays them together (the literal DJ mashup, real audio, but nothing in this
stack beat-matches, key-matches or time-stretches). `ELEMENTS[].appliesTo` in mashup.ts decides
which knobs are live per route; dead knobs are disabled with the reason, never hidden. `vocal` is
the ONE knob live on both — on layered it picks which record gets split for its vocal.

**How to apply — pod facts learned by actually running it 2026-09-19:**
- `requires` on a ToolDef gates the WHOLE tool, so Mashup lists only `["yue2"]`. Listing
  sheetsage there made a missing SheetSage2 disable RENDERING, which it has nothing to do with.
  Per-step engines are checked next to their own buttons (`hasEngine(server,…)`) instead.
- **The installed AuK build exposes NO separation entry point** ("looked for: separate,
  source_separation, separate_audio, denoise"), even though `/health` reports `auk.available:
  true`. So the layered route AND Remix/Stems separation are both dead on this pod, and health
  cannot predict it — the error only surfaces at submit. Not fixable from the app.
- **First `POST /jobs/separate` on a cold pod always times out at 95 s.** The server runs a
  synchronous AuK-import probe before queueing (deliberate: a 501 now beats a failed job in ten
  minutes), and that import outlasts the proxy's 95 s Cloudflare-imposed ceiling. The second
  attempt returns in seconds. Retry once before believing "server unreachable".
- SheetSage2 being skipped (volume size, see above) used to make the generated route 100% dead.
  The score box is now always open, so an ABC score from anywhere — Remix/Stems, hand-written —
  can be pasted in and rendered. That is how the route was verified on this pod.
- Revisions keep the seed on purpose (same record, one thing changed); "Another take of this"
  uses a FRESH random seed, because YuE2 is deterministic and reusing the seed returns a byte-
  identical duplicate while claiming to be a new take.
