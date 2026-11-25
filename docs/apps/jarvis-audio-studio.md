# Jarvis Audio Studio

Route: `/apps/jarvis-audio-studio` · Category: Music · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- jarvis-audio-studio "what to change"`.

## What it does

Three music studios behind one switcher, because they were always three halves of the same job: get the recording, understand it, make the next one. FIND searches a song, names the exact recording first — album, year, length and thirty seconds of the real audio — and only then hunts a file for it, scoring every candidate against what you confirmed rather than the words you typed, so you stop ending up with a cover, a sped-up edit or a lyric video with a nine-second intro. Files come from the Internet Archive, the Creative Commons catalogues Openverse indexes, and roughly twenty sites through yt-dlp, grouped by what the licence actually lets you do with them. CLASSIFY is the private catalogue: paste a name or a link and it measures tempo and key off the preview in your own browser, files the song on a 1–10 energy ladder into a genre and a sub-genre, and describes it in whichever voice you asked for — plain English, producer, music theory, DJ, dancer — including a style prompt of that exact recording an AI song generator can follow. Upload your own audio and a listening model hears it rather than guessing from the filename. CREATE is the production side: write the brief, watch it become a style line and a lyric sheet, and render a real 48 kHz song on YuE2 — which plans before it plays, so the melody and chords come back as a score you can edit and re-render instead of rerolling the dice. A voice you save once is cloned, isolated from the music it arrived in, and kept in a library that never has to process that artist again. Switching studio never leaves the app or drops what you were holding, and every one of them works with no keys set: the catalogue, the measuring, the writing and the score editing all run locally, and only rendering asks for a GPU — which it says plainly when it is not there.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Stop the PC panel polling in background tabs** — YourPc polled /api/mp3-download/bridge every 5 seconds with no visibility check, so a forgotten background tab was about 17,000 billed function calls a day that nobody was looking at. It now polls on…
- **Preview icons for Mashup and Remix, and a tile that earns them** — Made with the preview-icon skill, whose one rule is to depict the verb rather than the screen: a generated interface is garbled mush at tile size and dates the moment the real UI moves. So Mashup is …
- **Mashup hears the parts; Remix is one record and a sentence** — Design driven by interactive-web-studio, with webgl-trail-reveal owning the mechanic. Each tab opens on a sealed plate; sweeping it drags a trail with memory across the surface and reveals the measur…
- **Send every bridged file through Storage, not just the big ones** — Every real download was failing with a 413 and I had proved the feature worked, because the file I tested with was the one size that happened to succeed.
- **A bridged file must download, not play** — Caught testing the bridge for real on the live site. The grab worked end to end — runner claimed the job, hit YouTube's 403, re-extracted itself, sent back 10.5 MB through the signed Storage link — a…
- **YouTube rows on the live site, with no yt-dlp and no key** — The bridge I just built fetches files the deployed site cannot — but the rows you press Download on were still coming from yt-dlp, so on the live site there was nothing to press. The feature was half…
- **Let the PC fetch what the live site cannot** — yt-dlp is a program on the owner's machine and Vercel has no such binary, so on the deployed site the YouTube source was simply dark. Honest, and useless when you are on your phone and want the song.
- **Find yt-dlp when PATH does not mention it, and say where it cannot run** — Two different "yt-dlp is not on this machine", told apart at last.
- **Sign in with Google, and fix the YouTube rows that never appeared** — The login page is one button now. The email-and-password form with its Sign in / Sign up toggle asked a visitor to invent a credential before they had seen anything, and left this site holding a pass…
- **Find the song, prove it, then take it** — A new hub app at /apps/mp3-download, and the first entry in Jarvis Studio's App plugins.
- **Two songs, a blend you control, and one session of versions** — The tool took one recording plus a line of prose about a second. It now takes two records and asks what each one contributes.
- **Every song saved to the account as MP3, Finished songs folders** — Takes only lived on the GPU pod, so they stopped playing whenever it idle-stopped. Each finished take is now copied into the private `music-creator` Storage bucket under the account id (re-encoded to…
- **Fix every render failing on first poll; SheetSage honest when skipped** — studio.watch read `jobId` inside the progress callback of the very call that declares it, so the first poll threw "Cannot access 'jobId' before initialization" and every render was filed as failed (t…
- **Pick GPU+site from live stock, Blackwell torch, self-healing wake** — setup.mjs chooses GPU and data centre together from RunPod's availability catalog (volume-capable sites only, best stock then price); volume API uses `dataCenter`. - bootstrap swaps any venv's torch …
- **AI Producer + prompt engineer, style+lyrics only, GPU wakes on render** — Song Creator now takes only a style and lyrics. Per prompt, choose AI Producer (producer plan -> prompt engineer -> code QC -> one targeted revision) or send it exactly as typed. Shows original vs op…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/jarvis-audio-studio` — owner's sign-in
- Page `/apps/mp3-download` — owner's sign-in
- Page `/apps/music-classified` — owner's sign-in
- Page `/apps/music-creator` — owner's sign-in
- `src/app/api/mp3-download/`
- `src/app/api/music-classified/`
- `src/app/api/music-creator/`
- `src/components/jarvis-audio-studio/`
- `src/components/mp3-download/`
- `src/components/music-classified/`
- `src/components/music-creator/`
- `src/lib/jarvis-audio-studio/`
- `src/lib/mp3-download/`
- `src/lib/music-classified/`
- `src/lib/music-creator/`

### Sign-in & who can use it

- Needs a signed-in user (requireUser / auth.getUser) — `src/lib/music-creator/library.ts`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/mp3-download/bridge` | owner's sign-in |
| GET | `/api/mp3-download/bridge/file` | owner's sign-in |
| GET | `/api/mp3-download/file` | owner's sign-in |
| GET POST | `/api/mp3-download/link` | owner's sign-in |
| POST | `/api/mp3-download/runner/claim` | per-account key (no session) |
| POST | `/api/mp3-download/runner/fail` | per-account key (no session) |
| POST | `/api/mp3-download/runner/result` | per-account key (no session) |
| GET | `/api/mp3-download/search` | owner's sign-in |
| POST | `/api/mp3-download/sources` | owner's sign-in |
| GET POST | `/api/mp3-download/ytdlp` | owner's sign-in |
| POST | `/api/music-classified/blueprint` | owner's sign-in |
| POST | `/api/music-classified/classify` | owner's sign-in |
| POST | `/api/music-classified/describe` | owner's sign-in |
| POST | `/api/music-classified/identify` | owner's sign-in |
| POST | `/api/music-classified/listen` | owner's sign-in |
| POST | `/api/music-classified/style` | owner's sign-in |
| GET POST PATCH DELETE | `/api/music-creator/[...path]` | owner's sign-in |
| GET | `/api/music-creator/artist` | owner's sign-in |
| POST | `/api/music-creator/library` | owner's sign-in |
| GET | `/api/music-creator/library/[file]` | owner's sign-in |
| POST | `/api/music-creator/produce` | owner's sign-in |
| POST | `/api/music-creator/write` | owner's sign-in |

### Data & database rules

- Saved data `music-classified:v1` — `src/lib/music-classified/store.ts`
- Server docs (server_docs via readDoc/writeDoc) — `src/lib/mp3-download/server/bridge.ts`

### Keys & outside services

- `AI_MODEL` — `src/app/api/music-creator/produce/route.ts`, `src/app/api/music-creator/write/route.ts` +1 more
- `APPDATA` — `src/lib/mp3-download/ytdlp.ts`
- `AWS_LAMBDA_FUNCTION_NAME` — `src/lib/mp3-download/ytdlp.ts`
- `FFMPEG_PATH` — `src/lib/mp3-download/ytdlp.ts`
- `LOCALAPPDATA` — `src/lib/mp3-download/ytdlp.ts`
- `MP3_DOWNLOAD_DATA_DIR` — `src/lib/mp3-download/server/bridge.ts`
- `MUSIC_LIBRARY_DIR` — `src/lib/music-creator/library.ts`
- `MUSIC_LISTEN_MODEL` — `src/app/api/music-classified/listen/route.ts`
- `MUSIC_MODEL` — `src/app/api/music-creator/produce/route.ts`, `src/app/api/music-creator/write/route.ts`
- `MUSIC_SERVER_URL` — `src/app/api/music-creator/[...path]/route.ts`, `src/lib/music-creator/library.ts`
- `MUSIC_TOKEN` — `src/app/api/music-creator/[...path]/route.ts`, `src/lib/music-creator/library.ts`
- `VERCEL` — `src/lib/mp3-download/ytdlp.ts`
- `YTDLP_PATH` — `src/lib/mp3-download/ytdlp.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/music-classified/listen/route.ts`, `src/app/api/music-creator/produce/route.ts`, `src/app/api/music-creator/write/route.ts` +1 more

### Tests

- `src/lib/mp3-download/match.test.ts`
- `src/lib/music-classified/music-classified.test.ts`
- `src/lib/music-classified/own-music.test.ts`
- `src/lib/music-classified/style.test.ts`
- `src/lib/music-creator/mashup.test.ts`
- `src/lib/music-creator/producer.test.ts`
- `src/lib/music-creator/remix.test.ts`
- `src/lib/music-creator/stems.test.ts`
- `src/lib/music-creator/tempo.test.ts`
- `src/lib/music-creator/write.test.ts`
<!-- code:end -->
