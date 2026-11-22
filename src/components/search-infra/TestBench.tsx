// ---------------------------------------------------------------------------
// The test bench: run a real search and see exactly what happened.
//
// This is the page's working surface. It calls the same public endpoint every
// app calls — no private path, no shortcut — so what it shows is what an app
// would get. The attempts come back with it, which is what drives the rail
// above, and pinning a provider is how you find out whether the VPS really is
// up rather than watching the chain quietly route around it.
// ---------------------------------------------------------------------------

"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Play } from "lucide-react";
import type { SearchKind, SearchResponse } from "@/lib/search/types";
import { Button, Chip, Empty, Panel, STATE, ms } from "./shared";

const KINDS: { value: SearchKind; label: string; hint: string }[] = [
  { value: "web", label: "Web", hint: "10 results, snippets only" },
  { value: "news", label: "News", hint: "news category, dates on most rows" },
  { value: "research", label: "Research", hint: "20 results, several pages, advanced depth on Tavily" },
];

export function TestBench({
  providers,
  onResult,
}: {
  providers: { provider: string; label: string; configured: boolean }[];
  onResult: (response: SearchResponse | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind>("web");
  const [pinned, setPinned] = useState("");
  const [extract, setExtract] = useState(0);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const pinnable = [...new Map(providers.filter((p) => p.configured).map((p) => [p.provider, p])).values()];

  async function run() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const path = kind === "web" ? "/api/search" : `/api/search/${kind}`;
      const result = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          extract: extract > 0 ? extract : undefined,
          provider: pinned || undefined,
          noCache: fresh,
          app: "search-infrastructure-bench",
        }),
      });
      const payload = (await result.json()) as SearchResponse & { error?: string; attempts?: unknown };
      if (!result.ok) {
        setError(payload.error ?? `The service returned ${result.status}.`);
        setResponse(null);
        // A failure still carries attempts, and the rail should show them —
        // seeing WHICH provider refused is the whole value of a failed test.
        onResult(
          payload.attempts
            ? ({ ...payload, results: [], attempts: payload.attempts } as unknown as SearchResponse)
            : null,
        );
        return;
      }
      setResponse(payload);
      onResult(payload);
      setOpen(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed.");
      setResponse(null);
      onResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Test bench"
      hint="Calls the same public endpoint your apps call"
      actions={
        <Button variant="primary" onClick={run} disabled={busy || !query.trim()}>
          <Play size={11} aria-hidden /> {busy ? "Searching…" : "Search"}
        </Button>
      }
    >
      <div className="border-b border-line-soft p-3">
        <label className="block">
          <span className="sr-only">Query</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void run();
            }}
            placeholder="Ask it something — the chain above will show which provider answered"
            className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 font-mono text-[12px] text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
          />
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
            {KINDS.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.hint}
                onClick={() => setKind(option.value)}
                className={`rounded-[4px] px-2 py-[2px] text-[10.5px] font-medium tracking-wide transition max-sm:min-h-[32px] max-sm:px-3 ${
                  kind === option.value ? "bg-brand-2 text-white" : "text-ink-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
            Read pages
            <select
              value={extract}
              onChange={(event) => setExtract(Number(event.target.value))}
              className="rounded-[4px] border border-line bg-canvas px-1.5 py-[2px] font-mono text-[11.5px] text-ink max-sm:min-h-[32px]"
            >
              <option value={0}>none</option>
              <option value={3}>top 3</option>
              <option value={5}>top 5</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
            Provider
            <select
              value={pinned}
              onChange={(event) => setPinned(event.target.value)}
              className="rounded-[4px] border border-line bg-canvas px-1.5 py-[2px] font-mono text-[11.5px] text-ink max-sm:min-h-[32px]"
            >
              <option value="">auto (the chain)</option>
              {pinnable.map((option) => (
                <option key={option.provider} value={option.provider}>
                  {option.provider} only
                </option>
              ))}
            </select>
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-muted max-sm:min-h-[32px]">
            <input
              type="checkbox"
              checked={fresh}
              onChange={(event) => setFresh(event.target.checked)}
              className="h-3 w-3 accent-[#4f46e5] max-sm:h-4 max-sm:w-4"
            />
            Skip cache
          </label>
        </div>
      </div>

      {error ? (
        <p className="border-b border-line-soft bg-[#1c1216] px-3 py-2 text-[12px] leading-snug text-[#f87171]">
          {error}
        </p>
      ) : null}

      {response ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft bg-panel-2 px-3 py-1.5 text-[11.5px]">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-[7px] w-[7px] rounded-full"
                style={{ background: response.cached ? STATE.cached : STATE.live }}
              />
              <span className="text-ink">
                {response.cached ? `from cache (${response.cacheAge}s old)` : `served by ${response.provider}`}
              </span>
            </span>
            <span className="font-mono tabular-nums text-ink-faint">{ms(response.ms)}</span>
            <span className="font-mono tabular-nums text-ink-faint">{response.results.length} results</span>
            {response.degraded ? <Chip tone="warn">fell back</Chip> : null}
            {response.endpoint ? (
              <span className="truncate font-mono text-ink-faint">{response.endpoint}</span>
            ) : null}
          </div>

          {response.answer ? (
            <p className="border-b border-line-soft px-3 py-2 text-[13px] leading-relaxed text-ink">
              <span className="mr-1.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
                Answer
              </span>
              {response.answer}
            </p>
          ) : null}

          <ol className="divide-y divide-line-soft">
            {response.results.map((result, index) => (
              <li key={`${result.url}-${index}`} className="px-3 py-2">
                <div className="flex items-start gap-2">
                  <span className="mt-[3px] w-5 shrink-0 font-mono text-[11.5px] tabular-nums text-ink-faint">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-start gap-1 text-[13px] font-medium leading-snug text-ink hover:text-[#a5b4fc]"
                    >
                      {result.title}
                      <ExternalLink size={10} className="mt-1 shrink-0 opacity-50" aria-hidden />
                    </a>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11.5px] text-ink-faint">
                      <span className="truncate">{result.source}</span>
                      {result.publishedAt ? <span>{result.publishedAt.slice(0, 10)}</span> : null}
                      {result.score !== null ? <span>score {result.score.toFixed(2)}</span> : null}
                    </p>
                    {result.description ? (
                      <p className="mt-1 text-[12px] leading-snug text-ink-muted">{result.description}</p>
                    ) : null}

                    {result.content ? (
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={() => setOpen(open === index ? null : index)}
                          className="inline-flex items-center gap-1 py-1 text-[11.5px] text-ink-muted hover:text-ink max-sm:min-h-[32px]"
                        >
                          {open === index ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                          {result.content.error
                            ? "couldn't read the page"
                            : `${result.content.words.toLocaleString()} words read`}
                        </button>
                        {open === index ? (
                          <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-canvas p-2 font-mono text-[11.5px] leading-relaxed text-ink-muted">
                            {result.content.error ?? result.content.text}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : error ? null : (
        <Empty>Type a query and press Search. The chain above will light up with the path it took.</Empty>
      )}
    </Panel>
  );
}
