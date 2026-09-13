// ---------------------------------------------------------------------------
// Recall — Photos domain.
//
// The problem this models: a camera roll is not one kind of thing. A photo is
// either (a) INFORMATION — a receipt, a whiteboard, a screenshot of a booking —
// which belongs in the knowledge base next to your notes; (b) an EVENT — a
// flyer, an invite, a save-the-date — which belongs in the calendar; or (c)
// PEOPLE, which belongs in a photo sub-folder chosen by WHO is in it. So the
// triage produces a ROUTE first, and only then a destination.
//
// The people side is deliberately rule-driven rather than hardcoded. "Me and
// my son" is not a special case in the code — it is a Category whose rule says
// "exactly {me, son}". That is what lets a new child, a new partner or a new
// grouping be added later from the UI instead of from a rewrite, and it is why
// every folder the user listed falls out of one small matcher.
// ---------------------------------------------------------------------------

/** The top-level folder every photo category lives under. */
export const PHOTOS_ROOT = "Photos";

/**
 * Roles exist so a rule can say "at least two relatives" without the user
 * having to enumerate every cousin as a required person.
 */
export type PersonRole = "self" | "partner" | "child" | "relative" | "friend" | "other";

export const ROLE_LABELS: Record<PersonRole, string> = {
  self: "Me",
  partner: "Partner",
  child: "Child",
  relative: "Relative",
  friend: "Friend",
  other: "Other",
};

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  /**
   * Small reference face crops as data URLs. These are what make recognition
   * work: they are sent alongside each new photo so the vision model is asked
   * "which of THESE people is in this picture", a far more reliable question
   * than open-ended identification. 2–4 varied shots is the sweet spot.
   */
  refs: string[];
  notes?: string;
  createdAt: string;
}

/**
 * A destination rule. The first category (by `order`) whose rule the detected
 * cast satisfies wins, so the most specific rules must sort first.
 */
export interface PhotoCategory {
  id: string;
  name: string;
  /** Every one of these people must be in the shot. */
  requires: string[];
  /** …plus at least `min` people holding one of `roles`. */
  anyRoles?: { roles: PersonRole[]; min: number } | null;
  /** True when NO known person outside the rule may also be present. */
  exact: boolean;
  /** Total distinct people (known + unknown) the shot must contain. */
  minPeople: number;
  /** Lower sorts (and matches) first. */
  order: number;
  /** Built-in categories can be edited but not deleted out from under a rule. */
  builtIn: boolean;
  /** Auto-maintained solo folder for this person, when the category is one. */
  personId?: string | null;
  description?: string;
}

/**
 * Where a photo goes. The first three are owned by this pipeline; anything else
 * is a destination id from the registry (src/lib/dashboard/destinations), which
 * is why this is not a closed union — adding an app must not require editing
 * this line.
 */
export type PhotoRoute = "people" | "info" | "event" | (string & {});

/** A person the vision pass believes it saw. */
export interface PersonHit {
  personId: string;
  confidence: number;
}

export interface PhotoEventDraft {
  title: string;
  /** "YYYY-MM-DD" or null when the image gives no readable date. */
  date: string | null;
  time: string | null;
  location?: string;
}

export interface PhotoAnalysis {
  route: PhotoRoute;
  title: string;
  /** One or two sentences describing the image — becomes the item summary. */
  caption: string;
  /** Any legible text transcribed out of the image. Feeds the RAG index. */
  text?: string;
  people: PersonHit[];
  /** Faces that are clearly people but match nobody in the gallery. */
  unknownPeople: number;
  /** Where an "info" photo belongs in the knowledge base. */
  folderPath?: string[];
  tags: string[];
  event?: PhotoEventDraft | null;
  /**
   * Raw fields for a registry destination, unvalidated. The destination's own
   * parse() is the trust boundary — this route cannot know what any given app
   * requires, and should not have to.
   */
  destination?: { id: string; fields: Record<string, unknown> };
  /** The Dashboard photo album the user's instructions asked the picture itself to go in. */
  photoAlbum?: string | null;
  /** What the agent did because of the user's instructions, and what it could not do. */
  agentNote?: { followed: string[]; couldNot: string[] } | null;
  engine: "ai" | "heuristic";
}

export type PendingStatus = "analyzing" | "ready" | "failed";

/**
 * One photo waiting on approval. `fileId` points at the full blob in
 * IndexedDB; only the tiny `thumb` lives in localStorage, for the same reason
 * attachments have always worked that way.
 */
export interface PendingPhoto {
  id: string;
  fileId: string;
  name: string;
  type: string;
  size: number;
  thumb?: string;
  addedAt: string;
  status: PendingStatus;
  analysis?: PhotoAnalysis;
  /** The resolved destination folder path, e.g. ["Photos","Me & My Son"]. */
  destPath?: string[];
  /** The category that produced `destPath`, when the route was "people". */
  categoryId?: string | null;
  /** Set when the user overrides the proposal by hand. */
  overridden?: boolean;
  error?: string;
  /** Look-alike fingerprint of the picture (see fingerprint.ts). */
  fingerprint?: string;
  /**
   * Set when this photo looks like one already filed or already waiting.
   * A warning, not a block: the user can still keep it.
   */
  duplicateOf?: { label: string; identical: boolean } | null;
  /** The user saw the duplicate warning and chose to keep this photo anyway. */
  keepDuplicate?: boolean;
  /**
   * The user's own instructions for this photo ("save it to my Desserts
   * cookbook, leave out the nutrition info"). Kept so a later Re-read still
   * follows them.
   */
  userPrompt?: string;
}

export interface PhotosSettings {
  /** Back approved photos up to Google Drive as they are filed. */
  driveBackup: boolean;
  /** The Drive folder id Recall created for backups, once it has one. */
  driveFolderId?: string | null;
  /** Mirror the category sub-folders inside the Drive backup folder. */
  driveMirrorCategories: boolean;
}

export interface PhotosData {
  people: Person[];
  categories: PhotoCategory[];
  settings: PhotosSettings;
}

export interface PhotoQueue {
  pending: PendingPhoto[];
}

// ----- matching ------------------------------------------------------------

export interface DetectedCast {
  personIds: string[];
  unknownPeople: number;
}

/** Does this cast satisfy the category's rule? */
export function categoryMatches(
  cat: PhotoCategory,
  cast: DetectedCast,
  people: Person[],
): boolean {
  const present = new Set(cast.personIds);
  const total = cast.personIds.length + cast.unknownPeople;
  if (total < cat.minPeople) return false;
  for (const id of cat.requires) if (!present.has(id)) return false;

  const roleOf = new Map(people.map((p) => [p.id, p.role]));
  if (cat.anyRoles && cat.anyRoles.min > 0) {
    const wanted = new Set(cat.anyRoles.roles);
    const hits = cast.personIds.filter(
      (id) => !cat.requires.includes(id) && wanted.has(roleOf.get(id) as PersonRole),
    );
    if (hits.length < cat.anyRoles.min) return false;
  }

  if (cat.exact) {
    // Nobody known may be present who is neither required nor filling a role slot.
    const allowedRoles = new Set(cat.anyRoles?.roles ?? []);
    const stray = cast.personIds.some(
      (id) => !cat.requires.includes(id) && !allowedRoles.has(roleOf.get(id) as PersonRole),
    );
    if (stray) return false;
    // An "exact" rule also refuses strangers — "me and my son" means the two
    // of us, not the two of us plus whoever else was at the party.
    if (cast.unknownPeople > 0 && cat.minPeople <= cat.requires.length + (cat.anyRoles?.min ?? 0)) {
      return false;
    }
  }
  return true;
}

/** The best destination category for a cast, or null when nothing fits. */
export function pickCategory(
  categories: PhotoCategory[],
  cast: DetectedCast,
  people: Person[],
): PhotoCategory | null {
  return (
    categories
      .slice()
      .sort((a, b) => a.order - b.order)
      .find((c) => categoryMatches(c, cast, people)) ?? null
  );
}

/**
 * Photo folders get their own palette — warm ambers and roses against the cool
 * blues and violets the knowledge-base folders use — so the photo side of
 * Recall is recognisable at a glance from anywhere in the app.
 */
export const PHOTO_ACCENTS = [
  { tile: "from-amber-500/35 via-amber-500/10 to-transparent border-amber-400/35", ink: "text-amber-200" },
  { tile: "from-rose-500/35 via-rose-500/10 to-transparent border-rose-400/35", ink: "text-rose-200" },
  { tile: "from-orange-500/35 via-orange-500/10 to-transparent border-orange-400/35", ink: "text-orange-200" },
  { tile: "from-pink-500/35 via-pink-500/10 to-transparent border-pink-400/35", ink: "text-pink-200" },
  { tile: "from-yellow-500/30 via-yellow-500/10 to-transparent border-yellow-400/35", ink: "text-yellow-200" },
  { tile: "from-red-500/30 via-red-500/10 to-transparent border-red-400/35", ink: "text-red-200" },
];
