// ---------------------------------------------------------------------------
// A logged-in browser session for the sites that hide videos from strangers,
// saved from inside the app instead of the hosting dashboard.
//
// Facebook and Instagram show many videos only to logged-in accounts. yt-dlp
// can fetch those when it is handed that account's cookies. That used to mean
// exporting a cookies.txt and pasting it into Vercel as YTDLP_COOKIES_<SITE>
// and redeploying — a dead end for anyone but a developer. Now the owner
// connects the site once (the Jarvis Record extension sends the cookies with
// one click, or a cookies.txt is pasted into Cook Connect) and every import
// after that uses it. Env vars still win when set.
//
// Kept in server_docs (RLS on, no policy, service role only). The cookies
// never go back to a browser — the status call only says whether a site is
// connected, since when, and how many cookies came with it.
// ---------------------------------------------------------------------------

import "server-only";

import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import type { Platform } from "./platform";

const DOC = "social-import-cookies";
const dir = () => process.env.SOCIAL_IMPORT_DATA_DIR || path.resolve(".data");

/** The sites a saved session helps with. */
export const COOKIE_SITES = ["facebook", "instagram"] as const;
export type CookieSite = (typeof COOKIE_SITES)[number];

export function isCookieSite(p: string): p is CookieSite {
  return (COOKIE_SITES as readonly string[]).includes(p);
}

interface Saved {
  /** Netscape cookies.txt text, ready for yt-dlp. */
  cookies: string;
  count: number;
  updatedAt: string;
  via: "extension" | "paste";
}
type CookieDoc = Partial<Record<CookieSite, Saved>>;

let cache: { at: number; doc: CookieDoc } | null = null;

async function load(): Promise<CookieDoc> {
  if (cache && Date.now() - cache.at < 30_000) return cache.doc;
  const doc = (await readDoc<CookieDoc>(DOC, dir())) ?? {};
  cache = { at: Date.now(), doc };
  return doc;
}

export async function savedCookies(platform: Platform): Promise<string | null> {
  if (!isCookieSite(platform)) return null;
  return (await load())[platform]?.cookies ?? null;
}

export async function saveCookies(site: CookieSite, cookies: string, count: number, via: Saved["via"]): Promise<boolean> {
  const doc = { ...(await load()), [site]: { cookies, count, via, updatedAt: new Date().toISOString() } };
  const ok = await writeDoc(DOC, dir(), doc);
  if (ok) cache = { at: Date.now(), doc };
  return ok;
}

export async function clearCookies(site: CookieSite): Promise<boolean> {
  const { [site]: _gone, ...rest } = await load();
  const ok = await writeDoc(DOC, dir(), rest);
  if (ok) cache = { at: Date.now(), doc: rest };
  return ok;
}

export interface CookieStatus {
  site: CookieSite;
  connected: boolean;
  /** Set in the hosting dashboard (YTDLP_COOKIES_<SITE>) rather than here. */
  fromEnv: boolean;
  updatedAt: string | null;
  via: Saved["via"] | null;
}

export async function cookieStatus(): Promise<CookieStatus[]> {
  const doc = await load();
  return COOKIE_SITES.map((site) => {
    const name = `YTDLP_COOKIES_${site.toUpperCase()}`;
    const fromEnv = Boolean(process.env[name]?.trim() || process.env[`${name}_FILE`]);
    const saved = doc[site];
    return { site, connected: fromEnv || Boolean(saved), fromEnv, updatedAt: saved?.updatedAt ?? null, via: saved?.via ?? null };
  });
}
