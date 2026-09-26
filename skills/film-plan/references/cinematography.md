# Deciding the look

The fields exist. This file is what goes in them.

`lensMm`, `aperture`, `framing`, `move`, `cameraNote`, `lighting`, `grade`, `palette` — a plan
with all eight filled still renders as stock footage when they were filled with defaults. This is
the difference between a film that is *correct* and a film that is *directed*.

- [The one rule](#the-one-rule)
- [Where each decision lives](#where-each-decision-lives)
- [Lens](#lens)
- [Angle](#angle)
- [Light](#light)
- [Blocking](#blocking)
- [The move](#the-move)
- [Colour](#colour)
- [Coverage](#coverage)
- [Worked example](#worked-example)
- [What this is measured against](#what-this-is-measured-against)
- [Failure modes](#failure-modes)

---

## The one rule

**A choice is only a choice if it could have been different, for a reason you can say.**

35mm on every shot is not a lens decision; it is the absence of one. "Soft cinematic lighting" is
not lighting; it is a request for the model to pick, and the model picks flat. Every field below
gets a value you can defend in one clause — *"85mm, because she is alone in a room full of
people"* — or it is a default wearing a number.

The test, before the gate: **take any shot and say what its look is doing for the story.** If the
answer is "it looks nice", the shot has no opinion, and a film of shots with no opinion is the
thing that comes back basic.

---

## Where each decision lives

This is set by `h3-prompt`'s shot block, and it is not negotiable — the block reads:

```
[Shot N] <style, opening only>. A <framing> shot on a <lens>mm lens at <aperture> frames
<SUBJECT> in <SET>, <duration> seconds. <Palette, opening only.> <Lighting, opening only.>
```

So:

| Decision | Scope | Consequence |
|---|---|---|
| `framing` (size **and angle**), `lensMm`, `aperture`, `move` | **Per shot** | These are the levers. Vary them, shot to shot, on purpose. |
| `lighting`, `palette`, `grade`, `look`, `mood` | **Film-wide, written once** | Repeating them after the first block makes the model re-establish the scene instead of continuing it. |

**Therefore a lighting change mid-film is not a lighting field — it is an event in `action`.** You
cannot re-specify the light in shot 4. You can write *"the overhead strip snaps off and the screen
becomes the only source"*, which renders, because it is something that physically changes. This is
the most common way a planned look gets lost: it was written as a second description instead of as
an event.

---

## Lens

Focal length is not a look, it is **a distance between the subject and their world**. Decide that
relationship first:

| The feel | What it does to the world | Say it when |
|---|---|---|
| Very wide | Space yawns open; background rushes; being close feels like intrusion | The world is bigger than them, or the camera is too close to be polite |
| Normal-wide | Honest, observational, no comment | You genuinely want no opinion — which means rarely, and on purpose |
| Normal | What an eye sees. Intimacy without editorial | Two people, and the film should stay out of it |
| Long | Background collapses to a wash; the subject detaches from it | Alone, even in a crowd. The decision, on a face |
| Very long | The subject is *being watched*, and cannot be reached | Surveillance, dread, a gap that will not close |

**Then write it in words, not numbers.** This is measured, not preference — across 72 prompts
behind curated H3 clips, **4% name a focal length at all** (and only ever `50mm` or `85mm`), and
**not one** uses an f-stop. What they use instead:

| Write | Not |
|---|---|
| "wide-angle lens", "fisheye", "macro", "telephoto", "50mm lens *feel*" | `24mm`, `135mm` |
| "shallow depth of field", "deep focus", "background blurred to a wash" | `f/1.4`, `f/8` |

**42% of them state depth of field in words. None states an aperture.** A number the model does not
read is a decision you did not make. `film-plan`'s `lensMm` and `aperture` fields still hold your
reasoning and drive the storyboard panels — but whatever you put there, **the sentence that
reaches the model says it in words too**, or the look is left to the model.

**The change is the statement.** A scene that opens wide and lands long has tightened around
someone. A scene shot at one focal length has one opinion, and it is "none".

---

## Angle

**Height and tilt are a bigger lever than focal length, and cost nothing.** In the same 72
prompts, angle vocabulary outruns focal length roughly four to one — `low-angle` 15, `eye-level`
14, `high-angle` 8, `top-down` 6, `over-the-shoulder` 6, against 3 prompts naming any mm.

| Angle | Reads as |
|---|---|
| Low | They have power, or the room does. Ceilings appear, and ceilings feel like pressure |
| Eye-level | Equals. The film has no opinion about them — the honest default, and a *choice* only when you meant it |
| High | Diminished, observed, in a trap they cannot see the shape of |
| Top-down | A diagram of what is happening. Reads as fate, or as surveillance |
| Over-the-shoulder | Whose scene it is. The shoulder you sit behind is the one the audience sides with |

**If you changed nothing else between two shots, change the angle.** It is the cheapest way to
satisfy coverage (below) and generated video renders it reliably.

---

## Light

Three things, one sentence: **the source, the direction, and what it fails to reach.**

**Name the source, because H3 renders it.** Light in a generated frame comes from something
visible or it comes from nowhere and looks it — a window, a lamp, a phone, a fire, headlights, a
fridge left open. "Motivated" is not a style preference here; an unnamed key is the model
guessing, and its guess is a soft frontal fill.

This is the most strongly supported rule in the file: across the 72 measured prompts, **75% name a
physical light source and 3% fall back to a catch-all** like "cinematic lighting". Stating the
*direction* is rarer — 19% — so treat the table below as the upgrade available to you once the
source is named, not as a thing everyone does.

**Direction carries the meaning:**

| Direction | Reads as |
|---|---|
| Frontal | Open, exposed, nothing hidden — and flat, which is why it is the default and the enemy |
| Side | Divided. Half of them is not available to you |
| 3/4 back (rim) | Separated from the background — heroic, or a silhouette walking toward you |
| Top | Judged. Eyes go to sockets |
| Under | Wrong. Use once |

**Write the ratio in words, not numbers.** H3 does not read `4:1`. It reads *"the fill dies away to
nothing, so the far side of her face is gone."*

**Contrast is genre, not grade.** A horror film in a sunlit family house is not a darkened film —
it is hard light, absolute shadow, and a window that blows out. This is rung 5 of the precedence
ladder arriving in the lighting field instead of stopping at the colour grade, which is the exact
failure the ladder exists to prevent.

---

## Blocking

The camera is in the room. Decide where.

- **Eyelines before framing.** Who is looking at whom, and who is refusing to. A shot where nobody
  is looking at anything is how a frame can be beautiful and mean nothing.
- **Hold the 180° line** across a cut, or the two people stop sharing a room. `preflight.mjs`
  already checks for this; do not make it find it.
- **Put something in the foreground.** A shoulder, a doorframe, a hanging bulb, rain on glass.
  Occlusion is the cheapest depth available, generated video renders it well, and it is most of
  the difference between "a shot" and "a frame from a film".
- **Depth beats width.** Two people at different distances from the lens is a composition. Two
  people side by side is a class photo.

---

## The move

A move is motivated by a beat or it is decoration. Name the beat it performs:

| Move | The beat it is |
|---|---|
| `static` | Let it happen. The strongest choice, and a film with no static shot is exhausting |
| `push-in` | A realisation lands |
| `pull-out` | The context is worse than you thought; or abandonment |
| `track` | Allegiance — we are travelling *with* them |
| `arc` / `orbit` | The ground is no longer fixed |
| `crane-up` | Release. It ends |
| `crane-down` | Descent into it |
| `rack-focus` | Attention transfers, and the audience's does too |
| `handheld` | Somebody is present and not in control |

**If you cannot name the beat, the move is `static`.** A move applied to a shot with no beat is the
"held pose with a camera move on it" from Part 3 rule 3.

Measured, across the 72: **56% hold at least one static or locked-off shot**, and **53% use three
or more distinct moves** in a single 15-second clip. So both halves of the rule hold — vary the
move, and let one shot stand still. `track` is the workhorse (71%) and `pan` is second (38%);
`orbit`, `dolly` and `rack focus` are each under 5%, which means they read as deliberate when they
appear. Spend them.

`cameraNote` holds the *mechanics* — what stays locked, what leads, where it stops — because
`h3-prompt` compresses the move itself into one sentence from a closed vocabulary. The note is for
the plan and the panels. **Do not smuggle focal lengths or travel distances into the camera
sentence**; a 900-character camera instruction renders as a plain push-in, every time.

---

## Colour

**A palette is what is in the frame, not a filter over it.** Four to six hexes only become visible
if they are *on* something: wardrobe, a wall, a practical, a car, spilled light. A palette named in
the grade and placed on nothing renders as a faint tint, and then as nothing.

Give the film one colour that appears **once**, where it matters. A film where every hex appears in
every shot has no accent, only a scheme.

---

## Coverage

**Two adjacent shots with the same framing and the same lens read as one shot that glitched.**

Across any cut, change at least one of: **size, angle, or lens character.** Two is better. This is
the cheapest quality gain in the whole plan and it costs nothing at render time — and since almost
nobody specifies focal length, **angle is usually the one you change.**

Measured: **81% of the 72 name two or more framing sizes**, and only 6% name none. Size variety is
close to universal among clips good enough to be curated.

Vary sizes across the scene the way a real edit does — a wide to place it, mediums to play it, a
close for the decision, and one insert of a detail that pays off later. A scene of six mediums is
correct, complete, and dead.

---

## Worked example

Same beat, twice. A woman in a kitchen realises someone else is in the house.

**Defaults — everything filled, nothing decided:**

```jsonc
{ "framing": "medium", "lensMm": 35, "aperture": "f/2.8",
  "move": "slow push-in", "cameraNote": "",
  "action": "She stands in the kitchen and looks worried." }
// film-wide: "lighting": "soft cinematic lighting", "grade": "moody"
```

Renders: an evenly lit woman, mild concern, a camera drifting for no reason. Correct. Basic.

**Decided:**

```jsonc
{ "framing": "medium-wide, slightly high angle", "lensMm": 28, "aperture": "f/4",
  "move": "static",
  "cameraNote": "locked off on a wide-angle lens, deep focus so the hallway stays readable;
     the hallway mouth held black in frame right, she is small in the left third",
  "action": "She stops drying the plate mid-turn; the hallway light behind her goes out." }
// film-wide:
// "lighting": "one fluorescent tube over the sink is the only source — hard, overhead and green;
//    the fill dies at the edge of the counter and the hallway beyond it is unlit, and stays unlit"
// "grade": "no lift in the blacks; the shadow is absolute"
```

Every change is a sentence you can say. Wide-angle because the room must be bigger than her — and
it reaches the model as *"wide-angle"*, with `28` kept in the field for the panels. Deep focus
because the hallway has to stay present. Slightly high because she is in a trap she cannot see the
shape of. Static because the beat is *arrival*, and pushing in would tell her before she knows. The
light is named, overhead, and has somewhere it does not reach — which is where the film's threat
lives. And the change is written as an **event**, so it renders.

---

## What this is measured against

The percentages above come from **stimQQ/stunning-minimax-h3-prompts** — 222 curated H3 clips,
each with its prompt. Three limits, because they decide how hard to lean on the numbers:

1. **The 72 measured in full were reconstructed from the finished clips** by apimodels.app, on one
   template. So their *structure* (100% have a CAMERA section, an AUDIO section, an AVOID block)
   is an artifact of that template and proves nothing. Only the **vocabulary inside** the sections
   is evidence — what a careful describer thought was worth naming about a clip that worked.
2. **The other 150 are the authors' own prompts, but the repo holds only ~180-character
   excerpts** — full text is behind apimodels.app. So for those, only length was measurable:
   median **1,783** characters for a single 15-second generation, p90 **3,956**, longest **7,004**.
3. **There are no failures in the corpus.** Every entry is a clip somebody chose to post and
   somebody else chose to curate. That gives base rates *among successes*, which is enough to say
   "almost nobody writes f-stops" and not enough to say "f-stops cause bad clips".

One inference, flagged as inference rather than measurement: thirteen of the 150 are under 300
characters — one is *"The most cinematic scenes you can make."* Those clips are real, and they are
the model's own taste rendered well. **That taste is exactly what "basic" means here.** A short
prompt is not a cheaper route to this file's outcome; it is a decision to accept the default.

---

## Failure modes

| Symptom | The field that was a default |
|---|---|
| "It looks like stock footage" | One lens character and one angle throughout — no framing decision was made anywhere |
| The planned lens never showed up | It was written as `35mm` / `f/2`; the model reads "wide-angle" and "shallow depth of field", not numbers |
| Flat, plasticky faces | `lighting` unnamed or frontal; the model supplied a soft fill |
| Beautiful and meaningless | Framing decided before eyelines; nobody is looking at anything |
| Reads like a game cutscene | Every shot moves. Nothing is static, so nothing lands |
| Two shots look like one glitched shot | Size, angle and lens character all unchanged across the cut |
| The palette never showed up | Colour lived in `grade` and was never placed on an object |
| The lighting change never happened | It was written as a second lighting description instead of as an event in `action` |
| Genre only reached the grade | Contrast was treated as a look, not as the genre arriving in the light |
| Correct, complete, dead | No coverage variety — the scene is all one size |
