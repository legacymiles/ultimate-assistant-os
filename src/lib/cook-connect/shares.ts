"use client";

// Sharing a cookbook, which is a different thing from saving one. Saving is
// public and moves the leaderboard; sharing hands one named person a link to
// a cookbook that may be private.

import type { Cookbook, CookbookShare } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

function token(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface NewShare {
  cookbook: Cookbook;
  email?: string;
  accessLevel?: "view" | "copy";
  /** Days until the link stops working. Omit for a link that never expires. */
  expiresInDays?: number;
}

export async function createShare(sb: Backend, userId: string, opts: NewShare) {
  const expires = opts.expiresInDays
    ? new Date(Date.now() + opts.expiresInDays * 86_400_000).toISOString()
    : null;
  const { data, error } = await sb.from("cookbook_shares").insert({
    cookbook_id: opts.cookbook.id,
    shared_by: userId,
    shared_with_email: opts.email?.trim() || null,
    share_link_token: token(),
    access_level: opts.accessLevel ?? "view",
    expires_at: expires,
  }).select("*").single();
  return { share: data as CookbookShare | null, error };
}

export async function loadSharesFor(sb: Backend, cookbookId: string): Promise<CookbookShare[]> {
  const { data } = await sb.from("cookbook_shares").select("*")
    .eq("cookbook_id", cookbookId).order("created_at", { ascending: false });
  return (data ?? []) as CookbookShare[];
}

export async function revokeShare(sb: Backend, shareId: string) {
  await sb.from("cookbook_shares").delete().eq("id", shareId);
}

/** Cookbooks somebody has shared with this user. */
export async function loadSharedWithMe(sb: Backend, userId: string) {
  const { data } = await sb.from("cookbook_shares").select("*").eq("shared_with_user_id", userId);
  const shares = (data ?? []) as CookbookShare[];
  if (!shares.length) return { shares, cookbooks: [] as Cookbook[] };
  const { data: books } = await sb.from("cookbooks").select("*")
    .in("id", shares.map((s) => s.cookbook_id));
  return { shares, cookbooks: (books ?? []) as Cookbook[] };
}

/**
 * Claim a share link. Against Supabase this is a security-definer function so
 * that holding a token never means being able to read the share table; the
 * local backend reimplements the same contract, including the part that
 * matters — a link belongs to whoever claims it first.
 */
export async function redeemShare(sb: Backend, userId: string, shareToken: string): Promise<string | null> {
  if (!sb.__local) {
    const { data } = await sb.rpc("redeem_cookbook_share", { _token: shareToken });
    return (data as string | null) ?? null;
  }

  const { data } = await sb.from("cookbook_shares").select("*")
    .eq("share_link_token", shareToken).maybeSingle();
  const share = data as CookbookShare | null;
  if (!share) return null;
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) return null;

  if (!share.shared_with_user_id) {
    await sb.from("cookbook_shares").update({ shared_with_user_id: userId }).eq("id", share.id);
    return share.cookbook_id;
  }
  return share.shared_with_user_id === userId ? share.cookbook_id : null;
}

/** The link to hand someone. Absolute, so it survives being pasted anywhere. */
export function shareUrl(shareToken: string): string {
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}/apps/cook-connect?share=${shareToken}`;
}
