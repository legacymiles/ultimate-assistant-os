"use client";

// ---------------------------------------------------------------------------
// The AI director, docked beside the shot-plan sheet. Say what to change;
// the plan is rewritten and only the panels whose content changed redraw.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "../icons";
import type { Studio } from "./studio";

const STARTERS = ["Make it night-time with moonlight", "Add a close-up reaction shot", "Make the camera moves more dramatic", "Shorten it to 10 seconds"];

export function DirectorChat({ s, inputRef }: { s: Studio; inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const [draft, setDraft] = useState("");
  const chat = s.project.chat ?? [];
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, s.chatBusy]);

  const send = (text = draft) => {
    if (!text.trim() || s.chatBusy) return;
    setDraft("");
    void s.revise(text);
  };

  return (
    <aside className="ss-chat" aria-label="AI director">
      <div className="ss-chat-head">
        <Icon.Sparkles width={13} height={13} />
        <div>
          <div className="ss-h">AI DIRECTOR</div>
          <div className="ss-hint">Re-edit the shot plan by chat. Only changed panels redraw.</div>
        </div>
      </div>
      <div className="ss-chat-list" ref={list}>
        {chat.length === 0 && (
          <div className="ss-chat-empty">
            <p className="ss-hint">Try:</p>
            {STARTERS.map((t) => (
              <button key={t} type="button" className="ss-chat-chip" onClick={() => send(t)} disabled={s.chatBusy}>
                {t}
              </button>
            ))}
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={`ss-msg ${m.role === "user" ? "is-user" : "is-ai"}`}>
            {m.text}
          </div>
        ))}
        {s.chatBusy && (
          <div className="ss-msg is-ai">
            <span className="ss-spinner" /> Rewriting the plan…
          </div>
        )}
      </div>
      <form
        className="ss-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={3}
          placeholder="e.g. swap cut 2 and 3, make the father wear a red jacket…"
          disabled={s.chatBusy}
        />
        <button type="submit" className="ss-primary" disabled={s.chatBusy || !draft.trim()} aria-label="Send">
          <Icon.Send width={13} height={13} />
        </button>
      </form>
    </aside>
  );
}
