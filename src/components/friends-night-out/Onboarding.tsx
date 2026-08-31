"use client";

import { useEffect, useRef, useState } from "react";
import { currentPosition, labelForCoords, lookupPlace, type PlaceSuggestion } from "@/lib/friends-night-out/geo";
import { DEMO_ORIGIN } from "@/lib/friends-night-out/seed";
import type { Origin } from "@/lib/friends-night-out/types";

// ---------------------------------------------------------------------------
// First run: where you are, and how far you'll go.
//
// Both are keyless. Location comes from the browser or from OpenStreetMap's
// Nominatim, so setting up the app never depends on a paid geocoder — and the
// typed search is debounced because Nominatim's usage policy is one request per
// second and this app has no right to abuse a free service.
// ---------------------------------------------------------------------------

const RADIUS_STEPS = [10, 15, 25, 40, 60, 100];

export function Onboarding({
  onDone,
  onDemo,
}: {
  onDone: (origin: Origin, radiusMi: number) => void;
  onDemo: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [radius, setRadius] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Picking a suggestion writes its label back into the input, which would
  // otherwise re-run the search and reopen the list the user just closed.
  const justPicked = useRef(false);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    // Nominatim allows one request per second; 450ms of quiet keeps a fast
    // typist well inside that without feeling laggy.
    timer.current = setTimeout(async () => {
      try {
        setResults(await lookupPlace(query));
      } catch {
        setResults([]);
      }
    }, 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  async function useMyLocation() {
    setBusy(true);
    setError(null);
    try {
      const coords = await currentPosition();
      setOrigin(await labelForCoords(coords));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read your location.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f0abfc]">
        Friends Night Out
      </p>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight text-[#e9ecf3]">
        Find the night nobody posted about.
      </h1>
      <p className="mt-2.5 max-w-lg text-[13.5px] leading-relaxed text-[#8b93a5]">
        Set a point and a radius. One side finds what&apos;s happening — the shows, markets,
        parish suppers and block parties that never reach a ticket site. The other finds what
        you can go do any day, from ice rinks to fire lookouts.
      </p>

      <section className="mt-8 space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5b6478]">
          Where are you?
        </h2>

        <button
          type="button"
          onClick={useMyLocation}
          disabled={busy}
          className="w-full rounded-lg border border-[#20242f] bg-[#12141c] px-3 py-2.5 text-left text-[13px] text-[#c3cad9] transition-colors hover:border-[#2f3547] disabled:opacity-50"
        >
          {busy ? "Locating…" : "Use my location"}
        </button>

        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="or type a town — Asheville, NC"
            className="w-full rounded-lg border border-[#20242f] bg-[#0e1016] px-3 py-2.5 text-[13px] text-[#e9ecf3] outline-none placeholder:text-[#4d5464] focus:border-[#2f3547]"
          />
          {results.length ? (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[#242938] bg-[#12141c] shadow-2xl">
              {results.map((r) => (
                <li key={`${r.lat},${r.lon}`}>
                  <button
                    type="button"
                    onClick={() => {
                      justPicked.current = true;
                      setOrigin({ label: r.label, lat: r.lat, lon: r.lon });
                      setQuery(r.label);
                      setResults([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-[12.5px] text-[#c3cad9] hover:bg-[#1a1e28]"
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {error ? <p className="text-[12.5px] text-[#a06a3d]">{error}</p> : null}
        {origin ? (
          <p className="text-[12.5px] text-[#6ee7b7]">Set to {origin.label}</p>
        ) : null}
      </section>

      <section className="mt-7">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5b6478]">
          How far will you go?
        </h2>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {RADIUS_STEPS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRadius(r)}
              className="rounded-lg px-3 py-1.5 text-[12.5px] transition-colors"
              style={{
                background: radius === r ? "#1d212d" : "#101219",
                color: radius === r ? "#e9ecf3" : "#6b7385",
                boxShadow: radius === r ? "inset 0 0 0 1px #2f3547" : "inset 0 0 0 1px #1c2029",
              }}
            >
              {r} mi
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-[#6b7385]">
          Worth going wide — the strangest things tend to sit just outside town. You can change
          this any time.
        </p>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => origin && onDone(origin, radius)}
          disabled={!origin}
          className="rounded-lg px-4 py-2 text-[13px] font-medium disabled:opacity-40"
          style={{
            background: "linear-gradient(100deg, rgba(236,72,153,0.24), rgba(56,189,248,0.24))",
            color: "#f5d0fe",
            boxShadow: "0 0 0 1px rgba(236,72,153,0.28)",
          }}
        >
          Start looking
        </button>
        <button
          type="button"
          onClick={onDemo}
          className="text-[12.5px] text-[#6b7385] hover:text-[#9aa3b5]"
        >
          just show me a demo ({DEMO_ORIGIN.label.replace("Demo — ", "")})
        </button>
      </div>
    </div>
  );
}
