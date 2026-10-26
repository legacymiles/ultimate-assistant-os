"use client";

// ---------------------------------------------------------------------------
// The play shelf — a dense, database-style list of things you can play, with
// the selected one playable in place in a frame beside it.
//
// Used by Game Studio › Unfinished games and Website Redesigner › Showcase.
// One frame, one piece running at a time, and nothing runs until asked: two
// WebGL scenes never fight for the GPU, and opening the list never spins one
// up on its own. Every row carries its own action (Finish it / Use this idea),
// supplied by the caller.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import "./play-shelf.css";

export interface ShelfItem {
  slug: string;
  title: string;
  tag: string;
  overview: string;
  route: string;
  hue: number;
  /** Second and third columns — what the caller wants compared row to row. */
  cols: [string, string];
  /** Chips under the stage. */
  chips?: string[];
  /** Line under "Play it here" on the poster. */
  posterNote?: string;
}

export interface ShelfAction {
  label: string;
  /** Shown once done, e.g. "Queued ✓". The button stays disabled after. */
  doneLabel?: string;
  run: (item: ShelfItem) => Promise<string | void> | void;
}

export function PlayShelf({
  title,
  lede,
  count,
  heads,
  items,
  action,
  chipsLabel = "Notes",
}: {
  title: string;
  lede: string;
  count: string;
  heads: [string, string, string];
  items: ShelfItem[];
  action: ShelfAction;
  chipsLabel?: string;
}) {
  const [open, setOpen] = useState<string>(items[0]?.slug ?? "");
  const [playing, setPlaying] = useState<string | null>(null);
  const [acts, setActs] = useState<Record<string, { state: "busy" | "done" | "error"; note?: string }>>({});

  const current = items.find((g) => g.slug === open) ?? items[0];

  const run = async (it: ShelfItem) => {
    setActs((a) => ({ ...a, [it.slug]: { state: "busy" } }));
    try {
      const note = await action.run(it);
      setActs((a) => ({ ...a, [it.slug]: { state: "done", note: note || undefined } }));
    } catch (e) {
      setActs((a) => ({ ...a, [it.slug]: { state: "error", note: e instanceof Error ? e.message : "That didn't work." } }));
    }
  };

  return (
    <div className="ps">
      <header className="ps-head">
        <div>
          <h1>{title}</h1>
          <p>{lede}</p>
        </div>
        <span className="ps-count">{count}</span>
      </header>

      <div className="ps-grid">
        <div className="ps-table" role="list" aria-label={title}>
          <div className="ps-row ps-row--head" aria-hidden>
            <span>{heads[0]}</span>
            <span>{heads[1]}</span>
            <span>{heads[2]}</span>
            <span />
          </div>
          {items.map((it) => {
            const act = acts[it.slug];
            const on = it.slug === current?.slug;
            const done = act?.state === "done" && Boolean(action.doneLabel);
            return (
              <div
                key={it.slug}
                role="listitem"
                className="ps-row"
                data-on={on ? "1" : "0"}
                style={{ "--ps-hue": it.hue } as React.CSSProperties}
              >
                <button
                  type="button"
                  className="ps-name"
                  aria-pressed={on}
                  onClick={() => {
                    setOpen(it.slug);
                    if (playing && playing !== it.slug) setPlaying(null);
                  }}
                >
                  <span className="ps-dot" aria-hidden />
                  <span className="ps-name-t">
                    <b>{it.title}</b>
                    <small>{it.tag}</small>
                  </span>
                </button>
                <span className="ps-missing">{it.cols[0]}</span>
                <span className="ps-controls">{it.cols[1]}</span>
                <span className="ps-acts">
                  <button
                    type="button"
                    className="ps-btn"
                    onClick={() => {
                      setOpen(it.slug);
                      setPlaying(it.slug);
                    }}
                  >
                    <Icon.Play width={12} height={12} aria-hidden /> Play
                  </button>
                  <button
                    type="button"
                    className="ps-btn ps-btn--go"
                    onClick={() => run(it)}
                    disabled={act?.state === "busy" || done}
                  >
                    {act?.state === "busy" ? "Working…" : done ? action.doneLabel : action.label}
                  </button>
                </span>
                {act?.note && act.state !== "busy" && (
                  <span className="ps-note" role="status">
                    {act.note}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {current && (
          <section
            className="ps-stage"
            aria-label={`${current.title} — play it here`}
            style={{ "--ps-hue": current.hue } as React.CSSProperties}
          >
            <div className="ps-frame">
              {playing === current.slug ? (
                <iframe
                  key={current.slug}
                  src={current.route}
                  title={`${current.title} — playable preview`}
                  allow="fullscreen; gamepad; autoplay"
                />
              ) : (
                <button type="button" className="ps-poster" onClick={() => setPlaying(current.slug)}>
                  <span className="ps-poster-play" aria-hidden>
                    <Icon.Play width={22} height={22} />
                  </span>
                  <span className="ps-poster-t">Play {current.title} here</span>
                  {current.posterNote && <span className="ps-poster-s">{current.posterNote}</span>}
                </button>
              )}
            </div>
            <div className="ps-stage-foot">
              <div className="ps-stage-t">
                <b>{current.title}</b>
                <p>{current.overview}</p>
              </div>
              <div className="ps-stage-acts">
                {playing === current.slug && (
                  <button type="button" className="ps-btn" onClick={() => setPlaying(null)}>
                    Stop
                  </button>
                )}
                <a className="ps-btn" href={current.route} target="_blank" rel="noopener">
                  <Icon.Launch width={12} height={12} aria-hidden /> Open full screen
                </a>
              </div>
            </div>
            {current.chips?.length ? (
              <ul className="ps-todo" aria-label={chipsLabel}>
                {current.chips.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
