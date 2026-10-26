"use client";

// ---------------------------------------------------------------------------
// iPhone Notes on the Jarvis Dashboard: how many proposals wait for a yes, and
// the most sure ones first. Tap the card for the whole app in the widget sheet
// (approve, edit, decline, setup); it also has its own page. The widget never
// approves anything itself.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { Icon } from "../icons";
import { MiniBtn, Widget, WidgetSheet } from "../new-jarvis/Widgets";
import { ACTION_LABEL } from "@/lib/iphone-notes/engine";
import { useIphoneNotes } from "@/lib/iphone-notes/client";
import { IphoneNotesApp } from "./IphoneNotesApp";
import "./iphone-notes.css";

export function IphoneNotesWidget({ onExpand }: { onExpand: () => void }) {
  const n = useIphoneNotes();
  const waiting = useMemo(
    () =>
      (n.view?.notes ?? [])
        .flatMap((note) => note.items.filter((i) => i.state === "waiting").map((i) => ({ note, i })))
        .sort((a, b) => b.i.confidence.score - a.i.confidence.score),
    [n.view],
  );
  const reading = n.view?.notes.filter((x) => x.status === "reading").length ?? 0;
  const linked = Boolean(n.view?.lastPushAt);
  return (
    <Widget
      title="iPhone Notes"
      icon="Note"
      count={waiting.length || undefined}
      live={waiting.length > 0}
      onExpand={onExpand}
      actions={
        <MiniBtn label="Open in its own tab" onClick={() => window.open("/apps/iphone-notes", "_blank", "noopener")}>
          <Icon.Launch width={12} height={12} aria-hidden />
        </MiniBtn>
      }
      status={
        n.error ??
        (!n.view
          ? "Loading…"
          : !linked
            ? "Not linked yet — tap to set up your iPhone (5 min, no app needed)"
            : `${waiting.length} waiting for your yes${reading ? ` · reading ${reading}` : ""} · nothing runs until you approve`)
      }
    >
      <div className="ipn ipn-mini">
        {waiting.length ? (
          <ul>
            {waiting.slice(0, 4).map(({ note, i }) => (
              <li key={i.id}>
                <span className="ipn-ring" data-band={i.confidence.band} role="img" aria-label={`${i.confidence.score}% sure`}>
                  <svg viewBox="0 0 44 44" aria-hidden>
                    <circle cx="22" cy="22" r="17" className="ipn-ring-track" />
                    <circle
                      cx="22"
                      cy="22"
                      r="17"
                      className="ipn-ring-fill"
                      strokeDasharray={2 * Math.PI * 17}
                      strokeDashoffset={2 * Math.PI * 17 * (1 - i.confidence.score / 100)}
                      transform="rotate(-90 22 22)"
                    />
                  </svg>
                  <span className="ipn-mono">{i.confidence.score}</span>
                </span>
                <div className="ipn-mini-text">
                  <p style={{ fontSize: 12.5, fontWeight: 600 }}>{i.label}</p>
                  <p className="ipn-faint">
                    {ACTION_LABEL[i.action]} · from “{note.title}”
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ipn-soft" style={{ padding: "18px 4px", textAlign: "center", fontSize: 12 }}>
            {linked
              ? "All caught up. New notes from your iPhone land here with what Jarvis would do and how sure it is."
              : "Your iPhone notes, read by Jarvis — to-dos, events, birthdays, ideas — each with a confidence score. You approve every one."}
          </p>
        )}
      </div>
    </Widget>
  );
}

export function IphoneNotesExpanded({ onClose }: { onClose: () => void }) {
  return (
    <WidgetSheet
      title="iPhone Notes"
      kicker="Every note waits for your yes"
      onClose={onClose}
      actions={
        <a href="/apps/iphone-notes" target="_blank" rel="noopener" className="deck-btn">
          <Icon.Launch width={12} height={12} aria-hidden /> Own tab
        </a>
      }
    >
      <IphoneNotesApp embedded inJarvis />
    </WidgetSheet>
  );
}
