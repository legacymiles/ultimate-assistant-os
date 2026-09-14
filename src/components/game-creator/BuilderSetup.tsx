"use client";

import { useState } from "react";
import { ago, builderOnline, mintBuilderToken, type BuilderInfo } from "./api";

// "Connect your PC". Games are built by the Unreal Engine install on the
// owner's computer, so the site needs that computer's builder to be running.
// This panel mints the token the builder authenticates with and shows the
// exact commands to start it.

const REPO = String.raw`C:\Users\honey\OneDrive\Desktop\claude code files`;

export function BuilderSetup({ builder, onLinked }: { builder: BuilderInfo | null; onLinked: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [open, setOpen] = useState(false);
  const online = builderOnline(builder);

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const mint = async () => {
    setBusy(true);
    setError("");
    try {
      setToken(await mintBuilderToken());
      setOpen(true);
      onLinked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("Copy failed. Select the text and copy it by hand.");
    }
  };

  const envFile = `HUB_URL=${origin}\nBUILDER_TOKEN=${token ?? "<your token>"}`;
  const startCmd = `cd "${REPO}\\tools\\unreal-builder"\nnpm install\nnpm run builder`;

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`h-2.5 w-2.5 rounded-full ${online ? "bg-core shadow-[0_0_10px] shadow-core/60" : builder?.linked ? "bg-amber-400" : "bg-ink-faint"}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {online ? "Your PC is connected" : builder?.linked ? "Your PC's builder is offline" : "Connect your PC"}
          </p>
          <p className="text-xs text-ink-muted">
            {online
              ? `Unreal Engine on your computer picks up new games automatically. Last check-in ${ago(builder?.lastSeen)}.`
              : builder?.linked
                ? `Games wait in the queue until the builder runs. Last seen ${ago(builder?.lastSeen)}.`
                : "Games are built by Unreal Engine on your computer. Link it once and it builds every prompt you queue here."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
        >
          {open ? "Hide setup" : "Setup"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4 text-sm">
          <Step n={1} title="Get a builder token">
            <p className="text-xs text-ink-muted">
              {token
                ? "Copy it now. It is shown once; making a new one disconnects the old builder."
                : builder?.linked
                  ? "A builder is already linked. A new token replaces it."
                  : "The builder on your PC signs in with this."}
            </p>
            {token ? (
              <CodeBox text={token} label="token" copied={copied} onCopy={copy} />
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={mint}
                className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {busy ? "Creating…" : builder?.linked ? "Replace token" : "Create token"}
              </button>
            )}
          </Step>
          <Step n={2} title="Save it on your PC">
            <p className="text-xs text-ink-muted">
              Put these two lines in <code className="text-ink">tools\unreal-builder\.env</code>.
            </p>
            <CodeBox text={envFile} label="env" copied={copied} onCopy={copy} />
          </Step>
          <Step n={3} title="Start the builder">
            <p className="text-xs text-ink-muted">Run once in a terminal and leave it open. It needs Unreal Engine 5.8 and Claude Code.</p>
            <CodeBox text={startCmd} label="cmd" copied={copied} onCopy={copy} />
          </Step>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-[11px] text-ink-muted">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {children}
      </div>
    </div>
  );
}

function CodeBox({
  text,
  label,
  copied,
  onCopy,
}: {
  text: string;
  label: string;
  copied: string;
  onCopy: (label: string, text: string) => void;
}) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-canvas p-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-ink">{text}</pre>
      <button
        type="button"
        onClick={() => onCopy(label, text)}
        className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:bg-elevated hover:text-ink"
      >
        {copied === label ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
