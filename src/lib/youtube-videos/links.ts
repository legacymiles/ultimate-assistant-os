// ---------------------------------------------------------------------------
// YouTube videos — reading a pasted link. Pure, no network, fully tested.
//
// People paste whatever their phone's Share button gave them: a youtu.be
// short link with ?si= tracking, a Shorts URL, a TikTok video, an Instagram
// reel with ?igsh=, an X post, sometimes three links and a sentence at once.
// This turns any of that into one tidy record per video, with a `key` that
// is the same for every spelling of the same video — that key is how the app
// keeps one copy of each video (checklist: no duplicates).
// ---------------------------------------------------------------------------

export type Platform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "facebook"
  | "x"
  | "vimeo"
  | "twitch"
  | "reddit"
  | "snapchat"
  | "pinterest"
  | "web";

export type VideoKind = "video" | "short" | "live" | "reel" | "post" | "clip";

export interface ParsedLink {
  platform: Platform;
  kind: VideoKind;
  /** Same for every spelling of the same video. */
  key: string;
  /** Clean link to open: tracking stripped, scheme forced to https. */
  url: string;
  /** The platform's own id, when the link carries one. */
  videoId?: string;
  /** A thumbnail that needs no lookup (YouTube only). */
  thumb?: string;
  /** Where it can play inside the app (YouTube and Vimeo). */
  embed?: string;
  /** Seconds to start at, when the link had a timestamp. */
  start?: number;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  vimeo: "Vimeo",
  twitch: "Twitch",
  reddit: "Reddit",
  snapchat: "Snapchat",
  pinterest: "Pinterest",
  web: "Link",
};

/** Query parameters that only track who shared what. */
const TRACKING = /^(utm_\w+|si|igsh|igshid|fbclid|gclid|feature|pp|ab_channel|is_from_webapp|sender_device|sender_web_id|share_app_id|share_link_id|_r|_t|s|ref|ref_src|ref_url|mibextid|rdid|xmt|context)$/i;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** "1h2m3s", "93", "1:33" → seconds. */
export function parseTimestamp(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (/^\d+$/.test(t)) return Number(t) || undefined;
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    const n = t.split(":").map(Number).reverse();
    const s = (n[0] ?? 0) + (n[1] ?? 0) * 60 + (n[2] ?? 0) * 3600;
    return s || undefined;
  }
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(t);
  if (!m || !(m[1] || m[2] || m[3])) return undefined;
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return s || undefined;
}

/**
 * Every link in a blob of pasted text, in order, without repeats. Bare
 * "youtu.be/…" and "www.…" links count — phones drop the scheme sometimes.
 */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(?:https?:\/\/|www\.|(?:m\.)?youtu\.be\/|(?:vm|vt)\.tiktok\.com\/|fb\.watch\/)[^\s<>"'`]+/gi;
  for (const m of text.matchAll(re)) {
    let u = m[0].replace(/[),.;!?\]]+$/, "");
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

function host(u: URL): string {
  return u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
}

function clean(u: URL): string {
  const c = new URL(u.toString());
  c.protocol = "https:";
  c.hash = "";
  for (const k of [...c.searchParams.keys()]) if (TRACKING.test(k)) c.searchParams.delete(k);
  const s = c.toString();
  return s.endsWith("?") ? s.slice(0, -1) : s;
}

function youtube(u: URL, h: string): ParsedLink | null {
  const parts = u.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  let kind: VideoKind = "video";
  if (h === "youtu.be") id = parts[0];
  else if (parts[0] === "watch") id = u.searchParams.get("v") ?? undefined;
  else if (["shorts", "live", "embed", "v", "e"].includes(parts[0] ?? "")) {
    id = parts[1];
    if (parts[0] === "shorts") kind = "short";
    if (parts[0] === "live") kind = "live";
  } else if (parts[0] === "attribution_link") {
    const inner = u.searchParams.get("u");
    if (inner) {
      try {
        return youtube(new URL(inner, "https://www.youtube.com"), "youtube.com");
      } catch {
        return null;
      }
    }
  }
  if (!id || !YT_ID.test(id)) return null;
  const start = parseTimestamp(u.searchParams.get("t") ?? u.searchParams.get("start"));
  const url = kind === "short" ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`;
  return {
    platform: "youtube",
    kind,
    key: `youtube:${id}`,
    url,
    videoId: id,
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${start}` : ""}`,
    start,
  };
}

/**
 * One pasted link → one record, or null when it isn't a web link at all.
 * Unknown sites still save (as "Link"), keyed on the cleaned URL.
 */
export function parseLink(raw: string): ParsedLink | null {
  let u: URL;
  try {
    const s = raw.trim();
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".")) return null;
  const h = host(u);
  const parts = u.pathname.split("/").filter(Boolean);
  const url = clean(u);

  if (h === "youtu.be" || h.endsWith("youtube.com") || h === "youtube-nocookie.com") {
    const yt = youtube(u, h === "youtu.be" ? "youtu.be" : "youtube.com");
    if (yt) return yt;
    return { platform: "youtube", kind: "video", key: `url:${url}`, url };
  }

  if (h.endsWith("tiktok.com")) {
    const at = parts.findIndex((p) => p === "video" || p === "photo");
    const id = at >= 0 ? parts[at + 1] : undefined;
    if (id && /^\d{6,}$/.test(id)) {
      const user = parts.find((p) => p.startsWith("@"));
      return {
        platform: "tiktok",
        kind: "short",
        key: `tiktok:${id}`,
        url: user ? `https://www.tiktok.com/${user}/video/${id}` : `https://www.tiktok.com/video/${id}`,
        videoId: id,
      };
    }
    return { platform: "tiktok", kind: "short", key: `url:${url}`, url };
  }

  if (h.endsWith("instagram.com")) {
    const at = parts.findIndex((p) => ["reel", "reels", "p", "tv"].includes(p));
    const code = at >= 0 ? parts[at + 1] : undefined;
    if (code && /^[A-Za-z0-9_-]{5,}$/.test(code)) {
      const kind: VideoKind = parts[at] === "p" ? "post" : "reel";
      return { platform: "instagram", kind, key: `instagram:${code}`, url: `https://www.instagram.com/${parts[at] === "reels" ? "reel" : parts[at]}/${code}/`, videoId: code };
    }
    return { platform: "instagram", kind: "post", key: `url:${url}`, url };
  }

  if (h.endsWith("facebook.com") || h === "fb.watch" || h === "fb.com") {
    const v = u.searchParams.get("v");
    const at = parts.findIndex((p) => p === "videos" || p === "reel");
    const id = v ?? (at >= 0 ? parts[at + 1] : undefined);
    if (id && /^\d{6,}$/.test(id)) {
      return { platform: "facebook", kind: parts[at] === "reel" ? "reel" : "video", key: `facebook:${id}`, url: `https://www.facebook.com/watch/?v=${id}`, videoId: id };
    }
    return { platform: "facebook", kind: "video", key: `url:${url}`, url };
  }

  if (h === "x.com" || h === "twitter.com" || h === "mobile.twitter.com") {
    const at = parts.indexOf("status");
    const id = at >= 0 ? parts[at + 1] : undefined;
    if (id && /^\d{5,}$/.test(id)) {
      return { platform: "x", kind: "post", key: `x:${id}`, url: `https://x.com/${parts[0] && at > 0 ? parts[0] : "i"}/status/${id}`, videoId: id };
    }
    return { platform: "x", kind: "post", key: `url:${url}`, url };
  }

  if (h.endsWith("vimeo.com")) {
    const id = [...parts].reverse().find((p) => /^\d{5,}$/.test(p));
    if (id) {
      return { platform: "vimeo", kind: "video", key: `vimeo:${id}`, url: `https://vimeo.com/${id}`, videoId: id, embed: `https://player.vimeo.com/video/${id}?autoplay=1` };
    }
    return { platform: "vimeo", kind: "video", key: `url:${url}`, url };
  }

  if (h.endsWith("twitch.tv")) {
    if (h === "clips.twitch.tv" && parts[0]) return { platform: "twitch", kind: "clip", key: `twitch-clip:${parts[0]}`, url: `https://clips.twitch.tv/${parts[0]}`, videoId: parts[0] };
    const ci = parts.indexOf("clip");
    if (ci >= 0 && parts[ci + 1]) return { platform: "twitch", kind: "clip", key: `twitch-clip:${parts[ci + 1]}`, url: `https://clips.twitch.tv/${parts[ci + 1]}`, videoId: parts[ci + 1] };
    if (parts[0] === "videos" && /^\d+$/.test(parts[1] ?? "")) return { platform: "twitch", kind: "video", key: `twitch:${parts[1]}`, url: `https://www.twitch.tv/videos/${parts[1]}`, videoId: parts[1] };
    return { platform: "twitch", kind: "live", key: `url:${url}`, url };
  }

  if (h.endsWith("reddit.com") || h === "redd.it") {
    const at = parts.indexOf("comments");
    const id = at >= 0 ? parts[at + 1] : h === "redd.it" ? parts[0] : undefined;
    if (id && /^[a-z0-9]{4,}$/i.test(id)) return { platform: "reddit", kind: "post", key: `reddit:${id.toLowerCase()}`, url, videoId: id };
    return { platform: "reddit", kind: "post", key: `url:${url}`, url };
  }

  if (h.endsWith("snapchat.com")) return { platform: "snapchat", kind: "short", key: `url:${url}`, url };
  if (h.endsWith("pinterest.com") || h === "pin.it") return { platform: "pinterest", kind: "post", key: `url:${url}`, url };

  return { platform: "web", kind: "video", key: `url:${url}`, url };
}

/** Every video in a paste, one each, in the order pasted. */
export function parsePaste(text: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  const keys = new Set<string>();
  for (const raw of extractUrls(text)) {
    const p = parseLink(raw);
    if (p && !keys.has(p.key)) {
      keys.add(p.key);
      out.push(p);
    }
  }
  return out;
}

/** Shorts, TikToks and Reels are tall; the player sizes itself to match. */
export function isTall(v: { platform: Platform; kind: VideoKind }): boolean {
  return v.kind === "short" || v.kind === "reel" || v.platform === "tiktok" || v.platform === "snapchat";
}

/**
 * The in-app player for a saved video, or null when the platform has none
 * (then the card opens the link instead). Worked out from the saved fields,
 * so videos saved before a platform's player existed get one too. Twitch
 * needs the page's own host name.
 */
export function embedFor(
  v: { platform: Platform; kind: VideoKind; videoId?: string; url: string; start?: number },
  host = "localhost",
): string | null {
  const id = v.videoId;
  switch (v.platform) {
    case "youtube":
      return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1${v.start ? `&start=${v.start}` : ""}` : null;
    case "vimeo":
      return id ? `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1` : null;
    case "tiktok":
      return id ? `https://www.tiktok.com/player/v1/${id}?autoplay=1&music_info=1&description=1` : null;
    case "instagram":
      return id ? `https://www.instagram.com/${v.kind === "post" ? "p" : "reel"}/${id}/embed/` : null;
    case "x":
      return id ? `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true` : null;
    case "facebook":
      return id ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(v.url)}&show_text=false&autoplay=true` : null;
    case "twitch":
      if (!id) return null;
      return v.kind === "clip"
        ? `https://clips.twitch.tv/embed?clip=${encodeURIComponent(id)}&parent=${encodeURIComponent(host)}&autoplay=true`
        : `https://player.twitch.tv/?video=${encodeURIComponent(id)}&parent=${encodeURIComponent(host)}&autoplay=true`;
    default:
      return null;
  }
}

/** A thumbnail that needs no lookup, from the saved fields alone. */
export function instantThumb(v: { platform: Platform; videoId?: string }): string | undefined {
  return v.platform === "youtube" && v.videoId ? `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg` : undefined;
}
