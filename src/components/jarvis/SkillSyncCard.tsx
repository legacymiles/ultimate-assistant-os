"use client";

// ---------------------------------------------------------------------------
// "Skills everywhere" — the companion to the memory card.
//
// One command, run once in the hub folder on any machine (PC or VPS, Windows
// or Linux), wires that machine up: a skill made in any Claude Code session is
// committed, deployed to this site, written into shared memory, and pulled onto
// every other machine at the start of its next session. The installer writes
// that machine's own paths, so nothing here is hand-edited.
//
// The token is the same JARVIS_MCP_TOKEN as the memory card. It is held only in
// React state while the tab is open — never saved by the page, never sent
// anywhere. "Generate" just makes a strong random string to use as that token;
// you still set it in Vercel (env) and paste it into the command below.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";

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

  // Default closed; the memory card above is step one, this is step two.
  useEffect(() => {
    /* no status fetch: setup runs on the machine, not the server */
  }, []);

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
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <Icon.Sparkles width={13} height={13} className="text-ink-faint" />
        <h2 className="text-xs font-semibold text-ink">Skills everywhere</h2>
        <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">one command per machine</span>
        <Icon.Chevron width={13} height={13} className={`ml-auto text-ink-faint transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-line px-3 py-3">
          <p className="max-w-[78ch] text-[11px] leading-relaxed text-ink-muted">
            Run the command below once in your hub folder on each machine — your PC and your VPS, Windows or
            Linux. After that, a skill made in any Claude Code session is committed, deployed to this site,
            written into your shared memory, and pulled onto your other machines at the start of their next
            session. You never copy a skill by hand again.
          </p>

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
            hint="Installs the config and the two Claude Code hooks (SessionStart → pull, Stop → push) with this machine's own paths, then pulls your skills now. Safe to re-run; it replaces only its own hooks and keeps the rest."
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
                Writes <span className="font-mono">~/.claude/jarvis-skill-sync.json</span> (token + this site&apos;s memory URL)
                and merges hooks into <span className="font-mono">~/.claude/settings.json</span>. Nothing else is touched.
              </p>
              <p>
                Manual commands: <span className="font-mono">npm run skills:push</span> after writing a skill,{" "}
                <span className="font-mono">npm run skills:pull</span> to pick up skills made elsewhere,{" "}
                <span className="font-mono">npm run skills:sync</span> for both. Add <span className="font-mono">--no-memory</span>{" "}
                to skip the memory write for a run.
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
