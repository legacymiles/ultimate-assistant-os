"use client";

// ---------------------------------------------------------------------------
// "Skills everywhere" — the companion to the memory card.
//
// Every skill lives in ONE place: Jarvis. Three ways in, one store:
//   - Phone / claude.ai / any Claude Code cloud session: nothing to install.
//     The jarvis-memory connector (set up in the card above) has save_skill,
//     so "make me a skill for X" is saved straight into Jarvis.
//   - PC and VPS: one command per machine installs two Claude Code hooks that
//     pull every skill from Jarvis at session start and push new/edited local
//     skills at the end of a turn, over HTTPS with the token. No git.
//   - This website reads the same store, so a skill made anywhere shows up in
//     the Skills library straight away.
//
// The token is the same JARVIS_MCP_TOKEN as the memory card, held only in React
// state while the tab is open — never saved by the page, never sent anywhere.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";
import { SyncStatePill, SyncStatusPanel, useSyncStatus } from "./SyncStatusPanel";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";

function Command({ label, value, hint }: { label: string; value: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  }, [value]);
  return (
    <div className="rounded-lg border border-line-soft bg-panel-2/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-ink">{label}</p>
        <button onClick={copy} className={btn} aria-label={`Copy the ${label} command`}>
          {copied ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-ink-muted">
        {value}
      </pre>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">{hint}</p>
    </div>
  );
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function SkillSyncCard() {
  const [token, setToken] = useState("");
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const status = useSyncStatus();

  // Anything not set up opens the card by itself, so it can't be missed.
  // Once the owner has toggled it, their choice stands.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && status.plan && status.plan.state !== "ready") setOpen(true);
  }, [status.plan, touched]);

  const t = token.trim() || "YOUR_TOKEN";
  const copyToken = () => {
    if (!token.trim()) return;
    navigator.clipboard.writeText(token.trim()).then(
      () => {
        setTokenCopied(true);
        setTimeout(() => setTokenCopied(false), 1600);
      },
      () => setTokenCopied(false),
    );
  };

  return (
    <section className="mt-3 rounded-xl border border-line bg-panel">
      <button
        onClick={() => {
          setTouched(true);
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <Icon.Sparkles width={13} height={13} className="text-ink-faint" />
        <h2 className="text-xs font-semibold text-ink">Skills everywhere</h2>
        <SyncStatePill plan={status.plan} error={status.error} />
        {status.plan && status.plan.state !== "ready" && (
          <span className="hidden truncate text-[10.5px] text-ink-faint sm:inline">{status.plan.here.title}</span>
        )}
        <Icon.Chevron width={13} height={13} className={`ml-auto text-ink-faint transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-line px-3 py-3">
          <SyncStatusPanel token={token} status={status} />

          <p className="max-w-[78ch] border-t border-line-soft pt-2.5 text-[11px] leading-relaxed text-ink-muted">
            Every skill lives in one place — here in Jarvis — and every device reads from it. Make a skill anywhere and
            you never lose it.
          </p>
          <ul className="max-w-[78ch] space-y-1 text-[11px] leading-relaxed text-ink-muted">
            <li>
              <span className="text-ink">Phone, claude.ai, Claude Code in the cloud:</span> nothing to install. Once the
              memory connector above is added, just ask Claude to make a skill — it saves it to Jarvis with{" "}
              <span className="font-mono">save_skill</span>.
            </li>
            <li>
              <span className="text-ink">Your PC and your VPS:</span> run the command below once on each, in your hub
              folder. Every Claude Code session then starts with every skill in Jarvis, and a skill you make or edit there
              is saved back at the end of the turn.
            </li>
            <li>
              <span className="text-ink">This website:</span> the Skills library reads the same store, so new skills show
              up right away.
            </li>
          </ul>

          <label className="block">
            <span className="text-[11px] text-ink-muted">
              Your token (same JARVIS_MCP_TOKEN as the memory card) — pasted into the command, never saved here
            </span>
            <div className="mt-1 flex gap-1.5">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type={reveal ? "text" : "password"}
                placeholder="JARVIS_MCP_TOKEN"
                className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
              />
              <button onClick={() => setReveal((v) => !v)} className={btn} aria-label={reveal ? "Hide token" : "Show token"}>
                {reveal ? <Icon.EyeOff width={12} height={12} /> : <Icon.Eye width={12} height={12} />}
              </button>
              <button onClick={() => setToken(generateToken())} className={btn}>
                Generate
              </button>
              <button onClick={copyToken} className={btn} disabled={!token.trim()} aria-label="Copy token">
                {tokenCopied ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
                {tokenCopied ? "Copied" : "Copy"}
              </button>
            </div>
          </label>

          <div className="rounded-lg border border-line-soft bg-panel-2/40 p-2 text-[10px] leading-relaxed text-ink-faint">
            New token? Do two things with it: set <span className="font-mono text-ink-muted">JARVIS_MCP_TOKEN</span> to it in
            Vercel and redeploy (so the memory accepts it), and paste it into the command below on each machine. The same
            token everywhere is what makes it universal.
          </div>

          <Command
            label="Set up this machine (run in your hub folder — PC and VPS)"
            value={`npm run skills:setup -- --token ${t}`}
            hint="Saves the token for this machine, adds two Claude Code hooks (session start → pull from Jarvis, end of turn → push to Jarvis) with this machine's own paths, then syncs right away — the first run also adds the skills already in your hub repo. Safe to re-run; it replaces only its own hooks."
          />
          <Command
            label="Or run it directly (if npm scripts aren't set up)"
            value={`node scripts/skill-sync.mjs install --token ${t}`}
            hint="Same thing, without npm. Run from the hub repo folder so the script can find itself."
          />

          <details className="text-[10px] leading-relaxed text-ink-faint">
            <summary className="cursor-pointer text-ink-muted">What it sets up, and running it by hand</summary>
            <div className="mt-1.5 space-y-1">
              <p>
                Writes <span className="font-mono">~/.claude/jarvis-skill-sync.json</span> (token + this site&apos;s address)
                and merges two hooks into <span className="font-mono">~/.claude/settings.json</span>. Skills sync over HTTPS
                with the token — no git, no repo access. A local edit you haven&apos;t pushed yet is never overwritten, and a
                newer version from another device is never clobbered.
              </p>
              <p>
                Manual commands: <span className="font-mono">npm run skills:push</span> after writing a skill,{" "}
                <span className="font-mono">npm run skills:pull</span> to pick up skills made elsewhere,{" "}
                <span className="font-mono">npm run skills:sync</span> for both. Add <span className="font-mono">--check</span> to see
                what would change without changing anything.
              </p>
            </div>
          </details>

          <p className="text-[10px] leading-relaxed text-ink-faint">
            Anyone holding that token can read and write your memory, so treat it like a password. To rotate it, change
            JARVIS_MCP_TOKEN in Vercel, redeploy, and re-run the setup command on each machine with the new one.
          </p>
        </div>
      )}
    </section>
  );
}
