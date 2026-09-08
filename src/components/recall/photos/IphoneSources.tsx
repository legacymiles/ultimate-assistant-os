"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../icons";

// ---------------------------------------------------------------------------
// Getting photos off an iPhone. Two paths, and the difference between them is
// stated rather than smoothed over.
//
//   Import   the iOS photo picker. Instant, no setup, nothing leaves the
//            device except the vision call. The count is a CAP — iOS will not
//            let a web page auto-select "the last 50", so you pick them.
//
//   Autopilot an iOS Shortcut that POSTs to /api/dashboard/inbox/push. This is
//            the only path that can literally take the last N by itself, and
//            the only one that can run unattended on a schedule.
//
// Claiming that the picker "gets your last 50" would be a lie the user
// discovers while holding their phone. So the UI labels which is which.
// ---------------------------------------------------------------------------

const COUNTS = [5, 20, 50, 100] as const;

export interface InboxEntry {
  id: string;
  name: string;
  bytes: number;
  takenAt?: string;
  receivedAt: string;
}

interface Props {
  busy: boolean;
  /** Hand picked or claimed files to the existing import pipeline. */
  onImport: (files: File[]) => void | Promise<void>;
  onToast: (msg: string) => void;
}

export function IphoneSources({ busy, onImport, onToast }: Props) {
  const [cap, setCap] = useState<number>(50);
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [linked, setLinked] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard/inbox");
      if (!r.ok) return;
      const d = (await r.json()) as { linked?: boolean; entries?: InboxEntry[] };
      setLinked(Boolean(d.linked));
      setEntries(d.entries ?? []);
    } catch {
      /* offline — the picker still works, which is the point of having both */
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Slow poll: a phone that syncs nightly does not need a fast one, and this
    // runs while the tab sits open in the background.
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  /**
   * Keep the newest `cap` by capture date.
   *
   * iOS returns picker selections in an order that is not guaranteed to be
   * newest-first, so "the most recent 50 of what you picked" has to be computed
   * rather than assumed from position.
   */
  function trimToCap(files: File[]): { kept: File[]; dropped: number } {
    if (files.length <= cap) return { kept: files, dropped: 0 };
    const sorted = [...files].sort((a, b) => b.lastModified - a.lastModified);
    return { kept: sorted.slice(0, cap), dropped: files.length - cap };
  }

  async function mint() {
    const r = await fetch("/api/dashboard/inbox/token", { method: "POST" });
    const d = (await r.json()) as { token?: string; error?: string };
    if (d.token) {
      setToken(d.token);
      setLinked(true);
      setSetupOpen(true);
    } else {
      onToast(d.error ?? "Could not create a token");
    }
  }

  async function claimAll() {
    if (!entries.length) return;
    setClaiming(true);
    try {
      const r = await fetch("/api/dashboard/inbox/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: entries.map((e) => e.id) }),
      });
      const d = (await r.json()) as {
        photos?: { name: string; contentType: string; dataUrl: string }[];
      };
      const files = await Promise.all(
        (d.photos ?? []).map(async (p) => {
          const blob = await (await fetch(p.dataUrl)).blob();
          return new File([blob], p.name, { type: p.contentType });
        }),
      );
      setEntries([]);
      if (files.length) await onImport(files);
      else onToast("Nothing left to bring in");
    } finally {
      setClaiming(false);
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const pushUrl = `${origin}/api/dashboard/inbox/push`;

  return (
    <div className="mb-3 rounded-2xl border border-line bg-panel-2/40 p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <Icon.Upload width={13} height={13} />
        </span>
        <p className="text-[12px] font-semibold text-ink">Get photos from your iPhone</p>
        {entries.length > 0 && (
          <span className="ml-auto rounded-full bg-brand/20 px-2 py-0.5 text-[10px] font-semibold text-brand">
            {entries.length} waiting
          </span>
        )}
      </div>

      {/* How many */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
          How many
        </span>
        {COUNTS.map((n) => (
          <button
            key={n}
            onClick={() => setCap(n)}
            aria-pressed={cap === n}
            className={
              "rounded-lg px-2 py-1 text-[11px] font-semibold tabular-nums transition " +
              (cap === n
                ? "bg-brand text-white"
                : "border border-line text-ink-muted hover:text-ink")
            }
          >
            {n}
          </button>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          const { kept, dropped } = trimToCap(picked);
          if (dropped > 0) onToast(`Kept the newest ${cap} — dropped ${dropped}`);
          void onImport(kept);
        }}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {/* --- Picker --------------------------------------------------- */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-xl border border-line bg-canvas p-2.5 text-left transition hover:border-brand/50 disabled:opacity-40"
        >
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <Icon.Image width={13} height={13} /> Import now
          </span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-faint">
            Opens your camera roll — <strong className="text-ink-muted">select up to {cap}</strong>.
            iOS won&apos;t let a web page pick them for you.
          </span>
        </button>

        {/* --- Autopilot ------------------------------------------------ */}
        <button
          onClick={() => (linked ? setSetupOpen(true) : void mint())}
          className="rounded-xl border border-line bg-canvas p-2.5 text-left transition hover:border-brand/50"
        >
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <Icon.Refresh width={13} height={13} /> Autopilot
            {linked && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
          </span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-faint">
            {linked
              ? `Linked. A Shortcut sends your last ${cap} — tap it, or let it run nightly.`
              : `Set up an iOS Shortcut that grabs the last ${cap} by itself.`}
          </span>
        </button>
      </div>

      {entries.length > 0 && (
        <button
          onClick={() => void claimAll()}
          disabled={claiming || busy}
          className="mt-2 w-full rounded-xl bg-brand px-3 py-2 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {claiming
            ? "Bringing them in…"
            : `Bring in ${entries.length} photo${entries.length === 1 ? "" : "s"} from your phone`}
        </button>
      )}

      {setupOpen && (
        <ShortcutSetup
          token={token}
          pushUrl={pushUrl}
          count={cap}
          onRotate={() => void mint()}
          onClose={() => setSetupOpen(false)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ShortcutSetup({
  token,
  pushUrl,
  count,
  onRotate,
  onClose,
  onToast,
}: {
  token: string | null;
  pushUrl: string;
  count: number;
  onRotate: () => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text).then(
      () => onToast(`${what} copied`),
      () => onToast("Could not copy"),
    );
  };

  const local = pushUrl.includes("localhost") || pushUrl.includes("127.0.0.1");

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Icon.Refresh width={15} height={15} />
          </span>
          <span className="text-sm font-semibold text-ink">Autopilot setup</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={15} height={15} />
          </button>
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
          Build this once in the iPhone <strong className="text-ink">Shortcuts</strong> app. Tapping
          it sends your last {count} photos. Attach it to a Personal Automation (nightly, or when
          you put the phone on the charger) and it runs without you.
        </p>

        {local && (
          <p className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-2 text-[11px] leading-relaxed text-amber-200">
            This URL points at <strong>localhost</strong>, which your phone cannot reach. Use your
            deployed Dashboard URL instead, and make sure{" "}
            <code className="text-[10px]">SUPABASE_SERVICE_ROLE_KEY</code> is set there — the inbox
            cannot store anything on a read-only host without it.
          </p>
        )}

        <ol className="mb-3 space-y-2 text-[11px] leading-relaxed text-ink-muted">
          <li>
            <strong className="text-ink">1.</strong> New Shortcut → add{" "}
            <strong className="text-ink">Find Photos</strong>. Sort by{" "}
            <em>Creation Date</em>, Latest First, Limit <strong className="text-ink">{count}</strong>
            .
          </li>
          <li>
            <strong className="text-ink">2.</strong> Add{" "}
            <strong className="text-ink">Get Contents of URL</strong>. Method{" "}
            <strong className="text-ink">POST</strong>, Request Body{" "}
            <strong className="text-ink">Form</strong>.
          </li>
          <li>
            <strong className="text-ink">3.</strong> Add one Form field named{" "}
            <code className="text-[10px] text-ink">photos</code> of type <em>File</em>, set to the
            Photos from step 1.
          </li>
          <li>
            <strong className="text-ink">4.</strong> Add a Header{" "}
            <code className="text-[10px] text-ink">X-Dashboard-Token</code> with the token below.
          </li>
        </ol>

        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-faint">
          URL
        </label>
        <div className="mb-3 flex gap-1.5">
          <code className="flex-1 truncate rounded-xl border border-line bg-canvas px-2.5 py-2 text-[11px] text-ink">
            {pushUrl}
          </code>
          <button
            onClick={() => copy(pushUrl, "URL")}
            className="rounded-xl border border-line px-2.5 text-[11px] text-ink-muted hover:text-ink"
          >
            <Icon.Copy width={13} height={13} />
          </button>
        </div>

        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-faint">
          Device token
        </label>
        {token ? (
          <>
            <div className="mb-1.5 flex gap-1.5">
              <code className="flex-1 truncate rounded-xl border border-line bg-canvas px-2.5 py-2 text-[11px] text-ink">
                {token}
              </code>
              <button
                onClick={() => copy(token, "Token")}
                className="rounded-xl border border-line px-2.5 text-[11px] text-ink-muted hover:text-ink"
              >
                <Icon.Copy width={13} height={13} />
              </button>
            </div>
            <p className="mb-3 text-[10px] leading-relaxed text-ink-faint">
              Copy it now — only its hash is stored, so this is the one time it can be shown.
            </p>
          </>
        ) : (
          <div className="mb-3 rounded-xl border border-line bg-canvas p-2.5">
            <p className="mb-2 text-[11px] text-ink-muted">
              A token already exists for this account, but only its hash is kept — it cannot be
              shown again. Create a new one to set up another phone.
            </p>
            <button
              onClick={onRotate}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-ink-muted hover:text-ink"
            >
              Create a new token
            </button>
            <p className="mt-1.5 text-[10px] text-ink-faint">
              This replaces the old one — any Shortcut still using it stops working.
            </p>
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-ink-faint">
          Optional but worth it: add a second Form field{" "}
          <code className="text-[10px]">deviceIds</code> set to the photos&apos; identifiers,
          comma-separated. That lets a nightly run skip what it already sent instead of importing
          the same photos over and over.
        </p>
      </div>
    </div>
  );
}
