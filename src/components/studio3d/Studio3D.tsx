"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { toolUsage } from "@/lib/studio3d/director/normalize";
import { TOOLS } from "@/lib/studio3d/tools/registry";
import { ACTIVE_STATUSES, ASPECTS, LENGTHS, STYLES, type Aspect, type StyleId, type VideoProject } from "@/lib/studio3d/types";
import { ago, createProject, fetchProjects, formatSec, mediaUrl, type BuilderInfo } from "./api";
import { StatusPill, ToolChip } from "./StatusPill";
import { StudioSetup } from "./StudioSetup";
import "./studio3d.css";

const EXAMPLES = [
  "A tiny robot wakes up in an abandoned lab, explores the city at night, then dances on a rooftop when the lights come on.",
  "Explain how volcanoes erupt, with a friendly geologist guide walking us through the mountain.",
  "A clumsy ninja chases a runaway dog through a forest, slips, does a backflip and lands in a pond.",
  "A red rocket launches from the desert and an astronaut waves hello from the moon.",
];

const DIRECTING = [
  "Reading your prompt",
  "Finding the story beats",
  "Casting the characters",
  "Scouting the sets",
  "Blocking the cameras",
  "Routing motion to Mixamo, Cascadeur and Blender",
  "Timing every scene",
];

const LENGTH_LABEL: Record<number, string> = { 15: "15 s", 30: "30 s", 60: "1 min", 120: "2 min" };

type Filter = "all" | "storyboard" | "rendering" | "ready";

export function Studio3D() {
  const router = useRouter();
  const [projects, setProjects] = useState<VideoProject[] | null>(null);
  const [builder, setBuilder] = useState<BuilderInfo | null>(null);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<StyleId>("stylized-3d");
  const [lengthSec, setLengthSec] = useState<number>(30);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [mood, setMood] = useState("");
  const [audience, setAudience] = useState("");
  const [more, setMore] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    try {
      const res = await fetchProjects();
      setProjects(res.projects);
      setBuilder(res.builder);
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message);
      setProjects((p) => p ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anyActive = projects?.some((p) => ACTIVE_STATUSES.includes(p.status)) ?? false;
  useEffect(() => {
    const id = setInterval(() => void load(), anyActive ? 5000 : 20000);
    return () => clearInterval(id);
  }, [anyActive, load]);

  useEffect(() => {
    if (!directing) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => Math.min(DIRECTING.length - 1, s + 1)), 2200);
    return () => clearInterval(id);
  }, [directing]);

  const submit = async () => {
    if (prompt.trim().length < 6) return setError("Describe the video in a few words or more.");
    setDirecting(true);
    setError("");
    try {
      const project = await createProject(prompt, { style, lengthSec, aspect, mood: mood || undefined, audience: audience || undefined });
      router.push(`/apps/3d-studio/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setDirecting(false);
    }
  };

  const counts = useMemo(() => {
    const list = projects ?? [];
    return {
      all: list.length,
      storyboard: list.filter((p) => p.status === "storyboard" || p.status === "failed").length,
      rendering: list.filter((p) => ACTIVE_STATUSES.includes(p.status)).length,
      ready: list.filter((p) => p.status === "ready").length,
    };
  }, [projects]);

  const visible = (projects ?? []).filter((p) =>
    filter === "all" ? true : filter === "rendering" ? ACTIVE_STATUSES.includes(p.status) : filter === "storyboard" ? p.status === "storyboard" || p.status === "failed" : p.status === filter,
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
        >
          <Icon.ArrowLeft width={13} height={13} />
          Hub
        </Link>
        <span className="text-sm font-semibold text-ink">3D Studio Video Creator</span>
        <span className="ml-auto text-xs text-ink-faint">
          {projects === null ? "Loading…" : `${counts.all} video${counts.all === 1 ? "" : "s"} · ${counts.ready} rendered`}
        </span>
      </header>

      <main className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6">
        <section className="s3d-hero relative overflow-hidden rounded-3xl border border-line p-5 sm:p-7">
          <div className="s3d-sprockets" aria-hidden />
          <div className="relative grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Your AI animation director</p>
                <h1 className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">Describe a video. The director makes it.</h1>
                <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">
                  It writes the story, storyboards every shot, decides what Blender, Mixamo and Cascadeur each animate, shows you a moving
                  animatic, and renders the finished film in Blender on your PC.
                </p>
              </div>

              <label className="sr-only" htmlFor="s3d-prompt">
                Video idea
              </label>
              <textarea
                id="s3d-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                }}
                rows={4}
                placeholder="A short animated video where…"
                className="w-full resize-y rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
              />

              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-muted">Style</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {STYLES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={style === s.id}
                      onClick={() => setStyle(s.id)}
                      className={`s3d-style-card rounded-xl border p-2.5 text-left transition ${style === s.id ? "border-brand ring-2 ring-brand/20" : "border-line hover:border-ink-faint"}`}
                    >
                      <span
                        className="s3d-style-card__swatch"
                        style={{ background: `linear-gradient(135deg, ${s.palette[0]}, ${s.palette[1]} 60%, ${s.palette[2]})` }}
                        aria-hidden
                      />
                      <span className="block text-xs font-semibold text-ink">{s.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">{s.blurb}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <Segmented label="Length" value={lengthSec} options={LENGTHS.map((l) => ({ value: l, label: LENGTH_LABEL[l] }))} onChange={setLengthSec} />
                <Segmented
                  label="Format"
                  value={aspect}
                  options={ASPECTS.map((a) => ({ value: a, label: a === "16:9" ? "16:9 Wide" : a === "9:16" ? "9:16 Vertical" : "1:1 Square" }))}
                  onChange={setAspect}
                />
                <button type="button" onClick={() => setMore((v) => !v)} className="pb-1.5 text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline">
                  {more ? "Fewer options" : "Mood & audience"}
                </button>
              </div>

              {more && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    value={mood}
                    onChange={(e) => setMood(e.target.value)}
                    maxLength={80}
                    placeholder="Mood — e.g. whimsical, epic, cosy"
                    className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/60"
                  />
                  <input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    maxLength={80}
                    placeholder="Audience — e.g. kids, investors, TikTok"
                    className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/60"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={directing}
                  className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_-10px] shadow-brand transition hover:brightness-110 disabled:opacity-50"
                >
                  Direct this video
                </button>
                <span className="text-xs text-ink-faint">You review the storyboard before anything renders.</span>
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-ink-muted">Try one</p>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="rounded-xl border border-line bg-canvas/60 p-2.5 text-left text-xs text-ink-muted transition hover:border-brand/40 hover:text-ink"
                >
                  {ex}
                </button>
              ))}
              <div className="mt-2 rounded-xl border border-line bg-canvas/60 p-3">
                <p className="text-xs font-medium text-ink">The crew</p>
                <ul className="mt-2 space-y-2">
                  {TOOLS.filter((t) => t.status !== "planned").map((t) => (
                    <li key={t.id} className="text-[11px] leading-snug text-ink-muted">
                      <ToolChip tool={t.id} label={t.name} /> <span className="mt-1 block">{t.role}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <StudioSetup builder={builder} onLinked={() => void load()} />

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="mr-2 text-sm font-semibold text-ink">Your videos</h2>
            {(["all", "storyboard", "rendering", "ready"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${filter === f ? "border-ink-faint bg-elevated text-ink" : "border-line text-ink-muted hover:text-ink"}`}
              >
                {f === "all" ? "All" : f === "storyboard" ? "Storyboards" : f === "rendering" ? "In production" : "Rendered"} <span className="text-ink-faint">{counts[f]}</span>
              </button>
            ))}
          </div>
          {loadError && <p className="text-xs text-red-400">Could not load videos: {loadError}</p>}

          {projects === null ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="aspect-[4/3] animate-pulse rounded-2xl border border-line bg-panel" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-10 text-center">
              <p className="text-sm text-ink">{counts.all ? "Nothing in this filter." : "No videos yet."}</p>
              <p className="mt-1 text-xs text-ink-muted">{counts.all ? "Pick another filter above." : "Describe one above — the director has a storyboard ready in moments."}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </section>
      </main>

      {directing && (
        <div className="s3d-directing" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="s3d-clapper" aria-hidden>
              <div className="s3d-clapper__top" />
              <div className="s3d-clapper__body" />
            </div>
            <p className="text-base font-semibold text-ink">The director is planning your video</p>
            <ul className="space-y-1">
              {DIRECTING.map((d, i) => (
                <li key={d} className={`text-xs transition ${i < step ? "text-ink-faint line-through" : i === step ? "text-ink" : "text-ink-faint/50"}`}>
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">{label}</p>
      <div className="inline-flex rounded-xl border border-line bg-canvas p-0.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-lg px-2.5 py-1 text-xs transition ${value === o.value ? "bg-elevated font-medium text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project: p }: { project: VideoProject }) {
  const env = p.plan.environments[0];
  const tools = toolUsage(p.plan).map((u) => u.tool);
  const cover = p.stills.length ? mediaUrl(p.id, 0) : null;
  return (
    <Link
      href={`/apps/3d-studio/${p.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-panel transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_12px_40px_-12px] hover:shadow-brand/30"
    >
      <div className="relative aspect-video overflow-hidden bg-canvas">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="s3d-poster" style={{ ["--sky" as string]: env?.palette.sky, ["--ground" as string]: env?.palette.ground }} />
        )}
        <div className="absolute left-2 top-2">
          <StatusPill status={p.status} />
        </div>
        <div className="absolute inset-x-3 bottom-2 flex items-end justify-between gap-2">
          <p className="line-clamp-2 text-sm font-semibold text-white drop-shadow">{p.plan.title}</p>
          <span className="shrink-0 rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white">{formatSec(p.plan.totalSec)}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-xs text-ink-muted">{p.plan.logline}</p>
        <div className="flex flex-wrap gap-1">
          {tools.map((t) => (
            <ToolChip key={t} tool={t} label={t[0].toUpperCase() + t.slice(1)} />
          ))}
        </div>
        <div className="mt-auto flex items-center gap-2 pt-1 text-[11px] text-ink-faint">
          <span className="truncate">
            {p.plan.scenes.length} scenes · {p.brief.aspect} · {STYLES.find((s) => s.id === p.brief.style)?.label}
          </span>
          <span className="ml-auto shrink-0">{ago(p.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}
