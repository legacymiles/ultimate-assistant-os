"use client";

// ---------------------------------------------------------------------------
// YouTube videos on the Jarvis Dashboard. Compact: a paste box that saves on
// the spot and the four newest saves. Tap the card (anywhere that isn't the
// box) for the full app in the widget sheet: hero, Saved, For you.
// The same app has its own page too: /apps/youtube-videos (App plugins).
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import { MiniBtn, Widget, WidgetSheet, stop } from "../new-jarvis/Widgets";
import "./ytv.css";
import { YouTubeVideosApp } from "./YouTubeVideosApp";
import { PLATFORM_LABEL } from "@/lib/youtube-videos/links";
import { useLibrary } from "@/lib/youtube-videos/useLibrary";

export function YouTubeVideosWidget({ onExpand }: { onExpand: () => void }) {
  const lib = useLibrary();
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const save = () => {
    const r = lib.save(draft);
    if (r.nothing) return setNote("That doesn't look like a link.");
    setDraft("");
    setNote(r.added ? (r.added === 1 ? "Saved." : `Saved ${r.added}.`) : "Already saved. Moved to the top.");
    setTimeout(() => setNote(null), 2500);
  };
  const latest = lib.videos.slice(0, 4);
  return (
    <Widget
      title="YouTube videos"
      icon="Play"
      count={lib.videos.filter((v) => !v.watchedAt).length}
      onExpand={onExpand}
      actions={
        <MiniBtn label="Open in its own tab" onClick={() => window.open("/apps/youtube-videos", "_blank", "noopener")}>
          <Icon.Launch width={12} height={12} aria-hidden />
        </MiniBtn>
      }
      status={note ?? (lib.videos.length ? `${lib.videos.length} saved · tap for the full list and picks for you` : "Paste a YouTube or social video link to save it for later")}
    >
      <div className="ytv-mini">
        <form
          className="ytv-mini-paste"
          onClick={stop}
          onKeyDown={stop}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="ytv-mini-link" className="sr-only">
            Video link
          </label>
          <input
            id="ytv-mini-link"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const t = e.clipboardData.getData("text");
              if (!t) return;
              e.preventDefault();
              const r = lib.save(t);
              if (r.nothing) {
                setDraft(t);
                setNote("That doesn't look like a link.");
              } else setNote(r.added ? (r.added === 1 ? "Saved." : `Saved ${r.added}.`) : "Already saved. Moved to the top.");
            }}
            placeholder="Paste a video link"
            inputMode="url"
            autoComplete="off"
          />
          <button type="submit" disabled={!draft.trim()}>
            Save
          </button>
        </form>
        {latest.length > 0 ? (
          <ul className="ytv-mini-strip">
            {latest.map((v) => (
              <li key={v.id} title={v.title ?? v.url}>
                {v.thumb ? (
                  <img src={v.thumb} alt={v.title ?? ""} loading="lazy" />
                ) : (
                  <span className="ytv-thumb-blank" style={{ ["--c" as string]: "#ff4b3e" }}>
                    <span>{PLATFORM_LABEL[v.platform]}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-[11.5px] text-ink-faint">Nothing saved yet.</p>
        )}
      </div>
    </Widget>
  );
}

export function YouTubeVideosExpanded({ onClose }: { onClose: () => void }) {
  return (
    <WidgetSheet
      title="YouTube videos"
      kicker="Saved links · picks for you"
      onClose={onClose}
      actions={
        <a href="/apps/youtube-videos" target="_blank" rel="noopener" className="deck-btn">
          <Icon.Launch width={12} height={12} aria-hidden /> Own tab
        </a>
      }
    >
      <YouTubeVideosApp embedded />
    </WidgetSheet>
  );
}
