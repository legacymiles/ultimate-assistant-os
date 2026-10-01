---
name: h3-scene-continuity
description: Make a film built from many generated video clips read as ONE continuous scene instead of a pile of clips — correct handover between shots, trimming each clip's warm-up and landing, carrying motion and audio across the join, anchoring against drift, and matching exposure at the cut. Use this WHENEVER clips are being stitched, chained, continued or extended into a longer film, and whenever someone says a stitched film "looks stitched", "looks like separate clips", "doesn't flow", "jumps between shots", "stalls before each cut", "the characters keep changing", "how do I make one continuous scene out of these", or asks about scene continuity, seamless stitching, infinite continuation, last-frame chaining, FL2VA/I2V chaining, or extending a clip. Written for MiniMax H3 (ComfyUI, WanGP, RunPod) but the diagnosis and most fixes apply to any image-to-video model. Also use it before building a multi-shot render pipeline, so the pipeline is built with handover in it rather than having continuity bolted on afterwards.
---

# H3 scene continuity

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


A film assembled from generated clips looks assembled for reasons that are
specific, separate, and **measurable**. Fixing the wrong one wastes hours of GPU
time, so this skill measures first and fixes second.

The single idea underneath everything here:

> **A generated clip does not begin or end where its file begins and ends.**
> It opens with a warm-up the model spends establishing the shot, and it closes
> with a landing where the model settles. The usable clip is the middle. A film
> cut on file boundaries is a film cut on the two worst moments of every shot.

Everything below follows from that.

## Step 0 — which half of this skill are you in?

This skill is two skills, and running the wrong half is wasted work.

| You have | You are in | Read |
|---|---|---|
| **A plan, no clips yet** | the plan-time half | the four constraints below, then go back to `film-plan` |
| **Rendered clips** | the post-render half | everything from Step 1 down |

**It is not a middle step.** A pipeline that runs this skill between planning and storyboarding
does nothing, because there is nothing to measure. Continuity is decided at *both ends* of the
render and never in the middle.

**The plan-time half** — four things that cannot be fixed after the fact, because they are facts
about the plan. They live in `film-plan` Part 7; they are repeated here so this skill is not the
place they get lost:

1. **Generate longer than the slot.** The warm-up gets trimmed and trimming costs duration, so
   a shot that must play for 5 s is planned at 6. (§2)
2. **Cap continued chains at 2.** A continued shot takes no reference photos, so a longer run has
   nothing holding identity. (§4)
3. **Anchor every few shots, not every shot.** (§4)
4. **Anchors and trimming ship together or not at all** — end-frame anchors are what *create*
   landings. (§2)

Everything else here needs mp4s.

## Step 1 — measure, before changing anything

Do not guess which defect you have. Run the bundled reporter on the clips of a
film that already looks wrong:

```bash
node scripts/continuity.mjs report clip-1.mp4 clip-2.mp4 clip-3.mp4
```

It prints per-clip motion (first 6 frames / first 12 / middle / last 12 / last
6), mean exposure, and what happens at each join. Read it against the table
below. The numbers are mean per-pixel frame-to-frame difference on a 0–1 scale;
what matters is never the absolute value but the **ratio between a clip's own
sections**.

| What you see in the report | The defect | Fix |
|---|---|---|
| first/middle/last all ≈ the same tiny number (< ~0.004) | **Dead shot** — a living photograph, not a shot | §6 |
| `first6` far below `middle` (3× or more) | **Warm-up ramp** — the shot starts from rest | §2 |
| `last12` far below `middle`, or the freeze detector locks | **Landing** — the shot stops before the file does | §2 |
| per-clip `luma` wandering between shots | **Exposure drift** | §5 |
| `B start-motion` ≪ `A end-motion` at a join | **Motion is not crossing the join** | §3 |
| identity/clothing/set changing down a chain | **Drift** | §4 |
| a visible tick at an otherwise continuous join | **Decode seam** | §7 |

A worked example of reading a real report — including the measurements that
produced the ordering of the fixes below — is in
`references/diagnosing.md`. Read it the first time you use this skill; the
report is much easier to read once you have seen one interpreted.

## Step 2 — fix in this order

The order is by measured payoff, not by elegance. Stop when the film is good.

### §1. One boundary, used twice

This is the rule the rest depends on, so it comes first even though it is not
itself a fix.

When shot A hands over to shot B there is exactly **one** frame of A that is
"the end of A". That frame must be used for both jobs:

- it is the last frame of A that the audience sees, and
- it is the last frame of the context B continues from.

If the visible cut happens at frame 150 but B was chained off frame 157, then B
continues from a moment the audience never saw, and seven frames of the film
happen twice or never. This is the most common way a pipeline breaks its own
continuity while looking correct in code — each half is defensible on its own.
Compute the boundary once, pass it to both the trim and the chain.

### §2. Trim the warm-up and the landing

The biggest win, and it costs no GPU time.

**The landing.** H3 does not stop a clip, it lands one: motion decelerates and
then the picture locks onto a final image which repeats until the frame count
runs out. Chain off that literal last frame and the next shot opens on a picture
that has already stopped moving — so the model has no motion to continue and
invents its own — while the frozen tail still sits in the cut, stalling the film
before every join.

Detecting it needs care. Plain low-motion detection cuts far too early, because
H3 decelerates long before it locks. A clip is landing when its trailing frames
*both* match a robust **median of the final frames** *and* have stopped moving
relative to each other. The bundled script implements this:

```bash
node scripts/continuity.mjs handover clip.mp4        # → JSON: handoverEndFrame, tailFrames, confidence
```

Important and easy to get wrong: **the landing is mostly an end-frame
phenomenon.** It appears when the model is given a last frame to converge onto
(FL2VA / `image_end`). Clips generated from a start frame alone often never lock
at all — measured on two real films, seven of twelve clips showed no lock. So if
you are not using end frames, expect the detector to report `no-lock` and fall
back to trimming a short fixed tail; that is correct behaviour, not a failure.
And note the corollary: **turning on end-frame anchors (§4) is what creates
landings**, so §4 and §2 ship together or not at all.

**The warm-up.** The mirror image, and more common: H3 spends its opening frames
establishing the shot before anything moves. Measured on real films, the first
six frames of a shot ran 9× and 15× slower than that same shot's body. Across a
dozen shots that is the film's entire rhythm: cut, stall, accelerate, cut,
stall.

Trim the head of any shot whose `first6` is far below its `middle`. Because
trimming costs duration, generate the shot **longer than the slot it has to
fill** and spend the surplus on the trim — do not trim a shot down to below its
planned length, especially when the film is cut to music.

### §3. Chain with motion, not with a still frame

A single frame carries position but no velocity. Even when the join frame
matches exactly, the model restarts from rest and the join reads as a hitch.

Prefer a continuation that hands over **real frames**, not one frame:

- **WanGP / H3:** pass the previous clip as `video_source` with
  `sliding_window_overlap` (valid values 1 + 17k: 1, 18, 35, 52…). The last
  `overlap` frames become genuine temporal context, and **audio carries across
  the join too** — which a still frame can never do, and which is why sound
  restarts at every cut in still-frame pipelines.
- **ComfyUI:** the H3 Infinite Continuation Suite's native Masked AV
  continuation copies the previous latent straight into the new target and
  protects it with per-stream denoise masks. Exact joint AV context lengths are
  39 / 90 / 141 / 192 frames; 39 (~1.6 s) is the recommended starting point.

Feed the continuation the **trimmed** clip from §2. Handing it the untrimmed
clip means the context frames are all landing tail — the model continues a
standstill, and you have paid for continuation while getting the still-frame
result.

Two consequences to build in:

- The returned clip **contains the handover frames again** at its head. Drop
  exactly that many frames when stitching, or every join stutters.
- Ask for `wanted + overlap` frames, since the overlap is spent on context. (The
  Continuation Suite calls this *Net New Content*; it is authoring convenience,
  not free — you sample a longer window and pay for it.)

Exact parameter shapes for each backend are in `references/backends.md`.

### §4. Anchor against drift

Over a chain, identity, clothing, set and exposure wander, because every shot is
continued from the one before and nothing pulls it back.

Give the chain a fixed reference to return to: supply a **last frame** for a
shot (`image_end`), reusing a clean, already-good frame. The shot is then forced
to converge on a known-good image, which resets composition, identity and image
quality before drift accumulates. Use one every few shots, not on every shot —
an anchor on every shot turns the film into a series of dissolves between
stills.

Also: **do not attach reference photos to a shot that is already being
continued.** The continued context and the reference images are two answers to
the same question, and the model will visibly split the difference. References
belong on shots that open a scene.

Remember §2: anchors are what create landings. Turn them on together.

### §5. Match exposure across the cut

Separately generated clips drift in brightness. Measured on a real film,
consecutive shots ran 0.24 → 0.40 → 0.28 mean luma — a 63% swing — so the film
visibly pumps at every cut regardless of how good the joins are.

Measure each clip's mean luma, take the film's median, and apply one **clamped**
global gain per clip (cap it around ±10%; a bigger correction means the shot is
wrong, not mis-exposed, and forcing it will crush or blow it). Where a clip was
continued from another, fade the correction out over the first ~16 frames so the
handover frames still match the clip they came from exactly.

### §6. Re-render the dead shots

A shot whose motion barely differs across its whole length is not a shot with a
continuity problem — it is a failed generation, and no amount of seam work will
save it. On two real films this was the single largest defect: three shots of
~6.5 s each were essentially still photographs, roughly a quarter of the running
time.

Detect it (`report` flags it), then re-render with:

- an action in the prompt that must physically happen within the shot's seconds
  — something that *changes state*, not a description of a scene that exists;
- a camera move named explicitly;
- a different seed.

Do not try to fix a dead shot in the edit.

### §7. Blend the two renderings at the seam

Worth understanding properly, because it looks like a crossfade and is not one.

At a continuous join, the outgoing shot's last *n* frames and the last *n*
frames of the incoming shot's duplicated head are **the same moments, rendered
and decoded twice**. Blending those two versions of one instant hides the
difference between the two decodes without softening any motion — there is no
second piece of content to double-expose. And because the blended frames replace
frames rather than being inserted, **the timeline length does not change**,
which is the only reason this is safe to do at all.

The Suite's recipe: n = 4 frames of video on a raised cosine
(`alpha = 0.5 − 0.5·cos(π·t)`, t from 0 to 1), plus a 15 ms equal-gain audio
de-click over the time-corresponding audio. Audio gets a much shorter window on
purpose: a long blend on speech smears it.

How much this buys depends entirely on how far apart the two renderings are, so
measure before assuming:

- **Decoding two latents separately (ComfyUI)** — the intended case. The same
  frames come back visibly different and the blend earns its place.
- **Handing the previous clip's real frames forward (WanGP `video_source`)** —
  measured at **0.4% mean pixel difference**, i.e. re-encode noise. The blend is
  harmless but close to pointless. Keep it switchable rather than assumed.

One implementation trap, if you build this in ffmpeg rather than on tensors:
`blend`'s `N` is documented as starting at 0 and (measured on ffmpeg 9.0.1)
arrives as **1** on the first frame. Without a `(N-1)` offset the whole ramp
shifts and the final frame falls *back* toward the outgoing shot instead of
landing on the incoming one — a visible hitch at exactly the moment the blend
exists to smooth. Verify the curve against a black-to-white pair before trusting
it: you want `0.000, 0.247, 0.749, 1.000`, monotonic.

## Prompting a continued shot

Continuation prompts fail in a specific way: they re-describe the scene, so the
model re-establishes it — new framing, new light, subtly new faces — and the join
breaks even though the mechanics were right.

Write a continued shot as **a transition, not a scene**:

- Say what *changes* during these seconds. The scene is already in the context;
  restating it invites the model to rebuild it.
- Never describe the handed-over context in the prompt. It is already in the
  latent. Describing it puts a second, weaker copy in play.
- Keep framing/lighting/lens language identical to the previous shot's when it
  should not change, and change exactly one thing when it should.
- Put speech where it can finish inside the shot. Audio that was never generated
  cannot be carried over — a word cut off at the source stays cut off.

## What not to do

- **Do not dissolve a continuous join.** A dissolve between two clips that are
  supposed to be one unbroken take double-exposes the motion and announces the
  seam you were hiding. A hard cut is right for an actual cut. What the
  Continuation Suite does at a continuous join is *not* a dissolve — see §7.
- **Do not chain every shot.** A film needs cuts. Continuity means a cut lands
  somewhere believable, not that there are no cuts.
- **Do not chase the seam when the shots are the problem.** Dead shots, wrong
  action, wrong pacing: fix those first. A perfect join between two bad shots is
  still two bad shots.
- **Do not raise motion by raising guidance or steps.** That buys fidelity, not
  movement. Movement comes from the prompt naming something that has to happen.

## Bundled script

`scripts/continuity.mjs` (Node ≥ 18, needs `ffmpeg` and `ffprobe` on PATH):

```bash
node scripts/continuity.mjs report  a.mp4 b.mp4 c.mp4   # the diagnostic table
node scripts/continuity.mjs handover a.mp4              # JSON handover boundary
node scripts/continuity.mjs plan     a.mp4 b.mp4 c.mp4  # JSON trims + exposure gains for a stitch
```

It is dependency-free and safe to copy into a pipeline verbatim — it detects
whether it is being run or imported, so a copy under another name still works.
A wired-in copy lives in the Ultimate Assistant OS repo at
`tools/studio-bridge/handover.mjs`, where Jarvis Studio's film renderer reads
every finished shot with it; `tools/studio-bridge/windows.mjs` next to it is the
matching trim/exposure arithmetic, with tests in
`src/lib/studio/stitchWindows.test.ts`.

## References

- `references/diagnosing.md` — a real report, read line by line, with the
  measurements behind the fix ordering.
- `references/backends.md` — exact continuation parameters for WanGP, ComfyUI
  (H3 Infinite Continuation Suite) and hosted H3 endpoints, plus H3's frame grid.

## Related skills

**`film-plan`** writes the plan and owns the plan-time half of this skill (Step 0).
**`shot-plan-storyboard`** draws that plan as the sheet the owner edits. All three read one
`Storyboard` object; none of them may hold a second description of the film.

One boundary worth carrying over from `film-plan` Part 6: **a film inside the model's window
(≤15 s) is a single generation and has no joins at all.** This skill's whole subject only exists
past that line. Do not stitch a film that never needed stitching.
