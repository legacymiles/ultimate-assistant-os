# Music Creator on a RunPod Pod

Runs the GPU side of Music Creator (`tools/music-creator`) on a **Pod** you
rent by the hour: YuE2 for songs, AuK for speech and voice cloning, SheetSage2
for transcription. The website then talks to it over RunPod's HTTPS proxy.

This is not the same shape as `runpod/README.md`, which puts Auteur's video
model on a **Serverless endpoint**. A serverless endpoint scales to zero and
bills only while a job runs. A Pod does not. Read the next section before you
create anything.

---

## Read this first: a Pod bills every second it is RUNNING

Not per song. Not per second of audio. Per second the machine exists, from the
moment you press Start until the moment you press Stop, whether it is
generating a four-minute track or sitting at an idle prompt while you think
about lyrics.

This is the right trade for these models anyway - YuE2 is a 24 GB load that
takes minutes to come up, and re-paying that on every request is worse than
paying for a few idle minutes - but it means **the discipline is yours**. There
is no `workers.min = 0` to save you here.

### Which GPU

YuE2 needs about **24 GB** and AuK peaks around **24.8 GiB** - but they are never
on the card at the same time. The server keeps YuE2 resident between songs and
frees it before a speech job, so what a card has to hold is the **larger of the
two, about 25 GiB**, not the sum. See *Which interpreter runs the server* below
for why that is a property of the design rather than a setting.

That is what makes the column below "enough on its own", not "holds both": on a
48 GB card `--keep-loaded both` is not merely unnecessary, it is wrong, and
`bootstrap.sh` refuses it under 60000 MiB.

| GPU | Reported VRAM | Approx $/hr | Enough? | Notes |
| --- | --- | --- | --- | --- |
| RTX 4090 | 24 GB | ~$0.35 - 0.70 | **No** | YuE2 fits. AuK's ~24.8 GiB peak does not, so it needs `--cpu-offload`: about a third less VRAM, and slower. |
| RTX A5000 | 24 GB | ~$0.25 - 0.40 | **No** | Same 24 GB story, slower card. |
| RTX PRO 4500 Blackwell | 32 GB | ~$0.72 | Yes | Enough, and pointlessly so: it costs more per hour than the 48 GB A40. |
| **A40** | 45 GiB (46068 MiB) | **~$0.49** | **Yes** | **The default.** `setup.mjs` picks it as the cheapest card clearing 48 GB. Sold as "48 GB" while reporting 46068 MiB - see below, because that gap matters for a different reason. |
| RTX A6000 | 48 GiB (49140 MiB) | ~$0.53 | Yes | Four cents more and genuinely 49140 MiB. Worth it only if you want the headroom. |
| L40 / L40S | 45 GiB (46068 MiB) | ~$0.82 - 1.09 | Yes | Same 46068 MiB as the A40, faster at generating. |
| RTX 6000 Ada | 48 GiB | ~$0.84 | Yes | Same memory as the A6000, newer and faster. |
| A100 | 80 GB | ~$1.59 | Yes | The first tier where `--keep-loaded both` is actually safe. |
| H100 | 80 GB | ~$2.40 - 3.00 | Yes | Same, faster. |

`setup.mjs` ranks candidates by price and takes the cheapest at 48 GB or more,
which lands on the **A40 at about $0.49/hr**. Note that 48 GB is not a stretch
target here - it is where the cheap cards are. Every 32 GB card in the catalog
costs *more* per hour than the A40, so there is nothing to save by going lower.

**The "48 GB" gap is still worth knowing about.** An A40, L40 and L40S report
46068 MiB; an A6000 and RTX 6000 Ada report 49140 MiB. It does not bite in this
layout, because nothing needs 49 GiB. It would bite immediately if you set
`--keep-loaded both` by hand on an A40, which is why `bootstrap.sh` decides that
from `nvidia-smi` rather than from the sticker.

Those prices are list prices from RunPod's GPU page and they move - Community
Cloud is cheaper than Secure Cloud, data centers differ, and availability
differs by the hour. **The console is the only authority on what you will be
charged.** Nothing in this repo has been benchmarked on any of these cards, so
there are no measured generation times here to quote; when you have some, this
is the file to put them in.

The practical arithmetic: on the default A40 at about $0.49/hour, an evening of
songwriting is under a dollar. A pod you forgot to stop is about **$12 a day**,
$350 a month. That is the whole risk, and it is entirely avoidable.

### The network volume bills while the pod is stopped

RunPod charges roughly **$0.07/GB/month** for a network volume, continuously,
whether or not any pod is attached to it. The 120 GB volume `setup.mjs` creates
by default is therefore about **$8/month, forever, even when nothing is
running**.

Keep it anyway. Without it every start re-downloads about 30 GB of weights and
rebuilds three Python environments - roughly an hour of a GPU you are paying
for, plus an hour of your time, every single session. The volume pays for
itself the second time you use it.

### Stopping

Stopping is what makes a Pod cheap, and it is a thing you have to remember to
do:

```bash
node tools/music-creator/runpod/setup.mjs --stop       # stop: GPU billing ends, volume kept
node tools/music-creator/runpod/setup.mjs --start      # resume the same pod later
node tools/music-creator/runpod/setup.mjs --teardown   # terminate the pod (volume kept)
```

or the Stop button on the pod in <https://console.runpod.io/pods>.

| State | GPU billing | Volume billing | What survives |
| --- | --- | --- | --- |
| Running | yes | yes | everything |
| Stopped | no | yes | the volume: venvs, weights, data, start script |
| Terminated | no | yes | the volume only - the container disk is gone |
| Volume deleted | no | no | nothing; the next setup starts from zero |

A stopped pod keeps its id, so the proxy URL in `.env.local` stays correct
across stops. A terminated pod does not: a new pod is a new id and a new URL.

The container disk is wiped on stop. That is why `bootstrap.sh` puts every
expensive thing on the volume - virtualenvs, the Hugging Face cache, the
checkpoints, the server code and `--data-dir` - so that a restart costs a few
minutes of apt packages instead of an hour of downloads.

---

## The 100-second proxy limit, and why it does not bite

Every exposed HTTP port on a pod gets a URL of the form:

```
https://<pod id>-8770.proxy.runpod.net
```

That proxy sits behind Cloudflare, which gives up on a request that has not
started responding within **100 seconds** and returns **524**. A model that
takes four minutes to write a song cannot be served by a request that has to
answer in one hundred.

The server was built this way from the start, so nothing here is at risk:

| Call | Shape | Time |
| --- | --- | --- |
| `POST /jobs/song` | queues and returns `{"job_id": ...}` | milliseconds |
| `POST /jobs/speak`, `/jobs/transcribe`, `/jobs/separate` | same | milliseconds |
| `GET /jobs/{id}` | one poll: status, stage, progress, result | milliseconds |
| `GET /health` | never blocks on a model | milliseconds |
| `GET /files/{id}` | streams a finished file | starts immediately |
| `POST /mix` | ffmpeg, synchronous, no GPU | seconds |

The generation itself happens in the server's worker thread between polls, so
the long wait is spread over many short requests and Cloudflare never sees a
slow one.

**The warning is for the future.** If anyone adds a synchronous endpoint - a
`POST /song` that returns the audio - it will work perfectly against
`localhost` on the pod and fail with a 524 through the proxy, for every
generation longer than 100 seconds. Submit-then-poll is not a style choice
here; it is what makes the proxy usable at all.

The website reaches the pod through `src/app/api/music-creator/[...path]/route.ts`,
a server-side proxy with an explicit allow-list of paths. It gives up at **95
seconds**, deliberately just inside Cloudflare's 100: waiting longer could only
ever surface Cloudflare's 524 page instead of a message naming the pod, and
nothing on the list above comes close to either number.

---

## Setting it up

### 1. Get a RunPod API key

Create one at <https://console.runpod.io/user/settings> and put it in
`.env.local` at the repo root:

```
RUNPOD_API_KEY=rpa_your_key_here
```

That file is gitignored.

### 2. Create a network volume

`setup.mjs --yes` creates one for you (120 GB by default, `MUSIC_VOLUME_GB` to
change it), or make it yourself in the console under **Storage -> Network
Volume**. A full install is about 30 GB of weights and three Python
environments, and produced audio accumulates beside it.

**Write down the data center.** A network volume lives in one data center and
can only be attached to a pod in that same data center. Picking a GPU that is
only available elsewhere is the single most common way to get stuck here, and
the error message you get is about availability, not about the volume.

### 3. Create the pod

Look before you leap:

```bash
node tools/music-creator/runpod/setup.mjs --dry-run
```

That prints exactly what it would create and creates nothing. Then, for real:

```bash
node tools/music-creator/runpod/setup.mjs --yes      # create the volume and the pod
node tools/music-creator/runpod/setup.mjs --status   # wait until it says RUNNING
```

That creates the pod (GPU, CUDA image, the volume at `/workspace`, port
**8770** exposed through the proxy, SSH) and generates the server token. The
source of truth for its flags is the header of `setup.mjs` itself.

It finishes by printing two lines for `.env.local`:

```
MUSIC_SERVER_URL=https://<pod id>-8770.proxy.runpod.net
MUSIC_TOKEN=<generated>
```

**Paste them in before the next step.** `--deploy` reads `MUSIC_TOKEN` from
there and hands it to `bootstrap.sh`, which stores it on the pod as
`/workspace/music-token`. Skipping this means the pod and the website end up
with different tokens, and every call but `/health` comes back 401.

### 4. Deploy: copy the server up and provision it

```bash
node tools/music-creator/runpod/setup.mjs --deploy
```

This copies `tools/music-creator/` to `/workspace/music-creator-src` over SSH
and runs `bash /workspace/music-creator-src/runpod/bootstrap.sh` there with
`VOLUME`, `MUSIC_PORT` and `MUSIC_TOKEN` already set. This is the hour.

You can also SSH in and run `bootstrap.sh` yourself - that is how you pass the
skip flags below. It finds the server relative to its own location, so it works
from wherever the folder was copied.

What it does, in order, skipping anything already done:

1. Checks the volume is mounted and writable, reads the card's VRAM, and picks
   `--keep-loaded one`, or `both` only above 60000 MiB (see *Which interpreter
   runs the server*) - adding `--cpu-offload` when the card is under about
   26000 MiB, because AuK will not otherwise fit.
2. Generates a server token, or reuses the one in `/workspace/music-token`.
3. Installs git, curl, tar, a compiler and ffmpeg if the image lacks them.
4. Makes sure FFmpeg 6.x with shared libraries is available for SheetSage2,
   unpacking a 6.1 build onto the volume when the image's ffmpeg is older.
5. Installs Python 3.12, 3.10 and 3.11 - from the image's own apt sources if it
   has them, otherwise from `ppa:deadsnakes/ppa`.
6. Copies the server onto the volume and builds a small venv holding the
   `huggingface_hub` download CLI (and, with `--skip-yue2`, the server itself).
7. Clones YuE2, `pip install .` into a 3.12 venv, adds the server's own
   `aiohttp` to that same venv - the server runs from it - and downloads
   `m-a-p/YuE2-3B` and `m-a-p/YuE2-Vae`.
8. Clones AuK, `pip install -e ".[gradio]"` into a 3.10 venv, downloads
   `tencent/AuK` into `ckpts/AuK` and `Qwen/Qwen2.5-Omni-3B` into the cache.
   `--auk-flash` also fetches the optional 4-step `tencent/AuK-Flash`.
9. Downloads `m-a-p/SheetSage2`, then in a 3.11 venv installs its own
   `requirements.txt`, pins `torch==2.8.0` / `torchaudio==2.8.0` (cu126) and
   `huggingface-hub==0.36.0`. MERT-v2-FullSong is **not** fetched here:
   SheetSage2 loads it itself on first use.
10. Writes `/workspace/start-music-server.sh` with the exact interpreter and
    arguments for what it just installed - including omitting `--yue2-python`
    when YuE2 can run in-process.
11. Runs the server's own `--self-test` with those same arguments and prints
    the report.

Do not want all of it? On the pod:

```bash
cd /workspace/music-creator-src/runpod
bash bootstrap.sh --skip-auk         # songs and transcription only
bash bootstrap.sh --skip-sheetsage   # no transcription, so no cover workflow
bash bootstrap.sh --skip-yue2        # speech only - no song generation at all
bash bootstrap.sh --auk-flash        # also the optional 4-step AuK checkpoint
bash bootstrap.sh --weights-only     # downloads now, environments later
bash bootstrap.sh --no-weights       # environments now, downloads later
bash bootstrap.sh --help
```

The skips are real savings: AuK plus Qwen2.5-Omni is more than half the
download, and if you only want songs you never need either. A skipped engine is
not a broken one - `/health` reports it as unavailable with a reason, and its
endpoints answer 503 saying the same thing.

### 5. Start the server

```bash
bash /workspace/start-music-server.sh          # start, detached
bash /workspace/start-music-server.sh status
bash /workspace/start-music-server.sh stop
tail -f /workspace/server.log
```

It uses `setsid` and `nohup`, so closing the SSH session does not kill it, and
everything it prints goes to `/workspace/server.log`.

Check it from your own machine:

```bash
curl https://<pod id>-8770.proxy.runpod.net/health
```

`/health` needs no token on purpose - it is how the website tells "server
offline" apart from "server up, model missing". Everything else requires the
token.

### 6. Point the website at it

`.env.local` at the repo root already has both lines if you pasted them in step
3. Confirm they match what is on the pod:

```
MUSIC_SERVER_URL=https://<pod id>-8770.proxy.runpod.net
MUSIC_TOKEN=<the contents of /workspace/music-token on the pod>
```

Both are read server-side by the proxy route; the browser never sees either.
The proxy URL changes only when the pod is terminated and recreated - a stop
and start keeps the same id.

`node tools/music-creator/runpod/setup.mjs --status` checks the pod's state and
the live `/health` in one call, which is the quickest way to tell "pod off"
from "server not started" from "model missing".

---

## What the first run costs you in time

Roughly **an hour** on a fast pod: **about 30 GB of weights plus three Python
environments**, each with its own CUDA build of torch, because the three models
cannot share one.

| Piece | Where it lands | Approx |
| --- | --- | --- |
| YuE2 (`m-a-p/YuE2-3B`) | `/workspace/hf` | 7 GB |
| YuE2 VAE (`m-a-p/YuE2-Vae`) | `/workspace/hf` | 0.5 GB |
| AuK (`tencent/AuK`) | `/workspace/AuK/ckpts/AuK` | 7 GB |
| Qwen2.5-Omni-3B (AuK loads it as part of its stack) | `/workspace/hf` | 12 GB |
| SheetSage2, and MERT-v2-FullSong on its first job | `/workspace/models/SheetSage2`, `/workspace/hf` | 3 GB |
| three venvs, each with its own torch | `/workspace/YuE/.venv`, `/workspace/AuK/.venv`, `/workspace/venvs/sheetsage` | the remainder |

Those are published repository sizes, not measurements from a run on this
setup, and they are rounded. After your own run, `du -sh /workspace/*` tells
you the truth - and it is the number worth trusting.

**The downloads happen once.** Everything above is on the volume. A later
session is:

```bash
node tools/music-creator/runpod/setup.mjs --start                  # resume the pod
ssh ... 'bash /workspace/music-creator-src/runpod/bootstrap.sh'    # a few minutes
ssh ... 'bash /workspace/start-music-server.sh'                    # start the server
node tools/music-creator/runpod/setup.mjs --status                 # confirm, then work
node tools/music-creator/runpod/setup.mjs --stop                   # stop when finished
```

**Run `bootstrap.sh` again after every restart.** The volume keeps the
virtualenvs, the weights and the caches - the expensive parts - but apt
packages live on the **container disk**, which is wiped when a pod stops. That
includes the three Pythons the virtualenvs were built from, so without the
re-run `start-music-server.sh` fails with an interpreter that is not there (it
says exactly that, rather than something cryptic). The re-run reinstalls apt
packages, downloads no weights, and takes a few minutes.

### Where everything lives

| Path | What |
| --- | --- |
| `/workspace/hf` | `HF_HOME` - the Hugging Face cache |
| `/workspace/music-creator-src` | what `setup.mjs --deploy` uploads; `bootstrap.sh` lives here |
| `/workspace/music-creator` | the server code the start script runs, copied off the container disk |
| `/workspace/venvs/server` | the `hf` download CLI, and the fallback server interpreter when `--skip-yue2` is used |
| `/workspace/YuE`, `/workspace/YuE/.venv` | YuE2 code, Python 3.12 |
| `/workspace/AuK`, `/workspace/AuK/.venv` | AuK code and checkpoints, Python 3.10 |
| `/workspace/venvs/sheetsage` | SheetSage2 deps, Python 3.11 |
| `/workspace/models/SheetSage2` | SheetSage2 weights |
| `/workspace/ffmpeg-6.1` | only when the image's ffmpeg is older than 6 |
| `/workspace/data` | `--data-dir`: produced audio, scores, voice clips |
| `/workspace/music-token` | the bearer token (mode 600) |
| `/workspace/start-music-server.sh`, `/workspace/server.log` | start script and log |
| `/workspace/pip-cache`, `/workspace/tmp` | pip cache and `TMPDIR`, kept off the small container disk |

### Why three Pythons

YuE2 wants Python 3.12. AuK wants 3.10. SheetSage2 wants 3.10/3.11 and pins
transformers versions that fight with YuE2's. One virtualenv cannot be all
three, and pip will spend an hour proving it to you.

### Which interpreter runs the server

**The YuE2 venv.** `bootstrap.sh` installs the server's own requirement
(`aiohttp`) into `/workspace/YuE/.venv` and starts `server.py` with that
interpreter, and it deliberately does **not** pass `--yue2-python`. The reason
is three lines of `engines.py`:

```python
def yue2_mode(self):
    if _interpreter(self.args.yue2_python):
        return "subprocess"
    return "inprocess" if module_available("yue2") else None
```

Passing the flag forces subprocess mode *even when `yue2` imports perfectly
well in the server's own interpreter*, and subprocess mode reloads a 7.3 GB
model for **every single song**. Songs are what this server is for, so YuE2
gets the in-process path: loaded once into `Engines._yue2`, reused by every
later song job.

AuK and SheetSage2 keep their own interpreters, because they genuinely cannot
share one with YuE2. That is safe: `speak()`, `separate()` and `transcribe()`
all call `free_gpu(keep=None)` before spawning the worker, so a resident YuE2
is unloaded first rather than sitting on the card next to a second 24 GB
process. Those jobs pay a model load each time, which is the honest price of
three incompatible environments on one box.

**This is also why `--keep-loaded` is `one` on a 48 GiB card.** In this layout
only YuE2 is ever resident - a subprocess engine never populates
`Engines._auk`. So `both` would add no residency at all, and `free_gpu()`
returns immediately when it is set, meaning a resident YuE2 (~24 GB) would
still be on the card while an AuK subprocess loads ~24.8 GiB. That is ~49 GiB,
which an A6000's 49140 MiB does not have once anything else is allocated.
`one` keeps YuE2 resident across consecutive song jobs - `free_gpu(keep="yue2")`
unloads only the *other* engines - and frees it before a speech job. So `one`
is the faster setting here as well as the safer one. `bootstrap.sh` only
chooses `both` above 60000 MiB, where a resident YuE2 and an AuK subprocess
genuinely fit together.

With `--skip-yue2` there is no YuE2 venv to run from, so the server falls back
to its own small venv at `/workspace/venvs/server` and nothing is ever
resident.

---

## Licences

| Component | Code | Weights |
| --- | --- | --- |
| YuE2 | Apache 2.0 | **CC BY-NC 4.0 - non-commercial only** |
| AuK / AuK-Flash | MIT | MIT |
| SheetSage2, MERT-v2-FullSong | see their model cards | see their model cards |

The YuE2 weights are the binding constraint, and renting the GPU does not
change it: **you may not use songs this server generates commercially.** That
covers a paid product, ad-supported distribution and selling the output.
Personal, portfolio and research use with attribution is fine. AuK being MIT
does not help - a mix containing YuE2 audio is a derivative of YuE2 output.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| **524** from `...proxy.runpod.net` | a request took more than 100 seconds to start responding | Nothing in the current contract should. Check you are polling `GET /jobs/{id}` rather than waiting on the POST, and that nobody added a synchronous generate endpoint. |
| 502, or "connection refused" | the server is not running, or is on another port | `bash /workspace/start-music-server.sh status`, then `tail -50 /workspace/server.log`. |
| The proxy URL 404s or never resolves | port 8770 is not exposed on the pod | An exposed HTTP port cannot be added to a running pod: edit the pod's template and restart it, or recreate it with `setup.mjs`. |
| **CUDA out of memory** | YuE2 (~24 GB) and AuK (~24.8 GiB) collided | `--keep-loaded one` on anything under ~49 GiB (bootstrap picks this), `--cpu-offload` for AuK on a 24 GB card, and check nothing else is on the GPU with `nvidia-smi`. A 24 GB card cannot hold both at once with any setting. |
| `/health` says `available: false` | the engine is genuinely not installed here | Read its `reason`: it names the missing package, interpreter or checkpoint. Then run the self-test on the pod for the full report. |
| A job fails with "not importable" | the venv exists but the package does not | Re-run `bootstrap.sh` - it detects a half-built venv and finishes the install. |
| `start-music-server.sh` says the interpreter does not run | the pod restarted and the container disk was wiped | Re-run `bootstrap.sh`. The venvs on the volume are fine; the Pythons they were built from are not. |
| Weights show `not-downloaded` | the model id is not in `HF_HOME` | Re-run `bootstrap.sh` (or `--weights-only`). If `HF_HOME` is unset the cache goes to the container disk and vanishes on restart; the start script exports it. |
| The pod will not start: no GPU available | the volume's data center has none of that GPU free | Pick another GPU **in the same data center**, or wait. A volume cannot move between data centers; a new data center means a new volume and a fresh 30 GB download. |
| `setup.mjs` cannot attach the volume | volume and pod are in different data centers | Same as above - they must match. |
| **401** from every endpoint but `/health` | token mismatch | `cat /workspace/music-token` on the pod, and make `MUSIC_TOKEN` in `.env.local` match exactly. |
| Transcription fails, ffmpeg errors | FFmpeg 6.1 and its shared libraries are missing | The self-test's SheetSage2 lines say so. If the 6.1 download failed, re-run with `FFMPEG_URL=<current linux64 gpl-shared 6.1 asset>` from <https://github.com/BtbN/FFmpeg-Builds/releases>. |
| `/jobs/separate` returns **501** | the installed AuK build exposes no separation method | Not a bug and not fixable here - see the main README. The server refuses to invent a calling convention. |
| The bill is larger than expected | the pod was left running | Nothing else in this setup can do that. `setup.mjs --stop`, and check <https://console.runpod.io/pods> when you finish. |

The single best diagnostic is the server's own report, which loads nothing onto
the card:

```bash
/workspace/YuE/.venv/bin/python /workspace/music-creator/server/server.py --self-test \
  --data-dir /workspace/data \
  --auk-python /workspace/AuK/.venv/bin/python \
  --auk-ckpt /workspace/AuK/ckpts/AuK/auk_base.safetensors \
  --auk-config /workspace/AuK/ckpts/AuK/config.yaml \
  --sheetsage-python /workspace/venvs/sheetsage/bin/python \
  --sheetsage-dir /workspace/models/SheetSage2
```

`bootstrap.sh` runs exactly that at the end of every run, with the arguments
that match what it installed.
