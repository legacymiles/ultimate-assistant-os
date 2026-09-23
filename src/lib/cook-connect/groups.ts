"use client";

// Groups: the interest communities Pod Play Connect had, brought across with
// a cooking slant. A group is a name, a colour, the people in it, and a
// conversation.
//
// Member counts are derived from the membership rows on every read rather
// than stored on the group. Pod Play kept a member_count column and adjusted
// it client-side, which drifts the moment a join fails halfway through.

import type { Group, GroupMember, GroupSummary } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

/** Suggestions offered on an empty Groups tab, so the first one is one tap. */
export const STARTER_GROUPS: { name: string; description: string; hue: number }[] = [
  { name: "Weeknight Dinners", description: "Fast, repeatable, on the table by seven.", hue: 24 },
  { name: "Low and Slow", description: "Braises, stews and anything that takes all afternoon.", hue: 8 },
  { name: "Baking", description: "Bread, pastry, and arguing about hydration.", hue: 40 },
  { name: "Spice Heads", description: "If it doesn't make you sweat a little, add more.", hue: 350 },
  { name: "Vegetarian", description: "Vegetables as the main event, not the side.", hue: 140 },
  { name: "Spades Night", description: "Cook something, then take somebody's money at cards.", hue: 265 },
];

/** Every active group, with this user's membership resolved. */
export async function loadGroups(sb: Backend, userId: string | null): Promise<GroupSummary[]> {
  const [{ data: groupRows }, { data: memberRows }] = await Promise.all([
    sb.from("groups").select("*").eq("is_active", true).order("created_at", { ascending: false }),
    sb.from("group_members").select("*"),
  ]);

  const groups = (groupRows ?? []) as Group[];
  const members = (memberRows ?? []) as GroupMember[];

  const counts: Record<string, number> = {};
  const mine = new Set<string>();
  for (const m of members) {
    counts[m.group_id] = (counts[m.group_id] ?? 0) + 1;
    if (userId && m.user_id === userId) mine.add(m.group_id);
  }

  return groups
    .map((g) => ({ ...g, members: counts[g.id] ?? 0, joined: mine.has(g.id) }))
    // Busiest first, then newest — an empty group should not head the list.
    .sort((a, b) => b.members - a.members || b.created_at.localeCompare(a.created_at));
}

export async function loadGroup(sb: Backend, groupId: string, userId: string | null) {
  const [{ data: groupRow }, { data: memberRows }] = await Promise.all([
    sb.from("groups").select("*").eq("id", groupId).maybeSingle(),
    sb.from("group_members").select("*").eq("group_id", groupId),
  ]);
  const members = (memberRows ?? []) as GroupMember[];
  const group = groupRow as Group | null;
  return {
    group,
    members,
    joined: !!userId && members.some((m) => m.user_id === userId),
  };
}

export async function createGroup(
  sb: Backend,
  userId: string,
  entry: { name: string; description?: string; hue?: number },
): Promise<{ group: Group | null; error: { message: string } | null }> {
  // The id is made here rather than returned by the insert: a SELECT policy
  // that re-reads the table cannot see the row inside INSERT ... RETURNING.
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `grp-${Date.now()}`;

  const { error } = await sb.from("groups").insert({
    id,
    name: entry.name.trim(),
    description: entry.description?.trim() || null,
    hue: entry.hue ?? hueFor(entry.name),
    created_by: userId,
    is_active: true,
  });
  if (error) return { group: null, error };

  // Whoever starts a group is in it. joined_at is set here rather than left
  // to the column default, because the in-browser backend has no defaults.
  await sb.from("group_members").insert({
    group_id: id, user_id: userId, joined_at: new Date().toISOString(),
  });

  const { data } = await sb.from("groups").select("*").eq("id", id).maybeSingle();
  return { group: (data as Group) ?? null, error: null };
}

export async function joinGroup(sb: Backend, groupId: string, userId: string) {
  const { error } = await sb.from("group_members").insert({
    group_id: groupId, user_id: userId, joined_at: new Date().toISOString(),
  });
  // 23505 is the unique constraint: already a member, which is not a failure.
  return error && error.code !== "23505" ? error : null;
}

export async function leaveGroup(sb: Backend, groupId: string, userId: string) {
  await sb.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
}

/** A stable colour from the name, so a group looks the same to everybody. */
export function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}
