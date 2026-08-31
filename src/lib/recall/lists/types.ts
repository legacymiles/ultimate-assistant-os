// ---------------------------------------------------------------------------
// Recall Lists — domain types.
//
// The "other half" of Recall. Where the folder/RAG side holds durable reference
// material, Lists holds the churn of daily life — buy milk, dentist Tuesday,
// renew the insurance — shared with the household and deleted constantly.
//
// Deliberately separate from src/lib/recall/types.ts: a ListItem is never
// indexed, never searched by the main search box, and never seen by the agent.
//
// This file must stay client-safe (no node: imports) — the components read the
// palettes and the built-in definitions straight from here.
// ---------------------------------------------------------------------------

export type Role = "admin" | "member";

/**
 * Three tiers plus an unset default. The user asked for red/orange/yellow, and
 * the fourth state is the reason those three keep meaning something: if every
 * row had to pick a colour, the colours would just be decoration.
 */
export type Priority = "urgent" | "low" | "wish" | null;

export interface Member {
  id: string;
  name: string;
  /** Key into MEMBER_COLOURS. Unique across members — the picker enforces it. */
  colour: string;
  role: Role;
  /** PBKDF2, base64. Absent on the admin row: their authority is the app password. */
  salt?: string;
  hash?: string;
  joinedAt: string;
}

/** A member as it is safe to send to the browser — never the password material. */
export type PublicMember = Omit<Member, "salt" | "hash">;

export interface Invite {
  token: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  /** Set once consumed, so the admin can see who used which link. */
  memberId?: string;
}

export interface ListDef {
  id: string;
  name: string;
  /** Key into the Icon set in src/components/icons.tsx. */
  icon: string;
  builtIn: boolean;
  /**
   * Hidden, never deleted. Hiding a built-in must never destroy its items —
   * the same invariant the folder-section code enforces.
   */
  hidden: boolean;
  order: number;
}

export interface ListItem {
  id: string;
  listId: string;
  text: string;
  priority: Priority;
  note?: string;
  /** ISO date (YYYY-MM-DD), no time. A flag on the item, not a calendar entry. */
  dueDate?: string;
  url?: string;
  done: boolean;
  /** Member.id. Drives both the colour circle and who is allowed to delete it. */
  authorId: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ListsData {
  members: Member[];
  invites: Invite[];
  lists: ListDef[];
  items: ListItem[];
}

/** What GET /api/recall/lists returns — the whole board, from the caller's view. */
export interface BoardPayload {
  me: PublicMember;
  isAdmin: boolean;
  members: PublicMember[];
  lists: ListDef[];
  items: ListItem[];
  /** Pending, unexpired invites. Admin only; empty for members. */
  invites: Invite[];
  /**
   * False when the host filesystem will not keep the file (Vercel serverless).
   * Surfaced in the UI rather than silently losing the family's shopping list.
   */
  persistent: boolean;
}

// ----- Priority tiers ------------------------------------------------------

export interface PriorityMeta {
  id: Exclude<Priority, null> | "none";
  label: string;
  /** What the tier means, shown in the picker so the tiers stay used consistently. */
  hint: string;
  dot: string;
  chip: string;
  /** Left edge of the row when the tier is set. */
  edge: string;
}

export const PRIORITIES: PriorityMeta[] = [
  {
    id: "urgent",
    label: "Urgent",
    hint: "Hot — needs doing now",
    dot: "bg-red-500",
    chip: "border-red-500/40 bg-red-500/15 text-red-300",
    edge: "bg-red-500",
  },
  {
    id: "low",
    label: "Running low",
    hint: "Restock soon",
    dot: "bg-orange-500",
    chip: "border-orange-500/40 bg-orange-500/15 text-orange-300",
    edge: "bg-orange-500",
  },
  {
    id: "wish",
    label: "Wish list",
    hint: "Someday, no rush",
    dot: "bg-yellow-400",
    chip: "border-yellow-400/40 bg-yellow-400/15 text-yellow-200",
    edge: "bg-yellow-400",
  },
  {
    id: "none",
    label: "Normal",
    hint: "No particular urgency",
    dot: "bg-ink-faint/60",
    chip: "border-line bg-panel-2 text-ink-muted",
    edge: "bg-transparent",
  },
];

export function priorityMeta(p: Priority): PriorityMeta {
  return PRIORITIES.find((x) => x.id === (p ?? "none")) ?? PRIORITIES[3];
}

/** Sort order on a tile: urgent first, unset last, done always at the bottom. */
export const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  low: 1,
  wish: 2,
  none: 3,
};

// ----- Member colours ------------------------------------------------------

export interface MemberColour {
  id: string;
  label: string;
  /** The filled circle next to an item. */
  dot: string;
  /** The filter chip when active. */
  chip: string;
  /** Initials inside the circle need to read against `dot`. */
  ink: string;
}

export const MEMBER_COLOURS: MemberColour[] = [
  { id: "sky", label: "Blue", dot: "bg-sky-500", chip: "border-sky-400/50 bg-sky-500/20 text-sky-200", ink: "text-white" },
  { id: "rose", label: "Pink", dot: "bg-rose-500", chip: "border-rose-400/50 bg-rose-500/20 text-rose-200", ink: "text-white" },
  { id: "emerald", label: "Green", dot: "bg-emerald-500", chip: "border-emerald-400/50 bg-emerald-500/20 text-emerald-200", ink: "text-white" },
  { id: "violet", label: "Purple", dot: "bg-violet-500", chip: "border-violet-400/50 bg-violet-500/20 text-violet-200", ink: "text-white" },
  { id: "amber", label: "Amber", dot: "bg-amber-500", chip: "border-amber-400/50 bg-amber-500/20 text-amber-200", ink: "text-black" },
  { id: "cyan", label: "Teal", dot: "bg-cyan-500", chip: "border-cyan-400/50 bg-cyan-500/20 text-cyan-200", ink: "text-black" },
  { id: "fuchsia", label: "Magenta", dot: "bg-fuchsia-500", chip: "border-fuchsia-400/50 bg-fuchsia-500/20 text-fuchsia-200", ink: "text-white" },
  { id: "lime", label: "Lime", dot: "bg-lime-500", chip: "border-lime-400/50 bg-lime-500/20 text-lime-200", ink: "text-black" },
];

export function colourOf(id: string): MemberColour {
  return MEMBER_COLOURS.find((c) => c.id === id) ?? MEMBER_COLOURS[0];
}

/** Two letters at most — "Dad" → D, "Jack S" → JS. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ----- Built-in lists ------------------------------------------------------

/**
 * The eight the board ships with. Seeded on first read; `builtIn` ones can be
 * hidden but never deleted, so their items can never be destroyed by tidying
 * the board.
 */
export const BUILT_IN_LISTS: Omit<ListDef, "hidden">[] = [
  { id: "todo", name: "To-Do", icon: "Check2", builtIn: true, order: 0 },
  { id: "buy", name: "To-Buy", icon: "Cart", builtIn: true, order: 1 },
  { id: "remember", name: "Remember", icon: "Calendar", builtIn: true, order: 2 },
  { id: "ideas", name: "Ideas", icon: "Bulb", builtIn: true, order: 3 },
  { id: "goals", name: "Goals", icon: "Target", builtIn: true, order: 4 },
  { id: "projects", name: "Projects", icon: "Layers", builtIn: true, order: 5 },
  { id: "bills", name: "Bills", icon: "Cash", builtIn: true, order: 6 },
  { id: "notes", name: "Notes", icon: "Note", builtIn: true, order: 7 },
];

/** Offered when the admin creates a custom list. */
export const LIST_ICONS = [
  "Check2", "Cart", "Calendar", "Bulb", "Target", "Layers", "Cash", "Note",
  "Star", "Flag", "Clock", "Home", "Film", "Mic", "Globe", "Tag",
];

/** Placeholder author for items whose member was removed but kept. */
export const REMOVED_MEMBER: PublicMember = {
  id: "removed",
  name: "Removed",
  colour: "sky",
  role: "member",
  joinedAt: "",
};

/**
 * How long a ticked item stays visible before it is swept.
 * Without a sweep a daily-use shopping list becomes an archive within a week.
 */
export const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
