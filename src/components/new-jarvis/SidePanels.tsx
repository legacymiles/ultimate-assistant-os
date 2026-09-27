"use client";

// ---------------------------------------------------------------------------
// The right column, which never leaves.
//
// Two panels, and between them they answer the question the old Jarvis could
// never answer without being asked: what can this assistant actually do right
// now? The wave says whether it is listening. The capability rows say whether
// it can reach this machine, one line per capability with its own reason when
// it cannot — because "offline" as a single red dot sends the owner to a log
// file, and a sentence sends them to the fix.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import type { BridgeHealth } from "@/lib/new-jarvis/bridge";
import type { VoiceState } from "@/lib/new-jarvis/useWakeVoice";

const BAR_COUNT = 13;
/** Must match --nj-wave-h in new-jarvis.css; the bars scale against it. */
const BAR_HEIGHT = 52;

export function VoicePanel({
  state,
  level,
  heard,
  error,
  supported,
  onToggle,
  speakReplies,
  onSpeakReplies,
}: {
  state: VoiceState;
  level: number;
  heard: string;
  error: string;
  supported: boolean;
  onToggle: () => void;
  speakReplies: boolean;
  onSpeakReplies: (v: boolean) => void;
}) {
  const label =
    state === "off"
      ? "Not listening"
      : state === "waiting"
        ? 'Waiting for "Jarvis"'
        : state === "hearing"
          ? "Listening"
          : state === "thinking"
            ? "Thinking"
            : "Speaking";

  // A fixed bar set whose heights follow the live level, tallest in the middle
  // so the shape reads as a voice rather than a chart. Expressed as a scale of
  // one fixed height, so the wave composites instead of relayouting thirteen
  // elements every frame.
  const scales = Array.from({ length: BAR_COUNT }, (_, i) => {
    const centre = 1 - Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
    const idle = state === "off" ? 0 : 0.1;
    const h = 4 + (idle + level * (0.35 + centre * 0.65)) * 48;
    // At rest the bars still have to read as a wave. Scaled to their true
    // silence they became thirteen 4px dots — a dotted rule, not an
    // instrument that is listening.
    const floor = state === "off" ? 0.12 : 0.06;
    return Math.max(floor, Math.min(1, h / BAR_HEIGHT));
  });

  return (
    <section className="border-b border-line px-3 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">Voice</h2>
        <button
          type="button"
          onClick={onToggle}
          disabled={!supported}
          className={`ml-auto rounded px-1.5 py-0.5 text-[10.5px] font-medium transition ${
            state === "off"
              ? "text-ink-muted hover:bg-elevated hover:text-ink"
              : "bg-core/15 text-core hover:bg-core/25"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {state === "off" ? "Turn on" : "On"}
        </button>
      </div>

      <div className="nj-wave mt-2" data-state={state} aria-hidden>
        {scales.map((s, i) => (
          <span key={i} style={{ transform: `scaleY(${s.toFixed(3)})` }} />
        ))}
      </div>

      <p className="mt-1 text-center text-[11px] text-ink-muted" aria-live="polite">
        {label}
      </p>

      {heard && (
        <p className="mt-2 rounded border border-line-soft bg-canvas px-2 py-1.5 font-mono text-[11px] leading-snug text-ink">
          {heard}
        </p>
      )}

      {!supported && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          This browser has no speech recognition. Chrome, Edge and Safari do — everything else here still works.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] leading-relaxed text-[#f87171]">{error}</p>}

      {/* A bordered toggle in the surface's own vocabulary. The raw checkbox
          this replaces was the one control here wearing the operating
          system's shape among otherwise bordered chips and buttons. */}
      <button
        type="button"
        role="switch"
        aria-checked={speakReplies}
        onClick={() => onSpeakReplies(!speakReplies)}
        className="mt-2.5 flex w-full items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left text-[11px] text-ink-muted transition hover:bg-elevated hover:text-ink"
      >
        <span
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition ${
            speakReplies ? "border-brand bg-brand text-white" : "border-line text-transparent"
          }`}
          aria-hidden
        >
          <Icon.Check width={9} height={9} />
        </span>
        Speak answers aloud
      </button>
    </section>
  );
}

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
                  className="rounded bg-brand px-2 py-1 text-[11px] font-medium text-white transition hover:bg-brand-2 disabled:opacity-30"
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
