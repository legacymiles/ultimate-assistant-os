# Build-prompt template (canonical)

This is the exact shape of the prompt Prompt Architect produces, and the canonical
structure the Blueprint app and its portfolio twin implement. Keep the three surfaces
in sync with this file.

Fill every `{placeholder}` from the synthesized spec. Omit a section only when its
source data is genuinely empty (e.g. no open questions).

---

```
# {one_liner}

## Objective
{purpose}

## Design direction & quality bar
{design_direction}

Hold this to **{quality_bar}**. Fetch that reference and treat it as the standard to
BEAT — beat it specifically on: {axes_to_win_on}.

## Recommended approach
{for each recommended_skill:}
- Use the `{skill}` skill for {why}.
{end}

## Context
- **Type:** {Website | Web app | Workflow}
- **Audience:** {audience}
{for each interview answer:}
- **{question}:** {answer}
{end}

## Main features (must-have — these define the product)
{numbered, for each core_feature:}
1. **{title}**
   {description}
   - _Done when:_ {a concrete, user-observable acceptance line}
{end}

## Supporting features (secondary — build after the main features)
{for each supporting_feature:}
- **{title}** — {description}
{end}

## Tech & constraints
{for each stack item, else a "choose a modern stack" line}
- {stack item}
- Responsive and accessible (keyboard navigation, sensible contrast, honours reduced motion).

## Open questions to resolve first
{for each open_question:}
- {question}
{end}

## How to work
- Restate your understanding in one or two lines, and ask about anything ambiguous **before** writing code.
- Build the main features first and get them working end-to-end; treat supporting features as follow-ups.
- Keep components small and composable; verify the app actually runs before claiming it's done.

## Quality gate
After a working build, run the `gauntlet-loop` skill against **{quality_bar}**: a
Builder makes the work, a fresh blind Critic compares it against the bar, and you
iterate until the Critic — blind — picks your work over the bar. Stop on winning that
comparison, not on a fixed round count.
```

---

## Portable variant

When the user asks for a shareable / portable prompt, two sections change so the prompt
carries no dependency on the user's private setup:

- **Recommended approach** → describe the *technique*, not the skill name.
  Instead of "Use the `interactive-web-studio` skill for the hero", write:
  "Build the hero as an immersive, cinematic WebGL scene with smooth scroll, a magnetic
  cursor, and a scroll-driven reveal."
  Technique translations:
  - `interactive-web-studio` → premium cinematic interactivity: WebGL/Three.js scenes,
    custom shaders, smooth scroll, magnetic cursor, scroll-driven storytelling, an
    original interactive "toy".
  - `exploded-showcase` → a 3D product teardown hero: one object on a slow orbit that
    explodes into individually labeled, inspectable parts with leader-line callouts.
  - `webgl-trail-reveal` → a mouse-trail image reveal: two aligned images where moving
    the cursor paints a persistent trail revealing the hidden layer, with subtle
    distortion at the boundary.
  - `capcut-design` → a strict, consistent design-token system (exact color, type, and
    spacing scale) for a clean, modern editor/tool UI.

- **Quality gate** → drop the `gauntlet-loop` name; keep the mechanic:
  "After a working build, iterate against **{quality_bar}**: compare your work against
  that reference with fresh eyes and keep refining until it clearly beats it."

## Notes for implementers

- `axes_to_win_on` is 2–4 concrete dimensions drawn from `design_direction` and the
  core experience (e.g. "motion polish, first-paint speed, and the hero moment"). If
  unknown, use "polish, clarity, and the core experience."
- The `Done when` line must be user-observable ("a visitor can filter the gallery and
  the URL updates"), never "the code compiles".
- Never invent features to fill a section. An empty Supporting-features or
  Open-questions section is simply omitted.
