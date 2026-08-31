"use client";

import { useState } from "react";
import type { Feed, SourceStatus, WatchItem, WatchKind } from "@/lib/friends-night-out/types";

// ---------------------------------------------------------------------------
// Sources — why the list looks the way it does.
//
// Every adapter appears here as live or dark WITH ITS REASON, because a thin
// result set is otherwise indistinguishable from a broken app. "Needs
// TICKETMASTER_API_KEY" is a thing the user can act on; an empty list is not.
//
// This is also where the cold-start problem gets solved: "Find calendars near
// me" asks OpenStreetMap which institutions are in range and probes their sites
// for published calendars. Proposals only — the user picks.
// ---------------------------------------------------------------------------

export interface Discovered {
  label: string;
  url: string;
  kind: Feed["kind"];
  via: string;
  sampleCount: number;
}

export function SourcesPanel({
  statuses,
  feeds,
  watchlist,
  onAddFeed,
  onRemoveFeed,
  onToggleFeed,
  onAddWatch,
  onRemoveWatch,
  onDiscover,
  discovering,
  discovered,
  onAcceptDiscovered,
  aiSweepEnabled,
  onToggleAiSweep,
  onClose,
}: {
  statuses: SourceStatus[];
  feeds: Feed[];
  watchlist: WatchItem[];
  onAddFeed: (label: string, url: string) => void;
  onRemoveFeed: (id: string) => void;
  onToggleFeed: (id: string, enabled: boolean) => void;
  onAddWatch: (kind: WatchKind, name: string) => void;
  onRemoveWatch: (id: string) => void;
  onDiscover: () => void;
  discovering: boolean;
  discovered: Discovered[] | null;
  onAcceptDiscovered: (d: Discovered) => void;
  aiSweepEnabled: boolean;
  onToggleAiSweep: () => void;
  onClose: () => void;
}) {
  const [feedUrl, setFeedUrl] = useState("");
  const [watchName, setWatchName] = useState("");
  const [watchKind, setWatchKind] = useState<WatchKind>("artist");

  return (
    <aside className="space-y-5 rounded-xl border border-[#20242f] bg-[#0e1016] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[#e9ecf3]">Sources</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] text-[#6b7385] hover:text-[#9aa3b5]"
        >
          close
        </button>
      </div>

      <ul className="space-y-1.5">
        {statuses.map((s, i) => (
          <li
            key={`${s.id}-${s.label}-${i}`}
            className="rounded-lg border border-[#1c2029] bg-[#101219] px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: s.ok ? "#34d399" : "#475569" }}
              />
              <span className="text-[12.5px] text-[#c3cad9]">{s.label}</span>
              {s.count !== undefined ? (
                <span className="text-[11.5px] tabular-nums text-[#5b6478]">
                  {s.count}
                </span>
              ) : null}
            </div>
            {s.reason ? (
              <p className="mt-1 pl-3.5 text-[11.5px] leading-snug text-[#6b7385]">{s.reason}</p>
            ) : null}
            {s.error ? (
              <p className="mt-1 pl-3.5 text-[11.5px] leading-snug text-[#a06a3d]">{s.error}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-[12.5px] font-medium text-[#c3cad9]">Community calendars</h3>
          <button
            type="button"
            onClick={onDiscover}
            disabled={discovering}
            className="rounded-md bg-[#17384b] px-2.5 py-1 text-[11.5px] text-[#7dd3fc] disabled:opacity-50"
          >
            {discovering ? "Searching…" : "Find calendars near me"}
          </button>
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[#6b7385]">
          Libraries, parishes, parks departments, breweries and arts centres publish their
          calendars openly. This is where the events nobody hears about actually live.
        </p>

        {discovering ? (
          <p className="mt-2 text-[11.5px] text-[#6b7385]">
            Checking local institutions for published calendars — this takes a minute.
          </p>
        ) : null}

        {discovered && !discovering ? (
          discovered.length ? (
            <ul className="mt-2 space-y-1.5">
              {discovered.map((d) => (
                <li
                  key={d.url}
                  className="flex items-center gap-2 rounded-lg border border-[#1c3040] bg-[#0b1620] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] text-[#c3cad9]">{d.label}</p>
                    <p className="text-[11px] text-[#5b6478]">
                      {d.via} · {d.sampleCount} events · {d.kind}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAcceptDiscovered(d)}
                    className="ml-auto shrink-0 rounded-md bg-[#17384b] px-2 py-1 text-[11.5px] text-[#7dd3fc]"
                  >
                    add
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11.5px] text-[#a06a3d]">
              No published calendars found on local institutions&apos; sites. Try a wider radius,
              or paste a calendar URL below.
            </p>
          )
        ) : null}

        <ul className="mt-2 space-y-1.5">
          {feeds.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-lg border border-[#1c2029] bg-[#101219] px-3 py-2"
            >
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => onToggleFeed(f.id, e.target.checked)}
                className="shrink-0 accent-[#38bdf8]"
                aria-label={`Use ${f.label}`}
              />
              <div className="min-w-0">
                <p className="truncate text-[12.5px] text-[#c3cad9]">{f.label}</p>
                {f.lastError ? (
                  <p className="truncate text-[11px] text-[#a06a3d]">{f.lastError}</p>
                ) : (
                  <p className="truncate text-[11px] text-[#5b6478]">{f.url}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemoveFeed(f.id)}
                className="ml-auto shrink-0 text-[11.5px] text-[#5b6478] hover:text-[#9aa3b5]"
              >
                remove
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex gap-1.5">
          <input
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && feedUrl.trim()) {
                onAddFeed("", feedUrl.trim());
                setFeedUrl("");
              }
            }}
            placeholder="Or paste an RSS / iCal URL"
            className="min-w-0 flex-1 rounded-md border border-[#20242f] bg-[#101219] px-2.5 py-1.5 text-[12px] text-[#e9ecf3] outline-none placeholder:text-[#4d5464] focus:border-[#2f3547]"
          />
          <button
            type="button"
            onClick={() => {
              if (!feedUrl.trim()) return;
              onAddFeed("", feedUrl.trim());
              setFeedUrl("");
            }}
            className="shrink-0 rounded-md bg-[#1d212d] px-2.5 py-1.5 text-[12px] text-[#c3cad9]"
          >
            add
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-[12.5px] font-medium text-[#c3cad9]">Watchlist</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[#6b7385]">
          Bands, venues and promoters you care about. An obscure event you have no connection
          to is noise; an obscure event with a name you follow is the find — so matches jump
          to the top.
        </p>

        <ul className="mt-2 flex flex-wrap gap-1.5">
          {watchlist.map((w) => (
            <li
              key={w.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#16202b] px-2.5 py-1 text-[12px] text-[#a8c5d8]"
            >
              {w.name}
              <button
                type="button"
                onClick={() => onRemoveWatch(w.id)}
                className="text-[#5b6478] hover:text-[#9aa3b5]"
                aria-label={`Stop following ${w.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex gap-1.5">
          <select
            value={watchKind}
            onChange={(e) => setWatchKind(e.target.value as WatchKind)}
            className="shrink-0 rounded-md border border-[#20242f] bg-[#101219] px-2 py-1.5 text-[12px] text-[#b6bdcd] outline-none"
          >
            <option value="artist">Artist</option>
            <option value="venue">Venue</option>
            <option value="organizer">Promoter</option>
          </select>
          <input
            value={watchName}
            onChange={(e) => setWatchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && watchName.trim()) {
                onAddWatch(watchKind, watchName.trim());
                setWatchName("");
              }
            }}
            placeholder="Name"
            className="min-w-0 flex-1 rounded-md border border-[#20242f] bg-[#101219] px-2.5 py-1.5 text-[12px] text-[#e9ecf3] outline-none placeholder:text-[#4d5464] focus:border-[#2f3547]"
          />
          <button
            type="button"
            onClick={() => {
              if (!watchName.trim()) return;
              onAddWatch(watchKind, watchName.trim());
              setWatchName("");
            }}
            className="shrink-0 rounded-md bg-[#1d212d] px-2.5 py-1.5 text-[12px] text-[#c3cad9]"
          >
            add
          </button>
        </div>
      </section>

      <label className="flex items-center gap-2 rounded-lg border border-[#1c2029] bg-[#101219] px-3 py-2">
        <input
          type="checkbox"
          checked={aiSweepEnabled}
          onChange={onToggleAiSweep}
          className="accent-[#38bdf8]"
        />
        <span className="text-[12.5px] text-[#c3cad9]">AI sweep</span>
        <span className="text-[11.5px] text-[#6b7385]">
          searches the open web; every result is verified against its cited page
        </span>
      </label>
    </aside>
  );
}
