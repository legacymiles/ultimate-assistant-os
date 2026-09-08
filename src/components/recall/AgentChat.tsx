"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { askAgent } from "@/lib/recall/agent";
import { executeAction, folderPathString } from "@/lib/recall/store";
import { getEvents } from "@/lib/recall/calendar/store";
import { formatDayKey, formatTime } from "@/lib/recall/calendar/types";
import type { CalendarEvent } from "@/lib/recall/calendar/types";
import { uid } from "@/lib/utils";
import { DESTRUCTIVE_ACTIONS } from "@/lib/recall/types";
import type { AgentAction, ChatMessage, Folder, Item, RecallData } from "@/lib/recall/types";

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
  /**
   * The calendar and the people list live in their own stores, so an action
   * that writes to them has to tell the shell to re-read. Without this the
   * assistant adds an event and the Calendar tab keeps showing yesterday's.
   */
  onCalendarChanged?: () => void;
  onPhotosChanged?: () => void;
}

function whenLabel(date: string, time?: string | null): string {
  return `${formatDayKey(date, { weekday: "short", day: "numeric", month: "short" })}${
    time ? ` at ${formatTime(time)}` : ""
  }`;
}

function actionLabel(
  action: AgentAction,
  items: Item[],
  folders: Folder[],
  events: CalendarEvent[],
): string {
  const titleOf = (id: string) => items.find((i) => i.id === id)?.title ?? "item";
  const folderOf = (id: string) => folders.find((f) => f.id === id)?.name ?? "folder";
  const eventOf = (id: string) => events.find((e) => e.id === id);
  const pathOf = (p: string[]) => p.join(" › ") || "Inbox";

  switch (action.type) {
    case "create_folder":
      return `Create folder ${pathOf(action.path)}`;
    case "move_item":
      return `Move “${titleOf(action.itemId)}” → ${pathOf(action.path)}`;
    case "move_items":
      return `Move ${action.itemIds.length} items → ${pathOf(action.path)}`;
    case "add_tags":
      return `Tag “${titleOf(action.itemId)}” with ${action.tags.join(", ")}`;
    case "remove_tags":
      return `Remove ${action.tags.join(", ")} from “${titleOf(action.itemId)}”`;
    case "create_note":
      return `Create note “${action.title}” in ${pathOf(action.path)}`;
    case "rename_item":
      return `Rename “${titleOf(action.itemId)}” → “${action.title}”`;
    case "edit_note":
      return `Rewrite the body of “${titleOf(action.itemId)}”`;
    case "rename_folder":
      return `Rename folder “${folderOf(action.folderId)}” → “${action.name}”`;
    case "move_folder":
      return `Move folder “${folderOf(action.folderId)}” → ${pathOf(action.path)}`;
    case "merge_folders":
      return `Merge “${folderOf(action.sourceId)}” into ${pathOf(action.targetPath)}`;
    case "delete_item":
      return `Delete “${titleOf(action.itemId)}”`;
    case "delete_folder":
      return `Delete folder “${folderOf(action.folderId)}”`;
    case "create_event":
      return `Add “${action.title}” to the calendar — ${whenLabel(action.date, action.time)}`;
    case "update_event": {
      const e = eventOf(action.eventId);
      const when = action.date ? whenLabel(action.date, action.time ?? e?.time) : null;
      return `Update “${e?.title ?? "event"}”${when ? ` — ${when}` : ""}`;
    }
    case "delete_event":
      return `Remove “${eventOf(action.eventId)?.title ?? "event"}” from the calendar`;
    case "add_person":
      return `Add ${action.name} to the people Dashboard can recognise`;
    default:
      return "Unknown action";
  }
}

/** Extra warning line for the actions that remove or overwrite something. */
function actionCaveat(action: AgentAction): string | null {
  switch (action.type) {
    case "delete_item":
      return "Permanent.";
    case "delete_folder":
      return "The folder goes; everything inside moves up to its parent.";
    case "merge_folders":
      return "The source folder is removed once its contents move across.";
    case "edit_note":
      return "Replaces the existing body.";
    case "delete_event":
      return "Permanent.";
    case "add_person":
      return "They can't be recognised until you add reference photos.";
    default:
      return null;
  }
}

export function AgentChat({
  open,
  onOpen,
  onClose,
  data,
  onData,
  onOpenItem,
  ask,
  onAskConsumed,
  onCalendarChanged,
  onPhotosChanged,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Held only so proposed calendar changes can be described by name. */
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // messageId -> set of resolved (applied/dismissed) action indices
  const [resolved, setResolved] = useState<Record<string, Record<number, "applied" | "dismissed">>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (open) setEvents(getEvents());
  }, [open]);

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
    const res = executeAction(action);
    onData(res.data);
    if (res.calendarChanged) {
      setEvents(getEvents());
      onCalendarChanged?.();
    }
    if (res.photosChanged) onPhotosChanged?.();
    setResolved((r) => ({ ...r, [msgId]: { ...r[msgId], [idx]: "applied" } }));
  }

  function dismissAction(msgId: string, idx: number) {
    setResolved((r) => ({ ...r, [msgId]: { ...r[msgId], [idx]: "dismissed" } }));
  }

  /** Run a whole plan in order — each step sees the previous step's result. */
  function applyAll(msgId: string, actions: AgentAction[]) {
    const marks: Record<number, "applied" | "dismissed"> = {};
    let next: RecallData | null = null;
    let calendar = false;
    let people = false;
    actions.forEach((a, idx) => {
      if (resolved[msgId]?.[idx]) return;
      const res = executeAction(a);
      next = res.data;
      calendar = calendar || Boolean(res.calendarChanged);
      people = people || Boolean(res.photosChanged);
      marks[idx] = "applied";
    });
    if (next) onData(next);
    if (calendar) {
      setEvents(getEvents());
      onCalendarChanged?.();
    }
    if (people) onPhotosChanged?.();
    setResolved((r) => ({ ...r, [msgId]: { ...r[msgId], ...marks } }));
  }

  function dismissAll(msgId: string, count: number) {
    const marks: Record<number, "applied" | "dismissed"> = {};
    for (let i = 0; i < count; i++) if (!resolved[msgId]?.[i]) marks[i] = "dismissed";
    setResolved((r) => ({ ...r, [msgId]: { ...r[msgId], ...marks } }));
  }

  const citationItem = (id: string) => data.items.find((i) => i.id === id);

  if (!open) {
    return (
      <button
        onClick={onOpen}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-2"
      >
        <Icon.Bot width={18} height={18} />
        <span className="hidden sm:inline">Assistant</span>
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
          <span className="text-sm font-semibold text-ink">Assistant</span>
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
            <p className="text-sm font-medium text-ink">What do you need?</p>
            <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-ink-muted">
              I can see everything you&apos;ve saved — including the text inside your PDFs, docs and
              photos — plus your calendar and the people in your photo library. I answer with
              sources, and I can file things, put things on your calendar and tidy up. Every change
              is shown for your confirmation first.
            </p>
            <div className="mt-4 flex flex-col gap-1.5">
              {[
                "What's on this week?",
                "Put parents' evening on Thursday at 6, remind me the day before",
                "Show me what I've saved about this",
                "Tidy the loose files into the right folders",
              ].map((s) => (
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

                {/* proposed changes — nothing runs until you say so */}
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-2 space-y-1.5 rounded-xl border border-line bg-canvas p-2">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                        {m.actions.length === 1
                          ? "Proposed change"
                          : `Plan · ${m.actions.length} changes`}
                      </p>
                      {m.actions.some((_, i) => !resolved[m.id]?.[i]) && (
                        <span className="ml-auto flex items-center gap-1">
                          <button
                            onClick={() => applyAll(m.id, m.actions as AgentAction[])}
                            className="rounded-md bg-brand px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-brand-2"
                          >
                            Apply all
                          </button>
                          <button
                            onClick={() => dismissAll(m.id, (m.actions as AgentAction[]).length)}
                            className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-muted hover:text-ink"
                          >
                            Dismiss all
                          </button>
                        </span>
                      )}
                    </div>
                    {m.actions.map((a, idx) => {
                      const state = resolved[m.id]?.[idx];
                      const destructive = DESTRUCTIVE_ACTIONS.has(a.type);
                      const caveat = actionCaveat(a);
                      return (
                        <div key={idx} className="flex items-start gap-2 text-xs">
                          <span
                            className={
                              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " +
                              (state ? "bg-ink-faint/40" : destructive ? "bg-red-400" : "bg-brand")
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={
                                "block " + (state ? "text-ink-faint line-through" : "text-ink-muted")
                              }
                            >
                              {actionLabel(a, data.items, data.folders, events)}
                            </span>
                            {caveat && !state && (
                              <span className="block text-[10px] text-red-400/70">{caveat}</span>
                            )}
                          </span>
                          {state === "applied" ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-core">
                              <Icon.Check width={12} height={12} /> Done
                            </span>
                          ) : state === "dismissed" ? (
                            <span className="shrink-0 text-[11px] text-ink-faint">Dismissed</span>
                          ) : (
                            <span className="flex shrink-0 items-center gap-1">
                              <button
                                onClick={() => applyAction(m.id, idx, a)}
                                className={
                                  "rounded-md px-2 py-0.5 text-[11px] font-semibold text-white " +
                                  (destructive
                                    ? "bg-red-500 hover:bg-red-600"
                                    : "bg-brand hover:bg-brand-2")
                                }
                              >
                                {destructive ? "Confirm" : "Apply"}
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
