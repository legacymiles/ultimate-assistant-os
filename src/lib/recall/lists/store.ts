// ---------------------------------------------------------------------------
// Recall Lists — server-side store.
//
// The folder/RAG side of Recall lives in localStorage, and Lists deliberately
// does not: the whole point of the feature is that a family member opens an
// invite link on their own phone, so the data has to leave the device.
//
// Storage follows the pattern gateStore.ts already established for the app
// password — a JSON file next to the project, written from Node-runtime route
// handlers. Persistence is therefore host-dependent and reported honestly:
//   · long-lived Node host (local dev, a VPS) → the file persists.
//   · Vercel serverless → ephemeral and per-instance, so `persistent` is false
//     and the UI says so rather than losing the family's shopping list.
//
// This file is the Supabase seam. Everything above it — types, route shapes,
// components — is unaware of where the bytes actually sit.
//
// EVERY mutator takes a Caller and re-checks it. The UI hides what you cannot
// do, but the UI is not the enforcement point.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { nowIso, uid } from "../../utils";
import { dataFile, ensureDataDir } from "../dataDir";
import { hashPassword, verifyPassword } from "../passwords";
import {
  BUILT_IN_LISTS,
  COMPLETED_TTL_MS,
  MEMBER_COLOURS,
  type BoardPayload,
  type Invite,
  type ListDef,
  type ListItem,
  type ListsData,
  type Member,
  type Priority,
  type PublicMember,
} from "./types";

const FILE = dataFile(".recall-lists.json");
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The admin is whoever holds the app password; this row is only their identity. */
export const ADMIN_ID = "admin";

interface StoredData extends ListsData {
  version: 1;
  /** HMAC key for member session cookies. Never leaves the server. */
  secret: string;
}

/** Thrown for anything the caller is not allowed to do. Carries an HTTP status. */
export class ListsError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

// ----- persistence ---------------------------------------------------------

function seed(): StoredData {
  return {
    version: 1,
    secret: randomBytes(32).toString("hex"),
    members: [
      {
        id: ADMIN_ID,
        name: "Admin",
        colour: MEMBER_COLOURS[0].id,
        role: "admin",
        joinedAt: nowIso(),
      },
    ],
    invites: [],
    lists: BUILT_IN_LISTS.map((l) => ({ ...l, hidden: false })),
    items: [],
  };
}

/**
 * Fold a freshly-read file up to the current shape.
 * Built-ins added in a later version appear automatically; ones the user hid
 * stay hidden. A list the file has but the code does not is left alone — it is
 * a custom list.
 */
function normalise(raw: Partial<StoredData> | null): StoredData {
  const base = seed();
  if (!raw) return base;

  const members = Array.isArray(raw.members) ? raw.members : base.members;
  const admin = members.find((m) => m.id === ADMIN_ID) ?? base.members[0];

  const lists: ListDef[] = Array.isArray(raw.lists) ? [...raw.lists] : [];
  for (const b of BUILT_IN_LISTS) {
    if (!lists.some((l) => l.id === b.id)) lists.push({ ...b, hidden: false });
  }

  return {
    version: 1,
    secret: typeof raw.secret === "string" && raw.secret ? raw.secret : base.secret,
    members: [admin, ...members.filter((m) => m.id !== ADMIN_ID)],
    invites: Array.isArray(raw.invites) ? raw.invites : [],
    lists,
    items: Array.isArray(raw.items) ? raw.items : [],
  };
}

/**
 * Drop ticked items past their TTL and invites past their expiry.
 * Done lazily on read rather than on a timer: there is no scheduler here, and a
 * board nobody opens does not need sweeping.
 */
function sweep(data: StoredData): { data: StoredData; changed: boolean } {
  const cutoff = Date.now() - COMPLETED_TTL_MS;
  const items = data.items.filter((i) => {
    if (!i.done || !i.completedAt) return true;
    const at = Date.parse(i.completedAt);
    return Number.isNaN(at) || at > cutoff;
  });
  const now = Date.now();
  const invites = data.invites.filter(
    (v) => !v.consumedAt && Date.parse(v.expiresAt) > now,
  );
  const changed = items.length !== data.items.length || invites.length !== data.invites.length;
  return { data: { ...data, items, invites }, changed };
}

async function readFile(): Promise<StoredData> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return normalise(JSON.parse(raw) as Partial<StoredData>);
  } catch {
    return normalise(null);
  }
}

async function writeFile(data: StoredData): Promise<void> {
  try {
    // The directory may not exist yet — RECALL_DATA_DIR routinely points at a
    // volume the app is expected to create.
    await ensureDataDir();
    await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
  } catch {
    throw new ListsError(
      "This deployment's filesystem is read-only, so the list could not be saved.",
      500,
    );
  }
}

/** Read, sweep, and persist the sweep if it removed anything. */
async function load(): Promise<StoredData> {
  const swept = sweep(await readFile());
  if (swept.changed) {
    // A failed sweep-write is not worth failing the read over — the stale rows
    // simply survive until the next successful write.
    await writeFile(swept.data).catch(() => undefined);
  }
  return swept.data;
}

/** Can we actually write next to the project? Probes rather than guesses. */
export async function canPersist(): Promise<boolean> {
  const probe = `${FILE}.probe`;
  try {
    if (!(await ensureDataDir())) return false;
    await fs.writeFile(probe, "1", "utf8");
    await fs.unlink(probe);
    return true;
  } catch {
    return false;
  }
}

/** The HMAC key for member cookies, minted and stored on first use. */
export async function signingSecret(): Promise<string> {
  const data = await readFile();
  const onDisk = await fs
    .readFile(FILE, "utf8")
    .then(() => true)
    .catch(() => false);
  if (!onDisk) await writeFile(data).catch(() => undefined);
  return data.secret;
}

// ----- callers -------------------------------------------------------------

export interface Caller {
  member: Member;
  isAdmin: boolean;
}

export async function adminCaller(): Promise<Caller> {
  const data = await load();
  const member = data.members.find((m) => m.id === ADMIN_ID)!;
  return { member, isAdmin: true };
}

export async function memberCaller(id: string): Promise<Caller | null> {
  const data = await load();
  const member = data.members.find((m) => m.id === id);
  if (!member) return null;
  // A member row that somehow claims admin still does not get admin authority:
  // that comes from the app-password cookie, never from this file.
  return { member, isAdmin: false };
}

function requireAdmin(caller: Caller): void {
  if (!caller.isAdmin) throw new ListsError("Only the admin can do that.");
}

function publicMember(m: Member): PublicMember {
  const { salt: _salt, hash: _hash, ...rest } = m;
  void _salt;
  void _hash;
  return rest;
}

// ----- reading -------------------------------------------------------------

export async function getBoard(caller: Caller): Promise<BoardPayload> {
  const data = await load();
  return {
    me: publicMember(caller.member),
    isAdmin: caller.isAdmin,
    members: data.members.map(publicMember),
    lists: [...data.lists].sort((a, b) => a.order - b.order),
    items: data.items,
    invites: caller.isAdmin ? data.invites.filter((v) => !v.consumedAt) : [],
    persistent: await canPersist(),
  };
}

// ----- items ---------------------------------------------------------------

export interface ItemInput {
  listId: string;
  text: string;
  priority?: Priority;
  note?: string;
  dueDate?: string;
  url?: string;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function addItem(caller: Caller, input: ItemInput): Promise<BoardPayload> {
  const data = await load();
  const text = cleanText(input.text, 300);
  if (!text) throw new ListsError("Give the item some text.", 400);
  const list = data.lists.find((l) => l.id === input.listId);
  if (!list) throw new ListsError("That list no longer exists.", 404);

  const item: ListItem = {
    id: uid("li"),
    listId: list.id,
    text,
    priority: normalisePriority(input.priority),
    note: cleanText(input.note, 500) || undefined,
    dueDate: normaliseDate(input.dueDate),
    url: cleanText(input.url, 500) || undefined,
    done: false,
    authorId: caller.member.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  data.items.push(item);
  await writeFile(data);
  return getBoard(caller);
}

export type ItemPatch = Partial<Pick<ListItem, "text" | "priority" | "note" | "dueDate" | "url" | "done" | "listId">>;

/**
 * The permission rule with the one deliberate exception:
 * editing and deleting are owner-scoped, but ANYONE may tick something done.
 * If one person buys the milk another person added, they have to be able to
 * check it off — that is the whole point of a shared list.
 */
export async function updateItem(
  caller: Caller,
  id: string,
  patch: ItemPatch,
): Promise<BoardPayload> {
  const data = await load();
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new ListsError("That item is gone.", 404);

  const keys = Object.keys(patch);
  const onlyDone = keys.length > 0 && keys.every((k) => k === "done");
  const owns = item.authorId === caller.member.id;
  if (!caller.isAdmin && !owns && !onlyDone) {
    throw new ListsError("You can only change items you added.");
  }

  if (patch.text !== undefined) {
    const text = cleanText(patch.text, 300);
    if (!text) throw new ListsError("Give the item some text.", 400);
    item.text = text;
  }
  if (patch.priority !== undefined) item.priority = normalisePriority(patch.priority);
  if (patch.note !== undefined) item.note = cleanText(patch.note, 500) || undefined;
  if (patch.url !== undefined) item.url = cleanText(patch.url, 500) || undefined;
  if (patch.dueDate !== undefined) item.dueDate = normaliseDate(patch.dueDate);
  if (patch.listId !== undefined && data.lists.some((l) => l.id === patch.listId)) {
    item.listId = patch.listId;
  }
  if (patch.done !== undefined) {
    item.done = Boolean(patch.done);
    item.completedAt = item.done ? nowIso() : undefined;
  }
  item.updatedAt = nowIso();

  await writeFile(data);
  return getBoard(caller);
}

export async function deleteItem(caller: Caller, id: string): Promise<BoardPayload> {
  const data = await load();
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new ListsError("That item is gone.", 404);
  if (!caller.isAdmin && item.authorId !== caller.member.id) {
    throw new ListsError("You can only remove items you added.");
  }
  data.items = data.items.filter((i) => i.id !== id);
  await writeFile(data);
  return getBoard(caller);
}

/** Admin-only bulk tidy: clear every ticked item on a list right now. */
export async function clearDone(caller: Caller, listId: string): Promise<BoardPayload> {
  const data = await load();
  data.items = data.items.filter(
    (i) => !(i.listId === listId && i.done && (caller.isAdmin || i.authorId === caller.member.id)),
  );
  await writeFile(data);
  return getBoard(caller);
}

function normalisePriority(p: unknown): Priority {
  return p === "urgent" || p === "low" || p === "wish" ? p : null;
}

function normaliseDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

// ----- list definitions ----------------------------------------------------

export async function createList(
  caller: Caller,
  input: { name: string; icon: string },
): Promise<BoardPayload> {
  requireAdmin(caller);
  const data = await load();
  const name = cleanText(input.name, 40);
  if (!name) throw new ListsError("Give the list a name.", 400);

  data.lists.push({
    id: uid("lst"),
    name,
    icon: typeof input.icon === "string" && input.icon ? input.icon : "Note",
    builtIn: false,
    hidden: false,
    order: Math.max(-1, ...data.lists.map((l) => l.order)) + 1,
  });
  await writeFile(data);
  return getBoard(caller);
}

export async function updateList(
  caller: Caller,
  id: string,
  patch: Partial<Pick<ListDef, "name" | "icon" | "hidden">>,
): Promise<BoardPayload> {
  requireAdmin(caller);
  const data = await load();
  const list = data.lists.find((l) => l.id === id);
  if (!list) throw new ListsError("That list is gone.", 404);
  if (patch.name !== undefined) list.name = cleanText(patch.name, 40) || list.name;
  if (patch.icon !== undefined) list.icon = patch.icon;
  if (patch.hidden !== undefined) list.hidden = Boolean(patch.hidden);
  await writeFile(data);
  return getBoard(caller);
}

/**
 * Only custom lists can be deleted, and only when empty. A built-in is hidden
 * instead — hiding must never be a way to destroy items.
 */
export async function deleteList(caller: Caller, id: string): Promise<BoardPayload> {
  requireAdmin(caller);
  const data = await load();
  const list = data.lists.find((l) => l.id === id);
  if (!list) throw new ListsError("That list is gone.", 404);
  if (list.builtIn) throw new ListsError("Built-in lists can be hidden, not deleted.", 400);
  if (data.items.some((i) => i.listId === id)) {
    throw new ListsError("Empty the list first — deleting it would take its items with it.", 400);
  }
  data.lists = data.lists.filter((l) => l.id !== id);
  await writeFile(data);
  return getBoard(caller);
}

// ----- members and invites -------------------------------------------------

export async function createInvite(caller: Caller): Promise<{ board: BoardPayload; token: string }> {
  requireAdmin(caller);
  const data = await load();
  if (data.members.length >= MEMBER_COLOURS.length) {
    throw new ListsError("Every colour is taken — remove someone first.", 400);
  }
  const invite: Invite = {
    token: randomBytes(24).toString("hex"),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  };
  data.invites.push(invite);
  await writeFile(data);
  return { board: await getBoard(caller), token: invite.token };
}

export async function revokeInvite(caller: Caller, token: string): Promise<BoardPayload> {
  requireAdmin(caller);
  const data = await load();
  data.invites = data.invites.filter((v) => v.token !== token);
  await writeFile(data);
  return getBoard(caller);
}

export interface InviteCheck {
  valid: boolean;
  /** Colours nobody has taken yet — the signup picker only offers these. */
  freeColours: string[];
  /** Names already in use, so the form can reject a duplicate before submitting. */
  takenNames: string[];
}

/**
 * Never distinguishes "expired", "already used" and "never existed".
 * All three are the same answer to whoever is holding the link.
 */
export async function checkInvite(token: string): Promise<InviteCheck> {
  const data = await load();
  const invite = data.invites.find((v) => v.token === token && !v.consumedAt);
  const taken = new Set(data.members.map((m) => m.colour));
  return {
    valid: Boolean(invite) && Date.parse(invite!.expiresAt) > Date.now(),
    freeColours: MEMBER_COLOURS.filter((c) => !taken.has(c.id)).map((c) => c.id),
    takenNames: data.members.map((m) => m.name.toLowerCase()),
  };
}

export async function consumeInvite(input: {
  token: string;
  name: string;
  colour: string;
  password: string;
}): Promise<Member> {
  const data = await load();
  const invite = data.invites.find((v) => v.token === input.token && !v.consumedAt);
  if (!invite || Date.parse(invite.expiresAt) <= Date.now()) {
    throw new ListsError("This link is no longer valid. Ask for a new one.", 400);
  }
  const name = cleanText(input.name, 24);
  if (!name) throw new ListsError("Enter a name.", 400);
  if (data.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    throw new ListsError("Someone is already using that name.", 400);
  }
  if (typeof input.password !== "string" || input.password.length < 8) {
    throw new ListsError("Use at least 8 characters.", 400);
  }
  const taken = new Set(data.members.map((m) => m.colour));
  const colour = MEMBER_COLOURS.find((c) => c.id === input.colour && !taken.has(c.id))
    ?? MEMBER_COLOURS.find((c) => !taken.has(c.id));
  if (!colour) throw new ListsError("Every colour is taken.", 400);

  const { salt, hash } = await hashPassword(input.password);
  const member: Member = {
    id: uid("mem"),
    name,
    colour: colour.id,
    role: "member",
    salt,
    hash,
    joinedAt: nowIso(),
  };
  data.members.push(member);
  invite.consumedAt = nowIso();
  invite.memberId = member.id;
  await writeFile(data);
  return member;
}

/** Member sign-in by name + password. Returns null on any failure. */
export async function signIn(name: string, password: string): Promise<Member | null> {
  const data = await load();
  const member = data.members.find(
    (m) => m.id !== ADMIN_ID && m.name.toLowerCase() === String(name).trim().toLowerCase(),
  );
  if (!member) return null;
  return (await verifyPassword(password, member)) ? member : null;
}

/** Rename / recolour. Anyone may edit themselves; the admin may edit anyone. */
export async function updateMember(
  caller: Caller,
  id: string,
  patch: { name?: string; colour?: string },
): Promise<BoardPayload> {
  if (!caller.isAdmin && caller.member.id !== id) {
    throw new ListsError("You can only change your own profile.");
  }
  const data = await load();
  const member = data.members.find((m) => m.id === id);
  if (!member) throw new ListsError("No such member.", 404);

  if (patch.name !== undefined) {
    const name = cleanText(patch.name, 24);
    if (!name) throw new ListsError("Enter a name.", 400);
    if (data.members.some((m) => m.id !== id && m.name.toLowerCase() === name.toLowerCase())) {
      throw new ListsError("Someone is already using that name.", 400);
    }
    member.name = name;
  }
  if (patch.colour !== undefined) {
    const free = !data.members.some((m) => m.id !== id && m.colour === patch.colour);
    if (MEMBER_COLOURS.some((c) => c.id === patch.colour) && free) member.colour = patch.colour;
  }
  await writeFile(data);
  return getBoard(caller);
}

/**
 * Remove a member. `purge` decides what happens to what they added — deleting
 * it, or leaving it attributed to the removed-member placeholder. The admin row
 * can never be removed: it is the identity behind the app password.
 */
export async function removeMember(
  caller: Caller,
  id: string,
  purge: boolean,
): Promise<BoardPayload> {
  requireAdmin(caller);
  if (id === ADMIN_ID) throw new ListsError("The admin cannot be removed.", 400);
  const data = await load();
  if (!data.members.some((m) => m.id === id)) throw new ListsError("No such member.", 404);

  data.members = data.members.filter((m) => m.id !== id);
  if (purge) {
    data.items = data.items.filter((i) => i.authorId !== id);
  } else {
    for (const item of data.items) if (item.authorId === id) item.authorId = "removed";
  }
  await writeFile(data);
  return getBoard(caller);
}
