"use client";

// ---------------------------------------------------------------------------
// The workspace shell — one layout for every kind of website.
//
// A full-screen canvas with the AI beside it on the LEFT, and the panel folds
// away so the canvas is the whole screen. That is the whole idea: the thing
// being built is the page, and the conversation about it lives next to it
// rather than floating on top of it in a popup, which is what the three apps
// did before and why editing always felt like talking over your own work.
//
// The shell owns the layout, the fold, the device width and the address bar.
// What goes in the panel, and what goes on the canvas, is the caller's — a
// client website, a hub app and a build that has not shipped yet are three
// very different things to look at and the same thing to talk to.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type StageDevice = "desktop" | "phone";

export interface WorkTab {
  id: string;
  label: string;
  /** A number on the tab: edits waiting, changed files. */
  count?: number;
  /** Drawn with a live pip (a build is running in there). */
  live?: boolean;
}

interface Props {
  title: string;
  subtitle?: string;
  /** The address on screen, when there is one. */
  url?: string;
  /** Home. */
  onBack: () => void;
  tabs: WorkTab[];
  tab: string;
  onTab: (id: string) => void;
  /** The panel's body for the open tab. */
  panel: ReactNode;
  /** Pinned under the panel body — a composer, an approve bar. */
  panelFoot?: ReactNode;
  /** What fills the canvas. Given the device so it can draw itself to width. */
  stage: (device: StageDevice) => ReactNode;
  /** Right of the address: a model picker, a Send button. */
  actions?: ReactNode;
  /** Shown as a strip over the top of the canvas. */
  banner?: ReactNode;
}

const FOLD_KEY = "ws-panel-shut";

export function WorkShell({ title, subtitle, url, onBack, tabs, tab, onTab, panel, panelFoot, stage, actions, banner }: Props) {
  const [shut, setShut] = useState(false);
  const [device, setDevice] = useState<StageDevice>("desktop");
  const [bump, setBump] = useState(0);
  const first = useRef(true);

  // The fold is a per-device habit, not something to sync: a phone wants the
  // panel shut by default and a laptop wants it open.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FOLD_KEY);
      setShut(saved === null ? window.innerWidth < 860 : saved === "1");
    } catch {
      setShut(window.innerWidth < 860);
    }
    first.current = false;
  }, []);

  const fold = useCallback((next: boolean) => {
    setShut(next);
    try {
      window.localStorage.setItem(FOLD_KEY, next ? "1" : "0");
    } catch {
      /* a remembered preference is a nicety, never a requirement */
    }
  }, []);

  // ⌘/Ctrl+\ folds the panel — the one shortcut, because maximising the page
  // you are judging is the thing you do most in here.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        fold(!shut);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shut, fold]);

  return (
    <div className={`ws-work${shut ? " shut" : ""}`} data-device={device}>
      <aside className="ws-panel" aria-label="Studio assistant" aria-hidden={shut}>
        <header className="ws-panel-head">
          <button type="button" className="ws-back" onClick={onBack} title="All websites">
            <BackIcon />
          </button>
          <span className="ws-panel-name">
            <b title={title}>{title}</b>
            {subtitle && <i>{subtitle}</i>}
          </span>
          <button type="button" className="ws-fold" onClick={() => fold(true)} title="Hide the panel (Ctrl+\)" aria-label="Hide the panel">
            <FoldIcon />
          </button>
        </header>

        <nav className="ws-panel-tabs" role="tablist" aria-label="Panel">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => onTab(t.id)}>
              {t.label}
              {t.live && <span className="ws-pip" aria-label="working" />}
              {!t.live && t.count ? <em>{t.count}</em> : null}
            </button>
          ))}
        </nav>

        <div className="ws-panel-body" role="tabpanel">
          {panel}
        </div>
        {panelFoot && <div className="ws-panel-foot">{panelFoot}</div>}
      </aside>

      {shut && (
        <button type="button" className="ws-unfold" onClick={() => fold(false)} title="Show the panel (Ctrl+\)">
          <FoldIcon flip />
          <span>Studio</span>
        </button>
      )}

      <main className="ws-stage">
        <div className="ws-stage-bar">
          <span className="ws-addr" title={url || "Nothing to show yet"}>
            {url ? <LockIcon secure={url.startsWith("https://")} /> : <DotIcon />}
            <span>{url || "No address yet"}</span>
          </span>
          <div className="ws-stage-tools">
            <div className="ws-devices" role="group" aria-label="Screen size">
              <button type="button" aria-pressed={device === "desktop"} className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")} title="Desktop">
                <DesktopIcon />
              </button>
              <button type="button" aria-pressed={device === "phone"} className={device === "phone" ? "on" : ""} onClick={() => setDevice("phone")} title="Phone (390px)">
                <PhoneIcon />
              </button>
            </div>
            <button type="button" className="ws-icon-btn" onClick={() => setBump((b) => b + 1)} title="Reload the preview" aria-label="Reload the preview">
              <RefreshIcon />
            </button>
            {url && (
              <a className="ws-icon-btn" href={url} target="_blank" rel="noopener noreferrer" title="Open in a new tab">
                <OutIcon />
              </a>
            )}
            {actions}
          </div>
        </div>
        {banner && <div className="ws-banner">{banner}</div>}
        <div className="ws-canvas" key={bump}>
          <div className={`ws-frame${device === "phone" ? " phone" : ""}`}>{stage(device)}</div>
        </div>
      </main>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}
function FoldIcon({ flip }: { flip?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M10 4v16" />
    </svg>
  );
}
function LockIcon({ secure }: { secure: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2.5" />
      <path d={secure ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 7.6-1.7"} />
    </svg>
  );
}
function DotIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
function DesktopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M9 21h6M12 17v4" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 11a8 8 0 1 0-.7 4.5" />
      <path d="M20 4.5V11h-6" />
    </svg>
  );
}
function OutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 4h6v6M20 4l-9 9M19 14v5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H10" />
    </svg>
  );
}
