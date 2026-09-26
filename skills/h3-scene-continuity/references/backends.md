# Continuation parameters, per backend

## MiniMax H3's frame grid

H3 runs at **24 fps** and generates in whole latent windows, so a clip never
comes back as exactly the length you asked for.

- ComfyUI's H3 uses a `17k + 5` total-frame grid: 10.0 s → 243 frames (~10.125 s).
- WanGP's H3 window starts at 107 frames and grows by 17: `107 + 17k` → 107, 124,
  141, 158, 175, 192, 209, 226… (4.46 s to 15 s).

Consequences worth building in rather than discovering:

- A shot asked for as 5.00 s comes back as 5.167 s. On one clip that is
  invisible; over a dozen it puts the picture the better part of a second behind
  a soundtrack. If the film is cut to music, trim every clip back to its planned
  slot in the same pass that concatenates them — it costs no extra encode.
- The surplus between what you asked for and what the grid gives you is free
  material to spend on warm-up/landing trims.

## WanGP (local, free — Pinokio install)

Model types: `minimax_h3_fl2va_pruned` (first/last frame) and
`minimax_h3_ref2va_pruned` (reference images). `image_prompt_types_allowed` is
`TSEVL`, so text, start frame, **end frame**, video continuation and last-frame-
of-source are all available; WanGP infers `image_prompt_type` from which media
keys you actually supply.

**Still-frame chaining (weakest — position but no velocity, and no audio):**

```js
{ image_start: [absolutePath], image_prompt_type: "S" }
```
WanGP shares exactly one frame with a start image, so the stitch drops 1 frame.

**Video continuation (preferred — carries motion and audio):**

```js
{
  video_source: absolutePathToHandoverClip,
  keep_frames_video_source: String(overlap),   // counted from frame 0 of the source
  sliding_window_overlap: overlap,             // valid: 1 + 17k → 1, 18, 35, 52…
  sliding_window_size: videoLength,
  video_length: wanted + overlap,              // the overlap is spent on context
  image_prompt_type: "V",
}
```

Two behaviours to build around:

- `keep_frames_video_source` keeps the **first** N frames of the source, not the
  last. So cut a dedicated handover clip containing exactly the frames you want
  to hand over — the last `overlap` frames ending at the §1 boundary — and point
  `video_source` at that, rather than at the whole previous clip.
- The returned file is **the kept prefix followed by the newly generated
  frames**: output length = `keep + (video_length − overlap)`. With
  `keep == overlap` the first `overlap` frames of the output are byte-for-byte
  the handover frames. Drop exactly that many when stitching.

**Anchoring (quality reset):**

```js
{ image_end: [absolutePath], image_prompt_type: "VE" }   // or "SE" when chaining off a still
```

## ComfyUI — H3 Infinite Continuation Suite

`github.com/HerrgottMargott/Herrgotts-H3-Infinite-Continuation-Suite` (GPL-3.0).
Requires a ComfyUI build with native per-stream H3 denoise masks (PR #15375).
This is the most correct implementation of H3 continuation that exists publicly:
it copies the previous **latent** into the new target and protects it in place,
rather than asking the model to reconstruct the previous clip from guide rows.

Recommended baseline from the project, worth copying rather than re-deriving:

```text
Continuation:            Native Masked AV (H3ContinuousContinueV14)
Masked video context:    39 frames          (exact joint AV lengths: 39/90/141/192)
Duration mode:           Net New Content
Audio tail carryover:    Full Previous Tail
Audio feather:           0 ticks
Auto Handover:           Balanced
Video crossfade:         4 frames           (decode seam only)
Audio de-click:          15 ms
Boundary luminance match: Off               (the freeze-safe handover removed the need)
```

Notes that transfer to any backend:

- 39 frames ≈ 1.625 s at 24 fps = 12 video-latent steps = 65 audio-latent ticks
  at H3's 40 Hz audio latent rate. The context lengths are not arbitrary; video
  and audio only share exact boundaries at 39 + 51k.
- Video and audio continuity are **related but separate timing problems**. The
  visual handover may have to cut early (before a landing) while a spoken word
  is still finishing; the suite protects the audio tail independently so a line
  is not truncated because the picture had to cut. If your backend cannot
  separate them, write dialogue that finishes inside the shot.
- The protected context is **not** a reference image. Do not also describe it in
  the prompt or attach it as a reference — see the skill's prompting section.

## Hosted H3 (RunPod and similar)

Hosted endpoints are usually `first_frame` only: no end frame, no video source.
That restricts you to still-frame chaining, which means:

- §3 (motion across the join) is not available — accept it, and lean harder on
  §2, trimming the warm-up so the restart-from-rest is at least short.
- §4 anchoring is not available either, so exposure/identity drift must be
  handled entirely in the edit (§5), and chains should be kept short: prefer
  several short chains separated by real cuts over one long chain.
- Audio will restart at every join. If the film carries a soundtrack as master,
  this matters much less — drop the clips' own audio and let the track carry the
  continuity.

## Other image-to-video models

The diagnosis in `diagnosing.md` and §1, §2, §5 and §6 apply unchanged to any
model that generates fixed-length clips from a still. §3 and §4 depend on the
backend exposing video continuation and end-frame conditioning respectively;
check for those two capabilities first, because they decide how much continuity
is achievable at all.
