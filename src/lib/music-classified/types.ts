// ---------------------------------------------------------------------------
// Music Classified — the shape of the library.
//
// A song is filed three levels deep: an energy LEVEL (1 = stillest, 10 = most
// hype), a GENRE playlist inside that level ("R&B"), and a SUB-GENRE inside the
// genre ("90s slow jam"). Levels are a fixed ladder so the numbers always mean
// the same thing; genres and sub-genres are free-form and grow with the library.
//
// Nothing here stores or plays audio. A song is its name, where it came from,
// and what it sounds like in words.
// ---------------------------------------------------------------------------

/** Ways a song can be described. Each one is a different pair of ears. */
export type LensId =
  | "listener"
  | "producer"
  | "songwriter"
  | "theory"
  | "dj"
  | "mood"
  | "dancer"
  | "recreate";

export interface Lens {
  id: LensId;
  label: string;
  /** Shown under the checkbox. */
  hint: string;
  /** What the model is told to write for this lens. */
  brief: string;
}

/** Measured off the 30-second preview in the browser, when one was reachable. */
export interface Measured {
  bpm: number;
  bpmConfidence: number;
  key: string;
  keyConfidence: number;
  brightness: string;
  percussion: string;
  dynamics: string;
  density: string;
}

/** The facts a description is built from, kept as fields so they can be sorted. */
export interface SoundProfile {
  /** Beats per minute — measured when `measured` is set, otherwise the model's estimate. */
  bpm: number | null;
  key: string;
  /** 0–100, the model's read on intensity. */
  energy: number | null;
  mood: string[];
  instruments: string[];
  vocals: string;
  production: string;
  era: string;
  similarArtists: string[];
}

/**
 * How much the model actually knows the song.
 *   known    — it recognises this exact recording.
 *   inferred — it knows the artist or scene and is reasoning from that.
 *   guess    — little to go on; treat the filing as a starting point.
 *   heard    — the user's own upload, which the AI actually listened to.
 */
export type Confidence = "known" | "inferred" | "guess" | "heard";

export interface Song {
  id: string;
  /** "own" = the user's own music (My Music tab). Absent = a reference song they love. */
  kind?: "own";
  /** Starred. Filterable across every level or within one. */
  favorite?: boolean;
  /** IndexedDB id of an uploaded file — the audio lives only on the device it was uploaded from. */
  audioId?: string;
  durationSec?: number;
  fileName?: string;
  title: string;
  artist: string;
  album?: string;
  year?: string;
  /** The store's own genre label (iTunes), kept as a clue, not as the filing. */
  sourceGenre?: string;
  artwork?: string;
  /** Every link this song was added from. */
  links: string[];

  level: number;
  genre: string;
  subgenre: string;
  /** One line on why it sits at this level — the thing to argue with. */
  levelReason: string;

  profile: SoundProfile;
  measured?: Measured;
  confidence: Confidence;
  /** Short tags for search ("falsetto", "808 slides", "sidechain"). */
  tags: string[];
  /** lens id → description. Only the lenses asked for are present. */
  descriptions: Partial<Record<LensId, string>>;
  notes: string;
  /** "ai" when a model filed it, "offline" when the no-key fallback did. */
  filedBy: "ai" | "offline";

  addedAt: string;
  updatedAt: string;
}

/**
 * Level → genre → sub-genres, in the order they were created. Kept alongside
 * the songs so an empty playlist you made on purpose does not vanish.
 */
export type Tree = Record<number, Record<string, string[]>>;

/** A playlist's shared DNA, written on request and kept until regenerated. */
export interface Blueprint {
  /** "3", "3/R&B" or "3/R&B/Slow jam". */
  scope: string;
  text: string;
  songCount: number;
  at: string;
}

export interface Library {
  songs: Song[];
  tree: Tree;
  blueprints: Blueprint[];
  /** The lenses ticked last time, so the add box remembers your habit. */
  defaultLenses: LensId[];
}

/** What the classify route hands back: a song minus the ids and stamps. */
export type SongDraft = Omit<Song, "id" | "addedAt" | "updatedAt" | "notes">;

export interface ClassifyResult {
  draft: SongDraft;
  /** Whether an AI key is configured — descriptions are only attempted when it is. */
  aiAvailable: boolean;
  /** Set when something degraded — no key, a link that would not resolve. */
  warning?: string;
}
