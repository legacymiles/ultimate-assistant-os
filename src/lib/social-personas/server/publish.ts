// ---------------------------------------------------------------------------
// Posting for a persona — each platform's official publishing API.
//
//   TikTok    Content Posting API, Upload-to-inbox: at the scheduled time the
//             video lands in the creator's TikTok inbox as a draft and they
//             post it with one tap ("inbox"). Direct Post is private-only until
//             TikTok audits the app, so it's a later step.
//   Instagram Instagram API with Instagram Login: a REELS container from a
//             public video URL, polled until processed, then published.
//   Facebook  Page video from a URL (or a text post with no video).
//
// The video is read from private storage and handed over either as a short-
// lived signed URL (Meta fetches it) or uploaded in chunks (TikTok, whose
// "pull from URL" needs a verified domain we can't verify for storage links).
//
// Every failure throws an Error whose message is already plain English — the
// queue shows it to the owner as is.
// ---------------------------------------------------------------------------

import "server-only";

import { getBlob, signedBlobUrl } from "@/lib/server/blobStore";
import { config, refreshTikTok, type Connection } from "./connectors";

const GRAPH = "v23.0";
export const MEDIA_BUCKET = "social-personas-media";
export const mediaDir = () => (process.env.SOCIAL_PERSONAS_DATA_DIR || ".data") + "/media";

export interface PublishInput {
  conn: Connection;
  caption: string;
  title: string;
  media: { key: string; type: string; size: number } | null;
}

export interface PublishOutcome {
  status: "posted" | "inbox";
  url?: string;
  externalId?: string;
  note?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json(res: Response, what: string): Promise<any> {
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  const tiktokErr = body?.error?.code && body.error.code !== "ok" ? body.error : null;
  if (!res.ok || tiktokErr || (body?.error && !body?.error?.code)) {
    const raw = tiktokErr?.message || body?.error?.message || body?.error_description || text.slice(0, 200);
    throw new Error(plain(what, raw, res.status));
  }
  return body;
}

/** Platform error text → something the owner can act on. */
export function plain(what: string, raw: string, status = 0): string {
  const r = String(raw || "");
  if (/spam_risk|too many posts|limit reached/i.test(r)) return `${what}: the platform's daily posting limit was reached. It'll try again later.`;
  if (/scope|permission|not authori[sz]ed|\(#10\)|\(#200\)/i.test(r)) {
    return `${what}: this account hasn't given Personas Studio permission to post. Open the persona and press "Reconnect for auto-post" on the account.`;
  }
  if (/expired|invalid.*token|access_token_invalid|\b190\b/i.test(r) || status === 401) return `${what}: the login expired. Connect the account again.`;
  if (/rate|limit|too many|429/i.test(r) || status === 429) return `${what}: the platform is rate-limiting right now. It'll try again in a few minutes.`;
  if (/video|media|format|codec|duration|size/i.test(r)) return `${what}: the platform didn't accept the video (${r.slice(0, 120)}). Check it's an MP4 under the platform's length limit.`;
  return `${what} didn't go through: ${r.slice(0, 160) || `error ${status}`}.`;
}

async function mediaUrl(key: string): Promise<string> {
  const url = await signedBlobUrl(MEDIA_BUCKET, key, 3600);
  if (!url) throw new Error("The video is only stored on this computer, so the platform can't fetch it. Posting needs SUPABASE_SERVICE_ROLE_KEY set on the live site.");
  return url;
}

// --- TikTok ------------------------------------------------------------------

const TT = "https://open.tiktokapis.com/v2";

async function publishTikTok(input: PublishInput): Promise<PublishOutcome> {
  if (!input.media) throw new Error("TikTok needs a video. Add one to the post first.");
  const conn = await refreshTikTok(input.conn);
  const auth = { Authorization: `Bearer ${conn.accessToken}`, "Content-Type": "application/json; charset=UTF-8" };
  const bytes = await getBlob(MEDIA_BUCKET, input.media.key, mediaDir());
  if (!bytes) throw new Error("The video file is missing from storage. Upload it again.");

  // Chunking rules: one chunk if under 64 MB, else 10 MB chunks with the last
  // one absorbing the remainder.
  const size = bytes.length;
  const CHUNK = 10 * 1024 * 1024;
  const chunk = size <= 64 * 1024 * 1024 ? size : CHUNK;
  const count = size <= 64 * 1024 * 1024 ? 1 : Math.floor(size / CHUNK);
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count };

  // Upload-to-inbox: the video lands in the creator's TikTok inbox as a draft
  // and they post it from the app (TikTok keeps it ~24 h). Direct Post would
  // be private-only until TikTok audits this app, so it isn't used yet.
  const init = await json(await fetch(`${TT}/post/publish/inbox/video/init/`, { method: "POST", headers: auth, body: JSON.stringify({ source_info }) }), "TikTok");

  const uploadUrl: string = init?.data?.upload_url;
  const publishId: string = init?.data?.publish_id;
  if (!uploadUrl || !publishId) throw new Error("TikTok didn't return an upload link. Try again in a minute.");

  for (let i = 0; i < count; i++) {
    const start = i * chunk;
    const end = i === count - 1 ? size : start + chunk;
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": input.media.type || "video/mp4", "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${size}` },
      body: new Uint8Array(bytes.subarray(start, end)),
    });
    if (!res.ok) throw new Error(plain("TikTok upload", await res.text(), res.status));
  }

  // Wait (briefly) for TikTok to finish processing; the queue re-checks later
  // if it's still going, so a slow transcode never fails the post.
  let status = "PROCESSING_UPLOAD";
  for (let i = 0; i < 6 && /PROCESSING/.test(status); i++) {
    await sleep(4000);
    const st = await json(await fetch(`${TT}/post/publish/status/fetch/`, { method: "POST", headers: auth, body: JSON.stringify({ publish_id: publishId }) }), "TikTok").catch(() => null);
    status = st?.data?.status ?? status;
    if (status === "FAILED") throw new Error(plain("TikTok", st?.data?.fail_reason ?? "processing failed"));
  }
  return { status: "inbox", note: "Sent to your TikTok inbox — open TikTok, tap the notification, add a sound if you like, and post. It waits there about a day." };
}

// --- Instagram -----------------------------------------------------------------

async function publishInstagram(input: PublishInput): Promise<PublishOutcome> {
  if (!input.media) throw new Error("Instagram needs a video or photo. Add one to the post first.");
  const tok = input.conn.accessToken;
  const user = input.conn.accountId || "me";
  const isVideo = !input.media.type.startsWith("image/");
  const url = await mediaUrl(input.media.key);
  const params = new URLSearchParams({
    ...(isVideo ? { media_type: "REELS", video_url: url, share_to_feed: "true" } : { image_url: url }),
    caption: input.caption.slice(0, 2200),
    access_token: tok,
  });
  const container = await json(await fetch(`https://graph.instagram.com/${GRAPH}/${user}/media`, { method: "POST", body: params }), "Instagram");
  const id = String(container?.id ?? "");
  if (!id) throw new Error("Instagram didn't accept the upload. Try again.");

  // Reels process for a while; poll up to ~50 s, then let the queue retry the
  // publish step later (the container stays valid for 24 h).
  for (let i = 0; isVideo && i < 10; i++) {
    const st = await json(await fetch(`https://graph.instagram.com/${GRAPH}/${id}?${new URLSearchParams({ fields: "status_code,status", access_token: tok })}`), "Instagram");
    if (st?.status_code === "FINISHED") break;
    if (st?.status_code === "ERROR" || st?.status_code === "EXPIRED") throw new Error(plain("Instagram", st?.status ?? "the video couldn't be processed"));
    if (i === 9) throw new Error("Instagram is still processing the video. It'll try again in a few minutes.");
    await sleep(5000);
  }

  const pub = await json(
    await fetch(`https://graph.instagram.com/${GRAPH}/${user}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: id, access_token: tok }) }),
    "Instagram",
  );
  const mediaId = String(pub?.id ?? "");
  const link = await json(await fetch(`https://graph.instagram.com/${GRAPH}/${mediaId}?${new URLSearchParams({ fields: "permalink", access_token: tok })}`), "Instagram").catch(() => null);
  return { status: "posted", externalId: `instagram:${mediaId}`, url: link?.permalink };
}

// --- Facebook ------------------------------------------------------------------

async function publishFacebook(input: PublishInput): Promise<PublishOutcome> {
  const page = input.conn.pages?.find((p) => p.id === input.conn.accountId) ?? input.conn.pages?.[0];
  if (!page) throw new Error("That Facebook login doesn't manage a Page. Facebook only lets apps post to Pages.");
  if (!input.media) {
    const r = await json(
      await fetch(`https://graph.facebook.com/${GRAPH}/${page.id}/feed`, { method: "POST", body: new URLSearchParams({ message: input.caption, access_token: page.token }) }),
      "Facebook",
    );
    return { status: "posted", externalId: `facebook:${r.id}`, url: `https://www.facebook.com/${r.id}` };
  }
  const url = await mediaUrl(input.media.key);
  const isVideo = !input.media.type.startsWith("image/");
  const r = await json(
    await fetch(`https://graph.facebook.com/${GRAPH}/${page.id}/${isVideo ? "videos" : "photos"}`, {
      method: "POST",
      body: new URLSearchParams({
        ...(isVideo ? { file_url: url, description: input.caption, title: input.title.slice(0, 250) } : { url, caption: input.caption }),
        access_token: page.token,
      }),
    }),
    "Facebook",
  );
  const id = String(r?.post_id ?? r?.id ?? "");
  return { status: "posted", externalId: `facebook:${id}`, url: id ? `https://www.facebook.com/${id}` : undefined };
}

export async function publish(input: PublishInput): Promise<PublishOutcome> {
  if (input.conn.platform === "youtube") throw new Error("YouTube posts go out by hand: the reminder opens YouTube Studio with the caption copied.");
  if (!input.conn.canPost) {
    throw new Error(`Auto-post isn't on for this ${input.conn.platform} account yet. Open the persona and press "Reconnect for auto-post" on it. ${config(input.conn.platform).postSetup}`);
  }
  if (input.conn.platform === "tiktok") return publishTikTok(input);
  if (input.conn.platform === "instagram") return publishInstagram(input);
  return publishFacebook(input);
}

