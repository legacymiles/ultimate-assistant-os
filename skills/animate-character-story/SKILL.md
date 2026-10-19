---
name: animate-character-story
description: Turn a character the owner gives you (an uploaded image, or a description) plus a story idea into a short animated storytelling video, made entirely in code with the cth9191/animate kit (cut paper by default), rendered to MP4 on this machine. Use when the owner says "animate my character", "make a story video of this boy/girl/character", "animate this image", "character story video", "story animation", or sends a job from Jarvis › Studio › Kids flow (Kids Animation Flow) or the "Animate my character" card / In Queue folder. Nicknames - animate my character, character animator, story animator, cut paper story, animate skill.
---

# Animate my character

You are a small animation studio in one person: a story editor, a cut-paper character designer and a
procedural animator. You take ONE character the owner hands you and a story idea, and you deliver a
finished 16:9 MP4 with a composed score and short hand-lettered captions. The look comes from the
`animate` kit (github.com/cth9191/animate): every frame is drawn in code on one canvas, deterministic,
rendered with headless Chromium and ffmpeg. No footage, no image model, no paid API.

Craft line: **the character is the constant — everything else may change, he may not.** Same face,
same hair, same colours, same proportions in every shot, or the story falls apart.

The owner wants everything as simple as possible for them. Handle setup yourself, pick sensible
defaults, and only ask what you truly cannot infer. Status: not yet tested end to end on the owner's PC
— the first real run is the test; record what happened at the bottom of this file afterwards.

## Inputs

| Input | Where it comes from | Default when missing |
|---|---|---|
| The character | an image the owner attached, an image on a Jarvis queue request, or a description | ask for one image (the only thing worth asking for) |
| The story | one line from the owner, or a queue request's text | "The lost kite": his kite blows away, he follows it through town, a forest and up a hill, and catches it at sunset |
| Mode | owner's choice | **Rebuild** (see below) |
| Shape and length | owner's choice | 16:9, about 45 s |
| Words | owner's choice | music + short hand-lettered captions, no voice |
| Look | owner's choice | cut paper |

### The two modes

1. **Rebuild (default, best motion).** Study the image and redraw the character in the chosen style
   with the kit's drawing functions: his head shape, skin tone, hair shape and colour, eye style,
   clothes and their colours and patterns, shoes, any signature item (a cap, a backpack, glasses). He
   then walks, blinks, talks, waves, jumps and changes expression. He looks like their character made
   of paper, not a pixel copy.
2. **Puppet (exact art, simpler motion).** Use the owner's own picture as an asset. Cut it into
   parts (head, torso, each arm, each leg) and animate the parts like a paper puppet: bob, sway, arm
   and leg swings on pivots, a head tilt, a blink and mouth drawn on top. Best with a full-body drawing
   on a plain background, facing forward or side-on. Only the owner's own art, or art they have the
   rights to.

If the image is a photo of a real person rather than a drawn character, rebuild them as a stylised
cut-paper character; never puppet a photo of a real person who has not agreed to it, and never a
minor's photo.

## Step 0 — Setup (do it yourself, silently)

1. Find the kit. Look in this order and use the first that has `SKILL.md`:
   - `~/.claude/skills/animate/`
   - `~/.claude/plugins/**/animate/skills/animate/`
   - `~/tools/animate/plugins/animate/skills/animate/`
   If none: `git clone https://github.com/cth9191/animate ~/tools/animate`. Set `SKILL` to that
   folder. Read its `SKILL.md`, `craft.md`, `intake.md`, `grammar/FORMATS.md`, `grammar/STORY.md`,
   `grammar/FRAME.md` and the chosen style's `STYLE.md` before writing anything.
2. Requirements: Node 18+, Playwright with Chromium, ffmpeg on PATH.
   - Check: `node -v`, `ffmpeg -version`, `npx playwright --version`.
   - Missing Playwright: `npm i -g playwright` then `npx playwright install chromium`.
   - Missing ffmpeg on Windows: `winget install --id Gyan.FFmpeg -e` (then open a new shell). On
     Linux: `sudo apt-get install -y ffmpeg`.
   - The owner's PC and VPS run Windows: use PowerShell syntax there (`$env:SKILL = "..."`), not bash.
3. Work folder: `~/Videos/animate/pieces/<slug>/` (create it). Pieces never go inside the hub repo.

## Step 1 — Read the character into a character sheet

Look at the image and write a character sheet in the piece's `brief.md`:

- name (from the owner, or a placeholder they can change, e.g. "Milo")
- proportions: head-to-body ratio (kids read best at about 1:3), height in the 1080-tall frame
  (~420 px standing in a wide shot)
- head: shape, skin colour as a hex sampled from the image, ear size
- hair: silhouette in one sentence, colour hex, fringe direction
- eyes and brows: dots / ovals / with highlights; brow thickness
- clothes, top to bottom: garment, colour hex, pattern (stripes, dots, gingham), sleeve length
- shoes and one signature item
- the colour that means him for the whole film (craft rule: colour means one thing) — usually his
  shirt colour. If it is orange, it replaces the kit's spark orange as the hero colour, and the spark
  is not used.

Sample colours with code, not by eye: `node -e` with `sharp` (or Python Pillow) reading the image and
printing the dominant colours of the hair, skin and shirt regions.

## Step 2 — The story check

Pick the format yourself (intake.md says so): a boy who wants something and goes somewhere to get it
is **F5 fixed-hero journey** (proven several times) — he is the one constant, the worlds change
around him, cut on the beat at 120 BPM. A quieter bedtime tale can be **F2 morph chain** (one world
closes into an object that opens the next). Say which and why in one line.

Write a numbered beat table (time · what happens · his expression · the caption · the bridge or cut
into the next beat · the sound's role). For ~45 s that is 8–11 beats:

1. Open on him in his world, happy, with the thing he loves (flash-forward optional: the ending image).
2. The problem arrives (the kite string snaps).
3–7. One place per beat, each with its own wall colour and one obstacle he solves himself.
8. The busiest beat (the rush), then **silence on a held image** (0.5–2 s, he reaches…).
9. The payoff on the **loudest hit** (he catches it).
10. The end is the start, changed (back home at sunset, the kite now mended with a patch).

Captions: ≤ 6 words, ≥ 1.25 s each, ≤ 3.5 words/s, on paper tags (`capStrip`, `tag`), inside the safe
area. Kid-friendly words. No scary imagery.

When the owner is watching, show the table and ask approve / change (one AskUserQuestion, recommended
option first). When running unattended (from the queue), take the best reading, write it in
`brief.md`, and carry on.

## Step 3 — Build him

Start the piece from the style demo: copy `$SKILL/styles/cut-paper/demo/piece.json` and `src/` into
the piece folder. Then set `piece.json`:

```json
{ "name": "<slug>", "title": "<Story title>", "style": "cut-paper",
  "format": { "width": 1920, "height": 1080, "fps": 24, "bpm": 120, "duration": 45.0, "frames": 1080 },
  "formats": ["16:9"], "storyFormat": "F5 fixed-hero journey" }
```

Lay scenes out with `LX` / `LY` / `UNIT` so the 16:9 frame is composed for wide, not cropped.

### Rebuild mode

Write ONE function for the character in `src/hero.js` (listed first in `piece.json` `"scenes"`), with
every pose as a parameter rather than a separate drawing, so he cannot drift between shots:

```js
// boy(x, y, s, { mood, walk, wave, look, talk, key })
//   mood: 'smile' | 'wow' | 'sad' | 'focus' | 'delight'
//   walk: phase 0..1 (legs and arms swing opposite), wave: 0..1, look: -1..1 head turn
//   talk: mouth open 0..1 on 2s, key: seed for the paper tear
```

Build him from the kit: `cut()` torn-paper shapes for head, hair, torso, sleeves, legs and shoes;
`pat.stripes` / `pat.dots` for clothing patterns; `face(x, y, s, mood)` for the face (or your own
eyes/brows/mouth if his eye style differs); `hand()` for hands. Idle life is free and required: a
blink every 2–4 s on a seeded schedule, a 2-frame breath bob, hair that sways on the boil.

Test him before any scene: render a turnaround tile of every mood and pose with
`node $SKILL/tools/tile.mjs pieces/<slug> hero.png <frames…>` and compare it side by side with the
owner's image (`node $SKILL/tools/compare.mjs <image> pieces/<slug> <t> compare.png --auto-trim`).
Fix proportions and colours until a stranger would say "same kid".

### Puppet mode

1. Put the owner's image in `pieces/<slug>/assets/`.
2. Cut it into parts with code (sharp or Pillow): head, torso, upper/lower arms, legs. Save each as a
   transparent PNG in `assets/` with its pivot (neck, shoulder, hip, knee) written in `src/rig.js` as
   pixel coordinates. If the background is not plain, key it out first; if the parts cannot be
   separated cleanly (overlapping limbs), say so and switch to Rebuild mode.
3. Draw each part with `drawAsset(name, x, y, w, h)` inside `ctx.save()/translate/rotate` about its
   pivot. Motion: walk cycle as ±18° leg and ±14° arm swings on 2s, head tilt ±6°, a body bob.
   Blink and mouth are drawn on top in code at measured eye/mouth positions.
4. Frame him in the style (a torn-paper cut-out border and a drop shadow) so he belongs to the world.

## Step 4 — Scenes, score, render

Follow the kit's flow exactly (its SKILL.md → Build): scenes in `src/scenes.js` (or one file per
beat for a long piece), cameras with `camOf`, hard cuts on the 8th grid for F5, captions as paper
tags, 3+ details of background life per frame (birds on a wire, a cat, bunting, clouds, a dog).

- Build: `node $SKILL/tools/build.mjs pieces/<slug>`
- Tile while building and LOOK at the tiles, across every cut.
- Score in `src/score.js`: thin at the start, fullest at the rush, a hard stop for the silence,
  the loudest hit on the payoff (chord stab + sub), a flat chord after. His motif: a rising fifth.
- Export: `node $SKILL/tools/export.mjs pieces/<slug> --share --formats 16:9`
- Review: `node $SKILL/tools/review.mjs pieces/<slug> --format 16:9`. Fix until it passes. Read
  `review/phone.jpg`. Trust the TEXT check over your eye.

## Step 5 — Deliver

- The file: `pieces/<slug>/renders/share.mp4` (and `final.mp4`).
- Tell the owner in a few plain lines: what it is, the review numbers (cuts on grid, loudest moment,
  silence before it, LUFS), what the review caught and fixed, the weakest shot, and that you cannot
  hear the score so they should listen.
- If a Jarvis Studio or queue request started this, copy the MP4 to `~/Videos/animate/out/<slug>.mp4`,
  send it back with `queue_video_link` (below), and say that path.

## When the job came from Jarvis In Queue

Queue requests arrive through the jarvis-memory connector (`queue_list`). A request for this skill
sits in the folder `flow:animate-my-character` and carries the brief, the character sheet and maybe
image links.

1. `queue_list` → pick the request; `queue_start` with its id so the owner sees "working on it".
2. Download each image link it lists (the line says how, with the same bearer token as the
   connector) into `pieces/<slug>/assets/`.
3. Do Steps 0–5 unattended: take the best reading, write it at the top of `brief.md`.
4. Only when `share.mp4` exists and review passed, send the video back so the owner can watch it in
   Jarvis › Studio › Kids flow on any device: call `queue_video_link` with the id and run the one
   command it returns (a PUT to a one-time link on the deployed hub; a token-authorised POST on a
   local hub). Then `queue_complete` with the id, `video: true` and a one-line result ("Rendered
   46 s, 16:9. Review: 11/11 cuts on grid, payoff −1 dB, silence −52 dB."). That removes it from the
   queue and the film appears in the Watch stage. If the upload fails, still complete it without
   `video`, and say in the result where the file is on the PC.
5. If anything failed before that, do NOT complete it — `queue_note` the reason in plain English
   instead, so it stays in the queue and the owner sees why on the Render stage.
6. A request that starts "Changes to "<title>" (q-…)" is a revision: reopen that piece's folder in
   `~/Videos/animate/pieces/`, make only the asked changes, re-render, and upload as above.

## Global constraints

- The character never changes design between shots. One function, one palette, one size rule.
- Kid-safe by default: no scary imagery, no peril beyond "the kite got away".
- Single file, all code, deterministic: seeded `RNG`, never `Math.random()` or the clock (the kit's
  build enforces it). The owner's image is the only asset, and only in Puppet mode.
- Never use someone else's copyrighted character (a cartoon mascot, a game hero) as the hero, in either
  mode — if the image is one, say so once and offer an original character in the same spirit.
- Never claim it is done without `review.mjs` passing and you having looked at the contact sheets.
- Reference media stays on the machine; the only upload is the finished MP4, back to the owner's own
  Jarvis through `queue_video_link`.
- Plain English to the owner. No stack traces; say what failed and the one thing to do about it.

## Run log

- (first run goes here: date, piece, mode, what broke, what you fixed)
