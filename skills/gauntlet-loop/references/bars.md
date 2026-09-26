# Bar catalog — strong, named, fetchable references by domain

Use this when you need to propose 2-3 candidate bars and want concrete, real starting
points instead of hallucinating a vague standard. Every entry here is **Named** (a specific
instance), **Fetchable** (can be pulled up right now), and **Comparable** (a clear category).

Pick bars that match the *goal's ambition and category*, and offer variety in style so the
user's pick tells you what they actually want. The bar sets the level of craft for the
genre, not a look to copy: critics judge the work at that level, never its resemblance. Prefer a bar the Critic can genuinely obtain
today; if unsure a URL still resolves, say so and offer an alternative. This list is a
prompt for your judgment, not a fixed menu — a bar the user already admires beats anything
here.

**Capturing a bar (round 0).** The orchestrator shoots or reads the bar ONCE into
`<run>/bar`; critics read that evidence and never reshoot it. Errors in the bar's report never
count against the build. Default camera flags work for ordinary pages; heavy sites list
their own flags below (append them to the round-0 command in `templates.md` §1). Non-URL bars
(games, writing, CLIs, skills) are captured as §1 describes for each medium.

## Websites / landing pages
- `stripe.com`, `stripe.com/pricing` — polished, dense, developer-credible.
- `planetscale.com` — technical depth, confident dark UI.
- `linear.app` — minimal, fast, opinionated motion.
- `vercel.com` — high-contrast, product-forward.
- `dub.co` — clean open-source SaaS, punchy and quick.
- `railway.app` — bold, playful, motion-heavy.
- `retool.com` — B2B, information-dense but organized.

## Immersive / WebGL / 3D sites
- `igloo.inc` — Awwwards SOTY 2024 (Abeto × Bureaux). Real-time 3D world, virtual scroll
  journey, procedural ice, WebGL UI with SDF text scramble, particle morphs, sound. Loads
  slowly: capture with `--wait 20000 --settle 2500 --wheel 3000 --frames 4` (the camera
  detects its wheel-driven virtual scroll; its canvas sits in a shadow root and is still found).
  Each load adds ~20 s, so three viewports take 3+ minutes: Bash `timeout: 600000`.
- `lusion.co` — studio showreel site, physics toys, heavy post-processing. Use `--wait 12000 --frames 4`.
- `activetheory.net` — immersive agency site, world navigation.
- `bruno-simon.com` — playable 3D portfolio (car driving).
- `messenger.abeto.co` — Abeto's own playable world.

## Essays / long-form writing
- Paul Graham — "Do Things That Don't Scale", "How to Do Great Work" (paulgraham.com).
- Patrick Collison — patrickcollison.com/questions (clarity, brevity).
- Stripe Press pieces / stratechery.com (Ben Thompson) — argued, structured.
- The Pudding (pudding.cool) — narrative + data storytelling.
- A specific New Yorker or Paris Review piece the user names.

## CLI tools / developer UX
- `ripgrep` (rg) — speed + helpful output.
- `fzf` — interactive, ergonomic.
- `gh` (GitHub CLI) — subcommand structure, help text, defaults.
- `bat` — a "cat" with sensible modern polish.
- `httpie` — human-friendly output and flags.

## API / library design
- Stripe API (stripe.com/docs/api) — the reference standard for REST DX.
- Requests (Python) — "HTTP for humans" ergonomics.
- The `fetch` / `zod` / `tanstack-query` docs — TS DX and typing.

## Documentation
- Stripe Docs, Tailwind CSS docs, Twilio Docs — task-oriented, runnable examples.
- Supabase docs — quickstart-first structure.
- Diátaxis framework as a structural bar (tutorial / how-to / reference / explanation).

## Slide decks / pitches
- Sequoia's pitch deck template, Airbnb's original seed deck, YC's "How to design a
  better pitch deck" — concrete, widely available references.

## Data viz / dashboards
- FiveThirtyEight charts, The Pudding, Our World in Data (ourworldindata.org),
  Observable notebooks — clarity, labeling, honest scales.

## Mobile / product UI
- Things 3, Linear mobile, Cash App, Duolingo — a specific screen the user names,
  screenshottable from the app or its marketing site.

## Games / interactive toys
- A specific itch.io or Bruno Simon (bruno-simon.com) piece; a named Awwwards
  Site of the Day. Fetchable and directly playable/inspectable.

---

### If nothing here fits
Ask the user: "Is there a specific product, page, article, or tool you already think is
excellent at this?" Their answer is the best possible bar — it's named, they can fetch it,
and it encodes their actual taste. Convert that into the `Quality bar:` line and proceed.
