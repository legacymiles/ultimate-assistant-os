---
name: soundprint-app
description: Soundprint app at /apps/soundprint turns a reference song into Suno style+lyrics prompts; key finding that no AI Gateway language model accepts audio input
metadata: 
  node_type: memory
  type: project
  originSessionId: 05433440-7d55-442a-bb53-ce03c9b75204
  modified: 2026-08-02T23:13:56.427Z
---

Soundprint (`/apps/soundprint`) makes "songs that sound like other songs" — it outputs the two fields
Suno needs: a **Style/Genre prompt** and a **Lyrics prompt**. Built 2026-07-23. Files live in
`src/lib/soundprint/`, `src/components/soundprint/`, `src/app/api/soundprint/route.ts`.

**The load-bearing technical finding:** *no* language model on the Vercel AI Gateway accepts `audio`
input — verified against `https://ai-gateway.vercel.sh/v1/models`, where Gemini/Qwen/GPT/Claude all
declare `input: [text, image, pdf]`. The only audio-input models are transcription (`whisper-1`,
`gpt-4o-transcribe`, `xai/grok-stt`) and realtime, which return words, not musical style. So "have an
LLM listen to the song" is not available through the gateway. Re-check before assuming otherwise.

Soundprint works around this by **measuring the audio in the browser** with the Web Audio API
(`src/lib/soundprint/audio-analysis.ts`): tempo via spectral-flux autocorrelation, key via chroma +
Krumhansl-Schmuckler, spectral centroid, dynamic range, stereo width. The model receives those
measurements as ground truth and supplies interpretation only. This also means the offline (no
`AI_GATEWAY_API_KEY`) path still has real data.

**Percussion detection gotcha:** counting transients alone is wrong — every plucked guitar note is a
transient, so an arpeggiated intro reads as "drums". Real discriminator is broadband energy above
5.5 kHz (cymbals/snare are noise; pitched instruments leave that band nearly empty). The transient
rate is gated on that ratio.

Explicit-content requests route to Treblo instead of Suno (Suno filters profanity). Requests naming a
real performer to *sing* the song are converted into a descriptive voice profile rather than an
impersonation instruction — see [[hub-parallel-dev-servers]] for how to verify safely.

**Two providers (src/lib/soundprint/providers.ts + models.ts):** `openrouter` (OPENROUTER_API_KEY,
has a genuinely FREE tier — Nemotron 3 Ultra 550B is the default, no card needed) and `gateway`
(AI_GATEWAY_API_KEY, paid). NB: no *free* Qwen exists on OpenRouter — Qwen is paid-only via the
gateway. Verified live 2026-07-24: free Nemotron 550B returns excellent AI breakdowns (~35s).

**Playback = the REAL Suno track (pivoted 2026-07-25, verified working).** The user wanted the song
played here to actually be from Suno, not a Lyria stand-in — so the Lyria "Hear it now" path AND Treblo
were REMOVED (deleted music.ts, stream.ts, /api/soundprint/preview; platforms.ts is Suno-only now; the
explicit toggle went with Treblo). New flow (src/components/soundprint/SunoStudio.tsx +
/api/soundprint/suno-track): user creates the song on Suno with the two prompts, pastes the share link
back, app plays it.

Key Suno facts (verified via curl 2026-07-25):
- Suno has NO public generation API (partner-only beta) — cannot auto-create.
- Every Suno page sends `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'none'` — its visual
  player CANNOT be iframed. Don't try to embed suno.com; the browser refuses it.
- BUT the finished audio is public at `https://cdn1.suno.ai/<song-uuid>.mp3` (200, audio/mp3) and plays
  cross-origin in a plain <audio> element (no CORS needed for playback). This is the whole trick.
- Short links `suno.com/s/<code>` 307-redirect to `/song/<uuid>?sh=…`; resolve server-side with
  `fetch(..., {redirect:'manual'})` and read the Location header (a browser fetch is CORS-blocked).
- Song must be Public or "Anyone with the link" for the mp3 to be reachable.

OpenRouter key (OPENROUTER_API_KEY) is STILL needed — it powers the free LLM analysis (not playback
anymore). Lyria/preview code is gone.

**essentia.js audio analysis (added + verified in-browser 2026-08-02).** Replaced/augmented the
hand-rolled DSP with essentia.js (WASM build of MTG's Essentia MIR library) for better tempo/key +
a new Danceability "groove" feature. Verified in a real browser: 100 BPM + A minor + groove 3.3 on a
synthetic A-minor arpeggio. Files: src/lib/soundprint/essentia-analysis.ts (loader + analyzer),
merged into AudioPanel (DSP shows instantly, essentia upgrades async).

Loading gotchas that mattered:
- Do NOT bundle the ES build via import — the emscripten env-detection misbehaves under Node/SSR and
  Turbopack chokes on the 2MB base64 blob. Instead use the official WEB build copied to
  `public/essentia/` (essentia-wasm.web.js + .wasm + essentia.js-core.js) and inject as <script> tags
  at runtime. web.js locates its .wasm via document.currentScript.src, so /public placement just works.
  Next serves the .wasm as application/wasm (correct MIME, streaming instantiation OK).
- Globals after script load: window.EssentiaWASM (a FACTORY → call it, await the promise) and
  window.Essentia (class). `new Essentia(backend.EssentiaWASM ?? backend)`.
- First WASM instantiation is ~6s (one-time, then cached) — that's why a 30s browser-tool call can
  time out. arrayToVector() returns an emscripten vector; call .delete() to free it.
- essentia algos default to sampleRate 44100; the LoadedAudio buffer is 22050, so resample the slice
  to 44100 before calling (see toEssentiaRate).
- Everything degrades to the DSP if essentia fails to load — analyzeWithEssentia returns null and the
  merge is skipped. AudioFeatures.analyzer is "dsp" | "essentia".

**Crash recovery:** a mid-session machine crash left `.next` corrupted (`EINVAL readlink
app-paths-manifest.json`). Fix = kill node, `rm -rf .next`, restart — matches [[hub-parallel-dev-servers]].
