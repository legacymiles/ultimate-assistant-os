---
name: h3-stitched-film
description: Turn a short prompt plus images into several MiniMax H3 clips chained into one continuous film. Use this WHENEVER someone wants more footage than one generation holds — a film, a sequence, a multi-shot scene, "make this longer", "stitch these together", "continue this clip" — and whenever a stitched result came back frozen, jumpy, boring, or with the camera ignoring its instructions. Built from measurements on a 6 GB RTX 3050 running WanGP, so every rule here has a number behind it.
---

# H3 stitched film

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


One generation is 4–15 seconds. Everything longer is **several clips chained on real
frames**. This skill is how to plan those clips so the result is a film and not a pile.

Every rule below was measured. Where a rule exists because something failed, the failure is
named, because the failures are not obvious and I re-derived several of them the hard way.

## The one law

> **One clip does ONE thing. One dominant action, one camera move, no internal cut.**
>
> Stack two and H3 silently drops one. Stack four and it drops all four.

This is the whole skill. Everything else is consequence.

Measured three ways:

| asked for | got |
|---|---|
| 3 sequential actions in 5s | finished in 4s, then **froze for 80 frames** |
| 4 camera moves across 10s | **every move dropped**, camera sat still |
| **1** camera move in 5s, still subject | **executed fully** — a clean 90° orbit |

The freeze is the tell. A clip that runs out of story does not slow down, it **locks**, and
`continuity.mjs report` says `landing 80f (locked)`. If you see that, the clip was
over-packed, not under-prompted.

## What H3 obeys, and what it ignores

Prompting cannot fix the right column. Design around it instead.

| Reliably rendered | Silently ignored |
|---|---|
| Cutting to a new angle at a timestamp | **Speed of human locomotion** |
| One camera move per shot, in any phrasing | "Sprint" vs "jog" — by any wording |
| Framing, lens, aperture | Distance closing on a schedule |
| Light, grade, grain, flare | Anything entering from off-frame |
| Water, spray, rain, reflections, shadow | Several camera moves stacked in one clip |
| Identity from reference images | |

**Camera moves are NOT in the right column**, though an earlier version of this file said they
were. That claim came from a test with four moves across ten seconds of fast subject action —
six variables at once — and it was wrong. Isolated on one variable, a plain
`Track, large amplitude, fast speed` opened at 0.0667, right alongside every fancier phrasing.
What fails is *stacking*, and separately what fails is *sustaining* (see camera grammar below).

**Locomotion speed is the hard limit.** "Sprinting flat out" was tried as an adjective, then
as biomechanics (*"long airborne strides, knees driving high, arms pumping"*), then inside a
character block. All three rendered as a jog. A gap written as *"four body-lengths back at the
start and two by the end"* never closed.

So **never write a shot whose meaning depends on how fast a body moves.** Shoot around it:

- Frame out the gait — legs at waterline, hands, a shoulder, spray on the lens. The best frame
  measured all day was a boot hitting water with no face and no full body in it.
- Let the *world* carry speed — water bursting, light raking, a shadow racing.
- Keep full-body wides short, and never ask them to communicate urgency.

And **never a toddler, a fall onto a body, or two people making contact.** Adult sprinting is
richly represented in training data; a one-year-old's waddle is not, and it rendered with an
adult stride on a baby's body — uncanny in a way no amount of prompting fixed.

## The clip plan

For a film of N seconds, plan `ceil(N / 5)` clips. For each one write exactly:

```
ACTION   one thing that physically changes
MOVE     one, from the vocabulary, or "none"
FRAME    lens, height, how much of the body is in it
LIGHT    what changes in the light, if anything
SOUND    what the microphone hears
```

If a clip needs two lines in ACTION, it is two clips.

**Write the camera as a plain sentence.** This is the rule; everything below it is secondary.

Measured on one identical opening frame, same subject, same five seconds:

| prompt | chars | opening | did it turn? |
|---|---|---|---|
| "the entire world rolls hard to the left - the horizon tips over, the rooftops swing down across the top of frame and the road swings up the other side" | 1321 | 0.0772 | **no** |
| "A bird flies fast down a narrow brick alley and turns left around the corner. The camera flies right behind it, close." | **226** | 0.0647 | **yes** |
| "tilts onto its side to fit through a gap between two vans" | 319 | 0.0829 | **yes, visibly banked** |

**A quarter of the words, and only the short ones produced the turn.** These models learned from
video CAPTIONS - plain sentences with action verbs. Nothing in their training data was ever
written the way a cinematographer briefs a crew, so prose about frames compressing and horizons
tipping is a register the model has never seen.

```
NOT   the entire world rolls hard to the left, the horizon tips over
YES   it tilts onto its side to fit through a gap between two vans

NOT   the camera races forward, the tunnel walls compressing behind her
YES   the camera flies right behind her, close
```

`h3-cinematic-prompt` owns this in full. Read it before writing any shot.

### The secondary trick: who the sentence is about

Where two phrasings are equally plain, the one whose **subject is the world** sustains motion
longer than the one whose subject is the camera:

| phrasing | opens | ends |
|---|---|---|
| `Track, large amplitude, fast speed` | 0.0667 | **0.0138** |
| "the world rushes past the lens" | 0.0714 | 0.0785 |

A camera operation has an implied completion - H3 finishes it and coasts. This is real, and it is
worth reaching for when a clip dies early. But it is a tiebreak between plain phrasings, **not a
licence to write paragraphs**, which is exactly the mistake the table above records.

**Camera vocabulary**, appended after the plain sentence - it costs nothing and sometimes helps:

```
Orbit, large amplitude, slow speed
Crane Up, large amplitude, slow speed
Push In, large amplitude, fast speed
Whip Pan, large amplitude, fast speed
```

Amplitude is `small` or `large`, speed is `slow` or `fast`. There is no `medium`. Prefer `large`:
a film of `Push In, small amplitude` shots is a film where the camera does nothing, which is what
"it's boring" means.

**One move per clip.** Four stacked across ten seconds got all four dropped. One executes,
including a plain `Track, large amplitude, fast speed`.

## What must already be moving

H3 continues motion that exists in frame one and fails at motion it has to introduce.

| asked | result |
|---|---|
| a runner already running | moves, at the model's own tempo |
| a gap closing "four body-lengths to two" | never closed |
| a goat entering from off-frame to cross a lot | **materialised at the target, no approach** |
| a boat already carving across frame | rendered perfectly |
| a bird already in flight, world streaming past | the fastest motion measured |

So **whatever must move has to exist and be moving in the opening frame**, and nothing important
may enter from off-screen. If something has to arrive, give it its own clip with its own drawn
first frame showing the arrival already underway — a cut, not a chain. The model finishes
motion; it does not stage it.

## The chain

Clip 1 opens on a drawn frame. Every clip after it continues from real frames of the one
before.

**Clip 1** — `I2VA`, with the instruction line exactly:

```
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

**Every later clip** — no instruction line and **no reference images**. The inherited frames are
the conditioning; adding pictures gives H3 two answers to one question.

That is why the **character block rides on every clip**, chained or not:

```
NAME (Image 1) — age and role, features with texture; wearing …; build. How they move.
```

The frames hold the faces. The block holds the build and the movement signature, and it is the
only thing distinguishing two people once the pictures are gone. Written without it, two
runners render as the same person twice.

## The join

Measure it. Do not eyeball it.

```bash
node continuity.mjs report shot-1.mp4 shot-2.mp4
```

The number that matters is **ratio** — clip B's opening motion over clip A's closing motion.

| ratio | reads as |
|---|---|
| ~1.0 | invisible |
| 0.66 | good |
| **3.6+** | a jolt; the cut announces itself |

A join blows out when clip B opens on something explosive. *"She drives up out of the water"*
measured 3.58 and 3.71 on two separate films. **Open a chained clip on continuing motion, not
on a new burst** — the burst belongs a second in, once the join has passed.

Watch `luma A→B` too. A 20% jump at the same instant as a motion jump makes one cut look like
two.

## Cost, measured

On a 6 GB RTX 3050, 832×480, 10 steps, no turbo LoRA:

| what | s/frame |
|---|---|
| 124 frames, 4 reference images | **7.3** |
| 124 frames, chained | **10.6** |
| 345 frames, 4 references | **19.7** |

Three things follow, and the first two reverse what seems obvious:

- **References are cheap** — about 13% over a bare clip at the same length, not 3×.
- **Chaining is dearer than referencing.** A continued clip renders its own frames plus the
  overlap it inherits.
- **Length is superlinear.** 2.8× the frames cost 2.7× more *per frame*. A 15-second
  generation took 113 minutes; three 5-second clips covering the same time take about 45.

So: **short clips chained, always.** Better anchored and dramatically cheaper.

**Never test a setting on a long render.** A 15-second experiment ran 2h45m, died with the
machine, and wrote nothing — H3 only writes on completion, there is no checkpoint. Five
seconds answers the same question in fifteen minutes.

## Order of work

1. Write the clip plan — one ACTION each. Count them; if a clip has two, split it.
2. Draw clip 1's opening frame. It is frame one of the film, so composition set here is the
   only composition you reliably get.
3. Render clip 1, look at it, and stop if it is wrong. Everything downstream inherits it.
4. Chain the rest, one at a time.
5. `continuity.mjs report` across every clip. Check `verdict` is `ok`, no `locked` landings,
   and every ratio under ~1.5.
6. Watch it before saying it is good.

## Reading the report

```
clip        n   first6  middle  last6   luma    verdict
shot-1.mp4  124 0.0119  0.0264  0.0128  0.2025  ok
```

- `middle` under ~0.010 — nothing is happening; the clip is a moving photograph.
- `last6` far under `middle` — it ran out of story and is dying into the cut.
- `landing Nf (locked)` — **over-packed**. Cut an action.
- `warm-up Nf` on a chained clip — the handover failed; it restarted instead of continuing.

## Related

`h3-prompt` owns the prompt format for a single generation. `h3-scene-continuity` owns repair
after the clips exist. This skill owns the plan that stops most of that repair being needed.
