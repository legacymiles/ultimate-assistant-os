# Plan → the video brief

Two shapes come out of this compiler:

- **the whole film as ONE generation** (the normal path): every cut is a `[Shot N]` block inside one
  detailed description, and the references are the character/product sheets, the set plate and the
  composed sheet PNG;
- **one cut on its own**, for a retake of a single beat.

It is deterministic and model-free. The user never has to learn the video model's prompt format, and
the same plan always compiles to the same brief — which is what makes a retake comparable.

The section names below are MiniMax H3's; other reference-mode models want the same information under
different headings. Keep the structure and rename the keys.

## The six sections

```
subject_definitions:
<Subject 1> is GIRL: mid-twenties, …, wearing a faded red canvas jacket. Retention: fully_preserved.
<Subject 2> is the set COASTAL ROAD — MAIN LOCATION: …. Retention: partially_preserved.
<Subject 3> is the shot plan sheet: the storyboard frames (Section 3) are the target look of each shot
  in order, and the palette and lighting references set the grade. Retention: attribute_transfer.
summary: [reference generation] {title} — 4 shots, 15s: Cut 1 wide dolly-in; Cut 2 macro static; …
retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - the identity, face, hair, skin and
  wardrobe of GIRL are retained exactly.
<Subject 2> (appears in [Shot 1], [Shot 2], …): partially_preserved - the layout, materials, dressing
  and light are retained; the camera may see new angles of it.
<Subject 3> (appears in …): attribute_transfer - composition, framing and lighting of each storyboard
  frame are matched shot by shot; the sheet's text and layout are never shown.
detailed_description: {the shot blocks, below}
overall_soundscape: {plan.soundscape}. No dialogue except what is written, no music in the ambience.
non_diegetic_music: {plan.music, or "No music; natural sound only"}
```

With no reference images at all, collapse to a single `integrated_multimodal_description:` and keep
the soundscape and music lines. Video models generate sound whether or not you ask, so always say
what that sound is.

## Attach order and retention

Identity first — earlier references are weighed more heavily.

```
1. character sheets  (for every character appearing in the rendered cuts)   fully_preserved
2. product sheets                                                          fully_preserved
3. environment plates                                                      partially_preserved
4. the storyboard frame  (single-cut retake only)                          attribute_transfer
5. the composed shot-plan sheet  (whole-film render only)                  attribute_transfer
6. style images                                                            attribute_transfer
```

Cap at the model's ceiling (nine on H3). Label them `<Subject 1>…<Subject N>` in attach order and use
those labels inside the description — `GIRL (<Subject 1>)` — so the prose and the attachments are
wired together.

The single-cut brief attaches that cut's storyboard frame and drops the sheet; the whole-film brief
attaches the sheet and drops the individual frames. Both would be redundant and the model splits the
difference badly.

## The shot block

```
[Shot 1] {look.style, opening block only}. A wide shot on a 40mm lens at f/2 frames GIRL (<Subject 1>),
mid-twenties with …, wearing a faded red canvas jacket in COASTAL ROAD — MAIN LOCATION (<Subject 2>),
a two-lane road cut into the cliff …, late afternoon, 4 seconds.
Palette: warm amber sunlight + cobalt blue sky + ….
Lighting: midday road glare on asphalt & chrome guardrail; low amber rim from the west.
The camera dollies in on a smooth slider with medium amplitude at slow speed toward GIRL.
{the storyboard caption, as one sentence}.
GIRL steps off the shoulder and turns into the light.
(S1) GIRL says: <d>[English] Don't go.</d>
```

- **Only the first block carries the heavy detail** (style sentence, full look, full set description,
  palette, lighting). Later blocks name the same subjects by label and stay lean; repeating the full
  description per shot dilutes the brief and wastes the context the motion needs.
- **Camera moves are prose with an amplitude and a speed**, never bracket tokens like `[Push in]`:

```
static      "is locked off, perfectly still"          rack-focus "holds still while focus racks from the foreground to the subject"
handheld    "is handheld, drifting gently with the operator's breath"
dolly-in    "dollies in on a smooth slider"           push-in    "pushes in"        pull-out "pulls out"
track       "tracks alongside the subject"            pan "pans across the scene"   tilt "tilts"
crane-up    "rises on a crane"                        crane-down "descends on a crane"
arc         "arcs around the subject in a clean, polished curve"   orbit "orbits slowly around the subject"
dolly-zoom  "dollies in while zooming out, holding the subject's size as the background stretches"
```

  Amplitude: small for `static`/`rack-focus` and for close/macro/insert framings; large for cranes,
  orbits, arcs and wides; medium otherwise. Speed: slow for still and handheld moves and for anything
  over ~3 s; medium for short, fast cuts.

- **Dialogue** is rewritten from `"GIRL: Don't go."` into the model's speaker form —
  `(S1) GIRL says: <d>[English] Don't go.</d>` — with the speaker index taken from the cut's cast
  order so lip-sync lands on the right face.

## The closing paragraph

After the last shot block:

```
Mood: fleeting encounter, summer transience, quiet longing.
{styleEssence}.
{cinematography notes joined with "; "}.
Match each shot to its storyboard frame in <Subject 3>, in order; never show the sheet, its text or its layout.
Impeccable subject consistency across every shot. No subtitles, no on-screen text, no logos, no extra people.
```

That last line earns its place every single render.

## Render mechanics

- The whole-film description opens with `A 15-second commercial in 4 shots that flow into one
  another.` — the model needs to know it is one continuous piece, not four clips.
- Durations: a single generation is 4–15 s; a standalone retake is clamped to the model's 4 s minimum
  even when the cut is 2 s inside the film.
- Freeze the compiled prompt onto the take when it starts. A take must remain reproducible after the
  plan is edited, and the video page shows what was actually sent.
- Allow a hand-edited override per cut plus one for the whole film (`promptOverrides["full"]`), shown
  in a prompt box beside the player. Power users will want it; everyone else never opens it.
- Poll the render task and store the finished clip under a media id like any other asset.
