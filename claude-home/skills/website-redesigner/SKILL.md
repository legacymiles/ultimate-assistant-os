---
name: website-redesigner
description: >-
  Take a URL and produce multiple redesign directions for the site, then a complete,
  paste-ready build prompt that rebuilds it with a fresh design while keeping the
  ORIGINAL functionality identical. Use this WHENEVER the user wants to redesign,
  restyle, reskin, modernize, or "make over" an existing website or page — phrases like
  "redesign this site", "redesign my landing page", "here's a URL, restyle it", "reskin
  this but keep it working", "make my site look like <named site>", "modernize this
  website", "give me a few redesign options for <url>", or hands you a URL and wants it
  to look better without losing what it does. Also trigger when the user wants to drive
  the redesign with specific design skills (interactive-web-studio, capcut-design,
  webgl-trail-reveal, exploded-showcase, etc.). Produces redesign directions (each powered
  by a design skill) plus a functionality-preserving build prompt for the chosen one.
---

# Website Redesigner

Given a URL, this skill redesigns the *look* of a site while preserving what it *does*.
It never ships a single take — it proposes **multiple redesign directions**, each driven by
a real design skill, then writes a complete build prompt for the direction the user picks.

The core promise, and the hard part, is **functionality preservation**: the redesign
changes the design layer only. Every form, button, flow, and interaction the site has must
survive. The mechanism for that is a **functionality inventory** captured up front and
carried into the final prompt as a contract.

## Inputs to establish first

1. **The URL.** The site to redesign.
2. **Is it the user's own site?** This changes everything (see below). Ask if unclear.
   - If **yes**: get the **source path / repo** so the rebuild edits real code.
   - If **no**: it's an external URL — you can capture design + content + behavior, but not
     their backend.
3. **Design skills in play.** Which design skills should drive the directions? Default to
   auto-picking from what's available (`interactive-web-studio`, `capcut-design`,
   `webgl-trail-reveal`, `exploded-showcase`, `scroll-craft`, and any the user names). The user can add or
   restrict this set. See `references/directions.md` for how to map skills to directions.

### Own site vs. any URL (be honest about this)

| | The user's own site | Any external URL |
| --- | --- | --- |
| Analyze + redesign directions + build prompt | ✅ | ✅ |
| Genuinely working redesign, identical functionality | ✅ real — the prompt edits the actual source, keeping all logic, handlers, and API calls; only the design changes | Front-end reconstruction + a behavior spec — their backend/auth/DB can't be reproduced from a scrape |

Encode this in the final prompt, don't pretend the app enforces it:
- **Own site** → "edit the existing source at `<path>`; preserve all logic/handlers/API
  calls/routes; restyle only."
- **Any URL** → "recreate the front-end and every behavior in the inventory under the new
  design."

## Step 1 — Analyze the site

Fetch the page and extract:
- **Content** — the real copy: headline, subhead, nav items, section text, CTAs. The
  redesign must use the site's actual content, not lorem ipsum.
- **Structure** — the section order and page hierarchy.
- **Current design tokens** — dominant colors and fonts, so directions can deliberately
  depart from (or refine) them.
- **Functionality inventory** — the crux. A structured list of everything the site *does*:
  nav, forms (with their fields and target), search, auth, cart/checkout, filters, media
  players, CTAs, anything interactive. Each item: `kind`, `label`, and the `detail` needed
  to preserve it.

If the page is JS-heavy and a fetch returns little usable HTML, say so plainly and ask the
user to paste a short description of what the site is and does — a thin scrape yields a
thin redesign.

## Step 2 — Propose multiple redesign directions

Generate **3 distinct directions** (offer more on request). Each is a concrete concept, not
a vague vibe:

- **name** — e.g. "Editorial Brutalist", "Calm Minimal", "Kinetic Dark".
- **pitch** — one line on the feeling and who it's for.
- **driving skill** — which design skill powers it (and why it fits this site).
- **palette / typography / layout / motion** — specific tokens and moves, not adjectives.
- **reference bar** — a real, named site this direction should *beat* (the gauntlet-loop
  idea — see `[[gauntlet-loop-skill]]`). Named + fetchable + comparable.

Make the three genuinely different (e.g. one restrained, one expressive, one experimental)
so the choice is meaningful. If you can show a hero mockup (built from the real extracted
content), do — otherwise describe each direction concretely enough to picture it.

See `references/directions.md` for palette/type presets and skill→direction mappings to
avoid generic proposals.

## Step 3 — Write the functionality-preserving build prompt

Once the user picks a direction, assemble one clean, paste-ready Claude Code prompt:

1. **Target** — the URL, and (own site) the source path to edit.
2. **Functionality to preserve — exactly** — the full inventory from Step 1, as a checklist
   the build must satisfy. This is the contract; lead with it.
3. **Design direction** — the chosen direction's palette, typography, layout, and motion.
4. **Skill invocation** — tell the build agent to use the driving design skill by name
   (e.g. "Use the `interactive-web-studio` skill for the motion and scene work").
5. **Reference bar** — "beat `<referenceBar>`" as the quality gate (optionally wrap the
   whole thing in a `[[gauntlet-loop-skill]]` Builder-vs-Critic loop).
6. **The own-site-vs-any clause** from above.

Offer to save the result (e.g. into Projects Timeline / hand it to a build agent).

## Failure modes (what quietly ruins a redesign)

- **Lost functionality** — the whole point is design-only change. If the inventory is thin,
  the rebuild silently drops features. Fix: capture the inventory thoroughly and make it the
  prompt's contract.
- **Lorem-ipsum redesign** — using placeholder content instead of the site's real copy makes
  the preview a lie. Fix: extract and reuse actual content.
- **One-note options** — three directions that are all "clean and modern" waste the choice.
  Fix: force real variety (restrained / expressive / experimental).
- **Vague direction** — "make it pop" gives the builder nothing. Fix: concrete tokens + a
  named reference bar to beat.
- **Pretending to keep a backend you don't have** — for external URLs, don't claim the
  redesign preserves their auth/DB. Fix: reconstruct the front-end + behavior spec, and say
  so.

## Related

- `[[gauntlet-loop-skill]]` — wrap the rebuild in a Builder-vs-Critic loop that iterates
  until it beats the reference bar.
- Design skills this pairs with: `interactive-web-studio`, `capcut-design`, `scroll-craft`,
  `webgl-trail-reveal`, `exploded-showcase`.
