"use client";

import { useMemo, useState } from "react";
import { Icon } from "../../icons";
import { categoryPath, groupByDestination } from "@/lib/recall/photos/store";
import type { DestGroup } from "@/lib/recall/photos/store";
import type { PendingPhoto, PhotosData } from "@/lib/recall/photos/types";
import { formatDayKey, formatTime } from "@/lib/recall/calendar/types";

// ---------------------------------------------------------------------------
// The review queue.
//
// The whole design turns on one number: how many clicks it costs to accept a
// hundred correct guesses. Per-photo approval costs a hundred. Grouping by
// DESTINATION costs one per folder — and it is also the only grouping that
// makes the mistakes visible, because a wrongly-labelled photo shows up as the
// one face that does not belong in an otherwise consistent wall of thumbnails.
//
// So: destinations are sections, the biggest section leads, and a section is
// approved whole. Fixing one photo is the exception, and it lives one click
// deeper rather than in everyone's way.
// ---------------------------------------------------------------------------

interface Props {
  pending: PendingPhoto[];
  photos: PhotosData;
  busy: boolean;
  onApprove: (photoIds: string[]) => void;
  onReject: (photoIds: string[]) => void;
  onRetarget: (photoId: string, path: string[], categoryId: string | null) => void;
  onReanalyze: (photoId: string) => void;
}

export function ReviewQueue({
  pending,
  photos,
  busy,
  onApprove,
  onReject,
  onRetarget,
  onReanalyze,
}: Props) {
  const [detail, setDetail] = useState<string | null>(null);
  const groups = useMemo(() => groupByDestination(pending), [pending]);
  const analyzing = pending.filter((p) => p.status === "analyzing").length;
  const failed = pending.filter((p) => p.status === "failed");
  const ready = pending.filter((p) => p.status === "ready");
  const detailPhoto = pending.find((p) => p.id === detail) ?? null;

  if (pending.length === 0) return null;

  return (
    <div className="mb-5 rounded-2xl border border-amber-400/30 bg-amber-400/[0.04] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300">
          <Icon.Inbox width={15} height={15} />
        </span>
        <span className="text-sm font-semibold text-ink">
          {ready.length} {ready.length === 1 ? "photo" : "photos"} to review
        </span>
        {analyzing > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
            reading {analyzing} more
          </span>
        )}
        {ready.length > 0 && (
          <span className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => onApprove(ready.map((p) => p.id))}
              disabled={busy}
              className="rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
            >
              Approve everything ({ready.length})
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Discard all ${ready.length} photos waiting for review?`))
                  onReject(ready.map((p) => p.id));
              }}
              disabled={busy}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-red-400 disabled:opacity-40"
            >
              Discard all
            </button>
          </span>
        )}
      </div>

      {analyzing > 0 && ready.length === 0 && (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {pending
            .filter((p) => p.status === "analyzing")
            .slice(0, 16)
            .map((p) => (
              <span key={p.id} className="relative aspect-square overflow-hidden rounded-lg bg-panel-2">
                {p.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumb} alt="" className="h-full w-full object-cover opacity-40" />
                )}
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-amber-300" />
                </span>
              </span>
            ))}
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
          <GroupSection
            key={g.key}
            group={g}
            busy={busy}
            onApprove={onApprove}
            onReject={onReject}
            onOpen={setDetail}
          />
        ))}
      </div>

      {failed.length > 0 && (
        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
          {failed.length} {failed.length === 1 ? "photo" : "photos"} couldn&apos;t be read.{" "}
          <button
            onClick={() => failed.forEach((p) => onReanalyze(p.id))}
            className="underline hover:text-red-200"
          >
            Try again
          </button>{" "}
          or{" "}
          <button
            onClick={() => onReject(failed.map((p) => p.id))}
            className="underline hover:text-red-200"
          >
            discard them
          </button>
          .
        </p>
      )}

      {detailPhoto && (
        <PhotoDetail
          photo={detailPhoto}
          photos={photos}
          onClose={() => setDetail(null)}
          onApprove={() => {
            onApprove([detailPhoto.id]);
            setDetail(null);
          }}
          onReject={() => {
            onReject([detailPhoto.id]);
            setDetail(null);
          }}
          onRetarget={(path, catId) => onRetarget(detailPhoto.id, path, catId)}
          onReanalyze={() => onReanalyze(detailPhoto.id)}
        />
      )}
    </div>
  );
}

function GroupSection({
  group,
  busy,
  onApprove,
  onReject,
  onOpen,
}: {
  group: DestGroup;
  busy: boolean;
  onApprove: (ids: string[]) => void;
  onReject: (ids: string[]) => void;
  onOpen: (id: string) => void;
}) {
  const ids = group.photos.map((p) => p.id);
  const isEventGroup = group.photos.some((p) => p.analysis?.route === "event");

  return (
    <div className="rounded-xl border border-line bg-panel p-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Icon.Folder width={13} height={13} className="shrink-0 text-amber-300" />
        <span className="text-[12.5px] font-semibold text-ink">{group.label}</span>
        <span className="rounded-full bg-panel-2 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-muted">
          {group.photos.length}
        </span>
        {isEventGroup && (
          <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand">
            Also goes on the calendar
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => onApprove(ids)}
            disabled={busy}
            className="rounded-lg bg-brand px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
          >
            Approve all {group.photos.length}
          </button>
          <button
            onClick={() => onReject(ids)}
            disabled={busy}
            aria-label={`Discard all ${group.photos.length}`}
            className="rounded-lg border border-line p-1.5 text-ink-faint transition hover:text-red-400 disabled:opacity-40"
          >
            <Icon.Trash width={12} height={12} />
          </button>
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {group.photos.map((p) => (
          <button
            key={p.id}
            onClick={() => onOpen(p.id)}
            title={p.analysis?.title ?? p.name}
            className="group relative aspect-square overflow-hidden rounded-lg bg-panel-2 ring-offset-2 ring-offset-panel transition hover:ring-2 hover:ring-brand"
          >
            {p.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.thumb} alt={p.analysis?.title ?? p.name} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-ink-faint">
                <Icon.Image width={16} height={16} />
              </span>
            )}
            {p.overridden && (
              <span className="absolute left-1 top-1 rounded bg-canvas/80 px-1 text-[8px] font-semibold uppercase tracking-wider text-ink-muted backdrop-blur">
                Moved
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/80 to-transparent px-1 pb-0.5 pt-3 text-[9px] leading-tight text-white group-hover:block">
              <span className="line-clamp-2">{p.analysis?.title ?? p.name}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ----- one photo -----------------------------------------------------------

function PhotoDetail({
  photo,
  photos,
  onClose,
  onApprove,
  onReject,
  onRetarget,
  onReanalyze,
}: {
  photo: PendingPhoto;
  photos: PhotosData;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRetarget: (path: string[], categoryId: string | null) => void;
  onReanalyze: () => void;
}) {
  const [pathText, setPathText] = useState((photo.destPath ?? []).join(" / "));
  const a = photo.analysis;
  const nameOf = new Map(photos.people.map((p) => [p.id, p.name]));

  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-lg rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          {photo.thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo.thumb}
              alt={a?.title ?? photo.name}
              className="h-24 w-24 shrink-0 rounded-xl object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{a?.title ?? photo.name}</p>
            <p className="mt-0.5 text-[11px] text-ink-faint">{photo.name}</p>
            {a && (
              <span
                className={
                  "mt-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider " +
                  (a.route === "people"
                    ? "bg-amber-400/15 text-amber-300"
                    : a.route === "event"
                      ? "bg-brand/15 text-brand"
                      : "bg-panel-2 text-ink-muted")
                }
              >
                {a.route === "people" ? "People" : a.route === "event" ? "Event" : "Information"}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={15} height={15} />
          </button>
        </div>

        {a?.caption && (
          <p className="mb-3 text-[12px] leading-relaxed text-ink-muted">{a.caption}</p>
        )}

        {a && a.route === "people" && (
          <div className="mb-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Who Dashboard saw
            </p>
            {a.people.length === 0 && a.unknownPeople === 0 ? (
              <p className="text-[11.5px] text-ink-faint">
                Nobody recognised. Add reference photos in People and re-read this one.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {a.people.map((h) => (
                  <span
                    key={h.personId}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200"
                    title={`${Math.round(h.confidence * 100)}% confident`}
                  >
                    {nameOf.get(h.personId) ?? "Someone"}
                    <span className="text-[9px] tabular-nums opacity-70">
                      {Math.round(h.confidence * 100)}%
                    </span>
                  </span>
                ))}
                {a.unknownPeople > 0 && (
                  <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted">
                    +{a.unknownPeople} unrecognised
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {a?.event && (
          <div className="mb-3 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
              Goes on your calendar
            </p>
            <p className="text-[12.5px] font-medium text-ink">{a.event.title}</p>
            <p className="text-[11px] text-ink-muted">
              {a.event.date ? formatDayKey(a.event.date) : "No date found in the image"}
              {a.event.time ? ` · ${formatTime(a.event.time)}` : ""}
              {a.event.location ? ` · ${a.event.location}` : ""}
            </p>
            {!a.event.date && (
              <p className="mt-1 text-[10.5px] text-amber-300">
                It will land on today so you can&apos;t lose it — fix the date in Calendar after
                approving.
              </p>
            )}
          </div>
        )}

        {a?.text && (
          <details className="mb-3">
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-ink-faint hover:text-ink">
              Text read out of the image
            </summary>
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-canvas p-2 text-[11px] leading-relaxed text-ink-muted">
              {a.text}
            </p>
          </details>
        )}

        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          File it into
        </p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {photos.categories.slice(0, 10).map((c) => {
            const path = categoryPath(c);
            const active = pathText.trim() === path.join(" / ");
            return (
              <button
                key={c.id}
                onClick={() => {
                  setPathText(path.join(" / "));
                  onRetarget(path, c.id);
                }}
                className={
                  "rounded-full border px-2 py-0.5 text-[11px] transition " +
                  (active
                    ? "border-amber-400 bg-amber-400/15 font-medium text-amber-200"
                    : "border-line text-ink-muted hover:text-ink")
                }
              >
                {c.name}
              </button>
            );
          })}
        </div>
        <input
          value={pathText}
          onChange={(e) => setPathText(e.target.value)}
          onBlur={() =>
            onRetarget(
              pathText.split(/\s*\/\s*|\s*›\s*/).map((s) => s.trim()).filter(Boolean),
              null,
            )
          }
          placeholder="Photos / Me & My Son"
          className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onReject}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:border-red-500/40 hover:text-red-400"
          >
            Discard
          </button>
          <button
            onClick={onReanalyze}
            title="Read this photo again — useful after adding a new person"
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
          >
            Re-read
          </button>
          <button
            onClick={onApprove}
            className="ml-auto rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2"
          >
            File it
          </button>
        </div>
      </div>
    </div>
  );
}
