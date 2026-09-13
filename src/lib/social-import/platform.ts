// ---------------------------------------------------------------------------
// Which network a pasted link belongs to.
//
// People paste whatever the share sheet hands them — "Check this out!
// https://vm.tiktok.com/ZM…/ 😋", a bare "instagram.com/reel/…", a YouTube
// Shorts link — so the first job is digging one real URL out of that text.
//
// Pure, no Node APIs: the create-recipe form imports this to label the link
// as the user types, and the server imports it to pick a resolver.
// ---------------------------------------------------------------------------

export type Platform = "tiktok" | "instagram" | "facebook" | "youtube" | "x" | "pinterest" | "web";

const HOSTS: [Exclude<Platform, "web">, RegExp][] = [
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["instagram", /(^|\.)(instagram\.com|instagr\.am)$/],
  ["facebook", /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/],
  ["youtube", /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
  ["x", /(^|\.)(x\.com|twitter\.com)$/],
  ["pinterest", /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/],
];

export const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  x: "X",
  pinterest: "Pinterest",
  web: "Web page",
};

/** The first URL in a blob of share text, or null. */
export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0].replace(/[),.!?]+$/, "");
  // A scheme-less paste like "instagram.com/reel/abc/".
  const bare = text.trim().match(/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*$/i);
  return bare ? `https://${bare[0]}` : null;
}

export function parseLink(text: string): { url: URL; platform: Platform } | null {
  const raw = firstUrl(text);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const platform = HOSTS.find(([, re]) => re.test(host))?.[0] ?? "web";
  return { url, platform };
}

export function isSocialHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return HOSTS.some(([, re]) => re.test(host));
}

/** The 11-character id from any YouTube link shape (watch, youtu.be, shorts, embed). */
export function youTubeId(url: URL): string | null {
  const valid = (id: string) => (/^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host === "youtu.be") return valid(url.pathname.slice(1, 12));
  const v = url.searchParams.get("v");
  if (v) return valid(v);
  const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
  return m ? valid(m[1]) : null;
}
