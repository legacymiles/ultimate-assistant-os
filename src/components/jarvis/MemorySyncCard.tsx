"use client";

// ---------------------------------------------------------------------------
// The card that makes "one memory everywhere" something the owner can set up
// without reading a README.
//
// It reads /api/jarvis/memory/mcp (booleans only, no secrets) and either shows
// the three connect targets with copy buttons, or says exactly which
// environment variable is still missing. The token is never displayed: the
// owner pastes it in, it goes to the clipboard with the command, and this
// component keeps it only in React state for as long as the tab is open.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";

interface Status {
  ready: boolean;
  config: { tokenSet: boolean; userIdSet: boolean; serviceKeySet: boolean; supabaseSet: boolean };
  tools: string[];
}

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";

const MISSING: { key: keyof Status["config"]; env: string; how: string }[] = [
  { key: "supabaseSet", env: "NEXT_PUBLIC_SUPABASE_URL", how: "Your Supabase project URL." },
  { key: "serviceKeySet", env: "SUPABASE_SERVICE_ROLE_KEY", how: "Supabase › Project settings › API." },
  { key: "userIdSet", env: "JARVIS_MCP_USER_ID", how: "Your Supabase user id: Authentication › Users." },
  {
    key: "tokenSet",
    env: "JARVIS_MCP_TOKEN",
    how: "A long random string you invent. This is the password for your memory.",
  },
];

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

export function MemorySyncCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [origin, setOrigin] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/jarvis/memory/mcp")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const missing = status ? MISSING.filter((m) => !status.config[m.key]) : [];
  // Shown before the owner pastes their token, so the shape of the command is
  // readable without one. It is obviously a placeholder, not a usable value.
  const t = token.trim() || "YOUR_TOKEN";

  return (
    <section className="mt-3 rounded-xl border border-line bg-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <Icon.Server width={13} height={13} className="text-ink-faint" />
        <h2 className="text-xs font-semibold text-ink">Same memory everywhere</h2>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] ${
            status?.ready ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {status === null ? "checking…" : status.ready ? "live" : "needs setup"}
        </span>
        <Icon.Chevron
          width={13}
          height={13}
          className={`ml-auto text-ink-faint transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-line px-3 py-3">
          <p className="max-w-[78ch] text-[11px] leading-relaxed text-ink-muted">
            This memory is already shared by every app on the hub. These three steps give the same memory
            to Claude Code on your PC and your VPS, and to claude.ai — so what you tell one, the others
            know.
          </p>

          {status && !status.ready && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
              <p className="text-[11px] font-medium text-amber-200">
                Set {missing.length} environment variable{missing.length === 1 ? "" : "s"} in Vercel, then redeploy.
              </p>
              <ul className="mt-1 space-y-0.5">
                {missing.map((m) => (
                  <li key={m.env} className="text-[10px] leading-relaxed text-ink-muted">
                    <span className="font-mono text-amber-200/90">{m.env}</span> — {m.how}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="block">
            <span className="text-[11px] text-ink-muted">
              Paste your JARVIS_MCP_TOKEN to fill the commands in (it is never saved or sent anywhere)
            </span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder="JARVIS_MCP_TOKEN"
              className="mt-1 w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
            />
          </label>

          <Command
            label="Claude Code (this PC and your VPS)"
            value={`claude mcp add --transport http jarvis-memory ${origin}/api/jarvis/memory/mcp --header "Authorization: Bearer ${t}"`}
            hint="Run it once in each place. Then add the rule below to that machine's CLAUDE.md, or Claude Code will not think to call it."
          />
          <Command
            label="claude.ai — Settings › Connectors › Add custom connector"
            value={`${origin}/api/jarvis/memory/mcp?k=${t}`}
            hint="Paste this as the URL and leave the OAuth fields empty. That dialog has nowhere to put a header, so the token has to ride in the URL — which means this URL is as secret as the token. Everything else uses a header."
          />
          <Command
            label="The CLAUDE.md rule"
            value={`## Memory\nYou share one long-term memory with Jarvis through the jarvis-memory MCP server.\n- Call search_memory at the start of a task and whenever I refer to something from earlier.\n- Call save_memory when I state a durable fact, preference or decision — one short fact each.\n- Never save passwords, API keys or card numbers.\n\n## Skills\nMy skills live in Jarvis. When I ask for a new skill or a change to one, write the full SKILL.md and save it with save_skill. Use list_skills and get_skill to find and follow existing skills.`}
            hint="Paste into the CLAUDE.md of each machine. Without it the tools are available but rarely used."
          />

          <p className="text-[10px] leading-relaxed text-ink-faint">
            Anyone holding that token can read and write your memory, so treat it like a password. To
            revoke it, change JARVIS_MCP_TOKEN in Vercel and redeploy — every client then needs the new one.
          </p>
        </div>
      )}
    </section>
  );
}
