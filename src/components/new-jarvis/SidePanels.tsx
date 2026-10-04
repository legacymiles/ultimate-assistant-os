"use client";

// ---------------------------------------------------------------------------
// What this assistant can reach on this machine, one line per capability.
//
// This was half of the right-hand column. The column is gone — it cost 300px
// of the widest surface in the hub to say two things the owner needs about
// once a session — and its two halves went to different places: voice became
// the floating orb and its chamber, and these rows became the sheet behind the
// dock across the bottom.
//
// The panel itself is unchanged; only where it is mounted from. So the one
// thing worth keeping is intact: a capability that is off says WHY, in a
// sentence, because "offline" as a single red dot sends the owner to a log file
// and a sentence sends them to the fix.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import type { BridgeHealth } from "@/lib/new-jarvis/bridge";

const CAPS: { key: "shell" | "files" | "system" | "browser"; label: string; what: string }[] = [
  { key: "browser", label: "Browser", what: "opens pages, reads them, clicks and fills" },
  { key: "shell", label: "Shell", what: "runs commands and reads the output" },
  { key: "files", label: "Files", what: "lists folders, reads and writes files" },
  { key: "system", label: "System", what: "windows, apps, the screen, the clipboard" },
];

export function BridgePanel({
  health,
  ready,
  hasToken,
  onPair,
  onUnpair,
  onRefresh,
}: {
  health: BridgeHealth;
  ready: boolean;
  hasToken: boolean;
  onPair: (token: string) => void;
  onUnpair: () => void;
  onRefresh: () => void;
}) {
  const [token, setToken] = useState("");
  const [open, setOpen] = useState(false);
  const caps = health.capabilities;
  const usable = health.up && health.paired;

  return (
    <section className="px-3 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">This PC</h2>
        <button
          type="button"
          onClick={onRefresh}
          title="Check again"
          className="ml-auto rounded p-0.5 text-ink-muted transition hover:bg-elevated hover:text-ink"
        >
          <Icon.Refresh width={11} height={11} />
          <span className="sr-only">Check again</span>
        </button>
      </div>

      {!ready ? (
        <p className="mt-2 text-[11px] text-ink-muted">Checking…</p>
      ) : (
        <>
          <ul className="mt-2 space-y-1">
            {CAPS.map((c) => {
              const on = usable && caps?.[c.key] === true;
              // The row names the capability, never only a colour. A green dot
              // says "fine"; "opens pages, reads them, clicks and fills" says
              // what you can now ask for — which is the thing the owner is
              // actually deciding.
              const why = !on
                ? !health.up
                  ? "the local agent is not running"
                  : !health.paired
                    ? "this browser is not paired with it"
                    : c.key === "browser" && caps?.browserWhy
                      ? caps.browserWhy
                      : "the agent did not offer it"
                : "";
              return (
                <li key={c.key} className="space-y-0.5">
                  <div className="flex items-center gap-2">
                  <span className={`nj-dot ${on ? "bg-core" : "bg-ink-faint/50"}`} aria-hidden />
                  <span className={`text-[11.5px] ${on ? "text-ink" : "text-ink-muted"}`}>{c.label}</span>
                  <span className="ml-auto text-[10px] text-ink-muted">{on ? "ready" : "off"}</span>
                  </div>
                  <p className="pl-[15px] text-[10.5px] leading-snug text-ink-muted">
                    {on ? c.what : why}
                  </p>
                </li>
              );
            })}
          </ul>

          {/* The reason, not just the colour. */}
          {!health.up && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
              The local agent is not running. Start it with{" "}
              <code className="font-mono text-ink-muted">tools\jarvis-bridge\install.cmd</code>, once — after that it
              starts itself at sign-in.
            </p>
          )}
          {health.up && !health.paired && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
              Running, but not paired with this browser. Run{" "}
              <code className="font-mono text-ink-muted">pair.cmd</code> on the PC, or paste its token below.
            </p>
          )}
          {usable && caps?.browser === false && caps.browserWhy && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">{caps.browserWhy}</p>
          )}
          {usable && (
            <p className="mt-2 text-[10.5px] text-ink-muted" data-num>
              agent {health.version}
              {health.browserRunning ? " · browser open" : ""}
            </p>
          )}

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-2 text-[10.5px] text-ink-muted underline-offset-2 transition hover:text-ink hover:underline"
          >
            {hasToken ? "Re-pair or unpair" : "Paste a token"}
          </button>

          {open && (
            <div className="mt-2 space-y-2">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Token from the agent's window"
                spellCheck={false}
                className="w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-ink outline-none placeholder:text-ink-muted"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onPair(token.trim());
                    setToken("");
                    setOpen(false);
                  }}
                  disabled={!token.trim()}
                  className="rounded bg-brand-2 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--nj-brand-press)] disabled:opacity-30"
                >
                  Pair
                </button>
                {hasToken && (
                  <button
                    type="button"
                    onClick={() => {
                      onUnpair();
                      setOpen(false);
                    }}
                    className="rounded border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:bg-elevated hover:text-ink"
                  >
                    Unpair
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
