"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { askAgent } from "@/lib/recall/agent";
import { executeAction, folderPathString } from "@/lib/recall/store";
import { uid } from "@/lib/utils";
import type { AgentAction, ChatMessage, Item, RecallData } from "@/lib/recall/types";

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  data: RecallData;
  onData: (data: RecallData) => void;
  onOpenItem: (item: Item) => void;
  /** A question to auto-ask (from "Ask about this"); cleared after sending. */
  ask: string | null;
  onAskConsumed: () => void;
}

function actionLabel(action: AgentAction, items: Item[]): string {
  const titleOf = (id: string) => items.find((i) => i.id === id)?.title ?? "item";
  switch (action.type) {
    case "create_folder":
      return `Create folder ${action.path.join(" › ")}`;
    case "move_item":
      return `Move “${titleOf(action.itemId)}” → ${action.path.join(" › ")}`;
    case "add_tags":
      return `Tag “${titleOf(action.itemId)}” with ${action.tags.join(", ")}`;
    case "remove_tags":
      return `Remove ${action.tags.join(", ")} from “${titleOf(action.itemId)}”`;
    case "create_note":
      return `Create note “${action.title}” in ${action.path.join(" › ") || "Inbox"}`;
  }
}

export function AgentChat({ open, onOpen, onClose, data, onData, onOpenItem, ask, onAskConsumed }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // messageId -> set of resolved (applied/dismissed) action indices
  const [resolved, setResolved] = useState<Record<string, Record<number, "applied" | "dismissed">>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: q };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    const reply = await askAgent(q, data);
    setMessages((m) => [
      ...m,
      {
        id: uid("msg"),
        role: "assistant",
        content: reply.answer,
        citations: reply.citations,
        actions: reply.actions,
        engine: reply.engine,
      },
    ]);
    setBusy(false);
  };

  // Auto-ask when the parent hands us a question.
  useEffect(() => {
    if (ask) {
      onOpen();
      send(`Tell me what I've saved about “${ask}”.`);
      onAskConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  function applyAction(msgId: string, idx: number, action: AgentAction) {
    const { data: next } = executeAction(action);
    onData(next);
    setResolved((r) => ({ ...r, [msgId]: { ...r[msgId], [idx]: "applied" } }));
  }

  function dismissAction(msgId: string, idx: number) {
    setResolved((r) => ({ ...r, [msgId]: { ...r[msgId], [idx]: "dismissed" } }));
  }

  const citationItem = (id: string) => data.items.find((i) => i.id === id);

  if (!open) {
    return (
      <button
        onClick={onOpen}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-2"
      >
        <Icon.Bot width={18} height={18} />
        <span className="hidden sm:inline">Ask Recall</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 z-40 flex h-[70vh] max-h-[620px] w-full flex-col border border-line bg-panel shadow-2xl sm:bottom-5 sm:right-5 sm:h-[560px] sm:w-[390px] sm:rounded-2xl">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Icon.Bot width={16} height={16} />
          </span>
          <span className="text-sm font-semibold text-ink">Ask Recall</span>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-ink-faint hover:bg-panel-2 hover:text-ink" aria-label="Close chat">
          <Icon.Close width={16} height={16} />
        </button>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mt-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/15 text-brand">
              <Icon.Sparkles width={20} height={20} />
            </div>
            <p className="text-sm font-medium text-ink">Ask anything you&apos;ve saved</p>
            <p className="mx-auto mt-1 max-w-[240px] text-xs text-ink-muted">
              I&apos;ll search your notes, answer with sources, and can tidy things up when you ask.
            </p>
            <div className="mt-4 flex flex-col gap-1.5">
              {["What did I decide about game engines?", "Show my open-source video models"].map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-lg border border-line bg-canvas px-3 py-2 text-left text-xs text-ink-muted transition hover:border-brand/40 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white">{m.content}</div>
            ) : (
              <div className="max-w-full">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{m.content}</p>

                {/* citations */}
                {m.citations && m.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.citations.map((id) => {
                      const it = citationItem(id);
                      if (!it) return null;
                      return (
                        <button
                          key={id}
                          onClick={() => onOpenItem(it)}
                          className="inline-flex max-w-[200px] items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1 text-[11px] text-ink-muted transition hover:border-brand/40 hover:text-ink"
                          title={folderPathString(data.folders, it.folderId)}
                        >
                          <Icon.File width={11} height={11} />
                          <span className="truncate">{it.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* proposed actions */}
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-2 space-y-1.5 rounded-xl border border-line bg-canvas p-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Proposed changes</p>
                    {m.actions.map((a, idx) => {
                      const state = resolved[m.id]?.[idx];
                      return (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          <span className={"min-w-0 flex-1 truncate " + (state ? "text-ink-faint line-through" : "text-ink-muted")}>
                            {actionLabel(a, data.items)}
                          </span>
                          {state === "applied" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-core">
                              <Icon.Check width={12} height={12} /> Done
                            </span>
                          ) : state === "dismissed" ? (
                            <span className="text-[11px] text-ink-faint">Dismissed</span>
                          ) : (
                            <span className="flex shrink-0 items-center gap-1">
                              <button
                                onClick={() => applyAction(m.id, idx, a)}
                                className="rounded-md bg-brand px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-brand-2"
                              >
                                Apply
                              </button>
                              <button
                                onClick={() => dismissAction(m.id, idx)}
                                className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-muted hover:text-ink"
                              >
                                No
                              </button>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {m.engine === "heuristic" && (
                  <p className="mt-1 text-[10px] text-ink-faint">Offline answer · add an AI key for synthesis + actions</p>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-1.5 text-ink-faint">
            <span className="h-2 w-2 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.2s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.1s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-ink-faint" />
          </div>
        )}
      </div>

      {/* input */}
      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask or tell me to organize…"
            rows={1}
            className="max-h-24 flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition hover:bg-brand-2 disabled:opacity-40"
            aria-label="Send"
          >
            <Icon.Send width={16} height={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
