---
name: h3-prompt
description: Turn a plan and its attached pictures into the prompt a video model actually renders well — the MiniMax H3 / Hailuo / Seedance production-brief format, with the length discipline that stops a prompt hallucinating. Use this WHENEVER writing or reviewing a prompt for H3, Hailuo, Seedance, WanGP or any image-to-video model; whenever a shot is being compiled from a storyboard, a shot plan or a set of reference images; and above all whenever a rendered clip came back WARPED — a character appearing twice in one shot, a person in two places at once, a camera move that rendered as a plain push-in, actors walking when they were told not to, or a fifteen-second shot that turned to mush. Also use it before adding video generation to any app, so the user never has to learn the model's prompt format.
---

# H3 prompt

> ### Which skill is this?
>
> **This is part of the VIDEO PROMPTING STACK** — five skills that decide what actually gets sent
> to the model. Everything good measured so far came through these.
>
> | | job |
> |---|---|
> | `h3-long-story` | the whole film — scenes, casting, continuity across minutes |
> | `h3-cinematic-prompt` | **the sentences** — plain caption style, camera, the look |
> | `h3-prompt` | the model's section format and which mode applies |
> | `h3-stitched-film` | how many clips, how they chain, the action budget |
> | `h3-scene-continuity` | measure what came back (`continuity.mjs`) |
>
> **Not to be confused with** `film-plan` and `shot-plan-storyboard`, which are Jarvis Studio's
> in-app planning flow: a brief plus photos becomes a Storyboard object, a drawn sheet and a
> render gate. That is a different job. A film planned there still has its prompts written by
> this stack.


This is the format and the discipline behind `src/lib/smart-shot/h3prompt.ts` in the Ultimate
Assistant OS hub — the implementation that was verified against the real OpenArt Smart Shot
output. Read that file when a detail here is ambiguous; it is the source, and it is deterministic
and model-free on purpose, **so the user never has to learn H3 prompting.**

> **H3 reads a production brief, not a caption.** And it renders everything the brief describes —
> which is why the way to break it is to describe too much.

## The one failure this skill exists to prevent

A prompt that describes a person **in more than one position** gets you **two of that person**.

Measured on a real film: one 15-second shot whose prompt said the mother was *"small and
motionless at the far end of the hallway"* and also *"crowded huge and close behind both
shoulders"* — the before and after of a dolly zoom — rendered her in the foreground **and** down
the hallway, in the same frame. That reads as warping. It is not an artefact; it is two mothers,
because the prompt asked for two.

The same prompt was **8,031 characters**. A good one for that shot is under 1,500.

**So: one position per person per shot. One camera state. Two or three beats. Never the before
and after of a move — a move is described as a move, once.**

## One position each — but ALSO one verb each

Cutting positions is not the same as cutting behaviour, and confusing the two produces a shot
where nothing happens.

Measured: a chase prompt trimmed to *"BABY runs down the hallway away from the two adults behind
him"* rendered a child walking calmly out of a house. The two adults had **no verb in the entire
prompt** — "behind him" is a position, not a pursuit — so the model rendered exactly that: two
people standing somewhere behind, and a boy leaving.

**Everything in the shot that should be doing something gets one position AND one action, and the
action runs for the whole shot.**

That is not only about people. It scales down and up:

- **One subject alone** — they still need a verb, and so does the world around them: *"she reads,
  and the strip light above her stutters."* A single figure with nothing happening to them is the
  commonest held pose there is.
- **Two or more** — whoever is not the focus still needs their own verb, or they become furniture.
  An antagonist described only by where it is renders as scenery; described only by what it looks
  like, as a costume.
- **A product, a dish, a machine** — it usually cannot act, so the verb belongs to what acts on
  it: the light moving across it, steam rising off it, a hand entering frame, the camera closing
  on it. Something must change state inside the seconds.
- **A place with nobody in it** — the change is weather, light, traffic, water, dust. A landscape
  that merely exists renders as a photograph.

## A continued shot keeps one line of identity

A shot chained on frames takes no reference pictures, so the handed-over frames are the only thing
holding the subject — whoever or whatever that is — and if the previous shot drifted off them, there is nothing at all. Keep **one clause** naming what is on screen — *"BABY, the one-year-old in the grey cardigan"*,
*"the green glass bottle, label to camera"*, *"the same rain-black alley"*. Not the full
description, which would invite a rebuild; just enough that a weak handover degrades instead of
collapsing into a different person.

## The sections

Which set you write depends only on whether pictures are attached.

**With references (Ref2VA)** — five sections, in this order:

```
subject_definitions:
<Subject 1> is GIRL: <1–2 sentences of look>, wearing <1 sentence>. Retention: fully_preserved.
<Subject 2> is the set KITCHEN: <1–2 sentences>. Retention: partially_preserved.
summary: [reference generation] <title> — N shots, Ts: <cut titles, framings, moves>
retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - the identity, face, hair, skin and wardrobe of GIRL are retained exactly.
<Subject 2> (appears in [Shot 1]): partially_preserved - the layout, materials, dressing and light are retained; the camera may see new angles of it.
detailed_description: <the shot blocks, then the closing block>
overall_soundscape: <what the scene sounds like>. No dialogue except what is written, no music in the ambience.
non_diegetic_music: <the score, or "No music; natural sound only">.
```

**With no references (text-to-video, or a shot continued from frames)** — one section:

```
integrated_multimodal_description: <the same description>
overall_soundscape: …
non_diegetic_music: …
```

Every attached file is `<Subject N>` **in attach order**, and every one is named in
`subject_definitions` *and* given a retention line. A definition that describes a picture which
was never attached is worse than no definition at all.

## Retention — three values, and they are not interchangeable

| What it is | Retention | Means |
|---|---|---|
| A character, a hero product | `fully_preserved` | identity, face, hair, skin, wardrobe / shape, materials, markings retained **exactly** |
| A set plate, an environment | `partially_preserved` | layout, materials, dressing and light retained; **the camera may see new angles** |
| A storyboard frame, a composed sheet, a style image | `attribute_transfer` | composition, framing and light are matched, or palette and grade only — **none of its content** |

A style reference marked `fully_preserved` will put its people in your film. An environment marked
`fully_preserved` locks the camera to one angle. These are the two most expensive mistakes here.

## Reference order

**Identity first — H3 weighs earlier references more.** Characters, then products, then
environments, then the storyboard frame or composed sheet, then style images. **Nine at most.**

## The camera is ONE sentence, from a fixed vocabulary

This is the part everyone gets wrong, including me. A camera move is **a verb phrase, an amplitude
and a speed**. Never metres, never focal lengths, never a multi-part move.

```
The camera <move prose> with <small|medium|large> amplitude at <slow|medium|fast> speed[ toward <focus>].
```

The vocabulary, verbatim:

| move | prose |
|---|---|
| `static` | is locked off, perfectly still |
| `handheld` | is handheld, drifting gently with the operator's breath |
| `dolly-in` | dollies in on a smooth slider |
| `push-in` | pushes in |
| `pull-out` | pulls out |
| `track` | tracks alongside the subject |
| `pan` | pans across the scene |
| `tilt` | tilts |
| `crane-up` | rises on a crane |
| `crane-down` | descends on a crane |
| `arc` | arcs around the subject in a clean, polished curve |
| `orbit` | orbits slowly around the subject |
| `rack-focus` | holds still while focus racks from the foreground to the subject |
| `dolly-zoom` | dollies in while zooming out, holding the subject's size as the background stretches |

Amplitude is decided by the move and the framing: `static` and `rack-focus` are always small;
crane, orbit and arc are always large; otherwise a close-up is small, a wide is large, everything
else medium. Speed is slow unless the shot is 3 seconds or shorter.

`static` and `rack-focus` take their own shorter forms — *"The camera is locked off, perfectly
still, holding on GIRL."* Only moves that travel get a `toward <focus>`.

**That is the whole camera instruction. 110 characters.** The dolly zoom line above is the entire
specification of a dolly zoom — the compensation is stated as *what it looks like*, not as
geometry. A 900-character camera note describing travel distances and focal lengths at each end
renders as a plain push-in, every time, because the described end-states get composited instead
of performed.

## Length discipline — the `opening` rule

**Descriptive detail is written ONCE, in the first shot block. Later shots name the subject and
stop.**

In the first block: the look (**first two sentences only**), the wardrobe (**first sentence
only**), the environment description (first two sentences), the time of day, the palette note, the
first one or two lighting captions, and the style.

In every block after it: the name, the `<Subject N>` label, the framing line, the camera sentence,
and what happens. Nothing else. The look is already established, and repeating it invites the
model to re-establish the character instead of continuing them.

Truncate at sentence boundaries, never mid-word.

## A shot block

```
[Shot N] <style, opening only>. A <framing> shot on a <lens>mm lens at <aperture> frames
<SUBJECT (<Subject 1>), look, wearing wardrobe> in <SET (<Subject 2>), description, time of day>,
<duration> seconds. <Palette, opening only.> <Lighting, opening only.>
<The camera sentence.> <What happens.> <Dialogue, if any.>
```

**What happens** is two or three clauses, in order, naming something that physically changes. A
shot describing a situation that already exists renders as a still photograph, because that is
literally what it asked for.

**Say the lens in words as well as numbers.** Measured across 72 prompts behind curated H3 clips,
**4% name a focal length and not one names an aperture**, while **42% state depth of field in
words**.
The `<lens>mm` and `<aperture>` slots above stay — they are what Smart Shot was verified against —
but a shot that carries only numbers has left its look to the model. Add the plain-language form:
*"on a wide-angle lens, shallow depth of field"*, *"long lens, background blurred to a wash"*.

## Dialogue

```
(S1) GIRL says: <d>[English] Don't go.</d>
```

The speaker index is their position in the cast list. H3 lip-syncs it. Ordinary speech runs about
**2.5 words per second** — a line longer than its shot is cut off at the source and cannot be
recovered later.

## Sound is never optional

H3 always generates audio, so the brief always says what that audio is. An empty soundscape means
the model picks.

```
overall_soundscape: <the scene's own sound>. No dialogue except what is written, no music in the ambience.
non_diegetic_music: No music; natural sound only.
```

Write `non_diegetic_music` as the score only when the film is **one unbroken generation**. A score
described in a prompt is generated afresh by every shot that reads it, so a film with hard cuts
changes music at every join — put the score under the finished edit instead.

## The closing block

After the last shot block, in this order: mood keywords · the style essence sentence ·
cinematography notes as a single semicolon-joined line · the match-the-frame instruction when a
storyboard frame or sheet is attached · and always:

> *Impeccable subject consistency across every shot. No subtitles, no on-screen text, no logos, no
> extra people.*

When a sheet is attached, say explicitly: *"never show the sheet, its text or its layout."*
Otherwise it draws the storyboard.

## One generation, or many — and a generation holds several cuts

**A 15-second generation is not one shot. It is a scene, and H3 will cut inside it.** Measured:
four timed `[Shot N]` blocks in one render produced four distinct shots — wide, close-up, re-frame,
exterior — with identity and grade automatically consistent, because it is one render.

So inside the window the whole film is ONE generation, written as timed blocks:

```
A 15-second live-action film in 4 shots that flow into one another, <look>. It begins exactly on
the attached frame.

[Shot 1] 0.0–4.0s. A wide on a 32mm lens at f/2 frames <SUBJECT, look, wardrobe> in <where>.
<camera sentence> <what changes.>

[Shot 2] 4.0–7.0s. A close-up on a 50mm lens at f/2. <camera sentence> <what changes.>
```

**The timestamps are not decoration.** They are the clock that stops a long render drifting into a
held pose: something is due at 4 s and something else at 7 s, so the shot has appointments to
keep. A 15-second block with three vague clauses and no schedule is how a camera wanders off its
subject.

**Descriptive detail goes in the first block only.** Later cuts name the subject and stop — that
restraint is exactly what leaves room for four cuts inside one prompt.

Past the window, a film is several generations, chained. That is when handover matters, and the
bridge offers three ways to do it:

| `STUDIO_CHAIN` | What crosses the join | Cost |
|---|---|---|
| `video` | ~1.5 s of real frames — motion **and audio** cross, seam invisible, no warm-up | you inherit whatever the previous render ended on |
| `frame` | one chosen still as `image_start` | you pick the frame, but the next render starts from rest and carries no audio |
| `both` *(default)* | the frames **and** a chosen start frame (`image_prompt_type: "SV"`) | the frame pins what it opens on, the video carries motion and sound |

`image_prompt_type` is a flag string over `TSEVL`, so the modes combine: `"S"`, `"V"`, `"SV"`,
`"VE"`. And `image_start` takes an **array** of paths, not a bare string.

A chained generation takes **no reference images** — references and a continuation are two answers
to the same question — so it keeps one clause of identity in the prose instead.

## Checklist

1. Is anyone described in **more than one position**? Cut until they are in one.
2. Is the camera in **more than one state**? Cut to one, from the vocabulary.
3. More than **three timed beats** in a shot? Merge them.
4. Am I describing something an **attached picture already shows**? Delete the words.
5. Is every attached file **defined and given a retention**, and is the retention right?
6. Is descriptive detail repeated **after the first shot block**?
7. Does every shot name something that **physically changes**?
8. Is the soundscape written, and is `non_diegetic_music` right for the number of generations?
9. Continued shot — have I described the **scene** instead of the **change**?
10. Does the **lens or the framing change** anywhere across the shots, and does any shot hold
    `static`? A film at one focal length where every shot moves was never directed — send it back
    to `film-plan` and read that skill's `references/cinematography.md`.
11. Is it under about **1,500 characters per shot**? If not, something on this list is wrong.

## Related

`src/lib/smart-shot/h3prompt.ts` is the reference implementation. `film-plan` decides what the
shots ARE; this skill decides how they are worded. `h3-scene-continuity` owns what happens after
the clips exist.

**This skill transcribes a look; it never chooses one.** When `lensMm`, `aperture`, `lighting` or
`move` arrive as defaults, the prompt will be perfectly formed and the film will come back basic —
that is decided one stage earlier, in `film-plan`'s `references/cinematography.md`. Wording is not
where a shot gets its opinion.
