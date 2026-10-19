---
name: prompt-enhancer
description: Turns a rough request into the strongest prompt for the model that will run it — Felix's end-goal pass built in, then Anthropic's Claude prompting best practices. Use when the user types /prompt-enhancer or /enhance, says "enhance this", "make this prompt better", "improve my prompt", "rewrite this for Claude/Codex/DeepSeek", or when a request is clearly too vague to get a great result (one line asking to build, design or fix something substantial). Also what Jarvis's ✦ Enhance button runs. Nicknames: enhance, enhancer, the prompt enhancer, prompt booster, better prompt, improve my prompt.
license: MIT
metadata:
  author: legacymiles
  category: Prompt Engineering
  nicknames: enhance, enhancer, the prompt enhancer, prompt booster, better prompt, improve my prompt
  built-in: felix
  sources: Anthropic Claude prompting best practices; Fabric improve_prompt; NetworkChuck (You SUCK at Prompting AI)
---

# Prompt enhancer (Felix built in)

"OK" prompts get "OK" results. The model can only aim at what the prompt describes, so this
skill makes the description good: the real goal, the context a smart newcomer would need, what
"great" looks like, how it will be checked, and the shape of the answer.

**Felix is built in.** Step 1 below is Felix's core, so this skill never runs without it. For a
big build where the user wants the whole ambitious plan (the three-rung ladder, the crew), load
the full **felix** skill as well; for everything else Step 1 is enough.

**Why this design.** Anthropic's guide is the backbone: current, written for Claude, measured on
the models in use. Fabric's `improve_prompt` is a reworked 2023 OpenAI guide aimed at GPT-4; its
one idea kept here is **prompt-only** output, so a result can be piped straight into another
model. NetworkChuck's **playoff** (competing drafts → critique → merge) is kept for high-stakes
prompts.

## Step 0 — What were you handed?

- **A prompt to improve** (for this model, another agent, Codex, DeepSeek, an image/video model,
  a Jarvis plugin): improve it and stop.
- **A task to do, phrased vaguely**: improve it, show it in one block, then do the task with it —
  unless the user only asked for the prompt.
- Note **which model will run it** (default: Claude). Image and video models want a different
  shape (subject, style, camera, light) — see `references/anthropic-checklist.md` § Other models.

## Step 1 — The Felix pass: what is this for?

Answer these from the request, the repo and memory; ask only what's missing **and** would change
the prompt (Step 2). Skip this step for a quick factual question or a short message.

1. **End goal** — what should be true for people once this is done? One line, from their side.
2. **The goal beyond the goal** — the next rung up. Not "fix this crash" but "it stays
   crash-free"; not "a site" but "the site keeps bringing in business on its own".
3. **Who it's for** — sets the bar for polish, onboarding and support.
4. **The user's features, the user's way** — everything they asked for stays in, in their terms.
   Raise the quality *around* it; never swap the request for a different one.
5. **Better, not bigger** — a suggestion that makes the job larger without making it better is
   dropped.
6. **The outside judge** — what, other than the model or the user, shows it worked: a test, a
   measurement, a person completing the task, a logged-error count. 2–5 checkable lines.
7. **The pro standard** — for anything with users or a backend, the rules of the owner's one
   build checklist that apply (the `website-build-checklist` skill, kept by Jarvis Profile),
   cited by code: every **Must** (never a white page, every crash logged, plain-English errors,
   works on a phone, no duplicates, secure), plus the **should**s that fit.
8. **One hard target, treated as reachable** — "loads in under 1 s", not "faster".

## Step 2 — Fill the gaps, asking only what matters

List what a capable colleague with no context would need and doesn't have. For each gap:

- If the repo, memory or conversation answers it, use that.
- If a wrong guess would waste real work and the user is present, ask — at most three
  questions, in one round, with options and a recommended choice first (Jarvis's Goal check
  panel does this with chips; in Claude Code use AskUserQuestion).
- Otherwise assume, and list the assumption in the output so it can be corrected.

## Step 3 — Write the prompt

Apply Anthropic's practices (full checklist in `references/anthropic-checklist.md`):

1. **Lead with the goal and the why** (from Step 1). Claude generalises from reasons better than
   from bare rules.
2. **Give context like a new hire would need it**: who it's for, where it runs, what already
   exists, the stack, what was tried. Long material at the top, the ask at the bottom.
3. **Be explicit about the bar.** "Go beyond the basics; make it a fully featured,
   production-quality implementation." For UI, ask for distinctive design, motion and
   interactivity explicitly.
4. **Say what to do, not what to avoid.** "Write in flowing prose paragraphs", not "no markdown".
5. **Separate the parts with XML tags**: `<goal>`, `<context>`, `<request>` (their words),
   `<requirements>`, `<standard>`, `<success_criteria>`, `<constraints>`, `<output_format>`,
   `<examples>`.
6. **Show, when shape matters**: 1–3 short, varied examples in `<example>` tags.
7. **Action verbs for agents**: "Change this function to…", not "Can you suggest…". Say whether to
   implement or only recommend. Add the reversibility rule: act freely on local, reversible
   steps; ask before spending money, deleting, pushing or posting.
8. **End with the judge** (Step 1.6) and ask for an honest report against it with real numbers,
   including anything that missed.
9. **Calm, not shouty.** No ALL-CAPS "CRITICAL/MUST" — current Claude models over-trigger on it.
10. **As short as it can be while complete.** No filler; a one-line role that names the real
    expertise is enough.

For a **high-stakes** prompt (a client deliverable, a system prompt others will use, a big
build), run the **playoff**: two drafts that take different approaches, critique both against
Steps 1–3, merge the strongest parts.

## Output

Default mode:

1. **Goal** — one line, and the goal beyond it.
2. **Assumptions** — only if you made any.
3. **The enhanced prompt** — one fenced block, ready to paste.
4. **What changed** — up to four short bullets, so the user learns the pattern.

**Prompt-only mode** (the user says "just the prompt", the output goes straight into another
model, or Jarvis's API asks for it): output only the enhanced prompt.

**To the board**: if the prompt describes more than one sitting of work, offer to send it to the
board — the **software-factory** skill turns it into a card with the judges as Acceptance
Criteria.

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
