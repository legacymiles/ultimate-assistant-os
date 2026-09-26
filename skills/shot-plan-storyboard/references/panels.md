# The panels: every image on the sheet

A panel is one image: a character turnaround sheet, a product sheet, an environment plate, the
top-down floor plan, a side elevation, one storyboard frame per cut, or a lighting reference strip.

Write these as **pure functions** — plan in, `{ kind, prompt, aspect, refs }` out. They are the
highest-leverage code in the feature and the easiest to unit-test. The client attaches the images the
spec names, in the order given.

```ts
export interface PanelRef {
  role: "photo" | "character-sheet" | "product-photo" | "product-sheet"
      | "location-photo" | "environment-plate" | "style";
  label: string;
  dataUrl: string;
}
export interface PanelSpec { kind: PanelKind; prompt: string; aspect: string; refs: PanelRef[] }
```

## The role guide — the single most important paragraph

Every prompt ends with a block naming each attached image and saying how faithfully to use it. A
model handed four unlabelled images averages them into a fifth thing; told which is identity and
which is mood, it obeys.

```
Reference images:
Image 1 is a PHOTO of GIRL: keep this exact person — face, age, skin tone, hair, build — recognisable in every view.
Image 1 is the CHARACTER SHEET for GIRL: this is the same person; keep face, hair and wardrobe identical.
Image 1 is a PHOTO of the product NOIRÉ BAR: keep its exact shape, proportions, materials, colours, wrapper and markings.
Image 1 is the PRODUCT SHEET for NOIRÉ BAR: this is the same object; keep it identical in every detail.
Image 1 is a PHOTO of the location COASTAL ROAD: keep its layout, materials, vegetation and light.
Image 1 is the ENVIRONMENT PLATE for COASTAL ROAD: set the shot in exactly this place.
Image 1 is a STYLE reference: borrow its colours, lighting and mood only — do not copy its people.
```

Every prompt also ends with `No captions, watermarks, borders or extra text.` — generated storyboard
frames otherwise arrive with invented subtitles burned in.

## The prompts

Each is a list of paragraphs joined by blank lines, empty ones filtered out. `look.style` is the
look's shared style sentence (see `data-model.md`).

### Character sheet — aspect 1:1, refs: the character's photo + style refs

```
Character reference sheet for {NAME}, a six-panel grid on a plain white studio background: top row
full-body front view, full-body three-quarter view, full-body back view; bottom row a head-and-
shoulders portrait facing camera, a profile portrait, and a detail of the wardrobe. All six show the
identical person in the identical outfit.

Appearance: {look}. Wardrobe: {wardrobe}.

Palette of the character: {palette joined}.

Style: {look.style}. Neutral, even studio light, sharp focus, photographic.

{role guide}
{no-text line}
```

Six panels, not one portrait. A single headshot cannot tell a downstream model what the back of the
jacket looks like, and the cut frames need exactly that.

### Product sheet — aspect 16:9, refs: the product photo + style refs

```
Product / hero object reference sheet for {NAME}, a five-panel grid on a plain white studio
background: 1 front view, 2 three-quarter view, 3 side / edge view, 4 macro detail of the surface and
material, 5 in-context lifestyle shot in its set. All five show the identical object.

The object: {description}.

{notes as "TEXTURE: …. FINISH: …."}

Palette: {palette}.

Style: {look.style}. Product-grade studio light with controlled specular highlights, sharp focus, photographic.

{role guide}
{no-text line}
```

### Environment plate — aspect 16:9 (3:4 for a vertical film), refs: the location photo + style refs

```
Set design plate of {NAME}: a wide establishing view of the location with nobody in it.

{description} Time of day: {timeOfDay}.

Set notes: {setNotes}
Props on set: {props}.

World palette: {paletteNote}. Environment fingerprint: {environmentFingerprint}

Style: {look.style}.

{role guide}
{no-text line}
```

Nobody in it. The plate is a place, not a scene; people belong in the cut frames, and an empty plate
is a far better reference for the ones that follow.

### Top-down floor plan — aspect 16:9, refs: the environment plate

```
A top-down floor plan of the set {NAME}, drawn as a clean production-design schematic seen from
directly above: the ground, surfaces, structures, props and light pools drawn in muted flat colour
with thin dark outlines; small camera icons with a short arrow for each cut's direction of movement,
and a white numbered circle marker 1 to {N} beside each camera. A north arrow or scale bar in a
corner. Blueprint / technical-illustration style, white margins.

Layout: {environment description}

Props to draw: {props}.

Cut positions: 1: Cut 1 — DOLLY-IN, wide, camera on the inland shoulder…; 2: Cut 2 — …

{role guide}

The only text allowed is the cut numbers 1–{N} inside the markers.
```

The floor plan is what makes the sheet read as a real production document rather than a mood board,
and the numbered markers tie it to the storyboard row underneath.

### Side elevation — aspect 3:4, refs: the environment plate

```
A side-elevation diagram for {last cut title} ({move}) on the set {NAME}: a vertical strip of three
small frames stacked from the highest camera position at the top to ground level at the bottom,
showing the camera's path with a dotted line and a small silhouette of the subject at each height.
Clean technical-illustration style, muted colour, thin lines, white margins.

Set: {description}

{role guide}
{no-text line}
```

### Storyboard frame — aspect = the film's aspect, refs: character sheets + product sheets + set plate + style (max 8)

```
Storyboard frame for {Cut N}: a single cinematic still, {framing} shot on a {lensMm}mm lens at {aperture}.

{cut description}

{NAME}: {look}, wearing {wardrobe}.
{PRODUCT}: {description}.

Set: {env name} — {env description}, {timeOfDay}. Props: {props}.

Palette: {paletteNote}. {styleEssence} {cinematography on one line}

Style: {look.style}. Frame it exactly as the camera would at the midpoint of the {move} move.

{role guide}
{no-text line}
```

"At the midpoint of the move" matters: without it a dolly-in frame is drawn at its start and the
storyboard reads as a series of wides.

### Lighting still — aspect 4:3, refs: the set plate + the hero sheet

```
Lighting reference still: {caption}.

On the set of {env name} ({description}), showing {hero product or character}. Palette: {paletteNote}.

Style: {look.style}. A tight, textural frame focused on how the light falls, not on story.

{role guide}
{no-text line}
```

## Draw order, and why it is not negotiable

```
1. characters, products, environments      ← identity, drawn from the user's photos
2. floor plan, elevation, cut frames       ← drawn FROM the sheets and plates of step 1
3. lighting stills                         ← cheapest, least depended-on, last
```

Before drawing a panel, fetch the images it depends on out of storage and downscale them (character
and product sheets to ~768px, plates to ~640px, lighting refs to ~512px) so the request stays small.
When a dependency has not drawn yet, fall back to the user's original upload with the `photo` role —
degraded but still anchored.

```ts
/** Run jobs at most `limit` at a time — a burst of image calls can outrun a small credit balance. */
const pool = async (jobs: (() => Promise<void>)[], limit = 4) => {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await queue.shift()!();
  }));
};

const drawAll = async () => {
  commit((p) => ({ ...p, panels: panelsFor(plan, p.panels) }));   // keep what is already drawn
  const need = (kind, id) => { const x = panelFor(panels, kind, id); return !x || x.status === "idle" || x.status === "error"; };

  setBusy("Drawing reference sheets and set plates…");
  await pool([...characters, ...products, ...environments].filter(need).map(draw));

  setBusy("Drawing the storyboard…");
  await pool([floorplan, elevation, ...cuts].filter(need).map(draw));

  setBusy("Drawing lighting references…");
  await pool(lighting.filter(need).map(draw));
};
```

The status line naming what is being drawn is worth the two lines of code: the first pass takes a
minute or two and the user needs to see the shoot being prepped in the order a shoot is prepped.

## The panel route

**One image per request.** A generated PNG is 1–2 MB of base64 and serverless responses cap around
4.5 MB, so the client draws the sheet as parallel single-image requests.

```
POST /api/panel  { kind, prompt, aspect, refs: [{ role, label, dataUrl }], caption }
→ { image } | { image, placeholder: true } | { refusal } | { error }
```

- Content is `[{ type: "text", text: prompt }, ...refs.map(url => ({ type: "image_url", image_url: { url } }))]`
  — text first, images after, cap at 8 refs.
- Pass the aspect through to the model's own image config rather than cropping afterwards.
- A refusal (text back, no image) is a user-visible message on that panel, not a crash.
- **No key configured** → return a drawn placeholder: a canvas with the panel kind, the caption and a
  hatched fill. The sheet stays legible and the layout stays honest.
- On a `402 / in-flight credits` error, wait ~6 s and retry once — providers reserve credit per
  in-flight request and a burst trips a limit that clears as the others settle.

Any successful draw clears the composed sheet PNG (`sheetMediaId`), because it no longer matches.
