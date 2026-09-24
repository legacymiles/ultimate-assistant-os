---
name: preview-icon
description: Generate looping video preview icons that show what an app, product, website or workflow actually DOES — the kind of clip that sits in a tool grid on openart.ai or magiclight.ai and plays on hover. Use this WHENEVER the owner says "preview icon", "my preview icon skill", "icon video", "grid video", "app preview video", "hover preview", "make a clip for this app", or wants a tile/card/grid entry to show a moving preview instead of a static or CSS icon. Also use it when adding an app to the hub catalog and it needs its grid clip, when re-rendering an existing icon, or when any product/tool/service needs a short silent looping clip that sells its function at a glance. Draws the still with an OpenRouter image model, then brings it to life either with free local ffmpeg motion or, when the shot needs genuinely new imagery, MiniMax H3 on the owner's own RunPod endpoint — then trims, loops, compresses and posters the result into a grid-ready asset.
---

# Preview icons

A preview icon is a 2-3 second silent loop that answers one question in the time it takes to
glance at a grid: **what does this thing do?**

The reference feel is the tool grid on openart.ai and magiclight.ai — a wall of cards, each
playing a tiny clip of its own output, that come alive under the cursor. Those cards work because
of a choice most people miss, so it is the first rule here.

## The one rule: depict the verb, not the screen

Never generate a picture of an interface. A generated app window is the single worst thing to put
in a grid: fake text renders as garbled mush, fake buttons date instantly, and at 200px none of it
is legible anyway. It also lies — it is not the real product's UI.

OpenArt's cards do not show OpenArt. They show a portrait morphing, a still breaking into motion,
a sketch becoming a render. The card sells **the transformation the tool performs on something**.

So for every icon, ask: *what does this thing do to what?* Then film that as a physical event in a
real space, with no screen anywhere in frame.

| App | Wrong (never do this) | Right |
|---|---|---|
| Music Creator | a fake DAW timeline with tracks | a studio mic in the dark, dust in the beam, light pulsing along a waveform blooming outward |
| Multi-Order Calculator | a fake spreadsheet filling in | scattered paper receipts sliding together, collapsing into one clean figure |
| Website Redesigner | a browser window restyling | a rough paper wireframe soaking into a polished glass sheet |
| God's Eye View | a fake map UI with pins | a dark globe turning as a sensor sweep crawls across the terminator |
| Skills Library | a fake list of skills | identical blank cards fanning out, one lifting and catching the light |

This rule is what makes generation-only footage work. Break it and every icon looks like stock AI
video; hold it and separately generated clips read as one deliberate set.

## Pipeline

Four steps. Each writes to disk so a failure never costs a re-render — these are paid generations.

```
plan.mjs   reads the catalog (or a URL / description) -> plan.json: archetype, engine, prompt per item
  |  show the owner the plan and get a go-ahead before spending
render.mjs muapi -> work/raw/<slug>.mp4   (resumable: skips anything already downloaded)
  |
finish.mjs trims to a seamless loop, compresses, cuts the poster -> public/hub/icons/<slug>.{mp4,webp}
  |
wire       add previewIcon to the catalog entry so every hub version reads the same asset
```

```bash
cd ~/.claude/skills/preview-icon
node scripts/plan.mjs --catalog "C:/Users/honey/OneDrive/Desktop/claude code files/src/lib/catalog.ts" --out work/plan.json
node scripts/plan.mjs --describe "turns a reference song into Suno prompts" --slug soundprint --out work/plan.json
node scripts/render.mjs work/plan.json --only music-creator
node scripts/render.mjs work/plan.json --confirm
node scripts/finish.mjs work/plan.json --public "C:/Users/honey/OneDrive/Desktop/claude code files/public/hub/icons"
```

Render one item first, always. Look at it, apply the read test below, and only then spend on a
batch.

## Choosing what the icon shows

Resolve every item to exactly one of five archetypes. The archetype — not free judgement — picks
the prompt shape, which is what keeps the set coherent when clips are generated weeks apart.

| Archetype | The app... | The clip shows |
|---|---|---|
| **Transformation** | converts A into B | the input visibly becoming the output |
| **Accumulation** | collects, files, organises | many scattered things flowing into order |
| **Interrogation** | searches, analyses, scores, verifies | a subject being swept, scanned, ranked |
| **Emission** | generates something from nothing | form condensing out of empty space |
| **Inhabitation** | is a game, world, or cinematic | a camera moving through a place |

`plan.mjs` infers the archetype from the catalog's `category` and `overview`, which is right most
of the time and cheap to correct in `references/overrides.json` when it is not.

Read `references/archetypes.md` before writing any prompt. It carries the template behind each
archetype, the subject vocabulary that keeps them distinct, and the loop and framing constraints
that make the output actually usable.

## House style

These clips share a grid, so they must look like one set. The locked style — deep near-black
ground, the app's own two hues as the only colour, macro lens, one continuous move, no text, no
faces, no UI — lives in `references/house-style.md`. `plan.mjs` appends it to every prompt
automatically; read the file when adjusting it or explaining why a shot looks off.

The hues matter more than they look. Each catalog entry already carries `hue: [h1, h2]` driving
its CSS icon, so feeding those into the prompt makes the video icon inherit the colour identity
the app already has. The grid keeps its palette when it becomes video.

## Two stages, and where each runs

An icon is a **still** plus **motion**, produced separately. Stills are pennies and arrive in
seconds, so a weak shot is caught before anything costly happens.

**Stage 1 — the still: OpenRouter** (`google/gemini-3.1-flash-image`). The same route the hub's
Image Studio uses. This is the stage that decides whether an icon is any good.

**Stage 2 — the motion**, cheapest tier that can carry the shot:

| Tier | Cost | Handles |
|---|---|---|
| **ffmpeg** on the still | free | Inhabitation, Interrogation, Transformation |
| **H3 on the owner's RunPod endpoint** | ~$0.023 / 5s clip | Accumulation, Emission — anything needing new imagery |

The split is not arbitrary. ffmpeg transforms pixels that already exist; it cannot make receipts
converge or form condense from nothing. Those need a real video model. Everything else — a push
through a corridor, a sweep across a subject, a crossfade between two stills — is motion the still
already contains.

Escalate rather than pre-pay: if an ffmpeg version fails the read test, re-render that one item on
H3. A local Wan on ComfyUI is installed as a third, free tier — see `references/engines.md` for
it, the exact payloads, and the providers this skill deliberately does not use.

## The read test

An icon only works at the size it is actually seen. `finish.mjs` writes
`work/readtest/<slug>-200.png` — the clip's middle frame at 200px.

Judge that image, not the full-size render. Can you tell what the app does? If it only reads at
full size the shot is too busy, and the fix is almost always fewer objects and a larger subject
rather than a better model.

## Output contract

A wall of these has to load. Magiclight, at this exact scale, ships **zero video elements on first
paint** — every card is a still, and the clip is only created on interaction. Match that.

`finish.mjs` produces, per item:

- `<slug>.mp4` — 512x512, 2.5s, seamless loop, H.264 yuv420p, `+faststart`, target under 400 KB, no audio track
- `<slug>.webp` — the poster, the clip's own first frame, under 40 KB

Square, because the hub icon is square (`AnimatedIcon` renders `width: size, height: size`), so one
asset serves the v1 grid, the v2 carousel panel and v3 alike.

Then wire it into the catalog entry, so the clip belongs to the app rather than to whichever view
is currently fashionable:

```ts
previewIcon: { src: "/hub/icons/music-creator.mp4", poster: "/hub/icons/music-creator.webp" },
```

## Playback contract

Every view consuming these — v1 grid, v2 carousel, v3 — should behave identically, so the icons
feel the same wherever they appear:

- Render the poster as a plain `<img>`. It is what shows at rest and what makes the grid paint instantly.
- Create the `<video>` only on hover or on entering the viewport, with `preload="none"`. Mounting
  every video up front is what kills these grids on mobile.
- `muted`, `loop`, `playsInline`, no controls. Autoplay is only allowed while muted.
- Under `prefers-reduced-motion`, stay on the poster and never start the clip.

## Cost discipline

These generations bill the owner's muapi key. Render one, show it, and get a yes before a batch
larger than about five. `render.mjs` refuses a batch past that threshold without `--confirm`, and
skips anything already in `work/raw/`, so an interrupted run resumes instead of paying twice.

## Working outside the hub

The archetypes describe what a thing *does*, not this repo, so the same pipeline covers any
product, website or workflow. Use `--describe "<what it does>"` for a plain description, or `--url
<address>` to read a product page and infer the verb from it. Everything downstream is identical.

## Dependencies

- `OPENROUTER_API_KEY` — the still stage. Required.
- `RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_ID` — the H3 motion tier. Only needed for the archetypes
  that escalate; `--stills-only` and the ffmpeg tier work without them.
- ffmpeg and ffprobe — vendored in this skill's `node_modules` via `ffmpeg-static` and
  `ffprobe-static`, so nothing needs installing globally. Restore with `npm i` in the skill
  directory if they go missing.

All keys are read from the environment first, then the hub's `.env.local`. Match on horizontal
whitespace only when parsing that file: `\s` matches newlines, so an empty `KEY=` line silently
captures whatever follows it, which surfaces much later as an unreadable header error.
