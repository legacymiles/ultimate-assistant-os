"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AudioFeatures } from "@/lib/soundprint/audio-analysis";
import { analyze, fetchProviderStatus, toMeasured } from "@/lib/soundprint/client";
import {
  DEFAULT_MODEL_ID,
  MODELS,
  TIER_LABELS,
  TIER_ORDER,
  getModel,
  type ProviderStatus,
} from "@/lib/soundprint/models";
import {
  GENRE_FAMILIES,
  INSTRUMENTS,
  MOODS,
  PRODUCTION,
  VOCAL_TRAITS,
} from "@/lib/soundprint/vocabulary";
import {
  SCOPE_HINTS,
  SCOPE_LABELS,
  SECTION_LABELS,
  VOCAL_LABELS,
  emptyManual,
  type AnalysisResult,
  type ManualSelection,
  type Scope,
  type SectionFocus,
  type SongBrief,
  type VocalMode,
} from "@/lib/soundprint/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { AudioPanel } from "./AudioPanel";
import { ChipPicker } from "./ChipPicker";
import { ResultPanel } from "./ResultPanel";

const SECTIONS = Object.keys(SECTION_LABELS) as SectionFocus[];

const EXAMPLE =
  "Make a song that sounds like ONLY the intro of The Reason by Hoobastank — " +
  "that clean, arpeggiated guitar and the space around it. Once the beat came in " +
  "and he started singing it wasn't good, so keep the drums out entirely.";

export function Soundprint() {
  const [request, setRequest] = useState("");
  const [reference, setReference] = useState("");
  const [section, setSection] = useState<SectionFocus>("intro");
  const [scope, setScope] = useState<Scope>("hold");
  const [vocals, setVocals] = useState<VocalMode>("mood");
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [manual, setManual] = useState<ManualSelection>(emptyManual());
  const [features, setFeatures] = useState<AudioFeatures | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<ProviderStatus | null>(null);

  // Stable identity so AudioPanel's measurement effect doesn't re-fire.
  const onFeatures = useCallback((f: AudioFeatures | null) => setFeatures(f), []);

  useEffect(() => {
    void fetchProviderStatus().then(setStatus);
  }, []);

  const model = getModel(modelId);
  const modelReady = status ? status[model.provider] : true;

  const canGenerate = request.trim().length > 2 || reference.trim().length > 1 || !!features;

  const brief = (): SongBrief => ({
    request: request.trim(),
    reference: reference.trim(),
    section,
    scope,
    vocals,
    modelId,
    manual,
    audio: null,
  });

  const run = async () => {
    setLoading(true);
    try {
      setResult(await analyze(brief(), toMeasured(features)));
    } finally {
      setLoading(false);
    }
  };

  const grouped = useMemo(
    () => GENRE_FAMILIES.map((f) => ({ label: f.family, items: f.genres })),
    [],
  );

  const setManualKey = <K extends keyof ManualSelection>(key: K) => (next: string[]) =>
    setManual((m) => ({ ...m, [key]: next }));

  const manualCount = Object.values(manual).reduce((n, v) => n + v.length, 0);

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
        <span className="ml-1 text-sm font-semibold text-ink">Soundprint</span>
        <span className="ml-2 rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
          Reference → Suno prompt
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
              "radial-gradient(50% 120% at 85% 10%, rgba(0,202,224,0.16), transparent 55%)," +
              "radial-gradient(60% 140% at 60% 120%, rgba(168,85,247,0.18), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Make songs that sound like other songs
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Describe the sound you're chasing — down to a single section. Soundprint
            measures the audio, breaks the style down like a producer, and writes the two
            prompts you paste into Suno: the <span className="text-brand">style</span> and
            the <span className="text-brand">lyrics</span>.
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-2 lg:items-start">
          {/* ---------------- Inputs ---------------- */}
          <div className="space-y-3">
            <section className="rounded-xl border border-line bg-panel p-3.5">
              <label className="mb-1.5 block text-sm font-semibold text-ink">
                What do you want it to sound like?
              </label>
              <textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                rows={5}
                placeholder={EXAMPLE}
                className="w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60"
              />
              {!request && (
                <button
                  onClick={() => setRequest(EXAMPLE)}
                  className="mt-1.5 text-[11px] font-medium text-brand transition hover:text-brand-2"
                >
                  Use the example
                </button>
              )}

              <label className="mb-1.5 mt-3 block text-xs font-semibold text-ink">
                Reference track <span className="font-normal text-ink-faint">(optional)</span>
              </label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="The Reason — Hoobastank"
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60"
              />
            </section>

            {/* Target controls */}
            <section className="space-y-3 rounded-xl border border-line bg-panel p-3.5">
              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">Which part?</div>
                <div className="flex flex-wrap gap-1">
                  {SECTIONS.map((s) => (
                    <Pill key={s} active={section === s} onClick={() => setSection(s)}>
                      {SECTION_LABELS[s]}
                    </Pill>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">Then what?</div>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
                    <Pill key={s} active={scope === s} onClick={() => setScope(s)}>
                      {SCOPE_LABELS[s]}
                    </Pill>
                  ))}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                  {SCOPE_HINTS[scope]}
                </p>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-ink">Vocals</div>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(VOCAL_LABELS) as VocalMode[]).map((v) => (
                    <Pill key={v} active={vocals === v} onClick={() => setVocals(v)}>
                      {VOCAL_LABELS[v]}
                    </Pill>
                  ))}
                </div>
              </div>
            </section>

            <AudioPanel onFeatures={onFeatures} />

            {/* Model */}
            <section className="rounded-xl border border-line bg-panel p-3.5">
              <label className="mb-1.5 block text-xs font-semibold text-ink">
                Which model breaks it down?
              </label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink outline-none transition focus:border-brand/60"
              >
                {TIER_ORDER.map((tier) => (
                  <optgroup key={tier} label={TIER_LABELS[tier]}>
                    {MODELS.filter((m) => m.tier === tier).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} · {m.vendor}
                        {status && !status[m.provider] ? " — needs key" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{model.blurb}</p>

              {status && !modelReady && (
                <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
                  {model.provider === "openrouter" ? (
                    <>
                      This needs <code className="font-mono">OPENROUTER_API_KEY</code> in{" "}
                      <code className="font-mono">.env.local</code>. The free models cost nothing
                      and the key takes a minute at{" "}
                      <a
                        href="https://openrouter.ai/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        openrouter.ai/keys
                      </a>
                      . Without it you still get the offline draft — the measurements are real.
                    </>
                  ) : (
                    <>
                      This is a paid model and needs{" "}
                      <code className="font-mono">AI_GATEWAY_API_KEY</code>. Pick one from the{" "}
                      <span className="font-semibold">Free</span> group instead.
                    </>
                  )}
                </div>
              )}
            </section>

            {/* Advanced chips */}
            <section className="rounded-xl border border-line bg-panel">
              <button
                onClick={() => setShowAdvanced((s) => !s)}
                className="flex w-full items-center gap-2 px-3.5 py-2.5"
              >
                <Icon.Settings width={13} height={13} className="text-ink-faint" />
                <span className="text-xs font-semibold text-ink">Steer it by hand</span>
                {manualCount > 0 && (
                  <span className="rounded-full bg-brand/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                    {manualCount}
                  </span>
                )}
                <Icon.Chevron
                  width={11}
                  height={11}
                  className={cn(
                    "ml-auto text-ink-faint transition-transform",
                    showAdvanced && "rotate-180",
                  )}
                />
              </button>
              {showAdvanced && (
                <div className="animate-fade-in space-y-2 border-t border-line p-3">
                  <ChipPicker
                    label="Genres"
                    options={grouped}
                    selected={manual.genres}
                    onChange={setManualKey("genres")}
                    placeholder="Search 250+ genres…"
                  />
                  <ChipPicker
                    label="Mood"
                    options={MOODS}
                    selected={manual.moods}
                    onChange={setManualKey("moods")}
                  />
                  <ChipPicker
                    label="Instruments"
                    options={INSTRUMENTS}
                    selected={manual.instruments}
                    onChange={setManualKey("instruments")}
                  />
                  <ChipPicker
                    label="Production"
                    options={PRODUCTION}
                    selected={manual.production}
                    onChange={setManualKey("production")}
                  />
                  <ChipPicker
                    label="Voice"
                    options={VOCAL_TRAITS}
                    selected={manual.vocalTraits}
                    onChange={setManualKey("vocalTraits")}
                  />
                </div>
              )}
            </section>

            <button
              onClick={run}
              disabled={loading || !canGenerate}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Spinner /> : <Icon.Sparkles width={15} height={15} />}
              {loading ? "Breaking it down…" : "Write the prompts"}
            </button>
          </div>

          {/* ---------------- Output ---------------- */}
          <div className="lg:sticky lg:top-4">
            {result ? (
              <ResultPanel result={result} />
            ) : (
              <EmptyState hasAudio={!!features} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function EmptyState({ hasAudio }: { hasAudio: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel/40 p-6 text-center">
      <Icon.Sparkles width={22} height={22} className="mx-auto text-ink-faint" />
      <p className="mt-2 text-sm font-semibold text-ink">Your two prompts land here</p>
      <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-ink-faint">
        A <span className="text-ink-muted">Style</span> prompt and a{" "}
        <span className="text-ink-muted">Lyrics</span> prompt, formatted for whichever
        platform can actually make the track.
      </p>
      <ul className="mx-auto mt-3 max-w-xs space-y-1 text-left text-[11px] text-ink-faint">
        <li>· Describe the sound, or name the song</li>
        <li className={cn(hasAudio && "text-core")}>
          {hasAudio ? "✓ Audio measured" : "· Drop audio to measure it exactly"}
        </li>
        <li>· Pick the section you actually liked</li>
      </ul>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-panel-2 text-ink-muted hover:border-brand/50 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  );
}
