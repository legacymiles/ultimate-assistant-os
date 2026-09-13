// ---------------------------------------------------------------------------
// POST /api/dances/resolve   { name?, link?, exclude?: string[] }
//   (`tiktokUrl` is still accepted as an alias for `link`.)
//
// Adding a dance by hand goes through the same gate the seed did. There is no
// "trust me" path into the vault.
//
// The link can be from any network. It is read for a name suggestion and
// credit through the hub's social-import lib. A YouTube link that passes the
// embed check IS the playable video; every other network's link is credit
// only — TikTok, Instagram and Facebook embeds cannot hover-autoplay — and
// the playable video is resolved from the dance name.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

import { danceQuery, resolveVideo, verifyVideo } from "@/lib/dances/resolve";
import type { DanceVideo } from "@/lib/dances/types";
import { PLATFORM_LABEL, parseLink, youTubeId, type Platform } from "@/lib/social-import/platform";
import { resolveSocialPost } from "@/lib/social-import/resolve";
import { BlockedUrlError, assertPublic } from "@/lib/social-import/safeFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface LinkInfo {
  url: string;
  platform: Platform;
  label: string;
  resolved: boolean;
  title: string;
  author?: string;
  hint?: string;
}

/** A caption's first real line, without links, hashtags or handles — a usable name draft. */
function cleanTitle(text: string): string {
  const line =
    text
      .split("\n")
      .map((l) =>
        l
          .replace(/https?:\/\/\S+/g, "")
          .replace(/#[\p{L}\p{N}_]+/gu, "")
          .replace(/@[\w.]+/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find(Boolean) ?? "";
  return line.slice(0, 60).trim();
}

async function readLink(url: URL, platform: Platform): Promise<{ info: LinkInfo; video: DanceVideo | null }> {
  const base = { url: url.href, platform, label: PLATFORM_LABEL[platform] };

  if (platform === "youtube") {
    const id = youTubeId(url);
    const video = id ? await verifyVideo(id) : null;
    return {
      video,
      info: {
        ...base,
        resolved: !!video,
        title: cleanTitle(video?.sourceTitle ?? ""),
        author: video?.channel,
        hint: video ? undefined : "That YouTube video doesn't exist or won't play embedded — type the dance name and a playable copy is searched for instead.",
      },
    };
  }

  const post = await resolveSocialPost(url.href, { followLinks: 0 }).catch(() => null);
  const title = post ? cleanTitle(post.title || post.caption) : "";
  // A login wall still serves a page — titled "Instagram" or "Log in". That is
  // the network's name, not the dance's, and searching for it finds a random video.
  const generic = !title || title.toLowerCase() === PLATFORM_LABEL[platform].toLowerCase() || /^(log ?in|sign ?up|facebook|instagram|tiktok|x)\b/i.test(title);
  const resolved = !!post && (!generic || !!post.video);
  const walled = platform === "instagram" || platform === "facebook";
  return {
    video: null,
    info: {
      ...base,
      resolved,
      title: generic ? "" : title,
      author: post?.author || undefined,
      hint: resolved
        ? undefined
        : walled
          ? `${PLATFORM_LABEL[platform]} hides posts from logged-out visitors, so type the dance name — the link is still saved as the original.`
          : "Couldn't read that post — type the dance name; the link is still saved as the original.",
    },
  };
}

export async function POST(req: Request) {
  let body: { name?: string; link?: string; tiktokUrl?: string; exclude?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }

  const exclude = new Set(body.exclude ?? []);
  const raw = (body.link ?? body.tiktokUrl ?? "").trim();
  let link: LinkInfo | null = null;
  let linkVideo: DanceVideo | null = null;

  if (raw) {
    const parsed = parseLink(raw);
    if (!parsed) return NextResponse.json({ error: "That doesn't look like a link." }, { status: 400 });
    try {
      await assertPublic(parsed.url);
    } catch (err) {
      return NextResponse.json({ error: err instanceof BlockedUrlError ? err.message : "That link can't be reached." }, { status: 400 });
    }
    const read = await readLink(parsed.url, parsed.platform);
    link = read.info;
    linkVideo = read.video;
  }

  // A caption is a poor name but a usable starting point; the form lets you fix it.
  const name = body.name?.trim() || link?.title || "";
  if (!name && !linkVideo) {
    return NextResponse.json(
      { error: link?.hint ?? "Give a dance name, or a link that still resolves.", link },
      { status: 400 },
    );
  }

  const video = linkVideo ?? (await resolveVideo(danceQuery(name), { exclude }));

  return NextResponse.json({
    name,
    video,
    link,
    // The pasted YouTube video is already on the wall.
    duplicate: !!linkVideo && exclude.has(linkVideo.ref),
    // Not an error. The dance can still be saved; it just has no video yet.
    unresolved: !video,
  });
}
