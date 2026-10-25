// ---------------------------------------------------------------------------
// A pasted link → everything a tile needs: a title, who posted it, a poster,
// and the best way to play it on hover.
//
// The best way is the video file itself, downloaded once with the hub's
// per-site workflow (TikTok mirror, FxTwitter, yt-dlp for Instagram,
// Facebook and ~1,800 other sites) and kept in the owner's storage. When that
// isn't possible — signed out, the post is login-walled, the host refused —
// the tile falls back to the network's own embed, and says so in `note`.
// YouTube is never downloaded: its embed autoplays muted on hover already,
// and datacenter IPs get bot-walled by it anyway.
// ---------------------------------------------------------------------------

import "server-only";

import { ImportError, importDanceVideo } from "@/lib/dance-studio/server/importLink";
import { PLATFORM_LABEL, parseLink } from "@/lib/social-import/platform";
import { resolveSocialPost } from "@/lib/social-import/resolve";
import { BlockedUrlError, assertPublic, fetchJson } from "@/lib/social-import/safeFetch";

import { tiktokDetails, type SourceMusic, type SourceStats } from "@/lib/social-import/videoDownload";

import { guessVertical, instagramRef, tiktokRef, youTubeRef } from "../board";
import { judgeSound, songFromCredit, songLine } from "../song";
import { stuckNote } from "../stuck";
import type { ClipStats, Playback, ResolvedLink, TabId } from "../types";
import { listen } from "./songFinder";
import { getMedia, newKey, putMedia, remoteStorage, signedReadUrl } from "./storage";
import { tagClips } from "./tagger";

export class LinkError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** A caption's first real line, minus links, hashtags and handles. */
export function cleanTitle(text: string): string {
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
  return line.length > 90 ? `${line.slice(0, 87).trimEnd()}…` : line;
}

/** A login wall still serves a page, titled with the network's own name. That isn't the post's title. */
function isGeneric(title: string): boolean {
  return !title || /^(instagram|tiktok|facebook|x|youtube|log ?in|sign ?up|pinterest)\b/i.test(title.trim());
}

interface Meta {
  title: string;
  author: string;
  /** For TikTok short links, the numeric id oEmbed reports. */
  tiktokId?: string;
}

async function readMeta(url: URL, platform: string): Promise<Meta> {
  if (platform === "tiktok") {
    const o = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url.href)}`);
    return {
      title: cleanTitle(String(o?.title ?? "")),
      author: String(o?.author_name ?? ""),
      tiktokId: typeof o?.embed_product_id === "string" && /^\d{6,25}$/.test(o.embed_product_id) ? o.embed_product_id : undefined,
    };
  }
  const post = await resolveSocialPost(url.href, { followLinks: 0 }).catch(() => null);
  const title = cleanTitle(post?.title || post?.caption || "");
  return { title: isGeneric(title) ? "" : title, author: post?.author ?? "" };
}

interface Got {
  play: Playback;
  title: string;
  author: string;
  vertical?: boolean;
  music: SourceMusic | null;
  stats: SourceStats | null;
}

async function download(url: string, uid: string): Promise<Got | { error: string; needsLogin?: boolean }> {
  try {
    const video = await importDanceVideo(url);
    const key = newKey(uid, "clips", video.contentType);
    if (!(await putMedia(key, video.bytes, video.contentType))) return { error: "Couldn't save the video file." };
    let posterKey: string | undefined;
    if (video.poster) {
      const pk = newKey(uid, "posters", video.poster.contentType);
      if (await putMedia(pk, video.poster.bytes, video.poster.contentType)) posterKey = pk;
    }
    const vertical = video.width && video.height ? video.height >= video.width : undefined;
    return { play: { kind: "file", key, posterKey }, title: cleanTitle(video.title), author: video.author, vertical, music: video.music, stats: video.stats };
  } catch (err) {
    if (err instanceof ImportError) return { error: err.message.replace(/\s*You can also save the video.*$/s, "").trim(), needsLogin: err.needsLogin };
    return { error: "Couldn't download that video." };
  }
}

/**
 * `uid` is the signed-in owner, or null — signed out, nothing is downloaded
 * (there is nowhere private to keep it) and the embed is used instead.
 */
async function resolvePlayback(input: string, uid: string | null): Promise<ResolvedLink & { music?: SourceMusic | null; srcStats?: SourceStats | null }> {
  const link = parseLink(input);
  if (!link) throw new LinkError("That doesn't look like a link.");
  try {
    await assertPublic(link.url);
  } catch (err) {
    // A social network that can't be looked up right now is a hiccup on our
    // side, not a bad link: 502 tells the browser to keep the tile anyway.
    if (link.platform !== "web") throw new LinkError("Couldn't reach that site just now.", 502);
    throw new LinkError(err instanceof BlockedUrlError ? err.message : "That link can't be reached.");
  }
  const { url, platform } = link;
  const base = { url: url.href, platform };

  const yt = youTubeRef(url);
  if (yt) {
    const meta = await readMeta(url, platform);
    return { ...base, title: meta.title, author: meta.author, play: { kind: "youtube", ref: yt }, vertical: guessVertical(url.href) };
  }

  const [meta, got] = await Promise.all([
    readMeta(url, platform),
    uid ? download(url.href, uid) : Promise.resolve({ error: "" }),
  ]);

  if ("play" in got) {
    return {
      ...base,
      title: meta.title || (isGeneric(got.title) ? "" : got.title),
      author: meta.author || got.author,
      play: got.play,
      vertical: got.vertical ?? guessVertical(url.href),
      music: got.music,
      srcStats: got.stats,
    };
  }

  // Fall back to the network's own player.
  const tt = platform === "tiktok" ? (tiktokRef(url) ?? meta.tiktokId) : null;
  const ig = platform === "instagram" ? instagramRef(url) : null;
  const play: Playback = tt ? { kind: "tiktok", ref: tt } : ig ? { kind: "instagram", ref: ig } : { kind: "none" };
  const needsLogin = Boolean(uid && "needsLogin" in got && got.needsLogin);
  const note = stuckNote(PLATFORM_LABEL[platform], play.kind === "none", uid ? got.error : "", !uid, needsLogin);
  return { ...base, title: meta.title, author: meta.author, play, note, vertical: guessVertical(url.href), ...(needsLogin ? { needsLogin } : {}) };
}

/** Where the song finder can hear a clip: a short signed link to the saved file, the file itself, or the post. */
export async function audioSource(play: Playback, postUrl: string): Promise<{ url?: string; bytes?: Buffer }> {
  if (play.kind === "file") {
    if (remoteStorage()) {
      const signed = await signedReadUrl(play.key, 900).catch(() => null);
      if (signed) return { url: signed };
    }
    const bytes = await getMedia(play.key).catch(() => null);
    if (bytes) return { bytes };
  }
  return { url: postUrl };
}

function toStats(s: SourceStats | null | undefined): ClipStats | undefined {
  if (!s || (s.views === null && s.likes === null && !s.postedAt)) return undefined;
  return { views: s.views, likes: s.likes, postedAt: s.postedAt, readAt: new Date().toISOString() };
}

/**
 * A pasted link → a tile, for the tab it was pasted into. On the audio tab the
 * song finder runs too: the post's own sound credit first, then listening to
 * the audio when the credit isn't a song. Every tab gets mood/category tags
 * and, where the network reports them, views and post date for "hot right now".
 */
export async function resolveLink(input: string, uid: string | null, tab: TabId = "audio"): Promise<ResolvedLink> {
  const { music: credited, srcStats: counted, ...out } = await resolvePlayback(input, uid);
  let music = credited ?? null;
  let srcStats = counted ?? null;

  // An embed-only TikTok still has its sound credit and numbers on the mirror.
  if ((!music || !srcStats) && out.platform === "tiktok") {
    const extra = await tiktokDetails(new URL(out.url)).catch(() => null);
    music = music ?? extra?.music ?? null;
    srcStats = srcStats ?? extra?.stats ?? null;
  }
  const stats = toStats(srcStats);

  let songText = "";
  let isSong = false;
  if (tab === "audio") {
    let heard = null;
    if (!songFromCredit(music)) {
      const got = await listen(await audioSource(out.play, out.url)).catch(() => null);
      heard = got && got.ok ? got.song : null;
    }
    const judged = judgeSound(music, heard);
    out.sound = judged.kind;
    if (judged.song) out.song = judged.song;
    songText = songLine(judged.song);
    isSong = judged.kind === "song";
  }

  const tagged = await tagClips([{ id: "x", tab, title: out.title, author: out.author, song: songText, isSong }]).catch(() => null);
  return { ...out, ...(stats ? { stats } : {}), ...(tagged?.x ? { tags: tagged.x } : {}) };
}
