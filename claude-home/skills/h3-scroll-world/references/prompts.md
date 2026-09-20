# Prompt templates & intake

Everything here is fill-in-the-slots. Keep the **style preamble** byte-for-byte identical
across all scene stills — that identical text is what makes the world feel like one place.
Every video prompt is a **MiniMax H3 production brief** (format below), never a
Hailuo-style bracket-tag prompt.

## Intake checklist (Step 1)

Collect and write down:

- `SUBJECT` — the business + one-line pitch.
- `BRAND_NAME` — display name.
- `PALETTE` — 4–6 named hexes, e.g. `taro #9B7EBD, cream #F5EDE0, caramel #C88A5A, matcha #8FB98A, plum #3A2E48`. Pick ONE as the scene **background** colour (usually the lightest) and one as the primary **accent**.
- `TONE` — a word or two (cozy/premium, playful, industrial…).
- `STYLE` — the art direction (default below).
- `SECTIONS[]` — ordered list; for each: `id`, `label`, `subject` (what's in the diorama), `eyebrow`, `title`, `body` (≤ 1 sentence), `tags[]` (0–3). Last section = hero product + CTA.
- `CAMERA` — walkthrough (arch A: one continuous forward flight — the DEFAULT, works on
  every H3 backend) | locked-iso (arch A + the locked-iso clause below: one fixed angle
  for the whole film) | fly-through (arch B: dives + aerial hops — needs the MiniMax
  hosted backend for its connectors). **Always asked** (SKILL Step 1.4), presented by
  feel with a one-line trade-off each.
- `MOBILE` — yes/no. **Always asked** (SKILL Step 1.6), presented with the ~2× clip
  count and cost stated. Yes = the **native 9:16 portrait chain** (pipeline §6b):
  portrait renders of every leg/dive/connector + `clipMobile`/`connectorsMobile`/
  `stillMobile` wiring + the full mobile QA. The §6 crop encodes are a stopgap only.
- `TIER` — draft (768P, 6 s legs, 4–5 s connectors) | final (2K only where the backend
  confirmed it — otherwise 768P — with 8–10 s legs, 5–6 s connectors). Chosen at SKILL
  Step 1.7 with the estimated total stated before anything renders.
- `BACKEND` — `runpod` (default, the owner's own H3; first_frame only) | `minimax`
  (hosted; first + last frame; required for arch B) | `gateway` (Vercel AI Gateway).
  Whatever `node scripts/h3.mjs --check` reports as configured.

## H3 prompting — the production-brief format

MiniMax H3 does **not** read Hailuo-era `[Push in]` / `[Pan left]` bracket camera tags.
It reads a short *production brief* with labelled sections. Every clip in this skill
(legs, dives, connectors) uses **keyframe mode** — a first frame (and, on the MiniMax
hosted backend only, a last frame) — so every clip brief has exactly these three
sections, in this order:

```
integrated_multimodal_description: [Shot 1] <style>, <framing>. <prose: what is in
frame and what happens>. <ONE camera sentence with amplitude + speed + direction>.
Lighting: <light>. No subtitles, no on-screen text, no logos, no cuts, no extra people.
overall_soundscape: <short>. No dialogue.
non_diegetic_music: none
```

Rules:

- **Camera is a prose sentence with amplitude and speed**, e.g. "The camera glides
  forward with medium amplitude at a slow, steady speed into the bakery's doorway."
  Amplitude words: small / medium / large. Speed words: slow / steady / moderate. Name
  the direction (forward, rising, descending, orbiting left) and the target.
- **One `[Shot 1]` only.** A chained leg must be ONE continuous shot — never add
  `[Shot 2]`. The negative sentence always contains **"no cuts"**: an in-clip cut breaks
  the seam chain as badly as a mismatched frame.
- **Keep the negative sentence** verbatim: "No subtitles, no on-screen text, no logos,
  no cuts, no extra people." (Drop "no extra people" only for a scene that is supposed to
  have figures — then name them in the prose instead.)
- **Audio lines must exist but stay short.** H3 always generates audio; this skill throws
  it away (the encode step uses `-an`). Use `overall_soundscape: quiet room tone. No
  dialogue.` (or a two-word ambience of the scene) and `non_diegetic_music: none`.
- **Describe the start state, then the motion.** The first frame is fixed by the image;
  the prose should agree with what is in it, then say where the camera goes. Contradicting
  the first frame makes H3 "correct" the image in the first few frames — a seam pop.
- 24 fps, `--duration` 4–15 s, `--ratio` always explicit (16:9 desktop, 9:16 mobile
  chain), `--resolution 768P` unless 2K was confirmed on the backend.

Real example (works on the owner's RunPod endpoint):

```
integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium close-up
frames an elderly fisherman in a yellow oilskin coat at the stern of a small boat, grey
morning sea behind him. The camera pushes in with small amplitude at slow speed toward
his face. He looks out at the water, then almost smiles. Lighting: flat overcast
daylight, soft and cold. No subtitles, no on-screen text, no logos, no extra people.
overall_soundscape: waves slapping the hull, wind, a distant gull. No dialogue.
non_diegetic_music: a single sustained cello note.
```

### Reference mode — standalone hero clips only (not the chain)

Keyframe mode and **reference mode** are mutually exclusive. The chain always uses
keyframe mode. Reference mode (reference images labelled `<Subject 1>`, `<Subject 2>`…)
is only worth it for an optional standalone hero clip where a product must stay
identical — e.g. a looping product turntable behind the finale CTA — and it cannot be
chained (it doesn't start on a given frame). Its brief has six sections:

```
subject_definitions: <Subject 1> is the [product] shown in reference image 1 — [key
identifying details: shape, colour, label position].
summary: [reference generation] <one sentence of what the clip is>.
retention_analysis: <what must stay identical to the reference: silhouette, colours,
proportions, material>.
detailed_description: [Shot 1] <style, framing, prose, one camera sentence with amplitude
+ speed>. No subtitles, no on-screen text, no logos, no cuts.
overall_soundscape: quiet room tone. No dialogue.
non_diegetic_music: none
```

## Style preamble (default: clay diorama)

Reuse verbatim in every scene-still prompt. Swap the bracketed bits for the brand's palette/bg.

```
Isometric low-poly 3D diorama floating as a small rounded island on a plain solid
[BG_HEX] background with a soft contact shadow beneath it. Soft matte clay 3D render,
rounded toy-model shapes, gentle warm studio lighting, soft long shadows, tilt-shift
miniature look. Cohesive color palette of [PALETTE]. Highly detailed, centered
composition, absolutely no text, no letters, no numbers, no logos.
```

Alternate directions (swap the first two sentences, keep the palette/no-text tail):
- **Flat papercraft:** "Isometric layered paper-craft diorama, matte cardstock, clean die-cut edges, subtle drop shadows between layers."
- **Glossy toy:** "Isometric glossy vinyl-toy diorama, smooth plastic shading, soft rim light, collectible figurine look."
- **Claymation:** "Isometric stop-motion clay set, visible thumbprints, handmade plasticine texture, soft studio softbox light."
- **Neon night:** "Isometric miniature at night, warm interior glow and neon signage, moody rim light, wet reflective ground."
- **Photoreal architectural** (real estate, hospitality, premium/luxury): "Ultra-photorealistic architectural photography of a single cohesive [subject], cinematic wide-angle, warm golden-hour light, natural materials, restrained designer furnishings, a breathtaking view, editorial magazine quality (Architectural Digest), shallow depth of field, no people." For photoreal, drop the floating-island framing and the knockout (Step 3) — the scenes are **full-bleed** (a dark page background reads premium), the camera glides *through doorways/glass* rather than opening a roof, and cohesion comes from the identical preamble. Pass scene 0 as a `--ref` **only as a style reference** and say so in the prompt ("match the lighting, materials and colour grade of the reference image; a different room") — an unqualified reference clones the same room.

The video briefs reuse a **style tail** — a one-clause condensation of the preamble, e.g.
"Soft matte clay 3D diorama, tilt-shift miniature, warm studio light, palette of
[PALETTE]" — as the `<style>` slot after `[Shot 1]`. Keep it identical across every clip.

## Scene still prompt (Step 2)

Generated with `node "$SKILL/scripts/still.mjs" --prompt-file still_<id>.txt --out
still_<id>.png --aspect 16:9` (add `--ref still_<scene0>.png` for scenes 1..n).

```
[STYLE PREAMBLE]
Subject: [SECTION.subject — describe the miniature scene: the building/space, a few
characters doing the work, the props that signal this stage of the business].
[scenes 1..n only:] Match the art style, lighting, camera angle and colour palette of
the reference image exactly; this is a different place in the same world.
```

Tips:
- Name concrete props (they anchor the scene): tanks, cauldrons, conveyor, crates, awning, string lights, benches, scooters, map pins.
- For the final "hero product" section, drop the diorama-island framing and prompt a
  single oversized product centerpiece floating on the same background with a few small
  orbiting props.
- **Compose for the centre.** The page renders every clip `object-fit:cover`. Keep the
  focal subject horizontally centred with a little headroom, and don't park anything
  essential at the far left/right edges. Mobile ships its own native 9:16 chain
  (pipeline §6b), so this is not about surviving a crop — but a centred composition makes
  the portrait renders open cleanly, and keeps the focal point where the camera flies.
- Generate stills at **16:9** (`--aspect 16:9`): a still that is the first frame of a
  16:9 clip should already be 16:9, or H3 has to reframe it in the opening frames.

## Leg prompt — architecture A, continuous forward take (Step 4)

`--first-frame = previous leg's ACTUAL last frame` (leg 0: the first scene's still).
**Never `--last-frame`** (and the RunPod backend doesn't accept one anyway). The bolded
clauses are the motion-handoff contract — keep them verbatim; the mid-leg move is where
the expression goes.

```
integrated_multimodal_description: [Shot 1] [STYLE TAIL], a wide view continuing from
[WHERE THE PREVIOUS LEG ENDED — e.g. "the doorway of the pearl kitchen"]. **The camera
continues the same slow, steady forward glide with medium amplitude.** [MID-LEG MOVE —
optional, from the library below.] It travels into [SCENE i] toward [FOCAL POINT],
subtle parallax as [foreground props] slide past. **In the final second the camera
settles back into a slow, steady forward glide with small amplitude toward [the doorway
/ opening / direction of the next scene].** Lighting: [light]. No subtitles, no
on-screen text, no logos, no cuts, no extra people.
overall_soundscape: quiet room tone. No dialogue.
non_diegetic_music: none
```

### Mid-leg move library (pick by concept; omit for a plain glide)

Reversals are safe *inside* a leg (it's one continuous render) — only a seam may never
reverse. That's why "ease back out" is fine mid-leg. Each is a prose camera sentence with
amplitude + speed, as H3 wants it:

- **Half-orbit** (product, luxury): "Midway, the camera sweeps in a slow half-orbit with
  medium amplitude around [the hero object], keeping it centred, then continues past it."
- **Crane-up reveal** (scale, atriums, campuses): "Midway, the camera rises with large
  amplitude at a slow, steady speed as the full scale of [the space] reveals below."
- **Low lateral track** (production lines, counters, shelves): "Midway, the camera
  tracks low and level alongside [the line] with medium amplitude at a steady speed,
  foreground objects sliding past in parallax."
- **Push-in + ease back** (craft, detail): "Midway, the camera pushes in with medium
  amplitude at slow speed until [the craft moment] nearly fills the frame, then eases
  gently back out."
- **Rise-and-swoop** (travel, outdoors): "Midway, the camera climbs in a gentle arc with
  large amplitude over [the terrain], then swoops down at a steady speed toward [the next
  focal point]."

**Locked-iso clause** (`CAMERA` = locked isometric glide — SKILL Step 1.4/Step 4):
skip the library entirely and put this clause, verbatim, in the mid-leg slot of EVERY
leg:

```
The camera keeps exactly the same high isometric angle throughout — no rotation, no
orbit, no tilt. It only travels straight and level with medium amplitude at a slow,
steady speed, the world sliding past beneath the same view.
```

Keep the handoff-contract clauses around it unchanged. When checking each leg's last
frame, also check the ANGLE hasn't drifted (video models rotate slightly on long legs —
H3's tendency here is to be qualified on the first build) — re-roll the leg if the view
has turned.

After rendering each leg, **check its last frame** before generating the next: it should
read as a frame from a calm forward glide (no motion blur sideways, no half-finished
orbit). If it doesn't, re-roll this leg — a bad handoff frame poisons every leg after it.

## Dive-in clip prompt — architecture B (Step 4)

`--first-frame = the scene still` (solid-bg version).

```
integrated_multimodal_description: [Shot 1] [STYLE TAIL], a high wide view looking down
at the whole [SECTION.subject] from outside like a tiny model on a plain [BG] ground. The
camera glides forward and descends with large amplitude at a slow, steady speed, sweeping
in toward [FOCAL POINT — the counter / the cauldrons / the people], as if flying inside.
As the camera pushes in, the roof and upper structure gently lift and open away to reveal
the warm interior. Lighting: [light]. No subtitles, no on-screen text, no logos, no cuts,
no extra people.
overall_soundscape: quiet room tone. No dialogue.
non_diegetic_music: none
```

For scenes with no building to open (a field, a plaza, a road), replace the roof sentence
with "The camera flies low across [the scene] with medium amplitude at a slow, steady
speed toward [focal point]." If the diorama has little characters, drop "no extra people"
from the negative sentence and keep "no cuts".

Params: `--duration 8` (final) / `6` (draft), `--ratio 16:9`, `--resolution 768P`
(2K only if confirmed). Same for architecture-A legs.

## Connector clip prompt — architecture B (Step 5)

`--first-frame = dive_i LAST frame` (extracted), `--last-frame = dive_{i+1} FIRST frame`
(extracted). Both from the RENDERED videos, not the stills. **Requires
`--backend minimax`** (the only backend with last-frame keyframes).

```
integrated_multimodal_description: [Shot 1] [STYLE TAIL], continuing from inside
[SCENE i]. The camera pulls up and back out with large amplitude at a slow, steady speed,
rising into the sky above the connected miniature world, then glides forward across it
and arrives above [SCENE i+1], beginning to descend toward it. One connected miniature
world, one seamless flowing aerial move. Lighting: [light]. No subtitles, no on-screen
text, no logos, no cuts, no extra people.
overall_soundscape: soft wind. No dialogue.
non_diegetic_music: none
```

For the last connector into a hero-product finale: "…glides forward and the world
dissolves toward a single giant [PRODUCT] floating in soft [BG] space, arriving in front
of it."

Params: `--duration 5` (4 in draft), `--ratio 16:9`, `--resolution 768P`,
`--backend minimax`.

## If a clip is rejected

Content filters flag innocuous scenes now and then (bedrooms, pools, spas are typical
triggers across video models). Rephrase and retry — **3 attempts per leg**: (1) re-run
as-is (often non-deterministic); (2) strip loaded words and add "empty, unoccupied,
architectural, tasteful"; (3) describe the space by its furniture and materials instead
of its function. Still failing on a connector → set that connector to `null` (the engine
crossfades the seam directly). Still failing on an arch-A leg → change that scene's
subject; there is no skipping a leg in a continuous take.

## Copy per section (for the engine config)

- `eyebrow` — 2–4 words, uppercase feel (a value-prop label).
- `title` — 3–6 words, the beat's headline. First section = the site's hero line; last =
  the payoff + it carries the CTA.
- `body` — one sentence, plain-spoken, from the visitor's side.
- `tags` — 0–3 short proof chips (e.g. "Fresh-cooked", "30-min delivery").
