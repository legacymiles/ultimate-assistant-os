"use client";

// ---------------------------------------------------------------------------
// Personas Studio — the shell. (Grew out of Social Personas; same data key, so
// every persona made before the rename is still here.)
//
// It owns the board, the platform logins' round trip, and the two things that
// keep the Studio up to date without a button (checklist A1):
//   - connected accounts re-sync on open when their last sync is old, which is
//     also what records each video's progress over time;
//   - the posting queue is polled every minute while the page is open (and
//     asked to send anything due), and each job's outcome is folded back into
//     its draft.
//
// `embedded` drops the page chrome so the same Studio can live inside the
// Jarvis Dashboard as its Personas tab.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { useRemotePull } from "@/lib/sync/useSync";
import { KEY, loadBoard, removePersona, saveBoard, upsertPersona } from "@/lib/social-personas/store";
import { mergePosts, uid } from "@/lib/social-personas/logic";
import { withFollowerPoint, withResult } from "@/lib/social-personas/studio";
import { PLATFORM_NAME, type Board, type ConnectablePlatform, type Draft, type Persona, type Post, type SocialPlatform } from "@/lib/social-personas/types";
import { api, type PublicJob, type Status } from "./api";
import { StudioHome } from "./StudioHome";
import { ConnectSetup } from "./ConnectSetup";
import { PersonaForm } from "./PersonaForm";
import { Workspace, type TabId } from "./Workspace";

export type Mutate = (id: string, fn: (p: Persona) => Persona) => void;

/** Connected accounts older than this re-sync by themselves when the Studio opens. */
const STALE_MS = 3 * 3_600_000;
const POLL_MS = 60_000;

export function PersonasStudio({ embedded = false }: { embedded?: boolean }) {
  const [board, setBoard] = useState<Board>({ version: 1, personas: [] });
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openTab, setOpenTab] = useState<TabId>("overview");
  const [form, setForm] = useState<{ persona?: Persona } | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  /** Connect setup is open (for this platform, from this persona when there is one). */
  const [setup, setSetup] = useState<{ platform?: ConnectablePlatform; personaId?: string; tab?: string } | null>(null);
  const reloadStatus = useCallback(() => void api.status().then((r) => r.ok && setStatus(r.data)), []);
  const boardRef = useRef(board);
  boardRef.current = board;

  useEffect(() => {
    setBoard(loadBoard());
    setLoaded(true);
    void api.status().then((r) => r.ok && setStatus(r.data));
  }, []);
  useRemotePull(KEY, () => setBoard(loadBoard()));

  const commit = useCallback((next: Board) => {
    boardRef.current = next;
    setBoard(next);
    saveBoard(next);
  }, []);

  const mutate: Mutate = useCallback(
    (id, fn) => {
      const p = boardRef.current.personas.find((x) => x.id === id);
      if (p) commit(upsertPersona(boardRef.current, fn(p)));
    },
    [commit],
  );

  const toastTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  /** Pull an account's posts through its stored login, then refresh the brain. */
  const syncAccount = useCallback(
    async (personaId: string, accountId: string, quiet = false) => {
      const acc = boardRef.current.personas.find((p) => p.id === personaId)?.accounts.find((a) => a.id === accountId);
      if (!acc?.connectionId) return;
      const r = await api.sync(acc.connectionId);
      if (!r.ok) {
        if (!quiet || r.extra?.reconnect) flash(`${PLATFORM_NAME[acc.platform]}: ${r.error}`, true);
        if (r.extra?.reconnect) mutate(personaId, (p) => ({ ...p, accounts: p.accounts.map((a) => (a.id === accountId ? { ...a, connectionId: undefined } : a)) }));
        return;
      }
      const d = r.data;
      const at = new Date().toISOString();
      mutate(personaId, (p) => ({
        ...p,
        accounts: p.accounts.map((a) =>
          a.id === accountId
            ? withFollowerPoint({ ...a, handle: d.handle || a.handle, url: d.url || a.url, displayName: d.displayName, lastSyncAt: at }, d.followers, at)
            : a,
        ),
        posts: mergePosts(p.posts, d.posts.map((x) => ({ ...x, addedAt: at }))),
      }));
      if (!quiet) flash(`${PLATFORM_NAME[acc.platform]} synced — ${d.posts.length} posts read.`);
      const fresh = boardRef.current.personas.find((p) => p.id === personaId);
      if (fresh && !quiet) {
        const b = await api.brain(fresh);
        if (b.ok) mutate(personaId, (p) => ({ ...p, brain: b.data.brain }));
      }
    },
    [flash, mutate],
  );

  // Re-sync old connections once per visit, quietly, one at a time.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (!loaded || autoSynced.current) return;
    autoSynced.current = true;
    void (async () => {
      for (const p of boardRef.current.personas) {
        for (const a of p.accounts) {
          if (a.connectionId && Date.now() - Date.parse(a.lastSyncAt ?? "1970") > STALE_MS) await syncAccount(p.id, a.id, true);
        }
      }
    })();
  }, [loaded, syncAccount]);

  /** Fold queue jobs into their drafts; a fresh post gets a row in Analytics straight away. */
  const applyJobs = useCallback(
    (jobs: PublicJob[]) => {
      let next = boardRef.current;
      let changed = false;
      for (const j of jobs) {
        const p = next.personas.find((x) => x.id === j.personaId);
        const d = p?.drafts.find((x) => x.id === j.draftId);
        if (!p || !d) continue;
        const prev = d.results.find((r) => r.accountId === j.accountId);
        if (j.status === "cancelled") {
          if (prev && (prev.status === "queued" || prev.status === "failed")) {
            next = upsertPersona(next, { ...p, drafts: p.drafts.map((x) => (x.id === d.id ? { ...x, results: x.results.filter((r) => r.accountId !== j.accountId) } : x)) });
            changed = true;
          }
          continue;
        }
        const status = j.status === "posted" ? "posted" : j.status === "inbox" ? "inbox" : j.status === "failed" ? "failed" : j.status === "publishing" ? "publishing" : "queued";
        if (prev && prev.status === status && prev.url === j.url && prev.error === (j.error ?? j.note)) continue;
        if (prev && (prev.status === "posted" || prev.status === "manual") && status !== "posted") continue;
        let persona: Persona = { ...p, drafts: p.drafts.map((x) => (x.id === d.id ? withResult(x, { accountId: j.accountId, status, url: j.url, error: j.error ?? j.note, at: j.updatedAt }) : x)) };
        if (status === "posted" && j.externalId && !p.posts.some((x) => x.externalId === j.externalId)) {
          const acc = p.accounts.find((a) => a.id === j.accountId);
          const post: Post = {
            id: uid("post_"),
            platform: acc?.platform ?? j.platform,
            url: j.url ?? "",
            externalId: j.externalId,
            caption: j.caption,
            title: d.title,
            hook: d.hook,
            postedAt: j.updatedAt,
            addedAt: j.updatedAt,
            stats: { views: 0, likes: 0, comments: 0 },
            source: "sync",
            draftId: d.id,
          };
          persona = { ...persona, posts: mergePosts(persona.posts, [post]) };
        }
        next = upsertPersona(next, persona);
        changed = true;
        if (status === "posted" && prev?.status !== "posted") flash(`Posted to ${PLATFORM_NAME[p.accounts.find((a) => a.id === j.accountId)?.platform ?? j.platform]}: “${d.title || "your post"}”`);
        if (status === "failed" && prev?.status !== "failed") flash(j.error ?? "A post didn't go through.", true);
      }
      if (changed) commit(next);
    },
    [commit, flash],
  );

  useEffect(() => {
    if (!loaded) return;
    let stop = false;
    const tick = async () => {
      // Only ask when something is waiting, so an idle Studio makes no calls.
      const waiting = boardRef.current.personas.some((p) => p.drafts.some((d) => d.results.some((r) => r.status === "queued" || r.status === "publishing")));
      if (!waiting) return;
      const r = await api.queue(true);
      if (stop || !r.ok) return;
      applyJobs(r.data.jobs);
      // A draft that thinks it's queued but has no job on the server (the job
      // was lost or pruned) drops that result, so Plan re-creates the job and
      // the post can never silently not go out.
      const live = new Set(r.data.jobs.map((j) => `${j.draftId}:${j.accountId}`));
      let next = boardRef.current;
      let changed = false;
      for (const p of next.personas) {
        let touched = false;
        const drafts = p.drafts.map((d) => {
          const results = d.results.filter((x) => !((x.status === "queued" || x.status === "publishing") && !live.has(`${d.id}:${x.accountId}`)));
          if (results.length === d.results.length) return d;
          touched = true;
          return { ...d, results };
        });
        if (touched) {
          next = upsertPersona(next, { ...p, drafts });
          changed = true;
        }
      }
      if (changed) commit(next);
    };
    void tick();
    const t = window.setInterval(() => void tick(), POLL_MS);
    const vis = () => document.visibilityState === "visible" && void tick();
    document.addEventListener("visibilitychange", vis);
    return () => {
      stop = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [loaded, applyJobs, commit]);

  // Back from a platform login: attach the connection and run the first sync.
  useEffect(() => {
    if (!loaded) return;
    const q = new URLSearchParams(window.location.search);
    const personaId = q.get("persona");
    const connected = q.get("connected");
    const replaced = q.get("replaced");
    const posting = q.get("posting") === "1";
    const postingRefused = q.get("postingRefused") === "1";
    const inbox = q.get("inbox") === "1";
    const inboxRefused = q.get("inboxRefused") === "1";
    const backTab: TabId = q.get("tab") === "inbox" ? "inbox" : "overview";
    const platform = q.get("platform") as SocialPlatform | null;
    const oauthError = q.get("oauthError");
    if (personaId && boardRef.current.personas.some((p) => p.id === personaId)) {
      setOpenId(personaId);
      setOpenTab(backTab);
    }
    if (oauthError) {
      if (oauthError.startsWith("not-configured:")) {
        const pl = oauthError.slice("not-configured:".length) as ConnectablePlatform;
        setSetup({ platform: pl, personaId: personaId ?? undefined, tab: backTab });
      } else flash(`Connect didn't finish: ${oauthError}`, true);
    }
    if (personaId && connected && platform) {
      let accId = uid("a_");
      mutate(personaId, (p) => {
        const existing = p.accounts.find((a) => (replaced && a.connectionId === replaced) || (a.platform === platform && !a.connectionId));
        if (existing) accId = existing.id;
        const accounts = existing
          ? p.accounts.map((a) => (a === existing ? { ...a, connectionId: connected, canPost: posting || undefined, canInbox: inbox || undefined } : a))
          : [...p.accounts, { id: accId, platform, handle: "", url: "", connectionId: connected, canPost: posting || undefined, canInbox: inbox || undefined }];
        return { ...p, accounts };
      });
      const parts = [posting && "scheduled posts go out on their own", inbox && "messages and comments show in the Message inbox"].filter(Boolean);
      if (inboxRefused && backTab === "inbox") flash(`${PLATFORM_NAME[platform]} connected, but the inbox is waiting on one switch in the developer app — the inbox shows which.`, true);
      else if (postingRefused && backTab !== "inbox") flash(`${PLATFORM_NAME[platform]} connected for syncing. Auto-post is waiting on one switch in the developer app — the account shows which.`, true);
      else flash(`${PLATFORM_NAME[platform]} connected${parts.length ? ` — ${parts.join(", and ")}` : ""}.`);
      void syncAccount(personaId, accId);
    }
    if (personaId || oauthError || connected) window.history.replaceState(null, "", window.location.pathname);
  }, [loaded, flash, mutate, syncAccount]);

  const open = board.personas.find((p) => p.id === openId) ?? null;
  const openPersona = (id: string, tab: TabId = "overview") => {
    setOpenTab(tab);
    setOpenId(id);
  };

  return (
    <div className={"flex flex-col " + (embedded ? "h-full min-h-0" : "min-h-dvh bg-canvas")}>
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
        {!embedded && (
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
            aria-label="Back to hub"
          >
            <Icon.ArrowLeft width={14} height={14} />
            <span className="hidden sm:inline">Hub</span>
          </Link>
        )}
        <button onClick={() => setOpenId(null)} className="ml-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-ink hover:text-brand" aria-label="Personas Studio home">
          <span className="ps-mark" aria-hidden />
          <span className={open ? "hidden sm:inline" : ""}>Personas Studio</span>
        </button>
        {open && (
          <>
            <span className="text-ink-faint">/</span>
            <span className="min-w-0 truncate text-sm text-ink-muted">{open.name}</span>
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] text-ink-faint">
          {embedded && (
            <a href="/apps/personas-studio" target="_blank" rel="noreferrer" className="hidden items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-panel-2 hover:text-ink sm:inline-flex" title="Open full screen in its own tab">
              <Icon.Launch width={12} height={12} /> Full screen
            </a>
          )}
          {status && (
            <span className={"rounded-full border px-2 py-0.5 " + (status.ai ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400")}>
              {status.ai ? "AI on" : (
                <>
                  AI off<span className="hidden sm:inline"> — offline ideas</span>
                </>
              )}
            </span>
          )}
        </span>
      </div>

      <div className={embedded ? "min-h-0 flex-1 overflow-auto" : "flex min-h-0 flex-1 flex-col"}>
        {open ? (
          <Workspace
            key={open.id}
            persona={open}
            status={status}
            initialTab={openTab}
            mutate={mutate}
            flash={flash}
            syncAccount={syncAccount}
            applyJobs={applyJobs}
            onEdit={() => setForm({ persona: open })}
            openSetup={(platform, from) => setSetup({ platform, personaId: open.id, tab: from })}
            onDelete={() => {
              for (const a of open.accounts) if (a.connectionId) void api.disconnect(a.connectionId);
              for (const d of open.drafts) void api.unschedule(d.id);
              commit(removePersona(boardRef.current, open.id));
              setOpenId(null);
            }}
          />
        ) : (
          <StudioHome
            personas={board.personas}
            loaded={loaded}
            onOpen={openPersona}
            onNew={() => setForm({})}
            onSetup={() => setSetup({})}
            ready={{ tiktok: status?.platforms.tiktok.configured, instagram: status?.platforms.instagram.configured, facebook: status?.platforms.facebook.configured, youtube: status?.platforms.youtube?.configured }}
          />
        )}
      </div>

      {form && (
        <PersonaForm
          initial={form.persona}
          ai={status?.ai ?? false}
          onClose={() => setForm(null)}
          onSave={(p) => {
            commit(upsertPersona(boardRef.current, p));
            setForm(null);
            openPersona(p.id, form.persona ? openTab : "overview");
          }}
        />
      )}

      {setup && (
        <ConnectSetup
          initial={setup.platform}
          onClose={() => setSetup(null)}
          onReady={reloadStatus}
          onConnect={
            setup.personaId
              ? (platform) => {
                  window.location.href = `/api/social-personas/oauth/${platform}/start?${new URLSearchParams({ persona: setup.personaId!, ...(setup.tab === "inbox" ? { tab: "inbox" } : {}) })}`;
                }
              : undefined
          }
        />
      )}

      {toast && (
        <div
          role="status"
          className={
            "fixed bottom-4 left-1/2 z-[1000] max-w-[92vw] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-sm shadow-2xl " +
            (toast.bad ? "border-rose-500/40 bg-panel text-rose-300" : "border-line bg-panel text-ink")
          }
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** The old name, kept so anything still importing it keeps working. */
export const SocialPersonas = PersonasStudio;

export type { Draft };
