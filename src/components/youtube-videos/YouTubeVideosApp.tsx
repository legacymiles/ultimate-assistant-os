"use client";

// ---------------------------------------------------------------------------
// YouTube videos — paste social and YouTube links, watch them later.
//
// One component, two homes: the Jarvis Dashboard widget's full-size sheet
// (embedded) and its own page at /apps/youtube-videos. It owns its scroll
// container, because the hero reads scroll progress from it.
//
// Design: the Holo Deck (interactive-web-studio + scroll-craft layering +
// blender-to-web asset), in Jarvis's HUD language (Oxanium, JetBrains Mono,
// cyan HUD with a coral "play" signal).
//   plane 0  backdrop    shader grid floor + stars (inside ReelHero)
//   plane 1  the ring    Blender screens wearing your saves; drag to spin,
//                        click one to play it
//   plane 2  HUD         brackets, reticle on the core, callouts, telemetry
//   plane 3  the copy    headline + command bar on their own glass, so the
//                        moving layers never sit under words
// Below, the library: tiles that expand in place into a player (and details)
// on a click, and collapse on a click, Esc, or opening another.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import "./ytv.css";
import type { ReelHeroHandle, ReelItem } from "./ReelHero";
import { PLATFORM_LABEL, embedFor, instantThumb, isTall, parsePaste, type ParsedLink, type Platform, type VideoKind } from "@/lib/youtube-videos/links";
import { tasteOf, type SavedVideo } from "@/lib/youtube-videos/library";
import type { RecResponse, Recommendation } from "@/lib/youtube-videos/recommend";
import { useLibrary } from "@/lib/youtube-videos/useLibrary";
import { KEY_SOURCES, stepsFor } from "@/lib/new-jarvis/keySetup";

const ReelHero = dynamic(() => import("./ReelHero").then((m) => m.ReelHero), { ssr: false });

const GLB = "/youtube-videos/hero-holo.glb";
const POSTER = "/youtube-videos/hero-holo.webp";
const POSTER_PHONE = "/youtube-videos/hero-holo-phone.webp";

export const PLATFORM_HUE: Record<Platform, string> = {
  youtube: "#ff4b3e",
  tiktok: "#23f0c7",
  instagram: "#ff4b8b",
  facebook: "#5b8cff",
  x: "#d9dde8",
  vimeo: "#3be3ff",
  twitch: "#a67bff",
  reddit: "#ff7a59",
  snapchat: "#ffd166",
  pinterest: "#ff4b3e",
  web: "#9aa3b5",
};
export const PLATFORM_TAG: Record<Platform, string> = {
  youtube: "YT",
  tiktok: "TT",
  instagram: "IG",
  facebook: "FB",
  x: "X",
  vimeo: "VM",
  twitch: "TW",
  reddit: "RD",
  snapchat: "SC",
  pinterest: "PN",
  web: "WEB",
};
const KIND: Record<VideoKind, string> = { short: "Short", live: "Live", reel: "Reel", post: "Post", clip: "Clip", video: "Video" };

function ago(t: number): string {
  const m = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(t).toLocaleDateString();
}

function titleOf(v: { title?: string; url: string; platform: Platform; kind: VideoKind }): string {
  if (v.title) return v.title;
  try {
    const u = new URL(v.url);
    return `${PLATFORM_LABEL[v.platform]} ${KIND[v.kind].toLowerCase()} · ${u.hostname.replace(/^www\./, "")}`;
  } catch {
    return v.url;
  }
}

type Tab = "saved" | "foryou";
type Show = "all" | "unwatched";

/** Anything a tile can show: a saved video, or a pick from For you. */
interface TileVideo {
  id: string;
  url: string;
  platform: Platform;
  kind: VideoKind;
  videoId?: string;
  start?: number;
  thumb?: string;
  title: string;
  author?: string;
  addedAt?: number;
  watchedAt?: number;
  reason?: string;
}

const toTile = (v: SavedVideo): TileVideo => ({ ...v, title: titleOf(v), thumb: v.thumb ?? instantThumb(v) });

export function YouTubeVideosApp({ embedded = false }: { embedded?: boolean }) {
  const lib = useLibrary();
  const scroller = useRef<HTMLDivElement>(null);
  const heroWrap = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const reel = useRef<ReelHeroHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  const progress = useRef(0);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<Tab>("saved");
  const [toast, setToast] = useState<{ text: string; undo?: SavedVideo } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [wide, setWide] = useState(true);
  const [filter, setFilter] = useState<Platform | "all">("all");
  const [show, setShow] = useState<Show>("all");

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
      setWide(sc.clientWidth >= 860);
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

  // Esc collapses an open video first (the widget sheet's Esc waits its turn).
  useEffect(() => {
    if (!openId) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setOpenId(null);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [openId]);

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
      setShow("all");
      if (r.first) {
        setFlash(r.first);
        setTimeout(() => setFlash(null), 1800);
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
    if (openId === v.id) setOpenId(null);
    const gone = lib.remove(v.id);
    if (gone) setToast({ text: "Deleted.", undo: gone });
  };

  /** Open a video in the library: switch to Saved, expand it, bring it into view. */
  const openInLibrary = useCallback((id: string) => {
    setTab("saved");
    setFilter("all");
    setShow("all");
    setOpenId(id);
  }, []);

  const platforms = useMemo(() => {
    const c = new Map<Platform, number>();
    for (const v of lib.videos) c.set(v.platform, (c.get(v.platform) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [lib.videos]);
  const unwatched = lib.videos.filter((v) => !v.watchedAt).length;
  const shown = lib.videos.filter((v) => (filter === "all" || v.platform === filter) && (show === "all" || !v.watchedAt));
  const reelItems = useMemo<ReelItem[]>(
    () => lib.videos.slice(0, 10).map((v) => ({ id: v.id, title: titleOf(v), platform: PLATFORM_LABEL[v.platform], thumb: v.thumb ?? instantThumb(v) })),
    [lib.videos],
  );

  // live preview of what's in the command bar
  const preview: ParsedLink[] = useMemo(() => (draft.trim() ? parsePaste(draft) : []), [draft]);
  const savedKeys = useMemo(() => new Set(lib.videos.map((v) => v.key)), [lib.videos]);

  return (
    <div ref={scroller} className={`ytv ytv-scroll ${embedded ? "ytv--embedded" : ""}`}>
      {/* ---------------- hero ---------------- */}
      <div ref={heroWrap} className="ytv-herowrap">
        <section className="ytv-hero" aria-labelledby="ytv-title">
          <ReelHero
            ref={reel}
            glb={GLB}
            poster={POSTER}
            posterPhone={POSTER_PHONE}
            items={reelItems}
            progress={progress}
            shift={wide ? 1.75 : 0}
            onOpen={(id) => {
              openInLibrary(id);
            }}
            onEmpty={() => input.current?.focus()}
          />

          <Hud count={lib.videos.length} unwatched={unwatched} platforms={platforms} />

          <div className="ytv-copy">
            <div className="ytv-scrim">
              <p className="ytv-kicker">
                <span className="ytv-live" aria-hidden />
                Watch later · {lib.videos.length} {lib.videos.length === 1 ? "signal" : "signals"} saved
              </p>
              <h1 id="ytv-title" className="ytv-h1">
                <span className="ytv-line">
                  <span style={{ ["--i" as string]: 0 }}>Paste</span> <span style={{ ["--i" as string]: 1 }}>it</span> <span style={{ ["--i" as string]: 2 }}>now.</span>
                </span>
                <span className="ytv-line ytv-line--accent">
                  <span style={{ ["--i" as string]: 3 }}>Watch</span> <span style={{ ["--i" as string]: 4 }}>it</span> <span style={{ ["--i" as string]: 5 }}>later.</span>
                </span>
              </h1>
              <p className="ytv-sub">YouTube, Shorts, TikTok, Reels, X, Vimeo, Twitch. Drop the link and it waits here, on every device you sign in on.</p>

              <CommandBar
                inputRef={input}
                draft={draft}
                setDraft={setDraft}
                preview={preview}
                savedKeys={savedKeys}
                onSave={() => save(draft)}
              />
            </div>
          </div>
        </section>
      </div>

      {/* ---------------- the library ---------------- */}
      <div ref={bodyRef} className="ytv-body">
        <nav className="ytv-tabs" aria-label="YouTube videos">
          <div role="tablist" className="ytv-seg" data-at={tab}>
            <span className="ytv-seg-pill" aria-hidden />
            <button role="tab" aria-selected={tab === "saved"} className="ytv-seg-btn" onClick={() => setTab("saved")}>
              Saved <span className="ytv-count">{lib.videos.length}</span>
            </button>
            <button role="tab" aria-selected={tab === "foryou"} className="ytv-seg-btn" onClick={() => setTab("foryou")}>
              For you
            </button>
          </div>
          {tab === "saved" && lib.videos.length > 0 && (
            <div className="ytv-filters" aria-label="Show">
              <button type="button" className="ytv-chip" aria-pressed={show === "unwatched"} onClick={() => setShow(show === "unwatched" ? "all" : "unwatched")}>
                Unwatched <span className="ytv-chip-n">{unwatched}</span>
              </button>
              {platforms.length > 1 &&
                [["all", lib.videos.length] as const, ...platforms].map(([p, n]) => (
                  <button
                    key={p}
                    type="button"
                    className="ytv-chip"
                    aria-pressed={filter === p}
                    onClick={() => setFilter(p)}
                    style={p !== "all" ? { ["--c" as string]: PLATFORM_HUE[p] } : undefined}
                  >
                    {p === "all" ? "All" : PLATFORM_LABEL[p]} <span className="ytv-chip-n">{n}</span>
                  </button>
                ))}
            </div>
          )}
        </nav>

        {tab === "saved" ? (
          shown.length === 0 ? (
            <div className="ytv-empty">
              <p className="ytv-empty-h">{!lib.ready ? "Loading your list…" : lib.videos.length ? "Nothing matches that filter." : "No signals yet."}</p>
              {lib.ready && !lib.videos.length && <p>Paste your first link in the bar up top. It lands right here, and on a screen in the ring.</p>}
            </div>
          ) : (
            <Library
              scroller={scroller}
              items={shown.map(toTile)}
              openId={openId}
              setOpenId={setOpenId}
              flash={flash}
              renderActions={(t) => {
                const v = lib.videos.find((x) => x.id === t.id)!;
                return (
                  <>
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="ytv-icon" aria-label={`Open on ${PLATFORM_LABEL[t.platform]}`} title={`Open on ${PLATFORM_LABEL[t.platform]}`}>
                      <Icon.Launch width={14} height={14} aria-hidden />
                    </a>
                    <button type="button" className="ytv-icon" onClick={() => lib.watched(t.id)} aria-pressed={Boolean(t.watchedAt)} aria-label={t.watchedAt ? "Mark as not watched" : "Mark as watched"} title={t.watchedAt ? "Watched (tap to undo)" : "Mark watched"}>
                      <Icon.Check width={14} height={14} aria-hidden />
                    </button>
                    <button type="button" className="ytv-icon ytv-icon--danger" onClick={() => remove(v)} aria-label={`Delete ${t.title}`} title="Delete">
                      <Icon.Trash width={14} height={14} aria-hidden />
                    </button>
                  </>
                );
              }}
            />
          )
        ) : (
          <ForYou videos={lib.videos} embedded={embedded} scroller={scroller} onSave={(url) => save(url)} />
        )}
      </div>

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

// ---- HUD ----------------------------------------------------------------------

function Hud({ count, unwatched, platforms }: { count: number; unwatched: number; platforms: [Platform, number][] }) {
  const clock = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (clock.current) clock.current.textContent = new Date().toLocaleTimeString([], { hour12: false });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="ytv-hud" aria-hidden>
      <span className="ytv-bracket ytv-bracket--tl" />
      <span className="ytv-bracket ytv-bracket--tr" />
      <span className="ytv-bracket ytv-bracket--bl" />
      <span className="ytv-bracket ytv-bracket--br" />
      <div className="ytv-hud-top">
        <span>SIGNAL DECK</span>
        <span className="ytv-hud-dim">//</span>
        <span ref={clock} className="ytv-hud-dim" />
      </div>
      <div className="ytv-hud-stats">
        <span>
          <b>{String(count).padStart(2, "0")}</b> SAVED
        </span>
        <span>
          <b>{String(unwatched).padStart(2, "0")}</b> UNWATCHED
        </span>
        {platforms.slice(0, 4).map(([p, n]) => (
          <span key={p} style={{ ["--c" as string]: PLATFORM_HUE[p] }} className="ytv-hud-plat">
            <i />
            {PLATFORM_TAG[p]} {n}
          </span>
        ))}
      </div>
      <div className="ytv-hud-hint">DRAG TO SPIN · CLICK A SCREEN TO PLAY</div>
    </div>
  );
}

// ---- the command bar: knows what you pasted before you save it ------------------

function CommandBar({
  inputRef,
  draft,
  setDraft,
  preview,
  savedKeys,
  onSave,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  draft: string;
  setDraft: (s: string) => void;
  preview: ParsedLink[];
  savedKeys: Set<string>;
  onSave: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const first = preview[0];
  const thumb = first ? instantThumb(first) : undefined;
  const dup = first ? savedKeys.has(first.key) : false;
  const ready = preview.length > 0;
  return (
    <div className="ytv-cmd-wrap" data-ready={ready} style={first ? { ["--c" as string]: PLATFORM_HUE[first.platform] } : undefined}>
      <form
        className="ytv-cmd"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <span className="ytv-cmd-tag" aria-hidden>
          {first ? PLATFORM_TAG[first.platform] : <Icon.Link width={15} height={15} />}
        </span>
        <label htmlFor="ytv-link" className="sr-only">
          Video link
        </label>
        <input
          id="ytv-link"
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste a video link"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button
          ref={btn}
          type="submit"
          className="ytv-save"
          disabled={!draft.trim()}
          onPointerMove={(e) => {
            if (e.pointerType !== "mouse") return;
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.28}px)`;
          }}
          onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
        >
          Save
          <Icon.ArrowRight width={14} height={14} aria-hidden />
        </button>
      </form>
      {/* What it understood, before you commit. */}
      <div className="ytv-cmd-preview" aria-live="polite">
        {first ? (
          <>
            <span className="ytv-cmd-thumb">{thumb ? <img src={thumb} alt="" /> : <i>{PLATFORM_TAG[first.platform]}</i>}</span>
            <span className="ytv-cmd-what">
              <b>
                {PLATFORM_LABEL[first.platform]} {KIND[first.kind].toLowerCase()}
                {preview.length > 1 ? ` + ${preview.length - 1} more` : ""}
              </b>
              <span>{dup ? "Already saved · Enter moves it to the top" : "Ready · press Enter to save"}</span>
            </span>
          </>
        ) : (
          <span className="ytv-cmd-idle">Paste anywhere on this page works too · several links at once is fine</span>
        )}
      </div>
    </div>
  );
}

// ---- library: tiles that expand in place ----------------------------------------

function useFlip(container: React.RefObject<HTMLElement | null>, key: unknown) {
  const rects = useRef(new Map<string, DOMRect>());
  // Before the DOM changes, remember where every tile was…
  const snapshot = useCallback(() => {
    const el = container.current;
    if (!el) return;
    rects.current.clear();
    el.querySelectorAll<HTMLElement>("[data-flip]").forEach((n) => rects.current.set(n.dataset.flip!, n.getBoundingClientRect()));
  }, [container]);
  // …then animate each one from there to where it is now.
  useLayoutEffect(() => {
    const el = container.current;
    if (!el || !rects.current.size) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.querySelectorAll<HTMLElement>("[data-flip]").forEach((n) => {
      const was = rects.current.get(n.dataset.flip!);
      if (!was) return;
      const now = n.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      const sx = was.width / Math.max(1, now.width);
      const sy = was.height / Math.max(1, now.height);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
      n.animate(
        [
          { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: "top left", transform: "none" },
        ],
        { duration: 460, easing: "cubic-bezier(0.2, 0.85, 0.2, 1)" },
      );
    });
    rects.current.clear();
  }, [container, key]);
  return snapshot;
}

function Library({
  items,
  openId,
  setOpenId,
  flash,
  scroller,
  renderActions,
  onSave,
  savedIds,
}: {
  items: TileVideo[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
  flash?: string | null;
  scroller: React.RefObject<HTMLDivElement | null>;
  renderActions?: (t: TileVideo) => React.ReactNode;
  onSave?: (t: TileVideo) => void;
  savedIds?: Set<string>;
}) {
  const grid = useRef<HTMLUListElement>(null);
  const snapshot = useFlip(grid, openId);
  const toggle = (id: string) => {
    snapshot();
    setOpenId(openId === id ? null : id);
  };
  // Bring an opened tile into view under the sticky tab bar.
  useEffect(() => {
    if (!openId) return;
    const t = setTimeout(() => {
      const sc = scroller.current;
      const n = grid.current?.querySelector<HTMLElement>(`[data-flip="${openId}"]`);
      if (!sc || !n) return;
      const top = n.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 84;
      sc.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [openId, scroller]);

  return (
    <ul ref={grid} className="ytv-grid">
      {items.map((t, i) => (
        <VideoTile
          key={t.id}
          t={t}
          index={i}
          open={openId === t.id}
          flash={flash === t.id}
          onToggle={() => toggle(t.id)}
          actions={renderActions?.(t)}
          onSave={onSave ? () => onSave(t) : undefined}
          saved={savedIds?.has(t.videoId ?? "")}
        />
      ))}
    </ul>
  );
}

function tiltHandlers() {
  return {
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--ry", `${(px - 0.5) * 9}deg`);
      el.style.setProperty("--rx", `${(0.5 - py) * 9}deg`);
      el.style.setProperty("--mx", `${px * 100}%`);
      el.style.setProperty("--my", `${py * 100}%`);
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.style.setProperty("--rx", "0deg");
      e.currentTarget.style.setProperty("--ry", "0deg");
    },
  };
}

function VideoTile({
  t,
  index,
  open,
  flash,
  onToggle,
  actions,
  onSave,
  saved,
}: {
  t: TileVideo;
  index: number;
  open: boolean;
  flash: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  onSave?: () => void;
  saved?: boolean;
}) {
  const [bad, setBad] = useState(false);
  const host = typeof window === "undefined" ? "localhost" : window.location.hostname;
  const embed = embedFor(t, host);
  const tall = isTall(t);
  const hue = PLATFORM_HUE[t.platform];

  return (
    <li
      data-flip={t.id}
      className="ytv-tile"
      data-open={open}
      data-flash={flash}
      data-watched={Boolean(t.watchedAt)}
      data-tall={tall}
      style={{ ["--c" as string]: hue, ["--d" as string]: `${Math.min(index, 12) * 35}ms` }}
      {...(open ? {} : tiltHandlers())}
    >
      <span className="ytv-corner ytv-corner--tl" aria-hidden />
      <span className="ytv-corner ytv-corner--br" aria-hidden />

      {open ? (
        <div className="ytv-open">
          <div className="ytv-stage">
            {embed ? (
              <iframe
                src={embed}
                title={t.title}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="ytv-stage-link">
                {t.thumb && !bad ? <img src={t.thumb} alt="" onError={() => setBad(true)} /> : null}
                <span>
                  <Icon.Launch width={16} height={16} aria-hidden /> Watch on {PLATFORM_LABEL[t.platform]}
                </span>
              </a>
            )}
          </div>
          <div className="ytv-detail">
            <div className="ytv-detail-top">
              <span className="ytv-tag">
                <i />
                {PLATFORM_TAG[t.platform]} · {KIND[t.kind]}
              </span>
              <button type="button" className="ytv-collapse" onClick={onToggle} aria-label="Collapse video" title="Collapse (Esc)">
                <Icon.Close width={14} height={14} aria-hidden />
                <span>Collapse</span>
              </button>
            </div>
            <h3 className="ytv-detail-title">{t.title}</h3>
            <p className="ytv-detail-meta">
              {t.author ? <span>{t.author}</span> : null}
              {t.addedAt ? <span>Saved {ago(t.addedAt)}</span> : null}
              {t.reason ? <span>{t.reason}</span> : null}
              {t.watchedAt ? <span className="ytv-ok">Watched</span> : null}
            </p>
            <div className="ytv-detail-actions">
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="ytv-btn">
                <Icon.Launch width={13} height={13} aria-hidden /> Open on {PLATFORM_LABEL[t.platform]}
              </a>
              {onSave && (
                <button type="button" className="ytv-btn ytv-btn--go" disabled={saved} onClick={onSave}>
                  {saved ? "Saved" : "Save for later"}
                </button>
              )}
              {actions}
            </div>
            {!embed && <p className="ytv-detail-note">{PLATFORM_LABEL[t.platform]} doesn&apos;t allow playing this link inside other sites, so it opens there.</p>}
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="ytv-thumb" onClick={onToggle} aria-expanded={false} aria-label={`${embed ? "Play" : "Open"} ${t.title}`}>
            {t.thumb && !bad ? (
              <img src={t.thumb} alt="" loading="lazy" onError={() => setBad(true)} />
            ) : (
              <span className="ytv-thumb-blank" aria-hidden>
                <span>{PLATFORM_LABEL[t.platform]}</span>
              </span>
            )}
            <span className="ytv-scan" aria-hidden />
            <span className="ytv-glare" aria-hidden />
            <span className="ytv-idx" aria-hidden>
              #{String(index + 1).padStart(2, "0")}
            </span>
            <span className="ytv-tag ytv-tag--float">
              <i />
              {PLATFORM_TAG[t.platform]}
              {t.kind !== "video" ? ` · ${KIND[t.kind]}` : ""}
            </span>
            <span className="ytv-play" aria-hidden>
              <Icon.Play width={18} height={18} />
            </span>
            {t.watchedAt && <span className="ytv-watched-badge">Watched</span>}
          </button>
          <div className="ytv-tile-body">
            <button type="button" className="ytv-tile-title" onClick={onToggle} title={t.title}>
              {t.title}
            </button>
            <p className="ytv-tile-meta">
              <span>
                {t.author ? `${t.author} · ` : ""}
                {t.addedAt ? ago(t.addedAt) : t.reason ?? ""}
              </span>
            </p>
          </div>
          <div className="ytv-tile-actions">
            {onSave && (
              <button type="button" className="ytv-btn ytv-btn--sm ytv-btn--go" disabled={saved} onClick={onSave}>
                {saved ? "Saved" : "Save"}
              </button>
            )}
            {actions}
          </div>
        </>
      )}
    </li>
  );
}

// ---- For you -----------------------------------------------------------------

const REC_CACHE = "youtube-videos:recs";

function ForYou({
  videos,
  embedded,
  scroller,
  onSave,
}: {
  videos: SavedVideo[];
  embedded: boolean;
  scroller: React.RefObject<HTMLDivElement | null>;
  onSave: (url: string) => void;
}) {
  const taste = useMemo(() => tasteOf({ v: 1, videos }), [videos]);
  // Picks refresh on their own when what you save changes; same saves, same picks.
  const sig = useMemo(() => taste.map((t) => t.title ?? t.videoId ?? "").join("|"), [taste]);
  const [data, setData] = useState<RecResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const saved = useMemo(() => new Set(videos.map((v) => v.videoId).filter((x): x is string => Boolean(x))), [videos]);

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
    }, 300);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [sig, taste]);

  const videosOnly = (data?.items ?? []).filter((r) => r.type === "video");
  const searches = (data?.items ?? []).filter((r) => r.type === "search");
  const tiles: TileVideo[] = videosOnly.map((r: Recommendation) => ({
    id: r.id,
    url: r.url,
    platform: "youtube",
    kind: "video",
    videoId: r.videoId,
    thumb: r.thumb,
    title: r.title,
    author: r.channel,
    reason: r.reason,
  }));

  return (
    <div className="ytv-foryou">
      {!data ? (
        <div className="ytv-empty">
          <p className="ytv-empty-h">{busy ? "Tuning picks to what you save…" : " "}</p>
        </div>
      ) : (
        <>
          <p className="ytv-note">
            <span className="ytv-live" aria-hidden /> {data.note}
          </p>
          {tiles.length > 0 && (
            <Library items={tiles} openId={openId} setOpenId={setOpenId} scroller={scroller} savedIds={saved} onSave={(t) => onSave(t.url)} />
          )}
          {searches.length > 0 && (
            <ul className="ytv-signals">
              {searches.map((r, i) => (
                <li key={r.id} style={{ ["--d" as string]: `${i * 40}ms` }}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="ytv-signal">
                    <span className="ytv-wave" aria-hidden>
                      {Array.from({ length: 7 }, (_, k) => (
                        <i key={k} style={{ ["--k" as string]: k }} />
                      ))}
                    </span>
                    <span className="ytv-signal-title">{r.title}</span>
                    {r.reason && <span className="ytv-signal-why">{r.reason}</span>}
                    <span className="ytv-signal-go">
                      Search on YouTube <Icon.ArrowRight width={12} height={12} aria-hidden />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {data.mode !== "youtube" && <ConnectYouTube embedded={embedded} />}
        </>
      )}
    </div>
  );
}

/** How to switch on real YouTube picks: every step a button to the exact page. */
function ConnectYouTube({ embedded }: { embedded: boolean }) {
  // Here the key is pasted in Jarvis, not in a box on this card.
  const steps = stepsFor("YOUTUBE_API_KEY").map((s) => (s.url ? s : { ...s, text: "Paste it in Jarvis › Connections (the button below) and press Save." }));
  const src = KEY_SOURCES.YOUTUBE_API_KEY;
  return (
    <section className="ytv-connect" aria-labelledby="ytv-connect-h">
      <div className="ytv-connect-head">
        <p className="ytv-kicker">
          <span className="ytv-live ytv-live--amber" aria-hidden /> Optional upgrade · {src.cost}
        </p>
        <h3 id="ytv-connect-h">Get real YouTube videos here</h3>
        <p>Right now these are searches. Connect a free YouTube key and For you fills with actual videos, thumbnails and all. About 3 minutes.</p>
      </div>
      <ol className="ytv-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="ytv-step-n">{i + 1}</span>
            <span className="ytv-step-text">{s.text}</span>
            {s.url && (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="ytv-btn ytv-btn--sm">
                {s.cta ?? "Open"} <Icon.Launch width={11} height={11} aria-hidden />
              </a>
            )}
          </li>
        ))}
      </ol>
      <div className="ytv-connect-foot">
        <a
          href="/apps/jarvis#connections/youtube"
          className="ytv-btn ytv-btn--go"
          onClick={(e) => {
            // Inside Jarvis, switch to Profile › Connections in place.
            if (embedded) {
              e.preventDefault();
              window.location.hash = "connections/youtube";
            }
          }}
        >
          Paste the key in Jarvis › Connections <Icon.ArrowRight width={13} height={13} aria-hidden />
        </a>
        <span>Your key is saved to your PC and copied for Vercel, never sent to the AI.</span>
      </div>
    </section>
  );
}
