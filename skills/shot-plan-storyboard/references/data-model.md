# The data model

One project holds: the brief the user typed, the images they uploaded (each with a role), the **plan**
the planner produced, the **panels** drawn for that plan, and the video **takes** rendered from it.

Bytes never live in the project record. Uploads are downscaled JPEG data URLs (≤1024px) so a reload
can redraw panels; generated images and clips go to IndexedDB under a `mediaId`. A project is small
enough to keep in localStorage or sync to a row.

```ts
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type UploadRole = "character" | "location" | "object" | "style";
export type LookId = "live-action" | "anime" | "3d-animation" | "commercial" | "documentary";
export type Quality = "medium" | "high";          // 768P / 2K

export interface Upload {
  id: string;
  role: UploadRole;
  name: string;            // "GIRL", "COASTAL ROAD"
  dataUrl: string;         // downscaled JPEG data URL, ≤ 1024px
  description: string;     // what this shows
}

export interface Brief {
  prompt: string;
  cutCount: number;        // 2–8
  totalSec: number;        // the finished film; a single generation is 4–15 s
  aspectRatio: AspectRatio;
  look: LookId;
  quality: Quality;
}
```

## The plan

Every field here exists because something downstream reads it — the sheet, an image prompt, or the
video brief. Cut anything and the corresponding detail disappears from the film.

```ts
export interface PlanCharacter {
  id: string;
  name: string;            // SHORT CAPS LABEL, used on the sheet AND inside video prompts: "GIRL"
  look: string;            // age, build, face, hair — what every frame must keep
  wardrobe: string;
  palette: string[];       // 4–6 hex
  uploadId: string | null; // the photo this was built from
}

export interface PlanProduct {
  id: string;
  name: string;                            // "NOIRÉ DARK CHOCOLATE BAR"
  description: string;                     // shape, materials, wrapper, markings
  notes: { label: string; text: string }[]; // TEXTURE / FINISH / GLOSS CONTROL — shown under the sheet
  palette: string[];
  uploadId: string | null;
}

export interface PlanEnvironment {
  id: string;
  name: string;            // "COASTAL ROAD — MAIN LOCATION"
  description: string;     // architecture, ground, vegetation, weather, key props, scale
  timeOfDay: string;
  uploadId: string | null;
}

export type CameraMove =
  | "static" | "handheld" | "push-in" | "pull-out" | "dolly-in" | "track" | "pan" | "tilt"
  | "crane-up" | "crane-down" | "orbit" | "arc" | "rack-focus" | "dolly-zoom";

export type Framing =
  | "extreme wide" | "wide" | "medium" | "two-shot"
  | "close-up" | "extreme close-up" | "macro" | "insert";

export interface PlanCut {
  id: string;
  title: string;           // "Cut 1", renumbered on reorder
  lensMm: number;          // 24–135
  aperture: string;        // "f/2"
  durationSec: number;     // seconds inside the finished film
  move: CameraMove;
  framing: Framing;
  description: string;     // the storyboard caption, 25–45 words
  action: string;          // what the subject physically does across the clip
  dialogue: string;        // "NAME: line"; empty = none
  characterIds: string[];
  productIds: string[];
  environmentId: string | null;
  position: string;        // where on the floor plan this cut happens, in plan words
}

export interface Plan {
  title: string;
  paletteNote: string;              // "warm amber sunlight + cobalt blue sky + …"
  palette: string[];                // 5–6 hex that actually appear in the film
  lightingNote: string;             // caps label for the shared-choices strip
  lensNote: string;                 // caps label, e.g. "ANAMORPHIC PRIME"
  environmentFingerprint: string;   // one sentence fingerprinting the whole world
  characters: PlanCharacter[];
  products: PlanProduct[];
  environments: PlanEnvironment[];
  setNotes: string;
  props: string;
  cuts: PlanCut[];
  lighting: { id: string; caption: string }[];   // four reference captions
  moods: string[];
  styleEssence: string;
  cinematography: string;           // one note per line
  soundscape: string;
  music: string;
}
```

## Panels and takes

A panel is one image with a status. Its id is `kind:targetId`, so a plan edit can address it without
a lookup table.

```ts
export type PanelKind =
  | "character" | "product" | "environment" | "floorplan" | "elevation" | "cut" | "lighting";

export interface Panel {
  id: string;              // `${kind}:${targetId}`
  kind: PanelKind;
  targetId: string;        // which character / product / env / cut / lighting note
  status: "idle" | "drawing" | "done" | "error";
  mediaId?: string;
  placeholder?: boolean;   // the image model was unavailable and a placeholder was drawn
  error?: string;
}

export interface Take {
  id: string;
  cutId: string | null;    // null = the whole film in ONE generation (the normal case)
  createdAt: string;
  prompt: string;          // the compiled brief, frozen
  durationSec: number;
  status: "queued" | "generating" | "done" | "error";
  engine: string;
  taskId?: string;
  mediaId?: string;
  error?: string;
}

export interface Project {
  id: string;
  title: string;
  brief: Brief;
  uploads: Upload[];
  plan: Plan | null;
  panels: Panel[];
  takes: Take[];
  promptOverrides: Record<string, string>; // cut id → hand-edited prompt; "full" for the whole film
  sheetMediaId?: string;                   // the composed sheet PNG, cleared on any panel change
  chat?: { role: "user" | "ai"; text: string; at: string }[];
  stage: "brief" | "storyboard" | "video";
  createdAt: string;
  updatedAt: string;
}
```

## The rules that keep state sane

- **`panelsFor(plan, existing)`** derives the panel list from the plan and carries over panels that
  already drew. Call it after every plan edit; new entities get an `idle` panel, removed ones vanish.
  Draw order matters and lives here: characters, products, environments, floor plan, elevation, cuts,
  lighting.
- **Any panel change clears `sheetMediaId`** — the composed sheet is stale the moment a picture
  underneath it changed.
- **One writer.** Every mutation goes through a single `commit(fn)` that reads the latest project from
  a ref, never a closure. Two updates in one tick (a panel finishing while a take polls) otherwise
  clobber each other — a bug worth avoiding from the first commit.

## Useful constants

```ts
export const MAX_UPLOADS = 9;    // typical image-reference ceiling on video models
export const MAX_CUTS = 8;
export const TOTAL_SECONDS = [6, 10, 15];   // one generation is 4–15 s
export const LENSES = [24, 35, 40, 50, 75, 85, 90, 100, 135];
export const APERTURES = ["f/1.4", "f/2", "f/2.4", "f/2.8", "f/4", "f/5.6"];

/** Seconds each cut gets inside one generation: the film split evenly, never under 2 s. */
export const perCutSeconds = (totalSec: number, cutCount: number) =>
  Math.max(2, Math.round(totalSec / Math.max(1, cutCount)));
```

Each **look** carries a style sentence that every image and video prompt opens with — that single
shared sentence is what stops the sheet and the film from disagreeing about the medium:

```ts
"live-action": "Live-action, cinematic, anamorphic lens character with 2.39:1 composition, shallow
  depth of field, realistic film grain, natural light, no CGI plasticity"
"commercial":  "Live-action commercial, glossy and polished, crisp product-grade lighting, saturated
  but controlled colour, clean backgrounds, premium ad photography"
"documentary": "Observational documentary, natural available light, handheld realism, honest colour,
  real textures, no stylisation"
"anime":       "2D anime, clean line art, cel shading, painterly backgrounds, expressive faces,
  Makoto Shinkai-like light and sky"
"3d-animation":"Stylised 3D animation, soft subsurface skin, rounded appealing character design,
  physically based lighting, Pixar-like render quality"
```
