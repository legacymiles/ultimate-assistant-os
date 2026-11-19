# Phonon TTS — Jarvis's voice, local and free

Gradium's [Phonon](https://github.com/gradium-ai/xn-ptts) running on this machine's **CPU**,
behind a small HTTP server that `/api/tts` talks to. Replaces the fish.audio round-trip for
Jarvis's speaking voice: no key, no quota, no network, and it works with the Wi-Fi off.

## Start it

```bash
npm run tts:phonon
```

First run creates `.venv` and installs `ptts` (~7 MB wheel, numpy its only dependency — **no
PyTorch, no CUDA**). The model itself is a 65 MB `q8` GGUF, cached by HuggingFace after the
first download.

Then point the site at it — in `.env.local`:

```
TTS_BACKEND=phonon
PHONON_VOICE=Easton
```

Leave `FISH_API_KEY` where it is: with both set, Phonon serves the voice and fish.audio stays
as the net for when this server is not running (see "Fallback" below).

## Measured on the owner's laptop

Ryzen 5 7235HS, 4 cores / 8 threads, `phonon-31m-en` at `q8_0`:

| | |
|---|---|
| Model load (warm cache) | 1.6 s, once at startup |
| Synthesis | **~5.5x realtime** — 1.0 s for a 5.3 s sentence |
| Device | `cpu`. **The 6 GB GPU is not used at all** — the `xn` runtime ships no CUDA backend (`ptts.available_devices()` → `['cpu']`) |
| Output | 24 kHz mono |
| Voices | 102 in the catalog, downloaded one at a time on first use |

## Endpoints

| | |
|---|---|
| `POST /v1/tts` | `{"text", "voice"?, "format"?: "wav"\|"mp3", "speed"?, "temperature"?, "seed"?}` → audio bytes |
| `GET /health` | which checkpoint actually loaded, device, quant, voice count, whether ffmpeg is present |
| `GET /v1/voices` | the catalog's 102 voice names |

`GET /health` is the one to check first when the voice sounds wrong — `running_requested: false`
means it fell back to another checkpoint (see below).

## Configuration

All environment variables, all optional:

| Variable | Default | |
|---|---|---|
| `PHONON_MODEL` | `hf://gradium/phonon-31m-en` | checkpoint to load |
| `PHONON_FALLBACK_MODEL` | `hf://gradium/phonon-31m-en` | second attempt when the above cannot be fetched |
| `PHONON_VOICE` | `Easton` | default voice |
| `PHONON_LANG` | `en` | text-normalisation language |
| `PHONON_QUANT` | `q8_0` | `f32`, `q8_0`, `q6k`, `q5k`, `q4k` … |
| `PHONON_PORT` | `8123` | binds `127.0.0.1` only |
| `PHONON_THREADS` | library default (8 here) | synthesis threads |
| `PHONON_KEY` | — | if set, requires `Authorization: Bearer <key>` |

## Why 31M and not 40M

**Decided 18 Nov 2026: stay on `phonon-31m-en`.** Two reasons, and neither is "40M was hard to
get":

- **Licence.** The 40M family is **CC BY-NC 4.0 — non-commercial**. 31M is **Apache 2.0**, so it
  is the only one of the family that may ship in anything commercial. The code is MIT /
  Apache-2.0 either way; this is about the weights.
- **Quality.** On Gradium's own English benchmarks 31M *beats* the multilingual 40M (Elo 2098,
  hard-set WER 1.5%). What 40M adds is French, German, Spanish and Portuguese — not a better
  English voice.

40M is also gated on HuggingFace. To run it anyway, for personal use:

1. Accept the terms at <https://huggingface.co/gradium/phonon-40m-en>.
2. Put a read token in the environment: `HF_TOKEN=hf_...` — or run `hf auth login` once.
3. Set `PHONON_MODEL=hf://gradium/phonon-40m-en` and restart. `GET /health` will show
   `running_requested: true` once it really loaded.

If a gated or missing checkpoint is ever configured, the server falls back to
`PHONON_FALLBACK_MODEL` and logs a `NOTE:` rather than refusing to start.

## Fallback

Two layers, both deliberate:

- **Checkpoint** — if `PHONON_MODEL` cannot be loaded (gated, offline, typo), the server loads
  `PHONON_FALLBACK_MODEL` and logs a `NOTE:` line. It only exits if neither works.
- **Backend** — if this server is not running at all, `/api/tts` retries on fish.audio when
  `FISH_API_KEY` is set. A sleeping laptop is an everyday state, not an outage, and Jarvis
  dropping to the browser's robot voice is worse than a paid round-trip.

## What it does not do

- **No voice cloning.** Phonon's open checkpoints report `supports_voice_cloning: false`; the
  `clone_voice` API exists but the published weights do not back it, and Gradium's own cloning
  runs in their cloud. `/api/tts` therefore keeps reporting `cloning: false` on this backend,
  and cloning stays on the fish path.
- **English only** on `phonon-31m-en`. The 40M family adds fr/de/es/pt, under the non-commercial
  licence above.
- **Local only.** A deployed site cannot reach `127.0.0.1`, so Vercel still needs fish.audio.
  Only the backend selector changes.
- **No speed control of its own.** `speed` is an ffmpeg `atempo` pass (pitch preserved). Without
  ffmpeg on PATH the audio comes back at normal speed rather than failing.
