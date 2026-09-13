// ---------------------------------------------------------------------------
// A pasted link in, everything we can legally see about that post out:
// caption, author, cover image, and — when one is reachable — the video itself.
//
// App-agnostic. Cookbook Genie turns a SocialPost into a recipe; any other app
// can turn the same SocialPost into a workout, a product, a travel spot.
//
// What each platform gives an anonymous server (verified 2026-09-13):
//
//   TikTok     oEmbed returns the full caption. tikwm.com (a free third-party
//              mirror, ~1 req/s) returns the caption with line breaks and a
//              direct mp4 URL. TikTok's own playAddr needs session cookies.
//   YouTube    oEmbed + the watch page's shortDescription. The video needs no
//              download at all: Gemini accepts a YouTube URL directly.
//   Instagram  Every anonymous route (page, /embed/captioned, crawler UAs)
//   Facebook   returns a login wall. We still try Open Graph tags, but the
//              honest fallback is "paste the caption or upload the video".
//   Web page   Open Graph + schema.org JSON-LD + page text.
//
// Nothing here throws for an unavailable source. Each attempt appends a plain
// sentence to `trail`, so the UI can say exactly what was and wasn't used.
// ---------------------------------------------------------------------------

import { extractJsonLd, htmlToText, metaTags, titleTag } from "./jsonld";
import { PLATFORM_LABEL, isSocialHost, parseLink, youTubeId, type Platform } from "./platform";
import { assertPublic, fetchJson, fetchText } from "./safeFetch";

export interface LinkedPage {
  url: string;
  jsonLd: any[];
  /** Page text, only kept when the page had no JSON-LD to rely on. */
  text: string;
}

export type PostVideo =
  | { kind: "youtube"; url: string }
  | { kind: "file"; url: string };

export interface SocialPost {
  url: string;
  platform: Platform | "upload";
  title: string;
  caption: string;
  author: string;
  thumbnailUrl: string | null;
  durationSec: number | null;
  video: PostVideo | null;
  jsonLd: any[];
  pageText: string;
  linked: LinkedPage[];
  trail: string[];
}

export class NotALinkError extends Error {}

export function emptyPost(url = "", platform: SocialPost["platform"] = "upload"): SocialPost {
  return {
    url,
    platform,
    title: "",
    caption: "",
    author: "",
    thumbnailUrl: null,
    durationSec: null,
    video: null,
    jsonLd: [],
    pageText: "",
    linked: [],
    trail: [],
  };
}

export async function resolveSocialPost(input: string, { followLinks = 2 } = {}): Promise<SocialPost> {
  const link = parseLink(input);
  if (!link) throw new NotALinkError("That doesn't look like a link.");
  await assertPublic(link.url);

  const post =
    link.platform === "tiktok"
      ? await resolveTikTok(link.url)
      : link.platform === "youtube"
        ? await resolveYouTube(link.url)
        : await resolvePage(link.url, link.platform);

  await followCaptionLinks(post, followLinks);
  return post;
}

async function resolveTikTok(url: URL): Promise<SocialPost> {
  const post = emptyPost(url.href, "tiktok");
  const enc = encodeURIComponent(url.href);

  const [oembed, mirror] = await Promise.all([
    fetchJson(`https://www.tiktok.com/oembed?url=${enc}`),
    fetchJson(`https://www.tikwm.com/api/?url=${enc}`),
  ]);

  if (oembed?.title) {
    post.caption = String(oembed.title);
    post.author = String(oembed.author_name ?? "");
    post.thumbnailUrl = oembed.thumbnail_url ?? null;
    post.trail.push("Read the caption.");
  }

  const d = mirror?.code === 0 ? mirror.data : null;
  if (d) {
    // content_desc keeps the caption's line breaks, which is where recipe
    // creators put one ingredient per line. oEmbed flattens them.
    const lines = Array.isArray(d.content_desc) ? d.content_desc.join("\n").trim() : "";
    if (lines) post.caption = lines;
    else if (!post.caption && d.title) post.caption = String(d.title);
    if (!post.caption) post.trail.push("Read the caption.");
    if (d.play) post.video = { kind: "file", url: absolute(String(d.play), "https://www.tikwm.com") };
    post.durationSec = Number(d.duration) || null;
    post.thumbnailUrl ??= d.cover ?? null;
    post.author ||= String(d.author?.nickname ?? "");
    if (post.video) post.trail.push("Found the video file.");
  }

  if (!oembed && !d) post.trail.push("TikTok wouldn't show that post — it may be private, deleted, or region-locked.");
  else if (!post.video) post.trail.push("Couldn't get the video file, so only the caption is available.");
  return post;
}

async function resolveYouTube(url: URL): Promise<SocialPost> {
  const post = emptyPost(url.href, "youtube");
  const id = youTubeId(url);
  const watch = id ? `https://www.youtube.com/watch?v=${id}` : url.href;

  const [oembed, html] = await Promise.all([
    fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`),
    fetchText(watch),
  ]);

  post.title = String(oembed?.title ?? "");
  post.author = String(oembed?.author_name ?? "");
  post.thumbnailUrl = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : (oembed?.thumbnail_url ?? null);

  const desc = html?.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
  let description = "";
  if (desc) {
    try {
      description = JSON.parse(`"${desc[1]}"`);
    } catch {
      // Leave it empty; the title is still useful.
    }
  }
  post.caption = [post.title, description].filter(Boolean).join("\n\n");
  post.durationSec = Number(html?.match(/"lengthSeconds":"(\d+)"/)?.[1]) || null;
  if (post.caption) post.trail.push("Read the title and description.");

  if (id) post.video = { kind: "youtube", url: watch };
  else post.trail.push("Couldn't find a video id in that YouTube link.");
  return post;
}

async function resolvePage(url: URL, platform: Platform): Promise<SocialPost> {
  const post = emptyPost(url.href, platform);
  const label = PLATFORM_LABEL[platform];
  const html = await fetchText(url.href);
  if (!html) {
    post.trail.push(`${platform === "web" ? "That page" : label} wouldn't open.`);
    return post;
  }

  const meta = metaTags(html);
  post.title = meta["og:title"] ?? meta["twitter:title"] ?? titleTag(html);
  post.caption = meta["og:description"] ?? meta["twitter:description"] ?? meta["description"] ?? "";
  post.thumbnailUrl = meta["og:image"] ?? meta["twitter:image"] ?? null;
  const video = meta["og:video:secure_url"] ?? meta["og:video:url"] ?? meta["og:video"];
  if (video && /^https?:\/\//i.test(video)) post.video = { kind: "file", url: video };
  post.jsonLd = extractJsonLd(html);
  if (platform === "web") post.pageText = htmlToText(html);

  if (platform !== "web" && !post.caption && !post.video) {
    post.trail.push(`${label} hides that post from anyone who isn't logged in.`);
  } else {
    if (post.caption) post.trail.push(platform === "web" ? "Read the page." : "Read the caption.");
    if (post.video) post.trail.push("Found the video file.");
    if (post.jsonLd.length) post.trail.push("Found structured data on the page.");
  }
  return post;
}

/** Creators often write "full recipe: https://…" — that page usually has the exact amounts. */
async function followCaptionLinks(post: SocialPost, max: number) {
  if (max <= 0 || !post.caption) return;
  const ownHost = safeHost(post.url);
  const urls = [...new Set((post.caption.match(/https?:\/\/[^\s<>"')]+/gi) ?? []).map((u) => u.replace(/[.,!?]+$/, "")))]
    .filter((u) => {
      const host = safeHost(u);
      return host && host !== ownHost && !isSocialHost(host);
    })
    .slice(0, max);

  const pages = await Promise.all(
    urls.map(async (u) => {
      const html = await fetchText(u);
      if (!html) return null;
      const jsonLd = extractJsonLd(html);
      return { url: u, jsonLd, text: jsonLd.length ? "" : htmlToText(html, 6000) };
    })
  );
  for (const page of pages) {
    if (!page) continue;
    post.linked.push(page);
    post.trail.push(`Opened the link in the caption (${safeHost(page.url)}).`);
  }
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function absolute(u: string, base: string): string {
  try {
    return new URL(u, base).href;
  } catch {
    return u;
  }
}
