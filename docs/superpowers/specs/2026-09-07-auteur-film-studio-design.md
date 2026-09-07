# Auteur — AI film studio for MiniMax H3 — design

**Date:** 2026-09-07
**Route:** `/apps/auteur`
**Category:** Video

## What it is

An AI filmmaking studio, not an H3 prompt box. You type an idea in plain
language ("a cinematic romantic short about a couple who meet in New York"),
pick a template (what kind of film) and a genre (what it feels like), hand it
whatever references you have, and an AI Director turns that into a real
production: concept, characters, worlds, visual style, scenes, a shot list, a
storyboard, one structured H3 prompt per shot, generation, retakes, and a cut
on a timeline.

The user never has to learn H3 prompting. Advanced users can open any shot and
read or edit the exact prompt that will be sent.

## How it fits the existing hub

Auteur is a new hub app, not a rewrite of anything. It reuses what the hub
already does well and borrows the best of Seedance Studio without touching it:

- **Catalog entry** in `src/lib/catalog.ts` (category Video), page at
  `src/app/apps/auteur/page.tsx`, components under `src/components/auteur/`,
  logic under `src/lib/auteur/`, routes under `src/app/api/auteur/`.
- **Persistence** follows the local-first pattern: project structure in
  localStorage under one key via `saveSynced`, pulled at mount with
  `useRemotePull`, so projects follow the signed-in user across devices.
  Seedance kept media session-only; Auteur keeps reference and generated media
  in **IndexedDB** so a project survives a reload, which a film has to.
- **AI access** follows the blueprint/std-safe pattern: every director stage
  calls the Vercel AI Gateway chat endpoint when `AI_GATEWAY_API_KEY` is set
  and falls back to a built-in heuristic planner when it is not. Nothing dead-ends
  offline.
- **Video generation** goes straight to MiniMax's video API with
  `MINIMAX_API_KEY` (create task → poll → retrieve file). Without a key the
  studio renders an animatic placeholder so the whole workflow is usable and
  demoable.
- **Timeline** takes Seedance's timestamp-based playhead idea and applies it
  to a shot sequence plus an audio track.

## Core loop (the thing to get right first)

```
IDEA  →  REFERENCES  →  AI DIRECTOR  →  STORYBOARD  →  SHOTS
      →  H3 PROMPTS  →  GENERATE  →  RETAKE  →  FINAL VIDEO
```

## Vocabulary

**Template** = the kind of film. Short Film, Music Video, Commercial, Product
Ad, UGC Ad, Movie Trailer, Social Media Video, Fashion Film, Documentary,
Cinematic Scene, Horror Short, Explainer, Lyric Video, Travel Film. Each
template carries production defaults: target length, shot count range, pacing,
aspect ratio, structure beats (e.g. a trailer = hook / escalation / title card).

**Genre** = the feel. Comedy, Drama, Romance, Horror, Action, Thriller,
Sci-Fi, Fantasy, Crime, Mystery, Emotional, Musical, Adventure, Noir,
Coming-of-age. Each genre carries tone, palette, lighting and camera
tendencies. Templates and genres combine freely (Music Video + Romance,
Commercial + Comedy, Short Film + Horror).

## Model

```
Project      id, title, idea, templateId, genreIds[], aspectRatio, targetDurationSec,
             status: draft | developed | boarded, concept?, characters[], worlds[],
             style?, scenes[], references[], audio?, createdAt, updatedAt
Concept      logline, synopsis, theme, tone, structure[] (beat titles)
Character    id, name, role, description (appearance, wardrobe, age, defining
             traits), voice/manner, referenceIds[]
World        id, name, description (environment, time of day, weather, key
             props), referenceIds[]
Style        lookName, palette, lighting, lens/camera language, grade, pacing,
             referenceIds[]
Scene        id, order, title, summary, worldId, characterIds[], timeOfDay,
             mood, shots[]
Shot         id, order, title, description, action, camera {angle, movement,
             framing, lens}, lighting, characterIds[], worldId, durationSec,
             referenceIds[], continuity (what carries in from the previous shot),
             prompt (H3Prompt), promptEdited (bool), takes[] (ShotTake),
             activeTakeId
H3Prompt     text (final string), cameraCommands[] (bracket syntax), notes
ShotTake     id, createdAt, prompt, status: queued | generating | done | error,
             engine: minimax | placeholder, taskId?, mediaId?, posterHue,
             retakeNote?, error?
Reference    id, kind: image | video | audio | character | location | object |
             style, name, mime, mediaId (IndexedDB), scope: {level: project |
             scene | shot, id?}, description (AI-read or user-typed), tags[]
```

References are first-class: a reference is understood (a vision pass writes a
description into it) and then *used*: the director folds its description into
every prompt in its scope, and image references become H3 first-frame or
subject references at generation time.

### Reference scope

A reference is attached at exactly one level. Project-level references apply to
every shot; scene-level to that scene's shots; shot-level to one shot. When a
shot is generated, the effective reference set is the union of the three, with
shot-level winning conflicts (a single first frame, a single subject image).

## AI Director

Four stages, each a route action with an LLM path and a heuristic path:

1. **develop** — idea + template + genre + reference descriptions → Concept,
   Characters, Worlds, Style. The heuristic version extracts named characters,
   places, and nouns from the idea, and fills the rest from template and genre
   defaults.
2. **breakdown** — the developed project → Scenes with Shots. Shot count and
   durations come from the template's target length. Every shot gets camera,
   lighting, action, continuity notes.
3. **prompt** — one shot → an H3 prompt. Built deterministically by
   `composeH3Prompt` (subject, action, environment, camera commands, lighting,
   style, continuity) and optionally polished by the LLM. The composed prompt
   is always available, so the LLM only ever improves it.
4. **retake** — a shot + a plain-language instruction ("closer", "darker",
   "change her outfit", "make him angry, keep everything else") → a patch on the
   shot's structured fields. The heuristic path maps common verbs to fields;
   the LLM path returns a JSON patch. Only the patched fields change; the rest
   of the project is untouched. A retake creates a new take, never destroys
   the old one.

A fifth stage, **describe**, reads an uploaded image with the vision model and
writes what it sees into the reference (subject, wardrobe, setting, palette,
mood) so the director can use it even when the video model cannot see it.

The director carries continuity: each shot's prompt restates the character's
wardrobe and the world's lighting and time of day, and the breakdown writes a
`continuity` line per shot describing what must match the previous one.

## Generation

`/api/auteur/generate` with actions `create`, `status`, `file`.

- `create` sends the shot's prompt to MiniMax video generation with the
  effective references (first-frame image, subject reference), duration and
  resolution, and returns a task id.
- `status` polls the task; the client polls every few seconds.
- `file` proxies the finished video bytes so the browser can store them in
  IndexedDB without hitting cross-origin download rules.

With no `MINIMAX_API_KEY`, `create` returns a placeholder take after a short
simulated wait; the storyboard and timeline render an animatic card for it.

## Screens

**Home** (what a first-time visitor sees): a left sidebar (Home, Projects,
Characters & Worlds, Assets), a hero composer ("What are we making today?")
with template and genre selection, reference drop zone, aspect and length; a
row of template cards; recent project cards with poster, template, genre and
progress.

**Project workspace**: a top bar (title, template + genre chips, aspect,
progress, Generate all), a left rail switching Director / Storyboard /
Timeline / Assets, and a right inspector.

- **Director** shows the plan: concept, characters, worlds, style. All
  editable. "Develop" and "Break down" buttons run the stages.
- **Storyboard** groups shot cards by scene. A card shows number, preview or
  animatic, duration, description, camera line, reference chips, status.
  Cards reorder by drag, and can be edited, duplicated, deleted, regenerated,
  and given alternate takes.
- **Shot inspector** shows everything about the selected shot, the H3 prompt
  (read-only until "Edit prompt"), shot-level references, the retake box, and
  the list of takes with the active one selected.
- **Timeline** lays the active takes in order with the audio track above,
  a scrubbing playhead, and playback across clips.
- **Assets** is the reference library: upload, set kind and scope, read the
  AI description, attach to characters or worlds.

## Design

Dark, cinematic, its own identity: near-black stage with a warm projector-gold
accent, monospace HUD labels for shot numbers and camera data, letterboxed
previews, film-strip storyboard rows. Not a clone of OpenArt; the same level of
polish and the same "this is a film studio" first impression.

## Out of scope for the foundation

Multiple video models, audio generation, exporting a rendered final file,
collaboration. The timeline plays the takes back in sequence; a real render is
a later step.

## Testing

The heuristic director, prompt composer and retake interpreter are pure
functions and get unit tests run with `node --test` over compiled TypeScript.
The UI is verified in the browser on a preview dev server.
