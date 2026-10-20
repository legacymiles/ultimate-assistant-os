// ---------------------------------------------------------------------------
// Message Inbox, server side: read and answer DMs and comments through each
// platform's official API, with the persona's own stored login.
//
//   Instagram (Instagram API with Instagram Login)
//     DMs       GET  /me/conversations?platform=instagram   POST /me/messages
//     comments  GET  /me/media{comments{replies}}            POST /<comment>/replies
//   Facebook Page (Graph API, page token)
//     Messenger GET  /<page>/conversations                   POST /<page>/messages
//     comments  GET  /<page>/posts{comments{comments}}       POST /<comment>/comments
//   YouTube (Data API v3)
//     comments  GET  commentThreads?allThreadsRelatedToChannelId   POST comments (parentId)
//
// Nothing is stored here: every read goes to the platform, so the inbox is
// always what the platform shows. Errors come back in plain words with a hint
// for the UI (reconnect / turn on the inbox permission).
// ---------------------------------------------------------------------------

import "server-only";

import type { InboxMessage, InboxThread } from "../inbox";
import { GRAPH, config, freshConnection, json, type Connection } from "./connectors";

const IG = `https://graph.instagram.com/${GRAPH}`;
const FB = `https://graph.facebook.com/${GRAPH}`;
const YT = "https://www.googleapis.com/youtube/v3";

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const byTime = (a: InboxMessage, b: InboxMessage) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
/** Graph returns "2026-10-20T10:00:00+0000"; make it a real ISO string so sorting and Date work everywhere. */
const isoOf = (v: unknown) => {
  const t = Date.parse(str(v).replace(/\+0000$/, "Z"));
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
};

function thread(base: Omit<InboxThread, "lastAt">): InboxThread | null {
  const messages = base.messages.filter((m) => m.text.trim()).sort(byTime);
  if (!messages.length) return null;
  return { ...base, messages, lastAt: messages[messages.length - 1]!.at };
}

// --- Instagram -----------------------------------------------------------------------

async function instagram(conn: Connection, accountId: string): Promise<InboxThread[]> {
  const tok = conn.accessToken;
  const me = await json(await fetch(`${IG}/me?${new URLSearchParams({ fields: "user_id,username", access_token: tok })}`), "Instagram profile");
  const myIds = new Set([str(me.user_id), str(me.id), str(conn.accountId)].filter(Boolean));
  const myName = str(me.username).toLowerCase();
  const mine = (from: any) => myIds.has(str(from?.id)) || (myName !== "" && str(from?.username).toLowerCase() === myName);
  const out: InboxThread[] = [];

  const [convs, media] = await Promise.all([
    json(
      await fetch(
        `${IG}/me/conversations?${new URLSearchParams({
          platform: "instagram",
          fields: "id,updated_time,participants,messages.limit(15){id,message,from,created_time}",
          limit: "25",
          access_token: tok,
        })}`,
      ),
      "Instagram messages",
    ),
    json(
      await fetch(
        `${IG}/me/media?${new URLSearchParams({
          fields: "id,caption,permalink,thumbnail_url,media_url,media_type,timestamp,comments.limit(25){id,text,username,timestamp,from,replies{id,text,username,timestamp,from}}",
          limit: "12",
          access_token: tok,
        })}`,
      ),
      "Instagram comments",
    ),
  ]);

  for (const c of convs?.data ?? []) {
    const them = (c.participants?.data ?? []).find((x: any) => !mine(x)) ?? {};
    const name = str(them.username || them.name) || "Instagram user";
    const t = thread({
      id: `instagram:dm:${c.id}`,
      platform: "instagram",
      accountId,
      kind: "dm",
      who: { name, handle: str(them.username) || undefined, url: them.username ? `https://www.instagram.com/${them.username}/` : undefined },
      messages: (c.messages?.data ?? []).map((m: any) => ({
        id: str(m.id),
        mine: mine(m.from),
        author: mine(m.from) ? str(me.username) : name,
        text: str(m.message) || (m.attachments ? "📎 Attachment" : ""),
        at: isoOf(m.created_time),
      })),
      replyTo: str(them.id),
      link: "https://www.instagram.com/direct/inbox/",
    });
    if (t && t.replyTo) out.push(t);
  }

  for (const m of media?.data ?? []) {
    const post = {
      title: str(m.caption).split("\n")[0]!.slice(0, 80) || (m.media_type === "VIDEO" ? "Reel" : "Post"),
      url: str(m.permalink) || undefined,
      thumbnail: str(m.thumbnail_url) || (m.media_type === "IMAGE" ? str(m.media_url) : "") || null,
    };
    for (const c of m.comments?.data ?? []) {
      if (mine(c.from) || myName === str(c.username).toLowerCase()) continue;
      const name = str(c.username) || "Instagram user";
      const t = thread({
        id: `instagram:comment:${c.id}`,
        platform: "instagram",
        accountId,
        kind: "comment",
        who: { name, handle: str(c.username) || undefined, url: c.username ? `https://www.instagram.com/${c.username}/` : undefined },
        post,
        messages: [c, ...(c.replies?.data ?? [])].map((r: any) => {
          const isMine = mine(r.from) || str(r.username).toLowerCase() === myName;
          return { id: str(r.id), mine: isMine, author: str(r.username) || name, text: str(r.text), at: isoOf(r.timestamp) };
        }),
        replyTo: str(c.id),
        link: post.url,
      });
      if (t) out.push(t);
    }
  }
  return out;
}

// --- Facebook Page ----------------------------------------------------------------------

function pageOf(conn: Connection) {
  const page = conn.pages?.find((p) => p.id === conn.accountId) ?? conn.pages?.[0];
  if (!page) throw new Error("That Facebook login doesn't manage any Pages. Personal profiles can't be read by apps — connect a Page.");
  return page;
}

async function facebook(conn: Connection, accountId: string): Promise<InboxThread[]> {
  const page = pageOf(conn);
  const mine = (from: any) => str(from?.id) === page.id;
  const out: InboxThread[] = [];

  const [convs, posts] = await Promise.all([
    json(
      await fetch(
        `${FB}/${page.id}/conversations?${new URLSearchParams({
          platform: "messenger",
          fields: "id,updated_time,link,participants,messages.limit(15){id,message,from,created_time}",
          limit: "25",
          access_token: page.token,
        })}`,
      ),
      "Facebook messages",
    ),
    json(
      await fetch(
        `${FB}/${page.id}/posts?${new URLSearchParams({
          fields: "id,message,permalink_url,full_picture,created_time,comments.limit(25).order(reverse_chronological){id,message,from,created_time,comments.limit(25){id,message,from,created_time}}",
          limit: "10",
          access_token: page.token,
        })}`,
      ),
      "Facebook comments",
    ),
  ]);

  for (const c of convs?.data ?? []) {
    const them = (c.participants?.data ?? []).find((x: any) => !mine(x)) ?? {};
    const name = str(them.name) || "Facebook user";
    const t = thread({
      id: `facebook:dm:${c.id}`,
      platform: "facebook",
      accountId,
      kind: "dm",
      who: { name },
      messages: (c.messages?.data ?? []).map((m: any) => ({
        id: str(m.id),
        mine: mine(m.from),
        author: mine(m.from) ? page.name : name,
        text: str(m.message) || "📎 Attachment",
        at: isoOf(m.created_time),
      })),
      replyTo: str(them.id),
      link: c.link ? `https://www.facebook.com${str(c.link)}` : "https://business.facebook.com/latest/inbox",
    });
    if (t && t.replyTo) out.push(t);
  }

  for (const p of posts?.data ?? []) {
    const post = { title: str(p.message).split("\n")[0]!.slice(0, 80) || "Page post", url: str(p.permalink_url) || undefined, thumbnail: str(p.full_picture) || null };
    for (const c of p.comments?.data ?? []) {
      if (mine(c.from)) continue;
      const name = str(c.from?.name) || "Facebook user";
      const t = thread({
        id: `facebook:comment:${c.id}`,
        platform: "facebook",
        accountId,
        kind: "comment",
        who: { name },
        post,
        messages: [c, ...(c.comments?.data ?? [])].map((r: any) => ({
          id: str(r.id),
          mine: mine(r.from),
          author: mine(r.from) ? page.name : str(r.from?.name) || name,
          text: str(r.message),
          at: isoOf(r.created_time),
        })),
        replyTo: str(c.id),
        link: post.url,
      });
      if (t) out.push(t);
    }
  }
  return out;
}

// --- YouTube ------------------------------------------------------------------------------

async function youtube(input: Connection, accountId: string): Promise<InboxThread[]> {
  const conn = await freshConnection(input);
  const channelId = str(conn.accountId);
  const headers = { Authorization: `Bearer ${conn.accessToken}` };
  const res = await json(
    await fetch(
      `${YT}/commentThreads?${new URLSearchParams({ part: "snippet,replies", allThreadsRelatedToChannelId: channelId, maxResults: "50", order: "time", textFormat: "plainText" })}`,
      { headers },
    ),
    "YouTube comments",
  );
  const items: any[] = res?.items ?? [];
  const videoIds = [...new Set(items.map((i) => str(i.snippet?.videoId)).filter(Boolean))].slice(0, 50);
  const videos = new Map<string, { title: string; thumbnail: string | null }>();
  if (videoIds.length) {
    const v = await json(await fetch(`${YT}/videos?${new URLSearchParams({ part: "snippet", id: videoIds.join(",") })}`, { headers }), "YouTube videos").catch(() => null);
    for (const x of v?.items ?? []) videos.set(str(x.id), { title: str(x.snippet?.title), thumbnail: x.snippet?.thumbnails?.default?.url ?? null });
  }
  const msg = (c: any): InboxMessage => {
    const s = c?.snippet ?? {};
    return { id: str(c?.id), mine: str(s.authorChannelId?.value) === channelId, author: str(s.authorDisplayName), text: str(s.textOriginal || s.textDisplay), at: isoOf(s.publishedAt) };
  };
  const out: InboxThread[] = [];
  for (const it of items) {
    const top = it.snippet?.topLevelComment;
    const first = msg(top);
    if (first.mine) continue;
    const videoId = str(it.snippet?.videoId);
    const v = videos.get(videoId);
    const author = top?.snippet ?? {};
    const t = thread({
      id: `youtube:comment:${it.id}`,
      platform: "youtube",
      accountId,
      kind: "comment",
      who: { name: first.author || "YouTube viewer", handle: str(author.authorDisplayName).replace(/^@/, "") || undefined, avatar: str(author.authorProfileImageUrl) || null, url: str(author.authorChannelUrl) || undefined },
      post: { title: v?.title || "Your video", url: videoId ? `https://www.youtube.com/watch?v=${videoId}&lc=${it.id}` : undefined, thumbnail: v?.thumbnail ?? null },
      messages: [first, ...(it.replies?.comments ?? []).map(msg)],
      replyTo: str(it.id),
      link: videoId ? `https://www.youtube.com/watch?v=${videoId}&lc=${it.id}` : "https://studio.youtube.com/",
    });
    if (t) out.push(t);
  }
  return out;
}

// --- public ----------------------------------------------------------------------------------

export async function readInbox(conn: Connection, accountId: string): Promise<InboxThread[]> {
  if (conn.platform === "instagram") return instagram(conn, accountId);
  if (conn.platform === "facebook") return facebook(conn, accountId);
  if (conn.platform === "youtube") return youtube(conn, accountId);
  throw new Error("TikTok doesn't let apps read messages or comments — use the Open TikTok tile.");
}

export interface ReplyInput {
  kind: "dm" | "comment";
  replyTo: string;
  text: string;
}

/** Send one reply; returns the platform's id for it. */
export async function sendReply(input: Connection, r: ReplyInput): Promise<{ id: string }> {
  if (input.platform === "instagram") {
    if (r.kind === "dm") {
      const res = await json(
        await fetch(`${IG}/me/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ recipient: { id: r.replyTo }, message: { text: r.text } }),
        }),
        "Instagram reply",
      );
      return { id: str(res.message_id ?? res.id) };
    }
    const res = await json(
      await fetch(`${IG}/${encodeURIComponent(r.replyTo)}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message: r.text, access_token: input.accessToken }).toString(),
      }),
      "Instagram reply",
    );
    return { id: str(res.id) };
  }

  if (input.platform === "facebook") {
    const page = pageOf(input);
    if (r.kind === "dm") {
      const res = await json(
        await fetch(`${FB}/${page.id}/messages?${new URLSearchParams({ access_token: page.token })}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient: { id: r.replyTo }, messaging_type: "RESPONSE", message: { text: r.text } }),
        }),
        "Messenger reply",
      );
      return { id: str(res.message_id ?? res.id) };
    }
    const res = await json(
      await fetch(`${FB}/${encodeURIComponent(r.replyTo)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message: r.text, access_token: page.token }).toString(),
      }),
      "Facebook reply",
    );
    return { id: str(res.id) };
  }

  if (input.platform === "youtube") {
    const conn = await freshConnection(input);
    const res = await json(
      await fetch(`${YT}/comments?part=snippet`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conn.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ snippet: { parentId: r.replyTo, textOriginal: r.text } }),
      }),
      "YouTube reply",
    );
    return { id: str(res.id) };
  }

  throw new Error("Replies from here work on Instagram, Facebook and YouTube.");
}

export interface InboxProblem {
  error: string;
  /** The login is gone or expired — connect again. */
  reconnect?: boolean;
  /** Connected, but without the inbox permission — reconnect from the inbox to add it. */
  needsInbox?: boolean;
}

/** Turn a platform error into words a person can act on. */
export function explain(platform: Connection["platform"], err: unknown): InboxProblem {
  const raw = err instanceof Error ? err.message : String(err);
  const name = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok" }[platform];
  if (/expired|invalid.*token|access_token_invalid|\b190\b|invalid_grant|UNAUTHENTICATED|Invalid Credentials|\(401\)/i.test(raw)) {
    return { error: `The ${name} login expired — connect it again.`, reconnect: true };
  }
  if (/outside of allowed window|2018278|2534022|24.?hour/i.test(raw)) {
    return { error: `${name} only lets apps reply within 24 hours of their last message. Open it in ${name} to answer.` };
  }
  if (/commentsDisabled|disabled comments/i.test(raw)) return { error: "Comments are turned off on that video." };
  if (/insufficientPermissions|insufficient.?scope|\(#10\)|\(#200\)|\(#230\)|\(#3\)|permission|scope|not authorized|Requires .* permission/i.test(raw)) {
    return { error: `${name} hasn't given the inbox permission yet. Press "Turn on inbox" — ${config(platform).inboxSetup}`, needsInbox: true };
  }
  if (/quota|rate|limit|too many|\(429\)|\(#4\)|\(#17\)|\(#32\)/i.test(raw)) {
    return { error: `${name} is rate-limiting right now. Try again in a few minutes.` };
  }
  return { error: `${name}: ${raw.replace(/^.*?failed \(\d+\):\s*/, "").slice(0, 200)}` };
}
