# H3 Prompt Lab — PC worker

The H3 Prompt Lab (`/apps/h3-experiments`) lives on the hub, but MiniMax H3 runs on
this PC's GPU, inside WanGP in Pinokio. This worker is the bridge. It is a plain
Node program (v20+, zero npm dependencies) that:

1. **Polls the hub** every 5 s — `POST /api/h3-lab/worker/claim`. That call is also
   its heartbeat: it carries the worker's status, which the lab shows on its
   H3 Connection page.
2. **Renders** (`kind:"render"`) on the PC's existing MiniMax H3 install through
   WanGP's MCP server, measures the clip with ffmpeg, uploads it and posts the result.
3. **Thinks** (`kind:"think"`) — runs a reasoning prompt through Claude Code
   (`claude -p`) when the lab's brain is set to Claude Code, and posts the answer.
4. **Ticks** (`kind:"tick"`, and every `TICK_EVERY_MIN` minutes while idle) —
   `POST /api/h3-lab/worker/tick`, so the lab's agent keeps working with no browser open.

The hub owns the queue, so stopping or restarting the worker never loses work.
A finished render whose result cannot be delivered (hub down) is kept in
`out/pending/` and sent as soon as the hub answers again.

**It never starts a second `wgp.py`.** If WanGP is open in Pinokio's own web UI
(it holds the GPU), the worker reports `wangp: "busy"` with a plain-English
reason and takes no renders until it is closed. Only when no `wgp.py` is running
at all does it start WanGP's MCP server itself.

## Setup

1. In the lab, open **H3 Connection** and create a worker token (shown once).
2. Copy `.env.example` to `.env` in this folder and paste the token as `H3LAB_TOKEN`.
   Set `HUB_URL` to the hub (`http://localhost:3000` for `npm run dev`, or the live site).
   `.env` is gitignored.
3. Check everything: `node tools/h3-lab-worker/worker.mjs --doctor`
4. Run it: double-click `start-worker.cmd`, **or** run `install-autostart.cmd` once
   to start it hidden at every Windows sign-in (log: `out/worker.log`).
   `uninstall-autostart.cmd` removes that and stops it.

| `.env` key | Default | |
|---|---|---|
| `HUB_URL` | `http://localhost:3000` | the hub |
| `H3LAB_TOKEN` | — | worker token from H3 Connection |
| `WANGP_DIR` | `C:\pinokio\api\wan` | Pinokio's WanGP folder (`…\wan` or `…\wan\app`) |
| `WANGP_MCP` | `http://127.0.0.1:42004/mcp` | WanGP's MCP server |
| `FFMPEG_PATH` | `ffmpeg` on PATH | `ffprobe` is taken from the same folder (or `FFPROBE_PATH`) |
| `TICK_EVERY_MIN` | `5` | agent tick interval while idle |
| `H3LAB_POLL_SECONDS` | `5` | claim interval |
| `WANGP_UI_PORT` | `42003` | Pinokio web UI port — only checked when the process list cannot be read |
| `THINK_TIMEOUT_MIN` | `10` | ceiling on one think job |
| `CLAUDE_MODEL` | Claude Code's default | model for think jobs |

## Commands

```
node tools/h3-lab-worker/worker.mjs                     run (poll, render, think, tick)
node tools/h3-lab-worker/worker.mjs --once              one claim cycle and the job it hands out, then exit
node tools/h3-lab-worker/worker.mjs --doctor            hub + token, WanGP + H3 models, ffmpeg, claude
node tools/h3-lab-worker/worker.mjs --measure clip.mp4  print the ClipMetrics for any clip
node tools/h3-lab-worker/worker.mjs --doctor --measure clip.mp4
node --test "tools/h3-lab-worker/lib/*.test.mjs"        unit tests (quote the glob on Windows)
```

## Wire contract (mirrors `src/lib/h3-lab/api.ts` — change both together)

All calls are `POST` with `Authorization: Bearer <H3LAB_TOKEN>` and JSON bodies.

| Route | Body | Answer |
|---|---|---|
| `/api/h3-lab/worker/claim` | `{ status: WorkerStatus, canRender, canThink }` | `204` nothing · `{kind:"render", generation:{id,prompt,settings,seconds}}` · `{kind:"think", job: ThinkJob}` · `{kind:"tick"}` |
| `/api/h3-lab/worker/progress` | `{ generationId, status: "rendering"\|"measuring"\|"uploading", detail }` | — |
| `/api/h3-lab/worker/upload` | `{ generationId }` | `{ url, key }` — `url` null = keep the clip local |
| `/api/h3-lab/worker/result` | `{ generationId, ok, error?, renderSeconds?, clipKey?, localPath?, bytes?, metrics?: ClipMetrics, frames?: string[] }` | — |
| `/api/h3-lab/worker/think` | `{ jobId, ok, result?, error? }` | — |
| `/api/h3-lab/worker/tick` | `{}` | `{ steps: StepResult[] }` |

`WorkerStatus` sent on every claim: `machine` (hostname), `version` `"1"`,
`wangp` `ready|down|busy|unknown`, `wangpDetail` (plain English), `ffmpeg`,
`claude`, `current` (generation id or null), `models` (H3 model types WanGP lists),
`queueDepth` 0. `canRender` is false while a render runs or WanGP is held
elsewhere; `canThink` is false while a think job runs or `claude` is missing —
so think jobs still run in parallel with a render.

### Render flow

claim → progress `rendering` → settings prepared → WanGP started if needed →
`wangp_generate` (progress every 30 s with elapsed time; the claim loop keeps
heartbeating with `canRender:false`) → `measuring` → `uploading` →
`/upload` → PUT the MP4 to the signed URL (`Content-Type: video/mp4`, `x-upsert: true`)
→ `/result` with `renderSeconds` (wall clock of the WanGP call), `clipKey`,
`localPath` (always WanGP's absolute output path), `bytes`, `metrics`, `frames`.
Any failure posts `/result {ok:false, error}`; a measuring or upload failure does
not fail the render (metrics are omitted / the clip stays local).

**Settings are forwarded verbatim** as WanGP's `settings` (the hub sends them
complete: model_type, prompt, resolution, video_length, seed, steps, loras,
config…). The worker invents nothing. Two exceptions:

- prompt line breaks are flattened to spaces (WanGP reads each line as a separate prompt);
- `data:` URLs in `image_refs`, `image_start` (and `image_end`) are written to
  `out/refs/<generationId>-<i>.<ext>` and replaced by that absolute path; they
  are deleted once the result is posted. Real paths are left alone.

WanGP's MCP is spoken exactly as `tools/studio-bridge` does — raw `node:http`
(no socket timeout on a generation; a render holds one request open 5–15 min),
`Accept: application/json, text/event-stream`, `Mcp-Session-Id` echoed,
`initialize` (2024-11-05) → `notifications/initialized` → `tools/call`, SSE or
JSON replies. The worker reads `wangp_generate`'s schema from `tools/list`:
WanGP 1.30 takes `{ settings, wait:true }`; older builds take
`{ action:"generate", arguments:{ source } }` (what the bridge sends — 1.30
still accepts it). Relative `generated_files` paths are resolved against the
WanGP app folder.

## Measurement (`lib/measure.mjs`, `lib/motion.mjs`)

All of it is ffmpeg evidence, ~4–6 s for a 5 s 832x480 clip. Each step degrades
on its own: a failed step gives a neutral value (SSIM 1, empty lists, `motion:null`,
`measuredMove:"unknown"`) and its name in an extra `unmeasured: string[]` field.

| Field | How |
|---|---|
| `durationSec width height fps frames` | `ffprobe -select_streams v:0 -show_entries stream=width,height,avg_frame_rate,r_frame_rate,nb_frames,duration:format=duration -of json` |
| `sampleTimes`, `frames` | 6 times at (i+0.5)/6 of the clip; `ffmpeg -ss t -i f -frames:v 1 -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-,scale=384:-2" -q:v 5 x.jpg` → JPEG data URLs |
| `luma` | the YAVG printed by that same command (0–255, video range, so ~16–235) |
| `cuts` | `ffmpeg -i f -an -vf "scdet=threshold=10,metadata=print:file=-" -f null -` — `pts_time` + `lavfi.scd.score` from stdout; scores ≥ 10 after t=0 |
| `freezes` | `ffmpeg -i f -an -vf freezedetect=n=-60dB:d=0.5 -f null -` — `freeze_start/freeze_end` from stderr (an unclosed freeze ends at the clip's end) |
| `ssimAdjacent ssimMin ssimMinAt ssimFirstLast` | one decode `-vf scale=192:H:flags=area,format=gray -f rawvideo -pix_fmt gray -`; 12 evenly spaced frames written as PGM; `ffmpeg -i a.pgm -i b.pgm -lavfi ssim -f null -` per pair, `All:` parsed. `ssimMinAt` = time of the later frame |
| `motion`, `measuredMove` | `lib/motion.mjs` on 24 evenly spaced frames from the same decode, halved to 96 px |

**Camera motion** — for each consecutive pair, a joint search over magnification
(0.92–1.08 in 1 % steps, about the centre) × integer shift (±8 px at 96 px),
both refined to sub-pixel/sub-step with a parabola through the cost, cost = mean
absolute difference. Summed (zoom compounded) over the clip; pairs straddling a
detected cut are dropped.

Sign convention — the numbers describe the **camera**:
`dx > 0` camera moved/panned **right** (the picture slid left);
`dy > 0` camera moved **down** (tilt down; picture slid up), `dy < 0` tilt up;
`zoom` = % magnification over the clip, `> 0` push-in, `< 0` pull-out;
`dx`/`dy` are in source-video pixels; `rot` is always 0; `energy` = mean residual
luma difference after the best alignment (what the subject did that the camera
didn't explain).

Classification: handheld when per-pair shifts keep reversing (≥ 2 reversals,
net < half the path, path ≥ 3 % of the frame); otherwise the largest of
zoom (÷ 3 %), net horizontal travel (÷ 3 % of width) and net vertical travel
(÷ 3 % of height) — travel first loses up to half the zoom, since pushing toward
an off-centre subject also slides the picture; nothing over its bar = `static`.

**Limits** — it is a pointer, not a verdict:
- no parallax model: dolly vs optical zoom, and pan vs truck/track, look the same
  (`push-in`, `pan-*` are reported); arcs/orbits come out as a mix (often pan or push-in);
- rotation is not measured;
- a big subject (a face filling the frame, a bird flying at camera) drags the
  estimate — H3 clips push hard, so zoom totals of 50–150 % are normal on fast push-ins,
  and a per-pair move beyond ±8 % / ±8 px saturates at that limit;
- SSIM is on 192 px grayscale, ~0.4 s apart: it sees jumps and morphs, not fine texture.
- vidstabdetect was not used — its .trf is per-block local motion and parsing it reliably was not worth it.

## Files

```
worker.mjs                 entry (loop, --once, --doctor, --measure)
lib/env.mjs                .env loader + config
lib/hub.mjs                hub client (claim, progress, upload, result, think, tick, signed PUT)
lib/wangp.mjs              WanGP MCP client, status/busy detection, start-on-demand, settings prep
lib/measure.mjs            ffprobe/ffmpeg measurement → ClipMetrics + frames
lib/motion.mjs             pure camera-motion maths
lib/claude.mjs             think jobs through `claude -p --output-format text --allowedTools Read`
lib/proc.mjs               spawn helper (never throws) + small pool
lib/*.test.mjs             unit tests
start-worker.cmd           double-click launcher (window)
install-autostart.cmd      start hidden at sign-in (+ now); start-hidden.vbs is what it runs
uninstall-autostart.cmd    undo, and stop the running worker
out/                       logs, pending results, temp refs (gitignored)
```
