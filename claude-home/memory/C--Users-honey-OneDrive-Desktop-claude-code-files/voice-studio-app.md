---
name: voice-studio-app
description: "Voice Studio TTS + voice-cloning app at /apps/voice-studio (fish-speech via fish.audio, browser-voice fallback, swappable backend)"
metadata: 
  node_type: memory
  type: project
  originSessionId: bfe65104-6916-4b3a-b678-ae8ceaa53e2f
  modified: 2026-08-14T20:18:49.923Z
---

**Voice Studio** is a hub app in [[ultimate-assistant-os-portfolio]] at `/apps/voice-studio` (catalog slug `voice-studio`, category AI), built 2026-08-14. Type text in 80+ languages → speech; or clone a voice from a 10–30s clip (upload or mic-record) → make it say anything. Speed + MP3/WAV, download, and a `localStorage` history. Powered by **fish-speech** via the **fish.audio** hosted API.

Design spec: `docs/superpowers/specs/2026-08-14-voice-studio-design.md`.

**fish-speech reality:** the GitHub repo (github.com/fishaudio/fish-speech) is a GPU-bound Python/PyTorch model, NOT a web library — so the site calls a running model. We use the fish.audio hosted API now, with a **swappable backend** so it can later point at a self-hosted fish-speech server.

**fish.audio API used:** `POST https://api.fish.audio/v1/tts`, `Authorization: Bearer FISH_API_KEY`, `model` header (`s2.1-pro-free` = free tier). Body is JSON **or msgpack**; we send **msgpack** because voice-cloning `references:[{audio: bytes, text}]` carry raw audio. Preset voices via `reference_id`; cloning via inline `references`. Fields: text, format(mp3/wav), prosody{speed}, chunk_length, mp3_bitrate.

**Files:**
- `src/app/api/tts/route.ts` — Node route. `GET` = capabilities `{mode, cloning}`; `POST` = generate. Backend selected by env: `TTS_BACKEND=fish-audio` (default, needs `FISH_API_KEY`) | `self-hosted` (`TTS_SELF_HOST_URL` → its `/v1/tts`). No key → returns `{fallback:true}`.
- `src/lib/voice-studio/msgpack.ts` — tiny self-contained MessagePack encoder (no dependency added).
- `src/lib/voice-studio/{types,store,speech}.ts` — types, localStorage (history + saved voices), browser `speechSynthesis` fallback.
- `src/components/voice-studio/{VoiceStudio,ClonePanel}.tsx` + `src/app/apps/voice-studio/page.tsx`.
- `.env.example` documents `FISH_API_KEY`, `FISH_MODEL`, `TTS_BACKEND`, `TTS_SELF_HOST_URL/KEY`.

**Fallback-first:** with no `FISH_API_KEY` it runs on the browser's `speechSynthesis` voices (playback only; cloning + download disabled with a note). Add the key → fish-speech quality + cloning + download light up. **Verified** end-to-end on the browser path (generate → history → gating; no console errors; TS-clean). The fish.audio path is coded to the documented API but untested live (needs a key). Preset voice list ships empty (Default + paste-your-own) to avoid shipping unverified `reference_id`s.
