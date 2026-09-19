"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { ACTIVE_STATUSES, BUILD_MODELS, TEMPLATES, type Game, type TemplateId } from "@/lib/game-creator/types";
import { builderOnline, createGame, fetchGames, type BuilderInfo } from "./api";
import { BuilderSetup } from "./BuilderSetup";
import { GameCard } from "./GameCard";
import "./game-creator.css";

const EXAMPLES = [
  "A neon target range: targets pop up for 60 seconds, shoot as many as you can, high score on screen.",
  "A third-person coin rush across floating platforms, with a timer and jump pads.",
  "A top-down survival arena where waves of red cubes chase you and you dodge until the clock runs out.",
  "An off-road checkpoint race against the clock on the vehicle track.",
];

type Filter = "all" | "building" | "ready" | "failed";

export function GameCreator() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [builder, setBuilder] = useState<BuilderInfo | null>(null);
  const [prompt, setPrompt] = useState("");
  const [template, setTemplate] = useState<TemplateId>("Auto");
  // null = use the PC's default. Only one skill builds a game.
  const [skill, setSkill] = useState<string | null>(null);
  // "" = the PC's default model (BUILDER_MODEL, else Claude Code's own default).
  const [model, setModel] = useState("");
  useEffect(() => {
    try {
      setModel(localStorage.getItem("gc-model") ?? "");
    } catch {}
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    try {
      const res = await fetchGames();
      setGames(res.games);
      setBuilder(res.builder);
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message);
      setGames((g) => g ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anyActive = games?.some((g) => ACTIVE_STATUSES.includes(g.status)) ?? false;

  // Poll while something is in the pipeline, and slowly otherwise so the
  // builder's online dot stays honest.
  useEffect(() => {
    const id = setInterval(() => void load(), anyActive ? 5000 : 20000);
    return () => clearInterval(id);
  }, [anyActive, load]);

  const submit = async () => {
    if (prompt.trim().length < 8) return setError("Describe the game in a sentence or more.");
    setSubmitting(true);
    setError("");
    try {
      const game = await createGame(prompt, template, chosenSkill, chosenModel || null);
      setGames((prev) => [game, ...(prev ?? [])]);
      setPrompt("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const counts = useMemo(() => {
    const list = games ?? [];
    return {
      all: list.length,
      building: list.filter((g) => ACTIVE_STATUSES.includes(g.status)).length,
      ready: list.filter((g) => g.status === "ready").length,
      failed: list.filter((g) => g.status === "failed").length,
    };
  }, [games]);

  const visible = (games ?? []).filter((g) =>
    filter === "all" ? true : filter === "building" ? ACTIVE_STATUSES.includes(g.status) : g.status === filter,
  );

  const online = builderOnline(builder);
  const skills = builder?.skills ?? [];
  const defaultSkill = builder?.defaultSkill ?? null;
  const chosenSkill = skill && skills.some((s) => s.name === skill) ? skill : defaultSkill;
  const queued = (games ?? []).filter((g) => g.status === "queued").length;
  const openrouter = builder?.openrouter === true;
  // An OpenRouter pick falls back to the default while the PC has no key.
  const chosenModel = BUILD_MODELS.some((m) => m.id === model && (m.via === "plan" || openrouter)) ? model : "";
  const modelInfo = BUILD_MODELS.find((m) => m.id === chosenModel);
  const pickModel = (id: string) => {
    setModel(id);
    try {
      localStorage.setItem("gc-model", id);
    } catch {}
  };

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
        <span className="text-sm font-semibold text-ink">Game Creator</span>
        <span className="ml-auto text-xs text-ink-faint">
          {games === null ? "Loading…" : `${counts.all} game${counts.all === 1 ? "" : "s"} · ${counts.ready} ready`}
        </span>
      </header>

      <main className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6">
        <section className="gc-hero relative overflow-hidden rounded-3xl border border-line bg-panel p-5 sm:p-7">
          <div className="gc-hero__glow" aria-hidden />
          <div className="relative grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Unreal Engine 5.8</p>
                <h1 className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">Describe a game. Your PC builds it.</h1>
                <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">
                  Claude designs it, builds the gameplay in Unreal, playtests it, takes screenshots and packages a game you can
                  play. Every game lands in the gallery below.
                </p>
              </div>

              <label className="sr-only" htmlFor="gc-prompt">
                Game idea
              </label>
              <textarea
                id="gc-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                }}
                rows={4}
                placeholder="A first-person game where…"
                className="w-full resize-y rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
              />

              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    // aria-label keeps the visible label as the accessible name;
                    // with title alone, screen readers announced the blurb instead.
                    aria-label={t.label}
                    aria-pressed={template === t.id}
                    title={t.blurb}
                    onClick={() => setTemplate(t.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      template === t.id
                        ? "border-brand bg-brand/15 text-ink"
                        : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="gc-skill" className="text-xs text-ink-muted">
                  Build skill
                </label>
                <select
                  id="gc-skill"
                  value={chosenSkill ?? ""}
                  onChange={(e) => setSkill(e.target.value || null)}
                  disabled={skills.length < 2}
                  title={skills.find((s) => s.name === chosenSkill)?.description}
                  className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-brand/60 disabled:opacity-80"
                >
                  {skills.length === 0 ? (
                    <option value="">Your PC&apos;s default skill</option>
                  ) : (
                    skills.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                        {s.name === defaultSkill ? " (default)" : ""}
                      </option>
                    ))
                  )}
                </select>
                <span className="text-[11px] text-ink-faint">
                  {skills.length === 0
                    ? "The list appears once your PC's builder has checked in."
                    : skills.length === 1
                      ? "The only game-building skill on your PC."
                      : "One skill builds each game."}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="gc-model" className="text-xs text-ink-muted">
                  Model
                </label>
                <select
                  id="gc-model"
                  value={chosenModel}
                  onChange={(e) => pickModel(e.target.value)}
                  title={modelInfo?.blurb}
                  className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-brand/60"
                >
                  <option value="">Your PC&apos;s default</option>
                  <optgroup label="Claude (your plan)">
                    {BUILD_MODELS.filter((m) => m.via === "plan").map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={openrouter ? "Other LLMs (OpenRouter)" : "Other LLMs (needs an OpenRouter key on your PC)"}>
                    {BUILD_MODELS.filter((m) => m.via === "openrouter").map((m) => (
                      <option key={m.id} value={m.id} disabled={!openrouter}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <span className="text-[11px] text-ink-faint">
                  {modelInfo?.via === "openrouter"
                    ? "Billed to OpenRouter. Claude Code is tuned for Claude, so other models may stumble on the Unreal tools."
                    : (modelInfo?.blurb ?? "Claude Code's default model, on your Claude plan.")}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={submitting}
                  className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_-10px] shadow-brand transition hover:brightness-110 disabled:opacity-50"
                >
                  {submitting ? "Queuing…" : "Build this game"}
                </button>
                <span className="text-xs text-ink-faint">
                  {online
                    ? queued
                      ? `${queued} in the queue — your PC builds one at a time.`
                      : "Your PC is ready to build."
                    : "It will start as soon as your PC's builder is running."}
                </span>
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
            </div>
          </div>
        </section>

        <BuilderSetup builder={builder} onLinked={() => void load()} />

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="mr-2 text-sm font-semibold text-ink">Your games</h2>
            {(["all", "building", "ready", "failed"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-2.5 py-0.5 text-xs capitalize transition ${
                  filter === f ? "border-ink-faint bg-elevated text-ink" : "border-line text-ink-muted hover:text-ink"
                }`}
              >
                {f === "building" ? "In progress" : f} <span className="text-ink-faint">{counts[f]}</span>
              </button>
            ))}
          </div>

          {loadError && <p className="text-xs text-red-400">Could not load games: {loadError}</p>}

          {games === null ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="aspect-[4/3] animate-pulse rounded-2xl border border-line bg-panel" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-10 text-center">
              <p className="text-sm text-ink">{counts.all ? "Nothing in this filter." : "No games yet."}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {counts.all ? "Pick another filter above." : "Describe one above — it shows up here while it is being built."}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((g) => (
                <GameCard key={g.id} game={g} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
