# Image Studio — Design

Date: 2026-09-13
Status: approved in brainstorming, pending spec review

## Purpose

A hub app at `/apps/image-studio` where a user picks a specialist **image agent**,
writes a prompt, attaches reference photos, and gets styled images back. Each
agent is an expert in one look (nostalgia, glamour, family portrait, cartoon→real,
GTA-style chaos).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Reference photo role | Both — the user tags each upload **Person** (preserve identity) or **Style** (borrow the vibe) |
| Agent intelligence | Expert prompt rewrite: an LLM expands prompt + refs + agent brief into a detailed prompt the user can edit before generating |
| Persistence | Browser-local gallery (IndexedDB blobs + localStorage metadata), no Supabase |
| Image backend | OpenRouter, `google/gemini-3.1-flash-image` for every agent at launch; model is a per-agent field so any agent can be swapped later |

## File layout

- `src/lib/catalog.ts` — add the `image-studio` entry
- `src/app/apps/image-studio/page.tsx` — route
- `src/components/image-studio/` — UI (agent picker, composer, reference tray, gallery, lightbox)
- `src/lib/image-studio/agents.ts` — agent registry
- `src/lib/image-studio/media.ts` — IndexedDB blob store (same pattern as `src/lib/auteur/media.ts`, own DB name `image-studio-media`)
- `src/lib/image-studio/gallery.ts` — localStorage metadata
- `src/lib/image-studio/prompt.ts` — pure prompt-building + response parsing (unit-tested)
- `src/app/api/image-studio/rewrite/route.ts`
- `src/app/api/image-studio/generate/route.ts`

## Agent registry

```ts
interface ImageAgent {
  id: "nostalgia" | "glamour" | "family-portrait" | "cartoon-real" | "gta-life";
  name: string;
  icon: string;           // emoji
  pitch: string;          // one line on the card
  examples: string[];     // clickable example prompts
  brief: string;          // style expertise given to the rewrite LLM
  model: string;          // image model id, default "google/gemini-3.1-flash-image"
  aspect: "portrait" | "square" | "landscape";
}
```

Adding an agent = adding one entry. Launch set:

| Agent | Brief focus |
|---|---|
| Nostalgia | Choose an era (70s Kodachrome, 90s disposable, VHS still); grain, faded color, period wardrobe and props |
| Glamour | Boudoir / editorial fashion lighting, styling and poses. Suggestive, never explicit: no nudity, adults only |
| Family Portrait | Studio or golden-hour outdoor setup, coordinated outfits, arranges every Person ref, preserves each face |
| Cartoon → Real | Reinterpret a cartoon/anime character as a believable human: skin texture, real fabric, photographic lighting |
| GTA Life | Over-the-top scenarios (bear wrestling, yacht chaos, on stage with a *lookalike* superstar — never a named real celebrity), cinematic poster framing |

## User flow

1. Pick an agent card.
2. Enter a prompt; add reference photos, tagging each **Person** or **Style**.
3. **Rewrite** → the expanded prompt appears in an editable textarea.
4. **Generate** with a variation count of 1–4 → results land in the gallery.
5. Gallery (filterable by agent): download, delete, view prompt, **Refine** (adds the result as a Person ref and returns to the composer with the same agent).

The user may skip Rewrite and generate from their raw prompt; the agent brief is
still applied by `prompt.ts` as a fallback style block.

## Server

Both routes resolve endpoint and key via `src/lib/ai/provider.ts`.

**`POST /api/image-studio/rewrite`**
Body: `{ agentId, prompt, refs: [{ role: "person" | "style", dataUrl }] }`
Calls chat completions with `anthropic/claude-sonnet-5`, the agent brief as the system
message, and the refs as image parts. Returns `{ prompt }`. With no key, returns the
prompt merged with the agent's fallback style block and `offline: true`.

**`POST /api/image-studio/generate`**
Body: `{ agentId, prompt, refs, count }`
For each variation (run in parallel), calls chat completions on the agent's model with
`modalities: ["image", "text"]`, the prompt, and refs labelled in text ("Image 1 is a
PERSON — keep their face; Image 2 is STYLE only"). Parses images from
`choices[0].message.images[].image_url.url`. Returns
`{ images: dataUrl[], failures: { index, reason }[], refusal?: string, offline?: boolean }`.
`maxDuration = 120`. With no key, returns SVG placeholders and `offline: true`.

The client downscales refs to ≤1024px JPEG before sending.

## Storage

- Blobs: IndexedDB `image-studio-media`, store `blobs`, keyed by media id (results and refs).
- Metadata: localStorage `image-studio:gallery` —
  `{ id, agentId, prompt, rawPrompt, refIds, mediaId, model, createdAt }[]`.
  Every read and write is wrapped in try/catch; the app still works with storage unavailable (results just don't persist).

## Error handling

| Case | Behaviour |
|---|---|
| No API key | Placeholder images + "offline mode — add OPENROUTER_API_KEY" banner |
| Model returns text but no image | Treated as a refusal: show the text and a **Soften prompt** button that re-runs Rewrite with a "keep it tasteful" instruction |
| Some variations fail | Show the successes; failed slots get a Retry button |
| Timeout / network error | Inline error on the composer; inputs preserved |

## Safety

- Composer notice: "Only upload photos of yourself or people who agreed to this."
- Glamour brief hard rules: adults only, no nudity or sexual acts.
- GTA brief: lookalike public figures only, never named real celebrities.
- Provider-side refusals surface honestly (no retry loops that try to evade them).

## Testing

- Unit tests (`prompt.ts`): ref labelling, fallback style block, image extraction from the response shape, refusal detection.
- Route test for the offline placeholder path.
- Manual browser check: one real generation per agent with a reference photo, and one refine round.

## Out of scope

Supabase sync, a chat back-and-forth with the agent, user-created custom agents, and a per-agent model picker in the UI (the model is code-level config).
