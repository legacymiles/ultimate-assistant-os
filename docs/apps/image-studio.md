# Image Studio

Route: `/apps/image-studio` · Category: Image · Live

Record reviewed: 2026-11-24

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- image-studio "what to change"`.

## What it does

A studio of specialist image agents, each an expert in one look. Nostalgia turns you into a photo from any decade — 70s Polaroid, 90s disposable, VHS still. Glamour shoots sultry, magazine-grade editorial portraits. Family Portrait arranges everyone you upload into the photo you'd frame. Cartoon → Real brings any cartoon or anime character to life as a real person. GTA Life drops you into your most unhinged moments: wrestling bears, yacht chaos, headlining a stadium. Write a prompt, add reference photos and tag each one as a Person to keep or a Style to borrow; the agent rewrites your idea into a detailed prompt you can edit, then generates up to four variations. Everything lands in a gallery you can filter by agent, download, or refine into the next round.

**Inspire** (`/apps/image-studio/inspire`) lives inside Image Studio: a public AI image inspiration library and prompt-building studio. Anyone can browse; any signed-in account gets a private library. The agents above stay owner-only. The loop is: discover an image → read its prompt as Prompt DNA → keep the ingredients that make it work → build something new.

## Features

### Inspire

- **Explore — "Immersive lab"** (picked from three coded mockups, 2026-11-24). The whole first screen is a **Prompt Scan** stage (the standout, WebGL, `PromptScan.tsx` + pure `src/lib/image-studio/inspire/scan.ts`, trail engine reused from `src/lib/viral-studio/trail.ts`): a featured picture drawn entirely out of its own prompt words, each glyph lit in the colour under it; the pointer paints a trail that scans the real picture through with a thin RGB-split edge; with no pointer (phones, idle) it scans itself on a wandering path. The headline sits over it; the picture's ingredients float as chips pinned to the parts they describe (`pins` in `seed.ts`, placed through the cover crop, kept clear of the headline and info) — select some and "Build with N". Five wide featured images rotate (dots, arrows, pause while pointing). The gallery rises over the hero as a rounded sheet: search, category pills, art-style, subject and newest/oldest filters, masonry of 48 starter images drawn locally with Flux 2 Klein from the exact prompts shown, plus everything members publish. Hovering a card scans the picture away to the prompt beneath it (one WebGL context, hovered card only). Each card carries a DNA ribbon. Reduced motion shows a still pre-baked scan; no WebGL shows a CSS version. No likes, followers, comments or counts — by design.
- **Prompt DNA** — every image's original prompt shown untouched but lit up where its ingredients are, and the same ingredients as chips grouped into 10 kinds (Subject, Art Style, Lighting, Camera/Lens, Composition, Environment, Texture, Colour, Mood, Visual Effects), each glowing in its kind's hue. Hover a chip for what it contributes; click chips or lit words to select; copy, save to your chip library, or "Build with these". Copy prompt, Save prompt, Remix this prompt (opens the Builder with the ingredients loaded and the original kept as history). AI extraction (Sonnet) with a built-in offline extractor as fallback and for the starter set.
- **Image detail** — full-size view, creator, model, save into one or more collections, download, "How it was made" for generated images, and Style Discovery: related images by overall DNA or by one facet (style, lighting, composition, texture, colour, mood).
- **Reverse Prompt** — upload, drag-drop or paste up to 4 images; the vision model writes a recreation prompt describing only what is visible, plus a "what the model saw" breakdown and chips. Copy, Edit, Regenerate, Refine with instructions, Open in Prompt Builder, Save image + prompt + chips to the library, then optionally publish. Says plainly that exact recreation depends on the model. With no AI key it describes only what can be measured (shape, brightness, colour) and says so.
- **Prompt Builder** — pick a deliverable (T-shirt, Hoodie, Poster, Logo, Social, Album, Character, Product, Digital Artwork, Custom); each adds its own hidden technical layer (aspect, print-safe layout, isolation, typography rules) at generate time. Chip library of 16 drawers (~190 described chips) with universal search, custom chips, saved/favourite chips, suggestions; drag-and-drop ordering; import and combine saved prompts; style references with a purpose each (style, character, clothing, composition, colour, environment) kept in a Style Reference Library; live prompt preview with chips as glowing inline blocks (the standout), manual editing, Enhance (keeps the creative direction), Translate an idea into chips, Recommendations; generate 1–4 images free on the PC (WanGP Flux 2 Klein) or the paid image model (needed for references). Every result keeps its full prompt, chips, references, settings and history.
- **My Library** — private workspace: Images (saved from Explore, uploaded, generated), Prompts (with previous versions), Chips (favourites, custom), References; search, filters, sort, collection filter, move between collections, publish/unpublish/edit/delete own images. Saving someone else's image keeps their attribution and prompt untouched.
- **Collections** — named folders (T-shirt Ideas, Logo Inspiration…) holding images, prompts, chips and references; rename, delete (items stay in the library), move items between them.
- **Publishing** — upload with title, description, original prompt, model, art style, category, subject; chips suggested from the prompt and editable before sharing; Private or Public. A published prompt is locked exactly as shared; AI rewrites are stored separately (`enhancedPrompt`).
- **Accounts, plan, moderation** — browsing is public; saving, uploading, publishing and AI need sign-in (hub Google login). Free plan with 40 AI actions a day (owner unlimited); monetization wired but off (`plan.ts` `MONETIZATION_ENABLED = false`). Owner-only Moderation tab: every member-published image with Unpublish and Delete. Terms and Privacy linked in the footer.

### Agents

- **Specialist image agents with reference photos** — Five agents (Nostalgia, Glamour, Family Portrait, Cartoon -> Real, GTA Life) defined in one registry. Prompt + Person/Style reference photos are rewritten by Sonnet 5 with the agent's brief, then gen…
- **24/7 agents that carry on where the last machine left off** — Work that needs a MACHINE -- Flux on Pinokio, a Blender render, an Unreal build -- could only be asked for while the PC was awake. From a phone, or with Pinokio unreachable, it was a dead end.
- **Draw pictures free on the owner's own card instead of paying a model** — Every image the hub made went to a paid model. WanGP is already installed under Pinokio with Flux 2 Klein 4B on disk, so the picture is now drawn on the RTX 3050 first — no key, no account, no spend,…
- **Fix reference uploads that silently did nothing** — Photos whose MIME type the OS left blank were filtered out before decoding, and images dragged from a web page carry a URL rather than a file, so both cases added nothing and showed no message. Files…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

- Inspire Explore loads for a signed-out visitor and shows the starter set even if the database tables are missing.
- `/apps/image-studio` and `/api/image-studio/{rewrite,generate}` stay owner-only; only `/apps/image-studio/inspire` and `/api/image-studio/inspire/*` are public (`INSPIRE_PUBLIC` in `src/lib/hubAccess.ts`).
- A private image's file is never served to anyone but its owner (and the studio owner).
- A published prompt can't be edited; Remix and Enhance never overwrite the original.
- Remix and Reverse Prompt → "Open in Prompt Builder" land in the Builder with the chips loaded; the Builder draft survives a reload.
- Starter images: regenerate with `node scripts/inspire-seed.mjs` (needs WanGP running); prompts live in `src/lib/image-studio/inspire/seed.ts`.
- The Explore hero scans on a laptop (pointer) and on a phone (auto-sweep), never mounts more than one WebGL context per gallery card, and falls back to a still picture-of-words when WebGL is off or motion is reduced.

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/image-studio` — owner's sign-in
- Page `/apps/image-studio/inspire` — public
- `src/app/api/image-studio/`
- `src/components/image-studio/`
- `src/lib/image-studio/`

### Sign-in & who can use it

- Needs a signed-in user (requireUser / auth.getUser) — `src/app/api/image-studio/inspire/collections/route.ts`, `src/app/api/image-studio/inspire/images/[id]/route.ts`, `src/app/api/image-studio/inspire/images/route.ts` +3 more
- Owner-only check (requireOwner / isOwner) — `src/app/api/image-studio/inspire/admin/route.ts`, `src/lib/image-studio/inspire/server/access.ts`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/image-studio/generate` | owner's sign-in |
| GET POST | `/api/image-studio/inspire/admin` | public |
| POST | `/api/image-studio/inspire/ai` | public |
| POST PATCH DELETE | `/api/image-studio/inspire/collections` | public |
| GET | `/api/image-studio/inspire/file/[id]` | public |
| POST | `/api/image-studio/inspire/generate` | public |
| GET POST | `/api/image-studio/inspire/images` | public |
| GET PATCH DELETE | `/api/image-studio/inspire/images/[id]` | public |
| GET POST PATCH DELETE | `/api/image-studio/inspire/library` | public |
| GET | `/api/image-studio/inspire/me` | public |
| POST | `/api/image-studio/rewrite` | owner's sign-in |

### Data & database rules

- Table `inspire_collections` (public.inspire_collections) · RLS on — used in `src/lib/image-studio/inspire/server/store.ts`
  - policy public.inspire_collections · inspire_collections_own — for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `inspire_images` (public.inspire_images) · RLS on — used in `src/lib/image-studio/inspire/server/store.ts`
  - policy public.inspire_images · inspire_images_own_write — for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())
  - policy public.inspire_images · inspire_images_read — for select to anon, authenticated using (visibility = 'public' or owner_id = auth.uid())
- Table `inspire_library` (public.inspire_library) · RLS on — used in `src/lib/image-studio/inspire/server/store.ts`
  - policy public.inspire_library · inspire_library_own — for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `inspire_usage` (public.inspire_usage) · RLS on — used in `src/lib/image-studio/inspire/server/store.ts`
  - policy public.inspire_usage · inspire_usage_own_read — for select to authenticated using (user_id = auth.uid())
- Database function `inspire_add_usage` — `src/lib/image-studio/inspire/server/store.ts`
- Saved data `inspire:builder:v1` — `src/components/image-studio/inspire/store.tsx`

### Keys & outside services

- `HUB_OWNER_EMAILS` — `src/lib/image-studio/inspire/server/access.ts`
- `IMAGE_STUDIO_INSPIRE_IMAGE_MODEL` — `src/app/api/image-studio/inspire/generate/route.ts`
- `IMAGE_STUDIO_INSPIRE_MODEL` — `src/lib/image-studio/inspire/server/ai.ts`
- `IMAGE_STUDIO_REWRITE_MODEL` — `src/app/api/image-studio/rewrite/route.ts`, `src/lib/image-studio/inspire/server/ai.ts`
- `NEXT_PUBLIC_SUPABASE_URL` — `src/lib/image-studio/inspire/server/store.ts`
- `SUPABASE_SERVICE_ROLE_KEY` — `src/lib/image-studio/inspire/server/store.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/image-studio/generate/route.ts`, `src/app/api/image-studio/inspire/generate/route.ts`, `src/app/api/image-studio/inspire/me/route.ts` +3 more

### Tests

- `src/lib/image-studio/files.test.ts`
- `src/lib/image-studio/image-studio.test.ts`
- `src/lib/image-studio/inspire/inspire.test.ts`
- `src/lib/image-studio/inspire/scan.test.ts`
<!-- code:end -->
