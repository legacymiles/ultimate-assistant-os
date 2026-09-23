"use client";

// ---------------------------------------------------------------------------
// The sheet behind every block.
//
// A video block opens the whole thing: the prompt, the camera deck, the
// reference images, how long it runs. A lip-sync range opens a much smaller
// panel, because a lip-sync range is four numbers and a delete button — it
// has no prompt and never will.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from "react";
import { SINGS, blockSkin, secs, timecode } from "@/lib/seedance/constants";
import { composePrompt } from "@/lib/seedance/prompt";
import {
  MAX_BLOCK_SEC,
  MAX_LIP_SEC,
  MIN_BLOCK_SEC,
  MIN_LIP_SEC,
} from "@/lib/seedance/reel";
import type { LipRange, PlacedPrompt, Reel, VideoPrompt } from "@/lib/seedance/types";
import type { CinemaSelection } from "@/lib/studio/cinema";
import { selectionCount } from "@/lib/studio/cinema";
import { Icon } from "../icons";
import { Chip, CinemaBar } from "../jarvis/CinemaDeck";

export type SheetTarget =
  | { kind: "prompt"; placed: PlacedPrompt }
  | { kind: "lip"; range: LipRange; coveredCount: number };

export function PromptSheet({
  reel,
  target,
  onClose,
  onPatch,
  onResize,
  onAddRefs,
  onRemoveRef,
  onRender,
  onDuplicate,
  onAddAfter,
  onDelete,
  onMoveLip,
  onDeleteLip,
}: {
  reel: Reel;
  target: SheetTarget;
  onClose: () => void;
  onPatch: (patch: Partial<VideoPrompt>) => void;
  onResize: (durationSec: number) => void;
  onAddRefs: (files: FileList) => void;
  onRemoveRef: (refId: string) => void;
  onRender: () => void;
  onDuplicate: () => void;
  onAddAfter: () => void;
  onDelete: () => void;
  onMoveLip: (startSec: number, durationSec: number) => void;
  onDeleteLip: () => void;
}) {
  if (target.kind === "lip") {
    return (
      <LipPanel
        range={target.range}
        coveredCount={target.coveredCount}
        onClose={onClose}
        onMove={onMoveLip}
        onDelete={onDeleteLip}
      />
    );
  }
  return (
    <BlockPanel
      reel={reel}
      placed={target.placed}
      onClose={onClose}
      onPatch={onPatch}
      onResize={onResize}
      onAddRefs={onAddRefs}
      onRemoveRef={onRemoveRef}
      onRender={onRender}
      onDuplicate={onDuplicate}
      onAddAfter={onAddAfter}
      onDelete={onDelete}
    />
  );
}

// ---------------------------------------------------------------------------
// A video prompt — the only place a prompt lives.
// ---------------------------------------------------------------------------

function BlockPanel({
  reel,
  placed,
  onClose,
  onPatch,
  onResize,
  onAddRefs,
  onRemoveRef,
  onRender,
  onDuplicate,
  onAddAfter,
  onDelete,
}: {
  reel: Reel;
  placed: PlacedPrompt;
  onClose: () => void;
  onPatch: (patch: Partial<VideoPrompt>) => void;
  onResize: (durationSec: number) => void;
  onAddRefs: (files: FileList) => void;
  onRemoveRef: (refId: string) => void;
  onRender: () => void;
  onDuplicate: () => void;
  onAddAfter: () => void;
  onDelete: () => void;
}) {
  const { block, index, startSec, durationSec, lipSynced, lipSec } = placed;
  const skin = blockSkin(lipSynced);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showFull, setShowFull] = useState(false);
  const own = selectionCount(block.cinema);
  const rendering = block.status === "generating";

  const full = useMemo(
    () => composePrompt({ reel, block, lipSynced }),
    [reel, block, lipSynced],
  );

  return (
    <aside className="sd-sheet flex h-full w-full flex-col border-l border-line bg-panel" aria-label="Video prompt">
      <header className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-semibold tabular-nums"
          style={{ background: skin.fill, border: `1px solid ${skin.edge}`, color: skin.text }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
            Video prompt
            {lipSynced && (
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em]"
                style={{ background: SINGS.fill, color: SINGS.text }}
              >
                <Icon.Mic width={9} height={9} />
                Lip sync
              </span>
            )}
          </h2>
          <p className="text-[10.5px] tabular-nums text-ink-muted">
            {timecode(startSec, true)} → {timecode(startSec + durationSec, true)} · {secs(durationSec)}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.Close width={14} height={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3">
        {/* How long it runs */}
        <section className="space-y-2 rounded-lg border border-line bg-panel-2/60 p-2.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
              Runs for
            </h3>
            <span className="text-[11px] font-medium tabular-nums text-ink">{secs(durationSec)}</span>
          </div>
          <input
            type="range"
            min={MIN_BLOCK_SEC * 10}
            max={MAX_BLOCK_SEC * 10}
            value={Math.round(durationSec * 10)}
            onChange={(e) => onResize(Number(e.target.value) / 10)}
            aria-label="How long this shot runs"
            className="sd-range w-full"
          />
          <p className="text-[10px] leading-relaxed text-ink-muted">
            {lipSynced ? (
              <>
                A lip-sync range covers {secs(lipSec)} of this shot, so it sings. Move the range on
                the Lip sync lane to change that — nothing is set here.
              </>
            ) : (
              <>This shot plays under the music. Drop a range on the Lip sync lane to make it sing.</>
            )}
          </p>
        </section>

        {/* The prompt + the deck */}
        <section className="space-y-2">
          <h3 className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
            This shot
          </h3>
          <textarea
            value={block.prompt}
            onChange={(e) => onPatch({ prompt: e.target.value })}
            rows={5}
            placeholder="Subject, action, place. What is on screen for these seconds…"
            className="w-full resize-y rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
          <p className="text-[10px] text-ink-faint">
            Type <span className="font-mono text-ink-muted">#dolly-in</span> for a camera move — the
            order you write them in is the order the camera does them.
          </p>

          <CinemaBar
            selection={block.cinema}
            onSelection={(cinema: CinemaSelection) => onPatch({ cinema })}
            text={block.prompt}
            onText={(prompt: string) => onPatch({ prompt })}
            lead={
              <Chip
                art={null}
                label="Images"
                value={block.refs.length ? `${block.refs.length} attached` : ""}
                onClick={() => fileRef.current?.click()}
              >
                <span className="flex h-full w-full items-center justify-center text-ink-muted">
                  {block.refs.find((r) => r.kind === "image" && r.url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={block.refs.find((r) => r.kind === "image" && r.url)!.url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Icon.Image width={16} height={16} />
                  )}
                </span>
              </Chip>
            }
          />

          {own > 0 && (
            <button
              onClick={() => onPatch({ cinema: {} })}
              className="text-[10px] font-medium text-ink-muted underline decoration-line underline-offset-2 transition hover:text-ink"
            >
              Clear this shot&rsquo;s {own} override{own === 1 ? "" : "s"} and follow the film
            </button>
          )}
        </section>

        {/* Images */}
        <section className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
              Images
            </h3>
            <button
              onClick={() => fileRef.current?.click()}
              className="text-[10px] font-medium text-accent transition hover:text-accent-2"
            >
              Add
            </button>
          </div>
          {block.refs.length ? (
            <ul className="grid grid-cols-4 gap-1.5">
              {block.refs.map((r) => (
                <li
                  key={r.id}
                  className="group relative aspect-square overflow-hidden rounded-md border border-line bg-canvas"
                >
                  {r.kind === "image" && r.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.url} alt={r.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-ink-faint">
                      <Icon.Film width={14} height={14} />
                    </span>
                  )}
                  <button
                    onClick={() => onRemoveRef(r.id)}
                    aria-label={`Remove ${r.name}`}
                    className="absolute right-0.5 top-0.5 rounded bg-canvas/85 p-0.5 text-ink-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Icon.Close width={9} height={9} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-3 text-[11px] font-medium text-ink-muted transition hover:border-accent hover:text-ink"
            >
              <Icon.Upload width={12} height={12} />
              The first image becomes this block&rsquo;s artwork
            </button>
          )}
        </section>

        {/* What the model actually reads */}
        <section className="rounded-lg border border-line bg-canvas/60">
          <button
            onClick={() => setShowFull((v) => !v)}
            aria-expanded={showFull}
            className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left"
          >
            <Icon.Chevron
              width={12}
              height={12}
              className={"text-ink-faint transition-transform " + (showFull ? "rotate-90" : "")}
            />
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
              What Seedance reads
            </span>
            <span className="ml-auto text-[9.5px] tabular-nums text-ink-faint">
              {full.length} chars
            </span>
          </button>
          {showFull && (
            <p className="border-t border-line-soft px-2.5 py-2 text-[11px] leading-relaxed text-ink-muted">
              {full}
            </p>
          )}
        </section>

        {block.status === "error" && block.error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300">
            {block.error}
          </p>
        )}

        {/* Keep writing without going back to the timeline. */}
        <button
          onClick={onAddAfter}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2.5 text-[11.5px] font-medium text-ink-muted transition hover:border-accent hover:text-ink"
        >
          <Icon.Plus width={13} height={13} />
          Add the next prompt
        </button>
      </div>

      <footer className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <button
          onClick={onRender}
          disabled={rendering}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-canvas transition hover:bg-accent-2 disabled:opacity-50"
        >
          {rendering ? (
            <>
              <Icon.Refresh width={13} height={13} className="animate-spin" />
              Rendering…
            </>
          ) : (
            <>
              <Icon.Sparkles width={13} height={13} />
              Render this shot
            </>
          )}
        </button>
        <button
          onClick={onDuplicate}
          aria-label="Duplicate this prompt"
          title="Duplicate this prompt"
          className="rounded-lg border border-line p-2 text-ink-faint transition hover:border-accent hover:text-ink"
        >
          <Icon.Copy width={14} height={14} />
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete this prompt"
          title="Delete this prompt"
          className="rounded-lg border border-line p-2 text-ink-faint transition hover:border-red-500/50 hover:text-red-400"
        >
          <Icon.Trash width={14} height={14} />
        </button>
      </footer>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onAddRefs(e.target.files);
          e.target.value = "";
        }}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// A lip-sync range — timing and nothing else.
// ---------------------------------------------------------------------------

function LipPanel({
  range,
  coveredCount,
  onClose,
  onMove,
  onDelete,
}: {
  range: LipRange;
  coveredCount: number;
  onClose: () => void;
  onMove: (startSec: number, durationSec: number) => void;
  onDelete: () => void;
}) {
  return (
    <aside className="sd-sheet flex h-full w-full flex-col border-l border-line bg-panel" aria-label="Lip sync range">
      <header className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded"
          style={{ background: SINGS.fill, border: `1px solid ${SINGS.edge}`, color: SINGS.text }}
        >
          <Icon.Mic width={12} height={12} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">Lip sync</h2>
          <p className="text-[10.5px] tabular-nums text-ink-muted">
            {timecode(range.startSec, true)} → {timecode(range.startSec + range.durationSec, true)} ·{" "}
            {secs(range.durationSec)}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.Close width={14} height={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3">
        <p className="rounded-lg border border-line bg-panel-2/60 p-2.5 text-[11px] leading-relaxed text-ink-muted">
          This range holds no prompt. It marks the seconds of the song that get sung — whichever
          video prompts it lands on turn amber and lip-sync to the audio underneath them.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Stepper
            label="Starts at"
            value={range.startSec}
            step={0.1}
            format={(v) => timecode(v, true)}
            onChange={(v) => onMove(v, range.durationSec)}
          />
          <Stepper
            label="Runs for"
            value={range.durationSec}
            step={0.5}
            min={MIN_LIP_SEC}
            max={MAX_LIP_SEC}
            format={(v) => secs(v)}
            onChange={(v) => onMove(range.startSec, v)}
          />
        </div>

        <p className="text-[11px] text-ink-muted">
          Currently over{" "}
          <span className="font-medium text-ink">
            {coveredCount} video prompt{coveredCount === 1 ? "" : "s"}
          </span>
          . Drag it on the timeline, or trim either edge.
        </p>
      </div>

      <footer className="border-t border-line px-3 py-2.5">
        <button
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12px] font-medium text-ink-muted transition hover:border-red-500/50 hover:text-red-400"
        >
          <Icon.Trash width={13} height={13} />
          Delete this range
        </button>
      </footer>
    </aside>
  );
}

function Stepper({
  label,
  value,
  step,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  format,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 10) / 10)));
  return (
    <div>
      <span className="mb-1 block text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </span>
      <div className="flex items-center rounded-md border border-line bg-canvas">
        <button
          onClick={() => set(value - step)}
          aria-label={`${label}: down`}
          className="px-2 py-1.5 text-ink-faint transition hover:text-ink"
        >
          <span aria-hidden>&minus;</span>
        </button>
        <span className="flex-1 text-center text-[12px] font-medium tabular-nums text-ink">
          {format(value)}
        </span>
        <button
          onClick={() => set(value + step)}
          aria-label={`${label}: up`}
          className="px-2 py-1.5 text-ink-faint transition hover:text-ink"
        >
          <span aria-hidden>+</span>
        </button>
      </div>
    </div>
  );
}
