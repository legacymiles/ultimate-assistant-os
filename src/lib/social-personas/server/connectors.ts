// ---------------------------------------------------------------------------
// Official account connections: TikTok Login Kit + Display API, Instagram API
// with Instagram Login, and Facebook Pages via the Graph API.
//
// Each needs a developer app the owner registers with the platform (keys in
// .env.local). With no keys a platform reports `configured: false` and the UI
// falls back to adding the handle and importing posts by link — the app never
// 500s for a missing key.
//
// Tokens never reach the browser. They are stored server-side (server_docs, or
// .data/ locally) under `social-personas-conn:<connectionId>`, stamped with the
// hub_uid of whoever connected, and only that uid may sync with them.
// ---------------------------------------------------------------------------

import "server-only";

import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import type { Post, SocialPlatform } from "../types";

const GRAPH = "v23.0";

interface PlatformConfig {
  id: string;
  secret: string;
  envNames: [string, string];
  scopes: string;
  setupUrl: string;
}

export function config(p: SocialPlatform): PlatformConfig {
  if (p === "tiktok") {
    return {
      id: process.env.TIKTOK_CLIENT_KEY ?? "",
      secret: process.env.TIKTOK_CLIENT_SECRET ?? "",
      envNames: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
      scopes: "user.info.basic,user.info.profile,user.info.stats,video.list",
      setupUrl: "https://developers.tiktok.com/apps",
    };
  }
  if (p === "instagram") {
    return {
      id: process.env.INSTAGRAM_APP_ID ?? "",
      secret: process.env.INSTAGRAM_APP_SECRET ?? "",
      envNames: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
      scopes: "instagram_business_basic",
      setupUrl: "https://developers.facebook.com/apps",
    };
  }
  return {
    id: process.env.FACEBOOK_APP_ID ?? "",
    secret: process.env.FACEBOOK_APP_SECRET ?? "",
    envNames: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
    scopes: "pages_show_list,pages_read_engagement,pages_read_user_content",
    setupUrl: "https://developers.facebook.com/apps",
  };
}

export function isConfigured(p: SocialPlatform): boolean {
  const c = config(p);
  return Boolean(c.id && c.secret);
}

export function redirectUri(origin: string, p: SocialPlatform): string {
  return `${origin}/api/social-personas/oauth/${p}/callback`;
}

export function authorizeUrl(p: SocialPlatform, origin: string, state: string): string {
  const c = config(p);
  const redirect = redirectUri(origin, p);
  if (p === "tiktok") {
    const q = new URLSearchParams({ client_key: c.id, scope: c.scopes, response_type: "code", redirect_uri: redirect, state });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  }
  if (p === "instagram") {
    const q = new URLSearchParams({ client_id: c.id, redirect_uri: redirect, response_type: "code", scope: c.scopes, state });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  }
  const q = new URLSearchParams({ client_id: c.id, redirect_uri: redirect, response_type: "code", scope: c.scopes, state });
  return `https://www.facebook.com/${GRAPH}/dialog/oauth?${q}`;
}

// --- stored connections ------------------------------------------------------

export interface Connection {
  id: string;
  platform: SocialPlatform;
  ownerUid: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  /** TikTok open_id / IG user id / FB page id. */
  accountId?: string;
  /** Facebook: every page the login can read, each with its own token. */
  pages?: { id: string; name: string; token: string }[];
  createdAt: string;
}

const dir = () => process.env.SOCIAL_PERSONAS_DATA_DIR || path.resolve(".data");
const docName = (id: string) => `social-personas-conn:${id.replace(/[^a-z0-9_]/gi, "")}`;

export async function loadConnection(id: string): Promise<Connection | null> {
  return readDoc<Connection>(docName(id), dir());
}

export async function saveConnection(c: Connection): Promise<boolean> {
  return writeDoc(docName(c.id), dir(), c);
}

export async function deleteConnection(id: string): Promise<boolean> {
  return writeDoc(docName(id), dir(), null);
}

// --- code exchange -----------------------------------------------------------

async function json(res: Response, what: string): Promise<any> {
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* fall through */
  }
  if (!res.ok || body?.error) {
    const msg = body?.error?.message || body?.error_description || body?.error_message || (typeof body?.error === "string" ? body.error : "") || text.slice(0, 200);
    throw new Error(`${what} failed (${res.status}): ${msg}`);
  }
  return body;
}

const form = (o: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(o).toString(),
});

export async function exchangeCode(
  p: SocialPlatform,
  code: string,
  origin: string,
): Promise<Omit<Connection, "id" | "ownerUid" | "createdAt">> {
  const c = config(p);
  const redirect = redirectUri(origin, p);

  if (p === "tiktok") {
    const t = await json(
      await fetch(
        "https://open.tiktokapis.com/v2/oauth/token/",
        form({ client_key: c.id, client_secret: c.secret, code, grant_type: "authorization_code", redirect_uri: redirect }),
      ),
      "TikTok token exchange",
    );
    return {
      platform: p,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + (Number(t.expires_in) || 86_400) * 1000,
      accountId: t.open_id,
    };
  }

  if (p === "instagram") {
    const short = await json(
      await fetch(
        "https://api.instagram.com/oauth/access_token",
        form({ client_id: c.id, client_secret: c.secret, grant_type: "authorization_code", redirect_uri: redirect, code }),
      ),
      "Instagram token exchange",
    );
    // Short-lived tokens last an hour; swap for the 60-day one straight away.
    const long = await json(
      await fetch(
        `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: c.secret, access_token: short.access_token })}`,
      ),
      "Instagram long-lived token",
    ).catch(() => null);
    return {
      platform: p,
      accessToken: long?.access_token ?? short.access_token,
      expiresAt: Date.now() + (Number(long?.expires_in) || 3600) * 1000,
      accountId: String(short.user_id ?? ""),
    };
  }

  const t = await json(
    await fetch(
      `https://graph.facebook.com/${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: c.id, client_secret: c.secret, redirect_uri: redirect, code })}`,
    ),
    "Facebook token exchange",
  );
  const pages = await json(
    await fetch(`https://graph.facebook.com/${GRAPH}/me/accounts?${new URLSearchParams({ fields: "id,name,access_token", access_token: t.access_token })}`),
    "Facebook pages",
  );
  const list = (pages?.data ?? []).map((x: any) => ({ id: String(x.id), name: String(x.name ?? ""), token: String(x.access_token ?? "") }));
  return {
    platform: p,
    accessToken: t.access_token,
    expiresAt: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : undefined,
    accountId: list[0]?.id,
    pages: list,
  };
}

// --- reading the account ------------------------------------------------------

export interface SyncResult {
  handle: string;
  displayName: string;
  url: string;
  followers: number | null;
  posts: Post[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null);

async function refreshTikTok(conn: Connection): Promise<Connection> {
  if (!conn.refreshToken || !conn.expiresAt || conn.expiresAt - Date.now() > 5 * 60_000) return conn;
  const c = config("tiktok");
  const t = await json(
    await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      form({ client_key: c.id, client_secret: c.secret, grant_type: "refresh_token", refresh_token: conn.refreshToken }),
    ),
    "TikTok token refresh",
  );
  const next = {
    ...conn,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? conn.refreshToken,
    expiresAt: Date.now() + (Number(t.expires_in) || 86_400) * 1000,
  };
  await saveConnection(next);
  return next;
}

export async function syncConnection(input: Connection, max = 60): Promise<SyncResult> {
  const now = new Date().toISOString();

  if (input.platform === "tiktok") {
    const conn = await refreshTikTok(input);
    const auth = { Authorization: `Bearer ${conn.accessToken}` };
    const me = await json(
      await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,follower_count,profile_deep_link", { headers: auth }),
      "TikTok profile",
    );
    const u = me?.data?.user ?? {};
    const posts: Post[] = [];
    let cursor: number | undefined;
    for (let page = 0; page < 4 && posts.length < max; page++) {
      const res = await json(
        await fetch(
          "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,cover_image_url,share_url,create_time,view_count,like_count,comment_count,share_count",
          { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) },
        ),
        "TikTok videos",
      );
      for (const v of res?.data?.videos ?? []) {
        posts.push({
          id: `tt_${v.id}`,
          externalId: `tiktok:${v.id}`,
          platform: "tiktok",
          url: v.share_url || (u.username ? `https://www.tiktok.com/@${u.username}/video/${v.id}` : ""),
          caption: [v.title, v.video_description].filter(Boolean).join("\n").trim(),
          thumbnail: v.cover_image_url ?? null,
          postedAt: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
          addedAt: now,
          stats: { views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) },
          source: "sync",
        });
      }
      if (!res?.data?.has_more) break;
      cursor = res.data.cursor;
    }
    const handle = String(u.username ?? "");
    return {
      handle,
      displayName: String(u.display_name ?? handle),
      url: handle ? `https://www.tiktok.com/@${handle}` : String(u.profile_deep_link ?? ""),
      followers: num(u.follower_count),
      posts: posts.slice(0, max),
    };
  }

  if (input.platform === "instagram") {
    const tok = input.accessToken;
    const me = await json(
      await fetch(`https://graph.instagram.com/${GRAPH}/me?${new URLSearchParams({ fields: "user_id,username,name,followers_count", access_token: tok })}`),
      "Instagram profile",
    );
    const posts: Post[] = [];
    let next: string | null = `https://graph.instagram.com/${GRAPH}/me/media?${new URLSearchParams({
      fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
      limit: "25",
      access_token: tok,
    })}`;
    for (let page = 0; next && page < 4 && posts.length < max; page++) {
      const res: any = await json(await fetch(next), "Instagram media");
      for (const m of res?.data ?? []) {
        posts.push({
          id: `ig_${m.id}`,
          externalId: `instagram:${m.id}`,
          platform: "instagram",
          url: m.permalink ?? "",
          caption: m.caption ?? "",
          thumbnail: m.thumbnail_url ?? (m.media_type === "IMAGE" ? m.media_url : null) ?? null,
          postedAt: m.timestamp ?? null,
          addedAt: now,
          format: m.media_product_type === "REELS" ? "reel" : String(m.media_type ?? "").toLowerCase().replace("_", " "),
          stats: { likes: num(m.like_count), comments: num(m.comments_count) },
          source: "sync",
        });
      }
      next = res?.paging?.next ?? null;
    }
    const handle = String(me.username ?? "");
    return {
      handle,
      displayName: String(me.name ?? handle),
      url: handle ? `https://www.instagram.com/${handle}/` : "",
      followers: num(me.followers_count),
      posts: posts.slice(0, max),
    };
  }

  // Facebook: the first page the login granted (or the one chosen earlier).
  const page = input.pages?.find((p) => p.id === input.accountId) ?? input.pages?.[0];
  if (!page) throw new Error("That Facebook login doesn't manage any Pages. Personal profiles can't be read by apps — connect a Page.");
  const info = await json(
    await fetch(`https://graph.facebook.com/${GRAPH}/${page.id}?${new URLSearchParams({ fields: "name,username,link,followers_count", access_token: page.token })}`),
    "Facebook page",
  ).catch(() => ({}));
  const res = await json(
    await fetch(
      `https://graph.facebook.com/${GRAPH}/${page.id}/posts?${new URLSearchParams({
        fields: "id,message,created_time,permalink_url,full_picture,shares,reactions.summary(total_count),comments.summary(total_count)",
        limit: String(Math.min(max, 50)),
        access_token: page.token,
      })}`,
    ),
    "Facebook posts",
  );
  const posts: Post[] = (res?.data ?? []).map((m: any) => ({
    id: `fb_${m.id}`,
    externalId: `facebook:${m.id}`,
    platform: "facebook" as const,
    url: m.permalink_url ?? "",
    caption: m.message ?? "",
    thumbnail: m.full_picture ?? null,
    postedAt: m.created_time ?? null,
    addedAt: now,
    stats: { likes: num(m.reactions?.summary?.total_count), comments: num(m.comments?.summary?.total_count), shares: num(m.shares?.count) },
    source: "sync" as const,
  }));
  return {
    handle: String(info.username ?? page.name),
    displayName: page.name,
    url: String(info.link ?? `https://www.facebook.com/${page.id}`),
    followers: num(info.followers_count),
    posts,
  };
}
