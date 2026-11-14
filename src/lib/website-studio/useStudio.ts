"use client";

// ---------------------------------------------------------------------------
// Website Studio — what the owner can open, and where in it they are.
//
// Deliberately NOT a store of its own. Every website already lives somewhere:
// a client site is a Client Review document, a hub app is one of those made on
// first open, a site that has not been built yet is an App Builder project in
// the synced blob. This hook reads those three where they are and folds them
// into one list (./library.ts) — nothing is copied, no id or link secret moves,
// and anything written here is written back through the API that owns it.
//
// The address IS the state: /apps/website-studio with ?site=, ?app= or ?p=.
// Same page, same component; the workspace just opens on a different thing.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStore, STORE_KEY } from "@/lib/app-builder/useAppBuilder";
import type { BuilderProject } from "@/lib/app-builder/types";
import { editableApps, type EditableApp } from "@/lib/client-review/apps";
import { admin } from "@/lib/client-review/client";
import type { ClientProject } from "@/lib/client-review/types";
import { useRemotePull } from "@/lib/sync/useSync";
import { filterCards, libraryCards, type LibraryFilter, type SiteCard } from "./library";

/** Who is looking. The Studio is the owner's; a client only ever has their own site. */
export interface Me {
  signedIn: boolean;
  owner: boolean;
  email: string | null;
}

/** What the workspace is open on. `null` is the home. */
export type StudioTarget = { kind: "site"; token: string } | { kind: "app"; slug: string } | { kind: "draft"; id: string };

export function readTarget(search = typeof window === "undefined" ? "" : window.location.search): StudioTarget | null {
  const q = new URLSearchParams(search);
  const site = q.get("site");
  const app = q.get("app");
  const p = q.get("p");
  if (site) return { kind: "site", token: site };
  if (app) return { kind: "app", slug: app };
  if (p) return { kind: "draft", id: p };
  return null;
}

export function targetHref(t: StudioTarget | null, base = "/apps/website-studio"): string {
  if (!t) return base;
  if (t.kind === "site") return `${base}?site=${encodeURIComponent(t.token)}`;
  if (t.kind === "app") return `${base}?app=${encodeURIComponent(t.slug)}`;
  return `${base}?p=${encodeURIComponent(t.id)}`;
}

/** How often the library re-reads while the page is open and visible. */
const REFRESH_MS = 20_000;

export interface Studio {
  me: Me | null;
  loading: boolean;
  /** Plain English, already fit to show. */
  error: string;
  /** Every website, already filtered and searched. */
  cards: SiteCard[];
  /** Every website, unfiltered — for counts and for finding one by key. */
  all: SiteCard[];
  query: string;
  setQuery: (q: string) => void;
  filter: LibraryFilter;
  setFilter: (f: LibraryFilter) => void;
  projects: ClientProject[];
  drafts: BuilderProject[];
  apps: EditableApp[];
  target: StudioTarget | null;
  /** Open a website (or the home, with null), pushing it into the address. */
  go: (t: StudioTarget | null) => void;
  reload: () => void;
}

export function useStudio(): Studio {
  const [me, setMe] = useState<Me | null>(null);
  const [projects, setProjects] = useState<ClientProject[]>([]);
  const [drafts, setDrafts] = useState<BuilderProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [target, setTarget] = useState<StudioTarget | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The address is read once on mount and then followed, so a client link, a
  // push notification and the back button all land in the same place.
  useEffect(() => {
    setTarget(readTarget());
    const onPop = () => setTarget(readTarget());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    fetch("/api/client-review/portal/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<Me>)
      .then((m) => alive.current && setMe(m))
      .catch(() => alive.current && setError("Couldn't reach the server — check your connection and refresh."));
  }, []);

  const readDrafts = useCallback(() => {
    try {
      setDrafts(readStore().projects);
    } catch {
      setDrafts([]);
    }
  }, []);

  const load = useCallback(async () => {
    if (!me?.owner) {
      setLoading(false);
      return;
    }
    try {
      const state = await admin.load();
      if (!alive.current) return;
      setProjects(state.projects);
      setError("");
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [me?.owner]);

  useEffect(() => {
    if (!me) return;
    readDrafts();
    void load();
  }, [me, load, readDrafts]);

  // A build finishing elsewhere (the PC, the phone) changes a card's state, so
  // the library keeps itself current rather than needing a refresh (D3).
  useEffect(() => {
    if (!me?.owner) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [me?.owner, load]);

  // App Builder's blob is synced; a draft started on the phone shows up here.
  useRemotePull(STORE_KEY, readDrafts);

  const apps = useMemo(() => (me?.owner ? editableApps() : []), [me?.owner]);
  const all = useMemo(() => libraryCards({ projects, drafts, apps }), [projects, drafts, apps]);
  const cards = useMemo(() => filterCards(all, { query, filter }), [all, query, filter]);

  const go = useCallback((t: StudioTarget | null) => {
    setTarget(t);
    window.history.pushState(null, "", targetHref(t));
    if (!t) window.scrollTo({ top: 0 });
  }, []);

  return {
    me,
    loading,
    error,
    cards,
    all,
    query,
    setQuery,
    filter,
    setFilter,
    projects,
    drafts,
    apps,
    target,
    go,
    reload: () => {
      readDrafts();
      void load();
    },
  };
}
