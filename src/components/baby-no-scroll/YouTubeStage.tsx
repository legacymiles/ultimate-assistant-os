"use client";

// ---------------------------------------------------------------------------
// The video, with every control taken off it, and a shield over what is left.
//
// There is a circularity in locking a video down, and it is the reason this
// component loads YouTube's player script rather than just dropping an iframe
// in: the shield that stops a baby pausing the video would also stop a parent
// pressing play on one that never autoplayed. With the player script, the app
// can press play itself — and a tap on the shield becomes "carry on", which is
// the one thing a baby's tap on the picture should ever mean.
//
// With the script unavailable (offline, blocked, a slow network), it falls back
// to a plain iframe with autoplay parameters. That still plays nearly
// everywhere; it just cannot be rescued if it does not.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  PLAYER_HOST,
  embedParams,
  embedUrl,
  loadPlayerApi,
} from "@/lib/baby-no-scroll/youtube";
import type { Target } from "@/lib/baby-no-scroll/types";

/** The handful of player methods this app has any business calling. */
interface Player {
  playVideo?: () => void;
  getPlayerState?: () => number;
  destroy?: () => void;
}

interface Props {
  target: Target;
  loop: boolean;
  /** Called on every tap on the shield, so the shell can repair fullscreen. */
  onShieldTap: () => void;
}

/** YouTube's own state numbers; only these two matter here. */
const PAUSED = 2;
const CUED = 5;

export function YouTubeStage({ target, loop, onShieldTap }: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const player = useRef<Player | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let dead = false;
    void loadPlayerApi().then((YT) => {
      if (dead) return;
      const el = mount.current;
      if (!YT || !el) {
        setFallback(true);
        return;
      }
      try {
        player.current = new YT.Player(el, {
          host: PLAYER_HOST,
          width: "100%",
          height: "100%",
          videoId: target.kind === "video" ? target.id : undefined,
          playerVars: embedParams(target, {
            loop,
            origin: window.location.origin,
          }),
          events: {
            onReady: (e: { target: Player }) => e.target.playVideo?.(),
            // A video that fails — removed, private, blocked in this country —
            // must not leave a black screen a parent has to diagnose. Falling
            // back to the plain iframe at least shows YouTube's own message.
            onError: () => setFallback(true),
          },
        }) as Player;
      } catch {
        setFallback(true);
      }
    });
    return () => {
      dead = true;
      try {
        player.current?.destroy?.();
      } catch {
        // A player torn down mid-load throws; there is nothing to do about it.
      }
      player.current = null;
    };
  }, [target, loop]);

  const onTap = (e: React.PointerEvent) => {
    e.preventDefault();
    onShieldTap();
    const p = player.current;
    const state = p?.getPlayerState?.();
    // Only ever a resume, never a pause: the tap has one meaning.
    if (state === PAUSED || state === CUED) p?.playVideo?.();
  };

  return (
    <div className="bns-video">
      {fallback ? (
        <iframe
          title="Video"
          src={embedUrl(target, { loop })}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div ref={mount} />
      )}

      {/* The shield. Covers the picture completely, so nothing a baby does can
          reach YouTube's own surface — not the controls, not the title, not the
          channel link, not the end-of-video wall of other videos. */}
      <div className="bns-shield" onPointerDown={onTap} aria-hidden />
    </div>
  );
}
