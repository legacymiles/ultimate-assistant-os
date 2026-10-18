"use client";

// ---------------------------------------------------------------------------
// Client Review — one page for clients and the owner.
//
//   Client  every website this account has opened; pick one to see it with
//           the Chat Intake on top. (For the owner: every project, to preview
//           exactly what the client sees.)
//   Admin   the owner's console. Locked and faded for everyone else — they
//           can see it exists but can't open it. The page decides what to
//           SHOW from /api/client-review/portal/me; the admin API itself is
//           owner-only in middleware, so forcing the tab open gets nothing.
//
// The URL carries the state (?site=<code>, ?tab=admin) so a client link,
// a push notification and the back button all land in the right place.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { admin } from "@/lib/client-review/client";
import type { ClientProject } from "@/lib/client-review/types";
import { ClientPortal } from "./ClientPortal";
import { ClientReviewAdmin } from "./ClientReviewAdmin";
import { MyWebsites } from "./MyWebsites";
import { SignInGate } from "./SignInGate";
import "./client-review.css";

type Tab = "client" | "admin";
interface Me {
  signedIn: boolean;
  owner: boolean;
  email: string | null;
}

function readUrl(): { site: string | null; tab: Tab | null } {
  const q = new URLSearchParams(window.location.search);
  const t = q.get("tab");
  return { site: q.get("site"), tab: t === "admin" || t === "client" ? t : null };
}

function writeUrl(next: { site: string | null; tab: Tab }, push = true) {
  const q = new URLSearchParams();
  if (next.tab === "admin") q.set("tab", "admin");
  else if (next.site) q.set("site", next.site);
  const url = `/apps/client-review${q.toString() ? `?${q}` : ""}`;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function ClientReviewApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState("");
  const [tab, setTab] = useState<Tab>("client");
  const [site, setSite] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    fetch("/api/client-review/portal/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<Me>)
      .then((m) => {
        setMe(m);
        const url = readUrl();
        setSite(url.site);
        // The owner opening the app with no link lands in Admin; anyone else
        // (and the owner following a client link) lands in Client.
        const want: Tab = url.tab ?? (m.owner && !url.site ? "admin" : "client");
        setTab(want === "admin" && !m.owner ? "client" : want);
      })
      .catch(() => setMeError("Couldn't reach the server — check your connection and refresh."));
  }, []);

  useEffect(() => {
    const onPop = () => {
      const url = readUrl();
      setSite(url.site);
      setTab(url.tab === "admin" && me?.owner ? "admin" : "client");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [me?.owner]);

  const go = useCallback(
    (next: { site?: string | null; tab?: Tab }) => {
      const t = next.tab ?? tab;
      if (t === "admin" && !me?.owner) {
        setDenied(true);
        window.setTimeout(() => setDenied(false), 2200);
        return;
      }
      const s = next.site === undefined ? site : next.site;
      setTab(t);
      setSite(s);
      writeUrl({ site: s, tab: t });
    },
    [tab, site, me?.owner],
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
        title={site ? "Your website is ready to review" : "Client Review"}
        body={
          site
            ? "Sign in with your Jarvis account to see it and send your edit requests."
            : "Sign in with your Jarvis account to see your websites."
        }
        next={next}
      />
    );
  }

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
        ) : site ? (
          <ClientPortal key={site} token={site} embedded onBack={() => go({ site: null, tab: "client" })} />
        ) : me.owner ? (
          <OwnerPreview onOpen={(t) => go({ site: t, tab: "client" })} />
        ) : (
          <MyWebsites embedded onOpen={(t) => go({ site: t, tab: "client" })} />
        )}
      </div>
    </div>
  );
}

/** The owner's Client tab: every project, opened exactly as its client sees it. */
function OwnerPreview({ onOpen }: { onOpen: (token: string) => void }) {
  const [projects, setProjects] = useState<ClientProject[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    admin
      .load()
      .then((s) => setProjects(s.projects.filter((p) => !p.archived)))
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div className="cr-root cr-center is-embedded">
      <div className="cr-empty">
        <p className="cr-kicker">Client view</p>
        <h1>See it the way your client does</h1>
        <p>Pick a project to open it with the Chat Intake, exactly as the client gets it.</p>
        {error && <p className="cr-error">{error}</p>}
        {projects && !projects.length && <p>No client projects yet — make one in Admin.</p>}
        {projects && projects.length > 0 && (
          <ul className="cr-sites">
            {projects.map((p) => (
              <li key={p.id}>
                <a
                  href={`/apps/client-review?site=${p.token}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen(p.token);
                  }}
                >
                  <span>
                    <b>{p.name}</b>
                    <small>{p.clientName || "No client name"}{p.clientUserEmail ? ` · ${p.clientUserEmail}` : " · not opened yet"}</small>
                  </span>
                  <span aria-hidden>→</span>
                </a>
              </li>
            ))}
          </ul>
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
