# Studio skills — the contract

Every card in Jarvis → Studio is backed by one skill file here: `<workflow-id>.md`, where the id
is the workflow's id in `src/lib/studio/workflows.ts` (it is also the @-mention name). When the
owner picks a workflow (a Studio card, or `@id` in Chat), the chat route loads this file into
Jarvis's context and Jarvis *runs* it: forms, options, the final prompt, then generation.

The gold standard is `micro-expressions.md` — the owner's own skill. Every other skill must be
written to that level: a named expert role with a real craft philosophy, a guided multi-round
interaction through forms, concrete option formats, a strict final template, a reference library
of craft knowledge, and hard constraints.

## The tools a skill may call (these are the ONLY tools)

| Tool | When | What it does |
|---|---|---|
| `studio_form` | Round 1 (brief) and Round 2 (pick a direction), and any time a choice is needed | Renders an interactive form in the chat. Field types: `text`, `textarea`, `choice` (single select), `multi` (checkboxes), `image` (the owner uploads reference photos). Each field: `id`, `label`, `type`, optional `options`, `required`, `placeholder`, `default`. The conversation pauses until the owner submits. |
| `studio_generate` | Final round, after the owner has the final prompt (and has uploaded references when the skill needs them) | Renders. Shown to the owner as a confirm card; nothing runs until they say yes. Args: `medium` (`video`/`image`) and `jobs[]`, each `{ title, prompt, duration_sec?, aspect_ratio?, use_references, references? }`. One job = one clip or one image. `references` lists which uploads that job gets as Subject numbers (1 = first uploaded, counting every image the owner attached in the conversation); when it is omitted, the job gets exactly the Subjects its prompt names ("Subject 3"), or the first four uploads if it names none. Subject numbers never change: "Subject 3" is always the third picture attached in the conversation. |

Never ask for information in plain text when a form can ask it. Never call `studio_generate` before
the owner has seen and approved the final prompt.

## Real limits of the renderers (write the skill to fit them)

- **Video**: one job = one clip of **4–15 seconds**, aspect `16:9`, `9:16` or `1:1`, 768P. The
  model is MiniMax H3 (on the owner's RunPod). It accepts reference images of subjects/products
  ("Subject 1", "Subject 2" … in the order uploaded). It does NOT generate music tracks, readable
  on-screen text reliably, or clips longer than 15 s. Anything longer than 15 s is planned as a
  sequence of clips (several jobs), each ≤15 s, with continuity rules so they cut together; the
  owner assembles them in an editor.
- **Image**: one job = one image (Gemini image model). Aspect ratios: `1:1`, `4:5`, `3:4`, `2:3`,
  `9:16`, `16:9`, `3:2`, `4:3`, `21:9`. Reference photos are attached in upload order. It renders
  short text (a title, a masthead) reasonably but not paragraphs. A set of N images = N jobs.
- Text-to-video models read **visible, physical description**: subject, action, camera, light,
  lens, texture. They ignore psychology, intent and abstract adjectives. Every skill must convert
  feelings into visible behaviour, as the gold standard does.

## Required structure of a skill file

```
# <Workflow name>

<One paragraph: the expert role Jarvis plays, the craft philosophy in one line (like
"restraint equals tension"), and what the skill delivers.>

## Tool usage
<Table: which tool, when.>

## Round 1 — <name> (form)
Goal / entry condition / the `studio_form` fields (id, label, type, options, required) /
"wait for the owner to submit — do not advance".

## Round 2 — <name> (form)
How to infer from Round 1 (a formula like "motivation + eyes + breath + face + body + voice +
ending"), then 3–6 concrete, genuinely different options offered as a `choice` or `multi` field.
Include a fully written example of the option list for a sample input.

## Round 3 — <final output>
The generation rules, then the STRICT output template (timeline slices, shot table, panel list…)
with a fully written sample. The first line/shot must carry the subject's appearance prefix.
Then the fixed closing line (e.g. asking for reference uploads) and what `studio_generate` jobs to
prepare.

## Generation rules
Medium, default duration/aspect/resolution, how many jobs, how references map, what to do when
several reference images are uploaded (one job each, in parallel).

## <Craft reference library>
The genre's knowledge base: shot grammar, lighting setups, beat structures, pacing tables,
emotion/tone → visible-cue mappings, palettes, typography rules — whatever a top practitioner
of THIS workflow knows that a generalist doesn't.

## Global constraints
Hard rules, as bullets.
```

Keep the skill self-contained and specific to its workflow. Keywords the owner chose (e.g.
"luxury", "funny") arrive in their message; the skill says how each keyword changes the output.
When the workflow has variants (a dropdown), the skill has a section per variant.

## Mixing

The owner can mix skills (`@kids-story @product-ad`). Jarvis then runs ONE interaction: the first
skill leads the rounds, the others add their fields and rules, and no question is asked twice.
Skills should therefore phrase their fields and rules so they compose.
