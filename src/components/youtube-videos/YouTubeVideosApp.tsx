"use client";

// ---------------------------------------------------------------------------
// YouTube videos — paste social and YouTube links, watch them later.
//
// One component, two homes: the Jarvis Dashboard widget's full-size sheet
// (embedded) and its own page at /apps/youtube-videos. It owns its scroll
// container, because the hero reads scroll progress from it.
//
// Page grammar (scroll-craft): a layered hero you can play with, then the
// working surface.
//   plane 0  ground        CSS light and grain, slowest
//   plane 1  the Reel      Blender GLB, live (ReelHero.tsx)
//   plane 2  the copy      headline + paste box on its own scrim, so the
//                          moving layer never sits under words
//   plane 3  flecks        inside the Reel, fastest with the pointer
// Scrolling deals the reel's tiles down toward the saved grid, which is the
// same list, in the same order, as cards.
//
// Saving: paste into the box, press Enter, or paste anywhere on the page.
// Several links at once work. Pasting a saved video again moves it to the
// top instead of adding a copy. Delete has an Undo.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import "./ytv.css";
import type { ReelHeroHandle } from "./ReelHero";
import { PLATFORM_LABEL, type Platform } from "@/lib/youtube-videos/links";
import { tasteOf, type SavedVideo } from "@/lib/youtube-videos/library";
import type { RecResponse, Recommendation } from "@/lib/youtube-videos/recommend";
import { useLibrary } from "@/lib/youtube-videos/useLibrary";

const ReelHero = dynamic(() => import("./ReelHero").then((m) => m.ReelHero), { ssr: false });

const GLB = "/youtube-videos/hero-reel.glb";
const POSTER = "/youtube-videos/hero-reel.webp";
const POSTER_PHONE = "/youtube-videos/hero-reel-phone.webp";

const PLATFORM_HUE: Record<Platform, string> = {
  youtube: "#ff4b3e",
  tiktok: "#23f0c7",
  instagram: "#ff4b8b",
  facebook: "#5b8cff",
  x: "#d9dde8",
  vimeo: "#3fd6ff",
  twitch: "#9a7bff",
  reddit: "#ff7a59",
  snapchat: "#ffd166",
  pinterest: "#ff4b3e",
  web: "#9aa3b5",
};

function ago(t: number): string {
  const m = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(t).toLocaleDateString();
}

const KIND: Record<string, string> = { short: "Short", live: "Live", reel: "Reel", post: "Post", clip: "Clip", video: "Video" };

function titleOf(v: SavedVideo): string {
  if (v.title) return v.title;
  try {
    const u = new URL(v.url);
    return `${PLATFORM_LABEL[v.platform]} ${KIND[v.kind]?.toLowerCase() ?? "video"} · ${u.hostname.replace(/^www\./, "")}`;
  } catch {
    return v.url;
  }
}

type Tab = "saved" | "foryou";

export function YouTubeVideosApp({ embedded = false }: { embedded?: boolean }) {
  const lib = useLibrary();
  const scroller = useRef<HTMLDivElement>(null);
  const heroWrap = useRef<HTMLDivElement>(null);
  const reel = useRef<ReelHeroHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  const progress = useRef(0);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<Tab>("saved");
  const [toast, setToast] = useState<{ text: string; undo?: SavedVideo } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [playing, setPlaying] = useState<SavedVideo | null>(null);
  const [wide, setWide] = useState(true);
  const [filter, setFilter] = useState<Platform | "all">("all");

  // ---- scroll → the hero's planes ----------------------------------------
  useEffect(() => {
    const sc = scroller.current;
    const hw = heroWrap.current;
    if (!sc || !hw) return;
    const onScroll = () => {
      const span = Math.max(1, hw.offsetHeight - sc.clientHeight * 0.35);
      const p = Math.min(1, Math.max(0, sc.scrollTop / span));
      progress.current = p;
      sc.style.setProperty("--ytv-p", p.toFixed(4));
    };
    const onSize = () => {
      sc.style.setProperty("--ytv-h", `${sc.clientHeight}px`);
      setWide(sc.clientWidth >= 820);
      onScroll();
    };
    onSize();
    sc.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onSize);
    ro.observe(sc);
    return () => {
      sc.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- saving -------------------------------------------------------------
  const save = useCallback(
    (text: string, from?: { x: number; y: number }) => {
      const r = lib.save(text);
      if (r.nothing) {
        setToast({ text: "That doesn't look like a link. Copy the video's Share link and paste it here." });
        return false;
      }
      setDraft("");
      setTab("saved");
      setFilter("all");
      if (r.first) {
        setFlash(r.first);
        setTimeout(() => setFlash(null), 1600);
      }
      const box = input.current?.getBoundingClientRect();
      const pt = from ?? (box ? { x: box.left + box.width * 0.3, y: box.top + box.height / 2 } : null);
      if (pt && r.added) reel.current?.feed(pt.x, pt.y);
      setToast({
        text:
          r.added && r.bumped
            ? `Saved ${r.added} · ${r.bumped} already here, moved to the top`
            : r.added
              ? r.added === 1
                ? "Saved. It's at the top of your list."
                : `Saved ${r.added} videos`
              : r.bumped === 1
                ? "Already saved. Moved it back to the top."
                : `Already saved. Moved ${r.bumped} back to the top.`,
      });
      return true;
    },
    [lib],
  );

  // Paste anywhere on the page saves (unless you're typing in another box).
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (inField && target !== input.current) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!/https?:\/\/|youtu\.be|www\./i.test(text)) return;
      e.preventDefault();
      save(text);
    };
    sc.addEventListener("paste", onPaste);
    return () => sc.removeEventListener("paste", onPaste);
  }, [save]);

  const remove = (v: SavedVideo) => {
    const gone = lib.remove(v.id);
    if (gone) setToast({ text: "Deleted.", undo: gone });
  };

  const platforms = useMemo(() => [...new Set(lib.videos.map((v) => v.platform))], [lib.videos]);
  const shown = filter === "all" ? lib.videos : lib.videos.filter((v) => v.platform === filter);
  const thumbs = useMemo(() => lib.videos.filter((v) => v.thumb).map((v) => v.thumb!).slice(0, 9), [lib.videos]);

  return (
    <div ref={scroller} className={`ytv ytv-scroll ${embedded ? "ytv--embedded" : ""}`}>
      {/* ---------------- hero ---------------- */}
      <div ref={heroWrap} className="ytv-herowrap">
        <section className="ytv-hero" aria-labelledby="ytv-title">
          <div className="ytv-ground" aria-hidden />
          <ReelHero ref={reel} glb={GLB} poster={POSTER} posterPhone={POSTER_PHONE} thumbs={thumbs} progress={progress} shift={wide ? 1.35 : 0} />
          <div className="ytv-copy">
            <div className="ytv-scrim">
              <h1 id="ytv-title" className="ytv-h1">
                Paste it now.
                <br />
                Watch it later.
              </h1>
              <p className="ytv-sub">YouTube, Shorts, TikTok, Reels, X, Vimeo. Drop the link, it waits here on every device you sign in on.</p>
              <form
                className="ytv-paste"
                onSubmit={(e) => {
                  e.preventDefault();
                  save(draft);
                }}
              >
                <label htmlFor="ytv-link" className="sr-only">
                  Video link
                </label>
                <Icon.Link width={16} height={16} className="ytv-paste-icon" aria-hidden />
                <input
                  id="ytv-link"
                  ref={input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Paste a video link"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="go"
                />
                <button type="submit" className="ytv-save" disabled={!draft.trim()}>
                  Save
                </button>
              </form>
              <p className="ytv-hint">
                {lib.videos.length
                  ? `${lib.videos.length} saved · paste anywhere on this page works too`
                  : "Paste anywhere on this page works too. Several links at once is fine."}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* ---------------- the working surface ---------------- */}
      <div className="ytv-body">
        <nav className="ytv-tabs" aria-label="YouTube videos">
          <div role="tablist" className="ytv-tablist">
            <button role="tab" aria-selected={tab === "saved"} className="ytv-tab" onClick={() => setTab("saved")}>
              Saved <span className="ytv-count">{lib.videos.length}</span>
            </button>
            <button role="tab" aria-selected={tab === "foryou"} className="ytv-tab" onClick={() => setTab("foryou")}>
              For you
            </button>
          </div>
          {tab === "saved" && platforms.length > 1 && (
            <div className="ytv-filters" aria-label="Show">
              {(["all", ...platforms] as const).map((p) => (
                <button key={p} type="button" className="ytv-chip" aria-pressed={filter === p} onClick={() => setFilter(p)}>
                  {p === "all" ? "All" : PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>
          )}
        </nav>

        {tab === "saved" ? (
          shown.length === 0 ? (
            <div className="ytv-empty">
              <p className="ytv-empty-h">{lib.ready ? "Nothing saved yet." : "Loading your list…"}</p>
              {lib.ready && <p>Paste your first link in the box up top. It shows up right here.</p>}
            </div>
          ) : (
            <ul className="ytv-grid">
              {shown.map((v) => (
                <VideoCard
                  key={v.id}
                  v={v}
                  flash={flash === v.id}
                  onPlay={() => (v.embed ? setPlaying(v) : window.open(v.url, "_blank", "noopener"))}
                  onWatched={() => lib.watched(v.id)}
                  onDelete={() => remove(v)}
                />
              ))}
            </ul>
          )
        ) : (
          <ForYou videos={lib.videos} onSave={(url) => save(url)} />
        )}
      </div>

      {playing && <Player v={playing} onClose={() => setPlaying(null)} onWatched={() => lib.watched(playing.id)} />}

      {toast && (
        <div role="status" className="ytv-toast">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                lib.undo(toast.undo!);
                setToast({ text: "Back in your list." });
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Thumb({ src, platform, label }: { src?: string; platform: Platform; label: string }) {
  const [bad, setBad] = useState(false);
  if (src && !bad) return <img src={src} alt="" loading="lazy" onError={() => setBad(true)} />;
  return (
    <span className="ytv-thumb-blank" style={{ ["--c" as string]: PLATFORM_HUE[platform] }} aria-hidden>
      <span>{label}</span>
    </span>
  );
}

function VideoCard({ v, flash, onPlay, onWatched, onDelete }: { v: SavedVideo; flash: boolean; onPlay: () => void; onWatched: () => void; onDelete: () => void }) {
  const title = titleOf(v);
  return (
    <li className="ytv-card" data-flash={flash} data-watched={Boolean(v.watchedAt)} data-kind={v.kind}>
      <button type="button" className="ytv-thumb" onClick={onPlay} aria-label={`${v.embed ? "Play" : "Open"} ${title}`}>
        <Thumb src={v.thumb} platform={v.platform} label={PLATFORM_LABEL[v.platform]} />
        <span className="ytv-play" aria-hidden>
          <Icon.Play width={18} height={18} />
        </span>
        {v.watchedAt && <span className="ytv-watched-badge">Watched</span>}
      </button>
      <div className="ytv-card-body">
        <p className="ytv-card-title" title={title}>
          {title}
        </p>
        <p className="ytv-card-meta">
          <span className="ytv-dot" style={{ background: PLATFORM_HUE[v.platform] }} aria-hidden />
          <span>
            {PLATFORM_LABEL[v.platform]}
            {v.kind !== "video" ? ` · ${KIND[v.kind]}` : ""}
            {v.author ? ` · ${v.author}` : ""} · {ago(v.addedAt)}
          </span>
        </p>
      </div>
      <div className="ytv-card-actions">
        <a href={v.url} target="_blank" rel="noopener noreferrer" className="ytv-icon" aria-label={`Open ${title} on ${PLATFORM_LABEL[v.platform]}`} title={`Open on ${PLATFORM_LABEL[v.platform]}`}>
          <Icon.Launch width={14} height={14} aria-hidden />
        </a>
        <button type="button" className="ytv-icon" onClick={onWatched} aria-pressed={Boolean(v.watchedAt)} aria-label={v.watchedAt ? "Mark as not watched" : "Mark as watched"} title={v.watchedAt ? "Watched (tap to undo)" : "Mark watched"}>
          <Icon.Check width={14} height={14} aria-hidden />
        </button>
        <button type="button" className="ytv-icon ytv-icon--danger" onClick={onDelete} aria-label={`Delete ${title}`} title="Delete">
          <Icon.Trash width={14} height={14} aria-hidden />
        </button>
      </div>
    </li>
  );
}

function Player({ v, onClose, onWatched }: { v: SavedVideo; onClose: () => void; onWatched: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="ytv-player" role="dialog" aria-modal="true" aria-label={titleOf(v)} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`ytv-player-frame ${v.kind === "short" ? "ytv-player-frame--tall" : ""}`}>
        <iframe src={v.embed} title={titleOf(v)} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      </div>
      <div className="ytv-player-bar">
        <p className="ytv-card-title">{titleOf(v)}</p>
        <button
          type="button"
          className="ytv-chip"
          aria-pressed={Boolean(v.watchedAt)}
          onClick={() => {
            onWatched();
            onClose();
          }}
        >
          {v.watchedAt ? "Watched" : "Done, mark watched"}
        </button>
        <button type="button" className="ytv-icon" onClick={onClose} aria-label="Close player" autoFocus>
          <Icon.Close width={14} height={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ---- For you -----------------------------------------------------------------

const REC_CACHE = "youtube-videos:recs";

function ForYou({ videos, onSave }: { videos: SavedVideo[]; onSave: (url: string) => void }) {
  const taste = useMemo(() => tasteOf({ v: 1, videos }), [videos]);
  // Picks refresh on their own when what you save changes; same saves, same picks.
  const sig = useMemo(() => taste.map((t) => t.title ?? t.videoId ?? "").join("|"), [taste]);
  const [data, setData] = useState<RecResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useMemo(() => new Set(videos.map((v) => v.videoId).filter(Boolean)), [videos]);

  useEffect(() => {
    let cancel = false;
    try {
      const c = JSON.parse(sessionStorage.getItem(REC_CACHE) ?? "null") as { sig: string; data: RecResponse } | null;
      if (c && c.sig === sig) {
        setData(c.data);
        return;
      }
    } catch {
      /* no cache */
    }
    setBusy(true);
    const t = setTimeout(() => {
      fetch("/api/youtube-videos/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos: taste }) })
        .then((r) => (r.ok ? (r.json() as Promise<RecResponse>) : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
          if (cancel) return;
          setData(d);
          try {
            sessionStorage.setItem(REC_CACHE, JSON.stringify({ sig, data: d }));
          } catch {
            /* full */
          }
        })
        .catch(() => !cancel && setData({ mode: "empty", items: [], note: "Couldn't reach the picks just now. They'll try again next time you open this tab." }))
        .finally(() => !cancel && setBusy(false));
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [sig, taste]);

  if (!data) return <div className="ytv-empty"><p className="ytv-empty-h">{busy ? "Finding picks for you…" : " "}</p></div>;
  return (
    <div>
      <p className="ytv-note">{data.note}</p>
      {data.items.length === 0 ? null : (
        <ul className="ytv-grid">
          {data.items.map((r) => (
            <RecCard key={r.id} r={r} saved={Boolean(r.videoId && saved.has(r.videoId))} onSave={() => onSave(r.url)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecCard({ r, saved, onSave }: { r: Recommendation; saved: boolean; onSave: () => void }) {
  if (r.type === "search") {
    return (
      <li className="ytv-card ytv-card--search">
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="ytv-search">
          <Icon.Search width={16} height={16} aria-hidden />
          <span className="ytv-search-title">{r.title}</span>
          {r.reason && <span className="ytv-search-why">{r.reason}</span>}
          <span className="ytv-search-go">Search on YouTube</span>
        </a>
      </li>
    );
  }
  return (
    <li className="ytv-card">
      <a href={r.url} target="_blank" rel="noopener noreferrer" className="ytv-thumb" aria-label={`Watch ${r.title} on YouTube`}>
        <Thumb src={r.thumb} platform="youtube" label="YouTube" />
        <span className="ytv-play" aria-hidden>
          <Icon.Play width={18} height={18} />
        </span>
      </a>
      <div className="ytv-card-body">
        <p className="ytv-card-title" title={r.title}>
          {r.title}
        </p>
        <p className="ytv-card-meta">
          <span>
            {r.channel ? `${r.channel} · ` : ""}
            {r.reason}
          </span>
        </p>
      </div>
      <div className="ytv-card-actions">
        <button type="button" className="ytv-chip" disabled={saved} onClick={onSave}>
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </li>
  );
}
