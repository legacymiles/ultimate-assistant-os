---
name: h3-cinematic-prompt
description: Write the actual sentences that go to a video model — MiniMax H3, Hailuo, Seedance, Kling, Veo — so a shot comes back cinematic instead of flat, frozen or straight-lined. Use this WHENEVER writing or fixing a video prompt, and especially when a clip came back boring, static, ignoring the camera direction, or when the prompt has grown into paragraphs of description. Written from measured comparisons on real renders, including several where the elaborate version lost to two plain sentences.
---

# Writing the prompt

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

## One action per clip — this does not change

Plain language fixes the *wording*. It does not buy more events.

A clip written plainly with three actions — *"tilts onto its side, then rolls level and turns
left"* — still finished early and **froze for 25 frames**. The action budget is separate and
absolute: one dominant action per shot, and a clip needs slightly more than it can finish so it
ends mid-motion rather than on a completion.

See `h3-stitched-film` for the budget, the freeze verdict and how clips chain.

## The camera

One sentence, plainly. Where it is and what it is doing relative to the subject:

```
The camera flies right behind it, close.
The camera is low at the kerb and whips round to follow it past.
The camera circles her slowly.
The camera is on the bonnet looking back at her through the windscreen.
```

Not travel distances, not focal lengths at each end, not what the frame does. **Where it is, and
what it follows.** A named move from the model's own vocabulary can be appended and costs
nothing, but the plain sentence is what carries it.

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
