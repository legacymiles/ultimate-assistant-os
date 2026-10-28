"use client";

// Your data, yours to take or remove: one-tap export as a JSON file, and
// deleting your Cook Connect profile with everything in it.

import { readPersonal } from "./personal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

const MINE: { table: string; col: string }[] = [
  { table: "cookbooks", col: "owner_id" },
  { table: "recipes", col: "author_id" },
  { table: "cookbook_saves", col: "user_id" },
  { table: "favorite_cities", col: "user_id" },
  { table: "favorite_restaurants", col: "user_id" },
  { table: "favorite_dishes", col: "user_id" },
  { table: "messages", col: "user_id" },
  { table: "activity", col: "actor_id" },
  { table: "group_members", col: "user_id" },
];

/** Everything Cook Connect holds about you, as one object. */
export async function collectMyData(sb: Backend, userId: string) {
  const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
  const { data: profile } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  out.profile = profile ?? null;
  for (const { table, col } of MINE) {
    const { data } = await sb.from(table).select("*").eq(col, userId);
    out[table] = data ?? [];
  }
  const { data: follows } = await sb.from("follows").select("*");
  const rows = (follows ?? []) as { follower_id: string; following_id: string }[];
  out.following = rows.filter((r) => r.follower_id === userId).map((r) => r.following_id);
  out.followers = rows.filter((r) => r.following_id === userId).map((r) => r.follower_id);
  const personal = readPersonal(userId);
  out.my_ranks = personal.ranks;
  out.settings = personal.settings;
  return out;
}

/** Save it as a file on this device. */
export async function downloadMyData(sb: Backend, userId: string, handle: string) {
  const data = await collectMyData(sb, userId);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cook-connect-${handle}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Delete your Cook Connect profile and everything in it. On the real database
 * the server does it (profiles cascade); in demo mode the rows are removed here.
 * Returns a plain-English error, or null when it worked.
 */
export async function deleteMyProfile(sb: Backend, userId: string, isLocal: boolean): Promise<string | null> {
  if (isLocal) {
    for (const { table, col } of MINE) await sb.from(table).delete().eq(col, userId);
    await sb.from("follows").delete().eq("follower_id", userId);
    await sb.from("follows").delete().eq("following_id", userId);
    await sb.from("profiles").delete().eq("id", userId);
    return null;
  }
  try {
    const res = await fetch("/api/cook-connect/account", { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) return body.error ?? "That didn't go through. Try again in a minute.";
    return null;
  } catch {
    return "You look offline. Try again when you're back on the internet.";
  }
}
