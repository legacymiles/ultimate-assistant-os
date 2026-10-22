"use client";

// ---------------------------------------------------------------------------
// Viral Studio Content — the app shell (was Dance Vault).
//
// Four tabs — Viral audio, Fights, Dances, Motion — that all work the same
// way: paste a link and it lands in the tab you're on, newest first; hover a
// tile and it plays; one tap on × deletes it, with Undo.
//
// The ways in, so nobody has to find a button:
//   · the paste box (several links at once is fine)
//   · Ctrl/⌘+V anywhere on the page
//   · dragging a link onto the board
// Keys: 1–4 switch tabs, Delete removes the tile under the pointer.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRemotePull } from "@/lib/sync/useSync";
import { addClip, clipsIn, guessVertical, leadSize, countsByTab, extractLinks, findDuplicate, linkKey, offlinePlayback, removeClip, restoreClip, storedKeys } from "@/lib/viral-studio/board";
import { parseLink } from "@/lib/social-import/platform";
import { posterUrl } from "@/lib/viral-studio/playback";
import { CATEGORIES, HEAT_LABEL, HEATS, MOODS, NO_FILTER, applyFilter, isFiltering, optionCounts, type Filter, type Heat } from "@/lib/viral-studio/filters";
import { songLine } from "@/lib/viral-studio/song";
import * as store from "@/lib/viral-studio/store";
import { TABS, isTabId, type Board, type Clip, type ClipStats, type ClipTags, type ResolvedLink, type Song, type SoundKind, type TabId } from "@/lib/viral-studio/types";

import { ClipTile, PendingTile, type PendingClip } from "./ClipTile";
import "./viral-studio.css";

interface Toast {
  id: number;
  text: string;
  undo?: () => void;
}

const SOUND_KEY = "viral-studio:sound";
const HOVER_DELAY_MS = 60;
const UNDO_MS = 6000;

function newId(): string {
  return `clip_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

function freeFiles(keys: string[]) {
  if (!keys.length) return;
  void fetch("/api/viral-studio/media", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keys }),
    keepalive: true,
  }).catch(() => undefined);
}

export function ViralStudio({ fontClass = "" }: { fontClass?: string }) {
  const geist = fontClass ? ` ${fontClass}` : "";
  // Storage is browser-only, so the first render matches the server's empty one.
  const [board, setBoard] = useState<Board>({ clips: [] });
  const boardRef = useRef<Board>(board);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<TabId>("audio");
  const [pending, setPending] = useState<PendingClip[]>([]);
  const [draft, setDraft] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [soundPref, setSoundPref] = useState<Partial<Record<TabId, boolean>>>({});
  const [interacted, setInteracted] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [mod, setMod] = useState("Ctrl");
  const [touch, setTouch] = useState(false);
  const [cols, setCols] = useState(4);
  const [filters, setFilters] = useState<Partial<Record<TabId, Filter>>>({});
  const [tray, setTray] = useState<"mood" | "heat" | "category" | null>(null);
  const [finding, setFinding] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  /** Clips already sent to the tagger / song finder this visit, so nothing is asked twice. */
  const asked = useRef({ tags: new Set<string>(), songs: new Set<string>(), songLimit: false });

  // Mirrors the grid's breakpoints in viral-studio.css, so the newest clip can
  // be sized to end the wall on a full row.
  useEffect(() => {
    const read = () => setCols(window.innerWidth > 1180 ? 4 : window.innerWidth > 860 ? 3 : 2);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLElement>(null);

  // The filter row sticks just under the header, whose height changes on a phone.
  useEffect(() => {
    const bar = barRef.current;
    const main = mainRef.current;
    if (!bar || !main || typeof ResizeObserver === "undefined") return;
    const set = () => main.style.setProperty("--bar-h", `${bar.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  const hoverTimer = useRef<number | null>(null);
  const hoveredId = useRef<string | null>(null);
  const aborts = useRef(new Map<string, AbortController>());
  /** The last delete's files, freed once its Undo window closes. */
  const pendingFree = useRef<{ keys: string[]; timer: number } | null>(null);

  const def = TABS.find((t) => t.id === tab)!;
  const sound = soundPref[tab] ?? def.soundByDefault;

  // --- board state ---------------------------------------------------------

  const commit = useCallback((fn: (b: Board) => Board): Board => {
    const prev = boardRef.current;
    const next = fn(prev);
    if (next !== prev) {
      boardRef.current = next;
      store.saveBoard(next);
      setBoard(next);
    }
    return next;
  }, []);

  const reload = useCallback(() => {
    const b = store.loadBoard();
    boardRef.current = b;
    setBoard(b);
  }, []);

  useRemotePull(store.KEY, reload);

  useEffect(() => {
    reload();
    setReady(true);
    try {
      setSoundPref(JSON.parse(window.localStorage.getItem(SOUND_KEY) ?? "{}"));
    } catch {
      // A blocked or corrupt preference just means the defaults.
    }
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setMod("⌘");
    // No hover on a phone: the corner buttons (open, delete) must always show.
    if (window.matchMedia?.("(hover: none), (pointer: coarse)").matches) setTouch(true);
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (isTabId(fromUrl)) setTab(fromUrl);
  }, [reload]);

  const switchTab = useCallback((next: TabId) => {
    setTab(next);
    setActiveId(null);
    const q = new URLSearchParams(window.location.search);
    q.set("tab", next);
    window.history.replaceState(null, "", `?${q}`);
  }, []);

  const toggleSound = () => {
    const next = { ...soundPref, [tab]: !sound };
    setSoundPref(next);
    try {
      window.localStorage.setItem(SOUND_KEY, JSON.stringify(next));
    } catch {
      // Remembered for this visit only.
    }
  };

  // Browsers block sound until the page has been clicked once.
  useEffect(() => {
    if (interacted) return;
    const done = () => setInteracted(true);
    window.addEventListener("pointerdown", done, { once: true });
    window.addEventListener("keydown", done, { once: true });
    return () => {
      window.removeEventListener("pointerdown", done);
      window.removeEventListener("keydown", done);
    };
  }, [interacted]);

  const say = useCallback((text: string, undo?: () => void) => {
    setToast({ id: Date.now(), text, undo });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.undo ? UNDO_MS : 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const flash = useCallback((id: string) => {
    setFlashId(id);
    window.setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1400);
    document.getElementById(`vsc-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  // --- adding --------------------------------------------------------------

  const addOne = useCallback(
    async (url: string, into: TabId) => {
      const tempId = newId();
      const ctl = new AbortController();
      aborts.current.set(tempId, ctl);
      setPending((p) => [{ tempId, url, tab: into }, ...p]);
      const label = TABS.find((t) => t.id === into)!.label;

      let resolved: ResolvedLink | null = null;
      let failure = "";
      try {
        const res = await fetch("/api/viral-studio/add", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, tab: into }),
          signal: ctl.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) resolved = json as ResolvedLink;
        else if (res.status === 400) failure = json.error ?? "That link didn't work.";
        else failure = "offline";
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          aborts.current.delete(tempId);
          return;
        }
        failure = "offline";
      }
      aborts.current.delete(tempId);
      setPending((p) => p.filter((x) => x.tempId !== tempId));

      if (failure && failure !== "offline") return say(failure);
      if (!resolved) {
        // The server couldn't be reached. Keep what was pasted anyway — losing
        // a link because a request failed is worse than a plainer tile.
        const parsed = parseLink(url);
        resolved = {
          url: parsed?.url.href ?? url,
          platform: parsed?.platform ?? "web",
          title: "",
          author: "",
          play: offlinePlayback(url),
          vertical: guessVertical(url),
          note: "Couldn't check this link yet — it plays through the site's own player.",
        };
      }

      const clip: Clip = { id: newId(), tab: into, ...resolved, addedAt: new Date().toISOString() };
      const before = boardRef.current;
      const after = commit((b) => addClip(b, clip));
      if (after === before) {
        // A short link that turned out to be a video already here.
        freeFiles(storedKeys(clip));
        const dup = findDuplicate(before, into, clip);
        say(`Already in ${label}.`);
        if (dup) flash(dup.id);
      }
    },
    [commit, flash, say],
  );

  const addText = useCallback(
    (text: string, into: TabId = tab): boolean => {
      const links = extractLinks(text);
      if (!links.length) {
        say("That doesn't look like a link.");
        return false;
      }
      const label = TABS.find((t) => t.id === into)!.label;
      const pendingKeys = new Set(pending.filter((p) => p.tab === into).map((p) => linkKey(p.url)));
      let queued = 0;
      for (const url of links) {
        const dup = findDuplicate(boardRef.current, into, { url, play: offlinePlayback(url) });
        if (dup) {
          flash(dup.id);
          say(`Already in ${label}.`);
          continue;
        }
        if (pendingKeys.has(linkKey(url))) continue;
        queued++;
        void addOne(url, into);
      }
      if (queued > 1) say(`Adding ${queued} links to ${label}…`);
      return queued > 0;
    },
    [addOne, flash, pending, say, tab],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    // Found links are handled (added, or flagged as already here) — either way the box is done.
    if (extractLinks(draft).length) setDraft("");
    addText(draft);
  };

  // Paste anywhere that isn't a text box.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!extractLinks(text).length) return;
      e.preventDefault();
      addText(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addText]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (text) addText(text);
  };

  // --- deleting ------------------------------------------------------------

  const finalizeFree = useCallback(() => {
    const p = pendingFree.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pendingFree.current = null;
    freeFiles(p.keys);
  }, []);

  const deleteClip = useCallback(
    (id: string) => {
      const { removed, index } = removeClip(boardRef.current, id);
      if (!removed) return;
      commit((b) => removeClip(b, id).board);
      if (activeId === id) setActiveId(null);
      finalizeFree();
      const keys = storedKeys(removed);
      if (keys.length) pendingFree.current = { keys, timer: window.setTimeout(finalizeFree, UNDO_MS + 500) };
      say("Deleted.", () => {
        if (pendingFree.current) {
          window.clearTimeout(pendingFree.current.timer);
          pendingFree.current = null;
        }
        commit((b) => restoreClip(b, removed, index));
        setToast(null);
      });
    },
    [activeId, commit, finalizeFree, say],
  );

  // --- song finder, tags --------------------------------------------------

  const patchClip = useCallback(
    (id: string, patch: Partial<Clip>) => {
      commit((b) => {
        const i = b.clips.findIndex((c) => c.id === id);
        if (i < 0) return b;
        const clips = b.clips.slice();
        clips[i] = { ...clips[i], ...patch };
        return { clips };
      });
    },
    [commit],
  );

  /** Shazam for one clip: the post's sound credit, else listening to it. */
  const findSong = useCallback(
    async (id: string, quiet = false): Promise<"ok" | "limit" | "fail"> => {
      const clip = boardRef.current.clips.find((c) => c.id === id);
      if (!clip) return "fail";
      setFinding((s) => new Set(s).add(id));
      try {
        const res = await fetch("/api/viral-studio/song", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: clip.url, key: clip.play.kind === "file" ? clip.play.key : null }),
        });
        const json = (await res.json().catch(() => ({}))) as { sound?: SoundKind; song?: Song; stats?: ClipStats; error?: string; limit?: boolean };
        if (json.stats) patchClip(id, { stats: json.stats });
        if (!res.ok || !json.sound) {
          if (!quiet) say(json.error ?? "Couldn't check that clip's song right now.");
          return json.limit ? "limit" : "fail";
        }
        const patch: Partial<Clip> = { sound: json.sound, song: json.song };
        // A song found by listening makes "Song" a fair category, unless the owner tagged it by hand.
        if (json.sound === "song" && clip.tags && !clip.tags.byHand && !clip.tags.categories.includes("Song")) {
          patch.tags = { ...clip.tags, categories: ["Song", ...clip.tags.categories].slice(0, 3) };
        }
        patchClip(id, patch);
        if (!quiet) say(json.sound === "song" && json.song ? `Found it: ${songLine(json.song)}` : json.sound === "original" ? "That's an original sound, not a song." : "Couldn't make out a song in that one.");
        return "ok";
      } catch {
        if (!quiet) say("Couldn't reach the song finder. Try again in a moment.");
        return "fail";
      } finally {
        setFinding((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }
    },
    [patchClip, say],
  );

  // Clips saved before tags and the song finder existed get them once, quietly.
  useEffect(() => {
    if (!ready) return;
    const need = board.clips.filter((c) => !c.tags && !asked.current.tags.has(c.id)).slice(0, 20);
    if (!need.length) return;
    for (const c of need) asked.current.tags.add(c.id);
    void (async () => {
      try {
        const res = await fetch("/api/viral-studio/tag", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            items: need.map((c) => ({
              id: c.id,
              tab: c.tab,
              title: c.title,
              author: c.author,
              song: songLine(c.song),
              isSong: c.sound === "song",
              url: c.url,
              needStats: !c.stats,
            })),
          }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as { tags?: Record<string, ClipTags>; stats?: Record<string, ClipStats> };
        commit((b) => ({
          clips: b.clips.map((c) => {
            const t = json.tags?.[c.id];
            const s = json.stats?.[c.id];
            if (!t && !s) return c;
            return { ...c, ...(t && !c.tags ? { tags: t } : {}), ...(s && !c.stats ? { stats: s } : {}) };
          }),
        }));
      } catch {
        // Untagged clips still show; they just don't match a filter yet.
      }
    })();
  }, [board, commit, ready]);

  useEffect(() => {
    if (!ready || asked.current.songLimit) return;
    const next = board.clips.find((c) => c.tab === "audio" && !c.sound && !asked.current.songs.has(c.id));
    if (!next || finding.size) return;
    asked.current.songs.add(next.id);
    void findSong(next.id, true).then((r) => {
      if (r === "limit") asked.current.songLimit = true;
    });
  }, [board, finding, findSong, ready]);

  const saveTags = (id: string, tags: ClipTags) => {
    patchClip(id, { tags: { ...tags, byHand: true } });
    setEditing(null);
  };

  // A tab closed mid-Undo still frees the files.
  useEffect(() => {
    const onHide = () => finalizeFree();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [finalizeFree]);

  const cancelPending = (tempId: string) => {
    aborts.current.get(tempId)?.abort();
    aborts.current.delete(tempId);
    setPending((p) => p.filter((x) => x.tempId !== tempId));
  };

  // --- keys ----------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TABS.length) return switchTab(TABS[n - 1].id);
      if ((e.key === "Delete" || e.key === "Backspace") && hoveredId.current) {
        e.preventDefault();
        deleteClip(hoveredId.current);
        hoveredId.current = null;
      }
      if (e.key === "Escape") setActiveId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteClip, switchTab]);

  // --- hover ---------------------------------------------------------------

  const enter = (id: string) => {
    hoveredId.current = id;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    // A beat of delay, so sweeping the mouse across the board doesn't spin up
    // a WebGL context in every tile it crosses.
    hoverTimer.current = window.setTimeout(() => setActiveId(id), HOVER_DELAY_MS);
  };
  const leave = (id: string) => {
    if (hoveredId.current === id) hoveredId.current = null;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    setActiveId((a) => (a === id ? null : a));
  };

  // --- view ----------------------------------------------------------------

  const counts = useMemo(() => countsByTab(board), [board]);
  const filter = filters[tab] ?? NO_FILTER;
  const inTab = useMemo(() => clipsIn(board, tab), [board, tab]);
  const visible = useMemo(() => applyFilter(inTab, filter), [inTab, filter]);
  const options = useMemo(() => optionCounts(inTab), [inTab]);
  const filtering = isFiltering(filter);
  const setFilter = (next: Partial<Filter>) => setFilters((f) => ({ ...f, [tab]: { ...(f[tab] ?? NO_FILTER), ...next } }));
  const toggleIn = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const editingClip = editing ? board.clips.find((c) => c.id === editing) ?? null : null;
  const pendingHere = pending.filter((p) => p.tab === tab);
  const empty = ready && !inTab.length && !pendingHere.length;
  const total = inTab.length;
  const newest = visible[0];
  // The newest clip goes large once there's a wall around it to anchor, sized
  // so the wall (and the add tile after it) ends on a full row.
  const lead = pendingHere.length || filtering || filter.sort !== "newest" ? "none" : leadSize(visible.length, cols);
  const ambient = newest ? posterUrl(newest) : null;
  const tabIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <main
      ref={mainRef}
      className={`vsc${dropping ? " is-dropping" : ""}${touch ? " is-touch" : ""}${geist}`}
      data-tab={tab}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/uri-list") || e.dataTransfer.types.includes("text/plain")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={onDrop}
    >
      <header className="vsc-bar" ref={barRef}>
        <Link href="/" className="vsc-bar__home" aria-label="Back to the hub">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </svg>
        </Link>
        <span className="vsc-bar__mark">Viral Studio</span>

        <nav className="vsc-seg" role="tablist" aria-label="Boards" style={{ "--seg-i": tabIndex } as React.CSSProperties}>
          <span className="vsc-seg__thumb" aria-hidden="true" />
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`vsc-seg__item${tab === t.id ? " is-on" : ""}`}
              onClick={() => switchTab(t.id)}
              title={`${t.label} — press ${i + 1}`}
            >
              <span className="vsc-seg__long">{t.label}</span>
              <span className="vsc-seg__short">{t.short}</span>
              <span className="vsc-seg__count">{counts[t.id]}</span>
            </button>
          ))}
        </nav>

        <button
          type="button"
          className={`vsc-bar__sound${sound ? " is-on" : ""}`}
          onClick={toggleSound}
          aria-pressed={sound}
          aria-label={sound ? "Sound on — hover plays with sound" : "Muted — hover plays silently"}
          title={sound ? "Sound on" : "Muted"}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path className="vsc-fill" d="M3.5 8v4h3l4 3.2V4.8L6.5 8h-3z" />
            {sound ? <path d="M13.2 7.3a3.6 3.6 0 0 1 0 5.4M15.4 5.2a6.6 6.6 0 0 1 0 9.6" /> : <path d="M13.5 8l4 4M17.5 8l-4 4" />}
          </svg>
        </button>
      </header>

      <section className="vsc-hero" aria-labelledby="vsc-board-title">
        <div className="vsc-hero__ambient" aria-hidden="true">
          {ambient && (
            // eslint-disable-next-line @next/next/no-img-element -- decorative ambient light from the newest clip
            <img key={ambient} src={ambient} alt="" />
          )}
        </div>
        <div className="vsc-hero__inner">
          <h1 id="vsc-board-title" className="vsc-hero__title">
            {def.label}
          </h1>
          <p className="vsc-hero__sub">
            {def.hint}
            <span aria-hidden="true"> · </span>
            {total === 1 ? "1 clip" : `${total} clips`}
          </p>

          <form className="vsc-paste" onSubmit={submit}>
            <svg className="vsc-paste__icon" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8.6 11.4a3.4 3.4 0 0 0 4.8 0l2.4-2.4a3.4 3.4 0 0 0-4.8-4.8l-.9.9M11.4 8.6a3.4 3.4 0 0 0-4.8 0L4.2 11a3.4 3.4 0 0 0 4.8 4.8l.9-.9" />
            </svg>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Paste a TikTok, Reel, Short or post link`}
              aria-label={`Link to add to ${def.label}`}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="vsc-paste__go" disabled={!draft.trim()}>
              Add<span className="vsc-paste__to"> to {def.label}</span>
            </button>
          </form>
          <p className="vsc-hero__tip">
            Several links at once work. Or press <kbd>{mod}</kbd>
            <kbd>V</kbd> anywhere, or drop a link on the page.
            {sound && !interacted ? <strong> Click once anywhere so clips can play with sound.</strong> : null}
          </p>
        </div>
      </section>

      <section className="vsc-wall" aria-label={`${def.label} clips`}>
        {(inTab.length > 0 || pendingHere.length > 0) && (
          <div className="vsc-wall__head">
            <h2>{filter.sort === "hottest" ? "Hottest first" : "Newest first"}</h2>
            <p>Hover to watch · <kbd>Del</kbd> removes the one you&apos;re on</p>
          </div>
        )}

        {inTab.length > 0 && (
          <div className="vsc-filters">
            <div className="vsc-filters__row" role="toolbar" aria-label="Filter clips">
              <div className="vsc-sort" role="group" aria-label="Order">
                <button type="button" aria-pressed={filter.sort === "newest"} onClick={() => setFilter({ sort: "newest" })}>
                  Newest
                </button>
                <button type="button" aria-pressed={filter.sort === "hottest"} onClick={() => setFilter({ sort: "hottest" })}>
                  Hot now
                </button>
              </div>
              {(
                [
                  ["mood", "Mood", filter.moods.length],
                  ["heat", "Popularity", filter.heats.length],
                  ["category", tab === "audio" ? "Type & genre" : tab === "fights" ? "Fight style" : tab === "dances" ? "Dance style" : "Sport & move", filter.categories.length],
                ] as const
              ).map(([id, label, n]) => (
                <button
                  key={id}
                  type="button"
                  className={`vsc-filters__open${tray === id ? " is-open" : ""}${n ? " is-set" : ""}`}
                  aria-expanded={tray === id}
                  onClick={() => setTray((t) => (t === id ? null : id))}
                >
                  {label}
                  {n ? <span className="vsc-filters__n">{n}</span> : null}
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M3 4.5 6 7.5l3-3" />
                  </svg>
                </button>
              ))}
              {filtering && (
                <button type="button" className="vsc-filters__clear" onClick={() => setFilter({ moods: [], heats: [], categories: [] })}>
                  Clear
                </button>
              )}
              <span className="vsc-filters__count">
                {filtering ? `${visible.length} of ${inTab.length}` : `${inTab.length} clips`}
              </span>
            </div>
            {tray && (
              <div className="vsc-filters__tray">
                {tray === "mood" &&
                  MOODS.map((m) => (
                    <button key={m} type="button" className="vsc-chip is-pick" aria-pressed={filter.moods.includes(m)} data-empty={!options.moods[m] || undefined} onClick={() => setFilter({ moods: toggleIn(filter.moods, m) })}>
                      {m}
                      <span>{options.moods[m] ?? 0}</span>
                    </button>
                  ))}
                {tray === "heat" &&
                  HEATS.map((h: Heat) => (
                    <button key={h} type="button" className={`vsc-chip is-pick is-heat is-${h}`} aria-pressed={filter.heats.includes(h)} data-empty={!options.heats[h] || undefined} onClick={() => setFilter({ heats: toggleIn(filter.heats, h) })}>
                      {HEAT_LABEL[h]}
                      <span>{options.heats[h] ?? 0}</span>
                    </button>
                  ))}
                {tray === "category" &&
                  CATEGORIES[tab].map((c) => (
                    <button key={c} type="button" className="vsc-chip is-pick" aria-pressed={filter.categories.includes(c)} data-empty={!options.categories[c] || undefined} onClick={() => setFilter({ categories: toggleIn(filter.categories, c) })}>
                      {c}
                      <span>{options.categories[c] ?? 0}</span>
                    </button>
                  ))}
                {tray === "heat" && (
                  <p className="vsc-filters__note">From each post&apos;s views per day since it went up, read when it was added.</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="vsc-grid" aria-live="polite">
          {pendingHere.map((p) => (
            <PendingTile key={p.tempId} pending={p} onCancel={() => cancelPending(p.tempId)} />
          ))}
          {visible.map((c, i) => (
            <div key={c.id} id={`vsc-${c.id}`} className={`vsc-cell${i === 0 && lead !== "none" ? ` is-lead is-${lead}` : ""}`}>
              <ClipTile
                clip={c}
                lead={i === 0 && lead !== "none"}
                active={activeId === c.id}
                sound={sound && interacted}
                flash={flashId === c.id}
                onEnter={() => enter(c.id)}
                onLeave={() => leave(c.id)}
                onToggle={() => setActiveId((a) => (a === c.id ? null : c.id))}
                onDelete={() => deleteClip(c.id)}
                onFindSong={c.tab === "audio" ? () => void findSong(c.id) : undefined}
                finding={finding.has(c.id)}
                onEditTags={() => setEditing(c.id)}
              />
            </div>
          ))}
          {visible.length > 0 && !filtering && (
            <button type="button" className="vsc-addtile" onClick={() => inputRef.current?.focus()}>
              <span className="vsc-addtile__art">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="vsc-addtile__label">Add a link to {def.label}</span>
              <span className="vsc-addtile__hint">or paste one anywhere</span>
            </button>
          )}
        </div>

        {ready && filtering && !visible.length && inTab.length > 0 && (
          <div className="vsc-empty">
            <h2>No clips match those filters.</h2>
            <p>Try fewer filters, or tag a clip with the Edit button under it.</p>
            <button type="button" className="vsc-empty__go" onClick={() => setFilter({ moods: [], heats: [], categories: [] })}>
              Clear filters
            </button>
          </div>
        )}
        {empty && (
          <div className="vsc-empty">
            <h2>Nothing in {def.label} yet.</h2>
            <p>
              Paste a link above and it lands here, newest first. Hover a clip to watch it in colour; the × on its corner removes it.
            </p>
            <button type="button" className="vsc-empty__go" onClick={() => inputRef.current?.focus()}>
              Paste your first link
            </button>
          </div>
        )}
        {!ready && <p className="vsc-loading">Opening…</p>}
      </section>

      {dropping && (
        <div className="vsc-drop" aria-hidden="true">
          <p>
            Drop to add to <strong>{def.label}</strong>
          </p>
        </div>
      )}

      {editingClip && <TagSheet clip={editingClip} onClose={() => setEditing(null)} onSave={(t) => saveTags(editingClip.id, t)} />}

      {toast && (
        <div className="vsc-toast" role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </main>
  );
}

/** Pick a clip's moods and categories by hand. A sheet from the bottom on a phone, a small panel on a laptop. */
function TagSheet({ clip, onClose, onSave }: { clip: Clip; onClose: () => void; onSave: (tags: ClipTags) => void }) {
  const [moods, setMoods] = useState<string[]>(clip.tags?.moods ?? []);
  const [cats, setCats] = useState<string[]>(clip.tags?.categories ?? []);
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="vsc-sheet" role="dialog" aria-modal="true" aria-label="Tags" onClick={onClose}>
      <div className="vsc-sheet__panel" onClick={(e) => e.stopPropagation()}>
        <p className="vsc-sheet__title">{clip.title || "This clip"}</p>
        <p className="vsc-sheet__label">Mood</p>
        <div className="vsc-sheet__chips">
          {MOODS.map((m) => (
            <button key={m} type="button" className="vsc-chip is-pick" aria-pressed={moods.includes(m)} onClick={() => setMoods(flip(moods, m))}>
              {m}
            </button>
          ))}
        </div>
        <p className="vsc-sheet__label">Category</p>
        <div className="vsc-sheet__chips">
          {CATEGORIES[clip.tab].map((c) => (
            <button key={c} type="button" className="vsc-chip is-pick" aria-pressed={cats.includes(c)} onClick={() => setCats(flip(cats, c))}>
              {c}
            </button>
          ))}
        </div>
        <div className="vsc-sheet__actions">
          <button type="button" className="vsc-sheet__cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="vsc-sheet__save" onClick={() => onSave({ moods, categories: cats })}>
            Save tags
          </button>
        </div>
      </div>
    </div>
  );
}
