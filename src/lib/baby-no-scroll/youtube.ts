// ---------------------------------------------------------------------------
// Reading a YouTube link, and building the embed a locked screen can show.
//
// A parent pastes whatever the phone's share sheet gave them: a youtu.be link,
// a Shorts link, a watch URL with a playlist hanging off it, a bare id,
// sometimes a playlist on its own. All of those are the same intention, so all
// of them parse here rather than being the parent's problem.
//
// Nothing in this file needs a key. The embed is the public iframe player, and
// the only reason the app also loads YouTube's player script (loadPlayerApi) is
// that a locked screen cannot tap Play: the shield that stops a baby pausing
// the video would also stop a parent starting it.
// ---------------------------------------------------------------------------

import type { Target } from "./types";

/** Exactly eleven characters of YouTube's id alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Playlist ids are longer and open with a known pair, mixes included. */
const LIST_ID = /^(?:PL|UU|LL|FL|OL|RD|TL)[A-Za-z0-9_-]{10,}$/;

const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

function videoFrom(id: string | null | undefined, list?: string | null): Target | null {
  if (!id || !VIDEO_ID.test(id)) return null;
  return list && LIST_ID.test(list) ? { kind: "video", id, list } : { kind: "video", id };
}

/**
 * Whatever the parent pasted, as a thing to play — or null, which the setup
 * screen says out loud rather than quietly showing a blank player.
 */
export function parseYouTube(input: string): Target | null {
  const raw = input.trim();
  if (!raw) return null;

  // A bare id, typed or pasted out of another app.
  if (VIDEO_ID.test(raw)) return { kind: "video", id: raw };
  if (LIST_ID.test(raw)) return { kind: "playlist", id: raw };

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname)) return null;

  const list = url.searchParams.get("list");
  const path = url.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);

  // youtu.be/ID
  if (url.hostname.endsWith("youtu.be")) {
    return videoFrom(segments[0], list);
  }

  // /watch?v=ID, with or without a list
  if (path === "/watch") {
    const direct = videoFrom(url.searchParams.get("v"), list);
    if (direct) return direct;
    // A watch URL that lost its v= but kept its list still plays.
    return list && LIST_ID.test(list) ? { kind: "playlist", id: list } : null;
  }

  // /playlist?list=ID
  if (path === "/playlist") {
    return list && LIST_ID.test(list) ? { kind: "playlist", id: list } : null;
  }

  // /shorts/ID, /embed/ID, /live/ID, /v/ID
  if (segments.length >= 2 && ["shorts", "embed", "live", "v"].includes(segments[0])) {
    return videoFrom(segments[1], list);
  }

  return null;
}

/** The host the player is served from — the no-cookie one, deliberately. */
export const PLAYER_HOST = "https://www.youtube-nocookie.com";

export interface EmbedOptions {
  /** Loop a single video forever instead of letting YouTube choose what is next. */
  loop: boolean;
  /** Where the page is served from, which the player wants told. */
  origin?: string;
}

/**
 * The player's parameters. Every one of these exists to take something away:
 * the controls, the keyboard, the fullscreen button, the related-video wall,
 * the annotations. What is left is a picture that plays.
 */
export function embedParams(target: Target, opts: EmbedOptions): Record<string, string> {
  const p: Record<string, string> = {
    autoplay: "1",
    playsinline: "1",
    controls: "0",
    disablekb: "1",
    fs: "0",
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3",
  };
  if (opts.origin) p.origin = opts.origin;

  const list = target.kind === "playlist" ? target.id : target.list;
  if (list) {
    p.list = list;
    p.listType = "playlist";
    if (opts.loop) p.loop = "1";
    return p;
  }

  if (opts.loop) {
    // A single video only loops if it is also named as its own playlist. That
    // is YouTube's rule, not a trick, and leaving it out is why "loop" quietly
    // does nothing on most embeds.
    p.loop = "1";
    p.playlist = target.id;
  }
  return p;
}

/** A plain iframe URL, used when the player script cannot be loaded at all. */
export function embedUrl(target: Target, opts: EmbedOptions): string {
  const params = new URLSearchParams(embedParams(target, opts));
  const path = target.kind === "playlist" ? "videoseries" : target.id;
  return `${PLAYER_HOST}/embed/${path}?${params.toString()}`;
}

/** A short label for the setup screen, so a parent sees what was understood. */
export function describeTarget(target: Target): string {
  if (target.kind === "playlist") return `Playlist ${target.id}`;
  return target.list ? `Video ${target.id} · playlist ${target.list}` : `Video ${target.id}`;
}

// --- the player script ------------------------------------------------------

interface YTGlobal {
  Player: new (el: HTMLElement, cfg: unknown) => unknown;
}

declare global {
  interface Window {
    YT?: YTGlobal;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let pending: Promise<YTGlobal | null> | null = null;

/**
 * YouTube's player script, once per page, resolving null rather than throwing
 * when it cannot be had — offline, blocked, or a network that eats it. The
 * caller then falls back to a plain iframe, which still plays in most places.
 */
export function loadPlayerApi(timeoutMs = 8000): Promise<YTGlobal | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;

  pending = new Promise<YTGlobal | null>((resolve) => {
    const done = (v: YTGlobal | null) => {
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      done(window.YT ?? null);
    };

    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => done(null);
    document.head.appendChild(s);
  });
  return pending;
}
