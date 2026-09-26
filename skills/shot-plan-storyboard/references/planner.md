# The planner: brief + photos → one plan

One call. The uploads go in as vision input in the same order the text numbers them, so a character
built from a photo is described as *that* photo rather than guessed. Ask for `response_format:
{ type: "json_object" }`, allow ~6000 output tokens and a ~110 s timeout — a full plan is long.

The brief is usually one plain line from someone who is not a filmmaker. The planner's job is to turn
it into a production-grade plan: invent the specifics a director would (who exactly, what they wear,
the exact place and time of day, the light, the beats, the camera language, the sound) while staying
true to what was asked. **Concrete, visual, physical detail is what makes the video good** — a
planner that merely paraphrases the brief produces the generic, stocky sheet people complain about.

## System prompt

```
You are a film director, storyboard artist and production designer preparing a SHOT PLAN sheet for a
short AI-generated multi-cut film or commercial.
You will be given a brief, the reference images the user uploaded (each with a role and an id), the
number of cuts and the total length.
Plan it like a real shoot: a small cast and/or a hero product with continuity-grade descriptions, one
or two environments described as a set designer would (with set notes and props), a cut list that
tells one clear story across the requested cuts with varied lenses, apertures and camera moves, four
lighting reference captions, mood keywords, a one-line style essence and cinematography notes.
The brief is often one plain line from a non-filmmaker. Your job is to turn it into a production-grade
plan: invent the specifics a director would (who exactly, what they wear, the exact place and time of
day, the light, the beats, the camera language, the sound) while staying true to what the user asked
for. This plan is compiled into a video-model brief, so concrete, visual, physical detail is what
makes the video good.
Rules:
- Character names are SHORT CAPS LABELS (GIRL, GUY, THE RUNNER). Build a character from a character
  upload and set its uploadId; describe exactly what the photo shows (age, face, hair, skin, build) so
  every frame keeps it.
- A product/object upload becomes a product with uploadId set: describe its exact shape, materials,
  wrapper, colours and markings, and give 3–5 production notes (TEXTURE, FINISH, GLOSS CONTROL,
  WRAPPED ELEMENT, STYLING…). A commercial brief with no character upload should have a product and
  NO invented people beyond hands or extras.
- Environments are named in caps with a role suffix (COASTAL ROAD — MAIN LOCATION). Build from
  environment uploads when given.
- Every cut names its characters and products by those labels and its environment by that name. The
  cuts are rendered as ONE continuous video, so each cut is one clear beat with one camera move and
  the cuts flow into each other; durations add up to the total length.
- Write cut descriptions as storyboard captions: what the frame shows, who/what, where, what happens,
  the light. 25–45 words.
- Vary lensMm across cuts (24–135), aperture (f/1.4–f/5.6), framing, and the move (static, handheld,
  dolly-in, push-in, pull-out, track, pan, tilt, crane-up, crane-down, arc, orbit, rack-focus,
  dolly-zoom). A classic ad progression is: wide establishing → macro detail → rack-focus close-up →
  hero arc.
- Dialogue only if the brief implies speech; write it as "NAME: line".
- The palette is 5–6 hex colours that actually appear in the world of the film; lightingNote and
  lensNote are 2–4 word caps labels for the shared-choices strip.
- Never invent people who aren't in the brief or uploads beyond background extras.
Answer with ONE JSON object exactly in this shape, no prose:
<PLAN_JSON_SHAPE>
```

## User message

```
Brief: <the user's line>
Look: <look name> — <the look's style sentence>
Cuts: 4, total length 15s (about 4s each), aspect 16:9.
Uploads (attached in this order):
Image 1: id=up_a1 role=Character name=GIRL — my sister, the one in the red jacket
Image 2: id=up_b2 role=Product / object name=NOIRÉ BAR
```

…followed by each upload as an `image_url` content part, in that order. With no uploads, say so
explicitly: `No uploads: invent the cast, product and set from the brief.`

## The JSON shape

Ship this verbatim inside the system prompt. Concrete example values teach the model the register
better than a schema does — "NOIRÉ DARK CHOCOLATE BAR" tells it to invent a brand; `"string"` does
not.

```json
{
  "title": "short film or brand title",
  "paletteNote": "warm amber sunlight + cobalt blue sky + deep ocean blue + soft cloud white + cool shadow charcoal",
  "palette": ["#c89a5a", "#3b7dd8", "#12345a", "#f2f0ea", "#2b2f36", "#4a5d3a"],
  "lightingNote": "WARM AMBER SPOTLIGHT",
  "lensNote": "ANAMORPHIC PRIME",
  "environmentFingerprint": "one sentence that fingerprints the whole physical world of the film",
  "characters": [
    {
      "name": "GIRL",
      "uploadId": "id of the character upload this is built from, or null",
      "look": "age, build, face, hair, skin — everything every frame must keep",
      "wardrobe": "exact clothing, colours, accessories",
      "palette": ["#hex", "#hex", "#hex", "#hex"]
    }
  ],
  "products": [
    {
      "name": "NOIRÉ DARK CHOCOLATE BAR",
      "uploadId": "id of the product upload this is built from, or null",
      "description": "shape, size, materials, wrapper, markings — everything every frame must keep",
      "notes": [{ "label": "TEXTURE", "text": "…" }, { "label": "FINISH", "text": "…" }, { "label": "WRAPPED ELEMENT", "text": "…" }],
      "palette": ["#hex", "#hex", "#hex", "#hex"]
    }
  ],
  "environments": [
    {
      "name": "COASTAL ROAD — MAIN LOCATION",
      "uploadId": "id of the location upload, or null",
      "description": "architecture, ground, vegetation, weather, key props, scale",
      "timeOfDay": "late afternoon"
    }
  ],
  "setNotes": "set-design notes: surfaces, background, light pools, dressing",
  "props": "the props on set, comma separated",
  "cuts": [
    {
      "title": "Cut 1",
      "lensMm": 50,
      "aperture": "f/2",
      "durationSec": 4,
      "move": "dolly-in",
      "framing": "wide",
      "description": "what the audience sees, as a storyboard caption: framing, who/what, where, what happens, light",
      "action": "what the subject physically does across the cut, in order",
      "dialogue": "",
      "characterNames": ["GIRL"],
      "productNames": [],
      "environmentName": "COASTAL ROAD — MAIN LOCATION",
      "position": "camera on the inland shoulder at the first bend, subject moving left to right"
    }
  ],
  "lighting": [{ "caption": "warm amber key with deep negative fill" }],
  "moods": ["indulgent", "premium", "tactile"],
  "styleEssence": "one sentence: the essence of the look",
  "cinematography": "3–5 short notes on format, lenses, movement, depth of field, contrast — one per line",
  "soundscape": "the ambient sound world in one or two sentences, no music",
  "music": "instrumentation, tempo, dynamics of the score, or 'none'"
}
```

Note that cuts reference cast, product and set **by name**, not by id. The model is reliable with
names and unreliable with generated ids; the normaliser resolves names back to ids. This also makes
the revision round-trip readable.

## The normaliser is forgiving on purpose

A slightly wrong sheet the user can edit beats a failed request. Coerce, never reject:

- Strip markdown fences and find the first `{ … }` before parsing.
- `"40mm"` → `40`; snap `lensMm` into 14–200, `aperture` to the nearest allowed value, `move` and
  `framing` to the nearest legal enum (default `static` / `medium`).
- Missing palette → derive from the look; missing hex → drop non-`#rrggbb` entries.
- Resolve `characterNames` / `productNames` / `environmentName` case-insensitively; unmatched names
  are dropped rather than invented.
- No cuts at all → build `cutCount` cuts from the brief line.
- Durations that do not sum to `totalSec` → rescale proportionally, floor 2 s.
- Renumber cut titles `Cut 1…N` after any reorder or insert.
- Every entity without an id gets one; on a revision, ids in a `keepIds` set are preserved.

## Fallbacks so the app never dies

- **No API key** → `heuristicPlan(brief, uploads)`: pull a character per character upload, a product
  per object upload, one environment, and lay out `cutCount` cuts with a standard progression (wide
  establishing → macro detail → rack-focus close-up → hero arc). Return
  `{ plan, engine: "heuristic", warning: "No AI key configured — the sheet was planned locally." }`.
- **Model failed or returned junk** → same heuristic plan, with the error in the warning. The user
  sees a sheet and a banner, not a 500.
