# Asset resolution ladder

A clone needs the page's images, videos, textures, and icons. Some you can just
download; some are blocked (cross-origin, DRM, auth-walled); some you *shouldn't*
copy at all (a brand's logo in a learning clone). This ladder decides, per asset,
how to resolve it — and keeps the result honest about which tier was used.

The governing rule: **a faithful clone wants the REAL asset.** Generating a
lookalike is a fallback, never the default, and is gated by what the asset *is*.
A generated hero-background texture raises completeness; a generated logo lowers
fidelity AND copies brand identity. So gate by role, not by convenience.

## The four tiers (label every asset with the one used)

1. **REAL** — download the actual file to the project (`<img src>`, `<video>`,
   background-image, source-set). Default. Highest fidelity. Always try first.
2. **RECONSTRUCT** — rebuild it yourself when it's cheaply rebuildable: an inline
   SVG you can extract, a CSS gradient, a canvas/WebGL effect (hand to
   shader-extract). Faithful and license-clean.
3. **GENERATE** — synthesize a substitute (muapi via the higgsfield-models skill, or OpenRouter/H3 — see "Generating an asset" below). Only when 1 and
   2 both fail or are disallowed. Label the asset `GENERATED` and log it in
   `known-gaps.md`. Never let a generated asset be reported as REAL.
4. **PLACEHOLDER** — a solid block, blurhash, or captured poster frame, when
   generation isn't wanted or the asset is identity/content (below).

## Gate by role — the decision that matters

**Decorative / demo assets → GENERATE is appropriate** when REAL/RECONSTRUCT fail:
- hero or section **background video/image** that's blocked or heavy
- ambient **textures**, noise maps, gradient meshes, particle sprites
- a **poster frame** for a shader/canvas that couldn't be reconstructed
- filler **product/UI mockups** in a demo where exact content doesn't matter

**Identity / content assets → NEVER generate. REAL-or-PLACEHOLDER only:**
- **logos**, wordmarks, brand icons
- real **UI screenshots** / product imagery that carries meaning
- **photos of real people**, testimonials, author avatars
- anything where a generated substitute would misrepresent the original

Generating identity assets makes the clone *less* faithful and copies brand
identity — both wrong. If you can't get the real one, use a neutral placeholder
and note it.

## Special case: composited live-UI mocks (the download trap)

The most common asset mistake on modern product sites: a hero or feature visual
that *looks* like one image is actually a **live UI composited in HTML over a
static background image** — a fake app window, code panel, or dashboard layered
on a painterly/gradient wallpaper. If you naively download the background image
(tier 1 REAL), you get an empty wallpaper with none of the UI, because the UI was
never in that file. Worse, sites often **reuse the same wallpaper** across several
feature blocks, so an nth-image match lands on the wrong block's background.

How to handle it:

- **Recognize it:** the region contains real DOM (text nodes, buttons, code) on
  top of an `<img>`/background whose natural size ≈ the whole region and whose
  content is just texture. If getComputedStyle sees real child elements over an
  image, it's composited — not a flat asset.
- **Capture, don't download:** screenshot the composited region as a whole
  (Playwright `clip` at the region's box) → tier is CAPTURED, not REAL. This is
  the faithful static representation of a live composition.
- **Reused-wallpaper guard:** don't trust "the nth `<img>`" to identify the
  block — capture by the region's own bounding box at the scroll offset where it's
  fully visible (see the scroll-pinned note in `interaction-fingerprints.md`).

Label these CAPTURED in the report so it's clear the pixels are a snapshot of a
live composition, not a downloaded source asset.

## Generating an asset (tier 3) — owner's setup

(Local adaptation: upstream called the Higgsfield MCP. This machine does NOT use
Higgsfield — per the owner's global rule, Higgsfield models run through the
`higgsfield-models` skill (muapi.ai, MUAPI_API_KEY). If that key is empty, use the
OpenRouter / H3 scripts that are already configured.)

Match the tool to the asset. Follow the creative-direction rule: for anything
non-trivial, propose 2–3 directions and get a pick before spending money.

- **Image** (texture, background, mockup):
  - muapi (when MUAPI_API_KEY is set): `node ~/.claude/skills/higgsfield-models/scripts/muapi.mjs gen gpt-image-2-text-to-image '{"prompt":"…","aspect_ratio":"16:9"}' --out <asset>`
    (GPT Image for design/text-in-image; `nano-banana-pro-edit` with an uploaded
    `images_list` for reference-driven — upload first with `muapi.mjs upload <file>`).
  - otherwise OpenRouter: `node ~/.claude/skills/h3-scroll-world/scripts/still.mjs --prompt-file p.txt --out <asset> [--ref <img>] [--aspect 16:9]`.
  Feed it the surface's role, palette (from design tokens), and aspect/size from the surface map.
- **Video** (hero background loop) → `node ~/.claude/skills/h3-scroll-world/scripts/h3.mjs --prompt-file brief.txt --out <asset>.mp4 [--first-frame <poster>] --duration <n> --ratio <W:H>`
  (MiniMax H3, the owner's video model; write the prompt as an H3 brief — see
  h3-scroll-world/references/prompts.md). Strip audio (`-an`) and loop-encode to
  match the original `<video>` (muted, duration, aspect).
- **Import a specific asset you found but can't hotlink** → download it with the
  browser tool / curl into the asset dir (tier 1 if licensed, else don't).
- **Cutout / transparent** → h3-scroll-world/references/knockout.py, or regenerate
  on a flat background and key it.

Write generated assets into the project's asset dir with a filename tagged
`-generated` and record in `known-gaps.md`: original URL (if any), why REAL/
RECONSTRUCT failed, the prompt used, and the tier. This keeps the clone auditable
and the fidelity claim honest.

## Reporting

In the completion report, break assets down by tier: N REAL, N RECONSTRUCT, N
GENERATED, N PLACEHOLDER. A clone that's 90% REAL with 3 clearly-labeled
GENERATED decorative textures is honest and complete. A clone silently padded
with generated brand assets is neither.
