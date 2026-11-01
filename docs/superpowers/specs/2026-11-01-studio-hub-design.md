# Studio Hub — seven studios behind one wall

Date: 2026-11-01 · Branch: `feat/studio-hub-studios`

## The problem

Jarvis's Studio tab is one wall of 124 video/image workflow cards with a medium
toggle on top. Everything else that makes something — Image Studio, Audio
Studio, Music Video Studio, Game Creator, Social Personas — is a **plugin card**
on a different page (`src/lib/studio/plugins.ts`), and opening one leaves Jarvis
for its own tab. So "Studio" names one of seven studios while the other six sit
behind a different door, and the owner has to remember which door.

Money Agent Studio does not exist at all. The nearest things are EA Lab (a
MetaTrader backtest bench) and the Multi-Order Calculator, both hub apps.

## The shape

Studio becomes **a wall of seven studios**. Clicking one drops you *into* it,
inside Jarvis, with its own sub-app rail and a way back to the wall. This is the
pattern `JarvisAudioStudio.tsx` already proves: a shell that owns exactly one
thing — which studio is mounted — and children handed `embedded` so they drop
their own wordmark. Nothing about how a studio works is reimplemented, which is
why merging costs no features.

| Studio | Sections | New? |
|---|---|---|
| **Video Studio** (lands first) | Workflows (the wall, locked to video) · Smart Shot · Arena · 3D Studio · Gallery | no |
| **Image Studio** | Agents · Workflows (the wall, locked to image) · Gallery | wall split |
| **Audio Studio** | Find · Classify · Create | no |
| **Music Video Studio** | Seedance engine | no |
| **Game Creator Studio** | Game Creator · Kart Teardown · Slippery Escape | no |
| **Personas Studio** | Personas · Dance Vault · Realtime Lucy | no |
| **Money Agent Studio** | Trading Agent · EA Lab · Calculator | Trading Agent is new |

### The wall splits

Today one wall holds both mediums behind a toggle. Video Studio takes the wall
locked to `video`; Image Studio gets the same component locked to `image`. The
toggle goes away, because the studio you are standing in already answers it.
`StudioTab` gains one prop, `lockMedium`, and is otherwise untouched — the 754
lines of composer, camera deck, references and mention plumbing are not rewritten.

### Money Agent Studio

Ships with EA Lab and the Calculator mounted, and a **Trading Agent** that reads
setups, explains them, and reasons about risk against EA Lab's recorded results.
It is analysis only. It has no broker connection, places no orders and moves no
money, and the UI says so where a reader could assume otherwise. That is a
design constraint, not a missing feature.

## Architecture

```
src/lib/studio/studios.ts        the seven studios + their sections (pure data)
src/lib/studio/studios.test.ts

src/components/jarvis/
  StudioRoot.tsx    the tab: the wall, or one studio. Owns `which`.
  StudioWall.tsx    the reel wall (the toy). Owns playback + drift.
  StudioShell.tsx   one studio: section rail + the mounted section.
  studio-hub.css
  StudioTab.tsx     unchanged but for `lockMedium` — now a *section*, not the tab
```

`Jarvis.tsx` mounts `StudioRoot` where it mounted `StudioTab`. Every section is
a `dynamic(..., { ssr: false })` import, so one studio's worth of JavaScript
loads at a time — Game Creator alone should not be downloaded by someone who
came to cut a video.

## The toy — "the reel wall"

Seven tall panels. **Only the panel nearest the pointer is live**; the rest hold
their poster frame under a faint dither. Move the pointer and playback *travels*
across the wall — the leaving panel decays rather than stopping dead, so it reads
as a light moving over a monitor wall. One live `<video>` is also the performance
rule, the same constraint-and-design agreement as the hub carousel's one live
iframe.

Surprises: **hold** a panel and the clip scrubs to how long you have held it;
sweeping **fast** leaves a brief tracking smear on the panels you crossed;
**8s idle** and playback starts wandering on its own, so the wall breathes on
standby; **click** expands the panel in place into the studio (the clip keeps
playing as the panel grows, then fades under the studio's own UI) instead of
cutting to it.

Each panel's sub-apps sit as small spines along its bottom edge and fan out on
hover, so hovering teaches you what is inside before you commit.

Emotion: **anticipation** — standing in a control room before you make something.

### Art direction

Inside the existing dark shell, not a foreign object: `--color-canvas #0a0b0f`,
`--color-panel`, `--color-ink`, with each studio's own hue used only for its edge
glow and its spine ticks. Type leads — the studio name is large and set in the
house sans; the clip lives under it, never over it. Motion is weighty and
confident: long eases, no bounce.

### Guardrails

- `prefers-reduced-motion`: no drift, no decay, no autoplay. Posters only,
  playback on explicit click of a panel's play affordance. All content survives.
- Keyboard: the wall is a real list — arrow keys move the live panel, Enter opens
  it, Escape returns. Focus ring visible.
- No clips present (the default until `preview-icon` has run): the panel falls
  back to its poster, then to the existing `cardStill` CSS motif. Never a black box.
- Playback pauses when the tab is hidden (`visibilitychange`) — a hidden pane
  that keeps decoding is the frozen-preview bug from God's Eye View.

## Card clips

`preview-icon` on the free route: OpenRouter still → ffmpeg motion (push-in,
parallax, light sweep) → looped, compressed, postered into `public/studio/`.
Seven clips, ~2s each, muted, `h264` + a `.webp` poster. Named by studio id.

## Testing

`studios.test.ts` covers: every studio has at least one section; every section
names a component the shell can mount; ids are unique and stable; the slug→studio
lookup resolves for every slug in `PLUGIN_SLUGS` that moved in; `lockMedium`
partitions the workflow catalog with nothing orphaned.

## What this does not do

- It does not delete the plugin page. Apps that are doors out and not studios
  (Website Redesigner, AI Rankings, Cook Connect, God's Eye View, EA Feature
  List) stay plugin cards. Only the seven move.
- It does not touch the hub front page or `hubProjects()` beyond the one new
  Money Agent Studio catalog entry.
