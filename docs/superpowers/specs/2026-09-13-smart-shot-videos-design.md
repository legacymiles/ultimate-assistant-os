# Smart Shot Videos — design

Built 2026-09-13 from the user's brief: recreate OpenArt's "Smart Shot" flow inside
the hub. One prompt plus uploaded images becomes an **editable storyboard sheet**
(character reference sheet, environment / set design, top-down floor plan, cut
storyboard, lighting / mood / cinematography notes), and only after the plan is
approved is each cut rendered as video by **MiniMax H3** using H3-format prompts.

The design was decided autonomously (the user could not answer questions mid-task).
Assumptions are listed at the end.

## What the user sees

Route `/apps/smart-shot-videos`, catalog slug `smart-shot-videos`, category Video.
It replaces the "Video Forge" coming-soon tile, which promised exactly this.

Three stages, shown as a stepper at the top:

1. **Brief** — a prompt box, an upload tray (drag, click, paste, or an image URL),
   and settings: cut count (3–8), seconds per cut (4–10), aspect (16:9 / 9:16 / 1:1),
   look (live-action cinematic, anime, 3D animation, commercial, documentary).
   Every uploaded image is tagged with a role: **Character**, **Location**,
   **Product / Object**, or **Style**. Characters get a name.
2. **Storyboard** — one tall sheet in the OpenArt layout:
   - SHARED CHOICES strip: cut count, colour palette swatches, environment fingerprint.
   - SECTION 1 CHARACTER REFERENCE: one panel per character — a generated
     turnaround / expression sheet made FROM the uploaded photo, a palette row, and
     editable name / look / wardrobe text.
   - SECTION 2 ENVIRONMENT / SET DESIGN: one plate per location, plus a generated
     TOP-DOWN FLOOR PLAN showing numbered cut positions and a side-elevation panel.
   - SECTION 3 STORYBOARD: one frame per cut, captioned `40mm anamorphic | 6s |
     HANDHELD | WIDE.` plus the beat description. Cuts can be edited, re-drawn,
     reordered, added and deleted.
   - SECTION 4 LIGHTING / MOOD / STYLE NOTES: four lighting reference strips,
     mood / theme words, cinematography notes.
   Every text is editable in place; every image has "Redraw". The sheet is
   downloadable as a single PNG (drawn on a canvas from the panels).
3. **Video** — each cut shows its H3 prompt (read-only view with an "edit" toggle),
   a Generate button, progress, and the finished clip. "Generate all" runs the cuts
   in order. A "Play film" player plays the clips back to back. Clips download
   individually.

## Architecture

```
src/lib/smart-shot/
  types.ts          Project, Upload, Plan (characters, environments, cuts, notes), Panel, Take
  constants.ts      cut counts, looks, aspect → image aspect, lens list
  plan/schema.ts    the JSON the planner returns + parse/normalise (pure)
  plan/heuristic.ts offline plan when no LLM key (pure)
  plan/prompt.ts    planner system prompt (pure)
  panels.ts         image prompts for each panel kind (pure)
  h3prompt.ts       plan + cut → H3 brief in reference mode (pure, tested)
  repo.ts           localStorage project store (client)
  media.ts          IndexedDB blobs (client)
  client.ts         fetch wrappers (client)
src/app/api/smart-shot/
  plan/route.ts     POST brief + images → Plan (LLM with vision, heuristic fallback)
  panel/route.ts    POST one panel spec → one image (Gemini via OpenRouter; placeholder offline)
src/components/smart-shot/
  SmartShot.tsx, Brief.tsx, Sheet.tsx (+ sections), VideoStage.tsx, smart-shot.css
src/app/apps/smart-shot-videos/page.tsx
```

Video generation reuses `POST /api/auteur/generate` unchanged: it already picks
the user's RunPod H3, MiniMax hosted, the AI Gateway, or a placeholder, and
accepts labelled reference images as data URLs.

### Data flow

Brief → `/api/smart-shot/plan` (prompt + downscaled uploads as vision input) →
`Plan` JSON → the client fires one `/api/smart-shot/panel` request per panel
(character sheets, environment plates, floor plan, cut frames, lighting strips),
each carrying the relevant uploads and, for cut frames, the already-generated
character sheet so faces match → images stored in IndexedDB, ids on the plan →
user edits → per cut `composeH3Prompt(plan, cut)` → `/api/auteur/generate`
with references `[character sheets…, environment plate, cut frame]` labelled
`Subject N` in that order → poll → clip stored in IndexedDB.

### The H3 prompt (the part the user cared about most)

Reference mode, six sections, exactly as Auteur established from MiniMax docs:

```
subject_definitions:
<Subject 1> is GIRL: … Retention: fully_preserved.
<Subject 2> is the location COASTAL ROAD: … Retention: partially_preserved.
<Subject 3> is the storyboard frame for this cut: composition, framing and light to match. Retention: attribute_transfer.
summary: [reference generation] Cut 3 — recognition begins…
retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - identity, face, hair and wardrobe retained.
…
detailed_description: [Shot 1] Live-action, cinematic, 2.39:1 anamorphic… <close-up on a 100mm lens frames GIRL (<Subject 1>) …> Lighting: … The camera pushes in with small amplitude at slow speed toward GIRL. … No subtitles, no on-screen text.
overall_soundscape: …
non_diegetic_music: …
```

Camera moves are prose with amplitude + speed (never `[Push in]` brackets).
Dialogue, if a cut has any, is `(S1) Name says: <d>[English] …</d>`.

### Offline behaviour

No LLM key → heuristic plan from the prompt (splits it into beats, names
characters from uploads). No image key → SVG placeholder panels. No video key →
Auteur's animatic placeholder. The whole flow is walkable with nothing configured.

### Storage

Project JSON in localStorage `smart-shot:v1` (one list of projects, most recent
first). Image and clip bytes in IndexedDB `smart-shot-media`. Not synced across
devices (same as Image Studio); the uploads are kept as downscaled JPEG data URLs
inside the project so a reload can still redraw panels.

### Testing

Vitest: `h3prompt.test.ts` (section order, labels match attach order, camera
prose, dialogue tag, limits), `schema.test.ts` (parsing a messy LLM answer,
heuristic plan shape). UI verified in the preview browser.

## Assumptions made without the user

- "My H3" = whatever `/api/auteur/generate` resolves to (RunPod endpoint first).
- One image per panel request (Vercel 4.5 MB response limit, as in Image Studio).
- Character sheets are drawn by the image model from the uploaded photo rather
  than by compositing crops; that is what OpenArt does and it gives a turnaround.
- The floor plan is an image-model drawing (a labelled top-down diagram), not a
  hand-drawn SVG. It is editable only by redrawing with edited cut text.
- Clips are played back to back in the browser; there is no server-side stitch.

## Revision after watching the actual video (2026-09-13, video-analyzer skill)

Gemini watched the OpenArt Smart Shot demo (youtube UUXw6u6louA). What it showed, and
what changed to match it:

| In the video | In the app |
|---|---|
| "Describe your scene" + "Add references (Optional)" split into *Characters & Objects* and *Environment* | Three drop zones (Characters & objects, Environment, Style) plus a link field |
| "Shoot Quality" Medium / High, format line `16:9 \| 480p \| 15s` | Quality Medium = 768P, High = 2K; length 6 / 10 / 15 s; same format line and a cost estimate |
| Two buttons: "Preview Shot Plan" and "Create Video" | Same two buttons; Create video = plan → draw → render in one go |
| SECTION 1 PRODUCT / HERO OBJECT REFERENCE: 5 views (front, ¾, side/edge, macro, in-context) + PALETTE + TEXTURE / FINISH / … notes | Product sheet panel + palette + editable notes list; character sheet when the subject is a person |
| SECTION 2 SET REFERENCE + FLOOR PLAN (TOP-DOWN) with camera marks + SET NOTES + PROPS | Set plates, floor plan, side elevation, editable set notes and props |
| Cut captions `50mm anamorphic \| f/2 \| DOLLY-IN \| WIDE` | Cuts carry an aperture; moves gained dolly-in, arc, rack-focus; framing gained macro |
| SECTION 4: four lighting panels + MOOD KEYWORDS + STYLE ESSENCE + CINEMATOGRAPHY NOTES | Style essence added; cinematography is a bullet list |
| Header ribbon: ASPECT RATIO / LIGHTING / LENS / PALETTE | Shared-choices strip shows the same four plus the environment fingerprint |
| **One 15-second generation** of all cuts from one compiled, editable prompt, with the whole sheet image attached as the reference | `composeFullH3Prompt` writes a `[Shot N]` block per cut in one H3 brief; `sheetImage.ts` composes the sheet on a canvas, attaches it as a reference and offers it for download |
| Image tools on the sheet: "Recreate image" | Every panel has Recreate image |
| "Recreate video" | Recreate video on the film; per-cut retakes below it |

Not replicated on purpose: Upscale, Expand image, Inpaint, Image Variations, Check IP
Safety, Grab a frame, Modify Video (OpenArt's general image/video tools, not part of the
Smart Shot flow). Pricing seen in the video: ~$0.09 per shot plan on the Wonder annual
plan; 150 credits to preview, 3150 to render at High.
