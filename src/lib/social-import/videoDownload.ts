// ---------------------------------------------------------------------------
// Any post link → the video FILE, with a workflow per website.
//
// Each network gets an ordered list of strategies; the first that produces a
// real video wins, and every attempt leaves a sentence in `trail` so the UI
// can say exactly what was tried.
//
//   tiktok     tikwm mirror → yt-dlp → cobalt
//   youtube    yt-dlp → cobalt
//   instagram  yt-dlp → cobalt → page og:video
//   facebook   share link → real reel address, then
//              facebook pages → yt-dlp → cobalt → page og:video
//   x          fxtwitter API → yt-dlp → cobalt
//   pinterest  yt-dlp → page og:video → cobalt
//   web        page og:video → yt-dlp (it knows ~1,800 sites)
//
// Strategies:
//   tikwm      free TikTok mirror with a watermark-free mp4 (no key)
//   fxtwitter  api.fxtwitter.com — X/Twitter status JSON with mp4 links (no key)
//   yt-dlp     github.com/yt-dlp/yt-dlp, see ytdlp.ts; per-site cookies unlock
//              login-walled posts
//   cobalt     github.com/imputnet/cobalt — only when you run your own and set
//              COBALT_API_URL (+ COBALT_API_KEY); the public instance forbids
//              third-party use
//   page       the post page's own og:video tag
//   facebook   facebook.ts — the embed player, desktop, mobile and crawler
//              versions of the post, read for a direct video URL (no key,
//              and no login for public reels)
//
// A Facebook or Instagram session the owner connected in the app
// (cookieStore.ts) is used by every strategy that talks to that site.
//
// Downloading from these sites can breach their terms of service; use it for
// content you have the right to use.
// ---------------------------------------------------------------------------

import { canonicalFacebookUrl, findFacebookVideo, isFacebookShareLink, resolveFacebookShare } from "./facebook";
import { metaTags } from "./jsonld";
import { PLATFORM_LABEL, type Platform } from "./platform";
import { fetchBytes, fetchJson, fetchText } from "./safeFetch";
import { YtDlpError, cookiesFor, ytDlpDownload } from "./ytdlp";

export type Strategy = "tikwm" | "fxtwitter" | "yt-dlp" | "cobalt" | "page" | "facebook";

export const VIDEO_WORKFLOWS: Record<Platform, Strategy[]> = {
  tiktok: ["tikwm", "yt-dlp", "cobalt"],
  youtube: ["yt-dlp", "cobalt"],
  instagram: ["yt-dlp", "cobalt", "page"],
  facebook: ["facebook", "yt-dlp", "cobalt", "page"],
  x: ["fxtwitter", "yt-dlp", "cobalt"],
  pinterest: ["yt-dlp", "page", "cobalt"],
  web: ["page", "yt-dlp"],
};

const STRATEGY_LABEL: Record<Strategy, string> = {
  tikwm: "TikTok mirror",
  fxtwitter: "FxTwitter",
  "yt-dlp": "yt-dlp",
  cobalt: "cobalt",
  page: "the page's video tag",
  facebook: "Facebook's video player",
};

export interface DownloadedVideo {
  bytes: Buffer;
  contentType: string;
  via: Strategy;
  title: string;
  /** The post's own text, when the strategy could read it. */
  caption: string;
  author: string;
  thumbnailUrl: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  trail: string[];
}

export class VideoUnavailableError extends Error {
  constructor(
    message: string,
    public needsLogin: boolean,
    public trail: string[],
  ) {
    super(message);
  }
}

type Found = Omit<DownloadedVideo, "via" | "trail" | "contentType">;

/** What the bytes actually are — a login page served as "video" must not pass. */
function sniff(bytes: Buffer): string | null {
  if (bytes.length > 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp") {
    return bytes.subarray(8, 12).toString("latin1") === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (bytes.length > 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return "video/webm";
  return null;
}

const empty = { title: "", caption: "", author: "", thumbnailUrl: null, durationSec: null, width: null, height: null };

async function grab(url: string, maxBytes: number): Promise<Buffer | null> {
  const got = await fetchBytes(url, { maxBytes, timeoutMs: 120_000, accept: "video/mp4,video/*;q=0.9,*/*;q=0.5" });
  return got?.bytes ?? null;
}

async function viaTikwm(url: URL, maxBytes: number): Promise<Found | null> {
  const json = await fetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(url.href)}`);
  const d = json?.code === 0 ? json.data : null;
  if (!d?.play) return null;
  const bytes = await grab(new URL(String(d.play), "https://www.tikwm.com").href, maxBytes);
  if (!bytes) return null;
  return { ...empty, bytes, title: String(d.title ?? ""), caption: String(d.title ?? ""), author: String(d.author?.nickname ?? ""), thumbnailUrl: d.cover ?? null, durationSec: Number(d.duration) || null };
}

async function viaFxTwitter(url: URL, maxBytes: number): Promise<Found | null> {
  const id = url.pathname.match(/\/status(?:es)?\/(\d+)/)?.[1];
  if (!id) return null;
  const json = await fetchJson(`https://api.fxtwitter.com/status/${id}`);
  const videos: any[] = json?.tweet?.media?.videos ?? [];
  const best = videos.filter((v) => v?.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  if (!best) return null;
  const bytes = await grab(best.url, maxBytes);
  if (!bytes) return null;
  return {
    bytes,
    title: String(json.tweet.text ?? "").slice(0, 120),
    caption: String(json.tweet.text ?? ""),
    author: String(json.tweet.author?.name ?? ""),
    thumbnailUrl: best.thumbnail_url ?? null,
    durationSec: Number(best.duration) || null,
    width: Number(best.width) || null,
    height: Number(best.height) || null,
  };
}

async function viaCobalt(url: URL, maxBytes: number): Promise<Found | null> {
  const api = process.env.COBALT_API_URL;
  if (!api) throw new Error("not configured (set COBALT_API_URL to your own cobalt instance)");
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (process.env.COBALT_API_KEY) headers.authorization = `Api-Key ${process.env.COBALT_API_KEY}`;
  const res = await fetch(api, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: url.href, videoQuality: "1080", youtubeVideoCodec: "h264", youtubeVideoContainer: "mp4", downloadMode: "auto" }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (json.status === "error") throw new Error(String(json.error?.code ?? "error"));
  const link = json.status === "tunnel" || json.status === "redirect" ? json.url : json.status === "picker" ? json.picker?.find((p: any) => p.type === "video")?.url : null;
  if (!link) return null;
  // Your own instance is trusted and may live on a private address, so no SSRF guard here.
  const file = await fetch(link, { signal: AbortSignal.timeout(120_000) });
  if (!file.ok) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  return bytes.length > maxBytes ? null : { ...empty, bytes, title: String(json.filename ?? "") };
}

async function viaPage(url: URL, maxBytes: number): Promise<Found | null> {
  const html = await fetchText(url.href);
  if (!html) return null;
  const meta = metaTags(html);
  const video = meta["og:video:secure_url"] ?? meta["og:video:url"] ?? meta["og:video"];
  if (!video || !/^https?:\/\//i.test(video)) return null;
  const bytes = await grab(video, maxBytes);
  if (!bytes) return null;
  return { ...empty, bytes, title: meta["og:title"] ?? "", caption: meta["og:description"] ?? "", thumbnailUrl: meta["og:image"] ?? null };
}

async function viaFacebook(url: URL, maxBytes: number, cookies: string | null): Promise<Found | null> {
  const found = await findFacebookVideo(url, cookies);
  if (!found) return null;
  const bytes = await grab(found.videoUrl, maxBytes);
  if (!bytes) return null;
  return { ...empty, bytes, title: found.title, caption: found.caption, thumbnailUrl: found.thumbnailUrl };
}

async function viaYtDlp(url: URL, platform: Platform, maxBytes: number): Promise<Found> {
  const v = await ytDlpDownload(url.href, platform, { maxBytes });
  return { bytes: v.bytes, title: v.title, caption: v.description, author: v.uploader, thumbnailUrl: v.thumbnail, durationSec: v.durationSec, width: v.width, height: v.height };
}

export async function downloadVideo(input: URL, platform: Platform, { maxBytes }: { maxBytes: number }): Promise<DownloadedVideo> {
  const trail: string[] = [];
  let needsLogin = false;
  let url = input;
  const cookies = platform === "facebook" || platform === "instagram" ? await cookiesFor(platform).catch(() => null) : null;

  // The iPhone share sheet hands out facebook.com/share/r/<code> links, which
  // send a logged-out visitor to the login page. Follow them to the real reel
  // first, so nothing downstream mistakes a share redirect for a private video.
  if (platform === "facebook") {
    if (isFacebookShareLink(url)) {
      const real = await resolveFacebookShare(url, cookies);
      if (real) {
        url = real;
        trail.push("Opened the share link to find the reel.");
      }
    } else {
      url = canonicalFacebookUrl(url);
    }
  }

  for (const strategy of VIDEO_WORKFLOWS[platform]) {
    const label = STRATEGY_LABEL[strategy];
    try {
      const found =
        strategy === "tikwm"
          ? await viaTikwm(url, maxBytes)
          : strategy === "fxtwitter"
            ? await viaFxTwitter(url, maxBytes)
            : strategy === "cobalt"
              ? await viaCobalt(url, maxBytes)
              : strategy === "page"
                ? await viaPage(url, maxBytes)
                : strategy === "facebook"
                  ? await viaFacebook(url, maxBytes, cookies)
                  : await viaYtDlp(url, platform, maxBytes);
      if (!found) {
        trail.push(`${label}: no video found.`);
        continue;
      }
      const contentType = sniff(found.bytes);
      if (!contentType) {
        trail.push(`${label}: got something that isn't a video file.`);
        continue;
      }
      trail.push(`Downloaded with ${label}.`);
      return { ...found, contentType, via: strategy, trail };
    } catch (err) {
      if (err instanceof YtDlpError && err.needsLogin) needsLogin = true;
      trail.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const site = PLATFORM_LABEL[platform];
  // Plain words only — this sentence is shown to the person who pasted the link.
  const message = needsLogin
    ? cookies
      ? `${site} still wouldn't show this video, even signed in. It may be private, deleted, or only for the poster's friends — save it to your phone and upload it instead.`
      : `${site} only shows this video to people who are signed in. Connect ${site} once (one tap) and links like this will work from now on — or save the video to your phone and upload it.`
    : `Couldn't download a video from that ${site} link. Save the video to your phone and upload it instead.`;
  throw new VideoUnavailableError(message, needsLogin, trail);
}
