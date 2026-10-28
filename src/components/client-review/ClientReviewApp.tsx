"use client";

// ---------------------------------------------------------------------------
// Client Review — one page for clients and the owner.
//
//   Client  every website this account has opened; pick one to see it with
//           the Chat Intake on top. For the owner: a dropdown of EVERY app in
//           the hub and every client website, each opened exactly as a client
//           sees it, so the owner edits on the page too (?app=<slug>).
//   Admin   the owner's console. Locked and faded for everyone else — they
//           can see it exists but can't open it. The page decides what to
//           SHOW from /api/client-review/portal/me; the admin API itself is
//           owner-only in middleware, so forcing the tab open gets nothing.
//
// The URL carries the state (?site=<code>, ?app=<slug>, ?tab=admin) so a client link,
// a push notification and the back button all land in the right place.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { editableApp } from "@/lib/client-review/apps";
import { admin } from "@/lib/client-review/client";
import { ClientPortal } from "./ClientPortal";
import { ClientReviewAdmin } from "./ClientReviewAdmin";
import { MyWebsites } from "./MyWebsites";
import { SignInGate } from "./SignInGate";
import { SiteGallery } from "./SiteGallery";
import { SitePickerMenu, type Target } from "./SitePicker";
import "./client-review.css";

type Tab = "client" | "admin";
interface Me {
  signedIn: boolean;
  owner: boolean;
  email: string | null;
}

const LAST_KEY = "cr-last-target";

function readUrl(): { target: Target | null; tab: Tab | null } {
  const q = new URLSearchParams(window.location.search);
  const t = q.get("tab");
  const site = q.get("site");
  const app = q.get("app");
  return {
    target: site ? { kind: "site", token: site } : app ? { kind: "app", slug: app } : null,
    tab: t === "admin" || t === "client" ? t : null,
  };
}

function writeUrl(next: { target: Target | null; tab: Tab }, push = true) {
  const q = new URLSearchParams();
  if (next.tab === "admin") q.set("tab", "admin");
  else if (next.target?.kind === "site") q.set("site", next.target.token);
  else if (next.target?.kind === "app") q.set("app", next.target.slug);
  const url = `/apps/client-review${q.toString() ? `?${q}` : ""}`;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/** The owner's last opened app or website, so the Client view reopens where they left off. */
function readLast(): Target | null {
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    const t = raw ? (JSON.parse(raw) as Target) : null;
    if (t?.kind === "site" && typeof t.token === "string") return t;
    if (t?.kind === "app" && editableApp(t.slug)) return t;
  } catch {}
  return null;
}
function writeLast(t: Target | null) {
  try {
    if (t) window.localStorage.setItem(LAST_KEY, JSON.stringify(t));
    else window.localStorage.removeItem(LAST_KEY);
  } catch {}
}

export function ClientReviewApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState("");
  const [tab, setTab] = useState<Tab>("client");
  const [target, setTarget] = useState<Target | null>(null);
  const [denied, setDenied] = useState(false);
  // An app's review link, once its project exists (made on first open).
  const [appTokens, setAppTokens] = useState<Record<string, string>>({});
  const [appError, setAppError] = useState("");
  // Opening a card from the gallery: its live preview grows into the stage
  // while the Client view loads underneath; the gallery fades once both are done.
  const [morph, setMorph] = useState<null | { phase: "opening" | "leaving"; expanded: boolean; loaded: boolean }>(null);

  useEffect(() => {
    if (!morph || morph.phase !== "opening" || !morph.expanded) return;
    const done = morph.loaded || appError;
    const t = window.setTimeout(() => setMorph((m) => (m ? { ...m, phase: "leaving" } : m)), done ? 250 : 12_000);
    return () => window.clearTimeout(t);
  }, [morph, appError]);
  useEffect(() => {
    if (morph?.phase !== "leaving") return;
    const t = window.setTimeout(() => setMorph(null), 420);
    return () => window.clearTimeout(t);
  }, [morph?.phase]);

  useEffect(() => {
    fetch("/api/client-review/portal/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<Me>)
      .then((m) => {
        setMe(m);
        const url = readUrl();
        // The owner with no link reopens what they had open last (or the
        // picker); a client, or anyone following a link, lands in Client.
        const target = url.target ?? (m.owner && !url.tab ? readLast() : null);
        setTarget(target);
        if (target && !url.target) writeUrl({ target, tab: "client" }, false);
        const want: Tab = url.tab ?? "client";
        setTab(want === "admin" && !m.owner ? "client" : want);
      })
      .catch(() => setMeError("Couldn't reach the server — check your connection and refresh."));
  }, []);

  useEffect(() => {
    const onPop = () => {
      setMorph(null);
      const url = readUrl();
      setTarget(url.target);
      setTab(url.tab === "admin" && me?.owner ? "admin" : "client");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [me?.owner]);

  // Opening one of the owner's apps: find (or make) its project.
  const appSlug = target?.kind === "app" ? target.slug : null;
  useEffect(() => {
    if (!appSlug || !me?.owner || appTokens[appSlug]) return;
    setAppError("");
    let live = true;
    admin
      .ensureApp(appSlug)
      .then(({ project }) => live && setAppTokens((m) => ({ ...m, [appSlug]: project.token })))
      .catch((e: Error) => live && setAppError(e.message));
    return () => {
      live = false;
    };
  }, [appSlug, me?.owner, appTokens]);

  const go = useCallback(
    (next: { target?: Target | null; tab?: Tab }) => {
      const t = next.tab ?? tab;
      if (t === "admin" && !me?.owner) {
        setDenied(true);
        window.setTimeout(() => setDenied(false), 2200);
        return;
      }
      const g = next.target === undefined ? target : next.target;
      setTab(t);
      setTarget(g);
      if (me?.owner && next.target !== undefined) writeLast(g);
      writeUrl({ target: g, tab: t });
    },
    [tab, target, me?.owner],
  );

  if (meError) {
    return (
      <div className="cr-root cr-center">
        <div className="cr-empty">
          <h1>Client Review</h1>
          <p>{meError}</p>
        </div>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="cr-root cr-center">
        <span className="cr-orb pulse" aria-hidden>
          <span className="cr-orb-core" />
          <span className="cr-orb-ring" />
        </span>
      </div>
    );
  }
  if (!me.signedIn) {
    const next = typeof window === "undefined" ? "/apps/client-review" : `${window.location.pathname}${window.location.search}`;
    return (
      <SignInGate
        title={target ? "Your website is ready to review" : "Client Review"}
        body={
          target
            ? "Sign in with your Jarvis account to see it and send your edit requests."
            : "Sign in with your Jarvis account to see your websites."
        }
        next={next}
      />
    );
  }

  const token = target?.kind === "site" ? target.token : target?.kind === "app" ? appTokens[target.slug] : undefined;
  const label = target?.kind === "app" ? (editableApp(target.slug)?.title ?? target.slug) : "Pick an app or website";
  const picker = me.owner
    ? (name: string) => <SitePickerMenu current={target} label={name} onPick={(t) => go({ target: t, tab: "client" })} />
    : undefined;
  const toList = () => {
    setMorph(null);
    go({ target: null, tab: "client" });
  };
  const showGallery = me.owner && tab === "client" && (!target || Boolean(morph));

  return (
    <div className="cra-shell">
      <header className="cra-bar">
        <div className="cra-brand">
          <span className="cr-orb small" aria-hidden>
            <span className="cr-orb-core" />
            <span className="cr-orb-ring" />
          </span>
          <b>Client Review</b>
        </div>
        <nav className="cra-tabs" role="tablist" aria-label="Client Review">
          <button
            role="tab"
            aria-selected={tab === "client"}
            className={tab === "client" ? "on" : ""}
            onClick={() => go({ tab: "client" })}
          >
            {me.owner ? "Client view" : "My websites"}
          </button>
          <button
            role="tab"
            aria-selected={tab === "admin"}
            aria-disabled={!me.owner}
            disabled={!me.owner}
            className={`${tab === "admin" ? "on" : ""} ${me.owner ? "" : "locked"}`}
            onClick={() => go({ tab: "admin" })}
            title={me.owner ? "Admin" : "Admins only"}
          >
            <LockIcon open={me.owner} />
            Admin
          </button>
        </nav>
        <span className="cra-who" title={me.email ?? undefined}>
          {me.email ?? ""}
        </span>
        {denied && <span className="cra-denied" role="status">Admins only</span>}
      </header>

      <div className="cra-body">
        {tab === "admin" && me.owner ? (
          <ClientReviewAdmin fill />
        ) : (
          <>
            {target &&
              (token ? (
                <ClientPortal
                  key={token}
                  token={token}
                  embedded
                  picker={picker}
                  onBack={toList}
                  onFrameLoad={() => setMorph((m) => (m ? { ...m, loaded: true } : m))}
                />
              ) : target.kind === "app" ? (
                <div className="cr-root cr-center is-embedded">
                  <div className="cr-empty">
                    {appError ? (
                      <>
                        <h1>Couldn&apos;t open {label}</h1>
                        <p>{appError}</p>
                        <button className="cr-btn" onClick={toList}>Pick another</button>
                      </>
                    ) : (
                      <span className="cr-orb pulse" aria-hidden>
                        <span className="cr-orb-core" />
                        <span className="cr-orb-ring" />
                      </span>
                    )}
                  </div>
                </div>
              ) : null)}
            {!target && !me.owner && (
              <MyWebsites embedded onOpen={(t) => go({ target: { kind: "site", token: t }, tab: "client" })} />
            )}
            {showGallery && (
              <SiteGallery
                phase={morph?.phase ?? "idle"}
                onOpen={(t) => {
                  setMorph({ phase: "opening", expanded: false, loaded: false });
                  go({ target: t, tab: "client" });
                }}
                onExpanded={() => setMorph((m) => (m ? { ...m, expanded: true } : m))}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2.5" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7.6-1.7" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}
