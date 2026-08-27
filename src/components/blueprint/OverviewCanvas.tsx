"use client";

import type {
  Engine,
  Overview,
  OverviewFeature,
} from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { FeatureCard } from "./FeatureCard";

type Group = "core_features" | "supporting_features";

interface Props {
  overview: Overview;
  engine: Engine;
  onChange: (next: Overview) => void;
  onGenerate: () => void;
  onBack: () => void;
  loading: boolean;
}

export function OverviewCanvas({
  overview,
  engine,
  onChange,
  onGenerate,
  onBack,
  loading,
}: Props) {
  const patch = (p: Partial<Overview>) => onChange({ ...overview, ...p });

  const addFeature = (group: Group) =>
    patch({ [group]: [...overview[group], { title: "", description: "" }] } as Partial<Overview>);

  const updateFeature = (group: Group, i: number, fp: Partial<OverviewFeature>) =>
    patch({
      [group]: overview[group].map((f, idx) => (idx === i ? { ...f, ...fp } : f)),
    } as Partial<Overview>);

  const deleteFeature = (group: Group, i: number) =>
    patch({ [group]: overview[group].filter((_, idx) => idx !== i) } as Partial<Overview>);

  const moveFeature = (group: Group, i: number, dir: -1 | 1) => {
    const list = [...overview[group]];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    patch({ [group]: list } as Partial<Overview>);
  };

  const swapGroup = (group: Group, i: number) => {
    const other: Group = group === "core_features" ? "supporting_features" : "core_features";
    const moved = overview[group][i];
    patch({
      [group]: overview[group].filter((_, idx) => idx !== i),
      [other]: [...overview[other], moved],
    } as Partial<Overview>);
  };

  const ready = overview.core_features.some((f) => f.title.trim());

  return (
    <div className="animate-fade-in space-y-5">
      {/* Identity */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            One-liner
          </span>
          <EngineBadge engine={engine} />
        </div>
        <input
          value={overview.one_liner}
          onChange={(e) => patch({ one_liner: e.target.value })}
          placeholder="One sentence that captures the whole thing"
          className="w-full rounded-xl border border-line bg-canvas px-4 py-2.5 text-base font-semibold text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <textarea
          value={overview.purpose}
          onChange={(e) => patch({ purpose: e.target.value })}
          rows={3}
          placeholder="A short paragraph on the purpose — what it is and why it exists."
          className="w-full resize-none rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm leading-relaxed text-ink-muted outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {/* Design direction & quality bar */}
      <section className="rounded-2xl border border-brand/25 bg-brand/[0.04] p-3.5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Design direction
            </label>
            <input
              value={overview.design_direction}
              onChange={(e) => patch({ design_direction: e.target.value })}
              placeholder="The aesthetic / experience target in one line"
              className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              <Icon.Sparkles width={11} height={11} className="text-brand" />
              Quality bar to beat
            </label>
            <input
              value={overview.quality_bar}
              onChange={(e) => patch({ quality_bar: e.target.value })}
              placeholder="e.g. linear.app"
              className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2 text-sm font-medium text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30 sm:w-48"
            />
          </div>
        </div>

        {/* Recommended skills */}
        <div className="mt-3">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Recommended skills
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {overview.recommended_skills.length === 0 ? (
              <span className="text-[11px] text-ink-faint">
                None routed — a strong quality bar still drives the build.
              </span>
            ) : (
              overview.recommended_skills.map((r, i) => (
                <span
                  key={`${r.skill}-${i}`}
                  title={r.why}
                  className="group inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand"
                >
                  <span className="font-mono">{r.skill}</span>
                  <button
                    onClick={() =>
                      patch({
                        recommended_skills: overview.recommended_skills.filter((_, idx) => idx !== i),
                      })
                    }
                    aria-label={`Remove ${r.skill}`}
                    className="opacity-50 transition hover:opacity-100"
                  >
                    <Icon.Close width={10} height={10} />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Feature columns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <FeatureColumn
          title="Core features"
          hint="What the product fundamentally is"
          dot="bg-core"
          group="core_features"
          features={overview.core_features}
          accent="core"
          onAdd={() => addFeature("core_features")}
          onUpdate={updateFeature}
          onDelete={deleteFeature}
          onMove={moveFeature}
          onSwap={swapGroup}
        />
        <FeatureColumn
          title="Supporting features"
          hint="Enhancements, polish, quality-of-life"
          dot="bg-support"
          group="supporting_features"
          features={overview.supporting_features}
          accent="support"
          onAdd={() => addFeature("supporting_features")}
          onUpdate={updateFeature}
          onDelete={deleteFeature}
          onMove={moveFeature}
          onSwap={swapGroup}
        />
      </div>

      {/* Stack + open questions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <EditableList
          title="Suggested stack"
          placeholder="Add a technology or constraint"
          items={overview.stack}
          onChange={(stack) => patch({ stack })}
        />
        <EditableList
          title="Open questions"
          placeholder="Add something still undecided"
          items={overview.open_questions}
          onChange={(open_questions) => patch({ open_questions })}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          onClick={onGenerate}
          disabled={!ready || loading}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Spinner /> : <Icon.Sparkles width={15} height={15} />}
          {loading ? "Writing prompt…" : "Generate Claude Code prompt"}
        </button>
        <button
          onClick={onBack}
          disabled={loading}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-40"
        >
          Back
        </button>
        {!ready && (
          <span className="text-[11px] text-ink-faint">
            Add at least one core feature to continue.
          </span>
        )}
      </div>
    </div>
  );
}

function FeatureColumn({
  title,
  hint,
  dot,
  group,
  features,
  accent,
  onAdd,
  onUpdate,
  onDelete,
  onMove,
  onSwap,
}: {
  title: string;
  hint: string;
  dot: string;
  group: Group;
  features: OverviewFeature[];
  accent: "core" | "support";
  onAdd: () => void;
  onUpdate: (g: Group, i: number, p: Partial<OverviewFeature>) => void;
  onDelete: (g: Group, i: number) => void;
  onMove: (g: Group, i: number, dir: -1 | 1) => void;
  onSwap: (g: Group, i: number) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", dot)} />
          <div>
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <p className="text-[10px] text-ink-faint">{hint}</p>
          </div>
        </div>
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.Plus width={12} height={12} />
          Add
        </button>
      </div>

      {features.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[11px] text-ink-faint">
          Nothing here yet. Add a feature, or move one over from the other column.
        </p>
      ) : (
        <div className="space-y-2">
          {features.map((f, i) => (
            <FeatureCard
              key={i}
              feature={f}
              accent={accent}
              index={i}
              isFirst={i === 0}
              isLast={i === features.length - 1}
              onChange={(p) => onUpdate(group, i, p)}
              onDelete={() => onDelete(group, i)}
              onMoveUp={() => onMove(group, i, -1)}
              onMoveDown={() => onMove(group, i, 1)}
              onSwapGroup={() => onSwap(group, i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EditableList({
  title,
  placeholder,
  items,
  onChange,
}: {
  title: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const update = (i: number, v: string) =>
    onChange(items.map((it, idx) => (idx === i ? v : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, ""]);

  return (
    <section className="rounded-2xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          {title}
        </h3>
        <button
          onClick={add}
          className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-ink-muted transition hover:text-ink"
        >
          + Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-ink-faint">None.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <input
                value={it}
                onChange={(e) => update(i, e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
              <button
                onClick={() => remove(i)}
                aria-label="Remove"
                className="shrink-0 rounded p-1 text-ink-faint transition hover:text-red-400"
              >
                <Icon.Close width={12} height={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EngineBadge({ engine }: { engine: Engine }) {
  const ai = engine === "ai";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        ai ? "bg-brand/15 text-brand" : "bg-panel-2 text-ink-faint",
      )}
      title={ai ? "Drafted by AI" : "Offline draft (no AI key configured)"}
    >
      <Icon.Sparkles width={10} height={10} />
      {ai ? "AI draft" : "Offline draft"}
    </span>
  );
}

function Spinner() {
  return (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  );
}
