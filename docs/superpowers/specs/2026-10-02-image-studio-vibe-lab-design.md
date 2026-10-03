# Image Studio → three studios, one vibe registry

**Date:** 2026-10-02
**App:** `/apps/image-studio` (a Jarvis App plugin, `PLUGIN_SLUGS`)
**Design skills driving the look:** `interactive-web-studio` for the shell and pages,
`webgl-trail-reveal` for the reveal mechanic. Chosen by the owner.

## The problem

Image Studio is one screen: a picker of five hard-coded agents, a composer, a gallery. Two things
are missing.

The first is room. The app does one job — generate from an agent — and anything else it should do
has nowhere to go. Jarvis Audio Studio already solved this shape: a shell that owns only which
studio is mounted, and studios that keep every feature they had.

The second is that the taxonomy is closed. Five agents were written by hand and that is all there
will ever be, so an image whose look nobody anticipated — 90s nostalgia, spy-glasses POV, movie
trailer poster — has no name in this app and no way to get one. Worse, a model asked to name a
look will answer "cartoon" and stop, which is a label nobody can generate from.

## What gets built

Three tabs behind one switcher.

| Tab | Owns |
|---|---|
| **Generate** | Today's studio, unchanged. Agent picker now reads the vibe registry. |
| **Vibe Lab** | Upload → the AI reads the image → you argue with it → the vibe is saved. |
| **Vibe Library** | The shared taxonomy, as a dense table. Browse, filter, generate from, export. |

### Scope boundary

A real LoRA is a trained weight file and needs 16–24GB of VRAM; the owner's RTX 3050 has 6GB. So
"turn this into a LoRA" is delivered as **two** things, and the app says which is which out loud:

- **now** — the vibe becomes a live agent (brief, style block, aspect, the image as its style
  reference), generatable from the moment it is named;
- **later** — the vibe keeps a dataset counter, and the verdict states honestly how far it is from
  a trainable set, with a captioned-ZIP export once it crosses the threshold.

No training runs in this app. Nothing claims to.

## Architecture

### The shell

`src/lib/image-studio/sections.ts` defines the tabs with no `"use client"` marker, so the server
page can validate `?section=` before rendering — the same reason
`lib/jarvis-audio-studio/sections.ts` lives outside its component.

`ImageStudioShell.tsx` owns exactly one thing: which studio is mounted. Each studio is lazily
imported so the person who came to browse the library does not download the composer. The
remembered-section behaviour copies the audio studio: a URL that names a studio means it and is
remembered; a bare visit resumes where you left off; switching rewrites the query string with
`history.replaceState` rather than navigating, because each studio holds unsaved work.

Today's `ImageStudio.tsx` becomes the Generate studio and takes `embedded`, dropping its own
header when the shell draws one.

**Back link fix.** `ImageStudio.tsx` currently links to `/`, but `image-studio` is in
`PLUGIN_SLUGS`, so `hubProjects()` excludes it and the hub grid does not list it — back lands
somewhere the app cannot be found. The shell links to `/apps/jarvis#plugins`, as Jarvis Audio
Studio does.

### Data model

One migration, two tables.

```sql
-- image_vibes: one row per named look. The five built-in agents seed it.
id            text primary key          -- slug, e.g. 'ghibli-pastoral'
name          text not null             -- 'Ghibli-esque Pastoral'
family        text not null             -- coarsest rung: 'animation'
style         text not null             -- middle rung: 'cel anime'
vibe          text not null             -- deepest rung, a sentence
brief         text not null             -- rewrite-model system prompt (ImageAgent shape)
style_block   text not null             -- offline style suffix
aspect        text not null             -- 'portrait' | 'square' | 'landscape'
model         text not null
hue           int[]                     -- two hues 0-360, card gradient
icon          text
kind          text not null             -- 'builtin' | 'community'
uses          int not null default 0
dataset_count int not null default 0
cover_path    text                      -- Supabase storage path
created_by    text
created_at    timestamptz default now()

-- image_vibe_samples: the dataset behind a vibe.
id            uuid primary key
vibe_id       text references image_vibes(id) on delete cascade
storage_path  text not null
caption       text not null
created_at    timestamptz default now()
```

`dataset_count` is maintained alongside the samples rather than counted on read, so the library
table does not need a join per row.

A `builtin` row is undeletable and its brief is carried over from `agents.ts` word for word.
Nothing about how the five agents behave changes.

### One registry, not two

`agents.ts` becomes the seed of `image_vibes`. A built-in and a promoted vibe are the same shape,
so:

- the matcher has one list to check against;
- the Generate picker draws built-ins and community vibes side by side;
- "this is basically your Nostalgia agent, 94%" is the same code path as matching a user's vibe.

The alternative — agents and vibes as parallel kinds — means writing the picker, the filter, the
matcher and promotion twice.

### The read, and the argument

Every turn returns a complete verdict. The route re-sends the downscaled image, the argument so
far, the current verdict and the candidate catalog; the model returns the whole object again and
the card rewrites in place. Versions are kept, so you can step back to an earlier read.

Rejected: a patch-based turn (a malformed patch leaves a half-updated card — a failure you would
see, against a saving you would not feel), and a vision-pass-then-text-only split (it cannot look
again when you say "look at the sky", which is exactly when you argue).

Borrowed from that split: the first pass extracts an **evidence block** that rides along in every
later turn, so the model argues against its own observations instead of re-deriving them. The
image is still in every request.

### The verdict contract

```ts
interface VibeVerdict {
  ladder: { family: string; style: string; vibe: string };
  confidence: { family: number; style: number; vibe: number };   // 0-1
  rivals: { label: string; depth: "family" | "style" | "vibe"; confidence: number; why: string }[];
  evidence: {
    palette: string[];   // hex
    grain: string;
    lighting: string;
    era: string;
    framing: string;
    subject: string;
  };
  match: { vibeId: string; confidence: number; why: string } | null;
  proposal: {
    name: string; slug: string; icon: string;
    brief: string; styleBlock: string;
    aspect: Aspect; hue: [number, number];
  } | null;
  lora: { verdict: "distinctive" | "borderline" | "generic"; why: string; needed: number };
}
```

Validated by a pure function in `lib/image-studio/vibes.ts`. Two rules carry the design:

1. **A `vibeId` that was not in the catalog we sent is dropped**, and the turn becomes a proposal.
   The model cannot invent a category that does not exist, which is what keeps the shared
   taxonomy from filling with six spellings of "90s nostalgia".
2. **The `vibe` rung must be at least six words.** "Cartoon" is rejected in code, not merely
   discouraged in the prompt — one automatic retry with a stricter instruction, then show what
   came back with a visible warning. A prompt instruction alone regresses silently; a gate does
   not.

Exactly one of `match` and `proposal` is non-null. Both set → prefer `match`. Neither set → treat
as a failed turn and retry once.

### Routes

- `POST /api/image-studio/vibe` — read an image, or take one argument turn. Loads the catalog
  (`id`, `name`, `family`, `style`, `vibe`) to hand the model, calls `aiFetch`, validates, returns
  a `VibeVerdict`.
- `GET|POST /api/image-studio/vibes` — list the registry; commit a save (increment `uses` and file
  a sample on a match, insert a row on a proposal). `GET ?export=<vibeId>` returns the captioned ZIP.

Every AI call goes through `src/lib/ai/provider.ts`, as everything in this repo does.

## The tabs

### Generate

Behaviour untouched. The picker reads the registry instead of the `AGENTS` constant and gains a
family filter.

### Vibe Lab

Drop an image — reusing `files.ts` and `media.ts`, including the existing iPhone-HEIC message —
and optionally type a steer. **The prompt beside the upload is a hint, not a generate prompt**: "I
think this is 90s", "read the lighting, not the subject".

The ladder card shows three rungs with their confidences. Rivals sit underneath as chips, each
carrying its one-line rejection reason; clicking one promotes it into the argument. An evidence
drawer shows the palette swatches, grain, lighting, era and framing that drove the read. A match
row names either the library vibe it matched or the new one it is proposing. The verdict line
reads, for example: *distinctive · usable as an agent now · 11/20 toward a trainable set.*

The argument chat sits beside the card. Typing "no, more Ghibli than cartoon" rewrites the card;
version pips walk back to an earlier read.

The trail reveal paints the **evidence layer** over the photo — annotations, palette and era cues
revealed under the cursor. It is drawn to a canvas at the photo's exact pixel dimensions, so the
two layers align by construction, which this mechanic requires. A "Show me this vibe" button
spends one generation, and that image appears *beside* the card as a comparison rather than
becoming the reveal layer: a freshly generated image does not align with the photo, and a
misaligned reveal reads as a photo being swapped instead of a layer being removed.

### Vibe Library

A dense sortable table, not a card grid: vibe, family, style, uses, dataset, kind, who named it,
when. Filters for family and for LoRA-ready. A row expands to its cover, brief and sample strip;
cover thumbnails run the trail reveal on hover, and the layer underneath is the same texture with
the vibe's own grade applied in-shader — its palette remap, grain and bloom — so hovering shows
what the vibe *does* to a photograph, aligns by construction, and costs no generation. One WebGL
context is shared by the whole page and attached to whichever card is hovered; a context per table
row would pass the browser's limit inside one screenful. Every row has "Generate with this", which
jumps to Generate with that vibe selected. Crossing 20 samples enables the captioned-ZIP export.

## Degradation

Both are visible, neither is a 500 — the repo's rule.

- **No `OPENROUTER_API_KEY`** → a canvas-derived heuristic read (dominant palette, saturation,
  edge density) picks a family, and the card says plainly that it is an offline guess.
- **No Supabase** → the library reads the committed seed, saves stay in this browser, and a banner
  says so.

## Failure modes

| What happens | What the app does |
|---|---|
| Model refuses the image | Says so, offers "describe it yourself" as the way through |
| Invented `vibeId` | Dropped; the turn becomes a proposal |
| `vibe` rung under six words | One stricter retry, then shown with a warning |
| Supabase write fails | Card keeps its verdict; banner says it is unsaved; retry button |
| IndexedDB refuses the image | Already handled by the existing in-memory fallback |

## Files

```
src/lib/image-studio/sections.ts                  new   tab defs, server-readable
src/lib/image-studio/vibes.ts                     new   types, slugify, seed, validation, trainable math
src/lib/image-studio/vibes.test.ts                new
src/lib/image-studio/vibes-seed.ts                new   AGENTS → seed rows, used keyless
src/components/image-studio/ImageStudioShell.tsx  new   the switcher
src/components/image-studio/ImageStudio.tsx       edit  becomes the Generate studio, takes `embedded`
src/components/image-studio/AgentPicker.tsx       edit  reads the registry, family filter
src/components/image-studio/trail-reveal.ts       new   the WebGL reveal, shared
src/components/image-studio/vibe-lab/*            new   VibeLab, Dropzone, LadderCard, ArgumentChat, LoraVerdict
src/components/image-studio/vibe-library/*        new   VibeLibrary (table), VibeRow, SampleStrip
src/app/apps/image-studio/page.tsx                edit  validates ?section=
src/app/api/image-studio/vibe/route.ts            new   read + argue
src/app/api/image-studio/vibes/route.ts           new   list, save, export
supabase/migrations/20261002120000_image_vibes.sql new   image_vibes + image_vibe_samples
src/lib/catalog.ts                                edit  overview mentions the three studios
```

## Tests

`vibes.test.ts` covers the pure logic: slug collisions, rejection of a `vibeId` outside the sent
catalog, the six-word gate, trainable math at the boundary, and converting the five agents into
seed rows. `image-studio.test.ts` and `files.test.ts` must stay green.

Run with `npx vitest run src/lib/image-studio`.

## Not in scope

- Actual LoRA training, local or rented.
- Moderation or curation of community vibes — anything proposed joins the library. Curation was
  considered and rejected: it keeps the taxonomy clean at the cost of a library that stays empty
  until someone does approval passes.
- Per-user accounts. `created_by` records whoever the app gate knows about and nothing is scoped
  to a user.
