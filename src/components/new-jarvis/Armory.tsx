"use client";

// ---------------------------------------------------------------------------
// The armory — everything Jarvis can reach, and whether it can reach it.
//
// Sorted by what a capability LETS YOU DO rather than by who sells it, and the
// state it leads with is not "connected" but HALF SET UP. Two of three keys is
// the most annoying place to leave something and the cheapest to fix, so those
// come first and carry the exact key still missing.
//
// No vendor logos. A tile for a service that is not wired to anything makes the
// whole grid untrustworthy — if one badge is theatre then none of them mean
// anything, and the point of this surface is that every badge is true.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import {
  CATEGORY_LABEL,
  describeArmory,
  matches,
  readAll,
  summarise,
  type Category,
  type Environment,
  type Reading,
  type Status,
} from "@/lib/armory/catalog";

interface Props {
  /** What the local agent reports it can do. */
  bridge: Partial<Record<"browser" | "shell" | "files" | "system" | "vault", boolean>>;
  bridgeUp: boolean;
}

const STATUS_LABEL: Record<Status, string> = {
  live: "working",
  partial: "half set up",
  off: "off",
  "needs-pc": "needs your PC",
};

/** Colour is state, and state only. Nothing on this surface is coloured for decoration. */
const STATUS_CLASS: Record<Status, string> = {
  live: "border-core/40 text-core",
  partial: "border-amber-400/40 text-amber-300",
  off: "border-line text-ink-faint",
  "needs-pc": "border-support/40 text-support",
};

/** Half-set-up first: it is both the most actionable and the cheapest to finish. */
const ORDER: Record<Status, number> = { partial: 0, off: 1, "needs-pc": 2, live: 3 };

export function Armory({ bridge, bridgeUp }: Props) {
  const [keys, setKeys] = useState<Record<string, boolean> | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");

  useEffect(() => {
    void fetch("/api/jarvis/armory", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { keys?: Record<string, boolean> }) => setKeys(d.keys ?? {}))
      .catch(() => setKeys({}));
  }, []);

  const env: Environment = useMemo(() => ({ keys: keys ?? {}, bridge, bridgeUp }), [bridge, bridgeUp, keys]);
  const readings = useMemo(() => readAll(env), [env]);
  const summary = useMemo(() => summarise(readings), [readings]);

  const shown = useMemo(
    () =>
      readings
        .filter((r) => (category === "all" ? true : r.capability.category === category))
        .filter((r) => matches(r, query))
        .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.capability.name.localeCompare(b.capability.name)),
    [category, query, readings],
  );

  const categories = useMemo(() => {
    const present = new Set(readings.map((r) => r.capability.category));
    return (Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => present.has(c));
  }, [readings]);

  if (!keys) {
    return <p className="p-3 text-[11.5px] text-ink-muted">Checking what is switched on…</p>;
  }

  return (
    <div className="space-y-3 p-3">
      <header>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">What it can do</h2>
        <p className="mt-1 text-[12.5px] text-ink">{describeArmory(summary)}</p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-faint">
          Sorted by what is closest to working. No key is ever read here — only whether it is set.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-[11rem] flex-1">
          <Icon.Search
            width={11}
            height={11}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search what it can do, or a key name"
            aria-label="Search capabilities"
            className="w-full rounded-md border border-line bg-panel-2 py-1.5 pl-7 pr-2 text-[11.5px] text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | "all")}
          aria-label="Filter by what it is for"
          className="rounded-md border border-line bg-panel-2 px-2 py-1.5 text-[11.5px] text-ink focus:border-ink-faint focus:outline-none"
        >
          <option value="all">Everything</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="text-[11.5px] text-ink-muted">Nothing matches that.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {shown.map((reading) => (
            <Tile key={reading.capability.id} reading={reading} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ reading }: { reading: Reading }) {
  const { capability, status, missing, have } = reading;

  return (
    <li className="rounded-md border border-line-soft bg-panel p-2.5">
      <div className="flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{capability.name}</h3>
        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${STATUS_CLASS[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{capability.what}</p>

      {/* The cheapest route to switching it on — the exact thing still missing,
          chosen from whichever provider is already closest to done. */}
      {missing.length > 0 && (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-ink-faint">
          {have.length > 0 && (
            <span className="text-core">
              {have.join(" ")}
              {" · "}
            </span>
          )}
          <span className="text-amber-300">{missing.join(" ")}</span>
          <span className="text-ink-faint"> still needed</span>
        </p>
      )}

      {status === "needs-pc" && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
          Start the local agent on this PC — there is no key for this one.
        </p>
      )}

      {/* What you lose while it is off. An inventory tells you the state; this
          turns it into something you can decide about. */}
      {status !== "live" && capability.without && (
        <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">{capability.without}</p>
      )}

      {status === "live" && reading.missingOptional.length > 0 && (
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-ink-faint">
          optional: {reading.missingOptional.join(" ")}
        </p>
      )}
    </li>
  );
}
