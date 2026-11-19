"use client";

import { SOURCES, categoriesWithoutFeed } from "@/lib/ai-rankings/sources";
import { releasedLabel } from "@/lib/ai-rankings/leaderboard";

/**
 * Where the board's models and numbers come from.
 *
 * A leaderboard that updates itself has to say so, and say what it is reading
 * — otherwise "checked daily" is a claim the reader has no way to weigh. Each
 * row names a real call the daily job makes, what that feed can see, and the
 * page to check it on by hand. The categories no feed covers are named too:
 * quiet because nothing shipped and quiet because nothing is watching look
 * identical from outside, and only one of them is honest.
 */
export function SourcePanel({
  lastSweepAt,
  lastSweepNote,
  canEdit,
  now,
}: {
  lastSweepAt?: string | null;
  lastSweepNote?: string | null;
  canEdit: boolean;
  now: number;
}) {
  const noFeed = categoriesWithoutFeed();
  const checked = lastSweepAt ? releasedLabel(lastSweepAt.slice(0, 10), now) : null;

  return (
    <section aria-labelledby="sources-h" className="mt-10 rounded-[10px] border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <h2 id="sources-h" className="text-[12.5px] font-medium text-ink">
          Where new models come from
        </h2>
        <p className="text-[11px] text-ink-muted">
          Checked automatically every day
          {canEdit && checked ? <> · last run {checked}</> : null}
        </p>
      </div>

      <ul className="divide-y divide-line-soft">
        {SOURCES.map((s) => (
          <li key={s.id} className="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto]">
            <p className="text-[12.5px] font-medium text-ink">
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-line underline-offset-2 hover:decoration-ink-faint"
                >
                  {s.name}
                </a>
              ) : (
                s.name
              )}
            </p>
            <p className="text-[12px] leading-relaxed text-ink-muted">
              {s.what}. <span className="text-ink-faint">{s.covers}.</span>
            </p>
            <p className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-ink-muted sm:text-right">
              {s.cadence}
            </p>
          </li>
        ))}
      </ul>

      <div className="space-y-1 border-t border-line px-4 py-2.5">
        {noFeed.length > 0 && (
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            No feed covers {listed(noFeed)} yet — nothing trends for them and no arena scores them, so those are added
            by hand or from a pasted link.
          </p>
        )}
        {canEdit && lastSweepNote && (
          <p className="font-mono text-[11px] leading-relaxed text-ink-muted">Last run: {lastSweepNote}</p>
        )}
      </div>
    </section>
  );
}

/** "a, b and c" — the list read out, not comma-spliced. */
function listed(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
