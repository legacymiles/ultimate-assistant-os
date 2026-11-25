# Smart Shot Videos

Route: `/apps/smart-shot-videos` · Category: Video · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- smart-shot-videos "what to change"`.

## What it does

One prompt and your own photos become a full production sheet before a single frame of video is rendered. Upload images and tag each as a character, a location, a product or a style; describe the film; pick how many cuts. The planner writes the shoot and draws it: a character reference sheet built from your photo (turnaround, portrait, wardrobe, palette), environment set-design plates, a top-down floor plan with every cut's camera position, a side elevation for the crane move, one storyboard frame per cut captioned with lens, duration, camera move and framing, four lighting references, mood words and cinematography notes — the OpenArt Smart Shot layout, on one sheet. Everything is editable in place and every panel can be redrawn. When the board is right, each cut gets a MiniMax H3 brief in H3's real reference format (subject definitions, retention analysis, a prose camera move with amplitude and speed, soundscape and score) with the character sheet, the set plate and the storyboard frame attached as references, and renders on your own H3 — RunPod, MiniMax hosted or the AI Gateway. Play the cuts back to back, retake any one, download each clip.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Prompt → editable shot plan → one MiniMax H3 film** — A recreation of OpenArt's Smart Shot inside the hub, verified against the demo video. A prompt plus reference images becomes a production sheet — character or product reference sheet, set plates, top…
- **Say the lens in the words H3 reads, and give a cut an angle** — The skill was a document the renderer never opened. plannerSystem told the model to vary "aperture (f/1.4-f/5.6)" and h3prompt.ts emitted "on a 100mm lens at f/2" — both in a notation that, measured …
- **AI director chat on the storyboard, Create video CTA, play+download video page** — /api/smart-shot/revise: chat request -> whole revised plan with kept ids; only panels whose content changed are redrawn - storyboard ends with Create video / Edit with AI; docked AI director chat - v…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/smart-shot-videos` — owner's sign-in
- `src/app/api/smart-shot/`
- `src/components/smart-shot/`
- `src/lib/smart-shot/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/smart-shot/panel` | owner's sign-in |
| POST | `/api/smart-shot/plan` | owner's sign-in |
| POST | `/api/smart-shot/revise` | owner's sign-in |

### Data & database rules

- Saved data `smart-shot:v1` — `src/lib/smart-shot/repo.ts`

### Keys & outside services

- `AI_MODEL` — `src/app/api/smart-shot/plan/route.ts`, `src/app/api/smart-shot/revise/route.ts`
- `SMART_SHOT_IMAGE_MODEL` — `src/app/api/smart-shot/panel/route.ts`
- `SMART_SHOT_MODEL` — `src/app/api/smart-shot/plan/route.ts`, `src/app/api/smart-shot/revise/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/smart-shot/panel/route.ts`, `src/app/api/smart-shot/plan/route.ts`, `src/app/api/smart-shot/revise/route.ts`

### Tests

- `src/lib/smart-shot/revise.test.ts`
- `src/lib/smart-shot/smart-shot.test.ts`
<!-- code:end -->
