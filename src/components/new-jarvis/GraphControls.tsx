"use client";

// ---------------------------------------------------------------------------
// The instrument panel beside the graph.
//
// Two sliders, a search box, and the source filters. The sliders are the point:
// Repel and Line length are not settings stored somewhere, they are two
// arguments of the simulation's own step function, so dragging one makes the
// whole graph inhale and re-settle in front of you. That is why they are
// sliders and not a preferences dialog.
//
// Chrome here is deliberately greyscale. The only colour on this surface comes
// from the data — the eight source hues and the ghost grey — which is the
// discipline that keeps a dense panel readable rather than a parrot.
// ---------------------------------------------------------------------------

import { Icon } from "../icons";
import { GHOST_COLOR, SOURCE_COLOR } from "@/lib/jarvis/graph/palette";
import { MEMORY_SOURCES, SOURCE_LABEL, type MemorySource } from "@/lib/jarvis/types";
import type { ForceParams } from "@/lib/jarvis/graph/types";

interface Props {
  params: ForceParams;
  onParams: (patch: Partial<ForceParams>) => void;
  search: string;
  onSearch: (q: string) => void;
  matches: number;
  counts: Map<string, number>;
  ghosts: number;
  muted: Set<MemorySource>;
  onToggleSource: (s: MemorySource) => void;
  onResettle: () => void;
  moving: boolean;
}

/**
 * One labelled slider.
 *
 * The value is shown as a number, in tabular figures, because "Repel" with no
 * readout is a control you cannot return to a setting you liked.
 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint: string;
}) {
  return (
    <label className="block" title={hint}>
      <span className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</span>
        <span className="font-mono text-[10.5px] text-ink-muted" data-num>
          {value.toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="nj-slider mt-1 w-full"
      />
    </label>
  );
}

export function GraphControls({
  params,
  onParams,
  search,
  onSearch,
  matches,
  counts,
  ghosts,
  muted,
  onToggleSource,
  onResettle,
  moving,
}: Props) {
  const present = MEMORY_SOURCES.filter((s) => (counts.get(s) ?? 0) > 0);

  return (
    <div className="space-y-4 p-3">
      {/* --- search ------------------------------------------------------ */}
      <div>
        <div className="relative">
          <Icon.Search
            width={12}
            height={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Find a note, a folder, a tag"
            aria-label="Search the graph"
            className="w-full rounded-md border border-line bg-panel-2 py-1.5 pl-7 pr-7 font-mono text-[11.5px] text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch("")}
              aria-label="Clear the search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint transition hover:text-ink"
            >
              <Icon.Close width={10} height={10} />
            </button>
          )}
        </div>
        {search && (
          <p className="mt-1 text-[10.5px] text-ink-muted" data-num>
            {matches === 0 ? "Nothing matches — the graph is unchanged." : `${matches} lit, the rest dimmed.`}
          </p>
        )}
      </div>

      {/* --- physics ----------------------------------------------------- */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Physics</h3>
          <button
            type="button"
            onClick={onResettle}
            className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
            title="Shake the layout loose and let it find a new arrangement"
          >
            <Icon.Refresh width={9} height={9} aria-hidden />
            Re-settle
          </button>
        </div>
        <Slider
          label="Repel"
          value={params.repel}
          min={0}
          max={0.25}
          step={0.005}
          onChange={(repel) => onParams({ repel })}
          hint="How hard unconnected notes push each other apart."
        />
        <Slider
          label="Line length"
          value={params.linkDistance}
          min={0.1}
          max={2}
          step={0.02}
          onChange={(linkDistance) => onParams({ linkDistance })}
          hint="How long a link wants to be. Linked notes settle at about this distance."
        />
        <p className="text-[10px] leading-relaxed text-ink-faint">
          {moving ? "Settling…" : "Settled. Move a slider and it re-settles."}
        </p>
      </div>

      {/* --- what is on screen -------------------------------------------- */}
      <div className="space-y-1.5">
        <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Sources</h3>
        {present.length === 0 ? (
          <p className="text-[10.5px] text-ink-faint">Nothing indexed yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {present.map((source) => {
              const off = muted.has(source);
              return (
                <li key={source}>
                  <button
                    type="button"
                    onClick={() => onToggleSource(source)}
                    aria-pressed={!off}
                    className="group flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition hover:bg-panel-2"
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: off ? "#2b3040" : SOURCE_COLOR[source] }}
                      aria-hidden
                    />
                    <span className={`flex-1 text-[11px] ${off ? "text-ink-faint line-through" : "text-ink-muted"}`}>
                      {SOURCE_LABEL[source]}
                    </span>
                    <span className="font-mono text-[10.5px] text-ink-faint" data-num>
                      {counts.get(source) ?? 0}
                    </span>
                  </button>
                </li>
              );
            })}
            {ghosts > 0 && (
              <li className="flex items-center gap-2 px-1 py-0.5" title="Notes you have linked to and never written">
                <span className="size-1.5 shrink-0 rounded-full border" style={{ borderColor: GHOST_COLOR }} aria-hidden />
                <span className="flex-1 text-[11px] text-ink-muted">Not written yet</span>
                <span className="font-mono text-[10.5px] text-ink-faint" data-num>
                  {ghosts}
                </span>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
