---
name: prompt-enhancer
description: Turns a rough request into the strongest prompt for the model that will run it, using Anthropic's Claude prompting best practices, with the Felix skill as the first pass for anything being built or improved. Use when the user types /enhance or /prompt-enhancer, says "enhance this prompt", "make this prompt better", "improve my prompt", "rewrite this for Claude/Codex/DeepSeek", or when a request is clearly too vague to get a great result (one line asking to build, design or fix something substantial). Also used by Jarvis's Enhance button.
license: MIT
metadata:
  author: legacymiles
  sources:
    - https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
    - https://github.com/danielmiessler/Fabric/blob/main/data/patterns/improve_prompt/system.md
    - "NetworkChuck — You SUCK at Prompting AI (Here's the secret)"
---

# Prompt enhancer

"OK" prompts get "OK" results. The model can only aim at what the prompt describes, so this
skill makes the description good: the real goal, the context a smart newcomer would need, what
"great" looks like, how it will be checked, and the shape of the answer.

**Why this design.** Anthropic's guide is the backbone: it is current, written for Claude, and
measured on the models in use. Fabric's `improve_prompt` is a reworked 2023 OpenAI guide aimed at
GPT-4; its one idea kept here is the **prompt-only** output mode, so a result can be piped
straight into another model. NetworkChuck's **playoff** (competing drafts → critique → merge) is
kept for high-stakes prompts.

## Step 0 — What were you handed?

- **A prompt to improve** (for this model, another agent, Codex, DeepSeek, an image/video
  model, a Jarvis plugin): improve it and stop.
- **A task to do, phrased vaguely**: improve it, show it in one block, then do the task with it —
  unless the user only asked for the prompt.
- Note **which model will run it** (default: Claude). Image and video models want a different
  shape (subject, style, camera, light) — see `references/anthropic-checklist.md` § Other models.

## Step 1 — Felix first, when something is being built or improved

If the request is about building, designing, fixing or improving an app, site, plugin, workflow
or Jarvis itself, run the **felix** skill's intake and Depth pass first (or, without it, answer
these yourself): the end goal and the goal beyond it, who it's for, the must-have features as
the user described them, the outside judge, and which lines of the website backend checklist
apply. Those become the spine of the enhanced prompt. For a quick factual question or a short
message, skip this.

## Step 2 — Fill the gaps, asking only what matters

List what a capable colleague with no context would need and doesn't have. For each gap:

- If the repo, memory or conversation answers it, use that.
- If a wrong guess would waste real work and the user is present, ask — at most three
  questions, in one round, with options and a recommended choice first.
- Otherwise assume, and list the assumption in the output so it can be corrected.

## Step 3 — Write the prompt

Apply Anthropic's practices (full checklist in `references/anthropic-checklist.md`):

1. **Lead with the goal and the why.** State the outcome, then the reason behind each
   important instruction — Claude generalises from reasons better than from bare rules.
2. **Give context like a new hire would need it**: who it's for, where it runs, what already
   exists, the stack, what was tried. Long material goes at the top, the ask at the bottom.
3. **Be explicit about the bar.** If the user wants more than the minimum, say so with a quality
   modifier ("go beyond the basics; make it a fully featured, production-quality
   implementation"). Ask for design quality, motion and interactivity explicitly when it is UI.
4. **Say what to do, not what to avoid.** "Write in flowing prose paragraphs", not "no markdown".
5. **Separate the parts with XML tags**: `<goal>`, `<context>`, `<requirements>`,
   `<standard>`, `<success_criteria>`, `<constraints>`, `<output_format>`, `<examples>`.
6. **Show, when shape matters**: 1–3 short, varied examples in `<example>` tags.
7. **Action verbs for agents**: "Change this function to…", not "Can you suggest…". Say whether
   to implement or only recommend. Add the reversibility rule for anything destructive or
   public: act freely on local, reversible steps; ask before pushing, deleting or posting.
8. **End with the judge**: how the result will be checked and what counts as a pass (tests,
   measurements, a checklist, a person completing a task). Ask for an honest report against it.
9. **Calm, not shouty.** Drop ALL-CAPS "CRITICAL/MUST" — current Claude models over-trigger on
   it. Plain "Use X when…" works better.
10. **Keep it as short as it can be while complete.** No filler, no restating the obvious, no
    "you are the world's greatest" — a one-line role that names the real expertise is enough.

For a **high-stakes** prompt (a client deliverable, a system prompt others will use, a big
build), run the **playoff**: write two drafts that take different approaches, critique both
against Steps 1–3, and merge the strongest parts into the final one.

## Output

Default mode:

1. **Goal** — one line (and the goal beyond it, if Felix ran).
2. **Assumptions** — only if you made any.
3. **The enhanced prompt** — one fenced block, ready to paste.
4. **What changed** — up to four short bullets, so the user learns the pattern.

**Prompt-only mode** (when the user says "just the prompt", when the output is going straight
into another model, or when Jarvis's API asks for it): output only the enhanced prompt, nothing
before or after it.

## Example

**In:** `make me a website for my cousin's food truck`

**Out (trimmed):**

- **Goal:** hungry people nearby find the truck today and come to it. *Beyond:* regulars follow
  where it'll be next.
- **Assumptions:** one truck, moves daily, customers on phones, cousin updates it from his phone.

```text
<goal>
Build a one-page website for a food truck whose job is to get hungry people nearby to come to the
truck today. Most visitors are on a phone, outdoors, deciding in under ten seconds.
</goal>
<context>
The truck moves daily. The owner updates the site from his phone and isn't technical.
Stack: Next.js on Vercel. No existing brand assets beyond the truck's name and photos.
</context>
<requirements>
- Above the fold: today's location (map link), hours, and a "Get directions" button.
- Menu with prices and photos; sold-out items can be toggled by the owner from his phone.
- "Where we'll be this week" schedule the owner edits in under a minute.
- Go beyond the basics: make it feel like a polished local brand, with a distinctive typeface,
  warm colour theme and one tasteful load animation.
</requirements>
<standard>
Never shows a blank or broken page; every error is logged and explained in plain words; loads in
under 1 second on mid-range phones; readable at 375 px; accessible (labels, contrast AA).
</standard>
<success_criteria>
Lighthouse mobile median LCP under 1 s and accessibility ≥ 95 across three runs; the owner changes
today's location from his phone without help in a test; a forced error appears in the error log.
Report the real numbers, including any target you missed.
</success_criteria>
```

- Added the real goal (people show up today) so every feature serves it.
- Named the visitor's situation (phone, outdoors, ten seconds).
- Asked for polish explicitly, and set a measurable standard.
- Ended with checks that aren't "looks good to me".
