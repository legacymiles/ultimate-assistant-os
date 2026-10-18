"use client";

// ---------------------------------------------------------------------------
// The client's screen: their website, with a line to Jarvis floating over it.
//
// Design (interactive-web-studio, restrained end of the dial — the client's
// site is the star, the console must never upstage it):
//   feeling   — calm confidence: "you're heard, and someone is on it"
//   signature — the Chat Intake is a living glass console with a slow aurora
//               edge. Drag it anywhere, shrink it to an orb, and "Point at it"
//               to drop a numbered pin on exactly the spot you mean.
//   surprise  — on Send, the requests fold into the orb and the screen turns
//               into Jarvis's reactor, with the steps it will take next.
// Reduced motion turns every animation into an instant state change.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, portal, urlBase64ToUint8Array } from "@/lib/client-review/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { SignInGate } from "./SignInGate";
import type { PortalRequest, PortalView, RequestPin, ReviewVersion } from "@/lib/client-review/types";
import "./client-review.css";

type Device = "desktop" | "phone";
type Snap = "peek" | "half" | "full";
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const POLL_MS = 30_000;
const LAYOUT_KEY = "cr-intake-layout";
const MIN_W = 320;
const MIN_H = 360;

const STATUS: Record<PortalRequest["status"], { label: string; tone: string }> = {
  draft: { label: "Not sent yet", tone: "draft" },
  sent: { label: "With Jarvis", tone: "sent" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Not this round", tone: "no" },
  done: { label: "Done", tone: "done" },
};

function readLayout(): { box?: Box; min?: boolean } {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    return raw ? (JSON.parse(raw) as { box?: Box; min?: boolean }) : {};
  } catch {
    return {};
  }
}
function writeLayout(v: { box: Box; min: boolean }) {
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(v));
  } catch {}
}

function clampBox(b: Box): Box {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(b.w, MIN_W), Math.max(MIN_W, vw - 24));
  const h = Math.min(Math.max(b.h, MIN_H), Math.max(MIN_H, vh - 24));
  return { w, h, x: Math.min(Math.max(b.x, 12), vw - w - 12), y: Math.min(Math.max(b.y, 12), vh - h - 12) };
}

function defaultBox(): Box {
  const w = Math.min(420, window.innerWidth - 32);
  const h = Math.min(620, window.innerHeight - 120);
  return clampBox({ w, h, x: window.innerWidth - w - 24, y: window.innerHeight - h - 24 });
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function isIos(): boolean {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function ClientPortal({
  token,
  embedded = false,
  onBack,
}: {
  token: string;
  /** Inside the Client Review page, under its tab bar, rather than the whole window. */
  embedded?: boolean;
  /** "← My websites", when there is a list to go back to. */
  onBack?: () => void;
}) {
  const [view, setView] = useState<PortalView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [gate, setGate] = useState<null | { kind: "signIn" } | { kind: "wrong"; message: string; email: string | null }>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [frameStuck, setFrameStuck] = useState(false);

  // The intake.
  const narrow = useNarrow();
  const [box, setBox] = useState<Box | null>(null);
  const [min, setMin] = useState(false);
  const [snap, setSnap] = useState<Snap>("half");
  const [text, setText] = useState("");
  const [pin, setPin] = useState<RequestPin | null>(null);
  const [pointing, setPointing] = useState(false);
  const [showPins, setShowPins] = useState(true);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  // Overlays.
  const [sent, setSent] = useState<{ count: number } | null>(null);
  const [folding, setFolding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const [notifyNote, setNotifyNote] = useState("");

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seenNotices = useRef<Set<string> | null>(null);

  // ----- data -----------------------------------------------------------------
  const apply = useCallback((v: PortalView) => {
    setView(v);
    setViewingId((cur) => (cur && v.versions.some((x) => x.id === cur && x.siteUrl) ? cur : v.currentVersionId));
  }, []);

  const refresh = useCallback(() => {
    portal
      .load(token)
      .then((v) => {
        apply(v);
        setLoadError("");
        setGate(null);
      })
      .catch((e: Error) => {
        if (e instanceof ApiError && e.flags.signIn) setGate({ kind: "signIn" });
        else if (e instanceof ApiError && e.flags.wrongAccount) setGate({ kind: "wrong", message: e.message, email: e.flags.viewerEmail });
        else setLoadError(e.message);
      });
  }, [token, apply]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && refresh();
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  // New notices: an in-page toast, and a pop-up when the client allowed one.
  useEffect(() => {
    if (!view) return;
    const unread = view.notices.filter((n) => !n.read);
    if (seenNotices.current === null) {
      seenNotices.current = new Set(view.notices.filter((n) => n.read).map((n) => n.id));
    }
    const fresh = unread.filter((n) => !seenNotices.current!.has(n.id));
    if (!fresh.length) return;
    for (const n of fresh) seenNotices.current.add(n.id);
    const last = fresh[fresh.length - 1];
    setToast({ title: last.title, body: last.body });
    if (view.settings.notify && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
      try {
        new Notification(last.title, { body: last.body, tag: `cr-${last.id}` });
      } catch {}
    }
  }, [view]);

  const act = useCallback(
    async (label: string, action: Record<string, unknown>) => {
      setBusy(label);
      setError("");
      try {
        const v = await portal.act(token, action);
        apply(v);
        return v;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy("");
      }
    },
    [token, apply],
  );

  // ----- layout ------------------------------------------------------------------
  useEffect(() => {
    const saved = readLayout();
    setBox(saved.box ? clampBox(saved.box) : defaultBox());
    setMin(Boolean(saved.min));
    const onResize = () => setBox((b) => (b ? clampBox(b) : b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (box) writeLayout({ box, min });
  }, [box, min]);

  const dragFrom = useRef<{ px: number; py: number; box: Box; mode: "move" | "size" | "orb"; moved: boolean } | null>(null);
  const startDrag = (mode: "move" | "size" | "orb") => (e: React.PointerEvent) => {
    if (!box || narrow) return;
    if ((e.target as HTMLElement).closest("button, textarea, input, select, a") && mode === "move") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragFrom.current = { px: e.clientX, py: e.clientY, box, mode, moved: false };
  };
  const onDrag = (e: React.PointerEvent) => {
    const d = dragFrom.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.mode === "size") setBox(clampBox({ ...d.box, w: d.box.w + dx, h: d.box.h + dy }));
    else setBox(clampBox({ ...d.box, x: d.box.x + dx, y: d.box.y + dy }));
  };
  const endDrag = () => {
    const d = dragFrom.current;
    dragFrom.current = null;
    if (d?.mode === "orb" && !d.moved) setMin(false);
  };

  // The mobile sheet: drag the handle, snap to the nearest stop.
  const sheetDrag = useRef<{ y: number; start: number } | null>(null);
  const [sheetH, setSheetH] = useState<number | null>(null);
  const snapHeight = (s: Snap) => (s === "peek" ? 84 : s === "half" ? Math.round(window.innerHeight * 0.55) : Math.round(window.innerHeight * 0.9));
  const sheetDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sheetDrag.current = { y: e.clientY, start: snapHeight(snap) };
  };
  const sheetMove = (e: React.PointerEvent) => {
    const d = sheetDrag.current;
    if (!d) return;
    setSheetH(Math.min(window.innerHeight * 0.92, Math.max(70, d.start - (e.clientY - d.y))));
  };
  const sheetUp = (e: React.PointerEvent) => {
    const d = sheetDrag.current;
    sheetDrag.current = null;
    if (!d) return;
    const h = sheetH ?? d.start;
    setSheetH(null);
    if (Math.abs(e.clientY - d.y) < 6) {
      setSnap((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"));
      return;
    }
    const stops: Snap[] = ["peek", "half", "full"];
    setSnap(stops.reduce((best, s) => (Math.abs(snapHeight(s) - h) < Math.abs(snapHeight(best) - h) ? s : best), "half"));
  };

  // ----- derived -------------------------------------------------------------------
  const versions = view?.versions ?? [];
  const viewing: ReviewVersion | null = versions.find((v) => v.id === viewingId) ?? null;
  const current = versions.find((v) => v.id === view?.currentVersionId) ?? null;
  const building = versions.find((v) => v.id === view?.buildingVersionId) ?? null;
  const writable = Boolean(viewing && viewing.status === "review" && viewing.id === current?.id);
  const requests = useMemo(
    () => (view?.requests ?? []).filter((r) => r.versionId === viewingId),
    [view?.requests, viewingId],
  );
  const drafts = requests.filter((r) => r.status === "draft");
  const pinned = requests.filter((r) => r.pin);

  useEffect(() => setFrameStuck(false), [viewing?.siteUrl]);
  useEffect(() => {
    if (!viewing?.siteUrl) return;
    // A site that refuses to be framed shows a blank box with no error the page
    // can read. If nothing has loaded after a while, say how to open it instead.
    const t = window.setTimeout(() => setFrameStuck(true), 9000);
    const el = frameRef.current?.querySelector("iframe");
    const loaded = () => window.clearTimeout(t);
    el?.addEventListener("load", loaded);
    return () => {
      window.clearTimeout(t);
      el?.removeEventListener("load", loaded);
    };
  }, [viewing?.siteUrl, device]);

  // ----- actions -------------------------------------------------------------------
  const pointAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setPin({ x, y, viewport: Math.round(r.width) });
    setPointing(false);
    setMin(false);
    if (narrow && snap === "peek") setSnap("half");
    window.setTimeout(() => inputRef.current?.focus(), 50);
  };

  const add = async () => {
    if (!viewing || !text.trim()) return;
    const ok = await act("add", { action: "add", versionId: viewing.id, text, pin });
    if (ok) {
      setText("");
      setPin(null);
      inputRef.current?.focus();
    }
  };

  const send = async () => {
    if (!viewing || !drafts.length) return;
    const count = drafts.length;
    setFolding(true);
    const ok = await act("send", { action: "send", versionId: viewing.id });
    window.setTimeout(() => setFolding(false), 650);
    if (ok) window.setTimeout(() => setSent({ count }), prefersReducedMotion() ? 0 : 520);
  };

  const enableNotify = async () => {
    setNotifyNote("");
    if (typeof Notification === "undefined") {
      setNotifyNote("This browser can't show notifications. Keep this link — the status is always here.");
      return;
    }
    if (isIos() && !isStandalone()) {
      setNotifyNote(
        "On iPhone: tap the Share button, choose “Add to Home Screen”, open Jarvis Review from your Home Screen, then turn this on there.",
      );
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setNotifyNote("Notifications are blocked for this site in your browser settings. Allow them there, then try again.");
      return;
    }
    const key = view?.vapidPublicKey;
    if (key && "serviceWorker" in navigator && "PushManager" in window) {
      try {
        const reg = await navigator.serviceWorker.register("/client-review-sw.js", { scope: "/apps/client-review" });
        await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
        const v = await act("notify", { action: "subscribe", subscription: sub.toJSON() });
        if (v) setNotifyNote("You're set — Jarvis will notify this device when your website is updated.");
        return;
      } catch {
        // Fall through to in-page notices; still worth turning on.
      }
    }
    const v = await act("notify", { action: "notify", on: true });
    if (v) setNotifyNote("You'll get a pop-up while this page is open. Keep the tab around, or check back any time.");
  };

  const disableNotify = async () => {
    setNotifyNote("");
    try {
      const reg = await navigator.serviceWorker?.getRegistration("/apps/client-review");
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
    } catch {}
    await act("notify", { action: "notify", on: false });
  };

  // ----- render --------------------------------------------------------------------
  if (gate?.kind === "signIn") {
    return (
      <SignInGate
        embedded={embedded}
        title="Your website is ready to review"
        body="Sign in with your Jarvis account to see it and send your edit requests."
        next={`/apps/client-review?site=${token}`}
      />
    );
  }
  if (gate?.kind === "wrong") {
    return (
      <SignInGate
        embedded={embedded}
        title="This is someone else's link"
        body={`${gate.message}${gate.email ? ` You're signed in as ${gate.email}.` : ""}`}
        next={`/apps/client-review?site=${token}`}
        switchAccount
      />
    );
  }
  if (loadError && !view) {
    return (
      <div className={`cr-root cr-center ${embedded ? "is-embedded" : ""}`}>
        <div className="cr-empty">
          <Orb small />
          <h1>This link isn&apos;t active</h1>
          <p>{loadError}</p>
          <button className="cr-btn" onClick={refresh}>Try again</button>
        </div>
      </div>
    );
  }
  if (!view || !box) {
    return (
      <div className={`cr-root cr-center ${embedded ? "is-embedded" : ""}`}>
        <Orb pulse />
      </div>
    );
  }

  const intakeStyle: React.CSSProperties = narrow
    ? { height: sheetH ?? snapHeight(snap) }
    : { left: box.x, top: box.y, width: box.w, height: box.h };

  const statusLine = building
    ? `Jarvis is building ${building.number}`
    : view.pending
      ? "Your requests are with Jarvis"
      : writable
        ? `Reviewing ${viewing?.number}`
        : viewing
          ? `Viewing ${viewing.number} (older version)`
          : "Waiting for your first version";

  return (
    <div className={`cr-root ${embedded ? "is-embedded" : ""} ${pointing ? "is-pointing" : ""}`}>
      {/* ---------- top bar ---------- */}
      <header className="cr-top">
        <div className="cr-brand">
          {onBack ? (
            <button className="cr-icon-btn ghost" onClick={onBack} aria-label="My websites" title="My websites">
              ←
            </button>
          ) : (
            <Orb small />
          )}
          <div>
            <p className="cr-kicker">{view.clientName ? `For ${view.clientName}` : "Website review"}</p>
            <h1>{view.name}</h1>
          </div>
        </div>
        <div className="cr-top-actions">
          {versions.filter((v) => v.siteUrl).length > 1 && (
            <label className="cr-select">
              <span className="sr-only">Version</span>
              <select value={viewingId ?? ""} onChange={(e) => setViewingId(e.target.value)}>
                {versions
                  .filter((v) => v.siteUrl)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.number}
                      {v.id === current?.id ? " · latest" : ""}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <div className="cr-seg" role="group" aria-label="Preview size">
            <button aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</button>
            <button aria-pressed={device === "phone"} onClick={() => setDevice("phone")}>Phone</button>
          </div>
          {viewing?.siteUrl && (
            <a className="cr-icon-btn" href={viewing.siteUrl} target="_blank" rel="noreferrer" title="Open the site in a new tab">
              ↗
            </a>
          )}
          <button className="cr-icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      {/* ---------- the site ---------- */}
      <main className="cr-stage" ref={stageRef}>
        {viewing?.siteUrl ? (
          <div className={`cr-frame ${device}`} ref={frameRef}>
            <iframe
              key={`${viewing.siteUrl}-${device}`}
              src={viewing.siteUrl}
              title={`${view.name} ${viewing.number}`}
              referrerPolicy="no-referrer"
              allow="clipboard-write; fullscreen"
            />
            {showPins &&
              pinned.map((r) => (
                <span
                  key={r.id}
                  className={`cr-pin tone-${STATUS[r.status].tone}`}
                  style={{ left: `${r.pin!.x * 100}%`, top: `${r.pin!.y * 100}%` }}
                  title={r.text}
                >
                  <i>{requests.indexOf(r) + 1}</i>
                </span>
              ))}
            {pin && <span className="cr-pin is-new" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}><i>+</i></span>}
            {pointing && (
              <div className="cr-point-layer" onClick={pointAt} role="button" aria-label="Click where you want the change">
                <p>Click the spot you mean · <kbd>Esc</kbd> to cancel</p>
              </div>
            )}
            {frameStuck && (
              <div className="cr-frame-hint">
                Site not showing here?{" "}
                <a href={viewing.siteUrl} target="_blank" rel="noreferrer">Open it in a new tab</a> and keep this page for your requests.
              </div>
            )}
          </div>
        ) : (
          <div className="cr-empty">
            <Orb pulse />
            <h2>{building ? `Jarvis is building ${building.number}` : "Your website is on its way"}</h2>
            <p>You&apos;ll see it right here as soon as it&apos;s ready{view.settings.notify ? " — and we'll notify you." : "."}</p>
            {!view.settings.notify && <button className="cr-btn" onClick={enableNotify}>Notify me when it&apos;s ready</button>}
          </div>
        )}
      </main>

      {/* ---------- Chat Intake ---------- */}
      {narrow || !min ? (
        <section
          className={`cr-intake ${narrow ? `is-sheet snap-${snap}` : ""} ${folding ? "is-folding" : ""}`}
          style={intakeStyle}
          aria-label="Chat intake"
          onPointerMove={narrow ? undefined : onDrag}
          onPointerUp={narrow ? undefined : endDrag}
        >
          <div className="cr-aura" aria-hidden />
          {narrow ? (
            <div className="cr-handle" onPointerDown={sheetDown} onPointerMove={sheetMove} onPointerUp={sheetUp}>
              <span />
            </div>
          ) : null}
          <div className="cr-intake-head" onPointerDown={startDrag("move")}>
            <Orb small pulse={Boolean(view.pending || building)} />
            <div className="cr-intake-title">
              <h2>Chat intake</h2>
              <p>{statusLine}</p>
            </div>
            {!narrow && (
              <button className="cr-icon-btn ghost" onClick={() => setMin(true)} aria-label="Shrink to orb" title="Shrink">
                –
              </button>
            )}
          </div>

          <ol className="cr-list" aria-label={`Edit requests for ${viewing?.number ?? "this version"}`}>
            {!requests.length && (
              <li className="cr-list-empty">
                <p>
                  {writable
                    ? "Tell Jarvis what you'd like changed — one thing per request. Add as many as you want, then send them all at once."
                    : building
                      ? `Your approved changes are being built into ${building.number}. You'll be able to request more edits on it.`
                      : "No requests on this version."}
                </p>
              </li>
            )}
            {requests.map((r, i) => (
              <li key={r.id} className={`cr-req tone-${STATUS[r.status].tone}`}>
                <span className="cr-req-n">{i + 1}</span>
                <div className="cr-req-body">
                  {editing?.id === r.id ? (
                    <div className="cr-req-edit">
                      <textarea
                        value={editing.text}
                        onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                        rows={3}
                        autoFocus
                      />
                      <div className="cr-row">
                        <button
                          className="cr-btn small"
                          disabled={!editing.text.trim() || busy === "edit"}
                          onClick={async () => {
                            if (await act("edit", { action: "edit", id: r.id, text: editing.text })) setEditing(null);
                          }}
                        >
                          Save
                        </button>
                        <button className="cr-btn small ghost" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p className="cr-req-text">{r.text}</p>
                  )}
                  {r.adminText && r.status !== "draft" && (
                    <p className="cr-req-admin">
                      <b>Jarvis will make it:</b> {r.adminText}
                    </p>
                  )}
                  {r.adminNote && <p className="cr-req-note">{r.adminNote}</p>}
                  <div className="cr-req-meta">
                    <span className={`cr-chip tone-${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
                    {r.pin && <span className="cr-chip">📍 pinned</span>}
                    {r.status === "draft" && editing?.id !== r.id && (
                      <>
                        <button className="cr-link" onClick={() => setEditing({ id: r.id, text: r.text })}>Edit</button>
                        <button className="cr-link" disabled={busy === "delete"} onClick={() => act("delete", { action: "delete", id: r.id })}>
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {error && <p className="cr-error" role="alert">{error}</p>}

          {writable ? (
            <div className="cr-compose">
              {pin && (
                <div className="cr-pinned">
                  📍 Pinned to the spot you clicked
                  <button className="cr-link" onClick={() => setPin(null)}>Remove pin</button>
                </div>
              )}
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void add();
                  }
                }}
                placeholder="e.g. Make the headline bigger and change “Book now” to “Reserve your spot”"
                rows={2}
                maxLength={2000}
                aria-label="New edit request"
              />
              <div className="cr-row">
                <button
                  className={`cr-btn ghost small ${pointing ? "is-on" : ""}`}
                  onClick={() => setPointing((p) => !p)}
                  disabled={!viewing?.siteUrl}
                  title="Click a spot on your site to attach it to this request"
                >
                  {pointing ? "Pointing…" : "📍 Point at it"}
                </button>
                {pinned.length > 0 && (
                  <button className="cr-btn ghost small" onClick={() => setShowPins((s) => !s)}>
                    {showPins ? "Hide pins" : "Show pins"}
                  </button>
                )}
                <button className="cr-btn small" onClick={add} disabled={!text.trim() || busy === "add"}>
                  {busy === "add" ? "Adding…" : "Add request"}
                </button>
              </div>
              <button className="cr-send" onClick={send} disabled={!drafts.length || busy === "send"}>
                <span className="cr-send-glow" aria-hidden />
                {busy === "send"
                  ? "Sending to Jarvis…"
                  : drafts.length
                    ? `Send ${drafts.length} request${drafts.length === 1 ? "" : "s"} to Jarvis`
                    : "Send to Jarvis"}
              </button>
            </div>
          ) : (
            <div className="cr-compose closed">
              {building ? (
                <p>
                  <b>{viewing?.number}</b> is closed while Jarvis builds <b>{building.number}</b>.{" "}
                  {view.settings.notify ? "We'll notify you when it's ready." : (
                    <button className="cr-link" onClick={enableNotify}>Notify me when it&apos;s ready</button>
                  )}
                </p>
              ) : viewing && current && viewing.id !== current.id ? (
                <p>
                  This is an older version.{" "}
                  <button className="cr-link" onClick={() => setViewingId(current.id)}>Go to {current.number}</button> to request edits.
                </p>
              ) : (
                <p>Requests open as soon as your first version is ready.</p>
              )}
            </div>
          )}

          {!narrow && <div className="cr-resize" onPointerDown={startDrag("size")} aria-hidden />}
        </section>
      ) : (
        <button
          className={`cr-orb-float ${drafts.length ? "has-badge" : ""}`}
          style={{ left: box.x + box.w - 76, top: box.y + box.h - 76 }}
          onPointerDown={startDrag("orb")}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setMin(false)}
          aria-label="Open chat intake"
        >
          <Orb pulse={Boolean(view.pending || building)} />
          {drafts.length > 0 && <span className="cr-badge">{drafts.length}</span>}
        </button>
      )}

      {/* ---------- after "Send to Jarvis" ---------- */}
      {sent && (
        <SentScreen
          count={sent.count}
          view={view}
          notifyNote={notifyNote}
          onEnable={enableNotify}
          onClose={() => setSent(null)}
          busy={busy === "notify"}
        />
      )}

      {/* ---------- Settings ---------- */}
      {settingsOpen && (
        <div className="cr-modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={() => setSettingsOpen(false)}>
          <div className="cr-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="cr-sheet-head">
              <h2>Settings</h2>
              <button className="cr-icon-btn ghost" onClick={() => setSettingsOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="cr-setting">
              <div>
                <h3>Notifications</h3>
                <p>Jarvis tells you when your edits are approved and when your new version is ready.</p>
              </div>
              <button
                className={`cr-toggle ${view.settings.notify ? "on" : ""}`}
                role="switch"
                aria-checked={view.settings.notify}
                disabled={busy === "notify"}
                onClick={() => (view.settings.notify ? disableNotify() : enableNotify())}
              >
                <span />
              </button>
            </div>
            {notifyNote && <p className="cr-note">{notifyNote}</p>}
            {isIos() && !isStandalone() && !notifyNote && (
              <p className="cr-note">
                On iPhone, notifications only work after you add this page to your Home Screen (Share → Add to Home Screen).
              </p>
            )}
            {view.viewerEmail && (
              <div className="cr-setting">
                <div>
                  <h3>Your Jarvis account</h3>
                  <p>
                    Signed in as {view.viewerEmail}. <a className="cr-link" href="/apps/client-review">All my websites</a>
                  </p>
                </div>
                <button
                  className="cr-btn small ghost"
                  onClick={async () => {
                    await getSupabaseBrowserClient()?.auth.signOut();
                    window.location.reload();
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
            <div className="cr-setting">
              <div>
                <h3>Reset the intake position</h3>
                <p>Put the Chat Intake back in the corner.</p>
              </div>
              <button className="cr-btn small ghost" onClick={() => { setBox(defaultBox()); setMin(false); }}>Reset</button>
            </div>
            {view.notices.length > 0 && (
              <>
                <h3 className="cr-sub">Updates</h3>
                <ul className="cr-notices">
                  {[...view.notices].reverse().map((n) => (
                    <li key={n.id}>
                      <b>{n.title}</b>
                      <span>{n.body}</span>
                      <time>{new Date(n.at).toLocaleString()}</time>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- toast ---------- */}
      {toast && (
        <div className="cr-toast" role="status">
          <Orb small />
          <div>
            <b>{toast.title}</b>
            <p>{toast.body}</p>
          </div>
          <button
            className="cr-icon-btn ghost"
            aria-label="Dismiss"
            onClick={() => {
              setToast(null);
              void portal.act(token, { action: "seen" }).then(apply).catch(() => {});
            }}
          >
            ×
          </button>
        </div>
      )}

      <EscapeToCancel active={pointing} onEscape={() => setPointing(false)} />
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function EscapeToCancel({ active, onEscape }: { active: boolean; onEscape: () => void }) {
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && onEscape();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [active, onEscape]);
  return null;
}

/** Jarvis, as a small living orb. */
function Orb({ small = false, pulse = false }: { small?: boolean; pulse?: boolean }) {
  return (
    <span className={`cr-orb ${small ? "small" : ""} ${pulse ? "pulse" : ""}`} aria-hidden>
      <span className="cr-orb-core" />
      <span className="cr-orb-ring" />
    </span>
  );
}

function SentScreen({
  count,
  view,
  notifyNote,
  onEnable,
  onClose,
  busy,
}: {
  count: number;
  view: PortalView;
  notifyNote: string;
  onEnable: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const current = view.versions.find((v) => v.id === view.currentVersionId);
  const next = current ? `v${(Number(/\d+/.exec(current.number)?.[0] ?? 1) || 1) + 1}` : "your next version";
  const steps = [
    { label: "Sent to Jarvis", done: true },
    { label: "Reviewed & approved", done: false },
    { label: `Building ${next}`, done: false },
    { label: `${next} ready for you`, done: false },
  ];
  return (
    <div className="cr-sent" role="dialog" aria-modal="true" aria-label="Sent to Jarvis">
      <div className="cr-reactor" aria-hidden>
        <span className="r1" />
        <span className="r2" />
        <span className="r3" />
        <span className="core" />
      </div>
      <div className="cr-sent-copy">
        <p className="cr-kicker">Received</p>
        <h2>
          Jarvis has your {count} request{count === 1 ? "" : "s"}.
        </h2>
        <p>
          They&apos;re being reviewed now. Once they&apos;re approved, Jarvis builds {next} and{" "}
          {view.settings.notify ? "will notify you the moment it's ready." : "can notify you the moment it's ready."}
        </p>
        <ol className="cr-steps">
          {steps.map((s, i) => (
            <li key={s.label} className={s.done ? "done" : i === 1 ? "now" : ""} style={{ animationDelay: `${0.25 + i * 0.12}s` }}>
              <span />
              {s.label}
            </li>
          ))}
        </ol>
        <div className="cr-sent-actions">
          {view.settings.notify ? (
            <p className="cr-on">✓ Notifications are on</p>
          ) : (
            <button className="cr-send" onClick={onEnable} disabled={busy}>
              <span className="cr-send-glow" aria-hidden />
              {busy ? "Turning on…" : "Notify me when it's done"}
            </button>
          )}
          <button className="cr-btn ghost" onClick={onClose}>Back to my site</button>
        </div>
        {notifyNote && <p className="cr-note">{notifyNote}</p>}
      </div>
    </div>
  );
}
