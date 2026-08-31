"use client";

// ---------------------------------------------------------------------------
// One tile, and the playback ladder.
//
//   rung 1  local mp4   instant, no network, no branding — if it was cached
//   rung 2  youtube     mounted ONLY while active; the day-one path
//   rung 3  poster      the source died, and the tile says so
//
// The load-bearing rule of the whole app lives here: a player is mounted only
// when `active` is true. Every other tile on the wall is a single <img>. That
// is what lets 200 tiles drift at 60fps, and what stops a mouse crossing the
// wall from spawning twenty YouTube players.
// ---------------------------------------------------------------------------

import type { Dance } from "@/lib/dances/types";

function embedUrl(ref: string): string {
  const p = new URLSearchParams({
    autoplay: "1",
    // Autoplay with sound is blocked by every browser until the page has been
    // interacted with. Muted autoplay always works, so the wall is never silent
    // *and* stalled — it just starts quiet.
    mute: "1",
    controls: "0",
    modestbranding: "1",
    playsinline: "1",
    rel: "0",
    loop: "1",
    // `loop` is ignored on a single video unless the playlist is that video.
    playlist: ref,
  });
  return `https://www.youtube-nocookie.com/embed/${ref}?${p}`;
}

interface Props {
  dance: Dance;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
}

export function DanceTile({ dance, active, onEnter, onLeave, onOpen }: Props) {
  const v = dance.video;
  const rated = dance.score !== undefined;

  return (
    <button
      type="button"
      className={`dance-tile${active ? " is-active" : ""}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onOpen}
      aria-label={`${dance.name}${dance.song ? ` — ${dance.song}` : ""}`}
    >
      <span className="dance-tile__media">
        {v?.poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- i.ytimg.com is
          // a stable CDN and next/image would need a remote-pattern allowlist
          // for zero benefit on a poster that is already the right size.
          //
          // NOT loading="lazy": inside a `width: max-content` track that is
          // moved by transform, the lazy intersection check never fires and
          // every poster stays pending forever — a wall of black rectangles.
          // Verified in the browser: the same images load instantly as eager.
          // The cost is bounded anyway, because the duplicated copy of each row
          // reuses the same URLs, so the browser fetches each poster once.
          <img src={v.poster} alt="" decoding="async" fetchPriority="low" />
        ) : (
          <span className="dance-tile__blank">no video</span>
        )}

        {active && v?.kind === "local" && (
          <video
            className="dance-tile__player"
            src={`/dances/${v.ref}`}
            autoPlay
            muted
            loop
            playsInline
          />
        )}
        {active && v?.kind === "youtube" && (
          <iframe
            className="dance-tile__player"
            src={embedUrl(v.ref)}
            title={dance.name}
            allow="autoplay; encrypted-media"
            frameBorder="0"
          />
        )}
      </span>

      <span className="dance-tile__meta">
        <span className="dance-tile__name">
          {dance.name}
          {dance.nameProvisional && <em className="dance-tile__draft">draft name</em>}
        </span>
        {dance.song && <span className="dance-tile__song">{dance.song}</span>}
      </span>

      <span className={`dance-tile__score${rated ? "" : " is-unrated"}`}>
        {rated ? dance.score : "—"}
      </span>

      {dance.source === "daily" && <span className="dance-tile__flag">daily</span>}
    </button>
  );
}
