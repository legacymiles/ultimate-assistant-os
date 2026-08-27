"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  requestClarify,
  requestClarify2,
  requestPrompt,
  requestSynthesize,
  saveToTimeline,
} from "@/lib/blueprint/client";
import {
  assembleGauntletHandoff,
  overviewToMarkdown,
} from "@/lib/blueprint/prompt-template";
import {
  emptyOverview,
  type BlueprintKind,
  type Brief,
  type ClarifyingQuestion,
  type Engine,
  type GeneratedPrompt,
  type Overview,
} from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { ClarifyPanel } from "./ClarifyPanel";
import { DeliverablePanel } from "./DeliverablePanel";
import { IntakePanel } from "./IntakePanel";
import { OverviewCanvas } from "./OverviewCanvas";

type Step = "intake" | "clarify" | "overview" | "deliverable";
const STEPS: { id: Step; label: string }[] = [
  { id: "intake", label: "Idea" },
  { id: "clarify", label: "Clarify" },
  { id: "overview", label: "Overview" },
  { id: "deliverable", label: "Prompt" },
];

type SaveState = "idle" | "saving" | "saved";

export function Blueprint() {
  const [step, setStep] = useState<Step>("intake");
  const [maxIdx, setMaxIdx] = useState(0);

  // Brief
  const [idea, setIdea] = useState("");
  const [kind, setKind] = useState<BlueprintKind>("website");
  const [audience, setAudience] = useState("");

  // Clarify
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [round1Count, setRound1Count] = useState(0);
  const [deepened, setDeepened] = useState(false);
  const [deepening, setDeepening] = useState(false);
  const [qualityBar, setQualityBar] = useState("");

  // Overview
  const [overview, setOverview] = useState<Overview>(emptyOverview());
  const [synthEngine, setSynthEngine] = useState<Engine>("heuristic");
  const [stale, setStale] = useState(false);

  // Deliverable
  const [generated, setGenerated] = useState<GeneratedPrompt | null>(null);
  const [portable, setPortable] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedId, setSavedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  const stepIdx = STEPS.findIndex((s) => s.id === step);

  const buildBrief = (): Brief => ({
    idea: idea.trim(),
    kind,
    audience: audience.trim(),
    answers: questions.map((q) => ({
      question: q.question,
      answer: (answers[q.id] ?? "").trim(),
    })),
    quality_bar: qualityBar.trim() || undefined,
  });

  const bump = (idx: number) => setMaxIdx((m) => Math.max(m, idx));

  // ----- stage runners ------------------------------------------------------
  const runClarify = async () => {
    setLoading(true);
    try {
      const qs = await requestClarify(buildBrief());
      setQuestions(qs);
      setRound1Count(qs.length);
      setDeepened(false);
      setQualityBar("");
      setStep("clarify");
      bump(1);
    } finally {
      setLoading(false);
    }
  };

  // Round 2 — adaptive follow-ups appended in place, plus a proposed quality bar.
  const runDeepen = async () => {
    setDeepening(true);
    try {
      const { questions: extra, quality_bar } = await requestClarify2(buildBrief());
      const existing = new Set(questions.map((q) => q.id));
      const fresh = extra.filter((q) => !existing.has(q.id));
      setQuestions((qs) => [...qs, ...fresh]);
      setQualityBar(quality_bar);
      setDeepened(true);
    } finally {
      setDeepening(false);
    }
  };

  const runSynthesize = async () => {
    setLoading(true);
    try {
      const { overview: ov, engine } = await requestSynthesize(buildBrief());
      setOverview(ov);
      setSynthEngine(engine);
      setGenerated(null);
      setStale(false);
      setSaveState("idle");
      setSavedId(null);
      setStep("overview");
      bump(2);
    } finally {
      setLoading(false);
    }
  };

  const runPrompt = async () => {
    setLoading(true);
    try {
      const g = await requestPrompt(overview, buildBrief(), portable);
      setGenerated(g);
      setStale(false);
      setStep("deliverable");
      bump(3);
    } finally {
      setLoading(false);
    }
  };

  // Toggle the portable variant on the deliverable and re-render the prompt.
  const onTogglePortable = async (next: boolean) => {
    setPortable(next);
    setRegenerating(true);
    try {
      const g = await requestPrompt(overview, buildBrief(), next);
      setGenerated(g);
      setStale(false);
    } finally {
      setRegenerating(false);
    }
  };

  const onSave = async () => {
    if (!generated) return;
    setSaveState("saving");
    try {
      const id = await saveToTimeline(overview, generated.prompt);
      setSavedId(id);
      setSaveState("saved");
    } catch (err) {
      console.error("Save to Timeline failed:", err);
      setSaveState("idle");
    }
  };

  const editOverview = (next: Overview) => {
    setOverview(next);
    if (generated) setStale(true);
  };

  const goto = (target: number) => {
    if (target > maxIdx || loading) return;
    const targetStep = STEPS[target].id;
    if (targetStep === "clarify" && questions.length === 0) {
      void runClarify();
      return;
    }
    setStep(targetStep);
  };

  const spec = useMemo(
    () => overviewToMarkdown(overview, buildBrief()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, kind, audience, idea, questions, answers],
  );
  const filenameBase = useMemo(() => slugify(overview.one_liner) || "blueprint", [overview.one_liner]);

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
        <span className="ml-1 text-sm font-semibold text-ink">Prompt Architect</span>
        <span className="ml-2 rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
          Idea → Prompt
        </span>
      </div>

      {/* Aurora header */}
      <header className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70 motion-reduce:opacity-40"
          style={{
            background:
              "radial-gradient(60% 120% at 15% 0%, rgba(99,102,241,0.28), transparent 60%)," +
              "radial-gradient(50% 120% at 85% 10%, rgba(34,197,94,0.16), transparent 55%)," +
              "radial-gradient(60% 140% at 60% 120%, rgba(59,130,246,0.18), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Turn a vague idea into an amazing build prompt
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Describe what you want. Prompt Architect asks a few sharp questions, sets a real
            quality bar to beat, shapes it into a clear overview of{" "}
            <span className="text-core">core</span> and{" "}
            <span className="text-support">supporting</span> features you can edit, then
            writes an optimized Claude Code prompt with a gauntlet handoff baked in.
          </p>

          {/* Step rail */}
          <nav className="mt-5 flex items-center gap-1.5" aria-label="Progress">
            {STEPS.map((s, i) => {
              const reached = i <= maxIdx;
              const active = i === stepIdx;
              return (
                <div key={s.id} className="flex items-center gap-1.5">
                  <button
                    onClick={() => goto(i)}
                    disabled={!reached || loading}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                      active
                        ? "bg-brand text-white"
                        : reached
                          ? "bg-panel-2 text-ink hover:bg-elevated"
                          : "text-ink-faint",
                      !reached && "cursor-not-allowed",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-full text-[9px]",
                        active
                          ? "bg-white/25"
                          : reached
                            ? "bg-brand/25 text-brand"
                            : "bg-line",
                      )}
                    >
                      {i < maxIdx && !active ? <Icon.Check width={9} height={9} /> : i + 1}
                    </span>
                    {s.label}
                  </button>
                  {i < STEPS.length - 1 && (
                    <span
                      className={cn(
                        "h-px w-4 transition-colors",
                        i < maxIdx ? "bg-brand/40" : "bg-line",
                      )}
                    />
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Active panel */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          {stale && step !== "deliverable" && generated && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              You&apos;ve edited the overview since generating — hit{" "}
              <span className="font-semibold">Generate</span> again to refresh the prompt.
            </div>
          )}

          {step === "intake" && (
            <IntakePanel
              idea={idea}
              kind={kind}
              audience={audience}
              onIdea={setIdea}
              onKind={setKind}
              onAudience={setAudience}
              onClarify={runClarify}
              onSkip={runSynthesize}
              loading={loading}
            />
          )}

          {step === "clarify" && (
            <ClarifyPanel
              questions={questions}
              values={answers}
              onChange={(id, value) => setAnswers((a) => ({ ...a, [id]: value }))}
              onBuild={runSynthesize}
              onBack={() => setStep("intake")}
              loading={loading}
              round1Count={round1Count}
              deepened={deepened}
              deepening={deepening}
              onDeepen={runDeepen}
              qualityBar={qualityBar}
              onQualityBar={setQualityBar}
            />
          )}

          {step === "overview" && (
            <OverviewCanvas
              overview={overview}
              engine={synthEngine}
              onChange={editOverview}
              onGenerate={runPrompt}
              onBack={() => setStep(questions.length ? "clarify" : "intake")}
              loading={loading}
            />
          )}

          {step === "deliverable" && generated && (
            <DeliverablePanel
              prompt={generated.prompt}
              spec={spec}
              gauntletText={assembleGauntletHandoff(generated.prompt, overview)}
              engine={generated.engine}
              filenameBase={filenameBase}
              portable={portable}
              regenerating={regenerating}
              onTogglePortable={onTogglePortable}
              saveState={saveState}
              savedProjectId={savedId}
              onSave={onSave}
              onBack={() => setStep("overview")}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
