"use client";

// Connected apps. Hub apps are connected automatically (anything in the
// catalog). Outside websites register here, get a key shown exactly once,
// and file tasks through POST /api/queue247/v1/tasks with that key.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { getJson, postJson } from "@/lib/queue247/useQueue247";
import type { QueueApp } from "@/lib/queue247/types";
import { relTime } from "@/lib/queue247/view";
import { CopyButton, Empty, Notice } from "./parts";
import { Field } from "./TaskDrawer";

interface KnownApp {
  id: string;
  name: string;
  source: "hub" | "external";
  description: string;
  executors: string[];
  url: string | null;
}

interface AppKey {
  id: string;
  app_id: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface AppsResponse {
  apps: KnownApp[];
  external: QueueApp[];
  keys: AppKey[];
}

export function AppsPanel({ now }: { now: Date }) {
  const [data, setData] = useState<AppsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ app: string; key: string } | null>(null);
  const [hubQ, setHubQ] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getJson<AppsResponse>("/api/queue247/apps"));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (body: Record<string, unknown>) => {
    setErr(null);
    try {
      const r = await postJson<{ key?: string; app?: { id: string } }>("/api/queue247/apps", body);
      if (r.key) setFresh({ app: String(r.app?.id ?? body.id ?? ""), key: r.key });
      await load();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  };

  const hub = useMemo(() => {
    const list = (data?.apps ?? []).filter((a) => a.source === "hub");
    const w = hubQ.trim().toLowerCase();
    return w ? list.filter((a) => `${a.name} ${a.id} ${a.description}`.toLowerCase().includes(w)) : list;
  }, [data, hubQ]);

  const origin = typeof window === "undefined" ? "https://your-hub" : window.location.origin;
  const curl = `curl -X POST ${origin}/api/queue247/v1/tasks \\
  -H "Authorization: Bearer q247_…" \\
  -H "content-type: application/json" \\
  -d '{"title":"Check my store for broken links","executor":"monitor","kind":"continuous","schedule":{"everyMinutes":60}}'`;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <section className="q-glass">
          <header className="flex flex-wrap items-center gap-2 border-b border-[var(--q-line-soft)] px-3 py-2">
            <h3 className="q-label text-[var(--q-ink)]">Outside apps</h3>
            <span className="text-[11px] text-[var(--q-faint)]" data-num>
              {data?.external.length ?? 0}
            </span>
            <span className="flex-1" />
            <button type="button" className="q-btn" onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
              <Icon.Plus width={12} height={12} aria-hidden /> Connect an app
            </button>
          </header>
          <div className="px-3 py-2">
            <Notice text={err} onDismiss={() => setErr(null)} />
          </div>
          {fresh && (
            <div className="q-gate mx-3 mb-3 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--q-needs)]">Copy this key now — it is not shown again</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded border border-[var(--q-line)] bg-[var(--q-canvas)] px-2 py-1 font-mono text-[11.5px] text-[var(--q-ink)]">{fresh.key}</code>
                <CopyButton text={fresh.key} />
              </div>
              <p className="mt-1.5 text-[11.5px] text-[var(--q-muted)]">
                Key for <span className="font-mono">{fresh.app}</span>. Store it in that app&apos;s server settings, never in a web page.{" "}
                <button type="button" className="underline underline-offset-2 hover:text-[var(--q-ink)]" onClick={() => setFresh(null)}>
                  I&apos;ve saved it
                </button>
              </p>
            </div>
          )}
          {showForm && <RegisterForm onSubmit={async (b) => (await run({ action: "register", ...b })) && setShowForm(false)} />}
          {!data ? (
            <div className="flex flex-col gap-2 px-3 pb-3">
              <div className="q-skel h-8" />
              <div className="q-skel h-8" />
            </div>
          ) : data.external.length === 0 ? (
            <Empty title="No outside apps yet.">Connect a website you run elsewhere and it can hand work to your agents and get results back.</Empty>
          ) : (
            <ul>
              {data.external.map((a) => (
                <ExternalRow key={a.id} app={a} keys={data.keys.filter((k) => k.app_id === a.id)} now={now} run={run} />
              ))}
            </ul>
          )}
        </section>

        <section className="q-glass">
          <header className="border-b border-[var(--q-line-soft)] px-3 py-2">
            <h3 className="q-label text-[var(--q-ink)]">How an app connects</h3>
          </header>
          <div className="flex flex-col gap-2 px-3 py-3 text-[12.5px] leading-relaxed text-[var(--q-muted)]">
            <p>An outside app files a task with its key. Updates about that task are POSTed back to its callback URL when it has one.</p>
            <div className="relative">
              <pre className="overflow-x-auto rounded-md border border-[var(--q-line-soft)] bg-[var(--q-canvas)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--q-ink)]">{curl}</pre>
              <div className="absolute right-1.5 top-1.5">
                <CopyButton text={curl} />
              </div>
            </div>
            <p>
              The full reference — every field, status and callback — is in <code className="font-mono text-[11.5px] text-[var(--q-ink)]">docs/queue-247-api.md</code> in the hub repository.
            </p>
          </div>
        </section>
      </div>

      <section className="q-glass min-w-0">
        <header className="flex flex-wrap items-center gap-2 border-b border-[var(--q-line-soft)] px-3 py-2">
          <h3 className="q-label text-[var(--q-ink)]">Hub apps</h3>
          <span className="text-[11px] text-[var(--q-faint)]" data-num>
            {(data?.apps ?? []).filter((a) => a.source === "hub").length}
          </span>
          <span className="text-[11px] text-[var(--q-faint)]">connected automatically</span>
          <input className="q-field ml-auto w-[160px] py-1 text-[12px]" value={hubQ} onChange={(e) => setHubQ(e.target.value)} placeholder="Find an app…" aria-label="Find a hub app" />
        </header>
        <ul className="q-scroll max-h-[520px] overflow-y-auto">
          {hub.map((a) => (
            <li key={a.id} className="border-t border-[var(--q-line-soft)] px-3 py-2 first:border-t-0">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[12.5px] text-[var(--q-ink)]">{a.name}</span>
                <span className="truncate font-mono text-[10.5px] text-[var(--q-faint)]">{a.id}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {a.executors.map((x) => (
                  <span key={x} className="rounded border border-[var(--q-line)] px-1 font-mono text-[10px] text-[var(--q-muted)]">
                    {x}
                  </span>
                ))}
              </div>
            </li>
          ))}
          {data && !hub.length && <li className="px-3 py-3 text-[12px] text-[var(--q-muted)]">No hub app matches.</li>}
        </ul>
      </section>
    </div>
  );
}

function ExternalRow({ app, keys, now, run }: { app: QueueApp; keys: AppKey[]; now: Date; run: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const live = keys.filter((k) => !k.revoked_at);
  return (
    <li className="border-t border-[var(--q-line-soft)] px-3 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13px] font-medium text-[var(--q-ink)]">{app.name}</span>
            <span className="font-mono text-[10.5px] text-[var(--q-faint)]">{app.id}</span>
          </div>
          {app.description && <p className="mt-0.5 text-[12px] text-[var(--q-muted)]">{app.description}</p>}
          <p className="mt-0.5 text-[11px] text-[var(--q-faint)]">
            {app.last_seen_at ? `Last called ${relTime(app.last_seen_at, now)}` : "Has not called yet"}
            {app.callback_url ? " · sends updates back" : ""}
            {app.url ? ` · ${app.url.replace(/^https?:\/\//, "")}` : ""}
          </p>
        </div>
        <button type="button" className="q-btn h-7 min-h-0" onClick={() => run({ action: "new_key", id: app.id })}>
          <Icon.Key width={11} height={11} aria-hidden /> New key
        </button>
        <button
          type="button"
          className={`q-btn h-7 min-h-0 ${confirm === "remove" ? "q-btn-confirm" : "q-btn-danger"}`}
          onClick={() => (confirm === "remove" ? run({ action: "remove", id: app.id }) : setConfirm("remove"))}
          onBlur={() => setConfirm(null)}
        >
          {confirm === "remove" ? "Disconnect — sure?" : "Disconnect"}
        </button>
      </div>
      {keys.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-2 text-[11.5px]">
              <Icon.Key width={11} height={11} className={k.revoked_at ? "text-[var(--q-faint)]" : "text-[var(--q-muted)]"} aria-hidden />
              <code className={`font-mono ${k.revoked_at ? "text-[var(--q-faint)] line-through" : "text-[var(--q-ink)]"}`}>{k.prefix}…</code>
              <span className="text-[var(--q-faint)]">{k.revoked_at ? `revoked ${relTime(k.revoked_at, now)}` : k.last_used_at ? `used ${relTime(k.last_used_at, now)}` : "never used"}</span>
              {!k.revoked_at && (
                <button
                  type="button"
                  className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${confirm === k.id ? "bg-[color-mix(in_oklab,var(--q-fail-fill)_82%,black)] text-white" : "text-[var(--q-muted)] hover:text-[var(--q-fail)]"}`}
                  onClick={() => (confirm === k.id ? run({ action: "revoke", keyId: k.id }) : setConfirm(k.id))}
                  onBlur={() => setConfirm(null)}
                >
                  {confirm === k.id ? "Revoke — sure?" : "Revoke"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {live.length === 0 && keys.length > 0 && <p className="mt-1 text-[11px] text-[var(--q-needs)]">Every key is revoked — this app cannot file tasks until you make a new one.</p>}
    </li>
  );
}

function RegisterForm({ onSubmit }: { onSubmit: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [caps, setCaps] = useState("");
  const [callback, setCallback] = useState("");
  const [saving, setSaving] = useState(false);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return (
    <form
      className="mx-3 mb-3 flex flex-col gap-2 rounded-lg border border-[var(--q-line)] bg-[var(--q-panel-2)] p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSubmit({
          id: id || slug(name),
          name,
          url: url || undefined,
          description,
          capabilities: caps.split(",").map((c) => c.trim()).filter(Boolean),
          callback_url: callback || undefined,
        });
        setSaving(false);
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Name">
          <input
            className="q-field"
            value={name}
            required
            onChange={(e) => {
              setName(e.target.value);
              if (!idTouched) setId(slug(e.target.value));
            }}
            placeholder="My online store"
          />
        </Field>
        <Field label="App id" hint="Lowercase letters, numbers and dashes.">
          <input
            className="q-field font-mono"
            value={id}
            onChange={(e) => {
              setIdTouched(true);
              setId(slug(e.target.value));
            }}
            placeholder="my-online-store"
          />
        </Field>
      </div>
      <Field label="Website (optional)">
        <input className="q-field" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://store.example.com" />
      </Field>
      <Field label="What it does (optional)">
        <input className="q-field" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="What it can ask for (optional)" hint="Comma-separated, in your own words.">
        <input className="q-field" value={caps} onChange={(e) => setCaps(e.target.value)} placeholder="price monitoring, product research" />
      </Field>
      <Field label="Callback URL (optional)" hint="Task updates are POSTed here.">
        <input className="q-field" type="url" value={callback} onChange={(e) => setCallback(e.target.value)} placeholder="https://store.example.com/api/queue-updates" />
      </Field>
      <div>
        <button type="submit" className="q-btn q-btn-primary" disabled={saving || !name.trim()}>
          {saving ? "Connecting…" : "Connect and make a key"}
        </button>
      </div>
    </form>
  );
}
