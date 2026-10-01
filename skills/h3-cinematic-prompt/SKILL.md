---
name: h3-cinematic-prompt
description: Write the actual sentences that go to a video model — MiniMax H3, Hailuo, Seedance, Kling, Veo — so a shot comes back cinematic instead of flat, frozen or straight-lined. Use this WHENEVER writing or fixing a video prompt, and especially when a clip came back boring, static, ignoring the camera direction, or when the prompt has grown into paragraphs of description. Written from measured comparisons on real renders, including several where the elaborate version lost to two plain sentences.
---

# Writing the prompt

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


A video model learned from **video–caption pairs**. Its training data is millions of clips
labelled in plain speech: *"a bird flies down an alley and turns left"*. Nothing in it was ever
labelled the way a cinematographer briefs a crew.

So write the caption of the shot you want. Not the brief.

## The rule

> **Say what happens, in the plainest sentence that could be true. Then say where the camera is.**

Measured on one identical opening frame, same subject, same five seconds:

| prompt | chars | opening motion | did it turn? |
|---|---|---|---|
| "the entire world rolls hard to the left — the horizon tips over, the rooftops swing down across the top of frame and the road swings up the other side" | 1321 | 0.0772 | **no** |
| "A bird flies fast down a narrow brick alley and turns left around the corner. The camera flies right behind it, close." | **226** | 0.0647 | **yes** |
| "tilts onto its side to fit through a gap between two vans" | 319 | 0.0829 | **yes, visibly banked** |

**A quarter of the words, and it was the short one that produced the turn.** Everything past the
plain sentence bought motion that could be measured and direction that could not.

The long version failed because it described the *process* of a camera move — a thing no caption
has ever contained. The short one named an action a person would name.

## How to be cinematic without going abstract

Cinematic does not mean more words. It means **more specific nouns**.

The failure is not "too much detail", it is "detail about the wrong kind of thing". Compare:

```
ABSTRACT (fails) — describes process, geometry, intention
   the frame compresses as the background stretches behind him
   the light rakes across the space with hard falloff
   the world rushes past the lens at enormous speed

CONCRETE (works) — names things that exist in the shot
   sodium streetlights, wet cobbles, steam off a grate
   low sun flaring through a dirty windscreen
   tyre smoke pouring off the back wheels
```

Both are "detailed". Only one is made of things a camera can photograph.

**So the cinematic layer is a list of nouns, not a paragraph of prose.** Time of day, weather,
what the light is coming from, what the ground is, what is in the air (dust, rain, smoke, steam,
spray). Four or five concrete things is plenty.

## The shape of a good prompt

```
<what happens, one or two plain sentences>
<where the camera is, one plain sentence>
<the look: 4-6 concrete nouns>
```

Worked example:

```
A car drifts around a tight corner on a wet city street at night, tyre smoke pouring off the
back wheels. The camera is low at the kerb and whips round to follow it past.
Neon signs reflecting in the wet road, rain in the air, sodium streetlights, 35mm grain.
```

That is the whole prompt. Around 300 characters.

## The camera must be BIG, and said plainly

Two rounds of the same nine subjects, changing nothing but the camera sentence:

| subject | timid wording | big wording | opening motion |
|---|---|---|---|
| drift | "whips round to follow it past" | "whips a **full half-circle** around the car as it slides past" | 0.0440 -> **0.0609** |
| bull | "low in the dirt close to the bull" | "**circles the bull fast and low** while it bucks" | 0.0274 -> **0.0433** |
| welder | "pushes in slowly" | "**drops from the ceiling all the way down** to the arc" | 0.0245 -> 0.0139 |

A named, committed move beats a vague one by a wide margin. "Pushes in slowly" and "follows
behind his shoulder" are how a shot comes back boring — and they are what I wrote for a whole
round after having already proved that orbits, cranes and whips execute.

**Say the whole move in ordinary words:**

```
The camera swings all the way around her in one continuous circle.
The camera whips a full half-circle around the car as it slides past.
The camera drops from the ceiling all the way down to the arc in one move.
The camera corkscrews around him as he swims, rolling right over as it goes.
The camera whips hard from one man to the other as the punch lands.
```

Each is one sentence, plain, and describes a move a real operator could execute. That is the
register that works.

**Tie a whip or a cut to the beat it belongs to.** The fight clip peaked in its MIDDLE (0.0320
against a 0.0172 opening) because the whip was written to land with the punch — "whips hard from
one man to the other **as the punch lands**". Energy where the story is, rather than at the front.

**Two cautions, both measured:**

- A big camera move **competes with a travelling subject**. The swimmer's corkscrew and the
  market orbit barely beat their timid versions, and both subjects were moving through the
  world. The orbit that worked best had a subject who stayed put.
- **Dark scenes underperform.** A ceiling-to-arc crane and a full orbit both returned ~0.010
  motion in near-black frames (luma 0.15 and 0.30) — flatter than far tamer moves in lit scenes.
  If a shot is meant to be dark AND moving, light the plate more than feels right.

## Dialogue and lip sync

Two ways, and they are not equivalent.

**Written dialogue** — H3 generates the voice and syncs the mouth:

```
(S1) MAN says: <d>[English] I told you not to come back here.</d>
```

Speech runs about **2.5 words per second**; a line longer than the shot is cut off at the source
and cannot be recovered in the edit.

**A supplied track** (`audio_guide` + `audio_prompt_type: "A"`) — the model matches mouth and
action to real audio you hand it. This is NOT the same as laying a track under a finished cut.

Measured on the same day:

| | opening | ending |
|---|---|---|
| written dialogue | 0.0117 | **0.0058** |
| supplied audio guide | 0.0047 | **0.0280** |

The written line **decays** — the model says it and runs out of instruction. The audio guide
**builds**, because the audio keeps going and the picture keeps having something to answer to.

> **When there is a real track, use it as the guide.** Written dialogue is for when there isn't.

## One action per clip — this does not change

Plain language fixes the *wording*. It does not buy more events.

A clip written plainly with three actions — *"tilts onto its side, then rolls level and turns
left"* — still finished early and **froze for 25 frames**. The action budget is separate and
absolute: one dominant action per shot, and a clip needs slightly more than it can finish so it
ends mid-motion rather than on a completion.

See `h3-stitched-film` for the budget, the freeze verdict and how clips chain.

## When a prompt gets long, it is usually going wrong

Length is a symptom. A prompt grows past ~500 characters for one of three reasons, and all three
are faults:

1. **Describing a process** instead of naming an action — the abstraction failure above.
2. **Restating what an attached picture already shows.** If a reference frame or a start frame is
   attached, the room, the wardrobe and the face are already decided. Words spent on them are
   words fighting the picture.
3. **Packing in more events** to fill the seconds. That is the freeze, arriving later.

## Checklist

1. Could a person watching the clip have written this sentence as its caption? If not, rewrite it.
2. Is anything described as a *process* — frames compressing, worlds rushing, light raking? Name
   the thing instead.
3. Is there exactly **one** dominant action?
4. Is the camera one plain sentence about where it is?
5. Is the look a list of concrete nouns, not a paragraph?
6. Under ~500 characters? If not, which of the three faults is it?

## Related

`h3-stitched-film` — how many clips, how they chain, the action budget, the joins.
`h3-prompt` — the model's section format (`integrated_multimodal_description`, soundscape,
retention) and when each mode applies. This skill writes the sentences that go *inside* it.
