"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

// Shared data helpers for the social features (Discover, Leaderboards, Profiles).
// Everything fetches whole tables and aggregates in JS — fine for this scale and
// works identically against the local demo client and real Supabase.

export interface Profile {
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio?: string | null;
}

export async function loadProfiles(sb: SupabaseClient): Promise<Map<string, Profile>> {
  const { data } = await sb.from("profiles").select("*");
  const map = new Map<string, Profile>();
  (data || []).forEach((p: any) => map.set(p.user_id, p));
  return map;
}

export async function loadStarCounts(sb: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await sb.from("cookbook_stars").select("*");
  const map = new Map<string, number>();
  (data || []).forEach((s: any) => map.set(s.cookbook_id, (map.get(s.cookbook_id) || 0) + 1));
  return map;
}

export async function loadShareCounts(sb: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await sb.from("cookbook_shares").select("*");
  const map = new Map<string, number>();
  (data || []).forEach((s: any) => map.set(s.cookbook_id, (map.get(s.cookbook_id) || 0) + 1));
  return map;
}

export async function loadUserStars(sb: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data } = await sb.from("cookbook_stars").select("*").eq("user_id", userId);
  return new Set((data || []).map((s: any) => s.cookbook_id));
}

/** Cover image + recipe count per cookbook (lowest-position recipe with an image). */
export async function loadCookbookMeta(sb: SupabaseClient): Promise<Map<string, { cover: string | null; count: number }>> {
  const { data } = await sb.from("recipes").select("*");
  const byCb = new Map<string, any[]>();
  (data || []).forEach((r: any) => {
    const arr = byCb.get(r.cookbook_id) || [];
    arr.push(r);
    byCb.set(r.cookbook_id, arr);
  });
  const map = new Map<string, { cover: string | null; count: number }>();
  byCb.forEach((arr, cbId) => {
    const withImg = arr.filter((r) => r.image_url).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    map.set(cbId, { cover: withImg[0]?.image_url ?? null, count: arr.length });
  });
  return map;
}

export async function toggleStar(sb: SupabaseClient, cookbookId: string, userId: string, currentlyStarred: boolean) {
  if (currentlyStarred) {
    await sb.from("cookbook_stars").delete().eq("cookbook_id", cookbookId).eq("user_id", userId);
  } else {
    await sb.from("cookbook_stars").insert({ cookbook_id: cookbookId, user_id: userId });
  }
}

export async function toggleFollow(sb: SupabaseClient, followerId: string, followingId: string, currentlyFollowing: boolean) {
  if (currentlyFollowing) {
    await sb.from("follows").delete().eq("follower_id", followerId).eq("following_id", followingId);
  } else {
    await sb.from("follows").insert({ follower_id: followerId, following_id: followingId });
  }
}
