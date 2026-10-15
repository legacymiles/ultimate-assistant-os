"use client";

// ---------------------------------------------------------------------------
// Dump Finder — where can this load go, and how far is it.
//
// Built for someone standing next to a truck: it finds the phone, draws a ring
// of the chosen radius, and pins every asphalt plant (millings), concrete and
// rubble yard, landfill, transfer station, recycling center and scrap yard
// inside it, nearest first. Filter chips narrow it to the kind of load on the
// truck. Each site opens to its phone, hours and a Directions link, and a note
// box for what OSM cannot know: whether they take millings today, the price a
// ton, the gate hours. Spots nobody has mapped can be dropped on the map.
//
// Layout: on a phone the map is the top half and the list is a sheet below it;
// on a desktop the list is a fixed rail on the left.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { KINDS, KIND_BY_ID, ALL_KINDS, type SiteKind } from "@/lib/dump-finder/kinds";
import { milesBetween, type Site } from "@/lib/dump-finder/sites";
import {
  EMPTY,
  RADIUS_STOPS,
  load,
  save,
  KEY,
  type FinderData,
  type GeocodeHit,
  type MySpot,
  type Place,
} from "@/lib/dump-finder/store";
import { useRemotePull } from "@/lib/sync/useSync";
import "./dump-finder.css";

const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="df-map-loading">Loading map…</div>,
});

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "ready"; fetchedAt: string }
  | { kind: "error"; message: string };

function fmtMi(mi: number): string {
  return mi < 10 ? mi.toFixed(1) : Math.round(mi).toString();
}

function directionsUrl(s: { lat: number; lon: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(6)},${s.lon.toFixed(6)}`;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function DumpFinder() {
  const [data, setData] = useState<FinderData>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [osmSites, setOsmSites] = useState<Site[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [locError, setLocError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeocodeHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<{ lat: number; lon: number; name: string; kinds: SiteKind[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fetchSeq = useRef(0);

  // --- persistence ----------------------------------------------------------
  useEffect(() => {
    const d = load();
    setData(d);
    if (d.lastPlace) setPlace(d.lastPlace);
    setHydrated(true);
  }, []);
  useRemotePull(KEY, () => setData(load()));

  const update = useCallback((fn: (d: FinderData) => FinderData) => {
    setData((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  const choosePlace = useCallback(
    (p: Place) => {
      setPlace(p);
      setSelectedId(null);
      update((d) => ({ ...d, lastPlace: p }));
    },
    [update],
  );

  // --- location -------------------------------------------------------------
  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocError("This browser can't share its location. Type a ZIP or address instead.");
      return;
    }
    setLocError(null);
    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        choosePlace({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "Your location",
          source: "gps",
          accuracyM: Math.round(pos.coords.accuracy),
        });
      },
      (err) => {
        setStatus({ kind: "idle" });
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? "Location is turned off for this site. Allow it in the browser, or type a ZIP or address."
            : "Couldn't get a fix on your location. Try again, or type a ZIP or address.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, [choosePlace]);

  // Ask once on open. A saved place shows straight away; a GPS fix replaces it.
  const asked = useRef(false);
  useEffect(() => {
    if (!hydrated || asked.current) return;
    asked.current = true;
    locate();
  }, [hydrated, locate]);

  // --- fetching -------------------------------------------------------------
  const radiusMi = data.radiusMi;
  useEffect(() => {
    if (!place) return;
    const seq = ++fetchSeq.current;
    const t = window.setTimeout(async () => {
      setStatus({ kind: "loading" });
      try {
        const res = await fetch(
          `/api/dump-finder/sites?lat=${place.lat}&lon=${place.lon}&mi=${radiusMi}`,
        );
        const json = (await res.json()) as { sites?: Site[]; fetchedAt?: string; error?: string };
        if (seq !== fetchSeq.current) return;
        if (!res.ok || !json.sites) throw new Error(json.error ?? `Request failed (${res.status}).`);
        setOsmSites(json.sites);
        setStatus({ kind: "ready", fetchedAt: json.fetchedAt ?? new Date().toISOString() });
      } catch (err) {
        if (seq !== fetchSeq.current) return;
        setStatus({ kind: "error", message: (err as Error).message });
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [place, radiusMi]);

  // --- derived --------------------------------------------------------------
  const mySites: Site[] = useMemo(
    () =>
      data.spots.map((s) => ({
        id: `mine:${s.id}`,
        kinds: s.kinds.length ? s.kinds : ["millings"],
        name: s.name,
        unnamed: false,
        lat: s.lat,
        lon: s.lon,
        distanceMi: place ? milesBetween(place.lat, place.lon, s.lat, s.lon) : 0,
        accepts: [],
      })),
    [data.spots, place],
  );

  const inRadius = useMemo(() => {
    const mine = place ? mySites.filter((s) => s.distanceMi <= radiusMi) : mySites;
    return [...mine, ...osmSites].sort((a, b) => a.distanceMi - b.distanceMi);
  }, [mySites, osmSites, place, radiusMi]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<SiteKind, number>;
    for (const s of inRadius) for (const k of s.kinds) c[k] += 1;
    return c;
  }, [inRadius]);

  const active = useMemo(() => new Set(data.kinds), [data.kinds]);
  const shown = useMemo(
    () => inRadius.filter((s) => s.kinds.some((k) => active.has(k))),
    [inRadius, active],
  );

  const selected = shown.find((s) => s.id === selectedId) ?? null;

  // Keep the selected row in view when it was picked from the map.
  useEffect(() => {
    if (!selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-site="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const movedAway =
    !!mapCenter
    && !placing
    && (!place || milesBetween(place.lat, place.lon, mapCenter.lat, mapCenter.lon) > Math.max(2, radiusMi * 0.35));

  // --- actions ---------------------------------------------------------------
  function toggleKind(k: SiteKind) {
    update((d) => {
      const has = d.kinds.includes(k);
      const kinds = has ? d.kinds.filter((x) => x !== k) : ALL_KINDS.filter((x) => x === k || d.kinds.includes(x));
      return { ...d, kinds };
    });
  }

  function onlyKind(k: SiteKind) {
    update((d) => ({ ...d, kinds: [k] }));
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setHits(null);
    try {
      const res = await fetch(`/api/dump-finder/geocode?q=${encodeURIComponent(q)}`);
      const json = (await res.json()) as { hits?: GeocodeHit[]; error?: string };
      if (!res.ok || !json.hits) throw new Error(json.error ?? "Search failed.");
      if (json.hits.length === 1) {
        pickHit(json.hits[0]);
      } else {
        setHits(json.hits);
      }
    } catch (err) {
      setLocError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function pickHit(h: GeocodeHit) {
    setHits(null);
    setLocError(null);
    setQuery("");
    choosePlace({ lat: h.lat, lon: h.lon, label: h.label, source: "search" });
  }

  function searchHere() {
    if (!mapCenter) return;
    choosePlace({ lat: mapCenter.lat, lon: mapCenter.lon, label: "Map area", source: "map" });
  }

  function setNote(id: string, text: string) {
    update((d) => {
      const notes = { ...d.notes };
      if (text.trim()) notes[id] = text;
      else delete notes[id];
      return { ...d, notes };
    });
  }

  function saveDraft() {
    if (!draft || !draft.name.trim()) return;
    const spot: MySpot = {
      id: newId(),
      name: draft.name.trim(),
      kinds: draft.kinds.length ? draft.kinds : ["millings"],
      lat: draft.lat,
      lon: draft.lon,
      createdAt: new Date().toISOString(),
    };
    update((d) => ({ ...d, spots: [...d.spots, spot] }));
    setDraft(null);
    setSelectedId(`mine:${spot.id}`);
  }

  function deleteSpot(siteId: string) {
    const raw = siteId.slice("mine:".length);
    update((d) => {
      const notes = { ...d.notes };
      delete notes[siteId];
      return { ...d, spots: d.spots.filter((s) => s.id !== raw), notes };
    });
    setConfirmDelete(null);
    setSelectedId(null);
  }

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      window.setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
    } catch {
      /* the number is still on screen, selectable */
    }
  }

  // --- render ------------------------------------------------------------------
  const placeLine = place
    ? place.source === "gps"
      ? `GPS${place.accuracyM ? ` ±${place.accuracyM < 1000 ? `${place.accuracyM} m` : `${(place.accuracyM / 1000).toFixed(1)} km`}` : ""}`
      : place.label
    : "No location yet";

  return (
    <div className="df-root">
      {/* ------------------------------------------------------------ map */}
      <section className="df-mapwrap">
        <MapView
          place={place}
          radiusMi={radiusMi}
          sites={shown}
          selectedId={selectedId}
          layer={data.layer}
          placing={placing}
          onSelect={(id) => setSelectedId(id)}
          onPlace={(lat, lon) => {
            setPlacing(false);
            setDraft({ lat, lon, name: "", kinds: ["millings"] });
          }}
          onMoved={(lat, lon) => setMapCenter({ lat, lon })}
        />

        <div className="df-maptop">
          {placing ? (
            <div className="df-banner">
              Tap the map where the spot is
              <button type="button" className="df-btn df-btn-ghost" onClick={() => setPlacing(false)}>
                Cancel
              </button>
            </div>
          ) : movedAway ? (
            <button type="button" className="df-btn df-btn-primary df-float" onClick={searchHere}>
              Search this area
            </button>
          ) : null}
        </div>

        <div className="df-layer" role="group" aria-label="Map style">
          {(["map", "satellite"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={data.layer === l}
              className="df-seg"
              onClick={() => update((d) => ({ ...d, layer: l }))}
            >
              {l === "map" ? "Map" : "Satellite"}
            </button>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- panel */}
      <aside className="df-panel">
        <header className="df-head">
          <div className="df-titlerow">
            <h1 className="df-title">Dump Finder</h1>
            <span className={`df-state df-state-${status.kind}`}>
              {status.kind === "locating"
                ? "Locating"
                : status.kind === "loading"
                  ? "Searching"
                  : status.kind === "error"
                    ? "Retry"
                    : status.kind === "ready"
                      ? "Live"
                      : "Idle"}
            </span>
          </div>

          <div className="df-where">
            <div className="min-w-0">
              <div className="df-label">Searching from</div>
              <div className="df-place" title={place?.label}>
                {placeLine}
              </div>
              {place && (
                <div className="df-mono df-faint">
                  {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
                </div>
              )}
            </div>
            <button type="button" className="df-btn df-btn-outline shrink-0" onClick={locate}>
              <span aria-hidden className="df-crosshair" /> Use my location
            </button>
          </div>

          <form className="df-search" onSubmit={runSearch} role="search">
            <label htmlFor="df-q" className="sr-only">
              ZIP, town or address
            </label>
            <input
              id="df-q"
              className="df-input"
              placeholder="ZIP, town or job-site address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              enterKeyHint="search"
            />
            <button type="submit" className="df-btn df-btn-outline" disabled={searching || !query.trim()}>
              {searching ? "…" : "Go"}
            </button>
          </form>
          {hits && (
            <ul className="df-hits">
              {hits.length === 0 && <li className="df-faint px-2 py-1.5">Nothing matched. Try a ZIP.</li>}
              {hits.map((h) => (
                <li key={`${h.lat},${h.lon}`}>
                  <button type="button" onClick={() => pickHit(h)}>
                    {h.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {locError && <p className="df-error">{locError}</p>}

          <div className="df-radius">
            <div className="df-label flex items-center justify-between">
              <label htmlFor="df-radius">Radius</label>
              <span className="df-mono df-readout">{radiusMi} mi</span>
            </div>
            <input
              id="df-radius"
              type="range"
              min={1}
              max={50}
              step={1}
              value={radiusMi}
              onChange={(e) => update((d) => ({ ...d, radiusMi: Number(e.target.value) }))}
              className="df-range"
            />
            <div className="df-stops" role="group" aria-label="Quick radius">
              {RADIUS_STOPS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="df-seg"
                  aria-pressed={radiusMi === r}
                  onClick={() => update((d) => ({ ...d, radiusMi: r }))}
                >
                  {r} mi
                </button>
              ))}
            </div>
          </div>

          <div className="df-kinds">
            <div className="df-label flex items-center justify-between">
              <span>Show</span>
              <button
                type="button"
                className="df-link"
                onClick={() =>
                  update((d) => ({ ...d, kinds: d.kinds.length === ALL_KINDS.length ? [] : [...ALL_KINDS] }))
                }
              >
                {data.kinds.length === ALL_KINDS.length ? "None" : "All"}
              </button>
            </div>
            <div className="df-chips">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className="df-chip"
                  aria-pressed={active.has(k.id)}
                  style={{ "--c": k.color } as React.CSSProperties}
                  onClick={() => toggleKind(k.id)}
                  onDoubleClick={() => onlyKind(k.id)}
                  title={`${k.takes} Double-click to show only this.`}
                >
                  <span className="df-chip-dot" aria-hidden>
                    {k.glyph}
                  </span>
                  <span className="truncate">{k.label}</span>
                  <span className="df-mono df-chip-n">{place ? counts[k.id] : "–"}</span>
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* -------------------------------------------------- add a spot */}
        {draft && (
          <form
            className="df-draft"
            onSubmit={(e) => {
              e.preventDefault();
              saveDraft();
            }}
          >
            <div className="df-label">New spot · {draft.lat.toFixed(4)}, {draft.lon.toFixed(4)}</div>
            <label htmlFor="df-draft-name" className="sr-only">
              Name
            </label>
            <input
              id="df-draft-name"
              className="df-input"
              placeholder="Name, e.g. Miller Rd millings pile"
              value={draft.name}
              autoFocus
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <div className="df-chips df-chips-tight">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className="df-chip"
                  aria-pressed={draft.kinds.includes(k.id)}
                  style={{ "--c": k.color } as React.CSSProperties}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      kinds: draft.kinds.includes(k.id)
                        ? draft.kinds.filter((x) => x !== k.id)
                        : [...draft.kinds, k.id],
                    })
                  }
                >
                  <span className="df-chip-dot" aria-hidden>
                    {k.glyph}
                  </span>
                  <span className="truncate">{k.label}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="submit" className="df-btn df-btn-primary" disabled={!draft.name.trim()}>
                Save spot
              </button>
              <button type="button" className="df-btn df-btn-ghost" onClick={() => setDraft(null)}>
                Discard
              </button>
            </div>
          </form>
        )}

        {/* ------------------------------------------------------ results */}
        <div className="df-resulthead">
          <span>
            {place ? (
              <>
                <b className="df-mono">{shown.length}</b> of <span className="df-mono">{inRadius.length}</span>{" "}
                sites within <span className="df-mono">{radiusMi} mi</span>
              </>
            ) : (
              "Set a location to see sites"
            )}
          </span>
          <button
            type="button"
            className="df-link"
            onClick={() => {
              setDraft(null);
              setPlacing(true);
            }}
          >
            + Add a spot
          </button>
        </div>

        <div className="df-list" ref={listRef}>
          {status.kind === "error" && (
            <div className="df-empty">
              <p>{status.message}</p>
              <button
                type="button"
                className="df-btn df-btn-outline"
                onClick={() => place && setPlace({ ...place })}
              >
                Try again
              </button>
            </div>
          )}

          {!place && status.kind !== "locating" && (
            <div className="df-empty">
              <p>
                Allow location, or type a ZIP or address above. Every asphalt plant, landfill, transfer station,
                recycling center, scrap yard and concrete yard inside your radius shows up here, nearest first.
              </p>
            </div>
          )}

          {place && status.kind === "ready" && shown.length === 0 && (
            <div className="df-empty">
              <p>
                {inRadius.length === 0
                  ? `Nothing mapped within ${radiusMi} mi. Widen the radius, or add a spot you know.`
                  : "Nothing matches the kinds you have switched on."}
              </p>
            </div>
          )}

          {place && status.kind === "loading" && shown.length === 0 && (
            <div className="df-empty">
              <p>Searching {radiusMi} miles around you…</p>
            </div>
          )}

          <ul>
            {shown.map((s) => {
              const k = KIND_BY_ID[s.kinds[0]];
              const isSel = s.id === selectedId;
              const mine = s.id.startsWith("mine:");
              const note = data.notes[s.id];
              return (
                <li key={s.id} data-site={s.id} className={`df-row${isSel ? " is-selected" : ""}`}>
                  <button
                    type="button"
                    className="df-rowbtn"
                    aria-expanded={isSel}
                    onClick={() => setSelectedId(isSel ? null : s.id)}
                  >
                    <span className="df-glyph" style={{ "--c": k.color, "--i": k.ink } as React.CSSProperties}>
                      {k.glyph}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="df-name">
                        {s.name}
                        {mine && <span className="df-tag">Your spot</span>}
                      </span>
                      <span className="df-sub">
                        {s.kinds.map((x) => KIND_BY_ID[x].label).join(" · ")}
                        {note ? ` · ${note.split("\n")[0]}` : ""}
                      </span>
                    </span>
                    <span className="df-dist df-mono">
                      {fmtMi(s.distanceMi)}
                      <small> mi</small>
                    </span>
                  </button>

                  {isSel && (
                    <div className="df-detail">
                      <dl className="df-facts">
                        {s.address && (
                          <>
                            <dt>Address</dt>
                            <dd>{s.address}</dd>
                          </>
                        )}
                        {s.operator && (
                          <>
                            <dt>Operator</dt>
                            <dd>{s.operator}</dd>
                          </>
                        )}
                        {s.hours && (
                          <>
                            <dt>Hours</dt>
                            <dd className="df-mono">{s.hours}</dd>
                          </>
                        )}
                        {s.phone && (
                          <>
                            <dt>Phone</dt>
                            <dd className="flex items-center gap-2">
                              <span className="df-mono select-all">{s.phone}</span>
                              <button type="button" className="df-link" onClick={() => copy(s.phone!, s.id)}>
                                {copied === s.id ? "Copied" : "Copy"}
                              </button>
                            </dd>
                          </>
                        )}
                        {s.fee && (
                          <>
                            <dt>Fee</dt>
                            <dd>{s.fee === "yes" ? "Charges a fee" : s.fee === "no" ? "Free" : s.fee}</dd>
                          </>
                        )}
                        {s.accepts.length > 0 && (
                          <>
                            <dt>Takes</dt>
                            <dd>{s.accepts.join(", ")}</dd>
                          </>
                        )}
                        <dt>Point</dt>
                        <dd className="flex items-center gap-2">
                          <span className="df-mono select-all">
                            {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                          </span>
                          <button
                            type="button"
                            className="df-link"
                            onClick={() => copy(`${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}`, `${s.id}:pt`)}
                          >
                            {copied === `${s.id}:pt` ? "Copied" : "Copy"}
                          </button>
                        </dd>
                      </dl>

                      <label className="df-label" htmlFor={`df-note-${s.id}`}>
                        Your notes
                      </label>
                      <textarea
                        id={`df-note-${s.id}`}
                        className="df-input df-note"
                        rows={2}
                        placeholder="Takes millings? Price a ton, gate hours, who to ask for…"
                        defaultValue={note ?? ""}
                        onBlur={(e) => setNote(s.id, e.target.value)}
                      />

                      <div className="df-actions">
                        <a className="df-btn df-btn-primary" href={directionsUrl(s)} target="_blank" rel="noreferrer">
                          Directions
                        </a>
                        {s.website && (
                          <a className="df-btn df-btn-outline" href={s.website} target="_blank" rel="noreferrer">
                            Website
                          </a>
                        )}
                        {s.sourceUrl && (
                          <a className="df-btn df-btn-ghost" href={s.sourceUrl} target="_blank" rel="noreferrer">
                            Fix on OpenStreetMap
                          </a>
                        )}
                        {mine &&
                          (confirmDelete === s.id ? (
                            <span className="flex items-center gap-2">
                              <span className="df-faint">Delete this spot?</span>
                              <button type="button" className="df-btn df-btn-danger" onClick={() => deleteSpot(s.id)}>
                                Delete
                              </button>
                              <button type="button" className="df-btn df-btn-ghost" onClick={() => setConfirmDelete(null)}>
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button type="button" className="df-btn df-btn-ghost" onClick={() => setConfirmDelete(s.id)}>
                              Delete spot
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <footer className="df-foot">
            Sites come from OpenStreetMap. A plant nobody has mapped won&apos;t show up, so add it as a spot.
            Call before you haul: what a site accepts, tipping fees and gate hours change, and many asphalt
            plants only take millings from account holders.
            {status.kind === "ready" && (
              <span className="df-mono df-faint">
                {" "}
                Updated {new Date(status.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
              </span>
            )}
          </footer>
        </div>
      </aside>
    </div>
  );
}
