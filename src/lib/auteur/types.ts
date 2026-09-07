// ---------------------------------------------------------------------------
// Auteur — an AI film studio built around MiniMax H3.
//
// One Project is a whole production: the idea, the references the director
// may use, the developed plan (concept, characters, worlds, style), the
// scene/shot breakdown, and every take that was ever generated for a shot.
//
// These types are shared by the UI, the local repo, the heuristic director
// and the /api/auteur routes. Media bytes never live here — a reference or a
// take only carries a `mediaId`, and the bytes sit in IndexedDB (see media.ts).
// ---------------------------------------------------------------------------

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type ProjectStatus = "draft" | "developed" | "boarded";

/** What a reference IS, which decides how the director uses it. */
export type ReferenceKind =
  | "image"
  | "video"
  | "audio"
  | "character"
  | "location"
  | "object"
  | "style";

/** Where a reference applies. Exactly one level per reference. */
export type ReferenceScope =
  | { level: "project" }
  | { level: "scene"; sceneId: string }
  | { level: "shot"; shotId: string };

export interface Reference {
  id: string;
  kind: ReferenceKind;
  name: string;
  mime: string;
  /** Key into the IndexedDB media store. Absent for text-only references. */
  mediaId?: string;
  /** Tiny data-URL thumbnail kept with the project so cards render instantly. */
  thumb?: string;
  scope: ReferenceScope;
  /** What the AI (or the user) says this shows. Folded into prompts. */
  description: string;
  /** True once a vision pass wrote the description. */
  described: boolean;
  tags: string[];
  createdAt: string;
}

export interface Concept {
  logline: string;
  synopsis: string;
  theme: string;
  tone: string;
  /** Story beats in order, e.g. ["Meet", "Spark", "Rain", "Kiss"]. */
  structure: string[];
}

export interface Character {
  id: string;
  name: string;
  role: string;
  /** Appearance, age, wardrobe, defining traits — everything a shot must keep. */
  description: string;
  /** How they carry themselves and speak. */
  manner: string;
  referenceIds: string[];
}

export interface World {
  id: string;
  name: string;
  /** Environment, architecture, weather, key props. */
  description: string;
  timeOfDay: string;
  referenceIds: string[];
}

export interface Style {
  lookName: string;
  palette: string;
  lighting: string;
  /** Lens and camera language, e.g. "anamorphic 40mm, handheld, shallow focus". */
  cameraLanguage: string;
  grade: string;
  pacing: string;
  referenceIds: string[];
}

export type CameraAngle =
  | "eye level"
  | "low angle"
  | "high angle"
  | "overhead"
  | "dutch angle"
  | "over the shoulder"
  | "POV";

export type CameraMovement =
  | "static"
  | "push in"
  | "pull out"
  | "pan left"
  | "pan right"
  | "tilt up"
  | "tilt down"
  | "tracking"
  | "handheld"
  | "crane up"
  | "crane down"
  | "orbit"
  | "zoom in"
  | "zoom out"
  | "shake";

export type Framing =
  | "extreme wide"
  | "wide"
  | "medium wide"
  | "medium"
  | "medium close-up"
  | "close-up"
  | "extreme close-up"
  | "insert";

export interface Camera {
  angle: CameraAngle;
  movement: CameraMovement;
  framing: Framing;
  lens: string;
}

/** One reference the prompt names, in the order it is sent to H3. */
export interface PromptReference {
  /** "Subject 1", "Video 1", "Audio 1" — the label used inside the text. */
  label: string;
  referenceId: string;
}

/**
 * The exact thing sent to H3 for one shot.
 *
 * H3 reads a production brief, not a caption: shots are tagged "[Shot 1]",
 * the camera is a sentence with amplitude and speed, references are named
 * "<Subject N>" / "<Video N>" / "<Audio N>" in the order they are attached,
 * and because H3 always generates audio the prompt says what that audio is.
 */
export interface H3Prompt {
  text: string;
  /** The camera sentence, kept separate so the inspector can show it. */
  cameraLine: string;
  soundscape: string;
  music: string;
  /** Media references the text names, in send order. */
  references: PromptReference[];
  /** Why the director wrote it this way; shown to advanced users. */
  notes: string;
}

export type TakeStatus = "queued" | "generating" | "done" | "error";

export type GenEngine = "minimax" | "placeholder";

export interface ShotTake {
  id: string;
  createdAt: string;
  /** The prompt this take was generated from, frozen. */
  prompt: string;
  status: TakeStatus;
  engine: GenEngine;
  /** MiniMax task id while generating. */
  taskId?: string;
  /** Key into the IndexedDB media store once the clip is stored. */
  mediaId?: string;
  /** Hue used to paint the animatic when there is no clip. */
  posterHue: number;
  /** The retake instruction that produced this take, if any. */
  retakeNote?: string;
  error?: string;
}

export interface Shot {
  id: string;
  title: string;
  /** What the audience sees, in one or two sentences. */
  description: string;
  /** What the subject does during the clip. */
  action: string;
  camera: Camera;
  lighting: string;
  /** Facial expression / emotional read of the subject, if any. */
  expression: string;
  /** Spoken line, as "Name: what they say". H3 lip-syncs it. Empty = none. */
  dialogue: string;
  characterIds: string[];
  worldId: string | null;
  durationSec: number;
  referenceIds: string[];
  /** What must carry over from the previous shot. */
  continuity: string;
  prompt: H3Prompt;
  /** True once the user hand-edited the prompt; the director then leaves it. */
  promptEdited: boolean;
  takes: ShotTake[];
  activeTakeId: string | null;
}

export interface Scene {
  id: string;
  title: string;
  summary: string;
  worldId: string | null;
  characterIds: string[];
  timeOfDay: string;
  mood: string;
  shots: Shot[];
}

export interface AudioTrack {
  name: string;
  mime: string;
  mediaId: string;
  durationSec?: number;
}

export interface Project {
  id: string;
  title: string;
  idea: string;
  templateId: string;
  genreIds: string[];
  aspectRatio: AspectRatio;
  targetDurationSec: number;
  status: ProjectStatus;
  concept: Concept | null;
  characters: Character[];
  worlds: World[];
  style: Style | null;
  scenes: Scene[];
  references: Reference[];
  audio: AudioTrack | null;
  /** Free-form creative direction the user typed alongside the idea. */
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ----- director stage payloads ---------------------------------------------

/** What `develop` produces: the plan minus the breakdown. */
export interface Development {
  title: string;
  concept: Concept;
  characters: Character[];
  worlds: World[];
  style: Style;
}

/** A structured change to one shot, as a retake understands it. */
export interface ShotPatch {
  description?: string;
  action?: string;
  camera?: Partial<Camera>;
  lighting?: string;
  expression?: string;
  dialogue?: string;
  durationSec?: number;
  /** Wardrobe/appearance override for one character, keyed by character id. */
  characterOverrides?: Record<string, string>;
  /** Plain-English summary of what changed, for the take's label. */
  summary: string;
}

export type DirectorEngine = "ai" | "heuristic";
