"use client";

// ---------------------------------------------------------------------------
// Deck widgets — small on the Dashboard, full-size on a tap.
//
// Every widget follows one contract: a compact card that answers "anything I
// need to know?" at a glance, and an expanded sheet with the whole surface it
// stands for. Tapping anywhere on the card that is not itself a control opens
// it, so a checkbox ticks without opening and the empty space expands.
//
// Which widgets show is the owner's choice (the Widgets button), synced so
// the phone and the laptop agree.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import "./deck.css";
import { UpdatesPanel } from "../jarvis/UpdatesPanel";
import { ListsBoard } from "../recall/lists/ListsBoard";
import { WatchesEditor } from "./WatchesEditor";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { UPDATE_COLOR, UPDATE_LABEL, localDay } from "@/lib/jarvis/updates";
import type { UpdatesApi } from "@/lib/jarvis/useUpdates";
import { listsApi } from "@/lib/recall/lists/client";
import { PRIORITY_RANK, priorityMeta, type BoardPayload, type ListItem } from "@/lib/recall/lists/types";
import { eventStart, type CalendarEvent } from "@/lib/recall/calendar/types";
import { notificationPermission, notificationsAvailable, requestNotifications } from "@/lib/recall/calendar/reminders";

export type WidgetId = "notifications" | "todo" | "camera" | "calendar" | "improvements" | "queue" | "youtube";

export const WIDGETS: { id: WidgetId; label: string }[] = [
  { id: "notifications", label: "Notifications" },
  { id: "todo", label: "To-do" },
  { id: "camera", label: "Camera Autopilot" },
  { id: "calendar", label: "Calendar" },
  { id: "improvements", label: "Improvements" },
  { id: "queue", label: "In Queue" },
  { id: "youtube", label: "YouTube videos" },
];

// ----- which widgets show ----------------------------------------------------

const PREFS_KEY = "jarvis-widgets:v1";
const PREFS_CHANGED = "jarvis-widgets-changed";

function readHidden(): WidgetId[] {
  const p = loadLocal<{ hidden?: unknown }>(PREFS_KEY, {});
  return Array.isArray(p.hidden) ? (p.hidden.filter((x) => WIDGETS.some((w) => w.id === x)) as WidgetId[]) : [];
}

export function useWidgetPrefs(): { hidden: Set<WidgetId>; toggle: (id: WidgetId) => void } {
  const [hidden, setHidden] = useState<WidgetId[]>([]);
  useEffect(() => {
    const read = () => setHidden(readHidden());
    read();
    window.addEventListener(PREFS_CHANGED, read);
    return () => window.removeEventListener(PREFS_CHANGED, read);
  }, []);
  useRemotePull(PREFS_KEY, () => setHidden(readHidden()));
  const toggle = useCallback((id: WidgetId) => {
    const cur = readHidden();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    saveSynced(PREFS_KEY, { hidden: next });
    window.dispatchEvent(new Event(PREFS_CHANGED));
  }, []);
  return { hidden: useMemo(() => new Set(hidden), [hidden]), toggle };
}

// ----- frames ------------------------------------------------------------------

/**
 * Escape — and the phone's Back gesture or the browser's Back button — close
 * only the sheet on top. Without the stack, Escape inside a photo opened from
 * the expanded Camera widget would close both.
 *
 * Back used to leave Jarvis altogether, because a sheet is not a page. Now
 * each open sheet adds one history step: Back closes the top sheet and goes no
 * further, and closing a sheet with its own button takes that step back off,
 * so Back never has to be pressed twice. The step keeps the router's own
 * history state and the same URL, so nothing else on the page reacts to it.
 */
const stack: number[] = [];
const closers = new Map<number, () => void>();
/** Sheets whose history step Back already took. */
const popped = new Set<number>();
let skipPops = 0;
let popBound = false;
let nextSheet = 1;

type SheetState = { njSheet?: number; __NA?: boolean } & Record<string, unknown>;
const sheetOnTop = (): number | undefined => (window.history.state as SheetState | null)?.njSheet;

function onPop(e: PopStateEvent) {
  // While a sheet is open, Back is ours: the URL doesn't change, so the
  // router has nothing to do — and left to it, it reloaded Jarvis or jumped a
  // page too far. This listener is added when the module loads, before the
  // router's, so stopping here keeps it out.
  const st = window.history.state as SheetState | null;
  if (stack.length || (st?.njSheet !== undefined && !st.__NA)) e.stopImmediatePropagation();
  if (skipPops > 0) {
    skipPops--;
    return;
  }
  const target = sheetOnTop() ?? 0;
  // Every sheet opened after the step we landed on closes, newest first.
  for (const id of [...stack].reverse()) {
    if (id <= target) break;
    popped.add(id);
    closers.get(id)?.();
  }
}

function bindPop() {
  if (popBound || typeof window === "undefined") return;
  window.addEventListener("popstate", onPop, { capture: true });
  popBound = true;
}
// At load, so it runs before the router's own Back handler (see onPop).
bindPop();

export function useTopEscape(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const id = nextSheet++;
    stack.push(id);
    closers.set(id, () => ref.current());
    // Added a beat later, so a sheet that mounts and unmounts at once (React's
    // dev double-run, a sheet swapped for another) leaves no stray step.
    let pushed = false;
    const push = window.setTimeout(() => {
      if (!closers.has(id)) return;
      try {
        // __NA marks the step as the router's own: on Back it keeps the page it
        // has (same URL, no saved tree) instead of reloading all of Jarvis.
        window.history.pushState({ ...((window.history.state as SheetState | null) ?? {}), __NA: true, njSheet: id }, "");
        pushed = true;
      } catch {
        // Some embedded browsers refuse history writes; Escape and × still work.
      }
    }, 0);
    bindPop();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(push);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      closers.delete(id);
      // Closed with its own button: take its history step back off quietly.
      if (!popped.delete(id) && pushed && sheetOnTop() === id) {
        skipPops++;
        window.history.back();
      }
    };
  }, []);
}

/**
 * Sheets draw at the top of the page, not inside the panel that opened them.
 * Inside it, Jarvis's top bar and side rail sat over a sheet on a phone — the
 * top of the photo and its way back were hidden under them. The faces Jarvis
 * loads ride along from the page's [data-nj-fonts] wrapper.
 */
export function SheetPortal({ children }: { children: React.ReactNode }) {
  // Drawn on Jarvis's root (.nj), which keeps its theme and is clear of the
  // Dashboard's blurred scroll pane (a blur makes "fixed" stick to the pane,
  // not the screen). Outside Jarvis, the page body, with the page's faces.
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<{ el: Element; fonts: string } | null>(null);
  useLayoutEffect(() => {
    const nj = anchor.current?.closest(".nj");
    setHost(nj ? { el: nj, fonts: "" } : { el: document.body, fonts: document.querySelector("[data-nj-fonts]")?.className ?? "" });
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      {host && createPortal(host.fonts ? <div className={host.fonts}>{children}</div> : children, host.el)}
    </>
  );
}

/** The expanded view: a wide sheet on a laptop, a full-height sheet on a phone. */
export function WidgetSheet({
  title,
  kicker,
  actions,
  onClose,
  children,
  footer,
}: {
  title: string;
  kicker?: string;
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned under the scrolling body — a chat bar stays in reach on a phone. */
  footer?: React.ReactNode;
}) {
  useTopEscape(onClose);
  return (
    <SheetPortal>
    <div
      className="deck fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4"
      // Inline on purpose: the .deck class sets position: relative, which beat
      // Tailwind's "fixed" and left the sheet in the page under Jarvis's bars.
      style={{ position: "fixed", inset: 0, background: "rgb(0 0 0 / 0.7)", minHeight: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="deck-glass deck-ring deck-sheet flex h-[92dvh] w-full flex-col overflow-hidden sm:h-[86dvh] sm:max-w-5xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-3 sm:px-4">
          {/* A plain Back on a phone: the way out people look for first. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="-ml-1 inline-flex h-10 shrink-0 items-center gap-0.5 rounded-lg pl-1 pr-2 text-[13px] text-ink-muted hover:bg-panel-2 hover:text-ink sm:hidden"
          >
            <Icon.ArrowLeft width={15} height={15} aria-hidden />
            Back
          </button>
          <div className="min-w-0 flex-1">
            {kicker && <p className="deck-kicker truncate">{kicker}</p>}
            <h2 className="deck-display truncate text-[17px] font-semibold text-ink">{title}</h2>
          </div>
          {actions && <div className="flex shrink-0 items-center">{actions}</div>}
          <button type="button" onClick={onClose} aria-label="Close" className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-panel-2 hover:text-ink sm:grid">
            <Icon.Close width={14} height={14} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer}
      </div>
    </div>
    </SheetPortal>
  );
}

/** Stops a control's click from also expanding the card under it. */
export const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** The compact card. */
export function Widget({
  title,
  icon,
  count,
  live,
  status,
  onExpand,
  actions,
  className = "",
  children,
}: {
  title: string;
  icon: keyof typeof Icon;
  count?: number;
  /** Lights the edge when something needs the owner. */
  live?: boolean;
  status?: React.ReactNode;
  onExpand: () => void;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const I = Icon[icon];
  return (
    <section
      role="button"
      tabIndex={0}
      aria-label={`${title} — open`}
      onClick={onExpand}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onExpand();
        }
      }}
      className={`deck-glass ${live ? "deck-ring" : ""} group relative flex min-h-[200px] cursor-pointer flex-col p-3 text-left transition hover:border-[var(--hud)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud)] ${className}`}
    >
      <header className="flex items-center gap-2">
        <I width={14} height={14} className="text-[var(--hud)]" aria-hidden />
        <h3 className="deck-display text-[13.5px] font-semibold text-ink">{title}</h3>
        {typeof count === "number" && count > 0 && (
          <span className="rounded-full bg-[color-mix(in_oklab,var(--hud)_18%,transparent)] px-1.5 font-mono text-[10px] text-[var(--hud)]" data-num>
            {count}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5" onClick={stop} onKeyDown={stop}>
          {actions}
        </div>
        <Icon.ZoomIn width={12} height={12} className="text-ink-faint opacity-60 transition group-hover:text-[var(--hud)] group-hover:opacity-100" aria-hidden />
      </header>
      <div className="mt-2 min-h-0 flex-1">{children}</div>
      {status && <p className="mt-2 truncate text-[10.5px] text-ink-faint">{status}</p>}
    </section>
  );
}

export function MiniBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid h-7 w-7 place-items-center rounded-md text-ink-muted transition hover:bg-panel-2 hover:text-[var(--hud)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// ----- notifications -------------------------------------------------------------

function useNotifyPermission(): [string, () => void] {
  const [perm, setPerm] = useState<string>("default");
  useEffect(() => setPerm(notificationPermission()), []);
  return [perm, () => void requestNotifications().then(setPerm)];
}

export function NotificationsWidget({ updates, onExpand }: { updates: UpdatesApi; onExpand: () => void }) {
  const [perm, ask] = useNotifyPermission();
  const rows = updates.updates.slice(0, 5);
  return (
    <Widget
      title="Notifications"
      icon="Bell"
      count={updates.unread}
      live={updates.unread > 0}
      onExpand={onExpand}
      status={perm === "default" && notificationsAvailable() ? "Pop-ups are off — allow them to hear about new photos while you're elsewhere." : undefined}
      actions={
        <>
          {perm === "default" && notificationsAvailable() && (
            <MiniBtn label="Allow pop-up notifications" onClick={ask}>
              <Icon.BellOff width={13} height={13} aria-hidden />
            </MiniBtn>
          )}
          {updates.unread > 0 && (
            <MiniBtn label="Mark all read" onClick={updates.markRead}>
              <Icon.Check width={13} height={13} aria-hidden />
            </MiniBtn>
          )}
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[11.5px] text-ink-faint">{updates.ready ? "Nothing new." : "Checking…"}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((u) => (
            <li key={u.id} className="flex items-center gap-2 text-[11.5px]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: UPDATE_COLOR[u.source] }} title={UPDATE_LABEL[u.source]} aria-hidden />
              <span className={`min-w-0 flex-1 truncate ${updates.unreadIds.has(u.id) ? "text-ink" : "text-ink-muted"}`}>
                {u.title} <span className="text-ink-faint">· {u.detail}</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-ink-faint">{u.when}</span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function NotificationsExpanded({ updates, go, onClose }: { updates: UpdatesApi; go: (tab: string) => void; onClose: () => void }) {
  const [perm, ask] = useNotifyPermission();
  return (
    <WidgetSheet
      title="Notifications"
      kicker="Dashboard"
      onClose={onClose}
      actions={
        <button
          type="button"
          className="deck-btn"
          onClick={() => {
            onClose();
            go("settings");
          }}
        >
          <Icon.Settings width={12} height={12} aria-hidden /> Choose what notifies me
        </button>
      }
    >
      <div className="grid gap-0 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 border-line lg:border-r">
          <UpdatesPanel api={updates} go={(t) => { onClose(); go(String(t)); }} />
        </div>
        <aside className="space-y-3 p-4">
          <div>
            <p className="deck-kicker">New workflow notification</p>
            <p className="mb-2 mt-0.5 text-[11.5px] text-ink-muted">Say it the way you&apos;d say it to a person. I&apos;ll show you what I understood before saving.</p>
            <WatchesEditor compact />
          </div>
          {perm === "default" && notificationsAvailable() && (
            <button type="button" className="deck-btn w-full" onClick={ask}>
              <Icon.Bell width={12} height={12} aria-hidden /> Allow pop-up notifications
            </button>
          )}
          {perm === "denied" && <p className="text-[11px] text-[var(--hud-amber)]">Pop-ups are blocked in this browser&apos;s site settings — the feed still works.</p>}
        </aside>
      </div>
    </WidgetSheet>
  );
}

// ----- to-do ---------------------------------------------------------------------

const TODO_LIST = "todo";

function useBoard() {
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    listsApi
      .load()
      .then((b) => {
        setBoard(b);
        setError("");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't read your lists."));
  }, []);
  useEffect(() => {
    load();
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    window.addEventListener("focus", load);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", load);
    };
  }, [load]);
  return { board, setBoard, error, setError, load };
}

function sortTodo(a: ListItem, b: ListItem): number {
  const pa = PRIORITY_RANK[a.priority ?? "none"] ?? 3;
  const pb = PRIORITY_RANK[b.priority ?? "none"] ?? 3;
  if (pa !== pb) return pa - pb;
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

export function TodoWidget({ onExpand }: { onExpand: () => void }) {
  const { board, setBoard, error, setError } = useBoard();
  const [text, setText] = useState("");
  const open = useMemo(() => (board?.items ?? []).filter((i) => i.listId === TODO_LIST && !i.done).sort(sortTodo), [board]);
  const today = localDay(new Date().toISOString());

  const act = (p: Promise<BoardPayload>) =>
    p.then(setBoard).catch((e: unknown) => setError(e instanceof Error ? e.message : "That didn't save."));

  return (
    <Widget
      title="To-do"
      icon="ListChecks"
      count={open.length}
      onExpand={onExpand}
      status={error || (open.length > 5 ? `+${open.length - 5} more — tap to see them all` : undefined)}
    >
      <ul className="space-y-0.5">
        {open.slice(0, 5).map((i) => (
          <li key={i.id} className="flex items-center gap-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={false}
              aria-label={`Done: ${i.text}`}
              onClick={(e) => {
                e.stopPropagation();
                // Gone from the widget at once; the server answer brings the truth back.
                setBoard((b) => (b ? { ...b, items: b.items.map((x) => (x.id === i.id ? { ...x, done: true } : x)) } : b));
                void act(listsApi.updateItem(i.id, { done: true }));
              }}
              className="grid h-5 w-5 shrink-0 place-items-center rounded border border-line text-transparent transition hover:border-[var(--hud)] hover:text-[var(--hud)]"
            >
              <Icon.Check width={11} height={11} aria-hidden />
            </button>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${priorityMeta(i.priority).dot}`} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{i.text}</span>
            {i.dueDate && (
              <span className={`shrink-0 font-mono text-[10px] ${i.dueDate <= today ? "text-[var(--hud-amber)]" : "text-ink-faint"}`}>
                {i.dueDate === today ? "today" : i.dueDate.slice(5)}
              </span>
            )}
          </li>
        ))}
        {open.length === 0 && !error && <li className="py-3 text-center text-[11.5px] text-ink-faint">{board ? "Nothing to do. Nice." : "Loading…"}</li>}
      </ul>
      <form
        className="mt-2"
        onClick={stop}
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          setText("");
          void act(listsApi.addItem({ listId: TODO_LIST, text: t }));
        }}
      >
        <label htmlFor="todo-quick" className="sr-only">
          Add a to-do
        </label>
        <input
          id="todo-quick"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={stop}
          placeholder="+ Add a to-do"
          className="h-8 w-full rounded-md border border-line-soft bg-transparent px-2 text-[12px] text-ink placeholder:text-ink-faint focus:border-[var(--hud)]"
        />
      </form>
    </Widget>
  );
}

export function TodoExpanded({ onClose }: { onClose: () => void }) {
  return (
    <WidgetSheet title="Lists" kicker="To-do and the rest of your lists" onClose={onClose}>
      <div className="p-3">
        <ListsBoard />
      </div>
    </WidgetSheet>
  );
}

// ----- calendar ---------------------------------------------------------------------

function upcoming(events: CalendarEvent[], days: number) {
  const now = Date.now();
  const until = now + days * 86_400_000;
  return events
    .map((e) => ({ e, at: eventStart(e).getTime() }))
    .filter(({ e, at }) => (e.time ? at >= now - 15 * 60_000 : at >= new Date().setHours(0, 0, 0, 0)) && at <= until)
    .sort((a, b) => a.at - b.at);
}

function whenOf(e: CalendarEvent, at: number): string {
  const d = new Date(at);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const day =
    d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === tomorrow.toDateString() ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return e.time ? `${day} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : `${day} · all day`;
}

export function CalendarWidget({ events, onExpand }: { events: CalendarEvent[]; onExpand: () => void }) {
  const next = useMemo(() => upcoming(events, 7), [events]);
  return (
    <Widget title="Calendar" icon="Calendar" count={next.length} onExpand={onExpand} status={next.length > 4 ? `+${next.length - 4} more this week` : undefined}>
      {next.length === 0 ? (
        <p className="py-6 text-center text-[11.5px] text-ink-faint">Nothing in the next 7 days.</p>
      ) : (
        <ul className="space-y-1.5">
          {next.slice(0, 4).map(({ e, at }) => (
            <li key={e.id} className="min-w-0">
              <p className="truncate text-[12px] text-ink">{e.title}</p>
              <p className="truncate font-mono text-[10px] text-ink-faint">
                {whenOf(e, at)}
                {e.location ? ` · ${e.location}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function CalendarExpanded({ events, go, onClose }: { events: CalendarEvent[]; go: (tab: string) => void; onClose: () => void }) {
  const next = useMemo(() => upcoming(events, 30), [events]);
  return (
    <WidgetSheet
      title="Coming up"
      kicker="Next 30 days"
      onClose={onClose}
      actions={
        <button
          type="button"
          className="deck-btn"
          onClick={() => {
            onClose();
            go("calendar");
          }}
        >
          Open calendar
        </button>
      }
    >
      {next.length === 0 ? (
        <p className="p-6 text-[12px] text-ink-muted">Nothing on the calendar for the next 30 days.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {next.map(({ e, at }) => (
            <li key={e.id} className="flex items-baseline gap-3 px-4 py-2.5">
              <span className="w-[150px] shrink-0 font-mono text-[11px] text-[var(--hud)]">{whenOf(e, at)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-ink">{e.title}</p>
                {(e.location || e.notes) && <p className="truncate text-[11px] text-ink-muted">{[e.location, e.notes].filter(Boolean).join(" · ")}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetSheet>
  );
}

// ----- the picker ---------------------------------------------------------------------

export function WidgetPicker({ hidden, toggle }: { hidden: Set<WidgetId>; toggle: (id: WidgetId) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon.Grid width={11} height={11} aria-hidden /> Widgets
      </button>
      {open && (
        <div className="deck-glass absolute right-0 top-6 z-20 w-52 p-2" onMouseLeave={() => setOpen(false)}>
          {WIDGETS.map((w) => (
            <label key={w.id} className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-[12px] text-ink hover:bg-panel-2">
              {w.label}
              <button type="button" role="switch" aria-checked={!hidden.has(w.id)} aria-label={`Show ${w.label}`} className="deck-switch" onClick={() => toggle(w.id)} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
