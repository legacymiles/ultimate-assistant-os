---
name: viggle-motion-swap
description: Replace one or more people in an existing video with different people, keeping the original motion, camera, wardrobe and background exactly as shot. Use this WHENEVER someone wants to swap a person, a face, an actor or a character in a video, put someone else in a clip, recast footage, or asks for a "motion swap", "video face swap", "deepfake-style swap" or "put this person in that video". Runs locally and free on WanGP via Viggle-Animate. Written after six failed approaches, every one of which looked like the model refusing rather than a setting being wrong.
---

# Viggle motion swap

Replacing a person in a video is **two models in sequence**, and the first one is the hard part.

```
frame of the clip ──► Qwen inpaint (masked) ──► edited frame ──► Viggle ──► swapped clip
                          new face in                             propagates
                       everything else frozen                    across all frames
```

> **Viggle does not accept a face photo.** Its own model definition says the reference image
> "must absolutely contain one frame of the Control Video where the main character will be
> replaced". The edited frame IS the instruction. So stage 1 is not optional, and every failure
> I had was in stage 1 while looking like a Viggle problem.

## Run it

```bash
node scripts/swap.mjs --clip fight.mp4 --face-left new-a.png --face-right new-b.png --out ./swapped
```

One person, whoever is in frame:

```bash
node scripts/swap.mjs --clip rap.mp4 --face new-a.png --out ./swapped
```

It pulls a frame, detects the faces, builds a mask per face, inpaints, runs Viggle, and writes a
before/after contact sheet next to the result. The studio bridge must be running
(`tools/studio-bridge`), because stage 1 goes through it.

## Stage 1: the frame edit, and the six things that must all be right

This is where every attempt failed. Getting five of six right fails in ways that read as "the
model won't do face swaps".

| setting | why, and what it looks like when wrong |
|---|---|
| `video_prompt_type: "VAG"` (+`"I"` with refs) | `V` = Control Image, `A` = its mask. **Not `"K"`** — `"KI"` is the *reference* choice in the same handler, and `"I"` alone makes the editor treat your frame as inspiration and **repaint the whole picture** |
| `image_mode: 2` | without it `image_output` is false, `V` resolves to Control **Video**, and WanGP rejects the job with *"You must provide a Control Video"* |
| `image_guide` | the frame being edited |
| `image_mask` | **this is what saves the background.** Outside the mask nothing can change, so preservation is structural instead of a polite request in the prompt |
| `resolution` = the frame's own size | forcing an aspect-ratio default (1360x768) onto an 832x480 frame is a request for a differently shaped picture, and the model answers it by composing a new one |
| steps that match the editor | **4 steps is Flux Klein's number, not Qwen's.** Qwen is not distilled, and at 4 steps its masked region came back a blurred smear; at 20 it came back a face. Klein at its own 4 is fine (see below) |

### Which editor: Flux is the cheap one, and it works

Both do it. Measured on the same two-person frame, same masks, same references:

| editor | steps | result |
|---|---|---|
| `flux2_klein_4b` | **4** (its own default) | both faces changed cleanly, background identical — **and it is the fast path** |
| `qwen_image_edit_plus2_20B` | **20** | both faces changed, slightly closer to the reference likeness |

So **start with Flux**, which is what the bridge runs by default and costs about a minute. Only
reach for Qwen at 20 steps if the likeness is not close enough, and know it costs roughly ten
times as long. Whichever is loaded, the six settings above still apply — what changes is only the
step count, and getting *that* wrong is what makes a working setup look broken.

The instruction itself is short and plain — the mask is doing the preservation work, so the long
"keep everything else exactly as it is" recital is wasted words:

```
Change the left man's face to the face in image 1 and the right man's face to the face in image 2.
```

**Verify stage 1 before spending an hour on stage 2.** Stack the source and the edit and look at
them. Outside the masks it should be pixel-identical; if the background moved, a setting is wrong
and Viggle will faithfully propagate the mistake.

## Masks come from InsightFace, not from coordinates

`scripts/facemask.py` detects every face and writes one mask each, **ordered left to right**, so a
user's words ("the left man", "the guy on the right") map onto indices without anyone reading
pixel coordinates. That ordering is what makes the whole thing promptable.

```bash
C:/pinokio/api/wan/app/venv/Scripts/python.exe scripts/facemask.py frame.jpg out/
# → out/mask-0.png, out/mask-1.png, out/mask-all.png, out/faces.json
```

Use **WanGP's venv** — it already has `cv2` and `insightface`, so there is nothing to install. A
system python probably has neither. Detection runs on CPU, which matters because the GPU is
usually mid-render.

Grow the box past the detected face (`GROW_UP 0.40`, `GROW_X 0.30`) or the old hairline and ears
survive and the result reads as a mask laid over someone. Feather the edge.

## Stage 2: Viggle

Its parameters are nothing like a normal video generation, so call WanGP directly rather than
bending an H3 render path:

```js
{
  model_type: "viggle_animate",
  prompt: "Prompt ignored. Don't write anything here.",   // literally ignored
  video_guide: "<the original clip>",
  image_refs: ["<the edited frame>"],
  video_prompt_type: "IVU",
  num_inference_steps: 3,
  flow_shift: 3.0, sample_solver: "euler",
  video_length: 124, sliding_window_size: 124, sliding_window_overlap: 18,
  guidance_phases: 1, guidance_scale: 1.0,
  image_refs_relative_size: 100, remove_background_images_ref: 0,
}
```

**The prompt does nothing.** Whatever a user types has to reach the *stage 1 edit*, never here.

## What it actually does, measured

On a 6 GB RTX 3050, 5-second clips at 832x480:

| | result |
|---|---|
| one person | every frame swapped, **same face throughout, no drift** |
| two people in one frame | both swapped **independently** — dark-haired left, blond right, no bleed |
| background, wardrobe, camera, timing | preserved |
| output size | **upscaled**: 832x480 in, 1248x736 out |
| cost | **~50–70 minutes per 5-second clip** (stage 2 only; the frame edit is ~1 min on Flux) |

That identity stability is worth noting: Viggle holds a face across a clip *better than a
generative video model holds its own*, because it is tracking rather than imagining.

The cost is the real constraint. An hour of GPU for five seconds makes this a deliberate tool for
a specific shot, not something to run across a whole film.

## Wiring it into an app where a user types a prompt

The split that makes this promptable:

| user says | which stage |
|---|---|
| who to replace ("the guy on the left") | picks a **mask index** from `faces.json`, left-to-right |
| who to replace them with | the **reference face** for that mask |
| anything about look, style, mood | the **stage 1 edit instruction** |
| anything about motion or camera | **ignored, correctly** — motion comes from the source clip |

So the app is: upload a clip, upload faces, show the detected faces as thumbnails from
`faces.json`, let the user pair each detected face with an uploaded one. No prompt engineering
reaches Viggle at all.

Degrade honestly when the detector finds nothing — a clip with no clear frontal face has no first
frame to edit, and saying that beats an hour of GPU producing nothing.

## Verify by watching, not by sampling

Build a before/after contact sheet at 2 fps and put them one above the other:

```bash
ffmpeg -v error -i before.mp4 -vf "fps=2,scale=300:-1,tile=5x2" -frames:v 1 before.jpg
ffmpeg -v error -i after.mp4  -vf "fps=2,scale=300:-1,tile=5x2" -frames:v 1 after.jpg
ffmpeg -v error -i before.jpg -i after.jpg -filter_complex vstack -frames:v 1 ba.jpg
```

A hand-picked still will flatter it. The grid shows whether the face holds for the whole clip or
only at the start, which is the one thing that actually matters here.

## Things worth knowing before promising anything

- **A real person in real footage is a real person.** Recasting genuine footage of identifiable
  people — especially anything showing harm — is not the same job as recasting your own footage,
  whoever's face goes in. Ask what the source is before running it.
- Viggle replaces a **character**, not a body type. A very different build changes the silhouette
  and the result fights the original motion.
- It needs a usable frontal frame to edit. Pick the frame where faces are largest and clearest,
  not simply frame 0.
- One clip at a time — this saturates a 6 GB card completely.

## Related

`h3-stitched-film`, `h3-long-story` — generating footage rather than recasting it.
`link-to-video` — getting the source clip in the first place.
