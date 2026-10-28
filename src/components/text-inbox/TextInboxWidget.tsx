"use client";

// ---------------------------------------------------------------------------
// Text Inbox on the Jarvis Dashboard: how many texts wait for a yes, the
// newest few with their drafts, and a one-tap "Send" on the iPhone when
// approved replies are waiting. Tap the card for the whole app in the widget
// sheet; it also has its own page. The widget never approves anything itself.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { MiniBtn, Widget, WidgetSheet } from "../new-jarvis/Widgets";
import { onIphone, sendFromPhone, useTextInbox } from "@/lib/text-inbox/client";
import { TextInboxApp } from "./TextInboxApp";
import "./text-inbox.css";

export function TextInboxWidget({ onExpand }: { onExpand: () => void }) {
  const t = useTextInbox();
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(onIphone()), []);
  const waiting = useMemo(() => (t.view?.items ?? []).filter((i) => i.status === "waiting" || i.status === "drafting"), [t.view]);
  const ready = t.view?.counts.ready ?? 0;
  const linked = Boolean(t.view?.lastPushAt);
  return (
    <Widget
      title="Text Inbox"
      icon="Chat"
      count={waiting.length || undefined}
      live={waiting.length > 0}
      onExpand={onExpand}
      actions={
        <>
          {ready > 0 && phone && (
            <MiniBtn label={`Send ${ready} approved`} onClick={() => sendFromPhone(`${window.location.origin}/apps/jarvis`)}>
              <Icon.Send width={12} height={12} aria-hidden />
            </MiniBtn>
          )}
          <MiniBtn label="Open in its own tab" onClick={() => window.open("/apps/text-inbox", "_blank", "noopener")}>
            <Icon.Launch width={12} height={12} aria-hidden />
          </MiniBtn>
        </>
      }
      status={
        t.error ??
        (!t.view
          ? "Loading…"
          : !linked
            ? "Not linked yet — tap to set up your iPhone (free, about 8 min)"
            : `${waiting.length} to approve${ready ? ` · ${ready} ready to send` : ""} · nothing sends until you approve`)
      }
    >
      <div className="txi txi-mini" style={{ background: "transparent" }}>
        {waiting.length ? (
          <ul>
            {waiting.slice(0, 4).map((i) => (
              <li key={i.id}>
                <span className="txi-avatar" aria-hidden>
                  {i.from.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "#"}
                </span>
                <div className="txi-mini-text">
                  <p style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {i.from}: <span style={{ fontWeight: 400 }}>{i.text}</span>
                  </p>
                  <p className="txi-faint">{i.status === "drafting" ? "Writing a reply…" : `↳ ${i.draft || "No draft — tap to write one"}`}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="txi-soft" style={{ padding: "18px 4px", textAlign: "center", fontSize: 12 }}>
            {linked
              ? "All caught up. New texts land here with a reply already written in your voice."
              : "Jarvis drafts replies to your iPhone texts in your voice. You approve each one; your phone sends it."}
          </p>
        )}
      </div>
    </Widget>
  );
}

export function TextInboxExpanded({ onClose }: { onClose: () => void }) {
  return (
    <WidgetSheet
      title="Text Inbox"
      kicker="Every reply waits for your yes"
      onClose={onClose}
      actions={
        <a href="/apps/text-inbox" target="_blank" rel="noopener" className="deck-btn">
          <Icon.Launch width={12} height={12} aria-hidden /> Own tab
        </a>
      }
    >
      <TextInboxApp embedded />
    </WidgetSheet>
  );
}
