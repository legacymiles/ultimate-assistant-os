---
name: scroll-world
description: >
  Build an immersive scroll-scrubbed "fly through the world" landing page for any
  industry or brand, rendered through muapi.ai (Seedance 2 video + GPT Image 2 stills).
  As the visitor scrolls, a pre-rendered camera flies from outside
  each scene into its interior, then flows on to the next scene with NO cuts — one
  continuous connected flight (Emons-style isometric diorama world, or any art
  direction you pick). The skill interviews the user for the topic, the story
  beats/sections, and brand kit, then generates cohesive scenes + seamless camera
  clips and wires a portable, framework-agnostic scroll-scrub engine. Renders through
  muapi.ai (Seedance 2 / GPT Image 2, pay-per-generation) via the higgsfield-models
  skill — the owner's route for these models. Use when the user wants a "3D world" /
  "browse-through-the-industry" hero, a scroll cinematic, a diorama landing, or to
  turn a business into a scrollable world.
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, Skill
---

# scroll-world

Produces a landing page where **scroll drives a camera**: it dives from outside a scene
into its interior, then flies out and into the next scene, continuously, with no visible
cuts. The visuals are AI-generated — stills via **GPT Image 2 on muapi** (or Codex), the
video chain via **Seedance 2 on muapi** (pay-per-generation) — and the page just scrubs
pre-rendered video by scroll position. This is the same technique behind Apple's scroll-through product
pages — the camera genuinely moves, scroll only drives time.

**What you generate:** N scene stills → N "dive-in" camera clips → N-1 "connector" clips
that join consecutive scenes seamlessly → a portable scrub engine that plays the whole
chain as one flight.

**The one rule that makes or breaks it:** seams must be *frame-identical*. Read
[The seamless chain](#step-5--the-seamless-chain-the-critical-part) before generating any
connector. Getting this wrong is the single most common failure and produces a visible
"pop" between scenes.

Do not assume a frontend framework. The scrub engine in `references/scrub-engine.js` is
self-contained vanilla JS (it builds its own DOM + injects its own CSS into a container
you give it), so it drops into plain HTML, Next.js, Vue, a Python-served page, anything.
The value of this skill is the generation pipeline, the prompts, and the seam method —
not the framework.

---

## Step 0 — Bootstrap

1. **muapi route — the generation backend.** Every image and video generation in this
   skill goes through **muapi.ai**, driven by the `higgsfield-models` skill's zero-install
   CLI. Invoke that skill first, then check the route:

   ```bash
   MU=~/.claude/skills/higgsfield-models/scripts/muapi.mjs
   node $MU models seedance-2        # should list seedance-2-first-last-frame
   ```

   The key is `MUAPI_API_KEY` (env → nearest `.env.local` → the hub's `.env.local`). If it
   is missing, add a blank `MUAPI_API_KEY=` line to the relevant `.env.local`, open it at
   that line for the owner, and point them at muapi.ai. Generations are billed
   per-generation in USD — state the estimate from Step 1.7 and **confirm before batching
   more than ~5 videos**.
2. **Do NOT install the Higgsfield CLI, SDK, MCP or account, and do not install Monid.**
   Upstream drove this pipeline through `higgsfield generate create` with Monid as the
   default biller; both are replaced by muapi here. See `references/backend.md` for the
   full mapping — that file is the authority on every generation call.
3. **ffmpeg / ffprobe** on `$PATH` (frame extraction + encoding). This PC has neither on
   PATH — use the hub's bundled binary at
   `C:/Users/honey/OneDrive/Desktop/claude code files/node_modules/ffmpeg-static/ffmpeg.exe`
   (the same workaround `h3-scroll-world/scripts/probe.mjs` uses).
4. **An image tool** for background knockout if you want floating scenes: PIL
   (`python3 -c "import PIL"`), or `cwebp`/`sips`. Optional — see Step 3.
5. **(Optional) Codex CLI** — if `codex` is on `$PATH` (≥ 0.125) and
   `codex login status` reports a ChatGPT login, the scene stills can be generated
   through Codex's built-in `image_gen` (the same gpt-image-2 model) billed to the
   user's ChatGPT subscription instead of muapi — offer it at Step 1.7, command in
   Step 2. Absence just removes the option.
6. Caveats: macOS ships **bash 3.2** (no `declare -A`); don't use associative arrays in
   scripts. Video generations take **minutes** — always run them detached (background)
   and poll, never a foreground blocking call. muapi takes conditioning frames as
   **hosted URLs**, so every local PNG must be `upload`ed first (the pipeline helpers do
   this). Models differ in accepted params and in whether they support first/last-frame
   conditioning at all — before batching, confirm the endpoint's `Inputs` column with
   `node $MU models <name>` and see the Step 4 model table.

---

## Step 1 — Interview the user

The **subject is the user's to state — ask it as an open question in plain prose**, never a
fabricated multiple-choice. A made-up list of industries biases them and reads as you
deciding their business for them; let them answer in their own words (their real business,
a client's, or any idea). Reserve structured multiple-choice (`AskUserQuestion` in Claude
Code; a plain either/or question elsewhere) for the genuinely
enumerable, lower-stakes choices below — art direction, camera style, and brand-kit
approach — and even
there, signal they can go their own way ("Other"). Ask only what you can't sensibly
default. Cover:

1. **Subject** (ask openly, not multiple-choice) — "What should this world be about? Your
   business, a client's, or any idea — a word or a sentence is fine." Capture the
   industry/product + a one-line pitch (e.g. "a bubble tea company, from leaf to last
   sip"), and a brand name if they have one; otherwise you'll propose one below.
2. **Brand kit** — offer three paths, pick one:
   - Import from a URL: use the hub's **Website Redesigner** scrape or the
     `website-redesigner` skill to pull name, colours and tone off an existing site.
     (Upstream used a Higgsfield brand-kit CLI; it is not part of the muapi route.)
   - The user hands you palette + name + tone directly.
   - You propose a palette + name and let them approve.
   Capture **4–6 named hex values**, a display name, and a tone word or two.
3. **Art direction** — default is "soft matte low-poly **clay diorama**, isometric,
   tilt-shift miniature, warm light." Offer alternatives (flat papercraft, glossy toy,
   claymation, neon night). Whatever is chosen becomes the shared **style preamble**
   reused verbatim in every scene prompt (this is what makes the world cohesive).
4. **Camera style — ALWAYS ask; it's the film's personality, not a technical
   detail.** Ask by feel (`AskUserQuestion` in Claude Code; a plain question
   elsewhere) and record the answer as `CAMERA`. The options map to the Step 4
   architectures — Step 4 then *implements* the choice, it never re-decides it:
   - **"Fly through the world"** — the camera dives into each scene, pulls up and
     out, and hops across the miniature world to the next; angles change
     constantly, big expressive aerial moves (this is the flagship-demo look).
     → Architecture B. Recommend as the default for diorama/miniature art
     directions.
   - **"One continuous walkthrough"** — a single forward flight that glides
     through each scene straight into the next, never pulling back; expressive
     but always-forward moves per scene (camera grammar table). → Architecture A.
     Recommend as the default for grounded/photoreal art directions.
   - **"Locked isometric glide"** — the camera keeps one fixed angle for the whole
     film, Emons-style; the world slides past/toward it, no rotation, no reveals.
     → Architecture A + the locked-iso clause in every leg prompt (prompts.md).
   State the trade-off in one line each (B reverses direction at seams — charming
   in miniature, jarring in realism; locked-iso is the calmest and cheapest to
   re-roll; walkthrough sits between).
5. **The journey (sections)** — the ordered scenes the camera flies through. Propose a
   set derived from the subject's own value chain and let the user edit. 5–7 works well.
   Boba example: farms → pearl kitchen → flagship shop → delivery → community plaza →
   the hero product. Each section needs: a short subject description (what's IN the
   diorama), an eyebrow, a headline, one line of body, and 0–3 tag pills. The last
   section is usually the hero product + the CTA.
6. **Mobile version — ALWAYS ask this; never silently generate both.** Ask as a
   two-option choice (`AskUserQuestion` in Claude Code; a plain question elsewhere):
   *"Want a mobile-optimized version too? The mobile version is a second camera chain
   rendered natively in **9:16 portrait** — composed for phones, not a crop of the
   landscape film — which roughly doubles the render spend (state the
   estimated number)."*
   Options: "Desktop only" / "Desktop + mobile (native 9:16 — ~2× spend)". The
   dollar cost must be stated to the user, not just implied.
   What the answer gates:
   - **Yes** → render the parallel 9:16 portrait chain and ship it as the mobile variants
     (Step 6 / pipeline.md §6b): portrait start canvases → 9:16 dives + connectors
     frame-locked against their own renders → 720-wide `-m.mp4` encodes → `stillMobile`
     portrait posters. Wire `clipMobile`/`connectorsMobile`/`stillMobile` (Step 7); run
     the full mobile QA (Step 8). Budget ~2N-1 extra video gens + NSFW re-rolls.
     **Never ship the centre-crop as the mobile version by default** — if credits can't
     cover the portrait chain, say so and offer the crop encodes (pipeline.md §6) as an
     explicitly-labelled stopgap the user must approve.
   - **No** → skip the mobile encodes and wiring entirely. The engine's phone hardening
     (seek-coalescing, iOS priming, safe-area CSS) is always on regardless — that's not
     a "mobile version," it's just the page not breaking when a phone visits — so a
     desktop-only build still degrades gracefully.

7. **Budget — engines shown by cost, decided before anything renders.** Present the
   render tiers (`AskUserQuestion`), then compute and state the estimated total for
   the user's N scenes — `N stills + (2N−1) videos [videos ×2 if mobile] + ~15%
   re-roll headroom` — and get a go before generating.
   - **Video tier** (roster only — every option frame-locks seams, Step 4):

     | Tier | Endpoints | Rough cost |
     |---|---|---|
     | Draft / previz | `seedance-2-image-to-video-fast` + `seedance-2-first-last-frame-fast` | cheapest |
     | Standard (default) | `seedance-2-image-to-video` + `seedance-2-first-last-frame` | baseline |
     | Alternate | `kling-v3.0-4k-image-to-video` | different look + content filter |

     Draft doubles as the previz path: run the whole chain cheap, approve the
     journey, re-render final legs on Standard (pipeline.md Notes) — suggest it
     unprompted when the budget reads tight.
   - **Backend — muapi, billed per generation in USD** (Step 0.1; wiring in
     pipeline.md). Not credits and not a monthly plan: every still and every clip is
     a separate charge on the owner's `MUAPI_API_KEY`. muapi exposes no balance
     command, so do **not** quote a remaining balance — quote the **generation
     count** instead (`N stills + (2N−1) clips`, doubled if mobile, plus ~15%
     re-roll headroom) and get an explicit go before batching. Per-generation
     pricing is muapi's and varies by endpoint, duration and resolution: check
     muapi.ai for current rates rather than reusing upstream's Monid/Higgsfield
     figures, which do not apply on this route. The `cost` field echoed by
     `muapi.mjs gen` is the authoritative charge — surface it after the FIRST clip
     so the user sees the real rate before the batch runs (`cost.refunded: true`
     means a failed generation was refunded).
   - **Stills source** (only offer if the Codex CLI is present, Step 0.5):
     muapi `gpt-image-2-text-to-image` (a paid generation each) vs **Codex
     `image_gen`** — the same gpt-image-2 model billed to the ChatGPT subscription
     (no muapi charge; counts toward Codex usage limits; 1536×1024 output — exactly
     3:2, slightly under muapi's 2k). Stills are plain PNGs uploaded as the start
     frame, so the
     video chain is indifferent to their source. Command in Step 2. **One source
     for all N stills of a build** — the two render with slightly different
     character (verified: Codex runs warmer/lighter), and mixing sources across
     scenes reads as style drift, same reason the video chain uses one model.
   - **Calibrate costs, don't guess.** muapi exposes no pricing endpoint and rates
     differ per endpoint/duration/resolution. Render ONE still and ONE clip first,
     read `cost.value` off each result, extrapolate to the full run, and re-confirm
     with the user before batching the rest. Never quote upstream's credit or Monid
     figures — they are a different biller entirely.

If the user names a video model outside the roster, honor it **only if it can
frame-lock seams** (Step 4). This skill only ships seamless output, so a model that
can't frame-lock is declined with a one-line why, not substituted in — use a roster
model instead.

Keep the scroll mechanic fixed (continuous fly-through) — that's the point of the skill.
See `references/prompts.md` for the intake checklist and copy structure.

---

## Step 2 — Generate the scene stills

One image per section, **all sharing the same style preamble** for cohesion. Default
endpoint **`gpt-image-2-text-to-image`** (crisp, great at isometric illustration; returns
a solid/white background which is perfect for floating diorama "islands"). Use
`nano-banana-pro` only if the brief is character/cartoon-heavy.

Prompt shape (full templates in `references/prompts.md`):

```
<STYLE PREAMBLE, identical every time>. On a plain solid <bg> background with a soft
contact shadow. <PALETTE hexes>. No text, no letters, no logos, centered, 3:2.
Subject: <what is in THIS diorama>.
```

- Run all N concurrently, detached. Command per scene:
  `node $MU gen gpt-image-2-text-to-image "{\"prompt\":$(jq -Rs . < scene_i.txt),\"aspect_ratio\":\"3:2\",\"resolution\":\"2k\"}" --out still_i.png`
- `--out` downloads the result for you; muapi's hosted URLs expire, so never skip it.
- **Codex stills variant** (if chosen at Step 1.7 — subscription-billed, zero
  credits): same prompt files, same byte-identical preamble, generated by Codex's
  built-in `image_gen`:

  ```bash
  codex exec -C "$WORK" -s workspace-write --skip-git-repo-check \
    'Use the image generation tool ($imagegen) to generate: '"$(cat "$WORK/still_i.txt")"' Wide 3:2 landscape, high resolution. Save it as ./still_i.png. Do not do anything else.' \
    < /dev/null
  ```

  Single-quote the `$imagegen` segment (the shell must not expand it); if editing
  with reference images, the prompt goes BEFORE any `-i` flag (it's variadic).
  ~1–3 min per image; run a few in parallel, not all N at once — and keep the
  `< /dev/null`: parallel `codex exec` calls sharing a script's stdin hang
  waiting for input (Gotchas). Output lands at
  1536×1024 (3:2) — fine for a **start frame** and posters. Everything downstream
  (cohesion review, knockout, dives) is unchanged.
- A generation may fail transiently (HTTP 503) — re-roll that one individually; don't
  restart the batch.
- **Review the stills before continuing.** They must read as one cohesive world (same
  angle, palette, light). If one is off-style, regenerate it, optionally passing an
  approved scene as a reference (switch to `gpt-image-2-image-to-image`) to lock style.

See `references/pipeline.md` for the exact batch script.

---

## Step 3 — (Optional) Float the scenes

If you want the dioramas to float over an atmospheric background instead of sitting in a
solid box, knock out the flat background to transparency with
`references/knockout.py` (border-connected flood fill — preserves interior colour that
matches the bg, e.g. cream walls). Then encode to webp. If you'd rather keep it simple,
just make the page background the same colour as the scene background and skip this.

These stills double as **video posters and lazy-load fallbacks**, so keep them.

---

## Step 4 — Camera architecture (implements the Step 1.4 choice)

How the camera moves *between* scenes is the single biggest quality lever. The user
already chose the style at the interview (`CAMERA`, Step 1.4): fly-through → **B**,
walkthrough → **A**, locked-iso → **A + the locked-iso leg clause** (prompts.md). If
the interview somehow skipped it, ask now — never silently pick for them. The two
shapes, and the grammar that colors them:

### Video model — pick ONE for the whole chain

**This skill only ships seamless output**, so the only usable endpoints are ones that can
frame-lock a seam: every chained clip must accept a **start frame**, and connectors also
need an **end frame**. That capability — not preference — is the selection rule. Check any
endpoint's `Inputs` column with `node $MU models <name>` and **skip anything whose media
inputs are reference-only**: it can only *condition* a generation, not *continue* a shot,
so it physically can't hold a seam.

All frames are passed as **hosted URLs** in `images_list` (upload local PNGs first). For
`seedance-2-first-last-frame`, `images_list` is `[startUrl, endUrl]` **in that order**.

| muapi endpoint | start / end frame | Notes |
|---|---|---|
| `seedance-2-image-to-video` (default, legs) | ✓ / — | The dive/forward legs. `images_list:[startUrl]`, `aspect_ratio`, `duration`, `high_bitrate`. |
| `seedance-2-first-last-frame` (default, connectors) | ✓ / ✓ | The seam-holding connector model — the whole reason this chain works. `images_list:[startUrl,endUrl]`. |
| `seedance-2-image-to-video-fast` + `seedance-2-first-last-frame-fast` | ✓ / ✓ | The cheap previz tier. Run the whole chain here first, then re-render final legs on the full pair — still seamless, so it translates directly. |
| `kling-v3.0-4k-image-to-video` | ✓ / ✓ | Alternate full chain; takes `image_url` + `last_image` (NOT `images_list`) — different payload shape, wire it by hand. Different content filter than Seedance → the sanctioned fallback for a single stubborn clip. |
| `minimax-h3-image-to-video` | ✓ / — | Architecture-A only. If the user wants H3 specifically, prefer the sibling skill **`h3-scroll-world`**, which is already built around H3's first-frame-only constraint. |

Rules:
- **One endpoint family for all chained clips.** Each renderer has its own motion/color/grain
  character; mixing families mid-chain keeps *position* continuity (frames still hand off)
  but the render-character shift reads as a subtle pop. The one sanctioned exception is
  the content-filter fallback for a single stubborn clip (Gotchas) — a slight character
  shift on one 5s connector beats a missing connector.
- Default to the Seedance 2 pair; honor a user's stated model preference **only if it
  qualifies** (frame-locking). If it doesn't, say so and use a supported endpoint — never
  ship a non-seamless build to satisfy a model request.
- The pipeline scripts take the endpoints as `$VLEG` / `$VCONN` (`references/pipeline.md`).

### muapi backend — how every generation is billed and called

Upstream billed this chain through **Monid** (pay-per-clip) with **Higgsfield credits** as
the fallback. Neither is used here. The owner's standing rule is that Higgsfield-offered
models are called through **muapi.ai** (the Open-Generative-AI route) with `MUAPI_API_KEY`
— no Higgsfield account, SDK or MCP, and no Monid CLI.

Every call in this skill therefore goes through one helper:

```bash
MU=~/.claude/skills/higgsfield-models/scripts/muapi.mjs
node $MU upload ./still_farm.png                      # -> prints hosted URL
node $MU gen <endpoint> '<json>' --out out/clip.mp4   # submits, polls, downloads
node $MU poll <request_id> --out out/clip.mp4         # resume a detached job
```

Billing is **per generation in USD** on the owner's muapi key, not credits and not a
monthly plan. Give the Step 1.7 estimate as `(N legs + N-1 connectors + N stills)`
generations and **confirm before batching more than ~5 videos**. Output URLs are hosted by
muapi and **expire** — always `--out` to disk. Full protocol, payload fields and the model
table: `references/backend.md` and the `higgsfield-models` skill.

### A) Continuous forward take — RECOMMENDED for grounded / realistic / walkthrough
One camera that only ever glides **forward**, first scene through last, as a single take.
Generate the legs **sequentially**: leg 0 from scene-0's still (glide forward into it);
then each leg's **start frame** = the **previous leg's ACTUAL last frame** (extract with
ffmpeg), prompt *"continue gliding smoothly FORWARD into [scene i], never pulling back"*
(or an expressive mid-leg move under the motion-handoff contract — see **Camera grammar**
below), and **no end frame** — an end frame of a wide establishing shot forces the
camera to pull back, which is the #1 cause of stutter. Extract each leg's last frame to feed the
next. Result: every seam is frame-identical **and** the camera never reverses. There are
**no connectors** (skip Step 5) — the legs ARE the journey. Wire each leg as a section
clip with `connectors: []` and a small `crossfade` (~0.08). Even without an end frame
the legs still arrive at distinct rooms (the prompt steers the content). Cost: strictly
**sequential** (can't parallelize) and slower; interiors trip the NSFW filter, so build in
re-rolls (3 attempts/leg).

### B) Dive-in + aerial connector — only for diorama / miniature / god's-eye worlds
A "dive into each scene" clip + a connector that pulls **up and out** and flies over to the
next scene (Step 5). The pull-out **reverses camera direction at every seam** (forward dive
→ backward pull-out). In a miniature/diorama world that reads as an intentional "zoom out
to the map, fly to the next island"; in a grounded first-person walkthrough it reads as a
jarring **rewind/stutter**. Use B only for the map-like aesthetic — which is exactly
what the "fly through the world" interview answer opts into; the reversal reads as
intentional there. If the user picked B against a grounded/photoreal direction, say
why it will read as a stutter and confirm before rendering.

### Camera grammar — the move should fit the concept (A is NOT "forward only")

"Forward only" is the *seam* rule, not the *leg* rule. The physics of the chain:

- **Position continuity** at a seam comes from the frame handoff (next leg starts from the
  previous leg's actual last frame).
- **Velocity continuity** at a seam means the camera must never *reverse across a seam* —
  that's the rewind stutter.
- **Inside a single leg the camera is free.** One leg is one continuous render — there is
  no seam to break mid-leg, so orbits, crane-ups, lateral tracking, even a push-in that
  eases back out are all safe *within* the clip. Reversals are only fatal *across* seams.

So give each leg an expressive move chosen from the scene's own logic, under a **motion
handoff contract**: every leg **ends by settling into a slow, steady forward drift** toward
the next destination (final ~1 s), and every leg **begins by continuing that same drift**.
Keep both clauses in the prompts verbatim (templates in `references/prompts.md`).

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
prompts.md). The handoff contract is unchanged. Seedance drifts the angle slightly on
long legs — the existing eyeball-each-last-frame rule is the catch; re-roll a leg whose
view has rotated. Calmest look, cheapest re-rolls, and the closest to the Emons
reference.

Two related pacing knobs live in the engine (Step 7): per-section `scroll` (more scroll
distance = longer dwell in that scene) and `linger` (the camera settles mid-scene exactly
while the copy peaks, then picks up speed toward the seam). Prefer expressive motion in the
*clip* and restraint in the *scrub mapping* — they compound.

And remember scroll is a scrubber: visitors can scroll **up**, so every move also plays in
reverse. That's free and expected — no extra work — but it's another reason seam velocity
must be consistent in both directions (a seam that reads fine forward reads as a stutter
backward too if velocity flips).

**For B**, one camera flight per scene: starts high/outside, descends into the interior,
structure opens. Endpoint: the chain endpoint you picked above (default **`seedance-2-image-to-video`**),
**start frame = the scene still**.

- Use the **solid-background still** (not the knocked-out transparent one) as the
  start image, so the video has a full frame.
- Prompt: "Single continuous cinematic camera move, no cuts. Begin high and far looking
  at the whole <scene> from outside … descend and fly inside toward <focal point> … the
  roof/walls gently open to reveal the interior. <style>, smooth graceful slow motion.
  No text." (Template in `references/prompts.md`.)
- Payload (Seedance): `{prompt, images_list:[startUrl], aspect_ratio:"16:9", duration:8,
  high_bitrate:true}`. For Kling: `image_url` + `last_image` instead of `images_list`,
  `generate_audio:false`, `duration:10`.
  Do **not** pass `--generate-audio` (it errors on seedance; audio is wasted anyway —
  you'll mute).
- Run concurrently, detached; `--out` downloads each result. Re-roll individual
  failures. Keep the raw 1080p sources — you need their frames next.

---

## Step 5 — Connectors (architecture B only)

Skip this whole step for architecture **A** — the forward take has no connectors; its legs
already chain seamlessly. This step applies to **B** (diorama/miniature), and note the
reversal caveat from Step 4.

The connector clips are what make the world feel *connected* instead of cut. A connector
flies from the end of scene i out and into the start of scene i+1. **Both of its
endpoints must be the ACTUAL RENDERED FRAMES of the neighbouring clips — never the
original diorama still.**

Why: every generation renders slightly differently. If a connector *ends* on
a fresh render of "the kitchen diorama," but the next dive clip *starts* on its own
different render of that same diorama, the two won't match and you get a pop at the seam.
The fix is to hand off the exact pixels:

```
For each connector between dive_i and dive_{i+1}:
  start-image = the LAST frame extracted from dive_i's rendered video
  end-image   = the FIRST frame extracted from dive_{i+1}'s rendered video
```

Now every seam is frame-identical on *both* sides:
`dive_i.end == connector.start` and `connector.end == dive_{i+1}.start`.

Extract the boundary frames from the rendered dives (not the stills):

```bash
ffmpeg -sseof -0.15 -i dive_i.mp4   -frames:v 1 -q:v 2 dive_i_last.png    # interior of i
ffmpeg -ss 0      -i dive_{i+1}.mp4 -frames:v 1 -q:v 2 dive_next_first.png # establishing of i+1
```

Generate the connector (`duration: 5` is plenty). Connectors need an **end frame**, so the
endpoint must accept one — use `seedance-2-first-last-frame` (or its `-fast` previz twin).
Both frames are uploaded first, then passed as `images_list: [start, end]` **in that order**:

```bash
MU=~/.claude/skills/higgsfield-models/scripts/muapi.mjs
su=$(node $MU upload dive_i_last.png)
eu=$(node $MU upload dive_next_first.png)
node $MU gen seedance-2-first-last-frame "$(jq -n \n  --arg p "$(cat connector_i.txt)" --arg s "$su" --arg e "$eu" \n  '{prompt:$p, images_list:[$s,$e], aspect_ratio:"16:9", duration:5, high_bitrate:true}')" \n  --out conn_i.mp4
```

Connector prompt: "Single continuous camera move, no cuts. Pull up and back out of
<scene i>, rise into the sky, glide across the connected miniature world, and arrive
above <scene i+1>, beginning to descend toward it. Seamless flowing aerial transition.
<style>. No text." (Template in `references/prompts.md`.)

Insurance: Seedance lands *close* to the end frame but not always pixel-perfect, so the
engine still applies a **short crossfade** (a few frames) at each seam. Frame-matched
endpoints + a small crossfade = no visible cut. Never skip the actual-frame handoff and
rely on the crossfade alone; a big content jump can't be hidden by a crossfade.

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
   (1080p from Seedance — don't downscale), `crf ~20`, a **small GOP** (`-g 8`) rather
   than all-intra (all-intra bloats an 8s clip to ~25 MB; GOP 8 is ~8 MB and scrubs
   fine via blob). Strip audio, add faststart, and a light `unsharp` counters video
   softness:

```bash
ffmpeg -i src.mp4 -an -vf "unsharp=5:5:0.8:5:5:0.0" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
  -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart out.mp4
```

Encode all 2N-1 clips (dives + connectors) with the same settings for uniform quality.

**Mobile encodes (only if the user opted in at Step 1.6).** The mobile version is
the **native 9:16 portrait chain** (pipeline.md §6b): portrait renders of every dive and
connector, encoded **720 wide (`scale=720:-2`), `-g 4`** (more keyframes = cheaper seeks —
phone decoders' seek cost scales with GOP length), crf 23 — wired as `clipMobile` /
`connectorsMobile`, with each portrait dive's first frame extracted as the section's
`stillMobile` poster (Step 7). The engine serves them automatically on phones and falls
back to the desktop clip when absent. The 16:9 centre-crop `encm()` encodes
(pipeline.md §6) are a **fallback only** — for when credits can't cover the portrait
chain — and shipping them must be called out to the user, never silent. If the user chose
desktop-only, skip this — the engine still hardens phone scrubbing regardless
(seek-coalescing, iOS priming), so the page degrades gracefully rather than breaking.

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
  connectors:       ['assets/vid/conn1.mp4','assets/vid/conn2.mp4',   /* … length = sections-1 */],
  connectorsMobile: ['assets/vid/conn1-m.mp4','assets/vid/conn2-m.mp4' /* … same length; mobile opt-in only */],
});
```

The engine handles: the ordered dive/connector chain, scroll→currentTime with rAF
smoothing, blob loading, lazy prefetch of nearby clips, frame-matched crossfades, pinned
per-section copy (first section greets on landing, last holds its CTA), a route rail,
`prefers-reduced-motion`, and mobile. **Pacing per section:** `scroll` overrides
`diveScroll` for that scene (more scroll = longer dwell) and `linger` (0–1, keep ≤ 0.6)
remaps time so the camera settles mid-scene — exactly while the copy peaks — then speeds
up toward the seam; seam frames are untouched (f(0)=0, f(1)=1). Give the hero and finale
scenes a higher `scroll` + some `linger`; keep transit scenes brisk. Theme it with CSS variables (`--accent`,
`--sw-bg`, `--sw-ink`, …) — the visual identity comes from the generated clips, so the
chrome stays quiet. See the header of `scrub-engine.js` for the full config + CSS vars.

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
  must be near-identical (the dive's last frame == the connector's first frame). If they
  pop, you used the diorama still instead of the actual rendered frame (redo Step 5), or
  the crossfade band is too short. Calibration: judge seams by *composition*, not raw
  PSNR — at 720p/1080p a correctly frame-locked seam can read ~18–25 dB from detail
  shimmer alone (observed on a verified-good build); a real mismatch shows as different
  composition/props, not just softness.
- Check the console for errors, confirm `video.seekable.end(0) > 0` (blob working), and
  that `currentTime` tracks scroll across each clip's band.
- **Mobile — full checklist only if the user opted into the mobile version (Step 1.6).**
  For a desktop-only build, just sanity-check a phone viewport once: page loads, still
  posters show, nothing overlaps — the engine's hardening covers graceful degradation.
  For the mobile build (do this on a real phone or an emulated one, portrait + landscape):
  - Emulate a phone viewport **with CPU throttled 4–6×** and scroll fast — the clip should
    track without freezing (the seek-coalescing + `-m.mp4` encodes are what make this hold).
  - Confirm the first scene shows immediately (its still is the poster) and the video takes
    over the instant you scroll — no blank/black scene (the iOS priming fix). Test iOS Safari
    specifically; it's the one that goes blank if this regresses.
  - Verify the `-m.mp4` variant is actually served on mobile (Network panel), and the
    heavy 1080p master on desktop. The mobile clips must be **natively portrait**
    (`videoWidth < videoHeight` — not a downscaled 16:9 file), and the `stillMobile`
    posters must be served and match each portrait clip's first frame (no
    landscape→portrait flash when the video paints).
  - Slowly scroll so the URL bar collapses — the page must **not jump** (height-only resizes
    are ignored on touch). Rotate the device — layout should recompose cleanly.
  - Only if the crop **fallback** shipped (no credits for the portrait chain): portrait
    crops a 16:9 clip to its centre — confirm the focal subject still reads, and remind
    the user this is the stopgap, not the mobile version.
- Check reduced-motion (should fall back to the stills, no video, no particles).

---

## Gotchas (hard-won)

- **Seam pop** → connector endpoints were the diorama stills, not the neighbouring
  clips' actual frames. Always extract real frames (Step 5).
- **Seam stutter / camera "jumps backward"** → even with frame-matched seams, if the
  camera *velocity reverses* (forward dive, then a connector that pulls back out) it
  reads as a rewind. This is inherent to architecture B. For any grounded walkthrough use
  architecture A (one continuous forward take — legs chained from actual last frames, no
  pull-back, no end frame); see Step 4.
- **Frozen video / stuck at frame 0** → `seekable=[0,0]`; the host isn't serving byte
  ranges. Use blob URLs (engine does).
- **Huge files** → you used all-intra. Use `-g 8` + blob instead.
- **Soft / low quality** → you downscaled or over-compressed. Encode native 1080p,
  crf ≤ 20, add `unsharp`. Video is inherently softer than the stills — keep the stills
  as the lite fallback for max fidelity.
- **Concurrent gens 503 / rate-limit race** → transient when many launch at once;
  re-roll the individual failure rather than restarting the batch, and check
  `cost.refunded` on the failed one.
- **NSFW false-positives (Seedance `status "nsfw"`)** → the video content filter flags
  perfectly innocuous clips, especially **bedroom, pool, spa/wellness** contexts and
  trigger words like "bed", "pool", "waterfall", "wine", "swim". It's partly the prompt
  wording and partly the reference frames. Fixes, in order: (1) re-roll — it's often
  non-deterministic and passes on the 2nd–3rd try; (2) strip trigger words and add
  "empty, unoccupied, no people, no figures, architectural, tasteful"; (3) regenerate
  just that clip on **`kling-v3.0-4k-image-to-video`** with the same start/end frames — a different
  provider's filter often passes what Seedance blocks. Expect a slight render-character
  shift on that one clip (each model has its own grain/motion feel); for a 5s connector
  behind a crossfade that usually beats option (4): set the connector slot to `null` —
  the engine crossfades that seam directly (optional connectors), so the page still
  completes. Budget extra spend/time for these re-rolls on interiors/real-estate content.
- **Dark / custom theme** → the engine wraps its default tokens in `@layer sw`, so a
  page-level `:root` / `.sw-root { --sw-bg; --sw-ink; --sw-accent; --sw-font-* }` block
  wins cleanly (no specificity hacks). `--sw-ink` is your primary **text/heading** colour;
  the **accent** fills the primary button and active nav. For a dark theme, set `--sw-bg`
  dark and `--sw-ink` light — the copy scrim and title shadow follow `--sw-bg` automatically.
- **Phone scrub stutters / freezes on a fast flick** → the 1080p master is too heavy for a
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
- **Audio you didn't ask for** → Seedance's muapi payload has no audio field (omit it);
  Kling's `generate_audio` defaults on, so pass `false`. Mute in HTML and `-an` on encode.
- **Kling payload is a different shape** → `kling-v3.0-4k-image-to-video` takes
  `image_url` + `last_image`, NOT `images_list`. Don't copy the Seedance payload onto it.
- **Seam pop only where you "saved credits"** → you swapped models mid-chain, or used a
  a start-frame-only endpoint where a connector needs an end frame. One model for the whole
  chain; the only cheap tier is the `-fast` pair, which keeps frame-locking so it stays
  seamless. (Any model with reference-only inputs can't hold a seam at all — Step 4.)
- **muapi rejects inline / local images** → conditioning frames must be **hosted URLs**.
  Upload every local PNG first (`node $MU upload frame.png` prints the URL) and pass the
  URLs in `images_list`; never base64 and never a file path.
- **Connector seam reversed** → `images_list` for `seedance-2-first-last-frame` is
  ordered `[start, end]`. Swapping them renders the flight backwards, which reads as a
  hard pop at both seams.
- **Result URL 404s later** → muapi's output URLs are hosted and **expire**. Always pass
  `--out <file>` so the clip lands on disk in the same run; re-polling an old
  `request_id` after expiry gets you nothing.
- **A generation seems to hang** → video takes minutes. Submit with `--no-wait`, keep the
  `request_id`, and `node $MU poll <id> --out clip.mp4` later. Never block a foreground
  call on it, and never assume failure before the poll says `failed`.
- **Charged for a failed clip** → check `cost.refunded` in the result: `true` means the
  credits came back. Read `cost` off the FIRST clip to learn the real per-clip rate
  before batching the rest.
- **Endpoint schema drift** → muapi's roster moves (endpoints get `-fast`/`-vip` twins,
  input fields change). Run `node $MU models <name>` and read the `Inputs` column before
  each build; re-run the Step 4 qualification probe if it differs from what
  `references/backend.md` documents.
  what pipeline.md documents.
- **Codex stills hang at "Reading additional input from stdin..."** → parallel
  `codex exec` calls launched from one script share the parent's stdin; one wins it,
  the rest block forever (observed: 1 of 3 completed, 2 hung, the second batch never
  started). Always append `< /dev/null` to every backgrounded `codex exec` — the
  pipeline's `gen_still_codex` has it; keep it if you adapt the command.
- **White-box scenes** → `gpt-image-2-text-to-image` returns a solid bg; either match the page bg to it
  or knock it out (Step 3).
- **bash 3.2** on macOS → no associative arrays in scripts.
- **Connector grabs the wrong scene's frames** (or errors on a frame that doesn't exist
  yet) → the array loop ran in **zsh** (macOS default interactive shell), where arrays are
  1-indexed, not bash's 0-indexed. Keep every array-driven chain step in a `#!/bin/bash`
  script run via `bash script.sh` — never inline array loops in the interactive shell.

## References

- `references/prompts.md` — the intake checklist, style-preamble pattern, and every
  prompt template (scene still, dive, connector) with fill-in slots.
- `references/pipeline.md` — copy-paste batch scripts for the whole run (generate →
  extract frames → connectors → encode → mobile encode), bash-3.2-safe.
- `references/scrub-engine.js` — the portable, config-driven scrub engine (builds DOM +
  injects CSS; blob-seek, lazy load, seam crossfade, copy, route rail, reduced-motion, and
  phone hardening: mobile encodes, seek-coalescing, iOS priming, safe-area, no-jump resize).
- `references/index-template.html` — a minimal standalone page that mounts the engine.
- `references/knockout.py` — border-connected background knockout for floating scenes.
