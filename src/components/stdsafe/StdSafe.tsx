"use client";

// ---------------------------------------------------------------------------
// STD Safe — the shell.
//
// Holds the one dashboard object every mutation returns, so no component ever
// patches state by hand and the status card, the timeline and the inbox cannot
// disagree with each other.
//
// It also polls. The whole request flow assumes two people standing together —
// one of them taps "ask" and the other needs the prompt to appear without being
// told to refresh.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  answerRequest,
  askByCode,
  deleteRecord,
  loadDashboard,
  loadView,
  revokeGrant,
  rotateCode,
  saveRecord,
  signOut,
  type Dashboard,
  type ParseResponse,
  type SaveRecordInput,
  type SharedView,
} from "@/lib/stdsafe/client";
import { STANDING_CAVEATS, formatDay } from "@/lib/stdsafe/status";
import { AuthPanel } from "./AuthPanel";
import { AskPanel } from "./AskPanel";
import { DraftReview } from "./DraftReview";
import { RecordTimeline } from "./RecordTimeline";
import { RequestInbox } from "./RequestInbox";
import { StatusCard } from "./StatusCard";
import { UploadFlow } from "./UploadFlow";

type Tab = "status" | "records" | "requests";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "status", label: "Your card" },
  { id: "records", label: "Records" },
  { id: "requests", label: "Requests" },
];

/** How often to look for a request that arrived while you were standing there. */
const POLL_MS = 6000;

function CodeChip({ code, onRotate, busy }: { code: string; onRotate: () => void; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked in some contexts; the code is on screen anyway.
    }
  }

  return (
    <div className="rounded-xl border border-line bg-panel px-5 py-4">
      <p className="text-[11px] uppercase tracking-widest text-ink-faint">Your code</p>
      <div className="mt-1.5 flex items-center gap-3">
        <span className="font-mono text-3xl tracking-[0.25em] text-ink">{code}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:text-ink"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
        Read this out when someone asks. They enter it, you get a prompt.
      </p>

      {confirming ? (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
          <p className="text-[12px] text-amber-200">
            A new code cuts off everyone who can currently see your card. Continue?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onRotate();
                setConfirming(false);
              }}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[12px] text-amber-100 disabled:opacity-50"
            >
              New code
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-2 text-[12px] text-ink-faint hover:text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 text-[12px] text-ink-faint underline-offset-2 transition hover:text-ink-muted hover:underline"
        >
          Rotate code
        </button>
      )}
    </div>
  );
}

function ViewOverlay({ view, onClose }: { view: SharedView; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10 backdrop-blur-sm">
      <div className="w-full max-w-3xl animate-fade-in">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[13px] text-ink-muted">
            Shared with you · expires {new Date(view.grantExpiresAt).toLocaleString()}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12px] text-ink-muted transition hover:text-ink"
          >
            Close
          </button>
        </div>
        <StatusCard status={view.status} name={view.who.displayName || `@${view.who.handle}`} />
        {view.records.length > 0 && (
          <div className="mt-3 rounded-xl border border-line bg-panel px-5 py-4">
            <p className="text-[11px] uppercase tracking-widest text-ink-faint">Where this came from</p>
            <ul className="mt-2 space-y-1">
              {view.records.map((record, i) => (
                <li key={i} className="text-[12px] text-ink-muted">
                  {formatDay(record.collectedAt)} · {record.lab} · {record.panelName} ·{" "}
                  {record.verification === "document" ? "lab document on file" : "self-reported"}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-ink-faint">
              The report files themselves are never shared — they carry a legal name and date of birth.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function StdSafe() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("status");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ParseResponse | null>(null);
  const [view, setView] = useState<SharedView | null>(null);
  const [error, setError] = useState("");

  // Kept in a ref so the poll does not have to be torn down and rebuilt every
  // time the dashboard object changes.
  const signedIn = useRef(false);
  signedIn.current = Boolean(dashboard);

  useEffect(() => {
    loadDashboard()
      .then(setDashboard)
      .catch(() => setDashboard(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      // Skip while a form is mid-flight or a draft is open: replacing the
      // dashboard under an open review screen would be maddening.
      if (!signedIn.current || document.hidden) return;
      loadDashboard()
        .then(setDashboard)
        .catch(() => {
          // A failed poll is not worth an error banner; the next one may work.
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const run = useCallback(async (fn: () => Promise<Dashboard>) => {
    setBusy(true);
    setError("");
    try {
      setDashboard(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-[13px] text-ink-faint">Loading…</p>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="min-h-screen bg-canvas">
        <TopBar />
        <AuthPanel onSignedIn={setDashboard} />
      </main>
    );
  }

  const pendingCount = dashboard.inbox.incoming.filter((r) => r.status === "pending").length;

  async function save(input: SaveRecordInput) {
    await run(() => saveRecord(input));
    setDraft(null);
    setTab("status");
  }

  return (
    <main className="min-h-screen bg-canvas pb-24">
      <TopBar
        right={
          <div className="flex items-center gap-3">
            <span className="hidden text-[13px] text-ink-muted sm:inline">@{dashboard.me.handle}</span>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                setDashboard(null);
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-muted transition hover:text-ink"
            >
              Sign out
            </button>
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-6 py-8">
        {!dashboard.storage.persistent && (
          <p className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-[13px] text-amber-200">
            <span className="font-medium">Nothing here will be kept.</span> {dashboard.storage.reason}
          </p>
        )}

        {error && (
          <p className="mb-5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-200">
            {error}
          </p>
        )}

        {pendingCount > 0 && tab !== "requests" && (
          <button
            type="button"
            onClick={() => setTab("requests")}
            className="mb-5 flex w-full items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-left"
          >
            <span className="text-[13px] text-amber-200">
              {pendingCount === 1 ? "Someone is asking to see your card" : `${pendingCount} people are asking`}
            </span>
            <span className="text-[12px] text-amber-300">Answer →</span>
          </button>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="order-2 lg:order-1">
            <nav className="mb-5 flex gap-1 rounded-lg border border-line bg-panel p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                    tab === t.id ? "bg-elevated text-ink" : "text-ink-faint hover:text-ink-muted"
                  }`}
                >
                  {t.label}
                  {t.id === "requests" && pendingCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-[11px] text-amber-200">
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {tab === "status" && <StatusCard status={dashboard.status} />}

            {tab === "records" && (
              <div className="space-y-5">
                {draft ? (
                  <DraftReview
                    draft={draft.draft}
                    fileId={draft.fileId}
                    fileName={draft.fileName}
                    verification={draft.verification}
                    note={draft.note || draft.storageWarning}
                    busy={busy}
                    onSave={save}
                    onCancel={() => setDraft(null)}
                  />
                ) : (
                  <UploadFlow onDraft={setDraft} />
                )}
                {!draft && (
                  <RecordTimeline
                    records={dashboard.records}
                    busy={busy}
                    onDelete={(id) => void run(() => deleteRecord(id))}
                  />
                )}
              </div>
            )}

            {tab === "requests" && (
              <div className="space-y-6">
                <AskPanel
                  busy={busy}
                  onAsk={async (code) => {
                    setDashboard(await askByCode(code));
                  }}
                />
                <RequestInbox
                  incoming={dashboard.inbox.incoming}
                  outgoing={dashboard.inbox.outgoing}
                  myStatus={dashboard.status}
                  busy={busy}
                  onAnswer={(id, approve) => void run(() => answerRequest(id, approve))}
                  onRevoke={(id) => void run(() => revokeGrant(id))}
                  onView={async (id) => {
                    try {
                      setView((await loadView(id)).view);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "That view is not available.");
                    }
                  }}
                />
              </div>
            )}
          </div>

          <aside className="order-1 space-y-4 lg:order-2">
            <CodeChip
              code={dashboard.me.code}
              busy={busy}
              onRotate={() => void run(() => rotateCode())}
            />

            <div className="rounded-xl border border-line bg-panel px-5 py-4">
              <p className="text-[11px] uppercase tracking-widest text-ink-faint">Always true</p>
              <ul className="mt-2 space-y-2">
                {STANDING_CAVEATS.map((caveat) => (
                  <li key={caveat} className="text-[12px] leading-relaxed text-ink-muted">
                    {caveat}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {view && <ViewOverlay view={view} onClose={() => setView(null)} />}
    </main>
  );
}

function TopBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[12px] text-ink-faint transition hover:text-ink-muted">
            ← Hub
          </Link>
          <span className="h-4 w-px bg-line" aria-hidden />
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
            <span className="text-[14px] font-semibold tracking-tight text-ink">STD Safe</span>
          </span>
        </div>
        {right}
      </div>
    </header>
  );
}
