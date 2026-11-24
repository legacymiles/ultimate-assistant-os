"use client";

import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft, Compass, FolderOpen, Library as LibraryIcon, ScanSearch, Shield, Sparkles, Wand2 } from "lucide-react";
import { InspireProvider, useInspire, type View } from "./store";
import { Explore } from "./Explore";
import { Builder } from "./Builder";
import { Reverse } from "./Reverse";
import { Library } from "./Library";
import { Collections } from "./Collections";
import { Moderation } from "./Moderation";
import { ImageDetail } from "./ImageDetail";
import { Modal } from "./ui";

const NAV: { view: View; label: string; short: string; icon: ReactNode }[] = [
  { view: "explore", label: "Explore", short: "Explore", icon: <Compass size={20} strokeWidth={1.7} /> },
  { view: "builder", label: "Prompt Builder", short: "Builder", icon: <Wand2 size={20} strokeWidth={1.7} /> },
  { view: "reverse", label: "Reverse Prompt", short: "Reverse", icon: <ScanSearch size={20} strokeWidth={1.7} /> },
  { view: "library", label: "My Library", short: "Library", icon: <LibraryIcon size={20} strokeWidth={1.7} /> },
  { view: "collections", label: "Collections", short: "Collections", icon: <FolderOpen size={20} strokeWidth={1.7} /> },
];

/** The mark: a strand of four glowing chips. */
function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {[
        [4, 6, 28],
        [8, 13, 300],
        [5, 20, 85],
        [10, 27, 190],
      ].map(([x, y, h], i) => (
        <rect key={i} x={x} y={y - 2.2} width={24 - x} height={4.4} rx={2.2} fill={`oklch(0.78 0.15 ${h})`} style={{ filter: `drop-shadow(0 0 3px oklch(0.78 0.16 ${h}))` }} />
      ))}
    </svg>
  );
}

function NavItems({ phone }: { phone?: boolean }) {
  const { view, go, me } = useInspire();
  // The phone tab bar holds five; Moderation sits in the phone top bar instead.
  const items = me?.owner && !phone ? [...NAV, { view: "moderation" as View, label: "Moderation", short: "Moderate", icon: <Shield size={20} strokeWidth={1.7} /> }] : NAV;
  return (
    <>
      {items.map((n) => (
        <a
          key={n.view}
          href={n.view === "explore" ? "?" : `?view=${n.view}`}
          className="insp-rail-item"
          aria-current={view === n.view ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            go(n.view);
          }}
          title={n.label}
        >
          {n.icon}
          <span>{n.short}</span>
        </a>
      ))}
    </>
  );
}

function Account() {
  const { me } = useInspire();
  if (!me) return <div className="insp-skel" style={{ width: 36, height: 36, borderRadius: 999 }} />;
  if (!me.signedIn) {
    return (
      <a className="insp-btn insp-btn-sm" href={`/login?next=${encodeURIComponent("/apps/image-studio/inspire")}`}>
        Sign in
      </a>
    );
  }
  const left = me.plan.aiPerDay === null ? null : Math.max(0, me.plan.aiPerDay - me.plan.aiUsedToday);
  return (
    <span className="insp-faint insp-mono" style={{ fontSize: 10.5, textAlign: "center", lineHeight: 1.3 }} title={me.local ? "Local mode — saved on this computer" : (me.email ?? "")}>
      {me.plan.label.toUpperCase()}
      <br />
      {left === null ? "∞ AI" : `${left} AI left`}
    </span>
  );
}

function SignInPrompt() {
  const { signInPrompt, closeSignIn } = useInspire();
  return (
    <Modal open={!!signInPrompt} onClose={closeSignIn} label="Sign in">
      <div style={{ padding: 28, display: "grid", gap: 14 }}>
        <Mark size={34} />
        <div className="insp-h2">Sign in to {signInPrompt}</div>
        <p className="insp-muted" style={{ margin: 0 }}>
          Your library is private to you: saved images, prompts, chips, references and collections. Browsing stays open to everyone. Free — no card, no plan to pick.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="insp-btn insp-btn-primary insp-btn-lg" href={`/login?next=${encodeURIComponent(typeof window === "undefined" ? "/apps/image-studio/inspire" : window.location.pathname + window.location.search)}`}>
            Continue with Google
          </a>
          <button type="button" className="insp-btn insp-btn-lg insp-btn-quiet" onClick={closeSignIn}>
            Keep browsing
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useInspire();
  return (
    <div className="insp-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="insp-toast" data-tone={t.tone}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Screen() {
  const { view, me } = useInspire();
  switch (view) {
    case "builder":
      return <Builder />;
    case "reverse":
      return <Reverse />;
    case "library":
      return <Library />;
    case "collections":
      return <Collections />;
    case "moderation":
      return me?.owner ? <Moderation /> : <Explore />;
    default:
      return <Explore />;
  }
}

function Shell() {
  const { me, go } = useInspire();
  return (
    <div className="insp">
      <div className="insp-shell">
        <nav className="insp-rail" aria-label="Inspire">
          <button type="button" className="insp-rail-logo" onClick={() => go("explore")} aria-label="Inspire home">
            <Mark />
          </button>
          <NavItems />
          <div style={{ flex: 1 }} />
          {me?.owner && (
            <Link href="/apps/image-studio" className="insp-rail-item" title="Image Studio agents">
              <Sparkles size={18} strokeWidth={1.7} />
              <span>Agents</span>
            </Link>
          )}
          <Link href="/" className="insp-rail-item" title="Back to the hub">
            <ArrowLeft size={18} strokeWidth={1.7} />
            <span>Hub</span>
          </Link>
          <div style={{ marginTop: 10 }}>
            <Account />
          </div>
        </nav>
        <main className="insp-main">
          <div className="insp-topbar">
            <Mark size={22} />
            <span className="insp-display" style={{ fontSize: 17 }}>
              Inspire
            </span>
            <span style={{ flex: 1 }} />
            {me?.owner && (
              <>
                <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" onClick={() => go("moderation")} aria-label="Moderation">
                  <Shield size={15} />
                </button>
                <Link href="/apps/image-studio" className="insp-btn insp-btn-sm insp-btn-quiet">
                  <Sparkles size={14} /> Agents
                </Link>
              </>
            )}
            <Account />
          </div>
          <Screen />
          <footer className="insp-faint" style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "48px 0 8px", fontSize: 12 }}>
            <span>Image Studio · Inspire</span>
            <span>{me?.local ? "Local mode — everything is saved on this computer." : "Free plan — no prices, no paywalls."}</span>
            <span style={{ flex: 1 }} />
            <a href="/legal/terms" className="insp-faint">
              Terms
            </a>
            <a href="/legal/privacy" className="insp-faint">
              Privacy
            </a>
          </footer>
        </main>
      </div>
      <nav className="insp-tabbar" aria-label="Inspire">
        <NavItems phone />
      </nav>
      <ImageDetail />
      <SignInPrompt />
      <Toasts />
    </div>
  );
}

export function InspireApp() {
  return (
    <Suspense fallback={<div className="insp" />}>
      <InspireProvider>
        <Shell />
      </InspireProvider>
    </Suspense>
  );
}
