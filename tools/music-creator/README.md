# Music Creator — YuE2 (songs) + AuK (speech) on one GPU

The GPU side of the **Music Creator** app (`/apps/music-creator` in the hub).
It is a small aiohttp server in front of two open-source models, and it does
not do anything those models cannot do.

```
tools/music-creator/
  server/server.py        aiohttp app: auth, CORS, the HTTP contract, CLI
  server/engines.py       lazy loading, the one-model-at-a-time VRAM rule,
                          and the in-process / other-venv split
  server/jobs.py          the FIFO and the single worker thread
  server/tasks.py         what each job means: paths, artifacts, result shape
  server/storage.py       produced files and stored voice reference clips
  server/audio.py         ffmpeg: probing, wav conversion, mixing
  server/selftest.py      --self-test report
  server/workers/         the model-facing code, importable *and* runnable as
                          scripts by another virtualenv's python
  requirements.txt        the server's own deps (aiohttp) — not the models'
```

## The two models, and what they cannot do

**YuE2** ([multimodal-art-projection/YuE](https://github.com/multimodal-art-projection/YuE))
writes and performs a whole song: a style description and lyrics go in, a
finished mix comes out — vocals, backing, arrangement. `m-a-p/YuE2-3B`
generates, `m-a-p/YuE2-Vae` decodes the latent into audio you can listen to.
(`m-a-p/YuE2-Vae-legacy` exists only to reproduce the paper's benchmark
numbers. Do not use it for listening.)

What steers it: `style` (genre, instruments, vocal character, language,
tempo), `lyrics` (with `[Verse]` / `[Chorus]` section tags and the actual
words), `cot` (`full` / `melody` / `off`), `seed`, `cfg_scale`, and an
optional `abc` score. **That is the complete list.** YuE2 exposes no
audio-reference argument, no voice cloning, no phoneme alignment and no
inpainting. You cannot give it a recording of a singer and ask for that
singer. You cannot give it a stem and ask it to fill a gap. If a UI offers
either, the UI is lying.

**AuK** ([Tencent-Hunyuan/AuK](https://github.com/Tencent-Hunyuan/AuK)) is a
1.5B speech foundation model: give it a reference clip and some text and it
says the text in that voice, zero-shot. It also does speech editing and
source separation (denoise, speech separation, music separation).

**AuK cannot sing, and it cannot make music.** It has no notion of melody,
key or tempo. Pointing it at a sung reference gets you speech in that timbre,
not a vocal take. Every note in this app comes from YuE2. The only way the
two models meet is `/mix`, which lays two finished files on top of each other
with ffmpeg.

"Zero-shot" is worth spelling out too: a **voice profile** here is a stored
wav file and a name. Nothing is trained, there is no per-voice checkpoint,
and there is nothing to wait for — `POST /voices` is a file upload, and
generation conditions on that clip each time.

**SheetSage2** (`m-a-p/SheetSage2`) is the third piece: it transcribes audio
to an ABC score. That makes the cover/mashup workflow possible — transcribe a
source track with `melody_only`, strip the chord symbols, then hand the score
to YuE2 with `cot="melody"` and a new target style. The result is a
re-performance of the *tune* in a different style. The model never hears the
original recording and nothing of the original singer survives, because there
is no path for it to.

## Licences — read this before deploying anything

| Component | Code | Weights |
| --- | --- | --- |
| YuE2 | Apache 2.0 | **CC BY-NC 4.0 — non-commercial only** |
| AuK / AuK-Flash | MIT | MIT |
| SheetSage2, MERT-v2-FullSong | see their model cards | see their model cards |
| this server | same terms as the rest of the hub | — |

The YuE2 weights are the binding constraint: **CC BY-NC 4.0 means you may not
use songs this server generates commercially**, and that covers a paid
product, ad-supported distribution, and selling the output. Personal,
portfolio and research use with attribution is fine. AuK being MIT does not
change that — a mix containing YuE2 audio is a derivative of YuE2 output.

## Install

Three environments, on purpose. YuE2 wants Python 3.12, AuK wants 3.10, and
SheetSage2 wants 3.10/3.11 with FFmpeg 6.1 beside it; one virtualenv cannot
be all three, and pip will spend an hour proving it to you. The server sits
outside all of them and reaches whichever it cannot import through another
interpreter (see *Two ways to reach a model* below).

Linux, one NVIDIA GPU, BF16. ffmpeg on PATH.

### The server itself

```bash
python -m venv ~/music-creator/venv && source ~/music-creator/venv/bin/activate
pip install -r tools/music-creator/requirements.txt      # aiohttp, that is all
```

### YuE2 (Python 3.12, ~24 GB VRAM)

```bash
git clone https://github.com/multimodal-art-projection/YuE ~/music-creator/YuE
cd ~/music-creator/YuE
python3.12 -m venv .venv && source .venv/bin/activate
python -m pip install .

# weights (large): the generator and the listening VAE
hf download m-a-p/YuE2-3B
hf download m-a-p/YuE2-Vae
```

The server passes `--yue2-model` / `--yue2-vae` straight through, so a hub id
or a local directory both work. Anything not in the local Hugging Face cache
is downloaded on the first job — `/health` reports `weights: "not-downloaded"`
so the website can warn instead of looking hung.

### AuK (Python 3.10, ~24.8 GiB VRAM)

```bash
git clone https://github.com/Tencent-Hunyuan/AuK ~/music-creator/AuK
cd ~/music-creator/AuK
python3.10 -m venv .venv && source .venv/bin/activate
python -m pip install -e .

hf download tencent/AuK --local-dir ckpts/AuK              # auk_base.safetensors + config.yaml
hf download tencent/AuK-Flash --local-dir ckpts/AuK-Flash  # optional: 4-step distilled
hf download Qwen/Qwen2.5-Omni-3B                           # AuK loads this as part of the stack
```

Point the server at the checkpoints with absolute paths (`--auk-ckpt`,
`--auk-config`, and `--auk-flash-ckpt` / `--auk-flash-config` if you want
`flash: true` to work), or start it from the AuK checkout so the default
relative `ckpts/...` paths resolve.

### SheetSage2 (Python 3.10/3.11 + FFmpeg 6.1)

```bash
python3.10 -m venv ~/music-creator/sheetsage-venv
source ~/music-creator/sheetsage-venv/bin/activate
pip install torch transformers                 # plus whatever its model card lists
hf download m-a-p/SheetSage2 --local-dir ~/music-creator/models/SheetSage2
# m-a-p/MERT-v2-FullSong is fetched by SheetSage2 itself on first use
```

SheetSage2 is **always** run as a subprocess, even if it would import in the
server's interpreter: it pins transformers versions that fight with YuE2's.

## Two ways to reach a model

* **in-process** — the package imports in the interpreter running the server
  (one venv holding both is possible if your versions happen to agree). The
  model stays resident between jobs; swapping engines is a `del`.
* **another venv** — `--yue2-python` / `--auk-python` / `--sheetsage-python`
  point at that environment's `python`, and the job runs there through
  `server/workers/*.py`, which load the model, do the work, print a JSON
  result and exit.

The second way pays the model load **on every job** — minutes, for YuE2. That
is the honest price of two incompatible environments on one box. It is
smaller than it looks, because only one model may be resident anyway, but if
you are generating song after song, install YuE2 into the server's own venv
and use another interpreter only for AuK.

```bash
# typical: YuE2 in the server's venv, AuK and SheetSage2 elsewhere
python tools/music-creator/server/server.py --port 8770 \
  --auk-python ~/music-creator/AuK/.venv/bin/python \
  --auk-ckpt ~/music-creator/AuK/ckpts/AuK/auk_base.safetensors \
  --auk-config ~/music-creator/AuK/ckpts/AuK/config.yaml \
  --sheetsage-python ~/music-creator/sheetsage-venv/bin/python \
  --sheetsage-dir ~/music-creator/models/SheetSage2 \
  --data-dir ~/music-creator/data --token "$MUSIC_TOKEN"
```

Check everything before you trust it:

```bash
python tools/music-creator/server/server.py --self-test
```

It prints one line per moving part — packages, weights, ffmpeg, GPU, VRAM —
and loads nothing onto the card. It also runs when aiohttp itself is missing,
because that is one of the things you want it to tell you.

## VRAM

| | Needs | Notes |
| --- | --- | --- |
| YuE2 (3B, BF16) | ~24 GB | one request at a time; no offload option |
| AuK (1.5B, bf16) | ~24.8 GiB peak | `--cpu-offload` saves about a third, and is slower |
| AuK-Flash | same footprint | 4 steps instead of the full schedule, so faster |
| SheetSage2 | a few GB | runs in its own process, which exits afterwards |

**The two do not fit together on a 24 GB card.** So engines load lazily on
first use, at most one stays resident, and the other is torn down — reference
dropped, `gc`, `torch.cuda.empty_cache()` — *before* the next one loads. Every
swap is logged (`unloading YuE2 (making room for auk)`) and `/health` reports
what is resident.

* `--keep-loaded one` (default) — swap as needed. Correct for 24 GB.
* `--keep-loaded both` — keep both resident. Needs roughly 48 GB+; the
  self-test says so if your card is smaller.
* `--keep-loaded none` — free after every job. For a shared box.

A job that runs in another venv always frees the resident engines first: a
subprocess holding 24 GB next to a resident 24 GB model is exactly the OOM
this rule exists to avoid.

## Run, and point the website at it

```bash
python tools/music-creator/server/server.py --port 8770 --token SECRET
```

On the site set:

```
MUSIC_SERVER_URL=http://localhost:8770
MUSIC_TOKEN=SECRET
```

`--token` is optional. When it is set, every endpoint except `/health`
requires `Authorization: Bearer <token>` (a `token` field in the JSON body is
accepted too, for callers that cannot set headers). `/health` stays open so
the website can show "server offline" versus "server up, model missing"
without holding a secret.

CORS is wide open (`Access-Control-Allow-Origin: *`) exactly like the Realtime
Lucy server: the browser talks to the GPU box directly, and Chrome treats
`localhost` as a secure origin even from an https page. For a GPU on another
machine, put the server behind https or proxy it from the site.

**The server starts and `/health` answers on a machine with no GPU and no
model installed.** That is deliberate, and it is how the website's "not
installed" states get tested: `available: false` with a `reason`, and job
submissions answered with 503 and the same sentence.

## HTTP contract

JSON in, JSON out. Long work is a job: `POST` returns `{"job_id": ...}` and
the client polls `GET /jobs/{id}`. Jobs run strictly in order in one worker
thread, because there is one GPU.

| | |
| --- | --- |
| `GET /health` | engines (available / loaded / reason), gpu, queue, version. Never 500s. |
| `POST /jobs/song` | `{id?, style, lyrics, cot?, seed?, cfg_scale?, abc?}` → YuE2 |
| `POST /jobs/transcribe` | `{audio_b64, filename?, melody_only?}` → SheetSage2 |
| `POST /jobs/speak` | `{text, reference_b64 \| voice_ref_id, instruction?, gen_seconds?, flash?}` → AuK |
| `POST /jobs/separate` | `{audio_b64, mode:"vocals"\|"music"}` → AuK, or 501 (see below) |
| `GET /jobs/{id}` | `status`, `progress`, `stage`, `result`, `error`, timestamps |
| `POST /voices` | `{name, audio_b64, transcript?}` → `{voice_ref_id, name, created, duration_s, sample_rate}` |
| `GET /voices` | a JSON array of those records |
| `PATCH /voices/{id}` | `{name}` → the updated record |
| `DELETE /voices/{id}` | `{deleted: true}` |
| `GET /files/{file_id}` | streams the audio with the right content type |
| `POST /mix` | `{music_file_id\|music_b64, vocal_file_id\|vocal_b64, vocal_gain_db?, music_gain_db?, offset_s?}` → `{file_id, ...}` |

Statuses mean what they say: **400** your request is wrong (and the message
says how), **401** bad token, **404** unknown job/file/voice, **501** the
installed build genuinely cannot do this, **503** the model is not installed
here or ffmpeg is missing, **500** a bug worth reporting.

Song requests are validated against YuE2's own `SongRequest` rules before
they are queued — id pattern, `cot` choices, `seed` in `[0, 2**63)`,
`cfg_scale` in `[0, 20]`, `abc` only with `cot` `full`/`melody` — so a typo
comes back immediately instead of failing at the front of a long queue.

Timestamps (`queued_at`, `started_at`, `finished_at`) are ISO-8601 UTC
strings like `2026-09-15T21:34:00Z`, or `null` before they happen.

### Progress is coarse, and that is the honest answer

`progress` moves when a stage ends, not on a timer. The upstream pipelines do
not expose a per-step callback that means anything to a human, so what you get
is the stage name (`loading YuE2`, `generating (plan, semantic, synthesis,
decode)`, `writing artifacts`) and the fraction of stages done. There is no
invented number that ticks upward to look busy.

### A song's result

```json
{
  "file_id": "…", "filename": "my-song.flac", "content_type": "audio/flac",
  "duration_s": 183.4, "sample_rate": 44100,
  "id": "my-song", "seed": 7, "cot": "full", "cfg_scale": null, "used_abc": false,
  "truncated": {…},
  "abc": "X:1\n…", "plan": {…}, "result": {…},
  "artifact_file_ids": {"score.abc": "…", "plan.json": "…", "result.json": "…", "latent.npy": "…"},
  "out_dir": "…/data/songs/<job id>"
}
```

`save_artifacts()` writes `audio.flac`, `score.abc`, `plan.json`,
`result.json` and `latent.npy`; all of them are kept and every one gets a
`file_id`, because the score and the plan are the interesting part when a
generation goes sideways. `truncated` is YuE2's own dict of truncation flags —
if it says the lyrics were cut, they were cut.

### The cover workflow

1. `POST /jobs/transcribe` with the source audio and `melody_only: true`.
2. The result carries both `abc` (what SheetSage2 produced) and
   `stripped_abc` (the same score with chord symbols removed — in ABC those
   are the double-quoted tokens, `"Am"`, `"G7/B"`). Chords come out because
   "render this melody in a new style" should not also hand over the source
   harmony.
3. `POST /jobs/song` with `cot: "melody"`, `abc: <stripped_abc>` and your new
   `style`.

### Separation

AuK's model card lists source separation as a capability, but its published
Python example covers generation only. So this server looks for a real method
on `AukInfer` (`separate`, `source_separation`, `separate_audio`, `denoise`)
and, when there is none, returns **501 with an explanation** rather than
inventing a calling convention and handing you a file that is not what you
asked for. The check runs at submit time — it imports the class, not a
checkpoint — so you find out immediately.

When such a method does exist, the call is built from its signature and the
return value is saved if it is a path, an `(audio, sample_rate)` pair, or a
dict containing one. Anything else is an error that says so, and nothing is
written.

### Mixing

`/mix` is ffmpeg (`volume` → `adelay` → `amix` with `normalize=0`, so your
gains are the gains you get) and does not touch the GPU, so it answers
synchronously instead of going through the queue. A positive `offset_s`
delays the vocal, a negative one delays the music. It is two finished files
laid on top of each other: it is not stem-aware, it does not time-align
anything, and it cannot make a spoken take land on the beat.

## On a RunPod / remote box

Nothing here assumes a local GPU. On a rented box:

1. Pick an image with CUDA and ffmpeg, and a card that fits the table above
   (24 GB works with `--keep-loaded one`; 48 GB lets you use `both`).
2. Install as above. `HF_HOME=/workspace/hf` on the persistent volume is worth
   setting before the first download — the weights are large, and a pod
   without it re-downloads them on every restart.
3. Run with `--host 0.0.0.0 --port 8770 --token "$MUSIC_TOKEN"` and expose the
   port. **Use a token**: the endpoints happily accept uploads and spend GPU
   time on them.
4. `--data-dir` on the persistent volume too, or produced files vanish with
   the pod and `/files/{id}` starts 404ing.
5. Point the site at the pod's https URL with `MUSIC_SERVER_URL`. Plain http
   from an https page is blocked by the browser; either terminate TLS in front
   of the server or proxy it from the site.

A cold pod's first song therefore costs the weight download plus the model
load plus the generation. `/health` tells the website which of those it is
waiting on.

## What this server will not do

No stub audio, no simulated progress, no "demo mode". If a model is missing
the job fails and names it. If a capability is missing the endpoint returns
501. The only audio that ever comes out of here is what a model produced or
what ffmpeg mixed from model output.
