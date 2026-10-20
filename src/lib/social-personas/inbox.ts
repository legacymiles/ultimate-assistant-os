// ---------------------------------------------------------------------------
// Message Inbox — every DM and comment a persona gets, in one list, answered
// from one place.
//
// Two kinds of connector:
//   - LIVE: the platform's official API lets an app read and reply. Instagram
//     (DMs + comments, Business/Creator accounts), Facebook Pages (Messenger +
//     post comments) and YouTube (comments — YouTube has no DMs). These ride on
//     the persona's normal Connect login, with the inbox permissions added.
//   - OPEN: the platform gives apps no access to messages at all (Tinder,
//     TikTok, Snapchat, Hinge, Bumble…), and unofficial workarounds get
//     accounts banned. Those are one-tap "Open inbox" tiles instead.
//
// This file is pure (no fetch, no React) so it can be tested.
// ---------------------------------------------------------------------------

import type { InboxPlatform, Persona, PersonaInbox, SocialPlatform } from "./types";

export type InboxKind = "dm" | "comment";

export interface InboxMessage {
  id: string;
  /** Sent by the persona (us), not the other person. */
  mine: boolean;
  author: string;
  text: string;
  at: string;
}

/** One conversation (a DM thread) or one top-level comment with its replies. */
export interface InboxThread {
  /** Unique across platforms: "<platform>:<kind>:<platform id>". */
  id: string;
  platform: InboxPlatform;
  /** The persona account it came in on. */
  accountId: string;
  kind: InboxKind;
  who: { name: string; handle?: string; avatar?: string | null; url?: string };
  /** For comments: the post or video it's on. */
  post?: { title: string; url?: string; thumbnail?: string | null };
  /** Oldest first. */
  messages: InboxMessage[];
  lastAt: string;
  /** What a reply is sent to: the comment id, or the person's id for a DM. */
  replyTo: string;
  /** Where to open it on the platform itself. */
  link?: string;
  /** Example data shown before any account is connected. */
  sample?: boolean;
}

// --- connectors ---------------------------------------------------------------

export interface LiveConnector {
  platform: InboxPlatform;
  reads: string;
  /** What the account has to be, in plain words. */
  needs: string;
}

export const LIVE_CONNECTORS: LiveConnector[] = [
  { platform: "instagram", reads: "DMs + comments", needs: "a Business or Creator account" },
  { platform: "facebook", reads: "Page messages + comments", needs: "a Facebook Page you manage" },
  { platform: "youtube", reads: "Comments on your videos", needs: "your YouTube channel" },
];

export interface OpenApp {
  id: string;
  name: string;
  /** Where its messages live on the web; null = phone app only. */
  url: string | null;
  group: "Social" | "Dating" | "Chat";
  color: string;
  /** Why it can't be read here, shown on the tile. */
  why: string;
}

/** Apps with no message access for outside apps — opened in one tap instead. */
export const OPEN_APPS: OpenApp[] = [
  { id: "tiktok", name: "TikTok", url: "https://www.tiktok.com/messages", group: "Social", color: "#ff0050", why: "TikTok gives apps no access to DMs or comments" },
  { id: "x", name: "X", url: "https://x.com/messages", group: "Social", color: "#a3a3a3", why: "X charges for message access" },
  { id: "threads", name: "Threads", url: "https://www.threads.com/activity", group: "Social", color: "#a3a3a3", why: "Opens your Threads activity" },
  { id: "messenger", name: "Messenger", url: "https://www.messenger.com/", group: "Social", color: "#0a7cff", why: "Personal profiles can't be read by apps — only Pages" },
  { id: "instagram-personal", name: "Instagram (personal)", url: "https://www.instagram.com/direct/inbox/", group: "Social", color: "#d62976", why: "Personal accounts can't be read by apps — switch to Creator to use the live inbox" },
  { id: "linkedin", name: "LinkedIn", url: "https://www.linkedin.com/messaging/", group: "Social", color: "#0a66c2", why: "LinkedIn gives apps no message access" },
  { id: "reddit", name: "Reddit", url: "https://www.reddit.com/message/inbox/", group: "Social", color: "#ff4500", why: "Opens your Reddit inbox" },
  { id: "tinder", name: "Tinder", url: "https://tinder.com/app/matches", group: "Dating", color: "#fd5068", why: "Tinder has no API for outside apps" },
  { id: "bumble", name: "Bumble", url: "https://bumble.com/app", group: "Dating", color: "#ffc629", why: "Bumble has no API for outside apps" },
  { id: "hinge", name: "Hinge", url: null, group: "Dating", color: "#a3a3a3", why: "Hinge is phone-app only" },
  { id: "snapchat", name: "Snapchat", url: "https://www.snapchat.com/web", group: "Chat", color: "#fffc00", why: "Snapchat gives apps no chat access" },
  { id: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com/", group: "Chat", color: "#25d366", why: "Personal WhatsApp can't be read by apps" },
  { id: "telegram", name: "Telegram", url: "https://web.telegram.org/", group: "Chat", color: "#2aabee", why: "Opens Telegram Web" },
  { id: "discord", name: "Discord", url: "https://discord.com/channels/@me", group: "Chat", color: "#5865f2", why: "Discord only lets bots read messages" },
];

export const openApp = (id: string): OpenApp | undefined => OPEN_APPS.find((a) => a.id === id);

// --- persona inbox state ----------------------------------------------------------

/** Keep the read-marks small: the synced blob shouldn't grow forever. */
export const MAX_SEEN = 600;

export function inboxOf(p: Persona): PersonaInbox {
  const i = p.inbox;
  return {
    apps: Array.isArray(i?.apps) ? i.apps.filter((x) => typeof x === "string") : [],
    seen: i?.seen && typeof i.seen === "object" ? i.seen : {},
  };
}

/** Turn an "Open inbox" tile on or off (no duplicates). */
export function toggleApp(inbox: PersonaInbox, id: string): PersonaInbox {
  return inbox.apps.includes(id) ? { ...inbox, apps: inbox.apps.filter((x) => x !== id) } : { ...inbox, apps: [...inbox.apps, id] };
}

/** Mark threads read up to their newest message. Oldest read-marks fall off past MAX_SEEN. */
export function markSeen(inbox: PersonaInbox, threads: Pick<InboxThread, "id" | "lastAt">[]): PersonaInbox {
  const seen = { ...inbox.seen };
  let changed = false;
  for (const t of threads) {
    if (!seen[t.id] || seen[t.id]! < t.lastAt) {
      seen[t.id] = t.lastAt;
      changed = true;
    }
  }
  if (!changed) return inbox;
  const entries = Object.entries(seen);
  const kept = entries.length > MAX_SEEN ? Object.fromEntries(entries.sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, MAX_SEEN)) : seen;
  return { ...inbox, seen: kept };
}

// --- threads -------------------------------------------------------------------------

/** The last message is from them — it's waiting on the persona. */
export function awaitingReply(t: InboxThread): boolean {
  const last = t.messages[t.messages.length - 1];
  return Boolean(last && !last.mine);
}

export function isUnread(t: InboxThread, seen: Record<string, string>): boolean {
  if (!awaitingReply(t)) return false;
  const s = seen[t.id];
  return !s || s < t.lastAt;
}

/** Newest first. */
export function sortThreads(list: InboxThread[]): InboxThread[] {
  return [...list].sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

export interface ThreadFilter {
  platform?: InboxPlatform | "all";
  kind?: InboxKind | "all";
  unreadOnly?: boolean;
  q?: string;
}

export function filterThreads(list: InboxThread[], f: ThreadFilter, seen: Record<string, string>): InboxThread[] {
  const q = f.q?.trim().toLowerCase() ?? "";
  return list.filter(
    (t) =>
      (!f.platform || f.platform === "all" || t.platform === f.platform) &&
      (!f.kind || f.kind === "all" || t.kind === f.kind) &&
      (!f.unreadOnly || isUnread(t, seen)) &&
      (!q ||
        t.who.name.toLowerCase().includes(q) ||
        (t.who.handle ?? "").toLowerCase().includes(q) ||
        (t.post?.title ?? "").toLowerCase().includes(q) ||
        t.messages.some((m) => m.text.toLowerCase().includes(q))),
  );
}

/**
 * Fold a fresh fetch into what's on screen. The fetch wins, except a reply
 * sent from here that the platform doesn't list yet is kept, so a sent message
 * never blinks out.
 */
export function mergeThreads(prev: InboxThread[], fresh: InboxThread[], accountIds?: string[]): InboxThread[] {
  const byId = new Map(prev.map((t) => [t.id, t]));
  const out = new Map<string, InboxThread>();
  // Threads from accounts that weren't fetched this time stay as they were.
  if (accountIds) for (const t of prev) if (!accountIds.includes(t.accountId)) out.set(t.id, t);
  for (const t of fresh) {
    const old = byId.get(t.id);
    const pending = (old?.messages ?? []).filter((m) => m.id.startsWith("local_") && !t.messages.some((x) => x.mine && x.text.trim() === m.text.trim()));
    const messages = pending.length ? [...t.messages, ...pending].sort((a, b) => (a.at < b.at ? -1 : 1)) : t.messages;
    out.set(t.id, { ...t, messages, lastAt: messages[messages.length - 1]?.at ?? t.lastAt });
  }
  return sortThreads([...out.values()]);
}

/** Add a reply the persona just sent. */
export function withSent(t: InboxThread, text: string, author: string, at: string, id = `local_${at}`): InboxThread {
  return { ...t, messages: [...t.messages, { id, mine: true, author, text, at }], lastAt: at };
}

/** Unread counts per platform plus the total, for the tab badge and filter chips. */
export function unreadCounts(list: InboxThread[], seen: Record<string, string>): { total: number } & Partial<Record<InboxPlatform, number>> {
  const out: { total: number } & Partial<Record<InboxPlatform, number>> = { total: 0 };
  for (const t of list) {
    if (!isUnread(t, seen)) continue;
    out.total++;
    out[t.platform] = (out[t.platform] ?? 0) + 1;
  }
  return out;
}

// --- replying ---------------------------------------------------------------------------

/** Longest reply each place takes. */
export function replyLimit(p: InboxPlatform, kind: InboxKind): number {
  if (kind === "dm") return 1000;
  if (p === "instagram") return 2200;
  if (p === "youtube") return 10_000;
  return 8000;
}

const DAY = 24 * 3_600_000;

/**
 * Instagram and Messenger only let an app reply to a DM within 24 hours of the
 * person's last message (the platforms' rule). Returns why a reply can't be
 * sent from here, or null when it can.
 */
export function replyBlocker(t: InboxThread, now = Date.now()): string | null {
  if (t.sample) return "This is an example — connect an account to answer real messages.";
  if (t.kind !== "dm") return null;
  const lastTheirs = [...t.messages].reverse().find((m) => !m.mine);
  if (!lastTheirs) return null;
  if (now - Date.parse(lastTheirs.at) > DAY) {
    const app = t.platform === "instagram" ? "Instagram" : "Messenger";
    return `${app} only lets apps reply within 24 hours of their last message. Open it in ${app} to answer.`;
  }
  return null;
}

export function checkReply(t: InboxThread, text: string, now = Date.now()): string | null {
  const block = replyBlocker(t, now);
  if (block) return block;
  const s = text.trim();
  if (!s) return "Write a reply first.";
  const max = replyLimit(t.platform, t.kind);
  if (s.length > max) return `That's ${s.length} characters — ${t.kind === "dm" ? "DMs" : "replies"} here take up to ${max}.`;
  return null;
}

/** "3m", "5h", "2d", or a date — compact enough for a dense list. */
export function ago(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)}h`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// --- example threads ---------------------------------------------------------------------

/**
 * What the inbox looks like before anything is connected (the app works with
 * no keys — checklist R4). Clearly marked as examples, never sendable.
 */
export function sampleThreads(p: Persona, now = Date.now()): InboxThread[] {
  const at = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  const topic = p.niche ? p.niche.toLowerCase() : "your content";
  const make = (
    id: string,
    platform: InboxPlatform,
    kind: InboxKind,
    name: string,
    handle: string,
    msgs: [boolean, string, number][],
    post?: string,
  ): InboxThread => {
    const messages = msgs.map(([mine, text, m], i) => ({ id: `${id}_${i}`, mine, author: mine ? p.name : name, text, at: at(m) }));
    return {
      id: `sample:${id}`,
      platform,
      accountId: "",
      kind,
      who: { name, handle },
      post: post ? { title: post } : undefined,
      messages,
      lastAt: messages[messages.length - 1]!.at,
      replyTo: "",
      sample: true,
    };
  };
  return sortThreads([
    make("ig1", "instagram", "dm", "Jordan Lee", "jordan.creates", [[false, `Yo I've been watching your ${topic} posts all week 🔥 do you do collabs?`, 14]]),
    make("yt1", "youtube", "comment", "Maya R", "mayarvids", [[false, "This one deserves way more views. What camera do you use?", 52]], "Latest upload"),
    make("fb1", "facebook", "comment", "Chris Park", "", [[false, "Shared this with my group, when's the next one?", 180], [true, "Next one drops Friday 🙌", 170], [false, "Bet, I'll be there", 95]], "Page post"),
    make("ig2", "instagram", "comment", "sam.daily", "sam.daily", [[false, "How long did this take you to make??", 300]], "Reel"),
    make("fb2", "facebook", "dm", "Taylor B", "", [[false, "Hi! Is this account open for brand deals?", 60 * 30]]),
  ]);
}

/** Display name for any inbox source, live or open. */
export function sourceName(p: SocialPlatform | string): string {
  return ({ instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" } as Record<string, string>)[p] ?? openApp(p)?.name ?? p;
}
