# Anthropic prompting checklist (condensed)

Condensed from Anthropic's *Claude prompting best practices*
(platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices),
paraphrased. Re-read the source when a new model ships — techniques tied to a model were measured
on that model.

## Clarity
- The golden rule: if a colleague with minimal context would be confused by the prompt, so will
  the model. Treat it as a brilliant new employee who doesn't know your norms.
- Use numbered steps when order or completeness matters.
- Ask for "above and beyond" behaviour directly; it is not inferred. Quality modifiers work:
  "include as many relevant features and interactions as possible; go beyond the basics".

## Context and motivation
- Explain why an instruction exists. A reason generalises; a bare rule doesn't.

## Examples
- 3–5 is the sweet spot when examples are the main lever; make them relevant, varied (cover edge
  cases) and wrapped in `<example>` / `<examples>` tags.

## Structure
- XML tags separate instructions, context, examples and inputs; keep names consistent and nest
  for hierarchy (`<documents><document index="1">…`).
- Long documents (20k+ tokens) go at the top, the question at the end. For document tasks, ask
  for relevant quotes first, then the answer.
- A one-sentence role in the system prompt focuses tone and expertise.

## Output and format
- Say what to do, not what to avoid ("flowing prose paragraphs", not "no markdown").
- The prompt's own style leaks into the output: less markdown in, less markdown out.
- For plain-text maths, say so explicitly; recent models default to LaTeX.
- Ask for design quality explicitly for documents, slides and UI.
- Prefilling the final assistant turn is not supported on recent models; put format rules in the
  prompt or use structured outputs instead.

## Agents and tools
- Be explicit about acting vs suggesting: "Change this function…", not "Can you suggest…".
- `<default_to_action>` (implement by default, discover missing details with tools) or
  `<do_not_act_before_instructions>` (research and recommend until told) — pick one.
- Drop aggressive language ("CRITICAL: you MUST…"); recent models over-trigger on it.
- Independent tool calls in parallel; sequential only when one needs the other's output; never
  guess parameters.
- Reversibility: act freely on local, reversible steps; ask before destructive, shared or
  externally visible ones (force-push, deleting, posting). No `--no-verify`-style shortcuts.
- Investigate before answering: never speculate about code you haven't opened.
- Ask for general solutions, not ones shaped to pass the tests; report a wrong test instead of
  working around it.
- Keep scope tight: only changes that are requested or clearly necessary, no unrequested
  refactors or abstractions. Clean up temporary files.
- Long tasks: keep state in files (tests.json, progress notes), use git as checkpoints, and don't
  stop early because of context limits when the harness compacts.
- Subagents for parallel, isolated work — not for a single grep.

## Thinking
- Prefer adaptive thinking with an `effort` level over fixed thinking budgets.
- General guidance ("think it through carefully") beats a prescribed step list.
- "Choose an approach and commit to it" curbs over-deliberation.
- After tool results: reflect on their quality before the next step.

## Frontend
- Without guidance models drift to generic "AI slop". Ask for distinctive typography, a cohesive
  colour theme as CSS variables, purposeful motion (one orchestrated load, CSS micro-interactions),
  layered backgrounds, and varied aesthetics. Avoid the clichéd purple-gradient-on-white look.

## Other models (when the prompt isn't for Claude)
- **Image / video models**: subject, action, setting, style, lens/camera move, lighting, mood,
  aspect ratio, duration — concrete nouns, no instructions about "the assistant".
- **DeepSeek / other LLMs**: the same structure works; keep XML tags or swap for markdown headers
  if the model prefers them; be more explicit about output format.
- **Codex / coding agents**: same agent rules as above; name the repo, files, commands to verify
  and the definition of done.

## Techniques from elsewhere worth keeping
- **Persona with real expertise** ("a senior site reliability engineer writing to customers and
  engineers") — one line, naming the expertise that matters.
- **Playoff** — two competing drafts, critique, merge the best (high-stakes prompts).
- **Prompt-only output** (Fabric) — when the result goes straight into another model.
