"use client";

// One chat component for every room: the lounge, a table, a direct message.

import { useEffect, useRef, useState } from "react";
import { useCook } from "../CookConnect";
import { useMessages } from "@/lib/cook-connect/hooks/useMessages";
import { Avatar, Button, Input, Panel, SectionHead, Spinner, cx, relativeTime } from "../ui";
import { SendIcon } from "../icons";

interface Props {
  room: string;
  title: string;
  /** Height of the scrolling log. A table's dock is shorter than the lounge. */
  height?: string;
  placeholder?: string;
  action?: React.ReactNode;
}

export function ChatPanel({ room, title, height = "h-[280px]", placeholder = "Say something…", action }: Props) {
  const { sb, userId, navigate } = useCook();
  const { messages, send, loading, error } = useMessages(sb, userId, room);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  // Follow new messages, unless the reader has scrolled up to read history.
  useEffect(() => {
    const el = logRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    pinnedToBottom.current = true;
    void send(text);
  };

  return (
    <Panel className="flex flex-col overflow-hidden">
      <SectionHead title={title} action={action} />

      <div
        ref={logRef}
        onScroll={onScroll}
        className={cx("overflow-y-auto px-3 py-2.5", height)}
        role="log"
        aria-live="polite"
        aria-label={`${title} messages`}
      >
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-[12px] text-[var(--cc-ink-muted)]">
            <Spinner size={14} />
            Loading messages
          </div>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
            Nothing said yet. Start it off.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {messages.map((m, i) => {
              const mine = m.user_id === userId;
              const samePerson = i > 0 && messages[i - 1].user_id === m.user_id;
              return (
                <li key={m.id} className={cx("flex gap-2", samePerson && "mt-1")}>
                  <span className="w-[22px] shrink-0">
                    {!samePerson && (
                      <button
                        type="button"
                        onClick={() => !mine && navigate({ page: "profile", userId: m.user_id })}
                        aria-label={`Open ${m.display_name}'s profile`}
                      >
                        <Avatar id={m.user_id} name={m.display_name} url={m.avatar_url} size={22} />
                      </button>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    {!samePerson && (
                      <div className="flex items-baseline gap-2">
                        <span className={cx("text-[12px] font-semibold", mine && "text-[var(--cc-ember)]")}>
                          {mine ? "You" : m.display_name}
                        </span>
                        <time dateTime={m.created_at} className="cc-num text-[10px] text-[var(--cc-ink-faint)]">
                          {relativeTime(m.created_at)}
                        </time>
                      </div>
                    )}
                    <p className="break-words text-[13px] leading-snug text-[var(--cc-ink)]">{m.content}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="border-t border-[var(--cc-line)] px-3 py-1.5 text-[11px] text-[var(--cc-loss)]">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="flex items-center gap-1.5 border-t border-[var(--cc-line)] p-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          maxLength={2000}
          aria-label={`Message ${title}`}
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()} className="shrink-0 px-2.5">
          <SendIcon size={15} />
          <span className="sr-only">Send</span>
        </Button>
      </form>
    </Panel>
  );
}
