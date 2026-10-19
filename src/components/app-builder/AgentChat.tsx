"use client";

// The super agent's side of the room: talk about the app, accept / deny / edit
// features in plain words ("drop 4, and make 2 voice-first"), or ask for more.

import { useEffect, useRef, useState } from "react";
import type { PreparedMedia } from "@/lib/app-builder/media";
import type { ChatMsg } from "@/lib/app-builder/types";
import { Composer } from "./Composer";

interface Props {
  chat: ChatMsg[];
  busy: boolean;
  onSay: (text: string, media: PreparedMedia[]) => void;
  /** Quick prompts shown above the box. */
  chips?: string[];
  placeholder?: string;
}

const THINKING = ["Reading the list", "Watching what you attached", "Thinking about the purpose", "Checking against the build checklist", "Writing it up"];

export function AgentChat({ chat, busy, onSay, chips = [], placeholder }: Props) {
  const [step, setStep] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [chat.length, busy]);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(THINKING.length - 1, s + 1)), 2200);
    return () => clearInterval(t);
  }, [busy]);

  return (
    <section className="ab-chat" aria-label="Chat with the super agent">
      <header className="ab-chat-head">
        <span className="ab-agent-dot" aria-hidden />
        <div>
          <div className="ab-chat-title">Super agent</div>
          <div className="ab-chat-sub">felix · rea · video-analyzer · prompt-enhancer</div>
        </div>
      </header>
      <div className="ab-msgs" aria-live="polite">
        {chat.map((m) => (
          <div key={m.id} className={`ab-msg ab-msg-${m.role}`}>
            <p>{m.text}</p>
            {m.changes?.length ? (
              <ul className="ab-changes">
                {m.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        {busy && (
          <div className="ab-msg ab-msg-agent ab-thinking">
            <span className="ab-pulse" aria-hidden />
            {THINKING[step]}…
          </div>
        )}
        <div ref={end} />
      </div>
      {chips.length > 0 && (
        <div className="ab-chips">
          {chips.map((c) => (
            <button key={c} className="ab-chip" disabled={busy} onClick={() => onSay(c, [])}>
              {c}
            </button>
          ))}
        </div>
      )}
      <Composer busy={busy} onSend={onSay} placeholder={placeholder ?? "Accept, deny or edit by number, ask for ideas, or attach a video"} />
    </section>
  );
}
