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
import type { StudioForm } from "@/lib/studio/forms";
import type { Storyboard } from "@/lib/studio/storyboard";
import type { UpdatesBlob } from "./updates";

export type MemorySource =
  // A note in the owner's Obsidian vault. The vault on disk is the source of
  // truth; a memory row with this source is a searchable MIRROR of a file, not
  // the file itself — which is why deleting one is refused and has to happen in
  // Obsidian. It ranks above every other source, because it is the only one the
  // owner authored deliberately.
  | "vault"
  | "note" // typed into Jarvis by hand
  | "chat" // said in a conversation with Jarvis
  | "master-folder" // CLAUDE.md and aios/* — the repo files that ship with the deploy
  | "skill" // a Claude Code skill the owner has
  | "file" // an uploaded document
  | "email" // pulled from a connected inbox
  | "event" // pulled from a connected calendar
  | "profile"; // derived from the Four-Cs intake

export const MEMORY_SOURCES: MemorySource[] = [
  "vault",
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
  vault: "Vault",
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
  /**
   * What each entry of `images` is, by the same index: the file's name, and
   * whether the picture is a photograph or a frame grabbed out of a clip. It is
   * there so the @ menu can still call a reference by its name three turns
   * later; turns saved before it existed have none, so nothing may depend on it
   * beyond the label.
   */
  imageInfo?: { name: string; kind: "image" | "video"; durationSec?: number }[];
  /**
   * Sound the owner attached. It is kept apart from the pictures because it is
   * not one: nothing in the chat hears it, so what reached the model was the
   * measured note, and the waveform here is only so the owner can see which
   * track a turn was carrying.
   */
  audio?: { thumb: string; name: string; durationSec?: number; note?: string }[];
  /** A Studio skill's form, asked with this Jarvis turn. */
  form?: StudioForm;
  /** The owner has submitted that form. */
  formDone?: boolean;
  /** A shot plan for one continuous film, laid out with this turn and editable. */
  storyboard?: Storyboard;
  /**
   * What the agent actually did to get this answer, one line per step.
   *
   * `did` says the same thing in a sentence and predates this; the list is what
   * the Chat tab draws as a trace, because "searched memory, read your folders,
   * drafted the event" is three things the owner can check separately.
   */
  steps?: string[];
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
  /**
   * The Chat tab's own conversation, and the only one it writes.
   *
   * It is kept apart from `conversations` — which Studio owns — because the two
   * are different agents with different jobs: the Chat tab is a general agent
   * that reads memory and drafts actions, Studio plans and renders film. One
   * transcript holding both would feed a shot table to the assistant and a
   * calendar draft to the director.
   */
  chat: Conversation | null;
  messages: InboxMessage[];
  events: CalEvent[];
  routines: Routine[];
  actions: PendingAction[];
  /** Memory sources the owner has switched off in the Memory tab. */
  mutedSources: MemorySource[];
  /**
   * The Updates feed on the dashboard: which sources may speak, and how far
   * the owner has read. No notification rows live here — the feed is derived
   * from the data itself every time (see lib/jarvis/updates.ts).
   */
  updates: UpdatesBlob;
  /** ISO timestamp of the last master-folder sync, or "". */
  lastSync: string;
}
