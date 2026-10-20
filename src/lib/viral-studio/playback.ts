// ---------------------------------------------------------------------------
// What a tile actually mounts: the poster before hover, the player during it.
// Pure, so the exact embed parameters are tested rather than eyeballed.
// ---------------------------------------------------------------------------

import type { Clip } from "./types";

export function mediaUrl(key: string): string {
  return `/api/viral-studio/media?key=${encodeURIComponent(key)}`;
}

/** The still a tile shows when nothing is playing. */
export function posterUrl(clip: Pick<Clip, "url" | "play">): string {
  const p = clip.play;
  if (p.kind === "file" && p.posterKey) return mediaUrl(p.posterKey);
  if (p.kind === "youtube") return `https://i.ytimg.com/vi/${p.ref}/hqdefault.jpg`;
  // TikTok and Instagram cover links are signed and expire within days, so the
  // tile asks our route for a fresh one each time instead of storing it.
  return `/api/viral-studio/poster?u=${encodeURIComponent(clip.url)}`;
}

/** An iframe src for the embed kinds, or null when the tile plays a <video> (or nothing). */
export function embedUrl(clip: Pick<Clip, "play">, sound: boolean): string | null {
  const p = clip.play;
  if (p.kind === "youtube") {
    const q = new URLSearchParams({
      autoplay: "1",
      mute: sound ? "0" : "1",
      controls: "0",
      modestbranding: "1",
      playsinline: "1",
      rel: "0",
      loop: "1",
      // `loop` only works on a single video when the playlist is that video.
      playlist: p.ref,
    });
    return `https://www.youtube-nocookie.com/embed/${p.ref}?${q}`;
  }
  if (p.kind === "tiktok") {
    const q = new URLSearchParams({
      autoplay: "1",
      loop: "1",
      muted: sound ? "0" : "1",
      controls: "0",
      progress_bar: "0",
      play_button: "0",
      volume_control: "0",
      fullscreen_button: "0",
      timestamp: "0",
      music_info: "0",
      description: "0",
      rel: "0",
      native_context_menu: "0",
      closed_caption: "0",
    });
    return `https://www.tiktok.com/player/v1/${p.ref}?${q}`;
  }
  if (p.kind === "instagram") return `https://www.instagram.com/reel/${p.ref}/embed/`;
  return null;
}

/** Why a tile can't play inline, in words — or null when it can. */
export function playbackLimit(clip: Pick<Clip, "play">): string | null {
  if (clip.play.kind === "instagram") return "Instagram asks for a tap to play";
  if (clip.play.kind === "none") return "Opens on the original site";
  return null;
}
