// ---------------------------------------------------------------------------
// Search Infrastructure — the console for the hub's one search service.
//
// Reads only the service's own public endpoints, so this page is a client of
// the thing it monitors rather than a privileged view into it. If the page can
// see it, an app can see it.
//
// Layout follows the hub's own register: a thin header strip, the routing rail
// as the one standout, then dense panels. No card grid, no shadows.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Database, RefreshCw, Trash2 } from "lucide-react";
import type { ServiceKeyRow, UsageSummary } from "@/lib/search/store";
import type { ProviderStatus, SearchResponse } from "@/lib/search/types";
import { KeysPanel } from "./KeysPanel";
import { RoutingRail } from "./RoutingRail";
import { TestBench } from "./TestBench";
import { UsagePanel } from "./UsagePanel";
import { Button, Chip, Dot, Panel, STATE, Spinner, ago } from "./shared";

interface ProvidersReport {
  probed: boolean;
  configured: boolean;
  chain: { provider: string; endpoint: string | null; location: string | null; label: string }[];
  providers: ProviderStatus[];
  storage: { shared: boolean; detail: string };
  env: { name: string; unlocks: string; required: boolean; set: boolean }[];
  checkedAt: string;
}

export function SearchInfraApp() {
  const [report, setReport] = useState<ProvidersReport | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [keys, setKeys] = useState<ServiceKeyRow[]>([]);
  const [keyDefaults, setKeyDefaults] = useState({ perMinute: 60, perDay: 2000 });
  const [hours, setHours] = useState(24);
  const [probing, setProbing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<SearchResponse | null>(null);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      const response = await fetch("/api/search/providers", { cache: "no-store" });
      const payload = (await response.json()) as ProvidersReport & { error?: string };
      if (!response.ok) {
        setLoadError(payload.error ?? `The service returned ${response.status}.`);
        return;
      }
      setReport(payload);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Couldn't reach the search service.");
    }
  }, []);

  const loadUsage = useCallback(async (window: number) => {
    try {
      const response = await fetch(`/api/search/usage?hours=${window}`, { cache: "no-store" });
      if (!response.ok) return;
      setUsage((await response.json()) as UsageSummary);
    } catch {
      /* The usage panel shows its own empty state. */
    }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/search/keys", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        keys: ServiceKeyRow[];
        defaults: { perMinute: number; perDay: number };
      };
      setKeys(payload.keys ?? []);
      if (payload.defaults) setKeyDefaults(payload.defaults);
    } catch {
      /* The keys panel says so itself when storage is missing. */
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    void loadKeys();
  }, [loadProviders, loadKeys]);

  useEffect(() => {
    void loadUsage(hours);
  }, [hours, loadUsage]);

  // A slow poll, because this is a page someone leaves open. Free: it reads
  // what the last real searches learned and probes nothing.
  useEffect(() => {
    const timer = setInterval(() => {
      void loadProviders();
      void loadUsage(hours);
    }, 30_000);
    return () => clearInterval(timer);
  }, [hours, loadProviders, loadUsage]);

  async function probe() {
    setProbing(true);
    setNotice(null);
    try {
      const response = await fetch("/api/search/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Tavily's probe costs a credit, so it is not part of a routine check.
        body: JSON.stringify({ probeTavily: false }),
      });
      const payload = (await response.json()) as ProvidersReport & { error?: string };
      if (!response.ok) {
        setLoadError(payload.error ?? `The probe returned ${response.status}.`);
        return;
      }
      setReport(payload);
      setNotice("Probed every self-hosted instance. Tavily wasn't probed — its health check costs a credit.");
    } finally {
      setProbing(false);
    }
  }

  async function clearCache() {
    if (!window.confirm("Empty the search cache? Every caller re-runs its next search against a provider.")) {
      return;
    }
    setClearing(true);
    try {
      const response = await fetch("/api/search/cache", { method: "DELETE" });
      const payload = (await response.json()) as { dropped?: number; error?: string };
      setNotice(
        response.ok
          ? `Cache emptied — ${payload.dropped ?? 0} entries dropped.`
          : (payload.error ?? "Clearing the cache failed."),
      );
      void loadUsage(hours);
    } finally {
      setClearing(false);
    }
  }

  const serving = report?.providers.find((provider) => provider.state === "up") ?? null;
  const broken = report?.providers.filter((p) => p.state === "down" || p.state === "open") ?? [];
  const servedBy = lastRun ? `${lastRun.provider}:${lastRun.endpoint ?? "default"}` : null;

  return (
    <div
      className="min-h-dvh bg-canvas pb-10"
      /*
       * `ink-faint` is rebound for this page only.
       *
       * The hub's token is #6b7385, which measures 3.4–4.1:1 against the four
       * surfaces — under WCAG AA for the 11.5px text this page is mostly made
       * of, and the design check counts 45 pieces of it at phone width. #838c9e
       * is the lightest value that clears 4.5:1 on all four (4.75:1 at worst,
       * on `elevated`), so the three-tone hierarchy survives instead of being
       * flattened into ink/ink-muted.
       *
       * Scoped here rather than changed in globals.css on purpose: the same
       * weakness exists hub-wide, and fixing it for every app is its own change
       * with its own screenshots, not a side effect of shipping this one.
       */
      style={{ ["--color-ink-faint" as string]: "#838c9e" }}
    >
      {/* Header strip */}
      <header className="sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11.5px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            <ArrowLeft size={11} aria-hidden /> Hub
          </Link>

          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold leading-tight text-ink">
              Search Infrastructure
            </h1>
            <p className="truncate text-[11.5px] text-ink-faint">
              One search endpoint for every Jarvis app and agent
            </p>
          </div>

          <div className="ml-auto flex items-center gap-x-3 gap-y-1">
            {report ? (
              <span className="hidden items-center gap-1.5 text-[11.5px] sm:flex">
                <Dot color={serving ? STATE.up : broken.length > 0 ? STATE.failed : STATE.waiting} />
                <span className="text-ink-muted">
                  {serving
                    ? `serving from ${serving.location === "laptop" ? "this machine" : serving.location === "vps" ? "the VPS" : "the cloud"}`
                    : report.configured
                      ? "no provider answering"
                      : "not configured"}
                </span>
              </span>
            ) : (
              <Spinner />
            )}
            <Button variant="outline" onClick={probe} disabled={probing}>
              <RefreshCw size={11} aria-hidden className={probing ? "animate-spin" : ""} />
              {probing ? "Checking…" : "Check now"}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-3 py-3 sm:px-4">
        {loadError ? (
          <p className="rounded-[10px] border border-[#ef4444]/40 bg-[#1c1216] px-3 py-2 text-[12px] leading-snug text-[#f87171]">
            {loadError}
          </p>
        ) : null}
        {notice ? (
          <p className="flex items-start gap-2 rounded-[10px] border border-line bg-panel px-3 py-2 text-[12px] leading-snug text-ink-muted">
            <span className="min-w-0 flex-1">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 rounded px-2 py-1 text-ink-faint hover:bg-elevated hover:text-ink max-sm:min-h-[32px]"
            >
              dismiss
            </button>
          </p>
        ) : null}

        {/* ---- The standout ---- */}
        <Panel
          title="The chain"
          hint={report ? `Checked ${ago(report.checkedAt)}` : undefined}
          actions={
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-faint">
              <Database size={11} aria-hidden />
              <span className="hidden sm:inline">{report?.storage.shared ? "shared storage" : "in-memory only"}</span>
            </span>
          }
        >
          <RoutingRail
            providers={report?.providers ?? []}
            attempts={lastRun?.attempts}
            servedBy={servedBy}
            loading={report === null && loadError === null}
          />
        </Panel>

        {/* ---- Test bench ---- */}
        <TestBench
          providers={
            report?.providers.map((provider) => ({
              provider: provider.provider,
              label: provider.label,
              configured: provider.configured,
            })) ?? []
          }
          onResult={(response) => {
            setLastRun(response);
            void loadUsage(hours);
            void loadProviders();
          }}
        />

        {/* ---- Usage ---- */}
        <UsagePanel usage={usage} hours={hours} onHours={setHours} />

        {/* ---- Keys ---- */}
        <KeysPanel
          keys={keys}
          storageShared={report?.storage.shared ?? false}
          defaults={keyDefaults}
          onChange={loadKeys}
        />

        {/* ---- Setup ---- */}
        <Panel
          title="Setup"
          hint="What's wired, what isn't, and what each one buys"
          actions={
            <Button variant="outline" onClick={clearCache} disabled={clearing}>
              <Trash2 size={11} aria-hidden /> {clearing ? "Clearing…" : "Empty cache"}
            </Button>
          }
        >
          <ul className="divide-y divide-line-soft">
            {(report?.env ?? []).map((entry) => (
              <li key={entry.name} className="flex items-start gap-2.5 px-3 py-2">
                <span className="mt-[5px]">
                  <Dot color={entry.set ? STATE.up : entry.required ? STATE.failed : STATE.waiting} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-ink">
                    {entry.name}
                    {entry.set ? (
                      <Chip tone="good">set</Chip>
                    ) : entry.required ? (
                      <Chip tone="bad">required</Chip>
                    ) : (
                      <Chip tone="warn">optional</Chip>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">{entry.unlocks}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line-soft px-3 py-2 text-[11.5px] leading-snug text-ink-faint">
            {report?.storage.detail}
          </p>
          <p className="border-t border-line-soft px-3 py-2 text-[11.5px] leading-snug text-ink-faint">
            Full setup, the SearXNG install for the VPS and this machine, and the API reference are in{" "}
            <code className="font-mono text-ink-muted">docs/search-api.md</code> and{" "}
            <code className="font-mono text-ink-muted">infra/searxng/README.md</code>.
          </p>
        </Panel>
      </div>
    </div>
  );
}
