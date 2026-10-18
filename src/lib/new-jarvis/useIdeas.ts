"use client";

// ---------------------------------------------------------------------------
// Improvements — the browser half.
//
// Gathers what the person has said to Jarvis, asks the server for ideas, and
// keeps their answers ("not for me", "save", "done") synced so the phone and
// the laptop agree. The judgement lives in `ideas.ts`, which is pure and
// tested; this file is fetches and storage.
//
// Why a "said" log of its own: the chat only keeps its last couple of dozen
// blocks across a reload, which is too little to see a pattern in. Every time
// this hook runs it folds the current chat into a longer rolling log (synced,
// so what was said on the phone counts on the laptop too). Only the person's
// own words are kept — never Jarvis's answers, never attachments.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { BLOCKS_KEY } from "./persist";
import {
  auditAsIdeas,
  buildDigest,
  coerceIdeas,
  coerceIdeasState,
  dismissIdea,
  emptyIdeasState,
  knownTitles,
  markDone,
  mergeIdeas,
  reopen as reopenIn,
  shouldAutoRefresh,
  toggleSaved,
  visibleIdeas,
  type AuditProposalLike,
  type Idea,
  type IdeaKind,
  type IdeasState,
  type IdeaView,
  type Said,
  type Shown,
} from "./ideas";
import type { JarvisStore } from "@/lib/jarvis/types";

export const IDEAS_KEY = "jarvis-ideas:v1";
export const SAID_KEY = "jarvis-said:v1";
/** Fired by the widget; the shell puts the text in the chat box. */
export const ASK_EVENT = "jarvis:ask";

const SAID_MAX = 240;

interface SaidRow extends Said {
  id: string;
}

function readSaid(): SaidRow[] {
  const raw = loadLocal<unknown>(SAID_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is SaidRow =>
      !!r && typeof r === "object" && typeof (r as SaidRow).id === "string" && typeof (r as SaidRow).text === "string" && typeof (r as SaidRow).at === "number",
  );
}

/** What is in the chat right now, as "said" rows. */
function currentSaid(store: JarvisStore | null): SaidRow[] {
  const out: SaidRow[] = [];
  const blocks = loadLocal<unknown>(BLOCKS_KEY, []);
  if (Array.isArray(blocks)) {
    for (const b of blocks as Record<string, unknown>[]) {
      if (!b || typeof b.id !== "string" || typeof b.command !== "string") continue;
      const failed = b.status === "failed" ? (typeof b.error === "string" ? b.error : "it failed") : undefined;
      out.push({ id: `b:${b.id}`, text: b.command, at: typeof b.createdAt === "number" ? b.createdAt : Date.now(), failed });
    }
  }
  for (const t of store?.chat?.turns ?? []) {
    if (t.role !== "you" || !t.text) continue;
    const at = Date.parse(t.at);
    out.push({ id: `c:${t.id}`, text: t.text, at: Number.isNaN(at) ? Date.now() : at });
  }
  return out;
}

/** Fold the current chat into the rolling log. Returns the log. */
function foldSaid(store: JarvisStore | null): SaidRow[] {
  const log = readSaid();
  const have = new Set(log.map((r) => r.id));
  const add = currentSaid(store).filter((r) => r.text.trim().length > 2 && !have.has(r.id));
  if (!add.length) return log;
  const next = [...log, ...add.map((r) => ({ ...r, text: r.text.slice(0, 600) }))]
    .sort((a, b) => a.at - b.at)
    .slice(-SAID_MAX);
  saveSynced(SAID_KEY, next);
  return next;
}

export interface UseIdeas {
  state: IdeasState;
  view: (view: IdeaView, kind: IdeaKind | "all") => Shown;
  /** Open ideas, all kinds — what the compact card shows. */
  open: Shown;
  refresh: () => Promise<void>;
  busy: boolean;
  /** A plain-English line about the last refresh, or null. */
  notice: string | null;
  /** How many things the person has said that Jarvis can learn from. */
  saidCount: number;
  dismiss: (idea: Idea) => void;
  save: (idea: Idea) => void;
  done: (idea: Idea) => void;
  reopen: (idea: Idea) => void;
  /** Put the idea's prompt in the chat box. */
  ask: (idea: Idea) => void;
}

export function useIdeas({ store, audit }: { store: JarvisStore | null; audit: AuditProposalLike[] }): UseIdeas {
  const [state, setState] = useState<IdeasState>(emptyIdeasState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saidCount, setSaidCount] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const running = useRef(false);

  const reload = useCallback(() => setState(coerceIdeasState(loadLocal<unknown>(IDEAS_KEY, emptyIdeasState()))), []);
  useEffect(reload, [reload]);
  useRemotePull(IDEAS_KEY, reload);

  const commit = useCallback((next: IdeasState) => {
    setState(next);
    saveSynced(IDEAS_KEY, next);
  }, []);

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const said = foldSaid(store);
      setSaidCount(said.length);
      const cur = stateRef.current;
      const { known, rejected } = knownTitles(cur);
      const digest = buildDigest({
        said,
        memories: (store?.memories ?? [])
          .slice()
          .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
          .map((m) => m.title || m.content),
        audit: audit.map((a) => a.title),
        known,
        rejected,
      });
      const res = await fetch("/api/new-jarvis/ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ digest }),
      });
      const body = (await res.json().catch(() => ({}))) as { ideas?: unknown; notice?: unknown; error?: unknown };
      if (!res.ok) {
        setNotice(typeof body.error === "string" ? body.error : "Couldn't get ideas right now. Try again in a minute.");
        return;
      }
      const fresh = coerceIdeas(body.ideas, Date.now());
      // Keep the old list when the server had nothing new — an empty answer
      // must not wipe ideas the person was still reading.
      const latest = stateRef.current;
      commit(
        fresh.length
          ? mergeIdeas(latest, fresh, Date.now(), said.length)
          : { ...latest, generatedAt: new Date().toISOString(), seenMessages: said.length },
      );
      setNotice(typeof body.notice === "string" ? body.notice : null);
    } catch {
      setNotice("Couldn't reach Jarvis to get ideas. Check your connection and try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [audit, commit, store]);

  // Count what there is to learn from, and refresh by itself at most once a
  // day when something new has been said. Waits for the store so memories
  // are part of the first read.
  const auto = useRef(false);
  useEffect(() => {
    if (!store || auto.current) return;
    auto.current = true;
    const said = foldSaid(store);
    setSaidCount(said.length);
    const stored = coerceIdeasState(loadLocal<unknown>(IDEAS_KEY, emptyIdeasState()));
    if (shouldAutoRefresh(stored, said.length, Date.now())) void refresh();
  }, [store, refresh]);

  const auditIdeas = useMemo(() => auditAsIdeas(audit, Date.now()), [audit]);
  const view = useCallback((v: IdeaView, kind: IdeaKind | "all") => visibleIdeas(state, auditIdeas, Date.now(), v, kind), [state, auditIdeas]);
  const open = useMemo(() => visibleIdeas(state, auditIdeas, Date.now()), [state, auditIdeas]);

  return {
    state,
    view,
    open,
    refresh,
    busy,
    notice,
    saidCount,
    dismiss: useCallback((i: Idea) => commit(dismissIdea(stateRef.current, i.id)), [commit]),
    save: useCallback((i: Idea) => commit(toggleSaved(stateRef.current, i.id)), [commit]),
    done: useCallback((i: Idea) => commit(markDone(stateRef.current, i.id)), [commit]),
    reopen: useCallback((i: Idea) => commit(reopenIn(stateRef.current, i.id)), [commit]),
    ask: useCallback((i: Idea) => {
      window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: i.prompt }));
    }, []),
  };
}
