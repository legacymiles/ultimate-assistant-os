"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { AnalyzeLink } from "./AnalyzeLink";
import { InboxPanel } from "./InboxPanel";
import { ModelSheet } from "./ModelSheet";
import { Flag, ModelFlags, RankMark, ScoreBar, SlideOver, Toggle } from "./parts";
import * as oldStore from "@/lib/ai-rankings/store";
import { fromOldBoard } from "@/lib/ai-rankings/fromOldBoard";
import {
  CATEGORIES,
  FAMILIES,
  NO_FILTERS,
  categoryFromLabel,
  categoryOf,
  filterModels,
  filtersActive,
  hiddenReason,
  isFresh,
  justDropped,
  openStanding,
  rankAll,
  releasedLabel,
  topRanked,
  topRowsWithGaps,
} from "@/lib/ai-rankings/leaderboard";
import type { BoardFilters, InboxItem, Model, RankedModel, ReleasedWithin } from "@/lib/ai-rankings/leaderboard";
import type { BoardAction } from "@/lib/ai-rankings/boardActions";
import type { AnalyzeResult } from "@/lib/ai-rankings/analyzeLink";

type Status = "loading" | "ready" | "error";
interface SheetState {
  id?: string;
  draft?: Partial<Model>;
  edit?: boolean;
}

const RELEASED: { id: ReleasedWithin; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
];

const IMPORT_DISMISSED_KEY = "ai-rankings:import-dismissed";

// ----- URL state: a category and its filters are a link you can share ---------------

function readUrl(): { category: string | null; filters: BoardFilters } {
  const p = new URLSearchParams(window.location.search);
  const c = p.get("c");
  const r = p.get("r");
  return {
    category: c && categoryOf(c) ? c : null,
    filters: {
      query: p.get("q") ?? "",
      openSource: p.get("open") === "1",
      runsLocally: p.get("local") === "1",
      free: p.get("free") === "1",
      released: r === "7" || r === "30" || r === "90" ? r : "any",
    },
  };
}

export function urlFor(category: string | null, f: BoardFilters): string {
  const p = new URLSearchParams();
  if (category) p.set("c", category);
  if (f.query.trim()) p.set("q", f.query.trim());
  if (f.openSource) p.set("open", "1");
  if (f.runsLocally) p.set("local", "1");
  if (f.free) p.set("free", "1");
  if (f.released !== "any") p.set("r", f.released);
  // Always "?…" (never ""), so an href is a real target rather than "this page".
  return `?${p.toString()}`;
}

function writeUrl(category: string | null, f: BoardFilters) {
  const qs = urlFor(category, f);
  window.history.replaceState(null, "", `${window.location.pathname}${qs === "?" ? "" : qs}`);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function hfIdFromUrl(url: string): string | undefined {
  const m = /huggingface\.co\/([\w.-]+\/[\w.-]+)/i.exec(url);
  return m && !/^(spaces|datasets|docs|blog)\//i.test(m[1]) ? m[1] : undefined;
}

// ----- the page -------------------------------------------------------------------------

export function Leaderboard() {
  const [now] = useState(() => Date.now());
  const [status, setStatus] = useState<Status>("loading");
  const [models, setModels] = useState<Model[]>([]);
  const [canEditRaw, setCanEdit] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [lastSweep, setLastSweep] = useState<{ at: string | null; note: string | null }>({ at: null, note: null });
  const [visitorPreview, setVisitorPreview] = useState(false);
  const canEdit = canEditRaw && !visitorPreview;

  const [category, setCategory] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  const [urlReady, setUrlReady] = useState(false);
  const [mobileList, setMobileList] = useState<"top" | "new">("top");

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sheetError, setSheetError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [busyInboxId, setBusyInboxId] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [flash, setFlash] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [oldBoard, setOldBoard] = useState<{ models: Partial<Model>[]; skipped: number } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const sheetGuard = useRef<(() => boolean) | null>(null);

  // ----- loading ----------------------------------------------------------------------

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/ai-rankings/board", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The leaderboard couldn't be loaded.");
      setModels(json.models ?? []);
      setCanEdit(Boolean(json.canEdit));
      setInbox(json.inbox ?? []);
      setLastSweep({ at: json.lastSweepAt ?? null, note: json.lastSweepNote ?? null });
      setStatus("ready");
    } catch (err) {
      setFlash({ text: err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't reach the server. Check your connection and retry.", tone: "error" });
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const u = readUrl();
    setCategory(u.category);
    setFilters(u.filters);
    setUrlReady(true);
    void load();
  }, [load]);

  // Debounced: this runs on every keystroke in the search box, and Safari
  // throws once replaceState is called too many times in a row.
  useEffect(() => {
    if (!urlReady) return;
    const t = setTimeout(() => writeUrl(category, filters), 150);
    return () => clearTimeout(t);
  }, [category, filters, urlReady]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.tone === "error" ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [flash]);

  // The old private board lives in this browser. Offer it once, to the owner.
  useEffect(() => {
    if (!canEditRaw || status !== "ready") return;
    try {
      if (window.localStorage.getItem(IMPORT_DISMISSED_KEY)) return;
      const old = fromOldBoard(oldStore.getData().tools);
      const fresh = old.models.filter(
        (m) => !models.some((x) => x.url === m.url || x.name.toLowerCase() === (m.name ?? "").toLowerCase()),
      );
      if (fresh.length) setOldBoard({ models: fresh, skipped: old.skipped });
    } catch {
      // No old board in this browser — nothing to offer.
    }
  }, [canEditRaw, status, models]);

  // "/" jumps to search, the way every leaderboard and docs site does it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // On a phone the rail scrolls sideways; keep the current category in view,
  // including when a shared link opens straight onto one.
  useEffect(() => {
    if (status !== "ready") return;
    document
      .querySelector('nav[aria-label="Categories"] [aria-current="page"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [category, status]);

  // ----- derived ------------------------------------------------------------------------

  const ranks = useMemo(() => rankAll(models), [models]);
  const filtered = useMemo(() => filterModels(models, filters, now), [models, filters, now]);
  const byCategory = useMemo(() => {
    const map = new Map<string, Model[]>();
    for (const m of filtered) map.set(m.category, [...(map.get(m.category) ?? []), m]);
    return map;
  }, [filtered]);
  const freshCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of models) if (isFresh(m, now)) map.set(m.category, (map.get(m.category) ?? 0) + 1);
    return map;
  }, [models, now]);
  const latestRelease = useMemo(() => models.reduce((d, m) => (m.releasedAt > d ? m.releasedAt : d), ""), [models]);

  const active = filtersActive(filters);
  const sheetRanked = sheet?.id ? ranks.get(sheet.id) ?? null : null;

  // ----- writes -------------------------------------------------------------------------

  async function send(action: BoardAction): Promise<{ ok: boolean; id?: string; error?: string; message?: string }> {
    try {
      const res = await fetch("/api/ai-rankings/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json.error ?? "That didn't save. Try again." };
      setModels(json.models);
      setInbox(json.inbox);
      return { ok: true, id: json.id, message: json.message };
    } catch {
      return { ok: false, error: "Couldn't reach the server, so nothing was saved. Try again." };
    }
  }

  const saveModel = async (model: Partial<Model>) => {
    setBusy(true);
    setSheetError("");
    const r = await send({ type: "upsert", model });
    setBusy(false);
    if (!r.ok) return setSheetError(r.error ?? "");
    setFlash({ text: r.message ?? "Saved", tone: "ok" });
    setSheet(r.id ? { id: r.id } : null);
  };

  const deleteModel = async (id: string) => {
    setBusy(true);
    const r = await send({ type: "delete", id });
    setBusy(false);
    if (!r.ok) return setSheetError(r.error ?? "");
    setFlash({ text: r.message ?? "Removed", tone: "ok" });
    setSheet(null);
  };

  const rate = async (id: string, rating: number | null) => {
    setBusy(true);
    const r = await send({ type: "rate", id, myRating: rating });
    setBusy(false);
    if (!r.ok) setFlash({ text: r.error ?? "", tone: "error" });
  };

  const approve = async (inboxId: string, cat: string) => {
    setBusyInboxId(inboxId);
    const r = await send({ type: "approve", inboxId, category: cat });
    setBusyInboxId(null);
    setFlash(r.ok ? { text: `${r.message}. Open it to add a summary and score.`, tone: "ok" } : { text: r.error ?? "", tone: "error" });
  };

  const dismiss = async (inboxId: string) => {
    setBusyInboxId(inboxId);
    const r = await send({ type: "dismiss", inboxId });
    setBusyInboxId(null);
    if (!r.ok) setFlash({ text: r.error ?? "", tone: "error" });
  };

  const dismissAll = async () => {
    const r = await send({ type: "dismissAll" });
    setFlash(r.ok ? { text: r.message ?? "", tone: "ok" } : { text: r.error ?? "", tone: "error" });
  };

  const sweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch("/api/ai-rankings/sweep", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The check failed. Try again.");
      setInbox(json.inbox);
      // Refreshed scores change the ranks, so the board is replaced too
      // rather than waiting for the next load.
      if (Array.isArray(json.models)) setModels(json.models);
      setLastSweep({ at: json.lastSweepAt, note: json.note });
      setFlash({ text: json.note, tone: "ok" });
    } catch (err) {
      setFlash({ text: err instanceof Error ? err.message : "The check failed. Try again.", tone: "error" });
    } finally {
      setSweeping(false);
    }
  };

  const importOld = async () => {
    if (!oldBoard) return;
    const r = await send({ type: "import", models: oldBoard.models });
    if (r.ok) {
      setFlash({ text: `${r.message}${oldBoard.skipped ? ` · ${oldBoard.skipped} non-AI records stay on your old board` : ""}`, tone: "ok" });
      setOldBoard(null);
      try {
        window.localStorage.setItem(IMPORT_DISMISSED_KEY, "1");
      } catch {}
    } else setFlash({ text: r.error ?? "", tone: "error" });
  };

  const fromAnalyzer = (res: AnalyzeResult) => {
    const e = res.entry;
    setAnalyzeOpen(false);
    setSheetError("");
    setSheet({
      draft: {
        name: e.name,
        url: e.url,
        category: categoryFromLabel(e.category) ?? category ?? "",
        summary: e.summary,
        tags: e.tags,
        features: e.features,
        access: e.access,
        openSource: e.openSource,
        runsLocally: e.hosting !== "hosted",
        hfId: hfIdFromUrl(e.url),
        contentRating: e.contentRating,
        note: "",
        releasedAt: new Date(now).toISOString().slice(0, 10),
      },
    });
    setFlash({ text: res.warning ?? "Check the category and release date, then add it.", tone: res.warning ? "error" : "ok" });
  };

  // One way out of the sheet, so a stale error can't greet the next one — and
  // so the edit form gets a say before unsaved work is thrown away.
  const closeSheet = useCallback(() => {
    if (sheetGuard.current && !sheetGuard.current()) return;
    sheetGuard.current = null;
    setSheet(null);
    setSheetError("");
  }, []);

  const registerGuard = useCallback((g: (() => boolean) | null) => {
    sheetGuard.current = g;
  }, []);

  const pick = (id: string | null) => {
    setCategory(id);
    setMobileList("top");
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  /**
   * Category links are real links — middle-click, open in a new tab and copy
   * link address all work — but a plain left click is handled here, so the
   * board switches instantly instead of reloading.
   */
  const linkClick = (id: string | null) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    pick(id);
  };

  const setF = <K extends keyof BoardFilters>(k: K, v: BoardFilters[K]) => setFilters((p) => ({ ...p, [k]: v }));

  // ----- render ---------------------------------------------------------------------------

  const cat = category ? categoryOf(category) : undefined;

  return (
    // One focus ring for the whole surface: several controls below set
    // outline-none for their own look, and every one of them still has to be
    // visible to a keyboard.
    <div className="min-h-dvh scroll-pt-28 bg-canvas text-ink [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-brand">
      <a href="#board" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-brand-2 focus:px-3 focus:py-1.5 focus:text-[12px] focus:text-white">
        Skip to the leaderboard
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 pt-3 sm:px-6">
          {canEdit && (
            <Link href="/" className="hidden items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-muted transition hover:text-ink sm:inline-flex" aria-label="Back to the hub">
              <Icon.ArrowLeft width={12} height={12} aria-hidden="true" /> Hub
            </Link>
          )}
          <button onClick={() => pick(null)} className="flex shrink-0 items-baseline gap-2 text-left">
            <span className="text-[15px] font-semibold tracking-tight text-ink">AI Rankings</span>
            <span className="hidden font-mono text-[11px] tabular-nums text-ink-muted md:inline">
              {status === "ready" ? `${models.length} models · ${CATEGORIES.length} categories` : " "}
            </span>
          </button>

          <label className="relative ml-auto min-w-0 flex-1 sm:max-w-sm">
            <span className="sr-only">Search models</span>
            <Icon.Search width={13} height={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <input
              ref={search}
              value={filters.query}
              onChange={(e) => setF("query", e.target.value)}
              placeholder="Search models, makers, features"
              className="w-full rounded-md border border-line bg-panel py-1.5 pl-8 pr-8 text-[13px] text-ink transition placeholder:text-ink-faint focus:border-brand"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1 font-mono text-[10px] text-ink-muted sm:block">/</kbd>
          </label>

          {canEdit && (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => setAnalyzeOpen(true)}
                aria-label="Add a model"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-brand-2 px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-brand-press active:scale-[0.98] pointer-coarse:min-h-11"
              >
                <Icon.Plus width={12} height={12} aria-hidden="true" />
                <span className="hidden sm:inline">Add</span>
              </button>
              <button
                onClick={() => setInboxOpen(true)}
                className="relative inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-muted transition hover:border-ink-faint hover:text-ink pointer-coarse:min-h-11"
                aria-label={`Inbox, ${inbox.length} new releases`}
              >
                <Icon.Inbox width={13} height={13} aria-hidden="true" />
                <span className="hidden lg:inline">Inbox</span>
                {inbox.length > 0 && (
                  // Amber here is right: the inbox is the one thing on this
                  // page that is genuinely waiting on the owner. Freshness
                  // elsewhere uses the cyan accent, so the two never blur.
                  <span className="rounded-full bg-amber-400 px-1.5 font-mono text-[10px] font-semibold tabular-nums leading-4 text-canvas">{inbox.length}</span>
                )}
              </button>
            </div>
          )}
          {canEditRaw && (
            <button
              onClick={() => setVisitorPreview((v) => !v)}
              aria-pressed={visitorPreview}
              title={visitorPreview ? "Back to editing" : "See the page as a visitor does"}
              className={`hidden shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition sm:inline-flex ${
                visitorPreview ? "border-brand bg-brand/15 text-ink" : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              {visitorPreview ? <Icon.EyeOff width={13} height={13} aria-hidden="true" /> : <Icon.Eye width={13} height={13} aria-hidden="true" />}
              <span className="hidden xl:inline">{visitorPreview ? "Exit preview" : "Visitor view"}</span>
            </button>
          )}
        </div>

        {/* Category rail: families as quiet labels, categories as the targets. */}
        <nav aria-label="Categories" className="mx-auto max-w-[1320px]">
          <div className="flex items-center gap-1 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-6">
            <RailLink active={category === null} href={urlFor(null, filters)} onClick={linkClick(null)}>
              Overview
            </RailLink>
            {FAMILIES.map((fam) => (
              <div key={fam.id} className="flex shrink-0 items-center gap-1">
                <span className="ml-3 mr-0.5 select-none text-[10.5px] text-ink-muted">{fam.label}</span>
                {CATEGORIES.filter((c) => c.family === fam.id).map((c) => {
                  const count = byCategory.get(c.id)?.length ?? 0;
                  const fresh = (freshCount.get(c.id) ?? 0) > 0;
                  return (
                    <RailLink
                      key={c.id}
                      active={category === c.id}
                      href={urlFor(c.id, filters)}
                      onClick={linkClick(c.id)}
                      fresh={fresh}
                    >
                      {c.label}
                      <span className="font-mono text-[10.5px] tabular-nums text-ink-muted" aria-hidden="true">{count}</span>
                      <span className="sr-only">
                        , {count} model{count === 1 ? "" : "s"}{fresh ? ", new releases" : ""}
                      </span>
                    </RailLink>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

      </header>

      {/* Filters sit OUTSIDE the sticky header and scroll away with the page.
          Pinned, the header took 137px of an 844px phone screen; what has to
          stay pinned is the search box and the categories, not these. */}
      <div className="border-b border-line bg-canvas">
        <div className="mx-auto flex max-w-[1320px] items-center gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-6">
          <Toggle on={filters.openSource} onClick={() => setF("openSource", !filters.openSource)}>Open source</Toggle>
          <Toggle on={filters.runsLocally} onClick={() => setF("runsLocally", !filters.runsLocally)}>Runs locally</Toggle>
          <Toggle on={filters.free} onClick={() => setF("free", !filters.free)}>Free to use</Toggle>
          <div role="group" aria-label="Released within" className="ml-1 flex shrink-0 rounded-md border border-line p-0.5">
            {RELEASED.map((r) => (
              <button
                key={r.id}
                onClick={() => setF("released", r.id)}
                aria-pressed={filters.released === r.id}
                className={`min-h-7 rounded px-2 text-[11.5px] transition pointer-coarse:min-h-10 ${filters.released === r.id ? "bg-elevated text-ink" : "text-ink-muted hover:text-ink"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {active && (
            <button onClick={() => setFilters(NO_FILTERS)} className="min-h-8 shrink-0 px-2 text-[12px] text-ink-muted underline-offset-2 transition hover:text-ink hover:underline pointer-coarse:min-h-10">
              Reset
            </button>
          )}
        </div>
      </div>

      <main id="board" className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6">
        {canEdit && oldBoard && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-[10px] border border-brand/40 bg-brand/10 px-4 py-3">
            <Icon.Upload width={14} height={14} className="text-brand" aria-hidden="true" />
            <p className="flex-1 text-[13px] text-ink">
              Your old private board in this browser has {oldBoard.models.length} AI record{oldBoard.models.length === 1 ? "" : "s"} that aren&apos;t on the public board yet.
            </p>
            <button onClick={importOld} className="rounded-md bg-brand-2 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-press">Import them</button>
            <button
              onClick={() => {
                setOldBoard(null);
                try { window.localStorage.setItem(IMPORT_DISMISSED_KEY, "1"); } catch {}
              }}
              className="text-[12px] text-ink-muted hover:text-ink"
            >
              Not now
            </button>
          </div>
        )}

        {status === "loading" && <Skeleton />}

        {status === "error" && (
          <div className="mx-auto max-w-md py-24 text-center">
            <p className="text-[15px] text-ink">The leaderboard didn&apos;t load</p>
            <p className="mt-1 text-[13px] text-ink-muted">{flash?.text ?? "Something went wrong on the way."}</p>
            <button onClick={() => void load()} className="mt-4 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink hover:border-ink-faint">Try again</button>
          </div>
        )}

        {status === "ready" && !cat && (
          <Overview
            byCategory={byCategory}
            filtered={filtered}
            ranks={ranks}
            now={now}
            latestRelease={latestRelease}
            active={active}
            linkTo={(id) => urlFor(id, filters)}
            onPick={linkClick}
            onOpen={(id) => setSheet({ id })}
          />
        )}

        {status === "ready" && cat && (
          <CategoryView
            label={cat.label}
            blurb={cat.blurb}
            family={FAMILIES.find((f) => f.id === cat.family)?.label ?? ""}
            all={models.filter((m) => m.category === cat.id)}
            shown={byCategory.get(cat.id) ?? []}
            ranks={ranks}
            now={now}
            active={active}
            filters={filters}
            canEdit={canEdit}
            mobileList={mobileList}
            setMobileList={setMobileList}
            onOpen={(id) => setSheet({ id })}
            onReset={() => setFilters(NO_FILTERS)}
            overviewHref={urlFor(null, filters)}
            onBack={linkClick(null)}
            onAdd={() => setAnalyzeOpen(true)}
            onAddByHand={() => setSheet({ draft: { category: cat.id } })}
          />
        )}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-4 py-6 text-[12px] text-ink-muted sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <p className="max-w-[70ch] leading-relaxed">
            <span className="text-ink-muted">How the score works.</span> Each model gets a public score where one exists (an arena Elo or a benchmark), measured
            against the leader of its category, and the curator&apos;s own 1–10 rating. With both, the score is their average. New releases are checked daily on Hugging Face and added once reviewed.
            Arena scores come from <a href="https://artificialanalysis.ai" target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">Artificial Analysis</a>,{" "}
            <a href="https://lmarena.ai" target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">LMArena</a> and 3D Arena; each model links to its own.
          </p>
          <nav aria-label="Legal" className="flex shrink-0 gap-4">
            <a href="/legal/privacy" className="inline-flex min-h-11 items-center rounded hover:text-ink">Privacy</a>
            <a href="/legal/terms" className="inline-flex min-h-11 items-center rounded hover:text-ink">Terms</a>
          </nav>
        </div>
      </footer>

      <SlideOver open={Boolean(sheet)} onClose={closeSheet} label={sheetRanked?.model.name ?? (sheet?.draft ? "New model" : "Model")}>
        {sheet && (
          <ModelSheet
            ranked={sheetRanked}
            draft={sheet.draft ?? null}
            canEdit={canEdit}
            startEditing={sheet.edit}
            now={now}
            busy={busy}
            error={sheetError}
            onSave={saveModel}
            onDelete={deleteModel}
            onRate={rate}
            onClose={closeSheet}
            onGuard={registerGuard}
          />
        )}
      </SlideOver>

      <SlideOver open={inboxOpen && canEdit} onClose={() => setInboxOpen(false)} label="New releases inbox" wide>
        <InboxPanel
          items={inbox}
          lastSweepAt={lastSweep.at}
          lastSweepNote={lastSweep.note}
          now={now}
          busyId={busyInboxId}
          sweeping={sweeping}
          onApprove={approve}
          onDismiss={dismiss}
          onDismissAll={dismissAll}
          onSweep={sweep}
          onClose={() => setInboxOpen(false)}
        />
      </SlideOver>

      {analyzeOpen && canEdit && (
        <AnalyzeLink
          tree={{ AI: CATEGORIES.map((c) => c.label) }}
          knownFeatures={[...new Set(models.flatMap((m) => m.features))].slice(0, 200)}
          onResult={fromAnalyzer}
          onClose={() => setAnalyzeOpen(false)}
          onManual={() => {
            setAnalyzeOpen(false);
            setSheet({ draft: { category: category ?? "" } });
          }}
        />
      )}

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {flash && (
          <p
            className={`animate-fade-in pointer-events-auto max-w-md rounded-lg border px-3.5 py-2 text-[12.5px] ${
              flash.tone === "error" ? "border-rose-400/40 bg-elevated text-rose-200" : "border-line bg-elevated text-ink"
            }`}
          >
            {flash.text}
          </p>
        )}
      </div>
    </div>
  );
}

// ----- pieces ------------------------------------------------------------------------------

/**
 * A real link, so middle-click, open-in-new-tab and copy-link-address all
 * work; a plain click is intercepted and switches the board in place.
 */
function RailLink({
  active,
  href,
  onClick,
  fresh,
  children,
}: {
  active: boolean;
  href: string;
  onClick: (e: React.MouseEvent) => void;
  fresh?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href || "?"}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] transition duration-150 active:scale-[0.97] pointer-coarse:min-h-11 ${
        active ? "bg-elevated font-medium text-ink shadow-[inset_0_-2px_0_var(--color-brand)]" : "text-ink-muted hover:bg-panel hover:text-ink"
      }`}
    >
      {children}
      {fresh && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
    </a>
  );
}

function Skeleton() {
  return (
    // role="status" with real text: aria-label on a plain div is ignored, so
    // a screen reader was told nothing at all while the board loaded.
    <div role="status" aria-busy="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <span className="sr-only">Loading the leaderboard…</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-36 rounded-[10px] motion-safe:animate-pulse border border-line-soft bg-panel" style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}

function Overview({
  byCategory,
  filtered,
  ranks,
  now,
  latestRelease,
  active,
  linkTo,
  onPick,
  onOpen,
}: {
  byCategory: Map<string, Model[]>;
  filtered: Model[];
  ranks: Map<string, RankedModel>;
  now: number;
  latestRelease: string;
  active: boolean;
  linkTo: (id: string | null) => string;
  onPick: (id: string | null) => (e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
}) {
  const newest = justDropped(filtered, ranks).slice(0, 8);
  return (
    <>
      <section className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-end">
        <div>
          <h1 className="max-w-[18ch] text-[30px] font-semibold leading-[1.1] tracking-tight text-ink [text-wrap:balance] sm:text-[36px]">
            The best AI models, one category at a time.
          </h1>
          <p className="mt-3 max-w-[52ch] text-[13.5px] leading-relaxed text-ink-muted">
            Pick a category to see what ranks highest and what just came out. Turn on Open source to see only models you can download and run yourself.
          </p>
          {latestRelease && (
            <p className="mt-3 font-mono text-[11px] text-ink-muted">Newest release on the board: {releasedLabel(latestRelease, now)}</p>
          )}
        </div>

        <div className="rounded-[10px] border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
            <h2 className="text-[12px] font-medium text-ink">Just dropped{active ? " · filtered" : ""}</h2>
            <span className="text-[11px] text-ink-muted">all categories</span>
          </div>
          {newest.length === 0 ? (
            <p className="px-4 py-6 text-[12px] text-ink-muted">Nothing matches these filters.</p>
          ) : (
            <ol className="grid sm:grid-cols-2">
              {newest.map((r) => (
                <li key={r.model.id}>
                  <button onClick={() => onOpen(r.model.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-panel-2">
                    <span className="w-[68px] shrink-0 font-mono text-[11px] text-ink-muted">{releasedLabel(r.model.releasedAt, now)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{r.model.name}</span>
                      <span className="block truncate text-[11px] text-ink-muted">{categoryOf(r.model.category)?.label}</span>
                    </span>
                    {r.model.openSource && <Flag tone="open">Open</Flag>}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {FAMILIES.map((fam) => {
        const cats = CATEGORIES.filter((c) => c.family === fam.id);
        return (
          <section key={fam.id} className="mb-8" aria-labelledby={`fam-${fam.id}`}>
            <h2 id={`fam-${fam.id}`} className="mb-2.5 text-[12px] font-medium text-ink-muted">{fam.label}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cats.map((c) => {
                const list = byCategory.get(c.id) ?? [];
                const top = topRanked(list, ranks)[0];
                const latest = justDropped(list, ranks)[0];
                return (
                  // An <article> with a stretched link in its heading, not a
                  // button wrapping an h3: that is invalid HTML, it hides the
                  // heading from heading navigation, and it makes the whole
                  // card's text the control's name.
                  <article
                    key={c.id}
                    className="group relative flex flex-col rounded-[10px] border border-line bg-panel p-4 text-left transition duration-200 hover:border-ink-faint hover:bg-panel-2 focus-within:border-ink-faint motion-safe:hover:-translate-y-px"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[15px] font-semibold tracking-tight text-ink">
                        <a href={linkTo(c.id)} onClick={onPick(c.id)} className="after:absolute after:inset-0 after:rounded-[10px]">
                          {c.label}
                        </a>
                      </h3>
                      <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                        <span aria-hidden="true">{list.length}</span>
                        <span className="sr-only">{list.length} models</span>
                      </span>
                    </div>
                    <p className="text-[12px] text-ink-muted">{c.blurb}</p>

                    {list.length === 0 ? (
                      <p className="mt-4 text-[12px] text-ink-muted">{active ? "Nothing matches these filters" : "Nothing here yet"}</p>
                    ) : (
                      <div className="mt-4 space-y-2.5">
                        {top && (
                          <div>
                            <p className="mb-1 text-[10.5px] text-ink-muted">{top.rank !== undefined ? `#${top.rank}` : "Unranked"}</p>
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{top.model.name}</span>
                              <ScoreBar score={top.score} className="w-28 shrink-0" />
                            </div>
                          </div>
                        )}
                        {latest && latest.model.id !== top?.model.id && (
                          <div className="flex items-center gap-2 border-t border-line-soft pt-2.5 text-[12px]">
                            <span className="shrink-0 text-ink-muted">Newest</span>
                            <span className="min-w-0 flex-1 truncate text-ink">{latest.model.name}</span>
                            <span className={`shrink-0 font-mono text-[11px] ${isFresh(latest.model, now) ? "text-accent" : "text-ink-muted"}`}>
                              {releasedLabel(latest.model.releasedAt, now)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    <span aria-hidden="true" className="mt-auto flex items-center gap-1 pt-4 text-[11.5px] text-ink-muted transition group-hover:text-ink">
                      See the full ranking <Icon.ArrowRight width={11} height={11} />
                    </span>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

function CategoryView(p: {
  label: string;
  blurb: string;
  family: string;
  all: Model[];
  shown: Model[];
  ranks: Map<string, RankedModel>;
  now: number;
  active: boolean;
  filters: BoardFilters;
  canEdit: boolean;
  mobileList: "top" | "new";
  setMobileList: (v: "top" | "new") => void;
  onOpen: (id: string) => void;
  onReset: () => void;
  overviewHref: string;
  onBack: (e: React.MouseEvent) => void;
  onAdd: () => void;
  onAddByHand: () => void;
}) {
  const top = topRanked(p.shown, p.ranks);
  const fresh = justDropped(p.shown, p.ranks);
  const open = p.all.filter((m) => m.openSource).length;
  const recent = p.all.filter((m) => isFresh(m, p.now)).length;
  // With a filter on, the Top ranked list keeps its true ranks and so has
  // holes in it. Fill them with the rows the filter removed, muted, so the
  // reader can see what an open model is actually behind.
  const rows = p.active ? topRowsWithGaps(top, topRanked(p.all, p.ranks)) : top.map((r) => ({ kind: "model" as const, r }));
  const standing = p.filters.openSource ? openStanding(p.all, p.ranks) : null;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <nav aria-label="Breadcrumb" className="text-[11.5px] text-ink-muted">
            <a href={p.overviewHref} onClick={p.onBack} className="inline-flex min-h-6 items-center rounded hover:text-ink pointer-coarse:min-h-11">
              Overview
            </a>{" "}
            <span aria-hidden="true">/</span> {p.family}
          </nav>
          <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-tight text-ink sm:text-[34px]">{p.label}</h1>
          <p className="mt-1 text-[13px] text-ink-muted">{p.blurb}</p>
        </div>
        <dl className="flex gap-6 font-mono text-[12px] tabular-nums">
          <Stat label="Models" value={p.all.length} />
          <Stat label="Open source" value={open} />
          <Stat label="New in 14 days" value={recent} highlight={recent > 0} />
        </dl>
      </div>

      {p.all.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line px-6 py-16 text-center">
          <p className="text-[15px] text-ink">Nothing in {p.label} yet</p>
          <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-ink-muted">
            {p.canEdit ? "Paste a link and the page fills itself in, or add one by hand." : "The curator hasn't ranked anything here yet. Check back soon."}
          </p>
          {p.canEdit && (
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={p.onAdd} className="rounded-md bg-brand-2 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-press">Add from a link</button>
              <button onClick={p.onAddByHand} className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-muted hover:text-ink">Add by hand</button>
            </div>
          )}
        </div>
      ) : p.shown.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line px-6 py-16 text-center">
          <p className="text-[15px] text-ink">No {p.label.toLowerCase()} models match these filters</p>
          <p className="mt-1 text-[13px] text-ink-muted">{p.all.length} are hidden by them.</p>
          <button onClick={p.onReset} className="mt-4 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink hover:border-ink-faint">Reset filters</button>
        </div>
      ) : (
        <>
          {/* Two pressed-state buttons rather than half a tabs pattern: both
              lists are on the page at laptop width, so there is nothing for
              aria-controls to point at there, and arrow-key tab semantics
              would be a promise this control doesn't keep. */}
          <div role="group" aria-label="Which list to show" className="mb-3 flex rounded-md border border-line p-0.5 lg:hidden">
            {(["top", "new"] as const).map((t) => (
              <button
                key={t}
                aria-pressed={p.mobileList === t}
                onClick={() => p.setMobileList(t)}
                className={`min-h-10 flex-1 rounded px-3 py-1.5 text-[12.5px] transition ${p.mobileList === t ? "bg-elevated font-medium text-ink" : "text-ink-muted"}`}
              >
                {t === "top" ? "Top ranked" : "Just dropped"}
              </button>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <section aria-labelledby="top-h" className={`${p.mobileList === "top" ? "" : "hidden"} lg:block`}>
              <div className="overflow-hidden rounded-[10px] border border-line bg-panel">
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <h2 id="top-h" className="text-[12.5px] font-medium text-ink">Top ranked</h2>
                  <span className="text-[11px] text-ink-muted">score out of 100</span>
                </div>
                <ol>
                  {top.map((r, i) => (
                    <li key={r.model.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                      <button
                        onClick={() => p.onOpen(r.model.id)}
                        className="grid w-full grid-cols-[24px_minmax(0,1fr)_92px] items-center gap-3 border-b border-line-soft px-4 py-3 text-left transition last:border-0 hover:bg-panel-2 sm:grid-cols-[28px_minmax(0,1fr)_150px] md:grid-cols-[28px_minmax(0,1fr)_170px_92px]"
                      >
                        <RankMark rank={r.rank} />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[13.5px] font-medium text-ink">{r.model.name}</span>
                            <span className="hidden sm:inline-flex"><ModelFlags m={r.model} now={p.now} compact /></span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                            {r.model.maker}{r.model.maker && r.model.summary ? " · " : ""}{r.model.summary}
                            {p.canEdit && !r.model.summary && <span className="text-amber-300/80"> needs a summary</span>}
                          </span>
                        </span>
                        <ScoreBar score={r.score} />
                        <span className={`hidden text-right font-mono text-[11px] md:block ${isFresh(r.model, p.now) ? "text-accent" : "text-ink-muted"}`}>
                          {releasedLabel(r.model.releasedAt, p.now)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            <section aria-labelledby="new-h" className={`${p.mobileList === "new" ? "" : "hidden"} lg:block`}>
              <div className="overflow-hidden rounded-[10px] border border-line bg-panel">
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <h2 id="new-h" className="text-[12.5px] font-medium text-ink">Just dropped</h2>
                  <span className="text-[11px] text-ink-muted">newest first</span>
                </div>
                <ol className="relative">
                  {fresh.map((r) => (
                    <li key={r.model.id}>
                      <button onClick={() => p.onOpen(r.model.id)} className="flex w-full items-start gap-3 border-b border-line-soft px-4 py-3 text-left transition last:border-0 hover:bg-panel-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isFresh(r.model, p.now) ? "bg-accent" : "bg-line"}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{r.model.name}</span>
                          <span className="block font-mono text-[11px] text-ink-muted">
                            {releasedLabel(r.model.releasedAt, p.now)} · {r.model.releasedAt}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="font-mono text-[11px] tabular-nums text-ink-muted">{r.rank !== undefined ? `#${r.rank}` : "unranked"}</span>
                          {r.model.openSource && <Flag tone="open">Open</Flag>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <dt className="font-sans text-[10.5px] text-ink-muted">{label}</dt>
      <dd className={`text-[18px] font-semibold ${highlight ? "text-accent" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
