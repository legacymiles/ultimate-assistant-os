"use client";

// Stage 3. Every file anyone will hand you of the song you confirmed, grouped
// by what you are actually allowed to do with it.
//
// The grouping is the design decision. Sorting purely by match score would put
// a "rights not verified" YouTube rip above a CC0 recording of the same piece,
// and the licence is the more consequential fact — it is the one you cannot
// hear by pressing play.

import { formatBytes, formatDuration } from "@/lib/mp3-download/match";
import {
  LICENCE_GROUP,
  LICENCE_ORDER,
  type Candidate,
  type LicenceKind,
  type Track,
} from "@/lib/mp3-download/types";
import type { SourceReport } from "@/lib/mp3-download/client";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { LicenceChip, MatchMeter, PlayButton } from "./bits";

export function SourceTable({
  track,
  candidates,
  checked,
  playingId,
  playing,
  audioLoading,
  busyId,
  doneIds,
  failure,
  onPreview,
  onDownload,
  onRecheck,
  rechecking,
}: {
  track: Track;
  candidates: Candidate[];
  checked: SourceReport[];
  playingId: string | null;
  playing: boolean;
  audioLoading: boolean;
  busyId: string | null;
  doneIds: Set<string>;
  failure: { id: string; message: string } | null;
  onPreview: (candidate: Candidate) => void;
  onDownload: (candidate: Candidate) => void;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const groups = LICENCE_ORDER.map((kind) => ({
    kind,
    rows: candidates.filter((c) => c.licence.kind === kind),
  })).filter((g) => g.rows.length > 0);

  return (
    <div>
      {/* Where we looked — stated, not implied. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2.5">
        <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Searched
        </span>
        {checked.map((source) => (
          <span
            key={source.id}
            title={source.note ?? undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-none",
              source.ok && source.count > 0
                ? "border-core/30 bg-core/10 text-core"
                : source.ok
                  ? "border-line bg-panel-2 text-ink-muted"
                  : "border-amber-400/30 bg-amber-400/10 text-amber-300",
            )}
          >
            {source.label}
            <span className="font-mono tabular-nums opacity-80">{source.ok ? source.count : "—"}</span>
          </span>
        ))}
        <button
          type="button"
          onClick={onRecheck}
          disabled={rechecking}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
        >
          <Icon.Refresh width={11} height={11} className={rechecking ? "animate-spin" : undefined} />
          {rechecking ? "Searching" : "Search again"}
        </button>
      </div>

      {/* A source that could not run says why, once, where it matters. */}
      {checked
        .filter((s) => s.note)
        .map((s) => (
          <p
            key={s.id + ":note"}
            className="border-b border-line bg-amber-400/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-amber-200"
          >
            <span className="font-semibold">{s.label}:</span> {s.note}
          </p>
        ))}

      {groups.length === 0 ? (
        <NoFiles track={track} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                <th scope="col" className="w-10 py-2 pl-3 pr-1" />
                <th scope="col" className="py-2 pr-3 font-semibold">
                  File
                </th>
                <th scope="col" className="hidden w-32 py-2 pr-3 font-semibold lg:table-cell">
                  Match
                </th>
                <th scope="col" className="w-16 py-2 pr-3 font-semibold">
                  Format
                </th>
                <th scope="col" className="w-20 py-2 pr-3 text-right font-semibold">
                  Size
                </th>
                <th scope="col" className="w-16 py-2 pr-3 text-right font-semibold">
                  Length
                </th>
                <th scope="col" className="w-32 py-2 pr-3" />
              </tr>
            </thead>

            {groups.map(({ kind, rows }) => (
              <GroupBody
                key={kind}
                kind={kind}
                rows={rows}
                track={track}
                playingId={playingId}
                playing={playing}
                audioLoading={audioLoading}
                busyId={busyId}
                doneIds={doneIds}
                failure={failure}
                onPreview={onPreview}
                onDownload={onDownload}
              />
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

function GroupBody({
  kind,
  rows,
  track,
  playingId,
  playing,
  audioLoading,
  busyId,
  doneIds,
  failure,
  onPreview,
  onDownload,
}: {
  kind: LicenceKind;
  rows: Candidate[];
  track: Track;
  playingId: string | null;
  playing: boolean;
  audioLoading: boolean;
  busyId: string | null;
  doneIds: Set<string>;
  failure: { id: string; message: string } | null;
  onPreview: (c: Candidate) => void;
  onDownload: (c: Candidate) => void;
}) {
  const group = LICENCE_GROUP[kind];
  return (
    <tbody>
      <tr>
        <th colSpan={7} scope="colgroup" className="border-y border-line bg-panel-2/60 px-3 py-2 text-left">
          <span className="block text-[12px] font-semibold text-ink">{group.title}</span>
          <span className="mt-0.5 block max-w-[62ch] text-[11px] font-normal leading-relaxed text-ink-muted">
            {group.note}
          </span>
        </th>
      </tr>

      {rows.map((c) => {
        const isPlaying = playingId === c.id;
        const busy = busyId === c.id;
        const done = doneIds.has(c.id);
        const failed = failure?.id === c.id;
        const delta = c.durationMs != null ? c.durationMs - track.durationMs : null;

        return (
          <tr
            key={c.id}
            className="group border-b border-line-soft align-middle transition-colors last:border-0 hover:bg-panel-2/60"
          >
            <td className="py-2 pl-3 pr-1">
              {c.provider === "youtube" ? (
                // A YouTube row has no direct audio URL to audition — the file
                // only exists once yt-dlp has made it. The honest control is a
                // link to the video, not a play button that cannot play.
                <a
                  href={c.pageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Watch it on YouTube"
                  aria-label={"Watch " + c.title + " on YouTube"}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-panel-2 text-ink-muted transition hover:border-brand/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                >
                  <Icon.Launch width={12} height={12} />
                </a>
              ) : (
                <PlayButton
                  active={isPlaying}
                  playing={isPlaying && playing}
                  loading={isPlaying && audioLoading}
                  onClick={() => onPreview(c)}
                  label={c.title}
                />
              )}
            </td>

            <td className="max-w-[24rem] py-2 pr-3">
              <span className="block truncate text-[13px] font-medium leading-tight text-ink">
                {c.title}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                <a
                  href={c.pageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded underline decoration-line underline-offset-[3px] transition hover:text-ink hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                >
                  {c.providerLabel}
                  <Icon.Launch width={9} height={9} />
                </a>
                <span aria-hidden className="text-ink-faint">
                  ·
                </span>
                <span className="truncate">{c.creator}</span>
                <LicenceChip licence={c.licence} />
              </span>
              {failed && (
                <span className="mt-1 block text-[11px] leading-snug text-amber-300">
                  {failure?.message}
                </span>
              )}
            </td>

            <td className="hidden py-2 pr-3 lg:table-cell">
              <MatchMeter score={c.score} reasons={c.reasons} />
            </td>

            <td className="py-2 pr-3 font-mono text-[11px] text-ink-muted">{c.format}</td>

            <td className="py-2 pr-3 text-right font-mono text-[11.5px] tabular-nums text-ink-muted">
              {formatBytes(c.bytes)}
            </td>

            <td className="py-2 pr-3 text-right">
              <span className="block font-mono text-[11.5px] tabular-nums text-ink-muted">
                {formatDuration(c.durationMs)}
              </span>
              {delta != null && Math.abs(delta) > 2000 && (
                <span
                  className="block font-mono text-[10px] tabular-nums text-ink-faint"
                  title={"Compared with the confirmed track"}
                >
                  {delta > 0 ? "+" : "−"}
                  {formatDuration(Math.abs(delta))}
                </span>
              )}
            </td>

            <td className="py-2 pr-3 text-right">
              <button
                type="button"
                onClick={() => onDownload(c)}
                disabled={busy}
                className={cn(
                  "inline-flex min-w-[6.5rem] items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11.5px] font-semibold transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
                  busy
                    ? "cursor-progress border-brand/50 bg-brand/15 text-ink"
                    : done
                      ? "border-core/40 bg-core/10 text-core hover:bg-core/20"
                      : "border-line bg-panel-2 text-ink hover:border-brand/50 hover:bg-brand/10",
                )}
              >
                {busy ? (
                  <>
                    <Icon.Refresh width={12} height={12} className="animate-spin" />
                    Fetching
                  </>
                ) : done ? (
                  <>
                    <Icon.Check width={12} height={12} />
                    Saved
                  </>
                ) : (
                  <>
                    <Icon.Download width={12} height={12} />
                    Download
                  </>
                )}
              </button>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}

function NoFiles({ track }: { track: Track }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-[14px] font-semibold text-ink">
        Nothing downloadable turned up for this recording
      </p>
      <p className="mx-auto mt-2 max-w-[56ch] text-[12.5px] leading-relaxed text-ink-muted">
        {track.title} is confirmed, but none of the sources hold a file of it. The open-licence
        catalogues skew heavily toward classical, live sets and independent releases; with yt-dlp
        installed, YouTube is searched too.
      </p>
    </div>
  );
}
