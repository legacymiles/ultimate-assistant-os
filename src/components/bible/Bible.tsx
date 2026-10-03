"use client";

// ---------------------------------------------------------------------------
// Financial Bible — the shell.
//
// It owns exactly two things: which room is mounted, and the home base every
// room needs. It does not know what a plan is. Adding the next room is an
// object in src/lib/bible/rooms.ts plus one line in MOUNTS.
//
// The store is deliberately not lifted up here. Build Plans loads the same
// store through the same module, which keeps the shell free of the app's data
// model — the price is a localStorage read per switch, which costs nothing.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_ROOM, ROOMS, isRoom, roomDef, type RoomId } from "@/lib/bible/rooms";
import { loadRaw, saveStore, setHomeBase, setLastRoom } from "@/lib/bible/store";
import type { HomeBase } from "@/lib/bible/types";
import { EmptyRoom } from "./rooms/EmptyRoom";
import "./bible.css";

// One room's worth of JavaScript at a time.
const PlansRoom = dynamic(() => import("./plans/IdeaTable").then((m) => m.PlansRoom), {
  ssr: false,
  loading: () => <div className="bible-skeleton" />,
});

export function Bible({ initialRoom }: { initialRoom: RoomId | null }) {
  const [room, setRoom] = useState<RoomId>(initialRoom ?? DEFAULT_ROOM);
  const [homeBase, setBase] = useState<HomeBase | null>(null);
  /** False until the store has been read, so the strip does not flash. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = loadRaw();
    setBase(raw.homeBase);
    setReady(true);
    if (initialRoom) {
      // Arriving by a link that named a room counts as being there, so the next
      // bare visit resumes it rather than the room before it.
      saveStore(setLastRoom(raw, initialRoom));
      return;
    }
    if (isRoom(raw.lastRoom)) setRoom(raw.lastRoom);
  }, [initialRoom]);

  const go = useCallback((next: RoomId) => {
    setRoom(next);
    saveStore(setLastRoom(loadRaw(), next));
    // Name what is on screen without navigating: a room can hold unsaved work,
    // and re-mounting it to change a query string would throw that away.
    const url = new URL(window.location.href);
    url.searchParams.set("studio", next);
    window.history.replaceState(null, "", url);
  }, []);

  const saveBase = useCallback((base: HomeBase) => {
    setBase(base);
    saveStore(setHomeBase(loadRaw(), base));
  }, []);

  const def = roomDef(room);

  return (
    <div className="bible" style={{ ["--bible-accent" as string]: `${def.hue}` }}>
      <nav className="bible-rail" aria-label="Financial Bible rooms">
        <span className="bible-mark">
          Financial
          <strong>Bible</strong>
        </span>
        {ROOMS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => go(r.id)}
            data-active={r.id === room}
            data-built={r.built}
            aria-current={r.id === room ? "page" : undefined}
          >
            <span>{r.label}</span>
            <small>{r.hint}</small>
          </button>
        ))}
        <p className="bible-rail-foot">
          Every room reads the same home base. Ideas live on this device and sync to your account.
        </p>
      </nav>

      {ready && <HomeBaseStrip base={homeBase} onSave={saveBase} />}

      <main className="bible-room">
        {def.built ? <PlansRoom homeBase={homeBase} /> : <EmptyRoom room={def} />}
      </main>
    </div>
  );
}

/**
 * Asked once, then a quiet line in the header.
 *
 * It never blocks the room behind it: a modal here would stand between the
 * owner and a plan he can already read, and the plan degrades honestly without
 * a location (online suppliers, and it says so in its assumptions).
 */
function HomeBaseStrip({
  base,
  onSave,
}: {
  base: HomeBase | null;
  onSave: (base: HomeBase) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [city, setCity] = useState(base?.city ?? "");
  const [region, setRegion] = useState(base?.region ?? "");
  const [country, setCountry] = useState(base?.country ?? "US");
  const [currency, setCurrency] = useState(base?.currency ?? "USD");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!city.trim()) return;
    onSave({
      city: city.trim(),
      region: region.trim(),
      country: country.trim() || "US",
      currency: (currency.trim() || "USD").toUpperCase().slice(0, 3),
    });
    setEditing(false);
  };

  if (base && !editing) {
    return (
      <div className="bible-base">
        <span>
          Home base <strong>{[base.city, base.region, base.country].filter(Boolean).join(", ")}</strong>
          {" · "}
          prices in <strong>{base.currency}</strong>
        </span>
        <button type="button" className="bb" data-tone="ghost" onClick={() => setEditing(true)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="bible-base">
      <span>{base ? "Home base" : "Where are you building? Suppliers and prices are looked up against this."}</span>
      <form onSubmit={submit}>
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" aria-label="City" />
        <input
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="State / region"
          aria-label="State or region"
        />
        <input
          data-small="true"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="US"
          aria-label="Country"
        />
        <input
          data-small="true"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          placeholder="USD"
          aria-label="Currency"
        />
        <button type="submit" className="bb" data-tone="go" disabled={!city.trim()}>
          Save
        </button>
        {base && (
          <button type="button" className="bb" data-tone="ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}
