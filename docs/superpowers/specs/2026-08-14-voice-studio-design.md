# Voice Studio — Design Spec

**Date:** 2026-08-14
**Status:** Approved design → ready for implementation planning
**One-liner:** A text-to-speech + instant voice-cloning app for the OS hub, powered by fish-speech via the fish.audio hosted API, with a free browser-voice fallback and a swappable backend so it can later point at a self-hosted fish-speech GPU server.

---

## 1. Goal & key facts

Give the OS portfolio a polished **Voice Studio** app: type text in 80+ languages, pick a voice (or clone one from a 10–30s clip), and generate downloadable speech. It uses **fish-speech** — a state-of-the-art open TTS + voice-cloning model — through its makers' hosted API.

**fish-speech reality (why this shape):** the GitHub repo is a Python/PyTorch model that needs an NVIDIA GPU; it is not a web library. So the model runs *somewhere* and the site calls it. We use the **fish.audio hosted API** (same team/model) now, structured so the backend can be repointed at a self-hosted fish-speech server later.

**fish.audio API (confirmed):**
- `POST https://api.fish.audio/v1/tts`, `Authorization: Bearer $FISH_API_KEY`
- Body: JSON **or** msgpack. `model` header: `s2.1-pro-free` (free tier) | `s2-pro` | `s2.1-pro` | `s1`.
- Fields: `text`, `reference_id` (a library/preset voice), `references: [{audio: bytes, text: transcript}]` (instant cloning), `format` (`mp3`|`wav`|`pcm`|`opus`), `mp3_bitrate`, `prosody: {speed 0.5–2.0}`, `chunk_length`, `latency`.
- Cloning: pass `references` with a clean 10–30s clip + its transcript; to reuse a voice, clone once and reuse the returned `reference_id`.

---

## 2. Architecture

A new hub app, same shape as Prompt Architect / Website Redesigner.

- **Catalog tile** in `src/lib/catalog.ts` (slug `voice-studio`, category `AI`, `appUrl: /apps/voice-studio`).
- **Route** `src/app/apps/voice-studio/page.tsx` → renders the `VoiceStudio` component.
- **UI** in `src/components/voice-studio/` (OS design system: `Icon` set + `ink`/`brand`/`line`/`panel` tokens).
- **Server route** `src/app/api/tts/route.ts` (`runtime = "nodejs"`) — holds the secret key, builds the provider request, returns audio bytes. The browser never sees the key.
- **Lib** `src/lib/voice-studio/` — types, the browser-fallback helper, and the localStorage store.

### 2.1 Swappable backend adapter (the door we're keeping open)
The `/api/tts` route selects a backend by env:
- `TTS_BACKEND=fish-audio` (default) → calls `https://api.fish.audio/v1/tts` with `FISH_API_KEY` + `model: s2.1-pro-free` (override via `FISH_MODEL`).
- `TTS_BACKEND=self-hosted` → POSTs the same logical request to `TTS_SELF_HOST_URL` (a running fish-speech server). Same front-end, no UI change.

Encoding: the browser sends JSON to `/api/tts` (clone audio as base64). The server decodes and forwards to fish.audio using **msgpack** (`@msgpack/msgpack`) so binary `references.audio` is handled natively; text-only requests may use JSON.

### 2.2 Fallback-first (no key required to run)
- **No `FISH_API_KEY`:** plain TTS falls back to the browser's `window.speechSynthesis` (voices from `getVoices()`), so the app works out of the box. Matches the OS "AI when keyed, still usable without" pattern.
- **Fallback limits (stated honestly in the UI):** browser voices can't clone and don't yield a downloadable file — so in fallback mode, **cloning and download are disabled** with a note that adding a key unlocks them. Everything lights up the moment `FISH_API_KEY` is set.

---

## 3. Features (all shipped together)

1. **Compose** — a large multilingual text area, a live character counter (fair-use/cost awareness), voice picker, speed slider (0.5–2.0), format select (mp3/wav). **Generate** → inline `<audio>` player + **Download**.
2. **Voices** — `Default` (no `reference_id`) + a small curated set of named preset voices (verified fish.audio `reference_id`s, filled in during build) + a **"paste a fish.audio voice ID"** field for the user's own library voices.
3. **Clone a voice** — **upload** an audio file **or record 10–30s from the mic** (`MediaRecorder`), an optional transcript field, and a name. The cloned voice appears in the picker and is used via inline `references` on generate. (Requires a key.)
4. **History & saved voices** — recent generations (text, voice, mp3 as base64) and saved cloned voices (clip + name + transcript) persist in `localStorage`, offline-first, capped to a sensible count/size. Replay, download, delete.

---

## 4. Data flow

```
Compose → POST /api/tts {text, voiceId | references(base64+transcript), format, speed}
        → [fish-audio] msgpack + Bearer key + model header → mp3 bytes
        → browser: play, offer download, append to history
No key  → browser speechSynthesis (playback only; clone/download disabled)
Later   → TTS_BACKEND=self-hosted → same request to your fish-speech GPU server
```

---

## 5. Error handling

- Missing/invalid key → route responds `{ fallback: true }`; the client switches to `speechSynthesis` and shows a one-line "add a key for fish-speech quality + cloning" note.
- Provider errors (rate limit / fair-use / 4xx-5xx) → surfaced as a clear inline message; the compose box keeps the text.
- Mic permission denied / no audio device → graceful message; upload still works.
- Oversized text → warn at the character counter and, if needed, the route relies on the provider's `chunk_length`.
- Reference clip too short/long/large → validated client-side (target 10–30s, size cap) before upload.

---

## 6. Non-goals / YAGNI (v1)

- No streaming playback (generate full clip, then play) — a clean v2 add.
- No creating persistent fish.audio voice *models* (`reference_id`); cloning is inline per request, with the clip saved locally for reuse.
- No Supabase/DB — `localStorage` only.
- No self-hosted GPU server setup in this build; only the adapter seam that makes it possible.

---

## 7. Open questions

1. App name — "Voice Studio" (proposed) vs another; and category (`AI` vs `Music`) for the tile.
2. Which curated preset voices to ship — need a few verified public `reference_id`s from fish.audio's Voice Library (fallback: ship `Default` + paste-your-own only).
3. History size cap (proposed: last 20 clips, ~a few MB of base64).
