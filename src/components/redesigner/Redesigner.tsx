"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Direction, RedesignResult } from "@/lib/redesigner/engine";
import { Icon } from "../icons";

const SAMPLES = ["stripe.com", "linear.app", "vercel.com"];

export function Redesigner() {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [ownSite, setOwnSite] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RedesignResult | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!url.trim()) {
      setError("Paste a URL to redesign.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/redesign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          description: description.trim() || undefined,
          ownSite,
          sourcePath: ownSite ? sourcePath.trim() || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      if (!data?.directions?.length) throw new Error("No redesign directions came back. Try another URL.");
      setResult(data as RedesignResult);
    } catch (err) {
      setError((err as Error).message || "Something went wrong generating the redesign.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="ml-1 text-sm font-semibold text-ink">Website Redesigner</span>
        <span className="ml-2 rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
          URL → Redesign
        </span>
      </div>

      {/* Aurora header */}
      <header className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70 motion-reduce:opacity-40"
          style={{
            background:
              "radial-gradient(60% 120% at 15% 0%, rgba(139,92,246,0.28), transparent 60%)," +
              "radial-gradient(50% 120% at 85% 10%, rgba(59,130,246,0.18), transparent 55%)," +
              "radial-gradient(60% 140% at 60% 120%, rgba(236,72,153,0.16), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Redesign any site, keep what it does
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Paste a URL. Get three redesign directions — each driven by a design skill and named a
            real site to beat — plus a paste-ready build prompt that rebuilds it with the same
            functionality.
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          {/* Form */}
          <form
            onSubmit={run}
            className="rounded-2xl border border-line bg-panel p-4"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                inputMode="url"
                className="flex-1 rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
              <button
                type="submit"
                disabled={loading}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? <Spinner /> : <Icon.Sparkles width={15} height={15} />}
                {loading ? "Designing…" : "Redesign"}
              </button>
            </div>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional: what is this site, and anything you want the redesign to nail? (helps a lot for JS-heavy sites)"
              className="mt-2 w-full resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
            />

            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="inline-flex cursor-pointer items-center gap-2 text-ink-muted">
                <input
                  type="checkbox"
                  checked={ownSite}
                  onChange={(e) => setOwnSite(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand"
                />
                This is my own site
              </label>
              {ownSite && (
                <input
                  value={sourcePath}
                  onChange={(e) => setSourcePath(e.target.value)}
                  placeholder="source path / repo (so the rebuild edits real code)"
                  className="h-9 flex-1 rounded-lg border border-line bg-canvas px-2.5 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              )}
            </div>
          </form>

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {!result && !loading && !error && (
            <div className="mt-6 flex flex-wrap items-center gap-2 text-sm text-ink-faint">
              <span>Try:</span>
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  onClick={() => setUrl(s)}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-3 py-1 transition hover:border-brand/40 hover:text-ink"
                >
                  {s}
                  <Icon.Launch width={11} height={11} />
                </button>
              ))}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="mt-8 animate-fade-in">
              <AnalysisPanel result={result} />
              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                {result.directions.map((d) => (
                  <DirectionCard key={d.id} direction={d} />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function AnalysisPanel({ result }: { result: RedesignResult }) {
  const { analysis, engine } = result;
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{analysis.title}</h2>
        <div className="flex items-center gap-2">
          {analysis.confidence === "low" && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] text-amber-300">
              thin scrape — add a description for a better result
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              engine === "ai" ? "bg-brand/15 text-brand" : "bg-panel-2 text-ink-faint",
            )}
          >
            <Icon.Sparkles width={10} height={10} />
            {engine === "ai" ? "AI" : "Offline draft"}
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{analysis.summary}</p>

      {analysis.functionality.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Functionality to preserve
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {analysis.functionality.map((f, i) => (
              <span
                key={i}
                title={f.detail}
                className="rounded-full border border-line bg-panel-2 px-2.5 py-0.5 text-[11px] text-ink-muted"
              >
                {f.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DirectionCard({ direction }: { direction: Direction }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(direction.buildPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can expand and copy manually */
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div
        className="relative flex h-28 flex-col justify-end p-3"
        style={{
          background: `linear-gradient(135deg, ${direction.palette[0] ?? "#111"} 0%, ${
            direction.palette[1] ?? direction.palette[0] ?? "#222"
          } 100%)`,
        }}
      >
        <span
          className="text-xl font-bold leading-none"
          style={{ color: direction.palette[2] ?? "#fff" }}
        >
          {direction.name}
        </span>
        <div className="mt-2 flex gap-1.5">
          {direction.palette.map((c) => (
            <span key={c} className="h-4 w-4 rounded-full ring-1 ring-white/20" style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <p className="text-sm text-ink-muted">{direction.pitch}</p>

        <div className="mt-2.5 space-y-1 text-xs text-ink-faint">
          <Row label="Skill">
            <span className="rounded bg-brand/15 px-1.5 py-0.5 font-mono text-[11px] text-brand">
              {direction.drivingSkill}
            </span>
          </Row>
          <Row label="Type">
            {direction.typography.heading} · {direction.typography.body}
          </Row>
          {direction.referenceBar && <Row label="Beat">{direction.referenceBar}</Row>}
        </div>

        {(direction.layout || direction.motion) && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-faint">
            {direction.layout} {direction.motion}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={copy}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2"
          >
            {copied ? <Icon.Check width={13} height={13} /> : <Icon.Copy width={13} height={13} />}
            {copied ? "Copied" : "Copy build prompt"}
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Collapse" : "Expand"}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Chevron width={14} height={14} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        </div>

        {open && (
          <pre className="mt-2.5 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-[11px] leading-relaxed text-ink-muted">
            {direction.buildPrompt}
          </pre>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-9 shrink-0 text-ink-faint/70">{label}</span>
      <span className="text-ink-muted">{children}</span>
    </div>
  );
}

function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}
