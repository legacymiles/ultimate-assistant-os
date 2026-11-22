// ---------------------------------------------------------------------------
// Service keys, and the snippets that use one.
//
// A key is shown exactly once, on the row that just minted it, with the reason
// said out loud. Everything after that is a prefix. The copy-ready snippets
// sit underneath because the moment someone mints a key is the moment they
// need the three lines that use it.
// ---------------------------------------------------------------------------

"use client";

import { useState } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import type { ServiceKeyRow } from "@/lib/search/store";
import { Button, Chip, Empty, Panel, ago } from "./shared";

export interface PlanLimit {
  plan: string;
  perMinute: number;
  perDay: number;
}

/** The ceiling for a plan, so the form can say what a key will allow before it exists. */
function planFor(plans: PlanLimit[], plan: string): PlanLimit | undefined {
  return plans.find((entry) => entry.plan === plan);
}

export function KeysPanel({
  keys,
  storageShared,
  defaults,
  plans,
  onChange,
}: {
  keys: ServiceKeyRow[];
  storageShared: boolean;
  defaults: { perMinute: number; perDay: number };
  plans: PlanLimit[];
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [forEmail, setForEmail] = useState("");
  const [plan, setPlan] = useState<"owner" | "member" | "trial">("owner");
  const [expiresInDays, setExpiresInDays] = useState(0);
  const [minting, setMinting] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; name: string; forEmail: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function mint() {
    if (!name.trim() || minting) return;
    setMinting(true);
    setError(null);
    try {
      const response = await fetch("/api/search/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ownerEmail: plan === "owner" ? null : forEmail.trim(),
          plan,
          expiresInDays: expiresInDays > 0 ? expiresInDays : null,
        }),
      });
      const payload = (await response.json()) as { key?: string; error?: string };
      if (!response.ok || !payload.key) {
        setError(payload.error ?? `The service returned ${response.status}.`);
        return;
      }
      setFresh({ key: payload.key, name: name.trim(), forEmail: plan === "owner" ? null : forEmail.trim() });
      setName("");
      setForEmail("");
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Minting the key failed.");
    } finally {
      setMinting(false);
    }
  }

  async function revoke(row: ServiceKeyRow) {
    if (!window.confirm(`Revoke "${row.name}"? Anything using it stops working immediately, and this can't be undone.`)) {
      return;
    }
    const response = await fetch(`/api/search/keys?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Revoking the key failed.");
      return;
    }
    onChange();
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("The browser wouldn't let the page copy. Select the key and copy it by hand.");
    }
  }

  const live = keys.filter((row) => !row.revokedAt);
  const revoked = keys.filter((row) => row.revokedAt);

  return (
    <Panel
      title="Service keys"
      hint={`Agents, crons and other repos authenticate with one of these. Default ceiling ${defaults.perMinute}/min, ${defaults.perDay}/day.`}
    >
      {!storageShared ? (
        <p className="border-b border-line-soft bg-[#1a1611] px-3 py-2 text-[12px] leading-snug text-[#fbbf24]">
          Keys need shared storage and this host has none, so none can be issued yet. Set{" "}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> and reload. Until then, set{" "}
          <code className="font-mono">SEARCH_SERVICE_KEY</code> to any long random string on both ends and
          use that as the bearer token — it works with no database at all.
        </p>
      ) : null}

      <div className="border-b border-line-soft p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void mint();
            }}
            placeholder="What is it for? e.g. jarvis-harness, Sam's research bot"
            disabled={!storageShared}
            className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none disabled:opacity-45"
          />
          <Button
            variant="primary"
            onClick={mint}
            disabled={!storageShared || !name.trim() || (plan !== "owner" && !forEmail.trim()) || minting}
          >
            <Plus size={11} aria-hidden /> {minting ? "Issuing…" : "Issue key"}
          </Button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11.5px] text-ink-muted">For</span>
            <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
              {(["owner", "member", "trial"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPlan(option)}
                  disabled={!storageShared}
                  className={`rounded-[4px] px-2 py-[2px] text-[10.5px] font-medium tracking-wide transition max-sm:min-h-[32px] max-sm:px-3 ${
                    plan === option ? "bg-brand-2 text-white" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {option === "owner" ? "me" : option}
                </button>
              ))}
            </div>
          </div>

          {plan !== "owner" ? (
            <>
              <input
                value={forEmail}
                onChange={(event) => setForEmail(event.target.value)}
                type="email"
                placeholder="their email address"
                disabled={!storageShared}
                className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2.5 py-1 font-mono text-[11.5px] text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none max-sm:min-h-[32px]"
              />
              <label className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                Expires
                <select
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                  className="rounded-[4px] border border-line bg-canvas px-1.5 py-[2px] font-mono text-[11.5px] text-ink max-sm:min-h-[32px]"
                >
                  <option value={0}>never</option>
                  <option value={7}>in 7 days</option>
                  <option value={30}>in 30 days</option>
                  <option value={90}>in 90 days</option>
                </select>
              </label>
            </>
          ) : null}
        </div>

        {plan !== "owner" ? (
          <p className="mt-2 text-[11.5px] leading-snug text-ink-faint">
            Issued to an address, not an account — they may not have one yet. When they sign in with
            that address at <code className="font-mono text-ink-muted">/apps/search-access</code> the key
            appears there, with what it allows and how to call it.{" "}
            {planFor(plans, plan)
              ? `A ${plan} key is capped at ${planFor(plans, plan)!.perMinute}/min and ${planFor(plans, plan)!.perDay}/day.`
              : ""}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="border-b border-line-soft bg-[#1c1216] px-3 py-2 text-[12px] text-[#f87171]">{error}</p>
      ) : null}

      {fresh ? (
        <div className="border-b border-line-soft bg-[#141a16] p-3">
          <p className="text-[12px] font-medium text-ink">
            <KeyRound size={11} className="mr-1 inline" aria-hidden />
            {fresh.name} — copy this now
            {fresh.forEmail ? <span className="font-normal text-ink-muted"> and send it to {fresh.forEmail}</span> : null}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">
            It&rsquo;s stored as a hash, so this is the only time it can be shown. Lose it and you revoke
            this one and issue another.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-[11.5px] text-[#4ade80]">
              {fresh.key}
            </code>
            <Button variant="outline" onClick={() => copy(fresh.key)}>
              <Copy size={11} aria-hidden /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Snippets apiKey={fresh.key} />
          <div className="mt-2">
            <Button onClick={() => setFresh(null)}>Done — hide it</Button>
          </div>
        </div>
      ) : null}

      {live.length > 0 ? (
        <table className="w-full border-collapse text-left">
          <thead className="bg-panel-2">
            <tr className="text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-1.5 font-medium">Name</th>
              <th className="px-2 py-1.5 font-medium">For</th>
              <th className="px-2 py-1.5 font-medium">Key</th>
              <th className="px-2 py-1.5 font-medium">Allows</th>
              <th className="px-2 py-1.5 text-right font-medium">Calls</th>
              <th className="px-2 py-1.5 text-right font-medium">Last used</th>
              <th className="px-3 py-1.5 text-right font-medium">
                <span className="sr-only">Revoke</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {live.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-1.5 text-[12px] text-ink">
                  {row.name}
                  {row.expiresAt ? (
                    <span className="ml-1.5">
                      <Chip tone="warn">expires {new Date(row.expiresAt).toLocaleDateString()}</Chip>
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">
                  {row.ownerEmail ? (
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="font-mono text-[11.5px] text-ink-muted">{row.ownerEmail}</span>
                      <Chip tone={row.plan === "trial" ? "warn" : "brand"}>{row.plan}</Chip>
                      {row.ownerUserId ? null : <Chip>not signed in yet</Chip>}
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-ink-faint">you</span>
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono text-[11.5px] text-ink-faint">{row.prefix}…</td>
                <td className="px-2 py-1.5 font-mono text-[11.5px] tabular-nums text-ink-faint">
                  {row.perMinute}/min · {row.perDay}/day
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-[11.5px] tabular-nums text-ink-muted">
                  {row.callsTotal.toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11.5px] text-ink-faint">
                  {ago(row.lastUsedAt)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Button variant="danger" onClick={() => revoke(row)} title={`Revoke ${row.name}`}>
                    <Trash2 size={11} aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : storageShared ? (
        <Empty>
          No keys yet. Issue one above for whatever calls the service from outside this hub — an agent, a
          cron, another repo.
        </Empty>
      ) : null}

      {revoked.length > 0 ? (
        <p className="border-t border-line-soft px-3 py-1.5 text-[11.5px] text-ink-faint">
          {revoked.length} revoked key{revoked.length === 1 ? "" : "s"}:{" "}
          {revoked.map((row) => row.name).join(", ")}
        </p>
      ) : null}
    </Panel>
  );
}

/** The three lines someone needs the second they hold a key. */
function Snippets({ apiKey }: { apiKey: string }) {
  const origin = typeof window === "undefined" ? "https://your-hub" : window.location.origin;
  const shown = `${apiKey.slice(0, 12)}…`;
  return (
    <div className="mt-3 space-y-2">
      <Line
        label="curl"
        code={`curl -s "${origin}/api/search" -H "Authorization: Bearer ${shown}" \\\n  -H "Content-Type: application/json" \\\n  --data '{"query":"hello","app":"my-agent"}'`}
      />
      <Line
        label="Node / any repo"
        code={`import { createSearchClient } from "./search-client";\n\nconst search = createSearchClient({\n  baseUrl: "${origin}/api/search",\n  apiKey: process.env.JARVIS_SEARCH_KEY,\n  app: "my-agent",\n});\nconst { results } = await search.web("hello");`}
      />
      <Line label="Inside this hub (no key needed)" code={`import { searchWeb } from "@/lib/search/client";\n\nconst { results } = await searchWeb("hello", { app: "cookbook" });`} />
    </div>
  );
}

function Line({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <pre className="mt-0.5 overflow-x-auto rounded-md border border-line bg-canvas p-2 font-mono text-[11.5px] leading-relaxed text-ink-muted">
        {code}
      </pre>
    </div>
  );
}
