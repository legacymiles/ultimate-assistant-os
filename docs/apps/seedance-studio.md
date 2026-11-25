# Music Video Studio

Route: `/apps/seedance-studio` · Category: Video · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- seedance-studio "what to change"`.

## What it does

An audio-driven video engine: drop a song and the film is cut TO it, not laid over it. The track is decoded in the browser and never uploaded — tempo, bar lines, sections, energy and the exact moments it drops are all measured locally and free. A listening model transcribes the words with their times (or paste your own lyrics and have them timed), and then Jarvis's Studio chat — the same @-mentioned workflows, the same people out of your Photos library, the same camera deck, the same uploads — plans the film as a SCORE: a shot sheet where every cut is pinned to a second of the track, snapped to a measured bar line, and landing on the drops. Lip-sync ranges say which seconds are sung to camera, and on those cuts the words outrank the prompt: the performer is on camera, mouthing those exact words, and the visual idea becomes the world around them. The board is editable after the plan and after the render — move a cut, split it, lock it, toggle whether it sings, rewrite the woven prompt, or render one cut on its own before committing the queue — with a second board showing just the cuts that sing. The film renders free on the owner's own GPU, every clip trimmed back to its planned slot so the picture cannot drift, and the song laid over it at full level as the master. The original three-lane cutting room is still there behind a toggle. Video prompts run end to end under the track — add them with a +, drag to reorder, drag an edge to trim, and open any one to write its prompt, attach reference images and set the Studio camera deck: Film setup (genre, era, tempo), Camera, Movement as ordered #tokens, Style, Color palette and Lighting, all layered over a reel-wide direction every block inherits. The first image becomes that block's artwork, so the lane reads as a storyboard before anything is rendered. The song lane draws the real waveform, decoded in the browser. The lip-sync lane holds plain ranges — no prompts, just drag and trim them onto the seconds you want sung; whichever video prompts they land on turn amber and lip-sync to the audio, while the rest play under the music. Wired to Seedance 2 through the Vercel AI Gateway (real video when AI_GATEWAY_API_KEY is set), with graded stand-ins so the cutting room is fully usable offline.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Free first, by what the request actually carries** — Every general call now picks its model from the request rather than from a single default, at one seam (planCall in src/lib/ai/provider.ts), so none of the 37 call sites needed touching.
- **An @ names the photo you just uploaded, in every chat** — The Chat tab already offered this conversation's uploads behind @. The two other composers for the same conversation did not, which is the wrong two: the Studio idea box is where a shot actually star…
- **Seedance Studio cuts to the song, and the Skills tab survives a deploy** — The skills library was reading ~/.claude/skills, a folder that exists on one PC. Deployed, the Toolbox came back empty — the opposite of what a library is for. Every personal SKILL.md is now mirrored…
- **Three lanes, and prompts only in the video blocks** — The timeline is now exactly three lanes. Video prompts run end to end under the song and are the only place a prompt lives — its words, its camera deck, its reference images. The song sits in the mid…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/seedance-studio` — owner's sign-in
- `src/app/api/seedance/`
- `src/components/seedance/`
- `src/lib/seedance/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/seedance` | owner's sign-in |
| POST | `/api/seedance/transcribe` | owner's sign-in |

### Data & database rules

- Saved data `seedance-chat:v1` — `src/components/seedance/SeedanceChat.tsx`
- Saved data `seedance-studio:v3` — `src/lib/seedance/repo.ts`

### Keys & outside services

- `AI_GATEWAY_API_KEY` — `src/app/api/seedance/route.ts`
- `AI_VIDEO_MODEL` — `src/app/api/seedance/route.ts`
- `MUSIC_LISTEN_MODEL` — `src/app/api/seedance/transcribe/route.ts`
- `SEEDANCE_LISTEN_MODEL` — `src/app/api/seedance/transcribe/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/seedance/transcribe/route.ts`

### Tests

- `src/lib/seedance/audio/grid.test.ts`
- `src/lib/seedance/audio/transcribe.test.ts`
- `src/lib/seedance/reel.test.ts`
- `src/lib/seedance/score.test.ts`
<!-- code:end -->
