// ---------------------------------------------------------------------------
// Smart Shot Videos — the shapes shared by the UI, the planner and the routes.
//
// A Project is: the brief the user typed, the images they uploaded (each with
// a role), the Plan the planner produced (characters, products, environments,
// cuts and notes), the Panels drawn for that plan (character sheets, product
// sheets, environment plates, floor plan, cut frames, lighting strips) and the
// video takes rendered by MiniMax H3 — one take for the whole multi-cut film
// (the Smart Shot way) or one per cut.
//
// Bytes never live here. Uploads are kept as small JPEG data URLs so a reload
// can redraw panels; generated images and clips sit in IndexedDB under a
// mediaId (see media.ts).
// ---------------------------------------------------------------------------

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type UploadRole = "character" | "location" | "object" | "style";

export interface Upload {
  id: string;
  role: UploadRole;
  /** A name for characters/locations/objects ("GIRL", "COASTAL ROAD"). */
  name: string;
  /** Downscaled JPEG data URL, ≤ 1024px. */
  dataUrl: string;
  /** What the planner (or the user) says this shows. */
  description: string;
}

export type LookId = "live-action" | "anime" | "3d-animation" | "commercial" | "documentary";

/** Medium = 768P, High = 2K on H3 (OpenArt's Medium/High shoot quality). */
export type Quality = "medium" | "high";

export interface Brief {
  prompt: string;
  cutCount: number;
  /** Length of the finished film in seconds. H3 renders 4–15 s in one go. */
  totalSec: number;
  aspectRatio: AspectRatio;
  look: LookId;
  quality: Quality;
}

// ----- the plan --------------------------------------------------------------

export interface PlanCharacter {
  id: string;
  /** Short caps label used on the sheet and inside H3 prompts: "GIRL". */
  name: string;
  /** Age, build, face, hair — what every frame must keep. */
  look: string;
  wardrobe: string;
  /** Hex colours of the character's palette, 4–6. */
  palette: string[];
  /** The upload this character was built from, if any. */
  uploadId: string | null;
}

/** A hero product or object, the subject of a commercial. */
export interface PlanProduct {
  id: string;
  /** "NOIRÉ DARK CHOCOLATE BAR". */
  name: string;
  /** Shape, size, materials, markings — what every frame must keep. */
  description: string;
  /** Production notes shown under the sheet: "TEXTURE: …", "FINISH: …". */
  notes: { label: string; text: string }[];
  palette: string[];
  uploadId: string | null;
}

export interface PlanEnvironment {
  id: string;
  /** "COASTAL ROAD — MAIN LOCATION". */
  name: string;
  description: string;
  timeOfDay: string;
  uploadId: string | null;
}

export type CameraMove =
  | "static"
  | "handheld"
  | "push-in"
  | "pull-out"
  | "dolly-in"
  | "track"
  | "pan"
  | "tilt"
  | "crane-up"
  | "crane-down"
  | "orbit"
  | "arc"
  | "rack-focus"
  | "dolly-zoom";

export type Framing = "extreme wide" | "wide" | "medium" | "two-shot" | "close-up" | "extreme close-up" | "macro" | "insert";

export interface PlanCut {
  id: string;
  /** "Cut 1". Renumbered on reorder. */
  title: string;
  /** Focal length in mm, e.g. 40. */
  lensMm: number;
  /** "f/2", "T2.8". */
  aperture: string;
  /** Seconds this cut lasts inside the finished film. */
  durationSec: number;
  move: CameraMove;
  framing: Framing;
  /** The beat, as the sheet caption reads it. */
  description: string;
  /** What the subject physically does across the clip. */
  action: string;
  /** "Name: line". Empty = no dialogue. */
  dialogue: string;
  characterIds: string[];
  productIds: string[];
  environmentId: string | null;
  /** Where on the floor plan this cut happens, in plan words. */
  position: string;
}

export interface LightingNote {
  id: string;
  /** "midday road glare on asphalt & chrome guardrail". */
  caption: string;
}

export interface Plan {
  title: string;
  /** "warm amber sunlight + cobalt blue sky + …" */
  paletteNote: string;
  palette: string[];
  /** Shared-choices strip: "WARM AMBER SPOTLIGHT". */
  lightingNote: string;
  /** Shared-choices strip: "ANAMORPHIC PRIME". */
  lensNote: string;
  /** One sentence fingerprinting the whole environment. */
  environmentFingerprint: string;
  characters: PlanCharacter[];
  products: PlanProduct[];
  environments: PlanEnvironment[];
  /** Set-design notes and props for Section 2. */
  setNotes: string;
  props: string;
  cuts: PlanCut[];
  lighting: LightingNote[];
  /** Mood / theme words: ["fleeting encounter", "summer transience"]. */
  moods: string[];
  /** One sentence: the essence of the look. */
  styleEssence: string;
  /** Cinematography notes, one per line. */
  cinematography: string;
  /** Sound world for the whole film. */
  soundscape: string;
  music: string;
}

// ----- drawn panels ----------------------------------------------------------

export type PanelKind = "character" | "product" | "environment" | "floorplan" | "elevation" | "cut" | "lighting";

export interface Panel {
  id: string;
  kind: PanelKind;
  /** Which character / product / environment / cut / lighting note this panel draws. */
  targetId: string;
  status: "idle" | "drawing" | "done" | "error";
  mediaId?: string;
  /** Set when the image model was unavailable and a placeholder was drawn. */
  placeholder?: boolean;
  error?: string;
}

// ----- video -----------------------------------------------------------------

export type TakeStatus = "queued" | "generating" | "done" | "error";

export interface Take {
  id: string;
  /** The cut this take renders, or null for the whole film in one generation. */
  cutId: string | null;
  createdAt: string;
  /** The H3 brief this take was rendered from, frozen. */
  prompt: string;
  durationSec: number;
  status: TakeStatus;
  engine: "minimax" | "placeholder";
  taskId?: string;
  mediaId?: string;
  error?: string;
  note?: string;
}

export type Stage = "brief" | "storyboard" | "video";

export interface Project {
  id: string;
  title: string;
  brief: Brief;
  uploads: Upload[];
  plan: Plan | null;
  panels: Panel[];
  takes: Take[];
  /** Cut id → prompt text once the user hand-edited it; "full" for the whole-film prompt. */
  promptOverrides: Record<string, string>;
  /** Media id of the composed shot-plan sheet PNG, once rendered. */
  sheetMediaId?: string;
  /** The AI director chat on the storyboard page. */
  chat?: { role: "user" | "ai"; text: string; at: string }[];
  stage: Stage;
  createdAt: string;
  updatedAt: string;
}
