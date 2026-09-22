// ---------------------------------------------------------------------------
// Jarvis — the owner's voice-first agentic assistant.
//
// Jarvis grew out of New Dashboard, and deliberately keeps that app's data
// untouched: the Four-Cs profile still lives under its own `new-dashboard`
// store key and is rendered by the Profile tab. Everything Jarvis adds on top
// — memories, conversations, inbox, calendar, routines — lives in the separate
// blob described here so neither app can corrupt the other's state.
//
// Design rules that this shape encodes:
//   1. Nothing is invented. Every memory carries the source it came from and
//      when it was captured, so an answer can cite it.
//   2. Anything with an effect outside the app is a PendingAction first. It is
//      only executed after the owner confirms it (see spec §3).
// ---------------------------------------------------------------------------

/** Where a memory came from. Drives both citations and the sphere's colours. */
export type MemorySource =
  | "note" // typed into Jarvis by hand
  | "chat" // said in a conversation with Jarvis
  | "master-folder" // CLAUDE.md, aios/*, ~/.claude memory files
  | "skill" // a Claude Code skill the owner has
  | "file" // an uploaded document
  | "email" // pulled from a connected inbox
  | "event" // pulled from a connected calendar
  | "profile"; // derived from the Four-Cs intake

export const MEMORY_SOURCES: MemorySource[] = [
  "note",
  "chat",
  "master-folder",
  "skill",
  "file",
  "email",
  "event",
  "profile",
];

/** Human labels for the source filter list. */
export const SOURCE_LABEL: Record<MemorySource, string> = {
  note: "Notes",
  chat: "Conversations",
  "master-folder": "Master folder",
  skill: "Skills",
  file: "Files",
  email: "Email",
  event: "Calendar",
  profile: "Profile",
};

/**
 * One remembered thing.
 *
 * `content` is the text that gets searched and quoted; `title` is what a
 * citation shows. `capturedAt` is when Jarvis learned it, which is not always
 * when it happened — a synced master-folder note can be months old.
 */
export interface Memory {
  id: string;
  source: MemorySource;
  title: string;
  content: string;
  /** ISO timestamp Jarvis captured it. */
  capturedAt: string;
  /** Free tags; the owner's own words, never auto-invented ones. */
  tags: string[];
  /** Where it came from in the world: a file path, a message link, "you". */
  origin: string;
  /**
   * Ids of memories Jarvis has related to this one. Drives the sphere's links.
   * Empty until Stage 2 computes them from embeddings.
   */
  links: string[];
  /** Set once the memory also exists in Supabase, so sync can skip it. */
  remote?: boolean;
}

/** A memory Jarvis suggests after a conversation, pending the owner's review. */
export interface MemoryProposal {
  id: string;
  title: string;
  content: string;
  source: MemorySource;
  origin: string;
  /** Which conversation produced it, for "why are you suggesting this?". */
  conversationId: string;
  createdAt: string;
}

export type Role = "you" | "jarvis";

export interface Citation {
  memoryId: string;
  title: string;
  source: MemorySource;
  capturedAt: string;
}

export interface ChatTurn {
  id: string;
  role: Role;
  text: string;
  at: string;
  /** What Jarvis used to answer. Empty when he answered from nothing. */
  citations?: Citation[];
  /** Set when this turn was spoken rather than typed. */
  spoken?: boolean;
  /** A tool result summary, e.g. "Found 3 events". */
  did?: string;
  /** Thumbnails of pictures the owner attached (small JPEG data URLs). */
  images?: string[];
}

export interface Conversation {
  id: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  turns: ChatTurn[];
}

/**
 * Something Jarvis wants to do in the outside world. It is created by the
 * agent loop but never executed there — the owner confirms first.
 */
export interface PendingAction {
  id: string;
  /** Connector tool name, e.g. "googlecalendar.create_event". */
  tool: string;
  /** Plain-English sentence shown on the confirm card. */
  summary: string;
  /** The exact arguments that will be sent, shown in full and editable. */
  args: Record<string, unknown>;
  /** Which app it touches, for the card's badge. */
  app: string;
  createdAt: string;
  status: "pending" | "done" | "cancelled" | "failed";
  /** Filled after execution. */
  result?: string;
  error?: string;
}

export type InboxLabel = "needs-reply" | "task" | "reference" | "done";

export interface InboxMessage {
  id: string;
  /** Connected app it came from: "gmail", "slack", … or "manual" when pasted. */
  app: string;
  from: string;
  subject: string;
  body: string;
  /** ISO timestamp of the message itself. */
  at: string;
  link?: string;
  label: InboxLabel;
  read: boolean;
}

export interface CalEvent {
  id: string;
  title: string;
  /** Local date, YYYY-MM-DD. Stored as a local date on purpose: a calendar
   *  grid must not shift a day because of a UTC conversion. */
  date: string;
  /** "HH:MM" or "" for an all-day event. */
  start: string;
  end: string;
  timezone: string;
  where?: string;
  notes?: string;
  /** "manual" when the owner typed it, else the connector app id. */
  app: string;
}

export interface Routine {
  id: string;
  name: string;
  prompt: string;
  /** What context it needs injected: memory, calendar, inbox, profile. */
  needs: ("memory" | "calendar" | "inbox" | "profile")[];
  /** Past runs, newest first. Kept short (10). */
  runs: { id: string; at: string; output: string }[];
}

export interface JarvisStore {
  version: 1;
  memories: Memory[];
  proposals: MemoryProposal[];
  conversations: Conversation[];
  messages: InboxMessage[];
  events: CalEvent[];
  routines: Routine[];
  actions: PendingAction[];
  /** Memory sources the owner has switched off in the Memory tab. */
  mutedSources: MemorySource[];
  /** ISO timestamp of the last master-folder sync, or "". */
  lastSync: string;
}
