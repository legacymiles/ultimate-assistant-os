// ---------------------------------------------------------------------------
// Profile — the owner's personal-information OS, the Profile tab of Jarvis.
//
// Two layers, and the split is the whole design (docs/superpowers/specs/
// jarvis-profile-app.md):
//
//   About Me  — a ~1 page briefing, DERIVED from the tree, read every turn.
//   The tree   — the full record, unbounded, read on demand.
//
// Nodes are a FLAT list with parent pointers, like Recall's folders, for the
// same two reasons: the whole thing syncs as one `app_state` blob, and a
// rename or a move is one field rather than a tree rewrite.
// ---------------------------------------------------------------------------

/** Icon names this app uses, narrowed from `components/icons` so a pack cannot name one that does not exist. */
export type IconName =
  | "Folder" | "Users" | "Cash" | "Note" | "Globe" | "Key" | "Shield" | "Home"
  | "Calendar" | "File" | "Lock" | "Server" | "Target" | "Flag" | "Star"
  | "Layers" | "Tag" | "Bulb" | "Clock" | "Link" | "Database" | "Grid";

/**
 * How a field behaves. Only `secret` carries behaviour: it is masked in the UI
 * and stripped by `redactForAi` before any tree text leaves the browser.
 * The rest are presentation and validation hints.
 */
export type FieldKind =
  | "text"
  | "multiline"
  | "date"
  | "money"
  | "url"
  | "email"
  | "phone"
  | "address"
  | "secret";

/** Who put a value there. Drives the confirm queue and the "AI wrote this" marks. */
export type Source = "you" | "ai" | "import";

export interface Field {
  id: string;
  label: string;
  kind: FieldKind;
  value: string;
  source: Source;
  /**
   * False for anything the AI drafted that the owner has not agreed to yet.
   * An unconfirmed field is a queue item, which is what makes the first run a
   * review rather than a typing session.
   */
  confirmed: boolean;
  updatedAt: string;
}

/**
 * A node is BOTH a folder and a record — it holds fields *and* children.
 *
 * "Current job" has an address and a door code as well as a Pay stubs
 * subfolder. Splitting those into "folders" and "records" is what makes other
 * folder systems tiring to use, so this model refuses the distinction.
 */
export interface Node {
  id: string;
  /** null = a root tile. */
  parentId: string | null;
  name: string;
  /** The `Pack` id that shaped this node, or "" for a plain folder. */
  pack: string;
  icon: IconName;
  fields: Field[];
  notes: string;
  /** Shown on the root strip regardless of depth. */
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A typed folder template. A stated fact fires one of these; it writes the shape. */
export interface Pack {
  id: string;
  label: string;
  icon: IconName;
  /**
   * Phrases that imply this pack. Used both to seed the AI's extraction prompt
   * and to rank the manual "add" menu, so the two paths agree on vocabulary.
   */
  cues: string[];
  fields: { label: string; kind: FieldKind }[];
  /** Subfolders created with the node. */
  children?: { name: string; pack?: string; icon?: IconName }[];
}

/** The owner's basics — the one block that is hand-edited and never derived. */
export interface Basics {
  name: string;
  birthday: string;
  pronouns: string;
  email: string;
  phone: string;
  location: string;
  /** One line the owner wants Jarvis to always know. Survives every rebuild. */
  headline: string;
}

export interface AboutDoc {
  /** Markdown, hard-capped. */
  text: string;
  builtAt: string;
  /** How many nodes it was built from, for the "Rebuilt from N folders" line. */
  fromCount: number;
  /**
   * Line index (as a string key, so it survives JSON) → the node ids that line
   * was derived from. This is what the provenance hover reads, and it is also
   * the honesty mechanism: a line with no sources is a line nobody can trace.
   */
  sources: Record<string, string[]>;
  /** Lines the owner pinned — always kept across a rebuild. */
  pinned: string[];
  /** Lines the owner vetoed — never re-added. */
  vetoed: string[];
}

export type ConfirmKind = "conflict" | "unconfirmed" | "stale";

export interface ConfirmItem {
  id: string;
  kind: ConfirmKind;
  nodeId: string;
  fieldId?: string;
  /** Asked in the owner's words, e.g. "Two addresses on file — which is current?" */
  question: string;
  /** For a conflict: the values to choose between, one click each. */
  options?: string[];
}

/** One AI write, kept so the owner can undo it. */
export interface WriteMark {
  id: string;
  at: string;
  /** Breadcrumb of what changed, e.g. "Work › Acme · door code". */
  where: string;
  nodeId: string;
  fieldId?: string;
  /** The value before the write, for the undo. "" when the field was created. */
  before: string;
  /** True when the whole field was added and undo should remove it. */
  created?: boolean;
}

export interface ProfileStore {
  version: 1;
  /** Small data URL. Kept inline because it is one square avatar, not a gallery. */
  avatar: string;
  basics: Basics;
  nodes: Node[];
  about: AboutDoc;
  queue: ConfirmItem[];
  writes: WriteMark[];
  /** True once the owner has been through ingestion or the question fallback once. */
  onboarded: boolean;
}

/** A draft the extractor returns, before anything is written into the tree. */
export interface Draft {
  /** Breadcrumb path of names, e.g. ["Work", "Acme"]. Missing parents are created. */
  path: string[];
  pack: string;
  /**
   * `source` lets an importer keep each value's own provenance. The life
   * record knows whether the owner typed a value or Jarvis guessed it, and
   * flattening both to "ai" would push 47 facts the owner already confirmed
   * back into the confirm queue. Defaults to "ai", which is right for an
   * extraction.
   */
  fields: { label: string; kind?: FieldKind; value: string; source?: Source }[];
  notes?: string;
}
