---
name: smart-shot-videos-app
description: "Smart Shot Videos at /apps/smart-shot-videos — OpenArt \"Smart Shot\" clone verified against the actual video: prompt + refs → editable shot-plan sheet (product/character sheet, set plates, floor plan, cuts, lighting) → ONE 15 s MiniMax H3 generation with the sheet attached, per-cut retakes"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9caf07ff-9627-4905-b308-901b26d0cf1f
  modified: 2026-09-14T01:55:28.231Z
---

Built 2026-09-13; re-verified the same day against the real OpenArt video
(youtube UUXw6u6louA, watched with the video-analyzer skill). Replaced the "Video
Forge" coming-soon tile. Spec: `docs/superpowers/specs/2026-09-13-smart-shot-videos-design.md`.

Code: `src/lib/smart-shot/` (types, constants, plan/{schema,heuristic,prompt}, panels,
h3prompt, sheetImage, placeholder, media, repo, client), routes `src/app/api/smart-shot/{plan,panel}`,
UI `src/components/smart-shot/` (studio.tsx = all state via commit(), Brief, Sheet,
VideoStage, smart-shot.css). Tests: `npx vitest run src/lib/smart-shot` (16).

**What the real Smart Shot does (from the video) and how the app matches it:**
- Inputs: "Describe your scene", "Add references (Optional)" split into Characters & Objects /
  Environment, "Shoot Quality" Medium (480p) / High (1080p), format line "16:9 | 480p | 15s",
  two buttons "Preview Shot Plan" and "Create Video". → Brief has the same two buttons,
  three drop zones, Medium=768P / High=2K, length 6/10/15 s, cost estimate line.
- The sheet: SECTION 1 PRODUCT / HERO OBJECT REFERENCE (5 views: front, ¾, side, macro,
  in-context + PALETTE + TEXTURE/FINISH/… notes) or CHARACTER REFERENCE; SECTION 2 SET
  REFERENCE + FLOOR PLAN (TOP-DOWN) with camera marks + SET NOTES + PROPS; SECTION 3 cuts
  captioned `50mm anamorphic | f/2 | DOLLY-IN | WIDE`; SECTION 4 four lighting panels +
  MOOD KEYWORDS + STYLE ESSENCE + CINEMATOGRAPHY NOTES. Header ribbon: aspect, lighting,
  lens, palette. → all present and editable in place; every panel has Recreate image.
- **The video is ONE 15-second generation** from one compiled, editable prompt, with the
  whole shot-plan sheet image attached as the reference. → `composeFullH3Prompt` writes a
  `[Shot N]` block per cut inside one detailed_description; `sheetImage.ts` composes the
  sheet on a canvas (also downloadable) and it is attached as `<Subject N> is the shot plan
  sheet`. Per-cut retakes (min 4 s) remain below it.
- OpenArt pricing seen: ~$0.09 per shot plan on the Wonder annual plan; 150 credits preview,
  3150 credits video at High. Its video model is not named.

Load-bearing decisions:
- Video reuses `POST /api/auteur/generate` unchanged (RunPod → MiniMax → gateway → placeholder).
- Planner = hub provider (Claude via OpenRouter) with vision on uploads; forgiving normaliser
  pads/trims cuts and rescales durations to the film length. Heuristic plan with no key.
- Panels = one Gemini image per request, drawn in a pool of 4 (a burst tripped OpenRouter's
  in-flight credit 402 on a low balance; one retry after 6 s). Draw order: character/product
  sheets + set plates first, then floor plan/elevation/cut frames FROM them, lighting last.
- Storage: localStorage `smart-shot:v1`, IndexedDB `smart-shot-media` (panels, sheet, clips).
- Verified live: girl-on-bicycle plan + 13 panels, one per-cut H3 clip on RunPod (1344×768,
  5.9 s, ~4 min incl. cold start); chocolate-bar plan produced NOIRÉ product sheet with 5 notes.
- OpenRouter ran dry mid-verification on 2026-09-13 (402 "in-flight credits"); the user added
  $5 the same day (total $10). Each panel ≈ $0.04, a plan ≈ $0.10, a full sheet (~12 panels)
  ≈ $0.60. Chocolate-bar project then completed: product sheet (5 views) + all lighting panels.
  One lighting panel once came back with "no image" — a second Draw fixed it (model flake).

**2026-09-18 flow change (owner's ask):** page 1 brief → page 2 storyboard with a docked
AI DIRECTOR chat (`DirectorChat.tsx`, `/api/smart-shot/revise`, `plan/revise.ts`: model returns
the whole plan keeping ids; `stalePanels` redraws only changed panels) + a bottom bar "Edit with
AI" / "Create video" (startVideo = go to page 3 AND render) → page 3 is just player + Download
MP4 (H3 prompt + per-cut retakes folded under "Advanced"). Storyboard image model =
google/gemini-3.1-flash-image (SMART_SHOT_IMAGE_MODEL overrides). H3 "optimisation" = Claude
planner expands the one-line brief, then h3prompt.ts compiles it deterministically.
Tests: 21 (`revise.test.ts` added).

Related: [[auteur-app]], [[image-studio-app]], [[hub-ai-provider]], [[video-analyzer-skill]]
