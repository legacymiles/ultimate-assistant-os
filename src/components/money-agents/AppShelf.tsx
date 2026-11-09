"use client";

// ---------------------------------------------------------------------------
// The app shelf — the studio's seven parts shown as APPS, not a strip of text
// tabs (the client's ask, Nov 2026).
//
// Two pieces, one list (`src/lib/money-agents/apps.ts`):
//   • The dock: a row of app tiles, always there. Each one has its own glyph
//     (a tiny live diagram of what the app does), its name, and the live line
//     that says where the work is — "3 waiting on you", "$1,240 paid this
//     month". The open app is lit in its own accent and points at the content
//     below it.
//   • All apps: the dock opens into a launcher — the same seven as big tiles
//     with the one line that says what each is for.
//
// Design skill: interactive-web-studio, on the studio's existing palette — the
// glyph moves, the cursor leaves a sheen on the tile it is over, and nothing
// moves behind any text. It is still a real tablist underneath: arrow keys walk
// it, the glyphs are aria-hidden, every tile says its own count out loud.
// ---------------------------------------------------------------------------

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { STUDIO_APPS, appBadge, appStat, type StudioAppId, type StudioCounts } from "@/lib/money-agents/apps";

export function AppShelf({
  current,
  counts,
  onOpen,
}: {
  current: StudioAppId;
  counts: StudioCounts;
  onOpen: (id: StudioAppId) => void;
}) {
  const [openAll, setOpenAll] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  /** Set when the arrow keys moved the selection, so focus follows it. */
  const byKey = useRef(false);

  // Esc closes the launcher, the way every other sheet in the hub does.
  useEffect(() => {
    if (!openAll) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAll(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openAll]);

  // The open tile scrolls itself into view on a phone, so the shelf never hides
  // which app you are in — and takes the focus ring with it when the arrow keys
  // were what moved it.
  useEffect(() => {
    const el = dock.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (byKey.current) {
      byKey.current = false;
      el?.focus();
    }
  }, [current]);

  /** Arrow keys walk the dock, the way a tablist is meant to. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = STUDIO_APPS.findIndex((a) => a.id === current);
    const last = STUDIO_APPS.length - 1;
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "ArrowLeft" ? Math.max(0, i - 1) : Math.min(last, i + 1);
    if (next === i) return;
    byKey.current = true;
    onOpen(STUDIO_APPS[next].id);
  };

  const open = (id: StudioAppId) => {
    setOpenAll(false);
    onOpen(id);
  };

  return (
    <div className="mas-shelf">
      <div className="mas-shelf-row">
        <div className="mas-dock" role="tablist" aria-label="Money Agent Studio apps" ref={dock} onKeyDown={onKeyDown}>
          {STUDIO_APPS.map((app) => {
            const stat = appStat(app.id, counts);
            const badge = appBadge(app.id, counts);
            const on = app.id === current;
            return (
              <button
                key={app.id}
                type="button"
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                className="mas-app"
                data-accent={app.accent}
                data-on={on}
                data-hot={stat.hot}
                onPointerMove={sheen}
                onClick={() => open(app.id)}
              >
                <span className="mas-app-sheen" aria-hidden />
                <span className="mas-app-icon" aria-hidden>
                  <AppGlyph id={app.id} />
                </span>
                <span className="mas-app-name">{app.name}</span>
                <span className="mas-app-stat">
                  <b>{stat.value}</b> {stat.label}
                </span>
                {badge > 0 && (
                  <span className="mas-app-badge" aria-hidden>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="mas-shelf-all"
          aria-expanded={openAll}
          aria-controls="mas-launcher"
          /* The words hide on a phone, so the name is spelled out here too. */
          aria-label={openAll ? "Close the app launcher" : "All apps"}
          onClick={() => setOpenAll((v) => !v)}
        >
          <span className="mas-shelf-grid" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          <span className="mas-shelf-all-text">{openAll ? "Close" : "All apps"}</span>
        </button>
      </div>

      {openAll && (
        <div className="mas-launcher" id="mas-launcher">
          {STUDIO_APPS.map((app) => {
            const stat = appStat(app.id, counts);
            const on = app.id === current;
            return (
              <button
                key={app.id}
                type="button"
                className="mas-big"
                data-accent={app.accent}
                data-on={on}
                aria-current={on ? "true" : undefined}
                onPointerMove={sheen}
                onClick={() => open(app.id)}
              >
                <span className="mas-app-sheen" aria-hidden />
                <span className="mas-big-top">
                  <span className="mas-app-icon" aria-hidden>
                    <AppGlyph id={app.id} />
                  </span>
                  <span className="mas-big-head">
                    <strong>{app.name}</strong>
                    <small>
                      <b>{stat.value}</b> {stat.label}
                    </small>
                  </span>
                  {on && <span className="mas-big-open">Open</span>}
                </span>
                <span className="mas-big-what">{app.what}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The cursor leaves a soft light on the tile it is over. Two custom properties
 * on the element itself, so no React state and no re-render per mouse move.
 */
function sheen(e: ReactPointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
}

/**
 * One glyph per app, each a small diagram of the thing it does rather than a
 * stock icon: the radar sweeps, the pipeline carries a token, the check draws
 * itself, the agents orbit, the earnings bars grow. They move only on the open
 * tile and under the cursor — and not at all under reduced motion.
 */
function AppGlyph({ id }: { id: StudioAppId }) {
  const base = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    focusable: "false" as const,
    "aria-hidden": true,
  };
  switch (id) {
    case "radar":
      return (
        <svg {...base} className="mas-g">
          <circle cx="12" cy="12" r="9" opacity="0.4" />
          <circle cx="12" cy="12" r="5.2" opacity="0.5" />
          <g className="mas-g-sweep">
            {/* the beam, so this reads as a dish and not a power button */}
            <path d="M12 12V3.2A8.8 8.8 0 0 1 18.3 5.9Z" fill="currentColor" stroke="none" opacity="0.26" />
            <path d="M12 12 18.3 5.9" />
          </g>
          {/* the dish's own origin — the other half of reading this as a radar */}
          <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle className="mas-g-blip" cx="16.4" cy="15.8" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "approve":
      return (
        <svg {...base} className="mas-g">
          <rect x="3" y="4.6" width="18" height="13" rx="2.4" opacity="0.45" />
          <path d="M3 20.6h18" opacity="0.3" />
          <path className="mas-g-check" d="M8 11.1l2.9 2.9L16.2 8.7" />
        </svg>
      );
    case "pipeline":
      return (
        <svg {...base} className="mas-g">
          <path d="M3.4 12h17.2" opacity="0.38" />
          <circle cx="5" cy="12" r="1.7" opacity="0.6" />
          <circle cx="12" cy="12" r="1.7" opacity="0.6" />
          <circle cx="19" cy="12" r="1.7" opacity="0.6" />
          <g className="mas-g-tok">
            <circle cx="5" cy="12" r="2.3" fill="currentColor" stroke="none" />
          </g>
        </svg>
      );
    case "agents":
      return (
        <svg {...base} className="mas-g">
          <circle cx="12" cy="12" r="8.6" opacity="0.25" />
          <circle cx="12" cy="12" r="3.1" />
          <g className="mas-g-orbit">
            <circle cx="12" cy="3.4" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="19.4" cy="16.3" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="4.6" cy="16.3" r="1.6" fill="currentColor" stroke="none" />
          </g>
        </svg>
      );
    case "campaigns":
      return (
        <svg {...base} className="mas-g">
          <path d="M6 3.4v17.2" />
          <g className="mas-g-flag">
            <path d="M6 5h11.4l-2.7 3.9 2.7 3.9H6z" opacity="0.9" />
          </g>
        </svg>
      );
    case "earnings":
      return (
        <svg {...base} className="mas-g">
          <path d="M3.6 20.4h16.8" opacity="0.38" />
          <g className="mas-g-bars">
            <rect className="mas-g-bar" x="5" y="12.6" width="3.4" height="6.6" rx="1.2" style={{ ["--i" as string]: 0 }} />
            <rect className="mas-g-bar" x="10.3" y="9" width="3.4" height="10.2" rx="1.2" style={{ ["--i" as string]: 1 }} />
            <rect className="mas-g-bar" x="15.6" y="5" width="3.4" height="14.2" rx="1.2" style={{ ["--i" as string]: 2 }} />
          </g>
        </svg>
      );
    case "bible":
      return (
        <svg {...base} className="mas-g">
          <path d="M12 7.3C10.2 5.9 7.6 5.3 4.4 5.7v11.7c3.2-.4 5.8.2 7.6 1.6" />
          <g className="mas-g-page">
            <path d="M12 7.3c1.8-1.4 4.4-2 7.6-1.6v11.7c-3.2-.4-5.8.2-7.6 1.6" />
          </g>
          <path d="M12 7.3V19" opacity="0.45" />
        </svg>
      );
  }
}
