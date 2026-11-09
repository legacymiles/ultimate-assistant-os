---
name: music-classified-app
description: Music Classified at /apps/music-classified — files favourite songs by energy level 1-10 › genre › sub-genre with multi-lens AI descriptions; iTunes preview measured in-browser; hidden-reasoning token-cap gotcha
metadata: 
  node_type: memory
  type: project
  originSessionId: 7fcefe2f-38c0-4ece-be1b-bb8d8a03cd24
  modified: 2026-09-14T00:09:17.085Z
---

Built 2026-09-13. Files: `src/lib/music-classified/`, `src/components/music-classified/`,
`src/app/api/music-classified/{identify,classify,describe,blueprint}`. Local-first, synced via
app_state key `music-classified:v1`. Dense three-pane layout (per [[ai-rankings-app]] preference).

Taxonomy: fixed 1–10 ENERGY ladder (not tempo alone) → free-form genre playlist → sub-genre.
New names snap onto existing ones via `genreKey` (R&B/RnB/R and B, hip hop/Hip-Hop) then
closestPlace. 8 description "lenses" (plain English, producer, songwriter, theory, DJ, vibe,
dancer, "make one like it" with a Style prompt line); user ticks which, can add more per song.
Playlist "Blueprint" = shared DNA of a scope's songs as a how-to-make-one guide.

How it "knows how the song sounds": the model's own knowledge of released music, pinned to
the exact recording by the keyless iTunes Search/Lookup API. iTunes `previewUrl` (30s AAC on
audio-ssl.itunes.apple.com) sends `Access-Control-Allow-Origin: *`, so the browser measures
tempo/key with Soundprint's analyzer (see [[soundprint-app]]) — no proxy. Model may override
measured BPM only when it's exactly half/double (verified: Snooze 72→143, Blinding Lights 86→171).

Link facts (verified 2026-09-13): YouTube oEmbed title → cleaned "Artist - Title"; Apple Music
`?i=` / `/song/…/ID` → itunes lookup; **Spotify track page is a web-player shell with NO og
tags for a server fetch — use `open.spotify.com/embed/track/<id>`**, which has `"title"` and
`"artists":[{"name"`.

**Gotcha — truncated JSON:** Opus 5 via OpenRouter counts hidden reasoning against
`max_tokens`; a 1400 cap cut off a ~400-token visible reply (`finish_reason=length`). Caps are
now 5000+ (billing is on tokens used). Descriptions are written as parallel one-lens calls
after a lens-less filing call (~15–25s each) instead of one long reply (>60s).

Offline (no key): files from iTunes genre + measured tempo, confidence "guess".

**Favorites + My Music (added 2026-09-13).** Songs carry `favorite` (★ filter works with the
1–10 level chip strip on both tabs) and `kind: "own"` for the user's uploads. Own songs share
the `songs` array but never build the Library's level tree; My Music's sidebar is artist →
levels ("categorized by the artist since their songs sound mostly the same"). Upload =
artist name + audio files (pick or drop).

**AI CAN hear audio via OpenRouter** — correcting the older gateway-only finding in
[[soundprint-app]]: OpenRouter lists many `input_audio` models (Gemini 2.5–3.8, gpt-audio,
voxtral…). `google/gemini-3.8-flash` (env `MUSIC_LISTEN_MODEL`) takes a base64 WAV content
part `{type:"input_audio",input_audio:{data,format:"wav"}}` and returns good producer-grade
descriptions in ~15s. Its key detection is unreliable, so browser measurements stay ground
truth, and for own music the MEASURED BPM always wins (it called a 140 half-time beat 70).
Browser sends the loudest 40s as 16 kHz mono WAV (~1.7 MB base64, under Vercel's 4.5 MB body).
Audio blobs live in IndexedDB `music-classified-audio` on the uploading device only.

**Per-song style prompt (2026-09-19; replaced a short-lived Style Prompt TAB the owner rejected —
"users find real people's songs; the job is to describe THAT song accurately for a generator").**
Every filed song gets `song.style` (≤1,000 chars, no names/lyrics): written in parallel with the
lens descriptions after filing (and after each upload/relisten); older songs get one when opened
(StyleCard auto-write). Logic `src/lib/music-classified/style.ts` (`songStylePrompt`, 13-check
`checkStyle` incl. exact measured BPM + key, `fitToLimit` last resort); route `/api/music-classified/style`
{song} → write + up to 2 gated rewrites; offline = built from the filed profile. Verified: "Went Legit"
→ 1,000 and 989 chars, 13/13, ~15–40 s. Gotcha: React dev double-runs effects — an abort in a cleanup
must also reset the "already tried" guard or the auto-write never fires.
Preview server: `music-classified-preview-3241`.
