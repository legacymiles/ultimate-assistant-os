"use client";

// ---------------------------------------------------------------------------
// The director, docked beside the sheet.
//
// The sheet is the film and it is edited by typing on it — but the edits worth
// asking for out loud are the ones that touch every cut at once ("make it
// night", "lose cut 4, it repeats cut 2"), and those are a sentence, not
// twenty fields. So the conversation stays on screen next to the board rather
// than behind a back button, and the render's progress reports here too: it is
// the one thing you watch while the paper sits still.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { Markdown } from "./Markdown";
import type { ChatTurn } from "@/lib/jarvis/types";

const STARTERS = [
  "Make it night, lit only by the fire",
  "Add a close-up reaction before the last cut",
  "The camera moves are too busy — settle them",
  "Cut it down to 20 seconds",
];

export function SheetDirector({
  turns,
  busy,
  onSend,
  children,
}: {
  /** The conversation this sheet came out of, newest last. */
  turns: ChatTurn[];
  busy: boolean;
  onSend: (text: string) => void;
  /** The render, while one is running. It belongs on top of the notes. */
  children?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, busy]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const send = (text = draft) => {
    if (!text.trim() || busy) return;
    setDraft("");
    onSend(text);
  };

  /** The last few exchanges. The whole history belongs in the conversation. */
  const recent = turns.slice(-12);

  return (
    <>
      <div className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-2.5">
        <Icon.Sparkles width={13} height={13} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink">Director</p>
          <p className="text-[10.5px] leading-snug text-ink-faint">
            Say what to change across the whole film. Typing on the sheet changes one cut.
          </p>
        </div>
      </div>

      {children && <div className="shrink-0 border-b border-line p-2.5">{children}</div>}

      <div ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {recent.length === 0 && (
          <div className="space-y-1.5">
            <p className="text-[10.5px] text-ink-faint">Try:</p>
            {STARTERS.map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => send(t)}
                className="block w-full rounded-lg border border-line px-2.5 py-1.5 text-left text-[11px] leading-snug text-ink-muted transition hover:border-ink-faint hover:text-ink disabled:opacity-40"
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {recent.map((t) =>
          t.role === "you" ? (
            <p
              key={t.id}
              className="ml-6 rounded-xl rounded-br-sm bg-panel-2 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink"
            >
              {t.text}
            </p>
          ) : (
            <div
              key={t.id}
              className="rounded-xl rounded-bl-sm border border-line bg-canvas px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-muted"
            >
              {t.storyboard && !t.text ? (
                <p className="flex items-center gap-1.5 text-ink-faint">
                  <Icon.Film width={11} height={11} /> The sheet on the left.
                </p>
              ) : (
                <Markdown text={t.text} />
              )}
            </div>
          ),
        )}
        {busy && (
          <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span className="h-3 w-3 animate-spin rounded-full border border-ink-faint border-t-transparent" />
            Rewriting the plan…
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="shrink-0 border-t border-line p-2.5"
      >
        <div className="rounded-xl border border-line bg-panel-2 transition focus-within:border-ink-faint">
          <textarea
            ref={box}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Swap cuts 2 and 3, put the father in a red coat…"
            aria-label="Tell the director what to change"
            className="block max-h-40 w-full resize-none bg-transparent px-2.5 pt-2.5 text-[12.5px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <div className="flex justify-end px-2 pb-2">
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[11px] font-semibold text-canvas transition hover:opacity-90 disabled:opacity-35"
            >
              <Icon.Send width={11} height={11} /> {busy ? "Working…" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
