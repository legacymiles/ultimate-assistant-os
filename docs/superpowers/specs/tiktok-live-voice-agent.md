# TikTok Live voice agent — design

A reactive, realistic-sounding character that talks to people on a TikTok LIVE
stream: it reads the comments, answers out loud in a real voice, and a
photoreal face on screen moves its mouth to the words.

Status: **design approved 2026-11-23, not yet built.**
**Revised 2026-11-23 after measuring LiveTalking on this laptop — the face is no
longer hand-built from mouth plates. See §1.1 for the numbers that changed it.**

---

## 1. Why this design looks the way it does

Three facts about this machine decided almost everything. All three are
measured, not estimated.

| Fact | Source | Consequence |
|---|---|---|
| The GPU is an **RTX 3050 Laptop, 6 GB** | `nvidia-smi` | Enough, as it turns out — see §1.1. The earlier conclusion here ("no realtime photoreal lip-sync model fits") was reasoning from MuseTalk's README and was **wrong** |
| **Phonon runs at ~5.5x realtime on CPU and never touches the GPU** | `tools/phonon-tts/README.md`, measured on this Ryzen 5 7235HS | The voice costs 0 VRAM. The whole 6 GB stays free |
| **Comments arrive as text**, not audio | TikTokLive reads the Webcast websocket | Phase 1 needs no speech recognition at all |

The third one is the important one. Every open-source "realtime voice agent"
is built around the expensive half — listening to a microphone, detecting
end-of-turn, transcribing. On TikTok LIVE, viewers *type*. Spoken audio only
exists if someone joins as a guest, or if it is the owner talking. So the
hard half is optional, and it is deferred to phases 2 and 3.

## 1.1 What was measured, 2026-11-23

An earlier draft of this spec built the face by hand: WanGP-rendered mouth
plates composited on a canvas, driven by `visemes.ts`. That existed only
because a realtime lip-sync *model* was assumed not to fit in 6 GB. It was
tested instead of assumed, and the assumption did not survive.

[LiveTalking](https://github.com/lipku/LiveTalking) (Apache-2.0, 10.9k stars),
`wav2lip256`, on this laptop, read from its own logs:

| | Measured | Needed |
|---|---|---|
| `actual avg infer fps` (GPU) | **40.2, then 49.0** | ≥ 25 |
| `actual avg final fps` (streamed) | 15.4 cold, then **24.97 / 24.97 / 25.05 / 24.96 / 25.12 / 24.86 / 25.09** | ≥ 25 |
| VRAM, `batch_size 16`, `modelres 256` | **2807 MiB of 6144** | < 6144 |

`final fps` sits at 25.0 because 25 **is the target** — `--fps 25`, and the
config says "must be 25". Inference running at 40-49 while the stream paces at
25 means the GPU is at roughly half capacity, not straining.

Three predictions in the earlier draft were wrong, all in the same direction:
`batch_size 16` was expected to exhaust 6 GB (it used under half), 4 CPU cores
were expected to starve the stream (it held 25.0 across seven readings), and
inference was guessed at 25-35 fps (it hit 40-49).

**Limits of that test.** One session, no OBS encoding running alongside, and
the browser was rendering the video. Production adds OBS's encode on the same
4 cores. `infer fps` is an average over only two 100-frame windows, against
seven for `final fps`. The margin is wide, but it is not a production-load
measurement.

### Rejected, and why

- **Kokoro-82M** — slower than Phonon on this CPU (RTF 0.57–0.83 on 4 cores,
  i.e. 1.2–1.8x realtime, degrading to 0.99 on long input) and would occupy
  ~2.5 GB of VRAM for no gain. Phonon is already the configured backend.
- **Haru-4B** — architecturally ideal (true full-duplex, Apache 2.0, natural
  interruptions, no STT→LLM→TTS chain, and it exposes both a Python and an
  HTTP API). Needs ~12 GB VRAM; the checkpoint is a single 10.5 GB bf16 file,
  GPTQ W4A16 measured 9.56 GiB peak, and 4-bit is documented to break the
  model. Not viable locally. Revisit only on rented GPU.
- **A local LLM** — a 3B that fits beside everything else would be both slow
  and worse at personality than a hosted call, which is the one thing that
  must not be mediocre.
- **A cloud avatar API** (Simli / HeyGen / Tavus) — would guarantee a
  photoreal synced face, but costs per streamed minute and puts the face
  behind an internet round-trip. Out of scope; the stack stays free.

---

## 2. What already exists and is reused

This is most of the build. Nothing below needs writing.

| Piece | Where | State |
|---|---|---|
| **Voice** | `tools/phonon-tts/` — `POST /v1/tts`, port 8123 | Working. `phonon-31m-en` q8_0, 65 MB GGUF, 102 voices, 24 kHz mono, CPU-only. `TTS_BACKEND=phonon` is already the active setting, with `FISH_API_KEY` as fallback |
| **Face + lip sync** | `C:\dev\livetalking` (outside this repo) | Installed and measured 2026-11-23 — see §1.1. Python 3.12.10 venv via `uv`, torch 2.9.1+cu128, `models/wav2lip.pth`, `data/avatars/wav2lip256_avatar1/`. Not vendored into this repo: it is a 3rd-party project with its own 5.1 GB venv |
| **Character stills** | `tools/wangp-image/` | Working. Flux 2 Klein 4B locally. ~128 s cold, **~18 s warm** per image. Still used — but to make the *source clip* for the avatar, not mouth plates |
| **Streaming-server pattern** | `tools/realtime-lucy/` | Reference only. An aiohttp + aiortc WebRTC server with a `low_mem` path engineered for this exact 6 GB card, plus `server/bench.py`, which measures fps and VRAM and emits a proof video. Its benchmark harness is the model for proving any future GPU face model fits. **Note: vendored lingbot-world-v2 is CC BY-NC-SA 4.0 — non-commercial. Do not reuse its model code in a monetized stream.** |

### What `visemes.ts` is no longer doing

Two earlier drafts drove the mouth themselves: first from **phoneme timings**
(an unverified assumption — Phonon's `/v1/tts` returns audio bytes and exposes
no alignment), then from `visemeFromSpectrum()` reading an `AnalyserNode`.

LiveTalking does its own lip sync from the audio it is given, so **neither is
needed**. `src/lib/new-jarvis/avatar/visemes.ts` stays exactly where it is,
still driving `AvatarScene.tsx`; this project simply no longer touches it.
`src/lib/tiktok-agent/plates.ts` is not built at all.

That is the whole shape of the revision: the half of the system that turns
sound into a moving face is now someone else's working code, and what remains
to build is the half that LiveTalking has none of — TikTok.

---

## 3. Architecture

```
TikTok comments ─┐                                        LiveTalking :8010
owner mic ───────┼→ [ director ] → [ brain ] → [ voice ] ──→ /humanaudio
guest audio ─────┘      ^^^^ all three in the stage page ^^^      │
                                                            wav2lip256
                                                                  │
                        stage page renders its WebRTC stream ──→ OBS
```

The stage page both **drives** LiveTalking (posting Phonon's wav to
`/humanaudio`) and **displays** it (rendering the WebRTC stream back). One OBS
browser source therefore still carries audio and picture together.

Five modules. Each has one job, a stated interface, and is testable alone.

### 3.1 `ingest`

Every source normalizes to one event shape, so nothing downstream knows or
cares where a line came from:

```python
Event = {
  "kind": "comment" | "gift" | "follow" | "share" | "speech",
  "user": str,          # display name
  "text": str,          # comment body, or transcript
  "priority": int,       # assigned by ingest, see 3.2
  "ts": float,
}
```

- **`ingest.tiktok`** (phase 1) — [TikTokLive](https://github.com/isaackogan/TikTokLive),
  Python 3.10+, asyncio. Needs only the creator handle, no credentials. Use
  `await client.start()` (joins our loop), **not** `client.run()` (blocks).
  Unofficial — it reads the same Webcast websocket any viewer gets, so it can
  break when TikTok changes things. Signing goes through Euler Stream by
  default.
- **`ingest.mic`** (phase 2) — local mic → VAD → `faster-whisper` small int8
  (~1 GB VRAM) → `speech` event.
- **`ingest.guest`** (phase 3) — desktop audio capture. See the echo gate in
  3.2; this is the only genuinely hard input.

### 3.2 `director`

**This module is the product.** A perfect voice on a dumb queue is a
text-to-speech reader; everything that makes a stream feel like a person
lives here. It is also the only module with enough real logic to deserve
thorough unit tests.

| Behaviour | Rule |
|---|---|
| **Priority** | gifts > new followers > @mentions of the character > questions (ends in `?`) > general chatter |
| **Barge-in** | A higher-priority event arriving mid-utterance decides interrupt vs finish. Interrupting for a gift is correct; interrupting for general chatter is not |
| **Idle filler** | No event for **20 s** → say something unprompted from a rotating pool of openers, never repeating within the session. This is the single largest difference between "bot" and "streamer" |
| **Dedupe** | Never answer a near-identical question twice within **5 minutes**. Live chat repeats the same five questions endlessly |
| **Rate limit** | Max **8 utterances per minute**. Without this it talks over itself and sounds frantic |
| **Echo gate** (phase 3) | STT is deaf while TTS is playing. Without it the agent hears its own voice and answers itself — an unbounded loop |

### 3.3 `brain`

Hosted LLM through the existing `AI_GATEWAY_API_KEY` / `OPENROUTER_API_KEY`.
Character card as the system prompt, a rolling window of recent exchanges,
plus **per-viewer memory** — who this person is and what they said last time.
Per-viewer memory is cheap and does a disproportionate amount of the realism
work: being remembered by name is why viewers stay.

Returns reply text plus an emotion tag, which selects the face's plate set.

### 3.4 `voice`

`POST http://127.0.0.1:8123/v1/tts` with `{text, voice, format}`. Voice
defaults to `PHONON_VOICE` (currently `Easton`); 102 are available via
`GET /v1/voices`.

Phonon returns complete audio bytes, not a stream. At 5.5x realtime a 5-second
sentence costs ~0.9 s. **Therefore: synthesize per sentence, and start playing
the first sentence while the rest are still being generated.** Do not wait for
the full reply.

Fallback order: Phonon → fish.audio (`FISH_API_KEY`) → a canned line. Never
silence.

### 3.5 `stage` — audio and face in one page

A Next route at **`src/app/stage/tiktok-agent/page.tsx`**. Deliberately *not*
under `src/app/apps/`: it is an OBS surface, not a catalog app, so it needs no
`catalog.ts` entry and no `docs/apps/<slug>.md` record, and `check:records`
stays green. (If it ever gains a human-facing control UI, that becomes a
proper catalog app with a record, in a later phase.)

Being a route in this repo, it imports `visemes.ts` directly — no copy, no
drift.

What it does:

1. On load, does the WebRTC handshake against `POST 127.0.0.1:8010/offer`
   (`{sdp, type}`, as `web/client.js` does) and renders the returned stream
2. Receives events over a websocket from the relay, and runs the director
3. Calls `/api/tts` for each sentence, getting a wav back
4. `POST`s that wav to `127.0.0.1:8010/humanaudio` as multipart
   (`sessionid` + `file`). LiveTalking does the lip sync

Cross-origin works: LiveTalking configures `aiohttp_cors` on every route.

**One browser source in OBS still carries audio and picture**, so no virtual
audio cable is needed — which matters, because none is installed. This is why
the `webrtc` transport is used rather than `virtualcam`: virtualcam emits
**video only** and routes audio to a separate system device
(`--audio_output_device`), which would drag the virtual-cable dependency back.
It also needs `pyvirtualcam`, which is absent from `requirements.txt`.

### 3.6 The avatar

LiveTalking reads an avatar from
`data/avatars/<avatar_id>/{full_imgs/, face_imgs/, coords.pkl}`.

- **For now:** `wav2lip256_avatar1`, the author's sample (550 frames), already
  installed and measured.
- **For the real character:** render a clip in WanGP, then
  `python avatars/wav2lip/genavatar.py --video_path <clip> --avatar_id <name> --img_size 256`.
  **`--img_size` defaults to 96** — leaving it would quietly produce a blurry
  mouth against a 256-px model. The face detector downloads its own s3fd
  weights via `torch.utils.model_zoo`, so there is no manual step.

Avatars are regenerable output and live outside this repo.

---

## 4. Budgets

| VRAM (6144 MiB) | | Latency, comment → first audio | |
|---|---|---|---|
| **LiveTalking** (measured) | **2807 MiB** | TikTokLive event | 200–500 ms |
| Phonon | **0** (CPU-only) | LLM first sentence | 300–700 ms |
| Whisper small int8 (ph. 2) | ~1000 MiB | Phonon, 1 sentence | ~900 ms |
| OBS NVENC | ~500 MiB | `/humanaudio` → first frame | **not measured** |
| **Free** | **~1800 MiB** | **Total** | **≥1.4 s, upper bound unknown** |

Only the first three latency rows are grounded. The hand-off to LiveTalking
was never timed end-to-end, because the fps test drove it directly rather than
through the director. **Measure comment → first spoken word before trusting
any total**, and record it in the tool README.

The VRAM column is now the tight one: ~1800 MiB spare, and phase 2's Whisper
eats more than half of that. If phase 2 runs short, Whisper moves to CPU
(slower) or `batch_size` drops below 16 — LiveTalking has ~2x fps headroom to
spend, so trading some for VRAM is the cheaper move.

---

## 5. Error handling

**The rule is: never a silent stream.** Dead air on a live broadcast is the
only unrecoverable failure, and it is what viewers leave over.

| Failure | Behaviour |
|---|---|
| Brain unreachable / slow | Director plays a canned line from a pool |
| Phonon server down | Fall back to fish.audio, then to a canned line |
| TikTokLive disconnects | Exponential-backoff reconnect; face drops to idle; stream stays up |
| Stage page crashes | Audio keeps playing; OBS scene has a static fallback image |
| Any module throws | Logged, swallowed, stream continues. Nothing may take OBS down |

---

## 6. Testing

Nothing here requires being live, which matters because a live stream is the
worst possible debugging environment.

| Module | How |
|---|---|
| `ingest` | Replay a recorded comment fixture. No stream needed |
| `director` | **Real unit tests** — priority ordering, barge-in decisions, dedupe window, rate limit, idle-filler trigger |
| `brain` | Feed a comment transcript; assert no repeats and that per-viewer memory is used |
| `voice` | Text in, assert audio bytes out and the fallback chain fires in order |
| `stage` | Feed recorded audio, assert the viseme stream is bounded and smooth; screenshot the canvas |
| End-to-end | Replay a captured stream's comments at real speed with OBS recording to file, then watch it back |

---

## 7. Phases

1. **Comments → voice → face.** Ships something watchable. No STT, no echo
   problem, no turn-taking.
2. **+ owner mic.** `faster-whisper`, clean separate audio device, so no echo
   gate needed. The owner co-hosts with the character.
3. **+ guest audio.** Desktop capture plus the echo gate. The only phase with
   a genuinely hard new problem.

---

## 8. Open risks

| Risk | Note |
|---|---|
| **Not tested under production load** | The fps run had no OBS encoding alongside it, and the browser was rendering the video. Production adds OBS's encode to the same 4 cores. The margin is wide (inference at ~2x the bar) but this is the untested edge. Re-read `actual avg final fps` with OBS running before going live |
| **wav2lip's open weights are research / non-commercial** | Fine for building and testing; a licensing question the moment the stream earns money. `musetalk` is MIT but recommends a 3080Ti, so it is not a drop-in on this card |
| **LiveTalking requires a watermark on published video** | Its README: video built on it and posted to short-video platforms (it names Douyin) "需带上 LiveTalking 水印和标识" — must carry the LiveTalking watermark and logo. Apache-2.0 on the code, but this is a condition on the stream |
| **LiveTalking lives outside this repo** | `C:\dev\livetalking`, with its own 5.1 GB venv, pinned to nothing. A `git pull` there can change behaviour under us. Record the working commit in the tool README |
| **Fallback if it regresses** | The viseme-plate design is preserved in this file's git history (`19af1f0b` and earlier). `visemes.ts` is untouched and still works. Nothing was deleted to make room for LiveTalking |
| **TikTok needs ~1,000 followers** for desktop stream-key access | Not a code problem, but phase 1 cannot go live without it. It *can* still be built and judged against a recorded fixture with OBS recording to file |
| **TikTok requires disclosing AI-generated content** | Label the stream. An undisclosed synthetic human talking to viewers is what gets accounts removed |
| **TikTokLive is unofficial** | Can break on any TikTok change. Treat reconnect logic as a first-class feature, not an afterthought |
| **`realtime-lucy`'s vendored model is CC BY-NC-SA 4.0** | Non-commercial. Its *bench harness pattern* is safe to copy; its model code is not, if the stream is ever monetized |

---

## 9. Not building (YAGNI)

No local LLM. No multi-language. No fine-tuning. No voice cloning in v1
(Phonon's 102 voices are enough). No gift-specific animations. No web
dashboard — console plus OBS is sufficient until it isn't.

---

## 10. File layout

```
tools/tiktok-live-agent/
  README.md              what it is, how to start it, measured numbers
  requirements.txt
  start.mjs              npm run tiktok:agent
  ingest/tiktok.py       TikTokLive → Event
  ingest/mic.py          phase 2
  director/              queue, barge-in, idle, dedupe, rate limit
  director/tests/        the unit tests that matter
  voice.py               Phonon → fish.audio → canned
  brain.py               hosted LLM + per-viewer memory

src/app/stage/tiktok-agent/page.tsx    OBS browser source; drives and displays
                                       LiveTalking
```

Outside this repo, not vendored:

```
C:\dev\livetalking\      LiveTalking + its 5.1 GB venv
  models/wav2lip.pth     204.7 MB
  data/avatars/<id>/     full_imgs/ face_imgs/ coords.pkl
```

Started with:

```
.venv/Scripts/python.exe app.py --transport webrtc --model wav2lip \
  --avatar_id wav2lip256_avatar1 --modelres 256 --REF_FILE en-US-AriaNeural
```

`--modelres 256` is not optional: the default is **192**, which is wrong for a
256-px model.
