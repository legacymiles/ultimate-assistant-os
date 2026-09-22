---
name: h3-scroll-world
description: >
  Builds an immersive scroll-scrubbed "fly through the world" landing page for any
  industry or brand, with MiniMax H3 rendering every video clip and OpenRouter
  generating the scene stills. As the visitor scrolls, a pre-rendered camera flies
  through each scene and on into the next with NO cuts — one continuous connected
  flight (Emons-style isometric diorama world, photoreal walkthrough, or any art
  direction). Interviews the user for the topic, story beats and brand kit, generates
  cohesive stills, frame-chains H3 clips so every seam is frame-identical, and wires a
  portable, framework-agnostic scroll-scrub engine. This is the H3 port of the
  scroll-world skill. Use when the user says "h3 scroll world", "cinematic scroll
  website with H3", "seedance website but with H3", "fly-through landing page",
  "scroll-scrubbed video website", "3D world landing page", "MiniMax H3 website", or
  wants a "browse-through-the-industry" hero, a scroll cinematic, a diorama landing, or
  to turn a business into a scrollable world.
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, Skill
---

# h3-scroll-world

> **Provenance.** Forked from [oso95/scroll-world](https://github.com/oso95/scroll-world)
> (MIT — see `LICENSE.upstream`). The upstream skill rendered video with Seedance 2.0
> via Higgsfield/Monid; this port renders all video with **MiniMax H3**
> (`scripts/h3.mjs`) and all stills with **OpenRouter** (`scripts/still.mjs`). The scrub
> engine, knockout script and page template are unchanged.

Produces a landing page where **scroll drives a camera**: it glides through a scene and on
into the next, continuously, with no visible cuts. The visuals are AI-generated — stills
via OpenRouter (Gemini image), the video chain via MiniMax H3 — and the page just scrubs
pre-rendered video by scroll position. This is the same technique behind Apple's
scroll-through product pages — the camera genuinely moves, scroll only drives time.

**What you generate:** N scene stills → a chain of H3 clips whose seams are
frame-identical (architecture A: N sequential forward legs; architecture B: N dives +
N-1 connectors) → a portable scrub engine that plays the whole chain as one flight.

**The one rule that makes or breaks it:** seams must be *frame-identical*. Every chained
clip starts on the **actual rendered last frame** of the clip before it — never on a
fresh still. Read [Step 4](#step-4--camera-architecture-implements-the-step-14-choice)
and [Step 5](#step-5--connectors-architecture-b-only) before rendering anything. Getting
this wrong is the single most common failure and produces a visible "pop" between scenes.

Do not assume a frontend framework. The scrub engine in `references/scrub-engine.js` is
self-contained vanilla JS (it builds its own DOM + injects its own CSS into a container
you give it), so it drops into plain HTML, Next.js, Vue, a Python-served page, anything.
The value of this skill is the pipeline, the prompts, and the seam method — not the
framework.

---

## Step 0 — Bootstrap

`SKILL=~/.claude/skills/h3-scroll-world` (the scripts live in `$SKILL/scripts/`).

1. **H3 backends.** Run `node "$SKILL/scripts/h3.mjs" --check` — it prints which
   backends are configured and whether the RunPod endpoint is healthy. Keys come from
   the process env → `./.env.local` → the owner's hub `.env.local`
   (`C:/Users/honey/OneDrive/Desktop/claude code files/.env.local`).

   | Backend | Env | first_frame | last_frame | Status for this owner |
   |---|---|---|---|---|
   | `runpod` (default) | `RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_ID` | ✓ | ✗ | configured; first job after idle cold-starts for several minutes (~40 GB weights load) |
   | `minimax` (hosted) | `MINIMAX_API_KEY` | ✓ | ✓ | not configured yet |
   | `gateway` (Vercel AI Gateway `minimax/minimax-h3`) | `AI_GATEWAY_API_KEY` | per gateway | per gateway | fallback |

   Auto-order when `--backend` is omitted: runpod → minimax → gateway. The
   `last_frame` column decides the camera architecture (Step 4): **architecture A works
   on every backend; architecture B needs `minimax`.** If a needed key is missing, add a
   blank `MINIMAX_API_KEY=` line to the hub's `.env.local`, show the owner that line,
   and wait — never paste keys into chat.
2. **Stills.** `node "$SKILL/scripts/still.mjs"` needs `OPENROUTER_API_KEY` (configured).
   Default model `google/gemini-3.1-flash-image` (override with `--model`).
3. **ffmpeg.** Not on PATH on the owner's machine; the hub ships one at
   `C:/Users/honey/OneDrive/Desktop/claude code files/node_modules/ffmpeg-static/ffmpeg.exe`
   (verified: 6.1.1 with libx264, libwebp and the psnr filter). The pipeline resolves it
   into `$FFMPEG` (pipeline.md top) — always call `"$FFMPEG"` quoted (the path has
   spaces). There is **no ffprobe**; use `node "$SKILL/scripts/probe.mjs" <file>`
   (prints `{width,height,fps,duration,frames}`). Installing ffmpeg properly
   (`winget install Gyan.FFmpeg`) is nicer but optional — mention it once.
4. **Python + Pillow** — only if you use `references/knockout.py` to float the scenes
   (Step 3). Optional.
5. Caveats: H3 renders take minutes — always run generation scripts detached
   (background) and poll the log, never a foreground blocking call. Pass **local file
   paths** to `--first-frame` / `--last-frame` / `--ref`; the scripts handle upload and
   downscaling. The owner runs **Git Bash on Windows**: the pipeline scripts are plain
   bash, but paths may contain spaces — quote everything.

---

## Step 1 — Interview the user

The **subject is the user's to state — ask it as an open question in plain prose**, never a
fabricated multiple-choice. A made-up list of industries biases them and reads as you
deciding their business for them; let them answer in their own words (their real business,
a client's, or any idea). Reserve structured multiple-choice (`AskUserQuestion` in Claude
Code; a plain either/or question elsewhere) for the genuinely enumerable, lower-stakes
choices below — art direction, camera style, and brand-kit approach — and even there,
signal they can go their own way ("Other"). Ask only what you can't sensibly default.
Cover:

1. **Subject** (ask openly, not multiple-choice) — "What should this world be about? Your
   business, a client's, or any idea — a word or a sentence is fine." Capture the
   industry/product + a one-line pitch (e.g. "a bubble tea company, from leaf to last
   sip"), and a brand name if they have one; otherwise you'll propose one below.
2. **Brand kit** — offer three paths, pick one:
   - Import from a URL: fetch the site (WebFetch, or the page's CSS) and pull the name,
     dominant colours and tone; read it back to the user for approval.
   - The user hands you palette + name + tone directly.
   - You propose a palette + name and let them approve.
   Capture **4–6 named hex values**, a display name, and a tone word or two.
3. **Art direction** — default is "soft matte low-poly **clay diorama**, isometric,
   tilt-shift miniature, warm light." Offer alternatives (flat papercraft, glossy toy,
   claymation, neon night, photoreal architectural). Whatever is chosen becomes the
   shared **style preamble** reused verbatim in every scene prompt (this is what makes
   the world cohesive).
4. **Camera style — ALWAYS ask; it's the film's personality, not a technical
   detail.** Ask by feel and record the answer as `CAMERA`. The options map to the
   Step 4 architectures — Step 4 then *implements* the choice, it never re-decides it:
   - **"One continuous walkthrough"** — a single forward flight that glides through
     each scene straight into the next, never pulling back; expressive but
     always-forward moves per scene (camera grammar table). → Architecture A. **The
     default** — works on every H3 backend, including the owner's RunPod endpoint.
   - **"Locked isometric glide"** — the camera keeps one fixed angle for the whole
     film, Emons-style; the world slides past/toward it, no rotation, no reveals.
     → Architecture A + the locked-iso clause in every leg prompt (prompts.md). Also
     works everywhere.
   - **"Fly through the world"** — the camera dives into each scene, pulls up and
     out, and hops across the miniature world to the next; big expressive aerial moves.
     → Architecture B. **Needs the MiniMax hosted backend** (`MINIMAX_API_KEY`) because
     its connectors must land on an end frame. If the key isn't set, say so: the owner
     adds it to `.env.local`, or picks A.
   State the trade-off in one line each (B reverses direction at seams — charming in
   miniature, jarring in realism, and needs the hosted key; locked-iso is the calmest
   and cheapest to re-roll; walkthrough sits between).
5. **The journey (sections)** — the ordered scenes the camera flies through. Propose a
   set derived from the subject's own value chain and let the user edit. 5–7 works well.
   Boba example: farms → pearl kitchen → flagship shop → delivery → community plaza →
   the hero product. Each section needs: a short subject description (what's IN the
   scene), an eyebrow, a headline, one line of body, and 0–3 tag pills. The last
   section is usually the hero product + the CTA.
6. **Mobile version — ALWAYS ask this; never silently generate both.** Ask as a
   two-option choice:
   *"Want a mobile-optimized version too? The mobile version is a second camera chain
   rendered natively in **9:16 portrait** — composed for phones, not a crop of the
   landscape film — which doubles the number of H3 clips (state the estimated dollar
   figure from Step 1.7)."*
   Options: "Desktop only" / "Desktop + mobile (native 9:16 — ~2× clips)". The cost must
   be stated to the user, not just implied.
   What the answer gates:
   - **Yes** → render the parallel 9:16 portrait chain and ship it as the mobile variants
     (Step 6 / pipeline.md §6b): portrait start canvases → 9:16 legs (or dives +
     connectors) frame-locked against their own renders → 720-wide `-m.mp4` encodes →
     `stillMobile` portrait posters. Wire `clipMobile`/`connectorsMobile`/`stillMobile`
     (Step 7); run the full mobile QA (Step 8). **Never ship the centre-crop as the
     mobile version by default** — if the budget can't cover the portrait chain, say so
     and offer the crop encodes (pipeline.md §6) as an explicitly-labelled stopgap the
     user must approve.
   - **No** → skip the mobile encodes and wiring entirely. The engine's phone hardening
     (seek-coalescing, iOS priming, safe-area CSS) is always on regardless — that's not
     a "mobile version," it's just the page not breaking when a phone visits.

7. **Budget — decided before anything renders.** Ask **draft vs final**, then compute
   and state the estimated total and get a go before generating:
   - **Draft / previz** — 768P, 6 s legs (6 s dives, 4 s connectors). Validates the
     journey and every seam cheaply; the owner approves, then the final re-renders on
     the same backend.
   - **Final** — 2K **only where the backend confirmed 2K** (use 768P unless 2K was
     confirmed — the owner's RunPod worker may be 768P-only), 8–10 s legs (8 s dives,
     5 s connectors).
   - **Clip count:** arch A = N legs; arch B = N dives + (N−1) connectors; ×2 if mobile;
     + ~15% re-roll headroom (+1 per expressive leg).
   - **Cost per clip:** the owner's RunPod endpoint bills GPU seconds only while
     rendering — roughly $0.4 per clip; MiniMax hosted ≈ $0.41 per clip. So an N=6
     desktop arch-A chain is ~7 clips with headroom ≈ **$3**; arch B ≈ 13 clips ≈
     **$5.5**; double for mobile. Stills are a few cents each on OpenRouter (check its
     activity page for the exact figure).
   - **Calibrate, don't guess.** `h3.mjs` prints the render `seconds` per clip — after
     the first clip, multiply out and restate the estimate if it moved. The frame-lock
     probe (pipeline.md §0) doubles as this calibration clip.

If the user names a different video model, honor it **only if it can frame-lock seams**
(accepts a first frame and continues from it; plus a last frame for arch B connectors).
This skill only ships seamless output, so a model that can't is declined with a one-line
why, not substituted in.

Keep the scroll mechanic fixed (continuous fly-through) — that's the point of the skill.
See `references/prompts.md` for the intake checklist and copy structure.

---

## Step 2 — Generate the scene stills

One image per section, **all sharing the same style preamble** for cohesion, via
OpenRouter (`google/gemini-3.1-flash-image`, one image per request):

```
<STYLE PREAMBLE, identical every time>. On a plain solid <bg> background with a soft
contact shadow. <PALETTE hexes>. No text, no letters, no logos, centered.
Subject: <what is in THIS scene>.
```

- **Scene 0 first, then scenes 1..n with scene 0 as a style reference:**
  `node "$SKILL/scripts/still.mjs" --prompt-file still_i.txt --out still_i.png --aspect 16:9 --ref still_0.png`.
  The reference + an explicit "match the art style, lighting, camera angle and palette
  of the reference image; this is a different place in the same world" sentence is what
  keeps the world cohesive. Up to a few `--ref`s are allowed; the script downscales them
  (the owner hit a ~4.5 MB request limit).
- Generate at **16:9** (9:16 for the mobile chain) — the still is the first frame of a
  16:9 clip, so it should already be 16:9.
- Run a few concurrently, detached (pipeline.md §1). A generation may fail transiently —
  re-roll that one; don't restart the batch.
- **Review the stills before continuing.** They must read as one cohesive world (same
  angle, palette, light). If one is off-style, regenerate it with an approved scene as
  `--ref`.
- Photoreal direction: the reference must be framed as *style only* ("a different
  room") or the model clones the same room (prompts.md).

See `references/pipeline.md` for the exact batch script.

---

## Step 3 — (Optional) Float the scenes

If you want the dioramas to float over an atmospheric background instead of sitting in a
solid box, knock out the flat background to transparency with
`references/knockout.py` (border-connected flood fill — preserves interior colour that
matches the bg, e.g. cream walls). Then encode to webp (`"$FFMPEG" … -c:v libwebp`,
pipeline.md §1). If you'd rather keep it simple, just make the page background the same
colour as the scene background and skip this.

These stills double as **video posters and lazy-load fallbacks**, so keep them.

---

## Step 4 — Camera architecture (implements the Step 1.4 choice)

How the camera moves *between* scenes is the single biggest quality lever. The user
already chose the style at the interview (`CAMERA`, Step 1.4): walkthrough → **A**,
locked-iso → **A + the locked-iso leg clause** (prompts.md), fly-through → **B**. If the
interview somehow skipped it, ask now — never silently pick for them.

### Video backend — ONE for the whole chain

Every clip in the chain is MiniMax H3 in **keyframe mode** (first frame, plus last frame
for arch B connectors). Pick one backend for every chained clip (`BACKEND` in
pipeline.md):

- **Arch A → `runpod`** (default; the owner's own endpoint) or any other configured
  backend. Only first frames are needed.
- **Arch B → `minimax` for the whole chain.** Connectors need `--last-frame`, which only
  the hosted API supports (`--last-frame` on runpod exits with a clear error). Render
  the dives there too: the same model served by different stacks can differ in grain,
  colour and motion character, and mixing them across a seam is **untested** — if you
  ever must (e.g. rescuing a stranded chain), eyeball the first mixed seam before
  rendering the rest.
- **Reference mode** (`subject_definitions` / `<Subject 1>` labels) is mutually
  exclusive with keyframe mode and **can't hold a seam** — it conditions a generation,
  it doesn't continue a shot. Only use it for an optional standalone hero clip where a
  product must stay identical (prompts.md → Reference mode).

**Measured 2026-09-19 on the owner's RunPod H3 (768P, 16:9, 6 s, first_frame only):**
the output canvas is **1344×768 @ 24 fps** (5.88 s = 141 frames). A 1376×768 OpenRouter
still came back **scaled, not cropped**, with frame 0 visually identical to the still
(25.7 dB PSNR, lowered by the resize + VAE; a centre-crop comparison scored 17 dB, which
is how we know it scales). The forward-glide prompt was obeyed: street → through the
open door → to the pastry counter in one take, no cut. The render took 4.6 min on a warm
worker. So: **generate stills with `still.mjs --fit 1344x768`** (9:16 → `768x1344`) so the
seed matches the output canvas. Leg-to-leg seams start from a real 1344×768 last
frame, so they don't have the resize loss. A connector (last_frame) probe on MiniMax
hosted has NOT been run.

**Frame-lock qualification — re-check on a new backend or resolution.** Before rendering a full chain, run the probe in pipeline.md §0:
one short draft clip from a real still, then compare the output's frame 0 to the input
still. **PSNR ≳ 30 dB** (and the same composition) = frame-locked; chain on that
backend. Well under, or a visibly re-composed opening = the backend is conditioning,
not continuing — seams will pop; don't chain on it. For arch B also probe a connector
(`--last-frame` a different still → the end must land on that composition; a near-miss
with the same composition is fine, the engine's seam crossfade covers it). Record the
measured numbers in the build notes.

### A) Continuous forward take — the DEFAULT (grounded / realistic / walkthrough / locked-iso)
One camera that only ever glides **forward**, first scene through last, as a single take.
Generate the legs **sequentially**: leg 0 from scene-0's still (glide forward into it);
then each leg's `--first-frame` = the **previous leg's ACTUAL last frame** (extract with
ffmpeg), brief *"the camera continues the same slow, steady forward glide into [scene
i]"* (or an expressive mid-leg move under the motion-handoff contract — see **Camera
grammar** below), and **no `--last-frame`** — an end frame of a wide establishing shot
would force the camera to pull back, the #1 cause of stutter. Result: every seam is
frame-identical **and** the camera never reverses. There are **no connectors** (skip
Step 5) — the legs ARE the journey. Wire each leg as a section clip with
`connectors: []` and a small `crossfade` (~0.08). Even without an end frame the legs
still arrive at distinct places (the brief steers the content). Cost: strictly
**sequential** (can't parallelize) and slower; build in re-rolls (3 attempts/leg).

Posters in arch A: use each leg's **first frame** as the section `still`, so the poster
matches the frame its clip opens on (scenes 1..n's generated stills were style guides —
the video never starts on them).

### B) Dive-in + aerial connector — only for diorama / miniature / god's-eye worlds
A "dive into each scene" clip + a connector that pulls **up and out** and flies over to the
next scene (Step 5). The pull-out **reverses camera direction at every seam** (forward dive
→ backward pull-out). In a miniature/diorama world that reads as an intentional "zoom out
to the map, fly to the next island"; in a grounded first-person walkthrough it reads as a
jarring **rewind/stutter**. Use B only for the map-like aesthetic — which is exactly what
the "fly through the world" interview answer opts into. If the user picked B against a
grounded/photoreal direction, say why it will read as a stutter and confirm before
rendering. Requires `BACKEND=minimax`.

### Camera grammar — the move should fit the concept (A is NOT "forward only")

"Forward only" is the *seam* rule, not the *leg* rule. The physics of the chain:

- **Position continuity** at a seam comes from the frame handoff (next leg starts from the
  previous leg's actual last frame).
- **Velocity continuity** at a seam means the camera must never *reverse across a seam* —
  that's the rewind stutter.
- **Inside a single leg the camera is free.** One leg is one continuous render — there is
  no seam to break mid-leg, so orbits, crane-ups, lateral tracking, even a push-in that
  eases back out are all safe *within* the clip. Reversals are only fatal *across* seams.
  (That is also why every brief says "no cuts": an in-clip cut is a seam H3 invented.)

So give each leg an expressive move chosen from the scene's own logic, under a **motion
handoff contract**: every leg **ends by settling into a slow, steady forward drift** toward
the next destination (final ~1 s), and every leg **begins by continuing that same drift**.
Keep both clauses in the briefs verbatim (templates in `references/prompts.md`). H3 takes
camera direction as a prose sentence with **amplitude + speed** ("glides forward with
medium amplitude at a slow, steady speed") — not bracket tags.

Pick the grammar from the concept:

| Concept / tone | Mid-leg move |
|---|---|
| Product / luxury retail | slow half-orbit around the hero object, then continue past it |
| Real estate / hospitality | steadicam glide through doorways; gentle crane-up in atria |
| Industrial / process / logistics | low lateral track alongside the line, foreground parallax |
| Travel / outdoors / campus | drone-style rise-and-reveal, then a descending swoop |
| Food / craft / detail-driven | push in close to the craft moment, ease back, carry on |
| Playful miniature (arch. B) | dives + aerial hops — the connector IS the grammar |

Honest costs: expressive mid-leg moves raise re-roll odds — the model can end a fancy move
in a state that isn't a clean forward drift. Mitigations: keep the final-second settle
clause verbatim; **eyeball each leg's last frame before chaining the next** (it should look
like a frame from a gentle forward glide — if not, re-roll before wasting the next leg);
budget ~1 extra re-roll per expressive leg. A plain forward glide stays the zero-risk
default — use it for legs where the scene itself is the show.

**Locked-iso variant** (`CAMERA` = locked isometric glide): architecture A where every
leg pins the view instead of taking a mid-leg move — "the camera keeps exactly the same
high isometric angle throughout, no rotation, no orbit, no tilt; it only travels
straight and level, the world sliding past beneath the same view" (verbatim clause in
prompts.md). The handoff contract is unchanged. Video models tend to drift the angle
slightly on long legs (how much H3 drifts is to be seen on the first build) — the
eyeball-each-last-frame rule is the catch; re-roll a leg whose view has rotated. Calmest
look, cheapest re-rolls, and the closest to the Emons reference.

Two related pacing knobs live in the engine (Step 7): per-section `scroll` (more scroll
distance = longer dwell in that scene) and `linger` (the camera settles mid-scene exactly
while the copy peaks, then picks up speed toward the seam). Prefer expressive motion in the
*clip* and restraint in the *scrub mapping* — they compound.

And remember scroll is a scrubber: visitors can scroll **up**, so every move also plays in
reverse. That's free and expected — no extra work — but it's another reason seam velocity
must be consistent in both directions (a seam that reads fine forward reads as a stutter
backward too if velocity flips).

**For B**, one camera flight per scene: starts high/outside, descends into the interior,
structure opens. `--first-frame` = the scene still.

- Use the **solid-background still** (not the knocked-out transparent one) as the first
  frame, so the video has a full frame.
- Brief: `integrated_multimodal_description: [Shot 1] <style tail>, a high wide view of
  the whole <scene> from outside … The camera glides forward and descends with large
  amplitude at a slow, steady speed toward <focal point> … the roof and walls gently
  open to reveal the interior. … No subtitles, no on-screen text, no logos, no cuts …`
  plus the two short audio lines. (Template in `references/prompts.md`.)
- Params: `--ratio 16:9 --resolution 768P --duration 8` (6 in draft). H3 always renders
  audio — ignore it; the encode strips it (`-an`).
- Dives are independent — run them concurrently, detached. Re-roll individual failures.
  Keep the raw sources — you need their frames next.

---

## Step 5 — Connectors (architecture B only)

Skip this whole step for architecture **A** — the forward take has no connectors; its legs
already chain seamlessly. This step applies to **B** (diorama/miniature), on
`BACKEND=minimax`, and note the reversal caveat from Step 4.

The connector clips are what make the world feel *connected* instead of cut. A connector
flies from the end of scene i out and into the start of scene i+1. **Both of its
endpoints must be the ACTUAL RENDERED FRAMES of the neighbouring clips — never the
original diorama still.**

Why: every generation renders slightly differently. If a connector *ends* on a fresh
render of "the kitchen diorama," but the next dive clip *starts* on its own different
render of that same diorama, the two won't match and you get a pop at the seam. The fix
is to hand off the exact pixels:

```
For each connector between dive_i and dive_{i+1}:
  --first-frame = the LAST frame extracted from dive_i's rendered video
  --last-frame  = the FIRST frame extracted from dive_{i+1}'s rendered video
```

Now every seam is frame-identical on *both* sides:
`dive_i.end == connector.start` and `connector.end == dive_{i+1}.start`.

Extract the boundary frames from the rendered dives (not the stills):

```bash
"$FFMPEG" -sseof -0.15 -i dive_i.mp4   -frames:v 1 -update 1 -q:v 2 dive_i_last.png     # interior of i
"$FFMPEG" -ss 0      -i dive_next.mp4 -frames:v 1 -q:v 2 dive_next_first.png           # establishing of i+1
```

Generate the connector (`--duration 5` is plenty; 4 in draft):

```bash
node "$SKILL/scripts/h3.mjs" --backend minimax --prompt-file connector_i.txt \
  --first-frame dive_i_last.png --last-frame dive_next_first.png \
  --ratio 16:9 --resolution 768P --duration 5 --out conn_i.mp4
```

Connector brief: `[Shot 1] … The camera pulls up and back out of <scene i> with large
amplitude at a slow, steady speed, rising into the sky, glides forward across the
connected miniature world, and arrives above <scene i+1>, beginning to descend toward
it. … no cuts …` (Template in `references/prompts.md`.)

Insurance: keyframe models typically land *close* to the end frame but not always
pixel-perfect (how close H3 lands is part of the Step 4 qualification), so the engine
still applies a **short crossfade** (a few frames) at each seam. Frame-matched endpoints +
a small crossfade = no visible cut. Never skip the actual-frame handoff and rely on the
crossfade alone; a big content jump can't be hidden by a crossfade.

---

## Step 6 — Encode for smooth scrubbing

Scrubbing = setting `video.currentTime` from scroll. Two things matter, and they are
often gotten wrong:

1. **Seekability, not keyframe density, is what makes scrubbing work.** Many static
   hosts (and `python -m http.server`) don't serve HTTP byte-range requests, which pins
   `video.seekable` to `[0,0]` and clamps *every* seek to frame 0 — the video looks
   frozen. The robust fix is to **fetch each clip as a `Blob` and play it from an
   in-memory object URL** (blobs are always fully seekable). The engine does this.
   Because of it, you do **not** need all-intra video.
2. **Don't shrink quality to get smooth seeks.** Encode at the **native resolution**
   (whatever `probe.mjs` reports — 768P or 2K; don't downscale, never upscale),
   `crf ~20`, a **small GOP** (`-g 8`) rather than all-intra (all-intra bloats an 8s
   clip to ~25 MB; GOP 8 is ~8 MB and scrubs fine via blob). **Strip audio (`-an`)** —
   H3 always renders a soundtrack, and the page plays muted — add faststart, and a light
   `unsharp` to counter video softness:

```bash
"$FFMPEG" -i src.mp4 -an -vf "unsharp=5:5:0.8:5:5:0.0" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
  -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart out.mp4
```

Encode every chained clip (legs, or dives + connectors) with the same settings for
uniform quality.

**Mobile encodes (only if the user opted in at Step 1.6).** The mobile version is
the **native 9:16 portrait chain** (pipeline.md §6b): portrait renders of every clip,
encoded **720 wide (`scale=720:-2`), `-g 4`** (more keyframes = cheaper seeks — phone
decoders' seek cost scales with GOP length), crf 23, `-an` — wired as `clipMobile` /
`connectorsMobile`, with each portrait clip's first frame extracted as the section's
`stillMobile` poster (Step 7). The engine serves them automatically on phones and falls
back to the desktop clip when absent. The 16:9 centre-crop `encm()` encodes
(pipeline.md §6) are a **fallback only** — for when the budget can't cover the portrait
chain — and shipping them must be called out to the user, never silent. If the user chose
desktop-only, skip this — the engine still hardens phone scrubbing regardless.

---

## Step 7 — Assemble the page

Copy `references/scrub-engine.js` (and, if you want a fully standalone page, the tiny
`references/index-template.html`) into the user's project — or adapt into their
framework. It's config-driven and self-contained:

```js
mountScrollWorld(document.getElementById('world'), {
  brand: { name: 'Pearl & Co.' },
  diveScroll: 1.3, connScroll: 0.9,          // viewport-heights of scroll per clip
  sections: [
    { id:'farm', label:'The Farms', still:'assets/farm.webp',
      clip:'assets/vid/farm.mp4',
      clipMobile:'assets/vid/farm-m.mp4',      // mobile opt-in only: native 9:16 render
      stillMobile:'assets/farm-m.webp',        // its first frame as the portrait poster
      scroll: 1.6, linger: 0.45,   // optional pacing: longer dwell + camera settles mid-scene
      accent:'#8FB98A', eyebrow:'From leaf to last sip', title:'It starts in the hills.',
      body:'…', tags:['Single-origin','Hand-picked'] },
    // …one per section; last may carry a `cta`
  ],
  // arch B: length = sections-1. Arch A: connectors: [] and crossfade: 0.08
  connectors:       ['assets/vid/conn1.mp4','assets/vid/conn2.mp4',   /* … */],
  connectorsMobile: ['assets/vid/conn1-m.mp4','assets/vid/conn2-m.mp4' /* … same length; mobile opt-in only */],
});
```

The engine handles: the ordered clip/connector chain, scroll→currentTime with rAF
smoothing, blob loading, lazy prefetch of nearby clips, frame-matched crossfades, pinned
per-section copy (first section greets on landing, last holds its CTA), a route rail,
`prefers-reduced-motion`, and mobile. **Pacing per section:** `scroll` overrides
`diveScroll` for that scene (more scroll = longer dwell) and `linger` (0–1, keep ≤ 0.6)
remaps time so the camera settles mid-scene — exactly while the copy peaks — then speeds
up toward the seam; seam frames are untouched (f(0)=0, f(1)=1). Give the hero and finale
scenes a higher `scroll` + some `linger`; keep transit scenes brisk. Theme it with CSS
variables (`--accent`, `--sw-bg`, `--sw-ink`, …) — the visual identity comes from the
generated clips, so the chrome stays quiet. See the header of `scrub-engine.js` for the
full config + CSS vars.

**On phones the engine adapts automatically** (coarse pointer or ≤860px): it serves
`clipMobile` / `connectorsMobile` when present, **coalesces seeks** (never queues a new
`currentTime` while the decoder is still seeking — this is what stops a fast flick from
freezing the clip), **keeps the still as a poster until the clip paints its first frame**
and **primes each video on first touch** (fixes iOS's blank-until-played video), drops the
drifting particles, ignores URL-bar-only resizes (no scroll jump), and uses safe-area
insets so copy clears the notch/home indicator. All of this hardening is on by default —
no config needed. The `clipMobile`/`connectorsMobile` encodes are the opt-in part
(Step 1.6): only wire them when the user asked for the mobile version.

For non-JS backends (Python/Rails/etc.): serve the assets and drop the engine `<script>`
into the rendered HTML; nothing about it is framework-specific.

---

## Step 8 — QA the seams (don't skip)

Drive the page in a headless browser and **verify frame continuity at the seams**, which
is the thing most likely to be wrong:

- Screenshot at scroll positions just before and just after each seam. The two frames
  must be near-identical (a clip's last frame == the next clip's first frame). If they
  pop, a clip started on a still instead of the actual rendered frame (redo Step 4/5), or
  the crossfade band is too short. Calibration: judge seams by *composition*, not raw
  PSNR — at 768P+ a correctly frame-locked seam can read ~18–25 dB between two
  *scrubbed page screenshots* from detail shimmer alone; a real mismatch shows as
  different composition/props, not just softness. (The ≳30 dB bar in Step 4 is for the
  raw frame-0-vs-input-still check, not page screenshots.)
- Check the console for errors, confirm `video.seekable.end(0) > 0` (blob working), and
  that `currentTime` tracks scroll across each clip's band.
- **Mobile — full checklist only if the user opted into the mobile version (Step 1.6).**
  For a desktop-only build, just sanity-check a phone viewport once: page loads, still
  posters show, nothing overlaps — the engine's hardening covers graceful degradation.
  For the mobile build (on a real phone or an emulated one, portrait + landscape):
  - Emulate a phone viewport **with CPU throttled 4–6×** and scroll fast — the clip should
    track without freezing (the seek-coalescing + `-m.mp4` encodes are what make this hold).
  - Confirm the first scene shows immediately (its still is the poster) and the video takes
    over the instant you scroll — no blank/black scene (the iOS priming fix). Test iOS Safari
    specifically; it's the one that goes blank if this regresses.
  - Verify the `-m.mp4` variant is actually served on mobile (Network panel), and the
    full master on desktop. The mobile clips must be **natively portrait**
    (`videoWidth < videoHeight` — not a downscaled 16:9 file), and the `stillMobile`
    posters must be served and match each portrait clip's first frame (no
    landscape→portrait flash when the video paints).
  - Slowly scroll so the URL bar collapses — the page must **not jump** (height-only resizes
    are ignored on touch). Rotate the device — layout should recompose cleanly.
  - Only if the crop **fallback** shipped: portrait crops a 16:9 clip to its centre —
    confirm the focal subject still reads, and remind the user this is the stopgap, not
    the mobile version.
- Check reduced-motion (should fall back to the stills, no video, no particles).

---

## Gotchas (hard-won)

- **Seam pop** → a chained clip started on the scene still, not the neighbouring clip's
  actual frame. Always extract real frames (Step 4 A / Step 5).
- **Seam pop even with real frames** → the backend isn't truly frame-locking (it
  re-composes the opening). Run the §0 PSNR probe; ≳30 dB or don't chain on it. Also
  check the brief doesn't contradict the first frame (H3 "corrects" the image in the
  opening frames when the prose disagrees with it).
- **A cut in the middle of a clip** → the brief had more than one `[Shot n]`, or lacked
  "no cuts" in the negative sentence. One `[Shot 1]`, always "no cuts".
- **Seam stutter / camera "jumps backward"** → even with frame-matched seams, if the
  camera *velocity reverses* (forward dive, then a connector that pulls back out) it
  reads as a rewind. This is inherent to architecture B. For any grounded walkthrough use
  architecture A (legs chained from actual last frames, no pull-back, no
  `--last-frame`); see Step 4.
- **`--last-frame` errors on runpod** → by design: the RunPod worker is first-frame only.
  Use architecture A, or put the whole arch-B chain on `--backend minimax`
  (`MINIMAX_API_KEY` in `.env.local`).
- **First clip "hangs" for minutes** → RunPod cold start (~40 GB of weights loading after
  idle). Not a failure; keep polling. Later clips in the same session start fast.
- **Bracket camera tags ignored** (`[Push in]`, `[Pan left]`) → that's Hailuo-era syntax.
  H3 wants a prose camera sentence with amplitude + speed inside the production brief
  (prompts.md → H3 prompting).
- **Audio in the output** → H3 always generates a soundtrack; the `overall_soundscape` /
  `non_diegetic_music` lines must still be present (keep them short). Strip it with `-an`
  on every encode; the page is muted anyway.
- **Clip rejected by a content filter** → rephrase and retry, 3 attempts per leg
  (prompts.md → If a clip is rejected). A connector that never passes → set its slot to
  `null` (the engine crossfades that seam directly). Budget extra time for re-rolls on
  interiors/real-estate content.
- **Frozen video / stuck at frame 0** → `seekable=[0,0]`; the host isn't serving byte
  ranges. Use blob URLs (engine does).
- **Huge files** → you used all-intra. Use `-g 8` + blob instead.
- **Soft / low quality** → you downscaled or over-compressed. Encode native resolution,
  crf ≤ 20, add `unsharp`. Video is inherently softer than the stills — keep the stills
  as the lite fallback for max fidelity. 768P is the honest ceiling unless 2K is
  confirmed on the backend.
- **Stills request fails / 413** → too many or too large `--ref` images (the owner hit a
  ~4.5 MB request limit). Use one or two refs; the script downscales, but don't stack five.
- **Stills drift in style** → scenes 1..n were generated without scene 0 as `--ref`, or
  the preamble wasn't byte-identical. Regenerate the stragglers with the ref.
- **Photoreal scenes all look like the same room** → the `--ref` wasn't framed as style
  only. Say "a different room; match only the lighting, materials and colour grade".
- **`ffmpeg: command not found`** → not on PATH here; use `"$FFMPEG"` (resolves to the
  hub's ffmpeg-static binary, pipeline.md top). **`ffprobe` doesn't exist at all** on
  this machine — use `node "$SKILL/scripts/probe.mjs"`.
- **Path with spaces breaks a script** → the hub path contains spaces. Quote every
  `"$FFMPEG"`, `"$WORK/…"` and `"$SKILL/…"`; never pass a path through an unquoted
  variable.
- **Dark / custom theme** → the engine wraps its default tokens in `@layer sw`, so a
  page-level `:root` / `.sw-root { --sw-bg; --sw-ink; --sw-accent; --sw-font-* }` block
  wins cleanly (no specificity hacks). `--sw-ink` is your primary **text/heading** colour;
  the **accent** fills the primary button and active nav. For a dark theme, set `--sw-bg`
  dark and `--sw-ink` light — the copy scrim and title shadow follow `--sw-bg` automatically.
- **Phone scrub stutters / freezes on a fast flick** → the master is too heavy for a
  phone decoder and seeks pile up. Ship the `-m.mp4` mobile encodes (720p, `-g 4`) and wire
  `clipMobile`/`connectorsMobile` (Step 6/7). The engine already coalesces seeks; the lighter
  encode is the other half. Still choppy on a low-end device? Tighten GOP (`-g 2` / all-intra).
- **Blank / black scene on iOS (desktop was fine)** → an iOS Safari quirk: a muted video that
  was never played won't paint a seeked frame. The engine fixes this by keeping the still as a
  poster until the clip paints and priming each video on first touch — so **don't** hide the
  still on `loadedmetadata` or strip the `playsinline`/`muted` attributes if you adapt the
  engine into a framework.
- **Page jumps while scrolling on mobile** → something is re-running layout on the URL-bar
  show/hide `resize`. The engine ignores height-only resizes on touch; if you ported it, gate
  your resize handler on a width change (keep the `orientationchange` path for rotation).
- **Copy hidden behind the URL bar / notch on mobile** → use the engine's safe-area-aware
  bottom offset (`env(safe-area-inset-bottom)` + `dvh`); make sure the page's
  `<meta viewport>` includes `viewport-fit=cover` (the template does).
- **Portrait crops the scene** → a 16:9 clip on a tall phone shows only its centre — which
  is why the mobile version is the native 9:16 chain (§6b), never the crop. If you're seeing
  this on a mobile build, either the crop fallback shipped (call it out to the user) or the
  9:16 encodes aren't actually being served (check `videoWidth < videoHeight`). Keeping each
  scene's focal subject centred (prompts.md) still matters for the desktop film itself.
- **Wrong aspect clip** → pass `--ratio` explicitly on every clip (16:9 desktop, 9:16
  mobile chain) and generate the stills at the same aspect.
- **Seam pop only where you "saved money"** → you switched backend or resolution
  mid-chain, or re-rendered one leg at final quality inside a draft chain. One backend,
  one resolution for the whole chain; a final re-render is a whole new chain.
- **Connector grabs the wrong scene's frames** (or errors on a frame that doesn't exist
  yet) → the array loop ran in **zsh**, where arrays are 1-indexed, not bash's 0-indexed.
  Keep every chain step in a bash script run via `bash script.sh` (Git Bash on Windows) —
  never inline array loops in another shell. The pipeline avoids arrays entirely
  (positional `set --` loops), which also keeps it bash-3.2-safe on macOS.
- **White-box scenes** → the stills come back on a solid bg; either match the page bg to
  it or knock it out (Step 3).

## References

- `references/prompts.md` — the intake checklist, the **H3 production-brief format**,
  the style-preamble pattern, and every template (scene still, arch-A leg, dive,
  connector, reference-mode hero) with fill-in slots.
- `references/pipeline.md` — copy-paste bash for the whole run (frame-lock probe → stills
  → sequential legs or dives + connectors → encode → mobile chain).
- `scripts/h3.mjs` — renders one H3 clip (`--prompt-file --out [--first-frame]
  [--last-frame] [--duration 4-15] [--ratio] [--resolution 768P|2K] [--backend]`,
  `--dry-run`, `--check`); prints `{backend, out, seconds}`.
- `scripts/still.mjs` — one OpenRouter still (`--prompt-file --out [--ref]… [--aspect]
  [--model]`).
- `scripts/probe.mjs` — ffprobe stand-in: `{width,height,fps,duration,frames}`.
- `references/scrub-engine.js` — the portable, config-driven scrub engine (builds DOM +
  injects CSS; blob-seek, lazy load, seam crossfade, copy, route rail, reduced-motion, and
  phone hardening: mobile encodes, seek-coalescing, iOS priming, safe-area, no-jump resize).
- `references/index-template.html` — a minimal standalone page that mounts the engine.
- `references/knockout.py` — border-connected background knockout for floating scenes.
