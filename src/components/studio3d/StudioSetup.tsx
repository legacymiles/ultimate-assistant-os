"use client";

import { useState } from "react";
import { ago, builderOnline, mintToken, type BuilderInfo } from "./api";

// "Connect your studio PC". Blender, Mixamo clips and Cascadeur all live on the
// owner's computer, so the site needs that computer's studio builder running.
// This panel shows what the PC reported it has, mints the token the builder
// signs in with, and gives the exact commands to start it.

const REPO = String.raw`C:\Users\honey\OneDrive\Desktop\claude code files`;

export function StudioSetup({ builder, onLinked, compact = false }: { builder: BuilderInfo | null; onLinked: () => void; compact?: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [open, setOpen] = useState(false);
  const online = builderOnline(builder);
  const caps = builder?.capabilities;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const mint = async () => {
    setBusy(true);
    setError("");
    try {
      setToken(await mintToken());
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

  const envFile = [
    `HUB_URL=${origin}`,
    `BUILDER_TOKEN=${token ?? "<your token>"}`,
    `# Optional — found automatically when installed in the usual place:`,
    `# BLENDER_PATH=C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe`,
    `# MIXAMO_LIBRARY=C:\\Users\\you\\Documents\\3D Studio\\_library\\mixamo`,
  ].join("\n");
  const startCmd = `cd "${REPO}\\tools\\studio3d-builder"\nnpm run builder`;
  const installCmd = `winget install BlenderFoundation.Blender\nwinget install astral-sh.uv\nclaude mcp add blender -s user -- uvx blender-mcp`;

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`h-2.5 w-2.5 rounded-full ${online ? "bg-core shadow-[0_0_10px] shadow-core/60" : builder?.linked ? "bg-amber-400" : "bg-ink-faint"}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {online ? "Studio PC connected" : builder?.linked ? "Studio PC offline" : "Connect your studio PC"}
          </p>
          <p className="text-xs text-ink-muted">
            {online
              ? `Renders start automatically. Last check-in ${ago(builder?.lastSeen)}.`
              : builder?.linked
                ? `Renders wait in the queue until the builder runs. Last seen ${ago(builder?.lastSeen)}.`
                : "Storyboards and animatics work right here. Final renders happen in Blender on your PC."}
          </p>
        </div>
        {!compact && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
          >
            {open ? "Hide setup" : "Setup"}
          </button>
        )}
      </div>

      {caps && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Cap ok={Boolean(caps.blender?.found)} label={caps.blender?.found ? `Blender ${caps.blender.version ?? ""}`.trim() : "Blender not found"} />
          <Cap ok={Boolean(caps.blenderMcp)} soft label={caps.blenderMcp ? "Blender MCP" : "Blender MCP off (CLI mode)"} />
          <Cap ok={(caps.mixamo?.clips.length ?? 0) > 0} soft label={`Mixamo library: ${caps.mixamo?.clips.length ?? 0} clips`} />
          <Cap ok={Boolean(caps.cascadeur?.found)} soft label={caps.cascadeur?.found ? `Cascadeur${caps.cascadeurMcp ? " + MCP" : ""}` : "Cascadeur not found (Blender fallback)"} />
        </div>
      )}

      {open && !compact && (
        <div className="mt-4 space-y-4 border-t border-line pt-4 text-sm">
          <Step n={1} title="Get a studio token">
            <p className="text-xs text-ink-muted">
              {token ? "Copy it now. It is shown once; a new one disconnects the old builder." : "The builder on your PC signs in with this."}
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
              Put this in <code className="text-ink">tools\studio3d-builder\.env</code>.
            </p>
            <CodeBox text={envFile} label="env" copied={copied} onCopy={copy} />
          </Step>
          <Step n={3} title="Install the studio (once)">
            <p className="text-xs text-ink-muted">
              Blender is required. uv + Blender MCP let Claude drive the Blender window live (optional — without it the builder runs Blender
              in the background). For Mixamo, download clips as FBX from mixamo.com into the library folder; for Cascadeur, install it from
              cascadeur.com. Both are optional — anything missing falls back to Blender and is listed in the render report.
            </p>
            <CodeBox text={installCmd} label="install" copied={copied} onCopy={copy} />
          </Step>
          <Step n={4} title="Start the studio builder">
            <p className="text-xs text-ink-muted">Leave it running. It needs Claude Code signed in on the PC.</p>
            <CodeBox text={startCmd} label="cmd" copied={copied} onCopy={copy} />
          </Step>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </section>
  );
}

function Cap({ ok, label, soft = false }: { ok: boolean; label: string; soft?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
        ok ? "border-core/40 text-core" : soft ? "border-line text-ink-muted" : "border-red-500/40 text-red-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-core" : soft ? "bg-ink-faint" : "bg-red-400"}`} aria-hidden />
      {label}
    </span>
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

function CodeBox({ text, label, copied, onCopy }: { text: string; label: string; copied: string; onCopy: (label: string, text: string) => void }) {
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
