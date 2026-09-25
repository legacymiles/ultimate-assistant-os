---
name: shot-plan-storyboard
description: Build the Smart Shot Videos storyboard process — a brief plus reference photos become ONE production-grade shot plan (cast, hero product, set, cut list, lighting, sound), drawn as a paper-white shot-plan sheet of big generated images (character turnaround sheets, product sheets, set plates, a top-down floor plan with numbered camera positions, one storyboard frame per cut, lighting stills), every field editable in place and every picture redrawable, then compiled into ONE video generation whose references are those sheets. Use this WHENEVER someone wants a storyboard, shot plan, shot list, storyboard sheet, previz/blueprint document, character reference sheet, turnaround sheet, product sheet, set floor plan, "the Smart Shot Videos storyboard", an OpenArt Smart Shot-style planner, or a prompt/photo → multi-cut AI video flow where the face, the product and the set must stay identical across every shot. Also use it when adding storyboarding or shot planning to an existing video app or agent, when a storyboard's generated images come out inconsistent, generic or off-model, or when an AI video model is being fed a caption and needs a production brief instead.
---

# Shot-plan storyboard

This is the process behind **Smart Shot Videos** (`/apps/smart-shot-videos` in the Ultimate Assistant
OS hub) — the one that got it right. It turns one line of brief plus a few photos into a production
document a real shoot would recognise, and then into a video that actually matches it.

People who rebuild it from screenshots produce a card grid of thumbnails and images that drift — a
different face in every frame. The difference is not the layout. It is **the reference chain** (§2)
and **one plan as the single source of truth** (§1). Get those two right and the rest is styling.

## The shape of the thing

```
brief + uploads ──▶ PLANNER (one vision LLM call, strict JSON)
                       │
                       ▼
                    PLAN ── the single source of truth ───────────────┐
                       │                                             │
                       ▼                                             ▼
                    PANELS (images, drawn in dependency order)   VIDEO BRIEF
                       │                                        (one generation,
      identity first ──┤ character sheets, product sheets        sheets attached
                       │ set plates                              as references)
      then everything ─┤ floor plan, elevation, cut frames
      drawn FROM them  │ lighting stills
                       ▼
                    THE SHEET (paper-white document, 4 sections,
                    every word editable, every picture redrawable)
                       │
                       ▼  "make it night", "add a close-up"
                    DIRECTOR CHAT ──▶ revised plan ──▶ redraw only what changed
```

## 0. Who writes the plan

This skill draws the sheet. It does **not** decide what the film is.

**`film-plan` writes the plan** — the rounds that interview a short prompt into a spine, the
ledger that places every resource, the precedence ladder, the sound fields, and the gate. It
hands over one `Storyboard` object. Everything below takes that object as given and turns it into
a document the owner can read and edit.

Run `film-plan` first whenever the film is being planned at all. Run this skill alone only when a
plan already exists and needs drawing, redrawing or restyling.

The planner described in §1 and `references/planner.md` is the *fallback* for a standalone build
with no `film-plan` in the loop — one vision call that produces the same object. Where the two
differ, `film-plan` wins, because it is the one that asks the owner.

## THE SHEET IS NOT DONE UNTIL ALL OF THIS EXISTS

Read this before you build anything and again before you say a sheet is finished. A storyboard
that is missing any of it is not a short storyboard — it is an **unfinished** one, and the parts
that get dropped are always the same parts, because they are the ones that take work.

Every line below is a panel or a field on the real sheet. Tick them off literally.

**Header strip** — cut count · aspect · lighting note · lens note · palette swatches WITH their
names · an environment fingerprint sentence.

**Section 1 — Character / product reference.** For EVERY character and hero object:
- the six-panel turnaround on plain white (front, three-quarter, back, portrait, profile, detail)
- a palette swatch row taken from that character
- an appearance description that states skin tone, age, build, hair and face
- a separate wardrobe description

**Section 2 — Environment / set design.** All five, not one:
- the **location plate** — the set, empty, wide
- the **top-down floor plan**, drawn, with a NUMBERED marker per cut showing where the camera
  stands and which way it points, plus a legend reading `1 Cut 1: HANDHELD` and so on
- a **side elevation** for any cut whose move is vertical or an arc
- **set notes** — the depth planes, the atmos, the practical light, how the space is dressed
- **props** — the actual list, every object the action touches

**Section 3 — Storyboard.** One card per cut, in order: the frame, a monospace spec line
(`24mm anamorphic | f/2.8 | 4s | HANDHELD | WIDE`), and the action description.

**Section 4 — Lighting / mood / style.** All five:
- four **lighting stills** with captions naming the key, the rim, the fill and the reflections
- **mood keywords**
- a **style essence** sentence
- **cinematography notes** — format, glass, apertures, grain, contrast, what is banned
- **sound** — the soundscape, and the score or `none`

### The two rules that make it correct rather than merely complete

**The floor plan is not decoration.** It is the only part of the sheet that proves the cuts
describe ONE space. A film whose camera positions cannot be drawn on a single plan is a film
whose room changes between shots — and drawing them is how you find that out for free, before the
render. If two cuts cannot both be marked on one plan, the plan is wrong, not the drawing.

**Every prop in the action must be in the plate and on the props list.** A hazard, a piece of
furniture, a thing that falls — if it is not in the room when the room is drawn empty, it appears
from nowhere, and an audience sees that instantly. Measured the hard way: a hall dresser written
into `world` and toppled in shot 2, while the plate had been drawn from an earlier `world` that
had no dresser in it. The object materialised.

**Corollary — the plate goes stale.** Change `world`, the location list or the props and the plate
is wrong until it is redrawn. Redraw it before anything is drawn FROM it, because everything else
on the sheet inherits its mistakes.

## 1. One plan is the source of truth

The plan is a single JSON object: title, palette, characters, products, environments, set notes,
props, cuts, lighting captions, moods, style essence, cinematography, soundscape, music. The sheet
renders it, the image prompts are built from it, the video brief is compiled from it, the director
chat rewrites it.

Nothing else may hold a description. The moment a cut frame is drawn from one blob of text while the
video prompt is written from another, the picture and the film stop describing the same shoot — and
that is exactly what "the images look right but the video doesn't match" means.

Every entity carries a stable `id`. Ids are what make cheap edits possible: a revision returns the
whole plan with the ids it kept, so you can diff and redraw only what actually changed.

→ `references/data-model.md` for the exact types, and why each field exists.
→ `references/planner.md` for the planner's system prompt, the JSON shape, and the forgiving
  normaliser (a slightly wrong sheet the user can edit beats a failed request).

## 2. The reference chain — this is why the images are correct

Panels are not drawn in parallel from text. They are drawn in **dependency order**, and each one is
sent the images it depends on, with a sentence telling the model how to use each:

1. **Identity first.** Character sheet (a six-panel turnaround grid on plain white: front,
   three-quarter, back, portrait, profile, wardrobe detail), product sheet (five panels: front,
   three-quarter, side, macro, in-context), environment plate (the set, empty, wide). Built from the
   user's uploaded photo when there is one.
2. **Everything else is drawn from those sheets.** A cut frame gets the character sheet + the product
   sheet + the set plate attached, not just a paragraph. The floor plan gets the set plate. The
   lighting stills get the plate and the hero sheet.
3. **The video generation gets the sheets too**, in the same identity-first order.

Each attachment is introduced by role, because a model handed four images with no instructions
averages them: *"Image 1 is the CHARACTER SHEET for GIRL: this is the same person; keep face, hair
and wardrobe identical."* / *"Image 3 is a STYLE reference: borrow its colours, lighting and mood
only — do not copy its people."*

That chain is the whole trick. Skip it and you get a beautiful, inconsistent sheet.

→ `references/panels.md` — every panel prompt verbatim, the role sentences, the draw order and the
  concurrency pool.

## 3. The sheet looks like a document, not a dashboard

Dark studio chrome around a **paper-white sheet**: `#f7f6f2` paper, near-black ink, thin `#cfcdc4`
rules, monospace section headers in caps with letter-spacing, Inter for body, an italic serif for the
mood words. Four sections, in the order a call sheet uses them:

- a **shared-choices strip** across the top: cut count, aspect, lighting note, lens note, palette
  swatches, environment fingerprint;
- **Section 1 — character / product reference** (the title flips to "PRODUCT / HERO OBJECT
  REFERENCE" when the plan has no cast);
- **Section 2 — environment / set design**: plates, the top-down floor plan with numbered camera
  markers and a legend, a side-elevation strip, set notes and props;
- **Section 3 — storyboard**: one card per cut, each with a big frame, a monospace spec line
  (`50mm anamorphic | f/2 | 4s | DOLLY-IN | WIDE`) and the caption;
- **Section 4 — lighting / mood / style**: four lighting stills, mood keywords, style essence,
  cinematography notes, sound and music.

Two rules people get wrong:

- **The images are big.** Every panel is a full-column box with a fixed `aspect-ratio` and
  `object-fit: cover` — 16:9 for frames and plates, 1:1 for character sheets, 3:4 for the elevation,
  4:3 for lighting. Never a thumbnail strip. The sheet is meant to be read at arm's length and
  exported as a poster-sized PNG.
- **Every word is editable in place**, and every picture has a hover "Recreate image" button. No
  modal, no edit mode: an input that looks like text until you hover it, committing on blur. The user
  is the director and the sheet is their working document.

→ `references/sheet-ui.md` for the section-by-section layout and the CSS that carries the look.

## 4. One generation — up to the model's window, and not beyond

**The boundary, stated once so nothing downstream has to guess it:**

| Total runtime | Shape |
|---|---|
| **≤ the model's window** (15 s for H3 and Seedance 2.0) | **ONE generation.** All the cuts go in one prompt as a `[Shot 1] … [Shot N]` block and the model cuts internally. |
| **longer** | **One generation per shot**, chained on `link` and stitched. |

Inside the window, one generation is strictly better and it is what this skill is for: there is
only one render, so there is nothing for identity to drift *between*. OpenArt Smart Shot is
exactly this — 5 cuts of 2–4 s inside a single 15 s render — and it is why its faces hold through
a wide-to-macro cut that would break a stitched film.

Past the window it stops being available. A 90-second film is a dozen generations however it is
prompted, and the sheet's job changes: it is no longer one brief but twelve, sharing the film-wide
fields verbatim. Continuity then belongs to `h3-scene-continuity`, and the plan must already carry
its constraints (`film-plan` Part 7): shots generated longer than their slot, chains capped at 2,
anchors every few shots.

Choose by runtime, say which you chose, and never treat per-shot rendering as a degraded version
of the single generation — they are two different films' worth of machinery.

**The single generation.** Its prompt contains a `[Shot 1] … [Shot N]` block per cut, and its
references are the character/product sheets, the set plate and the composed sheet PNG. That is
what keeps the cuts in one world. Per-cut rendering inside the window exists only as a retake of a
single beat.

Modern video models read a production brief, not a caption: subject definitions, a summary, a
retention analysis (what each attached image must keep — `fully_preserved` for faces and products,
`partially_preserved` for sets, `attribute_transfer` for style and storyboard frames), the detailed
description, the soundscape and the music. Camera moves are prose with an amplitude and a speed
("dollies in with medium amplitude at slow speed"), never bracket tokens.

Compile that deterministically from the plan. The user should never have to learn the model's prompt
format.

→ `references/video-brief.md` — the section format, attach order, retention rules and camera prose.

## 5. The director chat edits the plan, not the pixels

A chat beside the sheet: "make it night", "swap cut 2 and 3", "add a close-up of the baby laughing".
The model returns **the whole revised plan** with the ids of everything it kept, plus one sentence
saying what it changed. Then diff old against new and redraw only the stale panels — a changed
character stales its sheet *and* every cut frame it appears in; a changed set stales the plate, the
floor plan, the elevation and every cut shot there.

Telling the model "keep unchanged text byte-for-byte identical, because unchanged text means its
picture is not redrawn" is what makes revisions cost cents instead of dollars.

→ `references/director-chat.md` — the revise prompt and the staleness rules.

## Build order

Work in this order; each step is verifiable on its own.

1. **Types** (`data-model.md`) — plan, panels, takes, project. Bytes never live in the project:
   uploads are downscaled JPEG data URLs, generated images go to IndexedDB under a media id.
2. **Planner route** (`planner.md`) — one call, vision, JSON response format, forgiving normaliser,
   heuristic fallback so a missing key degrades to a locally-planned sheet instead of a 500.
3. **Panel prompts** (`panels.md`) — pure functions: plan in, prompt + aspect + refs out. Unit-test
   these; they are where quality lives.
4. **Panel route** — ONE image per request (a generated PNG is 1–2 MB of base64 and a serverless
   response caps around 4.5 MB); refs go in as `image_url` parts after the text.
5. **The sheet** (`sheet-ui.md`) — render the plan, wire the editables, wire per-panel redraw.
6. **Draw orchestration** — dependency order, a concurrency pool of ~4, and a re-plan that keeps
   already-drawn panels.
7. **Video brief + render** (`video-brief.md`), then **director chat** (`director-chat.md`).

## Failure modes, and what they mean

| Symptom | Cause |
|---|---|
| A different face in every frame | Cut frames drawn from text; the character sheet was never attached |
| Images look generic or stocky | The planner wasn't told to invent specifics — it must behave like a director, not a summariser |
| The video ignores the storyboard | Prompt written from the brief instead of compiled from the plan, or the sheet wasn't attached |
| The sheet feels like a dashboard | Card grid, small images, an edit modal. It is a document: paper, rules, caps headers, big frames, inline editing |
| Every tweak redraws everything | No stable ids, or the revision returns a rewritten plan instead of preserving unchanged text |
| A burst of panels 402s | Image calls outran the balance — pool them and retry once after ~6 s |
| No API key means a broken app | Draw a placeholder panel and plan heuristically; a degraded sheet still teaches the flow |

## Reference files

| File | Read it when |
|---|---|
| `references/data-model.md` | Defining the plan / panel / project types |
| `references/planner.md` | Writing the brief → plan call |
| `references/panels.md` | Writing any image prompt, or fixing inconsistent images |
| `references/sheet-ui.md` | Building or restyling the sheet |
| `references/video-brief.md` | Compiling the plan into a video generation |
| `references/director-chat.md` | Adding chat-driven revision and selective redraw |

The working implementation is `src/{components,lib,app/api}/smart-shot/` in the Ultimate Assistant OS
repo, and the same sheet ported into Jarvis Studio as `src/components/jarvis/StoryboardSheet.tsx`.
Read those when a detail here is ambiguous.
