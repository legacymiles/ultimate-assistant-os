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
import { addClip, clipsIn, guessVertical, countsByTab, extractLinks, findDuplicate, linkKey, offlinePlayback, removeClip, restoreClip, storedKeys } from "@/lib/viral-studio/board";
import { parseLink } from "@/lib/social-import/platform";
import { posterUrl } from "@/lib/viral-studio/playback";
import * as store from "@/lib/viral-studio/store";
import { TABS, isTabId, type Board, type Clip, type ResolvedLink, type TabId } from "@/lib/viral-studio/types";

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
  const inputRef = useRef<HTMLInputElement>(null);

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
          body: JSON.stringify({ url }),
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
  const visible = useMemo(() => clipsIn(board, tab), [board, tab]);
  const pendingHere = pending.filter((p) => p.tab === tab);
  const empty = ready && !visible.length && !pendingHere.length;
  const total = visible.length;
  const lead = visible[0];
  const ambient = lead ? posterUrl(lead) : null;
  const tabIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <main
      className={`vsc${dropping ? " is-dropping" : ""}${geist}`}
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
      <header className="vsc-bar">
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
        {(visible.length > 0 || pendingHere.length > 0) && (
          <div className="vsc-wall__head">
            <h2>Newest first</h2>
            <p>Hover to watch · <kbd>Del</kbd> removes the one you&apos;re on</p>
          </div>
        )}

        <div className="vsc-grid" aria-live="polite">
          {pendingHere.map((p) => (
            <PendingTile key={p.tempId} pending={p} onCancel={() => cancelPending(p.tempId)} />
          ))}
          {visible.map((c) => (
            <div key={c.id} id={`vsc-${c.id}`} className="vsc-cell">
              <ClipTile
                clip={c}
                active={activeId === c.id}
                sound={sound && interacted}
                flash={flashId === c.id}
                onEnter={() => enter(c.id)}
                onLeave={() => leave(c.id)}
                onToggle={() => setActiveId((a) => (a === c.id ? null : c.id))}
                onDelete={() => deleteClip(c.id)}
              />
            </div>
          ))}
        </div>

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
