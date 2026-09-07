"use client";

// The project workspace: top bar, left rail, the active screen, the inspector.

import { GENRES, genreById, templateById } from "@/lib/auteur/constants";
import { progress, totalDuration } from "@/lib/auteur/repo";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { Assets } from "./Assets";
import { DirectorPanel } from "./DirectorPanel";
import { ShotInspector } from "./ShotInspector";
import { Storyboard } from "./Storyboard";
import { Timeline } from "./Timeline";
import { useStudio, type Tab } from "./studio";
import { Btn, Mono, Spinner, fmtSec } from "./ui";

const TABS: { id: Tab; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "director", label: "Director", icon: <Icon.Sparkles width={14} height={14} />, hint: "Concept, cast, worlds, style" },
  { id: "storyboard", label: "Storyboard", icon: <Icon.Grid width={14} height={14} />, hint: "Scenes and shots" },
  { id: "timeline", label: "Timeline", icon: <Icon.Film width={14} height={14} />, hint: "The cut" },
  { id: "assets", label: "Assets", icon: <Icon.Image width={14} height={14} />, hint: "References" },
];

export function Workspace() {
  const studio = useStudio();
  const p = studio.project;
  if (!p) return null;
  const template = templateById(p.templateId);
  const genres = p.genreIds.map(genreById).filter(Boolean);
  const pr = progress(p);
  const rendering = Object.keys(studio.busy).length;
  const showInspector = studio.tab === "storyboard" || studio.tab === "timeline";

  return (
    <div className="flex h-screen flex-col">
      {/* ----- top bar ----- */}
      <header className="flex h-12 flex-none items-center gap-3 border-b border-[var(--au-line)] bg-[var(--au-stage)]/90 px-3 backdrop-blur">
        <button type="button" onClick={studio.goHome} className="flex items-center gap-1.5 text-[var(--au-ink-3)] transition hover:text-[var(--au-ink)]" aria-label="Back to studio home">
          <Icon.ArrowLeft width={13} height={13} />
          <span className="hidden text-[11px] sm:inline">Studio</span>
        </button>
        <div className="h-5 w-px bg-[var(--au-line)]" />
        <input
          className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold tracking-tight outline-none sm:max-w-[320px]"
          value={p.title}
          onChange={(e) => studio.update((pp) => ({ ...pp, title: e.target.value }))}
          aria-label="Project title"
        />
        <div className="hidden items-center gap-1.5 md:flex">
          <span className="au-chip" data-on="true">{template.name}</span>
          {genres.map((g) => (
            <span key={g!.id} className="au-chip">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${g!.hue} 70% 60%)` }} />
              {g!.name}
            </span>
          ))}
          <GenrePicker />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-3 text-[11px] text-[var(--au-ink-3)] lg:flex">
            <span>{p.aspectRatio}</span>
            <span>{fmtSec(totalDuration(p) || p.targetDurationSec)}</span>
            {pr.total > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-20 overflow-hidden rounded-full bg-[var(--au-line)]">
                  <span className="block h-full bg-[var(--au-gold)]" style={{ width: `${(pr.done / pr.total) * 100}%` }} />
                </span>
                {pr.done}/{pr.total}
              </span>
            )}
            {studio.engine && <span className="au-mono">{studio.engine === "ai" ? "AI director" : "offline director"}</span>}
          </div>
          <select
            className="au-select"
            value={studio.resolution}
            onChange={(e) => studio.setResolution(e.target.value as "768P" | "2K")}
            title="Render resolution"
          >
            <option value="768P">768P draft</option>
            <option value="2K">2K final</option>
          </select>
          {pr.total > 0 && (
            <Btn variant="primary" size="sm" onClick={() => void studio.generateAll()} disabled={rendering > 0 && pr.done + rendering >= pr.total}>
              {rendering ? <Spinner /> : <Icon.Launch width={13} height={13} />}
              {rendering ? `Rendering ${rendering}` : pr.done === pr.total ? "All rendered" : `Generate ${pr.total - pr.done}`}
            </Btn>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ----- rail ----- */}
        <nav className="flex w-[64px] flex-none flex-col items-center gap-1 border-r border-[var(--au-line)] bg-[var(--au-stage)]/60 py-3 md:w-[164px] md:items-stretch md:px-2">
          {TABS.map((t) => {
            const on = studio.tab === t.id;
            const badge = t.id === "storyboard" ? pr.total : t.id === "assets" ? p.references.length : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => studio.setTab(t.id)}
                title={t.hint}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition md:justify-start",
                  on ? "bg-[var(--au-panel-2)] text-[var(--au-ink)]" : "text-[var(--au-ink-2)] hover:bg-[var(--au-panel)] hover:text-[var(--au-ink)]",
                )}
              >
                <span className={on ? "text-[var(--au-gold)]" : "text-[var(--au-ink-3)]"}>{t.icon}</span>
                <span className="hidden flex-1 md:inline">{t.label}</span>
                {badge > 0 && <span className="au-mono hidden md:inline">{badge}</span>}
              </button>
            );
          })}
          <div className="mt-auto hidden px-2 md:block">
            <Mono>Status</Mono>
            <div className="mt-1 text-[11px] text-[var(--au-ink-2)]">
              {p.status === "draft" && "Idea captured"}
              {p.status === "developed" && "Plan developed"}
              {p.status === "boarded" && `${pr.total} shots boarded`}
            </div>
          </div>
        </nav>

        {/* ----- screen ----- */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {studio.tab === "director" && <DirectorPanel />}
          {studio.tab === "storyboard" && <Storyboard />}
          {studio.tab === "timeline" && <Timeline />}
          {studio.tab === "assets" && <Assets />}
        </main>

        {/* ----- inspector ----- */}
        {showInspector && (
          <aside className="hidden w-[360px] flex-none border-l border-[var(--au-line)] bg-[var(--au-stage)]/60 xl:block">
            <ShotInspector />
          </aside>
        )}
      </div>

      {/* Below xl the inspector is a drawer over the board, opened by selecting a shot. */}
      {showInspector && studio.selectedShotId && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-[380px] max-w-full flex-col border-l border-[var(--au-line)] bg-[var(--au-stage)] shadow-[-20px_0_60px_rgba(0,0,0,.5)] xl:hidden au-fade-in">
          <button
            type="button"
            onClick={() => studio.selectShot(null)}
            className="absolute right-3 top-3 z-10 rounded-md bg-black/50 p-1 text-[var(--au-ink-2)] hover:text-[var(--au-ink)]"
            aria-label="Close inspector"
          >
            <Icon.Close width={13} height={13} />
          </button>
          <ShotInspector />
        </div>
      )}

      {/* ----- toasts ----- */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {studio.toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "au-fade-in rounded-lg border px-3 py-2 text-[12px] shadow-xl backdrop-blur",
              t.tone === "ok" && "border-[rgba(95,201,138,.4)] bg-[#0f1a14]/90 text-[#bfeccf]",
              t.tone === "warn" && "border-[rgba(229,83,61,.4)] bg-[#1c110f]/90 text-[#ffc2b8]",
              t.tone === "info" && "border-[var(--au-line-strong)] bg-[var(--au-panel)]/90 text-[var(--au-ink)]",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function GenrePicker() {
  const studio = useStudio();
  const p = studio.project!;
  return (
    <select
      className="au-select !py-1 !text-[11px]"
      value=""
      onChange={(e) => {
        const id = e.target.value;
        if (!id) return;
        studio.update((pp) => ({
          ...pp,
          genreIds: pp.genreIds.includes(id) ? pp.genreIds.filter((x) => x !== id) : [...pp.genreIds.slice(-1), id],
        }));
      }}
      title="Add or remove a genre"
    >
      <option value="">{p.genreIds.length ? "± genre" : "+ genre"}</option>
      {GENRES.map((g) => (
        <option key={g.id} value={g.id}>
          {p.genreIds.includes(g.id) ? "✓ " : ""}{g.name}
        </option>
      ))}
    </select>
  );
}
