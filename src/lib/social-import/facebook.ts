// ---------------------------------------------------------------------------
// Facebook, the hard one — getting a public reel's video without a login.
//
// Why links failed before:
//   1. Share links (facebook.com/share/r/<code>, /share/v/…, fb.watch/…) are
//      what the iPhone share sheet hands out. They are a redirect, and to a
//      logged-out visitor the redirect often lands on the login page — which
//      yt-dlp reads as "this video needs a login" even when the reel itself is
//      public. So the share link is first turned into the real address
//      (facebook.com/reel/<id>), digging it out of the login page's `next=`
//      when that is where it went.
//   2. Facebook serves different pages to different visitors. The embed
//      player (plugins/video.php), the desktop page and the mobile page each
//      sometimes carry the video when the others don't, and Facebook's own
//      link-preview crawler is shown og:video. So several are tried, and the
//      first real video URL in any of them wins.
//
// When the owner has connected Facebook (the Record extension or a pasted
// cookies.txt — see cookieStore.ts), those cookies ride along on these page
// fetches too, which unlocks the videos that truly are login-only.
//
// The pure parts (link shapes, pulling video URLs out of a page, turning a
// cookies.txt into a Cookie header) are exported and tested.
// ---------------------------------------------------------------------------

import { metaTags } from "./jsonld";
import { safeFetch, fetchText } from "./safeFetch";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
/** Facebook's own link-preview crawler; public posts show it their og:video. */
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/** A share-sheet link that has to be followed to find the real post. */
export function isFacebookShareLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === "fb.watch" || host.endsWith(".fb.watch")) return true;
  return /^\/share\/(?:r|v|p|[a-z])\//i.test(url.pathname) || /^\/share\/[A-Za-z0-9]+\/?$/.test(url.pathname);
}

/** The numeric video / reel id in any Facebook post address, or null. */
export function facebookVideoId(url: URL): string | null {
  const v = url.searchParams.get("v");
  if (v && /^\d{5,}$/.test(v)) return v;
  const m =
    url.pathname.match(/\/(?:reel|reels|videos|watch)\/(?:[^/]+\/)?(\d{5,})/i) ??
    url.pathname.match(/\/videos\/(?:vb\.\d+\/)?(\d{5,})/i);
  return m?.[1] ?? null;
}

/**
 * Where a redirect really meant to go. A logged-out visitor is often sent to
 * facebook.com/login/?next=<the reel>; the reel is in `next`.
 */
export function unwrapLoginRedirect(url: URL): URL {
  const next = url.searchParams.get("next");
  if (/\/login|checkpoint/i.test(url.pathname) && next) {
    try {
      const inner = new URL(next, "https://www.facebook.com");
      if (/(^|\.)facebook\.com$/i.test(inner.hostname)) return inner;
    } catch {
      // Not a URL — keep what we had.
    }
  }
  return url;
}

/** facebook.com/reel/<id> for anything that names a video id; otherwise the link, tidied. */
export function canonicalFacebookUrl(url: URL): URL {
  const real = unwrapLoginRedirect(url);
  const id = facebookVideoId(real);
  if (id) return new URL(/\/reels?\//i.test(real.pathname) ? `https://www.facebook.com/reel/${id}` : `https://www.facebook.com/watch/?v=${id}`);
  const out = new URL(real.href);
  for (const k of [...out.searchParams.keys()]) if (/^(mibextid|rdid|share_url|__|fs|s$|sfnsn)/i.test(k)) out.searchParams.delete(k);
  return out;
}

/** Undo the JSON string escaping Facebook wraps its URLs in (\/, %, &amp;). */
function unescapeUrl(raw: string): string {
  let s = raw;
  try {
    s = JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    s = raw.replace(/\\\//g, "/");
  }
  return s.replace(/&amp;/g, "&");
}

/**
 * Every direct video URL in a Facebook page, best first: HD before SD, the
 * newer field names before the old ones, og:video last.
 */
export function extractFacebookVideoUrls(html: string): string[] {
  const keys = [
    "browser_native_hd_url",
    "playable_url_quality_hd",
    "hd_src_no_ratelimit",
    "hd_src",
    "progressive_url",
    "browser_native_sd_url",
    "playable_url",
    "sd_src_no_ratelimit",
    "sd_src",
  ];
  const found: string[] = [];
  for (const key of keys) {
    const re = new RegExp(`["']?${key}["']?\\s*:\\s*"((?:https?:)?(?:\\\\/|/)(?:\\\\/|/)[^"]+)"`, "g");
    for (const m of html.matchAll(re)) found.push(unescapeUrl(m[1]));
  }
  const meta = metaTags(html);
  for (const k of ["og:video:secure_url", "og:video:url", "og:video"]) if (meta[k]) found.push(meta[k].replace(/&amp;/g, "&"));
  return [...new Set(found.filter((u) => /^https:\/\/[^/]*(fbcdn\.net|facebook\.com)\//i.test(u)))];
}

/** The caption Facebook shows for the post, when the page carries one. */
export function facebookCaption(html: string): { title: string; caption: string; thumbnailUrl: string | null } {
  const meta = metaTags(html);
  return {
    title: meta["og:title"] ?? "",
    caption: meta["og:description"] ?? meta["description"] ?? "",
    thumbnailUrl: meta["og:image"] ?? null,
  };
}

/**
 * A Cookie header for one host out of a Netscape cookies.txt — only the
 * cookies whose domain covers that host, never the rest of the file.
 */
export function cookieHeader(cookiesTxt: string | null, host: string): string | null {
  if (!cookiesTxt) return null;
  const h = host.toLowerCase();
  const nowSec = Date.now() / 1000;
  const pairs: string[] = [];
  for (const raw of cookiesTxt.split(/\r?\n/)) {
    const line = raw.startsWith("#HttpOnly_") ? raw.slice("#HttpOnly_".length) : raw;
    if (!line.trim() || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [domain, , , , expires, name, value] = parts;
    const d = domain.toLowerCase().replace(/^\./, "");
    if (!(h === d || h.endsWith(`.${d}`))) continue;
    const exp = Number(expires);
    if (exp > 0 && exp < nowSec) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.length ? pairs.join("; ") : null;
}

/** Follow a share link to the post it points at. Null when it can't be followed. */
export async function resolveFacebookShare(url: URL, cookies: string | null): Promise<URL | null> {
  for (const ua of [DESKTOP_UA, CRAWLER_UA, MOBILE_UA]) {
    try {
      const headers: Record<string, string> = { "user-agent": ua };
      const c = cookieHeader(cookies, "www.facebook.com");
      if (c) headers.cookie = c;
      const res = await safeFetch(url, { timeoutMs: 12_000, accept: "text/html", headers });
      await res.body?.cancel().catch(() => undefined);
      const landed = canonicalFacebookUrl(new URL(res.url || url.href));
      if (facebookVideoId(landed)) return landed;
    } catch {
      // Try the next visitor type.
    }
  }
  return null;
}

export interface FacebookFind {
  videoUrl: string;
  pageUrl: string;
  title: string;
  caption: string;
  thumbnailUrl: string | null;
}

/** The pages worth reading for one post, in the order most likely to carry the video. */
export function facebookPagesToTry(post: URL): { url: string; ua: string }[] {
  const id = facebookVideoId(post);
  const href = post.href;
  const pages: { url: string; ua: string }[] = [
    { url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&width=560`, ua: DESKTOP_UA },
    { url: href, ua: DESKTOP_UA },
    { url: href, ua: CRAWLER_UA },
  ];
  if (id) {
    pages.push({ url: `https://m.facebook.com/watch/?v=${id}`, ua: MOBILE_UA });
    pages.push({
      url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(`https://www.facebook.com/watch/?v=${id}`)}&show_text=false`,
      ua: DESKTOP_UA,
    });
  }
  return pages;
}

/** The first direct video URL any version of the post's page gives up. */
export async function findFacebookVideo(post: URL, cookies: string | null): Promise<FacebookFind | null> {
  let caption: Omit<FacebookFind, "videoUrl" | "pageUrl"> = { title: "", caption: "", thumbnailUrl: null };
  for (const page of facebookPagesToTry(post)) {
    const host = new URL(page.url).hostname;
    const headers: Record<string, string> = { "user-agent": page.ua, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
    const c = cookieHeader(cookies, host);
    if (c) headers.cookie = c;
    const html = await fetchText(page.url, 6_000_000, headers);
    if (!html) continue;
    const info = facebookCaption(html);
    if (!caption.caption && info.caption) caption = info;
    const [videoUrl] = extractFacebookVideoUrls(html);
    if (videoUrl) return { videoUrl, pageUrl: page.url, ...(caption.caption ? caption : info) };
  }
  return null;
}
