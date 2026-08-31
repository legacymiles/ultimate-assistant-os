"use client";

// ---------------------------------------------------------------------------
// The Dance of the Day band.
//
// Shows exactly what happened, including when nothing did. "No verified pick
// today" is a real, honest state of this feature — a day where the search found
// nothing playable — and it gets its own presentation rather than an empty box
// that reads like a bug.
// ---------------------------------------------------------------------------

import type { DailyPick } from "@/lib/dances/types";

interface Props {
  picks: DailyPick[];
  loading: boolean;
  aiAvailable: boolean;
  persisted: boolean;
  onOpen: (danceId: string) => void;
  onAddManually: () => void;
}

function prettyDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function DanceOfTheDay({
  picks,
  loading,
  aiAvailable,
  persisted,
  onOpen,
  onAddManually,
}: Props) {
  const today = picks[0];
  const history = picks.slice(1, 8);

  return (
    <section className="dotd">
      <header className="dotd__head">
        <h2>Dance of the Day</h2>
        <p>
          One new dance a day, found and verified automatically.
          {!aiAvailable && (
            <>
              {" "}
              Running keyless — set <code>OPENROUTER_API_KEY</code> for properly named picks.
            </>
          )}
          {!persisted && <> Picks aren&apos;t being saved: this filesystem is read-only.</>}
        </p>
      </header>

      {loading && <div className="dotd__card dotd__card--empty">Looking for today&apos;s dance…</div>}

      {!loading && !today && (
        <div className="dotd__card dotd__card--empty">
          <p>No pick yet today.</p>
          <button type="button" className="btn" onClick={onAddManually}>
            Add one yourself
          </button>
        </div>
      )}

      {!loading && today?.status === "none" && (
        <div className="dotd__card dotd__card--empty">
          <p>
            <strong>No verified pick for {prettyDate(today.date)}.</strong>{" "}
            {today.reason ?? "Nothing playable turned up."}
          </p>
          <p className="dotd__fineprint">
            A dance with no playable video is skipped rather than added as a dead tile.
          </p>
          <button type="button" className="btn" onClick={onAddManually}>
            Add one yourself
          </button>
        </div>
      )}

      {!loading && today?.status === "ok" && today.dance && (
        <button
          type="button"
          className="dotd__card"
          onClick={() => today.dance && onOpen(today.dance.id)}
        >
          <span className="dotd__media">
            {today.dance.video?.ref && (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${today.dance.video.ref}?autoplay=1&mute=1&controls=0&loop=1&playlist=${today.dance.video.ref}&modestbranding=1&playsinline=1&rel=0`}
                title={today.dance.name}
                allow="autoplay; encrypted-media"
                frameBorder="0"
              />
            )}
          </span>
          <span className="dotd__body">
            <span className="dotd__date">{prettyDate(today.date)}</span>
            <span className="dotd__name">
              {today.dance.name}
              {today.dance.nameProvisional && <em className="dotd__draft">draft name</em>}
            </span>
            {today.dance.song && (
              <span className="dotd__song">
                {today.dance.song}
                {today.dance.artist ? ` · ${today.dance.artist}` : ""}
              </span>
            )}
            {today.dance.why && <span className="dotd__why">{today.dance.why}</span>}
            <span className="dotd__cta">Open to score it →</span>
          </span>
        </button>
      )}

      {history.length > 0 && (
        <ol className="dotd__history">
          {history.map((p) => (
            <li key={p.date}>
              {p.status === "ok" && p.dance ? (
                <button type="button" onClick={() => p.dance && onOpen(p.dance.id)}>
                  {p.dance.video?.poster && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.dance.video.poster} alt="" decoding="async" />
                  )}
                  <span>{p.dance.name}</span>
                  <small>{prettyDate(p.date)}</small>
                </button>
              ) : (
                <div className="dotd__history-none">
                  <span>no pick</span>
                  <small>{prettyDate(p.date)}</small>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
