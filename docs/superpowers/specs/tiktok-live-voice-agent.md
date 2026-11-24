# TikTok Live voice agent — design

A reactive, realistic-sounding character that talks to people on a TikTok LIVE
stream: it reads the comments, answers out loud in a real voice, and a
photoreal face on screen moves its mouth to the words.

Status: **design approved 2026-11-23, not yet built.**

---

## 1. Why this design looks the way it does

Three facts about this machine decided almost everything. All three are
measured, not estimated.

| Fact | Source | Consequence |
|---|---|---|
| The GPU is an **RTX 3050 Laptop, 6 GB** | `nvidia-smi` | No realtime photoreal lip-sync model fits. MuseTalk's realtime mode recommends 8 GB; its own repo's minimum-tested card (3050 Ti 4 GB) takes **~5 minutes per 8 seconds** of video in fp16 |
| **Phonon runs at ~5.5x realtime on CPU and never touches the GPU** | `tools/phonon-tts/README.md`, measured on this Ryzen 5 7235HS | The voice costs 0 VRAM. The whole 6 GB stays free |
| **Comments arrive as text**, not audio | TikTokLive reads the Webcast websocket | Phase 1 needs no speech recognition at all |

The third one is the important one. Every open-source "realtime voice agent"
is built around the expensive half — listening to a microphone, detecting
end-of-turn, transcribing. On TikTok LIVE, viewers *type*. Spoken audio only
exists if someone joins as a guest, or if it is the owner talking. So the
hard half is optional, and it is deferred to phases 2 and 3.

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
| **Lip-sync driver** | `src/lib/new-jarvis/avatar/visemes.ts` (89 lines, pure) | Working, tested in `visemes.test.ts`. `visemeFromSpectrum()` turns one frame of `getByteFrequencyData` into `{open, wide, round}` — jaw from low-band energy, lip spread from high formants, rounding from a low-mid peak with no top end. `approach()` smooths frame-rate-independently |
| **Face renderer** | `tools/wangp-image/` | Working. Flux 2 Klein 4B on the local GPU via WanGP. Measured: ~128 s cold, **~18 s warm** per image. Long-lived server, binds 127.0.0.1 |
| **Streaming-server pattern** | `tools/realtime-lucy/` | Reference only. An aiohttp + aiortc WebRTC server with a `low_mem` path engineered for this exact 6 GB card, plus `server/bench.py`, which measures fps and VRAM and emits a proof video. Its benchmark harness is the model for proving any future GPU face model fits. **Note: vendored lingbot-world-v2 is CC BY-NC-SA 4.0 — non-commercial. Do not reuse its model code in a monetized stream.** |

### The lip-sync decision

An earlier draft of this design drove the mouth from **phoneme timings** out
of the TTS. That rested on an unverified assumption — that the TTS exposes
per-phoneme alignment. Phonon's API (`/v1/tts` → audio bytes) does not, and
nor does Kokoro necessarily.

`visemeFromSpectrum()` sidesteps the question entirely: it measures the mouth
from the audio that is actually playing, every frame. It therefore works with
**any** TTS, needs no alignment data, and costs nothing. It is also already
proven in `AvatarScene.tsx`.

The only difference here is what the viseme drives. `AvatarScene.tsx` maps it
onto a stylized Three.js shader form; this maps it onto photographs.

---

## 3. Architecture

```
TikTok comments ─┐
owner mic ───────┼─→ [ director ] → [ brain ] → [ voice ] ─→ stage page ─→ OBS
guest audio ─────┘                                            (audio + face)
```

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

1. Receives `{text, audio, emotion}` over a websocket from the director
2. Plays the audio through a WebAudio `AnalyserNode`
3. Per frame: `visemeFromSpectrum(getByteFrequencyData(...))` → `approach()` →
   `{open, wide, round}`
4. Composites the matching mouth plate onto the idle loop on a canvas

**One browser source in OBS carries both the audio and the face.** OBS captures
browser-source audio, so no virtual audio cable is needed — which is just as
well, since none is installed.

### 3.6 The face assets

Generated once, offline, through `tools/wangp-image`:

- the character, as a locked-off head-and-shoulders idle loop
- **~9 mouth plates** at the corners and midpoints of the `{open, wide, round}`
  space
- optional emotion variants of the plate set

At ~18 s warm per image, nine plates is about three minutes of GPU time.

**Plates are selected by snapping to nearest, not cross-faded.** Cross-fading
photographs ghosts; `approach()` already smooths the input, so snapping at
24 fps should read cleanly. Assets are gitignored — they are regenerable
output, not source.

---

## 4. Budgets

| VRAM (6 GB) | | Latency, comment → first audio | |
|---|---|---|---|
| Phonon | **0** (CPU-only) | TikTokLive event | 200–500 ms |
| Visemes + canvas | **0** (browser) | LLM first sentence | 300–700 ms |
| Whisper small int8 (ph. 2) | ~1 GB | Phonon, 1 sentence | ~900 ms |
| OBS NVENC | ~0.5 GB | Browser audio start | ~50 ms |
| **Free** | **~4.5 GB** | **Total** | **~1.5–2.2 s** |

Under 2.5 s reads as reactive. The headroom is what makes a GPU face model
worth *testing* later — using `realtime-lucy`'s bench harness to measure it
rather than trusting a README.

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
| **Viseme plates may look uncanny** | The one unproven piece. Build the compositor *first* and look at it before building anything around it. If it fails, fall back to photoreal state-machine loops (idle / talking / laughing) — the same WanGP assets serve both, so nothing is wasted |
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
  plates/                generated assets (gitignored)

src/app/stage/tiktok-agent/page.tsx    OBS browser source
```
