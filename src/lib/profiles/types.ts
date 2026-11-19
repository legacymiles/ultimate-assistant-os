// ---------------------------------------------------------------------------
// Profiles — the shape of the owner's web of people, businesses and jobs.
//
// A profile has ONE home (the parent whose `children` lists it, which decides
// its path) and may be LINKED inside any other profile (`links`). That is what
// "webbed folders" means: My Son lives on the home screen and also shows up
// inside My Profile, without being two copies.
//
// A profile holds four kinds of thing and nothing else: profiles inside it,
// sections of label/value rows, photos and videos, and links. Sections exist
// only when they have rows — there are no empty placeholders anywhere.
// ---------------------------------------------------------------------------

/** People are round, everything else is square. */
export type NodeKind = "person" | "thing";

export interface Item {
  id: string;
  /** The label: "Gas code", "Supplier email". */
  k: string;
  /** The value, always as the owner would read it. */
  v: string;
  /** Codes, serials, account numbers: hidden until tapped. */
  secret?: boolean;
  /**
   * Never put in any prompt — not the harness, not the cloud. Set on what the
   * Life record marks sensitive (SSN and the like) and on imported passwords.
   * The owner can still see and copy it here.
   */
  noAi?: boolean;
  /** ISO yyyy-mm-dd when the row is a date, so "next up" can be worked out. */
  date?: string;
  /** Dollars, when the row is a purchase or an expense. */
  money?: number;
  /** A short second line ("Oct 30", "from Blank Supply Co."). */
  meta?: string;
}

export interface Section {
  id: string;
  title: string;
  /** A lucide icon name (kebab-case) — see components/profiles/icons. */
  icon?: string;
  items: Item[];
}

export interface Media {
  id: string;
  kind: "photo" | "video";
  /** A data: URL for the owner's own uploads. Absent on the examples. */
  src?: string;
  /** Example media only: a palette key the placeholder art is painted from. */
  scene?: string;
  caption: string;
  date?: string;
  /** "0:24" for a video. */
  dur?: string;
  /** The Dashboard (Recall) image item this upload was mirrored into. */
  recallItemId?: string;
  /** Read live from the Dashboard's Photos/Folders, not stored here. */
  fromRecall?: boolean;
}

/**
 * Where a profile lives in the Dashboard (Recall) — the Folders, Memory and
 * Photos tabs. Profiles writes its own folder, a searchable note mirroring its
 * details, and a Photos sub-folder for what is uploaded here, so those tabs
 * always show the same profile.
 */
export interface RecallLink {
  folderId?: string;
  noteId?: string;
  photosFolderId?: string;
  /** The Dashboard profile this one was imported from, when it was. */
  profileId?: string;
}

export interface ProfileNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** "Person", "Business", "Teacher" — the small word over the name. */
  label: string;
  /** The one line under the name. */
  sub: string;
  icon?: string;
  initials?: string;
  /** Only top-level profiles usually set this; everything inside inherits. */
  hue?: number;
  /** Profiles that live here (their home). */
  children: string[];
  /** Profiles that live elsewhere but are shown here too. */
  links: string[];
  sections: Section[];
  media: Media[];
  /** Other words the owner uses for it: "teacher", "the shop", "work". */
  aliases?: string[];
  /** When true, Jarvis never searches or edits it. */
  hidden?: boolean;
  archived?: boolean;
  /** Seeded example, not the owner's own. */
  example?: boolean;
  /** Questions this page suggests in the bar. */
  asks?: string[];
  /** A small square photo (data URL), shown in place of initials. */
  avatar?: string;
  recall?: RecallLink;
  /** Life record field key → the row it lives in here (My Profile only). */
  recordKeys?: Record<string, string>;
}

/** A fact Jarvis remembered that does not belong in a section yet. */
export interface MemoryNote {
  id: string;
  about: string;
  k: string;
  v: string;
}

/** One saved change set, with what undoes it. */
export interface LogEntry {
  id: string;
  at: number;
  text: string;
  /** "MY SON › SCHOOL" */
  where: string;
  hue: number;
  undo: Change[];
  undone?: boolean;
}

export interface ProfilesData {
  version: 1;
  nodes: Record<string, ProfileNode>;
  memory: MemoryNote[];
  log: LogEntry[];
  /** True while the seeded examples are still in. */
  examples: boolean;
  /** Sources already imported once ("recall:<id>"), so they never import twice. */
  imported?: string[];
  settings: {
    /** Hide `secret` values until tapped. */
    mask: boolean;
    /** Which brain answers: the PC harness first, then the cloud, then offline. */
    brain: "auto" | "harness" | "cloud" | "offline";
  };
}

// --- changes ---------------------------------------------------------------

/**
 * Everything Jarvis (or the owner) can do to the profiles. A change set is an
 * ordered list of these; `add_node` may carry a `ref` such as "new:1" that
 * later changes in the same set use in place of an id that does not exist yet.
 */
export type Change =
  | { op: "add_node"; ref?: string; parent: string; name: string; kind?: NodeKind; label?: string; sub?: string; icon?: string; initials?: string }
  | { op: "add_item"; node: string; section: string; k: string; v: string; secret?: boolean; date?: string; money?: number; meta?: string }
  | { op: "set_item"; item: string; v: string; date?: string }
  | { op: "remove_item"; item: string }
  | { op: "move_node"; node: string; parent: string }
  | { op: "link_node"; node: string; into: string }
  | { op: "rename_node"; node: string; name?: string; sub?: string }
  | { op: "archive_node"; node: string }
  | { op: "add_media"; node: string; media: Media[] }
  | { op: "remember"; about: string; k: string; v: string }
  // Internal: only ever produced as the inverse of something above.
  | { op: "delete_node"; node: string }
  | { op: "restore_node"; node: string }
  | { op: "unlink_node"; node: string; into: string }
  | { op: "restore_item"; node: string; section: string; sectionIndex: number; index: number; item: Item; sectionTitle: string; sectionIcon?: string }
  | { op: "remove_media"; node: string; ids: string[] }
  | { op: "forget"; id: string }
  // The page's own settings edits (colour, icon, privacy) — never from a brain.
  | { op: "patch_node"; node: string; patch: Partial<Pick<ProfileNode, "hue" | "icon" | "initials" | "hidden" | "aliases">> };

/** What a brain hands back: words, plus anything it wants the page to do. */
export interface AgentActions {
  changes?: Change[];
  /** Item or node ids the answer came from. */
  sources?: string[];
  /** Show photos of this node. */
  media?: string;
  /** Fly the page to this node. */
  open?: string;
  /** Quick replies. */
  chips?: string[];
}

export interface AgentReply {
  text: string;
  actions: AgentActions;
  /** Which brain answered, for the small label under the message. */
  by: "harness" | "cloud" | "offline";
}
