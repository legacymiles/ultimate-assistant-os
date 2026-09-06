"use client";

// ---------------------------------------------------------------------------
// Dance Vault — the app shell.
//
// Owns the board, the filters, and the one-shot daily catch-up on open.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { allTags, filterByTags, searchDances, sortDances } from "@/lib/dances/query";
import type { SortBy } from "@/lib/dances/query";
import * as store from "@/lib/dances/store";
import { useRemotePull } from "@/lib/sync/useSync";
import type { BoardData, DailyPick, Dance } from "@/lib/dances/types";
import { AddDanceDialog } from "./AddDanceDialog";
import { DanceModal } from "./DanceModal";
import { DanceOfTheDay } from "./DanceOfTheDay";
import { DanceWall } from "./DanceWall";
import { Toolbar } from "./Toolbar";

export function DanceVault() {
  // Storage is browser-only, so the first render must match the server's empty
  // one; everything real arrives in the effect below.
  const [data, setData] = useState<BoardData>({ dances: [] });
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortBy>("added");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [soundHint, setSoundHint] = useState(true);

  const [picks, setPicks] = useState<DailyPick[]>([]);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [persisted, setPersisted] = useState(true);

  useRemotePull(store.KEY, () => setData(store.getBoard()));

  useEffect(() => {
    setData(store.getBoard());
    setReady(true);
  }, []);

  // The sound hint is about browser autoplay policy: audio is blocked until the
  // page has been interacted with at all, so the first click anywhere is what
  // actually unlocks it. Nothing to do but stop saying it.
  useEffect(() => {
    if (!soundHint) return;
    const done = () => setSoundHint(false);
    window.addEventListener("click", done, { once: true });
    return () => window.removeEventListener("click", done);
  }, [soundHint]);

  // Daily catch-up, once per open, after the board is loaded so the exclusion
  // list is real. Sending names lets the picker avoid repeating what is here.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const names = store.knownNames(data).slice(0, 400).join("|");
    fetch(`/api/dances/daily?names=${encodeURIComponent(names)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setPicks(json.picks ?? []);
        setAiAvailable(!!json.aiAvailable);
        setPersisted(json.persisted !== false);
        const fresh = (json.picks ?? [])
          .filter((p: DailyPick) => p.status === "ok" && p.dance)
          .map((p: DailyPick) => p.dance as Dance);
        if (fresh.length) setData(store.mergeDaily(fresh));
      })
      .catch(() => {
        // The vault is entirely usable without today's pick.
      })
      .finally(() => !cancelled && setDailyLoading(false));
    return () => {
      cancelled = true;
    };
    // Deliberately once: re-running on every board change would fire a search
    // each time a score slider moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const tags = useMemo(() => allTags(data.dances), [data.dances]);
  const visible = useMemo(
    () => sortDances(filterByTags(searchDances(data.dances, query), activeTags), sort),
    [data.dances, query, activeTags, sort]
  );

  const open = data.dances.find((d) => d.id === openId) ?? null;

  const toggleTag = (tag: string) =>
    setActiveTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));

  return (
    <main className="dv">
      <header className="dv__head">
        <Link href="/" className="dv__back">
          ← OS
        </Link>
        <div>
          <h1>Dance Vault</h1>
          <p>
            Every dance worth remembering — hover to play, score out of 100, and one new one a day
            on autopilot.
          </p>
        </div>
      </header>

      <DanceOfTheDay
        picks={picks}
        loading={dailyLoading}
        aiAvailable={aiAvailable}
        persisted={persisted}
        onOpen={setOpenId}
        onAddManually={() => setAdding(true)}
      />

      <Toolbar
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        tags={tags}
        activeTags={activeTags}
        onToggleTag={toggleTag}
        showing={visible.length}
        total={data.dances.length}
        onAdd={() => setAdding(true)}
      />

      {ready ? (
        <DanceWall dances={visible} onOpen={(d) => setOpenId(d.id)} />
      ) : (
        <p className="dance-wall__empty">Opening the vault…</p>
      )}

      {soundHint && <div className="dv__soundhint">Click anywhere to allow sound</div>}

      {open && (
        <DanceModal
          dance={open}
          onClose={() => setOpenId(null)}
          onChange={(patch) => setData(store.updateDance(open.id, patch))}
          onDelete={() => {
            setData(store.removeDance(open.id));
            setOpenId(null);
          }}
        />
      )}

      {adding && (
        <AddDanceDialog
          existingRefs={data.dances.map((d) => d.video?.ref).filter(Boolean) as string[]}
          onClose={() => setAdding(false)}
          onAdd={(dance) => {
            setData(store.addDance(dance));
            setAdding(false);
          }}
        />
      )}
    </main>
  );
}
