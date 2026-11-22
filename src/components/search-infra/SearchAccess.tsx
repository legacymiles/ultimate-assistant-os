// ---------------------------------------------------------------------------
// The member's page: "I was given a search key — what is it and what can I do
// with it?"
//
// Deliberately small, and deliberately not the owner's console. It shows what
// this person holds, what their ceiling is, what they have used, and the three
// lines that use the key. It never shows the key itself (there is nothing to
// show — keys are stored as hashes), never names a provider, and never hints
// that anyone else exists.
//
// Three states it has to handle honestly, because all three are normal:
// signed out, signed in with no key yet, and signed in with a key.
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Chip, Panel, Spinner, Stat, ago } from "./shared";

interface AccountView {
  email: string;
  isOwner: boolean;
  hasAccess: boolean;
  keys: {
    id: string;
    name: string;
    prefix: string;
    plan: string;
    perMinute: number;
    perDay: number;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    callsTotal: number;
    note: string | null;
  }[];
  revokedCount: number;
  used: { windowHours: number; calls: number; failed: number; lastAt: string | null };
  endpoint: string;
}

export function SearchAccess() {
  const [view, setView] = useState<AccountView | null>(null);
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/search/account", { cache: "no-store" });
        if (!live) return;
        if (response.status === 401) {
          setState("signed-out");
          return;
        }
        const payload = (await response.json()) as AccountView & { error?: string };
        if (!response.ok) {
          setMessage(payload.error ?? `The service returned ${response.status}.`);
          setState("error");
          return;
        }
        setView(payload);
        setState("ready");
      } catch (error) {
        if (!live) return;
        setMessage(error instanceof Error ? error.message : "Couldn't reach the service.");
        setState("error");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-canvas pb-12" style={{ ["--color-ink-faint" as string]: "#838c9e" }}>
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[760px] items-center gap-3 px-4 py-3">
          <ShieldCheck size={16} className="shrink-0 text-ink-faint" aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-ink">Search access</h1>
            <p className="truncate text-[11.5px] text-ink-faint">Your key for the search API</p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-4 py-4">
        {state === "loading" ? (
          <Panel title="Your access">
            <p className="px-3 py-6 text-center">
              <Spinner label="Checking what you have…" />
            </p>
          </Panel>
        ) : null}

        {state === "signed-out" ? (
          <Panel title="Sign in">
            <div className="px-3 py-5 text-center">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Sign in with the email address your key was issued to, and it will show up here.
              </p>
              <Link
                href="/login?next=/apps/search-access"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-2 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-brand-press"
              >
                Sign in
              </Link>
            </div>
          </Panel>
        ) : null}

        {state === "error" ? (
          <p className="rounded-[10px] border border-[#ef4444]/40 bg-[#1c1216] px-3 py-2 text-[12px] leading-snug text-[#f87171]">
            {message}
          </p>
        ) : null}

        {state === "ready" && view && !view.hasAccess ? (
          <Panel title="Your access" hint={view.email}>
            <div className="px-3 py-6">
              {/* The empty state is the first thing a new member sees, so it
                  gets the page's one display-sized line rather than being a
                  paragraph of apology. */}
              <p className="text-[20px] font-semibold leading-tight tracking-tight text-ink">
                No key yet
              </p>
              <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-ink-muted">
                You&rsquo;re signed in as <span className="font-mono text-ink">{view.email}</span>, and no
                search key has been issued to that address.
              </p>
              <p className="mt-2 max-w-prose text-[12px] leading-relaxed text-ink-faint">
                Ask the owner to issue one for this exact address — a key is tied to the address it was
                created for, so one made for a different email won&rsquo;t show up here.
              </p>
            </div>
          </Panel>
        ) : null}

        {state === "ready" && view && view.hasAccess ? (
          <>
            <Panel title="Your access" hint={view.email}>
              <div className="grid grid-cols-2 sm:grid-cols-4">
                <Stat label="Plan" value={view.keys[0].plan} />
                <Stat label="Per minute" value={view.keys[0].perMinute} sub="searches" />
                <Stat label="Per day" value={view.keys[0].perDay} sub="resets at midnight UTC" />
                <Stat
                  label={`Used (${view.used.windowHours}h)`}
                  value={view.used.calls}
                  tone={view.used.failed > 0 ? "warn" : "muted"}
                  sub={view.used.failed > 0 ? `${view.used.failed} failed` : `last ${ago(view.used.lastAt)}`}
                />
              </div>
            </Panel>

            <Panel title="Your keys" hint="The key itself is only shown once, when it's created">
              <ul className="divide-y divide-line-soft">
                {view.keys.map((key) => (
                  <li key={key.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                    <KeyRound size={11} className="shrink-0 text-ink-faint" aria-hidden />
                    <span className="text-[12px] font-medium text-ink">{key.name}</span>
                    <span className="font-mono text-[11.5px] text-ink-faint">{key.prefix}…</span>
                    <Chip>{key.plan}</Chip>
                    {key.expiresAt ? (
                      <Chip tone="warn">expires {new Date(key.expiresAt).toLocaleDateString()}</Chip>
                    ) : null}
                    <span className="ml-auto font-mono text-[11.5px] tabular-nums text-ink-faint">
                      {key.callsTotal.toLocaleString()} calls · last used {ago(key.lastUsedAt)}
                    </span>
                    {key.note ? (
                      <p className="w-full text-[11.5px] leading-snug text-ink-faint">{key.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="border-t border-line-soft px-3 py-2 text-[11.5px] leading-snug text-ink-faint">
                Lost the key? It can&rsquo;t be shown again — it&rsquo;s stored as a hash. Ask the owner to
                revoke it and issue another.
                {view.revokedCount > 0
                  ? ` You've had ${view.revokedCount} key${view.revokedCount === 1 ? "" : "s"} revoked.`
                  : ""}
              </p>
            </Panel>

            <Panel title="Using it" hint="Send the key as a bearer token on every request">
              <div className="space-y-2 p-3">
                <Snippet
                  label="curl"
                  code={`curl -s "${view.endpoint}" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  --data '{"query":"hello","app":"my-app"}'`}
                />
                <Snippet
                  label="JavaScript"
                  code={`const r = await fetch("${view.endpoint}", {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${process.env.SEARCH_KEY}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({ query: "hello", app: "my-app" }),\n});\nconst { results } = await r.json();`}
                />
                <div>
                  <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
                    What you can ask for
                  </p>
                  <ul className="mt-1 space-y-1 text-[12px] leading-relaxed text-ink-muted">
                    <li>
                      <code className="font-mono text-ink-faint">/api/search</code> — general web search
                    </li>
                    <li>
                      <code className="font-mono text-ink-faint">/api/search/news</code> — news, with
                      publication dates
                    </li>
                    <li>
                      <code className="font-mono text-ink-faint">/api/search/research</code> — more
                      results, several pages deep
                    </li>
                    <li>
                      <code className="font-mono text-ink-faint">/api/search/extract</code> — read pages
                      and get their text
                    </li>
                  </ul>
                  <p className="mt-2 text-[11.5px] leading-snug text-ink-faint">
                    Add <code className="font-mono">&quot;extract&quot;: 3</code> to a search and the top
                    three results come back with the pages read — that&rsquo;s what makes the results
                    usable by a model rather than a person. Always send{" "}
                    <code className="font-mono">&quot;app&quot;</code> so your calls are grouped by what
                    made them.
                  </p>
                </div>
              </div>
            </Panel>

            {view.isOwner ? (
              <p className="text-center text-[11.5px] text-ink-faint">
                You&rsquo;re the owner —{" "}
                <Link href="/apps/search-infrastructure" className="text-[#a5b4fc] hover:underline">
                  the full console is here
                </Link>
                .
              </p>
            ) : null}
          </>
        ) : null}

      </div>
    </div>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <pre className="mt-0.5 overflow-x-auto rounded-md border border-line bg-canvas p-2 font-mono text-[11.5px] leading-relaxed text-ink-muted">
        {code}
      </pre>
    </div>
  );
}
