"use client";

// ---------------------------------------------------------------------------
// Message Inbox — one persona's DMs and comments from every connected app, in
// one list, answered from here.
//
// Top: the sources. Instagram, Facebook and YouTube are live (read + reply);
// each chip connects in one tap, glows with its unread count, and filters the
// list when pressed. Apps that give outside apps no message access (Tinder,
// TikTok, Snapchat…) are "Open inbox" tiles the person picks once.
// Below: the threads (newest first) and the open conversation with a reply box
// and "In <persona>'s voice", which drafts a reply for a person to send.
//
// No button is needed to stay current (checklist A1): it reloads on open,
// every minute while visible, and when the window comes back into focus.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  LIVE_CONNECTORS,
  OPEN_APPS,
  ago,
  checkReply,
  filterThreads,
  inboxOf,
  isUnread,
  markSeen,
  mergeThreads,
  openApp,
  replyBlocker,
  replyLimit,
  sampleThreads,
  toggleApp,
  unreadCounts,
  withSent,
  type InboxKind,
  type InboxThread,
} from "@/lib/social-personas/inbox";
import { PLATFORM_NAME, type Account, type InboxPlatform } from "@/lib/social-personas/types";
import { api, type InboxProblem, type Status } from "./api";
import { Btn, inputCls } from "./bits";
import { loadInboxCache, saveInboxCache } from "./inboxCache";
import type { TabProps } from "./Workspace";

const COLOR: Record<InboxPlatform, string> = { instagram: "#d62976", facebook: "#1877f2", youtube: "#ff0000" };
const REFRESH_MS = 60_000;

type View = "all" | "unread" | InboxKind;

export function InboxTab({
  persona,
  mutate,
  flash,
  ai,
  status,
  openSetup,
}: TabProps & { status: Status | null; openSetup: (p: InboxPlatform) => void }) {
  const inbox = inboxOf(persona);
  const live = useMemo(() => persona.accounts.filter((a) => a.connectionId && (a.platform === "instagram" || a.platform === "facebook" || a.platform === "youtube")), [persona.accounts]);
  const liveKey = live.map((a) => `${a.id}:${a.connectionId}`).join(",");

  const [threads, setThreads] = useState<InboxThread[]>(() => loadInboxCache(persona.id));
  const [problems, setProblems] = useState<InboxProblem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [source, setSource] = useState<InboxPlatform | "all">("all");
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const sample = live.length === 0;
  const shown = sample ? sampleThreads(persona) : threads;
  const seen = inbox.seen;
  const counts = unreadCounts(shown, seen);
  const list = filterThreads(shown, { platform: source, kind: view === "dm" || view === "comment" ? view : "all", unreadOnly: view === "unread", q }, seen);
  const open = shown.find((t) => t.id === openId) ?? null;

  // --- loading ----------------------------------------------------------------
  const load = useCallback(
    async (quiet = false) => {
      if (!live.length) return;
      setLoading(true);
      const r = await api.inbox(live.map((a) => ({ accountId: a.id, connectionId: a.connectionId! })));
      setLoading(false);
      if (!r.ok) {
        if (!quiet) flash(r.error, true);
        return;
      }
      const next = mergeThreads(threadsRef.current, r.data.threads, live.map((a) => a.id)).filter((t) => live.some((a) => a.id === t.accountId));
      threadsRef.current = next;
      setThreads(next);
      saveInboxCache(persona.id, next);
      setProblems(r.data.problems);
      setLoadedAt(new Date().toISOString());
      // A login that's gone for good stops being "connected" on the account.
      const dead = r.data.problems.filter((p) => p.reconnect).map((p) => p.accountId);
      if (dead.length) mutate(persona.id, (p) => ({ ...p, accounts: p.accounts.map((a) => (dead.includes(a.id) ? { ...a, connectionId: undefined } : a)) }));
      // The platform proved the inbox works for these, so the chip stops asking.
      const working = live.filter((a) => !a.canInbox && !r.data.problems.some((p) => p.accountId === a.id)).map((a) => a.id);
      if (working.length) mutate(persona.id, (p) => ({ ...p, accounts: p.accounts.map((a) => (working.includes(a.id) ? { ...a, canInbox: true } : a)) }));
    },
    // liveKey stands in for `live` so a new array each render doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveKey, persona.id, flash, mutate],
  );

  useEffect(() => {
    void load(true);
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(true), REFRESH_MS);
    const vis = () => document.visibilityState === "visible" && void load(true);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [load]);

  // --- read marks -------------------------------------------------------------------
  const markRead = useCallback(
    (ts: InboxThread[]) => {
      const real = ts.filter((t) => !t.sample);
      if (!real.length) return;
      mutate(persona.id, (p) => {
        const before = inboxOf(p);
        const after = markSeen(before, real);
        return after === before ? p : { ...p, inbox: after };
      });
    },
    [mutate, persona.id],
  );

  const select = (t: InboxThread) => {
    setOpenId(t.id);
    if (isUnread(t, seen)) markRead([t]);
  };

  // --- connecting ------------------------------------------------------------------------
  const go = (platform: InboxPlatform, replace?: string) => {
    if (!status?.platforms[platform]?.configured) return openSetup(platform);
    const qs = new URLSearchParams({ persona: persona.id, tab: "inbox", ...(replace ? { replace } : {}) });
    window.location.href = `/api/social-personas/oauth/${platform}/start?${qs}`;
  };

  const setApps = (apps: string[]) => mutate(persona.id, (p) => ({ ...p, inbox: { ...inboxOf(p), apps } }));

  // --- sending ------------------------------------------------------------------------------
  const send = async (t: InboxThread, text: string): Promise<boolean> => {
    const bad = checkReply(t, text);
    if (bad) {
      flash(bad, true);
      return false;
    }
    const acc = persona.accounts.find((a) => a.id === t.accountId);
    if (!acc?.connectionId) {
      flash(`Connect ${PLATFORM_NAME[t.platform]} again to reply.`, true);
      return false;
    }
    const at = new Date().toISOString();
    const localId = `local_${at}`;
    const optimistic = (list: InboxThread[]) => list.map((x) => (x.id === t.id ? withSent(x, text.trim(), acc.displayName || persona.name, at, localId) : x));
    setThreads((prev) => optimistic(prev));
    const r = await api.reply({ connectionId: acc.connectionId, kind: t.kind, replyTo: t.replyTo, text: text.trim() });
    if (!r.ok) {
      setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, messages: x.messages.filter((m) => m.id !== localId) } : x)));
      flash(r.error, true);
      if (r.extra?.needsInbox) setProblems((p) => [...p.filter((x) => x.accountId !== acc.id), { accountId: acc.id, error: r.error, needsInbox: true }]);
      return false;
    }
    setThreads((prev) => {
      const next = prev.map((x) => (x.id === t.id ? { ...x, messages: x.messages.map((m) => (m.id === localId ? { ...m, id: `local_sent_${r.data.id || at}` } : m)) } : x));
      saveInboxCache(persona.id, next);
      return next;
    });
    markRead([{ ...t, lastAt: at }]);
    return true;
  };

  // --- render -----------------------------------------------------------------------------------
  return (
    <div className={"flex h-full flex-col gap-3 " + (open ? "min-h-[calc(100dvh-180px)] md:min-h-[560px]" : "min-h-[560px]")}>
      {/* Sources */}
      <section aria-label="Connected apps" className={"space-y-2 " + (open ? "hidden md:block" : "")}>
        {/* One swipeable row on a phone, wrapping on wider screens. */}
        <div className="-mx-3 flex items-stretch gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:shrink-0">
          <SourceChip label="All" count={counts.total} active={source === "all"} onClick={() => setSource("all")} />
          {LIVE_CONNECTORS.map((c) => {
            const accs = persona.accounts.filter((a) => a.platform === c.platform);
            const connected = accs.filter((a) => a.connectionId);
            const problem = problems.find((p) => connected.some((a) => a.id === p.accountId));
            const needsInbox = problem?.needsInbox || (connected.length > 0 && connected.every((a) => !a.canInbox) && !threads.some((t) => t.platform === c.platform));
            return (
              <LiveChip
                key={c.platform}
                platform={c.platform}
                handle={connected[0]?.handle || accs[0]?.handle}
                reads={c.reads}
                needs={c.needs}
                count={sample ? 0 : (counts[c.platform] ?? 0)}
                state={connected.length === 0 ? (status?.platforms[c.platform]?.configured ? "connect" : "setup") : needsInbox ? "inbox" : "on"}
                active={source === c.platform}
                onFilter={() => setSource(source === c.platform ? "all" : c.platform)}
                onConnect={() => go(c.platform, needsInbox ? connected[0]?.connectionId : undefined)}
              />
            );
          })}
          {inbox.apps.map((id) => {
            const app = openApp(id);
            return app ? <OpenTile key={id} app={app} onRemove={() => setApps(inbox.apps.filter((x) => x !== id))} /> : null;
          })}
          <button
            onClick={() => setPicking(!picking)}
            aria-expanded={picking}
            className="ps-src inline-flex min-h-[52px] items-center gap-1.5 rounded-xl border border-dashed border-line px-3 text-xs font-medium text-ink-muted hover:border-brand hover:text-ink"
          >
            <Icon.Plus width={13} height={13} /> Add app
            <span className="hidden text-[10px] text-ink-faint sm:inline">Tinder, TikTok, Snapchat…</span>
          </button>
        </div>

        {picking && <AppPicker chosen={inbox.apps} onToggle={(id) => setApps(toggleApp(inbox, id).apps)} onClose={() => setPicking(false)} />}

        {problems.map((p) => {
          const acc = persona.accounts.find((a) => a.id === p.accountId);
          if (!acc) return null;
          return (
            <div key={p.accountId} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              <Icon.Bell width={13} height={13} className="shrink-0" />
              <span className="min-w-0 flex-1">{p.error}</span>
              {(p.needsInbox || p.reconnect) && hasPlatform(acc) && (
                <Btn primary onClick={() => go(acc.platform as InboxPlatform, p.needsInbox ? acc.connectionId : undefined)}>
                  {p.reconnect ? `Connect ${PLATFORM_NAME[acc.platform]}` : "Turn on inbox"}
                </Btn>
              )}
            </div>
          );
        })}
      </section>

      {sample && !open && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-brand/5 px-3 py-2.5 text-xs text-ink">
          <Icon.Sparkles width={14} height={14} className="shrink-0 text-brand" />
          <span className="min-w-0 flex-1">
            These are <b>examples</b> of how {persona.name}&apos;s messages will look. Connect Instagram, Facebook or YouTube above — one sign-in each — and the real ones load here.
          </span>
        </div>
      )}

      {/* List + conversation */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-canvas/40">
        <div className={"flex min-h-0 w-full flex-col border-line md:w-[340px] md:shrink-0 md:border-r " + (open ? "hidden md:flex" : "flex")}>
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
            {(
              [
                ["all", "All"],
                ["unread", `Unread${counts.total ? ` ${counts.total}` : ""}`],
                ["dm", "DMs"],
                ["comment", "Comments"],
              ] as [View, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                aria-pressed={view === id}
                className={"rounded-md px-2 py-1 text-[11px] font-medium " + (view === id ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink")}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => void load()}
              disabled={loading || sample}
              title={loadedAt ? `Updated ${ago(loadedAt)} ago — refreshes every minute` : "Refresh"}
              aria-label="Refresh messages"
              className={"ml-auto rounded p-1 text-ink-muted hover:bg-panel-2 hover:text-ink disabled:opacity-50 " + (loading ? "animate-spin" : "")}
            >
              <Icon.Refresh width={13} height={13} />
            </button>
          </div>
          <div className="border-b border-line px-2 py-1.5">
            <input className={inputCls + " py-1 text-xs"} placeholder="Search people, posts, messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search messages" />
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-auto" aria-label="Conversations">
            {list.length === 0 && (
              <li className="px-4 py-10 text-center text-xs text-ink-muted">
                {loading ? "Loading messages…" : q || view !== "all" || source !== "all" ? "Nothing matches." : "No messages yet. New DMs and comments land here on their own."}
              </li>
            )}
            {list.map((t) => (
              <ThreadRow key={t.id} t={t} unread={isUnread(t, seen)} active={t.id === openId} onOpen={() => select(t)} />
            ))}
          </ul>
          {counts.total > 0 && !sample && (
            <button onClick={() => markRead(shown)} className="border-t border-line px-3 py-2 text-left text-[11px] text-ink-faint hover:text-ink">
              Mark all read
            </button>
          )}
        </div>

        <div className={"min-h-0 min-w-0 flex-1 flex-col " + (open ? "flex" : "hidden md:flex")}>
          {open ? (
            <Conversation key={open.id} t={open} persona={persona} ai={ai} onBack={() => setOpenId(null)} onSend={(text) => send(open, text)} flash={flash} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-ink-faint">
              <Icon.Chat width={28} height={28} className="opacity-40" />
              Pick a conversation to read and reply.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const hasPlatform = (a: Account) => a.platform === "instagram" || a.platform === "facebook" || a.platform === "youtube";

// --- sources ---------------------------------------------------------------------------------

function SourceChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={"ps-src inline-flex min-h-[52px] items-center gap-2 rounded-xl border border-line bg-panel px-3 text-xs font-semibold text-ink " + (count ? "has-unread" : "")}
    >
      <Icon.Inbox width={15} height={15} />
      {label}
      {count > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">{count}</span>}
    </button>
  );
}

function LiveChip({
  platform,
  handle,
  reads,
  needs,
  count,
  state,
  active,
  onFilter,
  onConnect,
}: {
  platform: InboxPlatform;
  handle?: string;
  reads: string;
  needs: string;
  count: number;
  state: "on" | "connect" | "setup" | "inbox";
  active: boolean;
  onFilter: () => void;
  onConnect: () => void;
}) {
  const color = COLOR[platform];
  const style = { ["--src" as string]: color };
  const head = (
    <>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 text-left">
        <span className="block text-xs font-semibold text-ink">
          {PLATFORM_NAME[platform]}
          {count > 0 && <span className="ml-1.5 rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: color }}>{count}</span>}
        </span>
        <span className="block truncate text-[10px] text-ink-faint">{state === "on" ? (handle ? `@${handle} · ${reads}` : reads) : reads}</span>
      </span>
    </>
  );
  if (state === "on") {
    return (
      <button onClick={onFilter} aria-pressed={active} style={style} className={"ps-src inline-flex min-h-[52px] max-w-[230px] items-center gap-2 rounded-xl border border-line bg-panel px-3 " + (count ? "has-unread" : "")} title={`Show only ${PLATFORM_NAME[platform]}`}>
        {head}
      </button>
    );
  }
  return (
    <div style={style} className="ps-src inline-flex min-h-[52px] max-w-[280px] items-center gap-2 rounded-xl border border-line bg-panel/60 px-3">
      {head}
      <button
        onClick={onConnect}
        title={state === "setup" ? `One-time setup, then anyone connects ${PLATFORM_NAME[platform]} with one sign-in` : `Needs ${needs}`}
        className="ml-1 shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-white"
        style={{ background: color }}
      >
        {state === "inbox" ? "Turn on inbox" : state === "setup" ? "Set up" : "Connect"}
      </button>
    </div>
  );
}

function OpenTile({ app, onRemove }: { app: (typeof OPEN_APPS)[number]; onRemove: () => void }) {
  return (
    <div className="ps-src group relative inline-flex min-h-[52px] items-center rounded-xl border border-line bg-panel" style={{ ["--src" as string]: app.color }}>
      {app.url ? (
        <a href={app.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-2 pl-3 pr-2" title={`${app.why}. Opens ${app.name} in a new tab.`}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: app.color }} />
          <span className="text-left">
            <span className="block text-xs font-semibold text-ink">{app.name}</span>
            <span className="flex items-center gap-1 text-[10px] text-ink-faint">
              Open inbox <Icon.Launch width={9} height={9} />
            </span>
          </span>
        </a>
      ) : (
        <span className="flex items-center gap-2 py-2 pl-3 pr-2" title={app.why}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: app.color }} />
          <span>
            <span className="block text-xs font-semibold text-ink">{app.name}</span>
            <span className="block text-[10px] text-ink-faint">Phone app only</span>
          </span>
        </span>
      )}
      <button onClick={onRemove} aria-label={`Remove ${app.name}`} className="mr-1 rounded p-1 text-ink-faint opacity-60 hover:bg-panel-2 hover:text-rose-400 group-hover:opacity-100">
        <Icon.Close width={11} height={11} />
      </button>
    </div>
  );
}

function AppPicker({ chosen, onToggle, onClose }: { chosen: string[]; onToggle: (id: string) => void; onClose: () => void }) {
  const groups = ["Social", "Dating", "Chat"] as const;
  return (
    <div className="ps-sheet rounded-xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">Add an app</h3>
          <p className="text-[11px] text-ink-faint">
            These apps don&apos;t let outside apps read or send messages (and unofficial tools get accounts banned), so each one becomes a one-tap shortcut to its own inbox. Instagram, Facebook Pages and YouTube are read and answered right here.
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-muted hover:bg-panel-2 hover:text-ink">
          <Icon.Close width={14} height={14} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-faint">{g}</div>
            <div className="space-y-1">
              {OPEN_APPS.filter((a) => a.group === g).map((a) => {
                const on = chosen.includes(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => onToggle(a.id)}
                    aria-pressed={on}
                    className={"flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition " + (on ? "border-brand bg-brand/10 text-ink" : "border-line text-ink-muted hover:bg-panel-2 hover:text-ink")}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{a.name}</span>
                      <span className="block truncate text-[10px] text-ink-faint">{a.why}</span>
                    </span>
                    {on ? <Icon.Check width={13} height={13} className="shrink-0 text-brand" /> : <Icon.Plus width={12} height={12} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- threads -----------------------------------------------------------------------------------

function ThreadRow({ t, unread, active, onOpen }: { t: InboxThread; unread: boolean; active: boolean; onOpen: () => void }) {
  const last = t.messages[t.messages.length - 1]!;
  return (
    <li>
      <button onClick={onOpen} aria-current={active ? "true" : undefined} className={"ps-thread flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-panel-2/60 " + (unread ? "is-unread" : "")}>
        <Face t={t} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className={"truncate text-[13px] " + (unread ? "font-bold text-ink" : "font-medium text-ink")}>{t.who.name}</span>
            <span className="shrink-0 rounded px-1 text-[9px] font-semibold uppercase tracking-wide text-white" style={{ background: COLOR[t.platform] }}>
              {t.kind === "dm" ? "DM" : "Comment"}
            </span>
            <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{ago(t.lastAt)}</span>
          </span>
          {t.post && <span className="block truncate text-[10px] text-ink-faint">on “{t.post.title}”</span>}
          <span className={"block truncate text-xs " + (unread ? "text-ink" : "text-ink-muted")}>
            {last.mine ? <span className="text-ink-faint">You: </span> : null}
            {last.text}
          </span>
        </span>
        {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--ps-hue)_80%_62%)]" aria-label="unread" />}
      </button>
    </li>
  );
}

function Face({ t, size = 32 }: { t: InboxThread; size?: number }) {
  const initials = t.who.name
    .replace(/^@/, "")
    .split(/[\s._]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {t.who.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.who.avatar} alt="" referrerPolicy="no-referrer" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-panel-2 text-[11px] font-bold text-ink-muted">{initials || "?"}</span>
      )}
      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-canvas" style={{ background: COLOR[t.platform] }} />
    </span>
  );
}

// --- conversation --------------------------------------------------------------------------------

function Conversation({
  t,
  persona,
  ai,
  onBack,
  onSend,
  flash,
}: {
  t: InboxThread;
  persona: TabProps["persona"];
  ai: boolean;
  onBack: () => void;
  onSend: (text: string) => Promise<boolean>;
  flash: (s: string, bad?: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const typing = useRef<number | undefined>(undefined);
  const block = replyBlocker(t);
  const max = replyLimit(t.platform, t.kind);
  const lastCount = useRef(t.messages.length);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (t.messages.length > lastCount.current) setFresh(t.messages[t.messages.length - 1]!.id);
    lastCount.current = t.messages.length;
  }, [t.messages]);
  useEffect(() => () => window.clearInterval(typing.current), []);

  const submit = async () => {
    if (sending || !text.trim()) return;
    setSending(true);
    const sent = text;
    setText("");
    const ok = await onSend(sent);
    if (!ok) setText(sent);
    setSending(false);
    box.current?.focus();
  };

  /** Ask for a reply in the persona's voice and type it into the box (instantly with reduced motion). */
  const draft = async () => {
    setDrafting(true);
    const r = await api.suggestReply(persona, t);
    setDrafting(false);
    if (!r.ok) return flash(r.error, true);
    const full = r.data.reply;
    window.clearInterval(typing.current);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setText(full);
      box.current?.focus();
      return;
    }
    let i = 0;
    setText("");
    typing.current = window.setInterval(() => {
      i = Math.min(full.length, i + Math.max(2, Math.round(full.length / 40)));
      setText(full.slice(0, i));
      if (i >= full.length) {
        window.clearInterval(typing.current);
        box.current?.focus();
      }
    }, 18);
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button onClick={onBack} className="rounded p-1 text-ink-muted hover:bg-panel-2 hover:text-ink md:hidden" aria-label="Back to conversations">
          <Icon.ArrowLeft width={15} height={15} />
        </button>
        <Face t={t} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">
            {t.who.url ? (
              <a href={t.who.url} target="_blank" rel="noreferrer" className="hover:text-brand">
                {t.who.name}
              </a>
            ) : (
              t.who.name
            )}
            {t.who.handle && t.who.handle !== t.who.name && <span className="ml-1.5 text-xs font-normal text-ink-faint">@{t.who.handle}</span>}
          </div>
          <div className="truncate text-[11px] text-ink-faint">
            {PLATFORM_NAME[t.platform]} {t.kind === "dm" ? "message" : "comment"}
            {t.post && (
              <>
                {" "}on{" "}
                {t.post.url ? (
                  <a href={t.post.url} target="_blank" rel="noreferrer" className="text-ink-muted hover:text-brand">
                    “{t.post.title}”
                  </a>
                ) : (
                  `“${t.post.title}”`
                )}
              </>
            )}
          </div>
        </div>
        {t.post?.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.post.thumbnail} alt="" referrerPolicy="no-referrer" className="hidden h-9 w-9 shrink-0 rounded-md object-cover sm:block" />
        )}
        {t.link && (
          <a href={t.link} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted hover:text-ink" title={`Open in ${PLATFORM_NAME[t.platform]}`}>
            <Icon.Launch width={11} height={11} /> <span className="hidden sm:inline">Open</span>
          </a>
        )}
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-3" aria-live="polite">
        {t.messages.map((m, i) => {
          const showAuthor = !m.mine && t.kind === "comment" && i > 0 && m.author !== t.who.name;
          return (
            <div key={m.id} className={"flex " + (m.mine ? "justify-end" : "justify-start")}>
              <div
                className={
                  "ps-bubble max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-snug " +
                  (m.mine ? "ps-bubble-mine rounded-br-md" : "rounded-bl-md bg-panel-2 text-ink") +
                  (m.id === fresh ? " is-new" : "")
                }
              >
                {showAuthor && <div className="mb-0.5 text-[10px] font-semibold text-ink-muted">{m.author}</div>}
                {m.text}
                <div className={"mt-0.5 text-right text-[9px] " + (m.mine ? "text-white/70" : "text-ink-faint")}>
                  {m.id.startsWith("local_") && !m.id.startsWith("local_sent") ? "sending…" : ago(m.at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line p-2">
        {block ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-panel-2/60 px-3 py-2 text-xs text-ink-muted">
            <span className="min-w-0 flex-1">{block}</span>
            {t.link && !t.sample && (
              <a href={t.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white">
                <Icon.Launch width={11} height={11} /> Open in {PLATFORM_NAME[t.platform]}
              </a>
            )}
          </div>
        ) : (
          <>
            <textarea
              ref={box}
              rows={2}
              value={text}
              maxLength={max}
              onChange={(e) => {
                window.clearInterval(typing.current);
                setText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={t.kind === "dm" ? `Message ${t.who.name}…` : `Reply publicly to ${t.who.name}…`}
              className={inputCls + " ps-typing resize-none text-[13px]"}
              aria-label="Your reply"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Btn onClick={() => void draft()} disabled={!ai || drafting || sending} title={ai ? `Draft a reply in ${persona.name}'s voice — you read it, then send` : "Turn on AI (OpenRouter key in Jarvis › Profile › Connections) for reply ideas"}>
                <Icon.Sparkles width={12} height={12} /> {drafting ? "Writing…" : `Write as ${persona.name}`}
              </Btn>
              <span className="ml-auto text-[10px] tabular-nums text-ink-faint">
                {text.length > max * 0.8 ? `${text.length}/${max}` : <span className="hidden sm:inline">⌘/Ctrl + Enter to send</span>}
              </span>
              <Btn primary onClick={() => void submit()} disabled={sending || !text.trim()}>
                <Icon.Send width={12} height={12} /> {sending ? "Sending…" : t.kind === "dm" ? "Send" : "Reply"}
              </Btn>
            </div>
          </>
        )}
      </div>
    </>
  );
}
