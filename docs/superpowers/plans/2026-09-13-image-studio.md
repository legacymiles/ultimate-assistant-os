# Image Studio Implementation Plan

> **For agentic workers:** executed inline in the session that wrote it (user said "create it"). Steps use checkbox syntax for tracking.

**Goal:** Ship `/apps/image-studio` — pick an image agent, prompt + tagged reference photos, AI rewrite, 1–4 generated variations, browser gallery with refine.

**Architecture:** A pure core (`agents.ts`, `prompt.ts`) holds every agent brief, prompt assembly and response parsing, unit-tested with vitest. Two thin Node routes call OpenRouter through `src/lib/ai/provider.ts`. The client stores result blobs in IndexedDB and gallery metadata in localStorage.

**Tech Stack:** Next.js App Router, React client components, Tailwind hub tokens (`ink`, `line`, `panel`, `brand`), vitest.

Spec: `docs/superpowers/specs/2026-09-13-image-studio-design.md`

## Deviations from the spec (decided while planning)

1. **One image per generate request.** Gemini returns ~1–2 MB base64 PNGs; four in one response would exceed Vercel's 4.5 MB response limit. The client fires `count` parallel requests instead, which also makes per-slot Retry natural. Route body: `{ agentId, prompt, refs }` → `{ image?, refusal?, offline? }`.
2. **Agent id is `string`, not a union** — the user will add more agents, so adding one must be one registry entry and nothing else.
3. **Gallery keeps ref roles, not ref blobs** (`refRoles: RefRole[]`). Refine only needs the result image.

## Task 1: Agent registry + prompt core (TDD)

**Files:** Create `src/lib/image-studio/agents.ts`, `src/lib/image-studio/prompt.ts`, `src/lib/image-studio/image-studio.test.ts`

- [ ] Write tests: `refGuide` numbering/roles, `fallbackPrompt` includes style block, `generationText` includes aspect + guide, `userContent` orders text then images, `extractResult` finds `message.images[].image_url.url` and returns text as refusal when no image, `agentById` unknown → undefined, every agent has non-empty brief/styleBlock/examples and unique id, `placeholderImage` returns an SVG data URL.
- [ ] Run `npx vitest run src/lib/image-studio` → FAIL (modules missing)
- [ ] Implement `agents.ts` (5 agents) and `prompt.ts`
- [ ] Run tests → PASS

## Task 2: Server routes

**Files:** Create `src/lib/image-studio/server.ts`, `src/app/api/image-studio/rewrite/route.ts`, `src/app/api/image-studio/generate/route.ts`

- [ ] `server.ts`: `parseBody` (validate agent, prompt ≤ 4000 chars, ≤ 6 refs, each `data:image/` URL), `chat(model, messages, extra)` via `aiUrl()/aiKey()`
- [ ] rewrite route: offline → `fallbackPrompt` + `offline: true`; LLM error → fallback + `warning`
- [ ] generate route: offline → `placeholderImage`; else one call with `modalities: ["image","text"]` and `image_config.aspect_ratio`; no image → `{ refusal }`; `maxDuration = 120`

## Task 3: Client storage + API

**Files:** Create `src/lib/image-studio/media.ts`, `src/lib/image-studio/gallery.ts`, `src/components/image-studio/api.ts`

- [ ] `media.ts`: IndexedDB `image-studio-media` put/get/delete, cached object URLs, `downscaleToDataUrl(file, 1024)`, `blobToDataUrl`, `dataUrlToBlob`
- [ ] `gallery.ts`: `loadGallery/saveGallery` under `image-studio:gallery`, try/catch everywhere
- [ ] `api.ts`: `rewrite()` and `generateOne()` fetch wrappers throwing readable errors

## Task 4: UI

**Files:** Create `src/app/apps/image-studio/page.tsx`, `src/components/image-studio/{ImageStudio,AgentPicker,Composer,RefTray,Gallery,Lightbox}.tsx`

- [ ] Agent picker cards (emoji, name, pitch, hue gradient)
- [ ] Composer: example chips, prompt, RefTray (upload/drop, Person/Style toggle, remove), consent line, Rewrite → editable expanded prompt, count 1–4, Generate
- [ ] Gallery: agent filter chips, pending/failed slots with Retry, refusal card with "Soften prompt"
- [ ] Lightbox: full image, prompt used, Download, Refine (adds result as Person ref + selects agent), Delete

## Task 5: Catalog + verification

**Files:** Modify `src/lib/catalog.ts` (replace the coming-soon `image-lab` tile with live `image-studio`)

- [ ] `npx vitest run src/lib/image-studio` → PASS
- [ ] `npx tsc --noEmit` → no new errors in image-studio files
- [ ] Browser: open `/apps/image-studio` (own `NEXT_DIST_DIR` if another dev server runs), pick each agent, upload a photo, Rewrite, Generate, Refine, reload → gallery persists; check console clean
- [ ] Commit only image-studio files + catalog hunk
