---
name: prompt-architect
description: >-
  Turn a vague, half-formed idea for a website or app into an amazing, build-ready
  prompt by running a short adaptive interview, then hand it off to the gauntlet-loop
  for adversarial refinement. Use this WHENEVER the user has an idea they want built
  and wants a great prompt for it — phrases like "write me a prompt to build X",
  "prompt engineer this idea", "turn my idea into a Claude Code prompt", "I have a
  vague idea for a site/app", "help me spec out an app", "engineer a build prompt for",
  "make this idea buildable", "I want to build something but don't know how to describe
  it", or any moment the user hands you a rough concept and wants it sharpened into a
  prompt that makes a coding agent build something great. Produces a single, excellent,
  paste-ready build prompt with a named quality bar baked in, and a gauntlet handoff.
---

# Prompt Architect

Take a broad, vague description of a website or app and, by asking a few sharp
questions, produce a prompt so good that a coding agent builds something *amazing*
from it. This skill is the front half of a pipeline: **vague idea → adaptive
interview → sharp build prompt → `[[gauntlet-loop-skill]]`**.

The job is not to build the thing. The job is to make the *input* to the builder as
good as it can possibly be. The best builder — Claude Code with the user's own design
skills and a gauntlet loop — already exists; a great prompt is the highest-leverage
artifact you can produce for it, because it is portable, editable, and reusable.

## The two things that make the output amazing

1. **A named quality bar.** Every build prompt this skill produces names a real,
   fetchable reference to beat (the `[[gauntlet-loop-skill]]` idea). "As good as
   linear.app for polish; as interactive as igloo.inc." A vague bar ("make it
   professional") gives the builder and the later gauntlet nothing to fetch. Landing
   the bar is one of the interview's jobs, not an afterthought.
2. **The right design skill wired in.** The user's amazing sites come from their own
   design skills. Detect the idea's vibe and name the skill(s) to use, so the build
   prompt tells the agent exactly which technique to reach for (see the router below).

## Process

### 1 — Intake
Read the vague idea. Silently classify it: **website / webapp / workflow**, and detect
the vibe (run it through the router). Do not ask anything you can already infer.

### 2 — Round 1 (≈3 questions)
Ask the **~3 highest-leverage questions** — the ones whose answers most change what
gets built. Usually: the core purpose / the one job it must nail, the primary audience,
and the single core experience or "wow" moment. No yes/no questions, no filler. Ask them
as a short batch, not one at a time.

### 3 — Round 2 (≈2–3 questions + the bar)
Read the answers and ask **~2–3 follow-ups that close the specific gaps those answers
opened** — not generic questions, the ones you now realize you need. In the same turn:
- **Propose the named quality bar** for confirmation ("I'd hold this to `linear.app`'s
  polish + `igloo.inc`'s interactivity — right target?"). Offer 2–3 candidates if the
  user has no opinion; each must be Named + Fetchable + Comparable.
- **Surface the recommended design skill(s)** from the router for a quick confirm.

Two rounds is the ceiling. Stop once the picture is sharp enough to write an excellent
spec — for a small idea, one round may be enough.

### 4 — Synthesize the spec
Build the internal spec (you don't have to show all of it — a compact summary is fine
for a sanity check):

- `one_liner` — what it is, in one sentence
- `purpose` — the job it does and for whom
- `design_direction` — the aesthetic/experience target in one sentence
- `quality_bar` — the named reference(s) to beat
- `recommended_skills` — `[{skill, why}]` from the router
- `core_features[]` — what it fundamentally is (without these it isn't the thing)
- `supporting_features[]` — enhancements, polish, quality-of-life
- `stack[]` — suggested tech (only if it genuinely matters)
- `open_questions[]` — real ambiguities the builder must resolve first

### 5 — Assemble the build prompt
Render the final prompt using the template in
`references/build-prompt-template.md`. It is ecosystem-aware by default (names the
user's skills). If the user asks for a **portable / shareable** prompt, render the
stripped variant (technique descriptions instead of skill names; a generic quality
gate instead of a `gauntlet-loop` reference).

### 6 — Gauntlet handoff ("both, in sequence")
The gauntlet runs twice — once on the prompt, once on the build:
- **Prompt pass (now):** offer to invoke `[[gauntlet-loop-skill]]` on the *prompt text*
  against a prompt-quality bar (e.g. "a brief a senior prompt engineer would be proud
  to hand an agent") to sharpen it before it ships.
- **Build pass (later):** the final prompt already ends with a **Quality gate** section
  telling the build agent to run `gauntlet-loop` against `quality_bar` until it wins.
  So the handoff is baked in — the user just runs the prompt.

Present the final prompt clearly, note that the build-time gauntlet is embedded, and
ask whether to run the prompt-pass gauntlet now.

## The skill router (idea vibe → the user's design skills)

| Signal in the idea | Recommend |
| --- | --- |
| premium / cinematic / immersive / 3D / "wow" / interactive / playful / game-like / experimental / high-end | `interactive-web-studio` |
| product / device / vehicle / gadget teardown, "exploded view", inspect parts, labeled callouts, spec sheet | `exploded-showcase` (with `interactive-web-studio`) |
| image reveal / hover-to-reveal / scanning / before-after / "hidden version" of an image | `webgl-trail-reveal` (with `interactive-web-studio`) |
| editor / timeline / media-tool / dashboard UI needing an exact, consistent token system | `capcut-design` |
| redesign / restyle an existing URL while keeping what it does | `website-redesigner` |
| *always, as the final quality gate* | `gauntlet-loop` |

If nothing matches strongly, default a website to `interactive-web-studio` for anything
that should feel polished, and leave a plain webapp skill-free (just a strong quality
bar). Never wire in a skill that doesn't fit just to name one.

## The build-prompt shape (summary)

The full template lives in `references/build-prompt-template.md`. Sections, in order:
`# title` · Objective · **Design direction & quality bar** · **Recommended approach**
(stripped when portable) · Context · Main features (numbered, each with a `Done when`
line) · Supporting features · Tech & constraints · Open questions to resolve first ·
How to work · **Quality gate** (run `gauntlet-loop` against the bar until it wins).

## Failure modes (what quietly ruins the prompt)

- **No real bar** → the build and the later gauntlet have nothing to fetch, quality
  drifts. Fix: land a Named + Fetchable + Comparable bar in Round 2, always.
- **Interrogating instead of interviewing** → 10 generic questions exhaust the user.
  Fix: ≤2 rounds of only the highest-leverage, gap-closing questions.
- **Inventing features** → padding the spec with things the user never implied. Fix:
  synthesize only what the idea and answers support; put genuine unknowns in Open
  questions, don't guess them into features.
- **Generic prompt** → ignoring the user's design skills yields a bland result. Fix:
  route the vibe to a real skill and name it in the prompt (unless portable).
- **Trying to build it here** → this skill outputs a prompt, not an app. Fix: hand the
  prompt to the builder; that's the whole point.

## Related

- `[[gauntlet-loop-skill]]` — the back half of the pipeline; sharpens the prompt, then
  governs the build against the named bar.
- Design skills this routes to: `interactive-web-studio`, `exploded-showcase`,
  `webgl-trail-reveal`, `capcut-design`, `website-redesigner`.
- `[[blueprint-app]]` and its portfolio twin — the web surfaces that implement this same
  methodology for when the user isn't in Claude Code.
