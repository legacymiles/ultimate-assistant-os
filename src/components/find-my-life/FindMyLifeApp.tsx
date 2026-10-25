"use client";

// ---------------------------------------------------------------------------
// Find My Life — every device and thing you own, in one place.
//
// The Life Radar (or the map) up top, a dense list beside it, and the one you
// pick up close. Add anything — phone, laptop, Meta glasses, car, keys, wallet
// — and it gets the best way of being found that really works, set up in place.
// Lives on its own page (/apps/find-my-life, an App plugins card) and inside
// the Jarvis Dashboard widget's sheet (`embedded`).
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ago,
  bearingDeg,
  bestFix,
  compass,
  distanceM,
  distanceText,
  freshness,
  placeFor,
  sortDevices,
  summary,
  whereText,
  type Device,
  type Fix,
} from "@/lib/find-my-life/engine";
import { KINDS, KIND_BY_ID, SOURCE_SHORT, TAGS, type Kind, type TagBrand } from "@/lib/find-my-life/kinds";
import { startRinging, thisDeviceGuess, useFindMyLife } from "@/lib/find-my-life/useFindMyLife";
import { Battery, DeviceDetail } from "./DeviceDetail";
import { KindIcon } from "./KindIcon";
import { Radar } from "./Radar";
import "./find-my-life.css";

const FmlMap = dynamic(() => import("./FmlMap").then((m) => m.FmlMap), {
  ssr: false,
  loading: () => <div className="fml-map" aria-busy="true" />,
});

const CAR_MESSAGES: Record<string, string> = {
  connected: "Car connected. It'll show on the radar as soon as it reports in.",
  none: "Connected, but no cars came back. Make sure the car is on your car-maker app account.",
  keys: "Cars need Smartcar set up once — Jarvis › Profile › Connections › Cars.",
  cancelled: "Car connection cancelled. Nothing was changed.",
  unsupported: "That car brand isn't supported yet. The parked-here pin still works for it.",
  expired: "That took too long — tap Connect car again.",
  failed: "Couldn't finish connecting the car. Try again in a minute.",
  signin: "Sign in to Jarvis first, then connect your car.",
};

type Sheet = { kind: "add" } | { kind: "setup" } | { kind: "device"; id: string } | null;

export function FindMyLifeApp({ embedded = false }: { embedded?: boolean }) {
  const f = useFindMyLife();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"radar" | "map">("radar");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; tone?: "bad" } | null>(null);
  const [query, setQuery] = useState("");
  const [heading, setHeading] = useState<number | null>(null);
  const [wide, setWide] = useState(false);
  const [, tick] = useState(0);

  const toast = useCallback((text: string, tone?: "bad") => {
    setToastMsg({ text, tone });
    setTimeout(() => setToastMsg((t) => (t?.text === text ? null : t)), 4200);
  }, []);

  // "x min ago" stays true without a refresh.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 960px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Coming back from the car sign-in.
  useEffect(() => {
    const url = new URL(window.location.href);
    const car = url.searchParams.get("car");
    if (!car) return;
    toast(CAR_MESSAGES[car] ?? "Back from the car sign-in.", car === "connected" ? undefined : "bad");
    url.searchParams.delete("car");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [toast]);

  useEffect(() => {
    if (f.error) toast(f.error, "bad");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.error]);

  const doc = f.view?.doc;
  const devices = useMemo(() => (doc ? sortDevices(doc.devices) : []), [doc]);
  const me = devices.find((d) => d.id === f.thisId);
  // The radar's middle: where you are, else your phone, else anything located.
  const center: Fix | null = useMemo(() => {
    if (f.here) return f.here;
    const mine = me && bestFix(me);
    if (mine) return mine;
    const phone = devices.find((d) => d.kind === "phone" && bestFix(d));
    return (phone && bestFix(phone)) || devices.map(bestFix).find(Boolean) || null;
  }, [f.here, me, devices]);
  const centerName = f.here ? "you" : me ? me.name : devices.find((d) => bestFix(d) === center)?.name ?? "";

  const sum = doc ? summary(doc) : null;
  const allClear = Boolean(sum && sum.total > 0 && sum.located === sum.total && !sum.lost && devices.every((d) => freshness(bestFix(d)) !== "old"));
  const sel = devices.find((d) => d.id === selected) ?? null;
  const filtered = query.trim() ? devices.filter((d) => `${d.name} ${KIND_BY_ID[d.kind].label}`.toLowerCase().includes(query.trim().toLowerCase())) : devices;

  // On a big screen the details column is never empty: start on the first thing.
  useEffect(() => {
    if (wide && !selected && devices.length) setSelected(devices[0].id);
  }, [wide, selected, devices]);

  const pick = (id: string) => {
    setSelected(id);
    if (!wide) setSheet({ kind: "device", id });
  };

  // Compass: the dish turns with the phone so blips point at the real things.
  const compassOn = heading !== null;
  const toggleCompass = async () => {
    if (compassOn) return setHeading(null);
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!DOE) return toast("This device has no compass.", "bad");
    try {
      if (DOE.requestPermission && (await DOE.requestPermission()) !== "granted") return toast("Compass needs motion access — allow it and tap again.", "bad");
    } catch {
      return toast("Compass needs motion access — allow it and tap again.", "bad");
    }
    setHeading(0);
  };
  useEffect(() => {
    if (!compassOn) return;
    let last = 0;
    const on = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      const h = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : e.absolute && e.alpha !== null ? 360 - e.alpha : null;
      if (h === null) return;
      // Unwrap so 359° → 1° turns 2°, not back the long way round.
      let next = h;
      while (next - last > 180) next -= 360;
      while (next - last < -180) next += 360;
      last = next;
      setHeading(next);
    };
    window.addEventListener("deviceorientationabsolute", on as EventListener);
    window.addEventListener("deviceorientation", on as EventListener);
    return () => {
      window.removeEventListener("deviceorientationabsolute", on as EventListener);
      window.removeEventListener("deviceorientation", on as EventListener);
    };
  }, [compassOn]);

  const loading = !f.view && !f.error;

  return (
    <div className={`fml ${embedded ? "" : "fml-page"}`}>
      <div className="fml-wrap">
        {!embedded && (
          <header className="fml-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="fml-kicker">Jarvis · App plugin</p>
              <h1 className="fml-title">
                Find My <b>Life</b>
              </h1>
              <p className="fml-summary">{sum?.line ?? "Every device and thing you own, in one place."}</p>
            </div>
            <HeadActions onAdd={() => setSheet({ kind: "add" })} onSetup={() => setSheet({ kind: "setup" })} />
          </header>
        )}
        {embedded && (
          <div className="fml-head" style={{ alignItems: "center" }}>
            <p className="fml-summary" style={{ flex: 1, margin: 0 }}>
              {sum?.line}
            </p>
            <HeadActions onAdd={() => setSheet({ kind: "add" })} onSetup={() => setSheet({ kind: "setup" })} />
          </div>
        )}

        {f.view?.pingError && <div className="fml-error">{f.view.pingError}</div>}
        {f.view?.car.error && <div className="fml-error">{f.view.car.error}</div>}

        {loading ? (
          <div className="fml-panel fml-hero" aria-busy="true">
            <Radar devices={[]} center={null} />
            <p>Finding your things…</p>
          </div>
        ) : !f.view ? (
          <div className="fml-panel fml-hero">
            <h2>Couldn&apos;t load Find My Life</h2>
            <p>{f.error}</p>
            <button type="button" className="fml-btn fml-btn-hot" onClick={() => void f.load()}>
              Try again
            </button>
          </div>
        ) : devices.length === 0 ? (
          <FirstRun onThis={() => void f.makeThisFindable()} onAdd={() => setSheet({ kind: "add" })} busy={f.busy === "this"} />
        ) : (
          <>
            <Stats devices={devices} lowBattery={sum?.lowBattery.length ?? 0} />
            <div className="fml-grid">
              <section className="fml-panel fml-stage" aria-label="Where everything is">
                <div className="fml-stage-bar">
                  <div className="fml-seg" role="group" aria-label="View">
                    <button type="button" aria-pressed={mode === "radar"} onClick={() => setMode("radar")}>
                      Radar
                    </button>
                    <button type="button" aria-pressed={mode === "map"} onClick={() => setMode("map")}>
                      Map
                    </button>
                  </div>
                  <span style={{ flex: 1 }} />
                  {mode === "radar" && (
                    <button type="button" className="fml-btn fml-btn-sm" aria-pressed={compassOn} onClick={() => void toggleCompass()} title="Turn the radar with your phone">
                      {compassOn ? "Compass on" : "Compass"}
                    </button>
                  )}
                  {!f.here && f.geo !== "unsupported" && (
                    <button type="button" className="fml-btn fml-btn-sm" onClick={() => void f.locateNow()}>
                      Center on me
                    </button>
                  )}
                </div>
                {mode === "radar" ? (
                  <>
                    <Radar devices={devices} center={center} selectedId={selected} onSelect={pick} heading={heading} onPing={() => void f.load()} allClear={allClear} />
                    <div className="fml-radar-legend" aria-label="Colours">
                      <span data-f="live">
                        <i /> Live
                      </span>
                      <span data-f="recent">
                        <i /> Last hour
                      </span>
                      <span data-f="today">
                        <i /> Today
                      </span>
                      <span data-f="old">
                        <i /> Older
                      </span>
                      <span data-lost="true">
                        <i /> Lost
                      </span>
                    </div>
                    <p className="fml-radar-note">
                      {center ? `Centered on ${centerName}. ` : "Nothing located yet. "}Rings: 100 ft · ¼ mi · 2 mi · 25 mi · 500 mi. Tap the dish to refresh.
                    </p>
                  </>
                ) : (
                  <FmlMap devices={devices} here={f.here} selectedId={selected} onSelect={pick} />
                )}
              </section>

              <div className="fml-side" style={{ display: "grid", gap: 14 }}>
                {wide && sel && (
                  <section className="fml-panel fml-detail-panel" aria-label={`${sel.name} details`}>
                    <DeviceDetail
                      key={sel.id}
                      device={sel}
                      doc={doc!}
                      here={f.here ?? center}
                      pingTemplate={f.view.ping}
                      car={f.view.car}
                      isThis={sel.id === f.thisId}
                      act={f.act}
                      busy={f.busy}
                      locateNow={f.locateNow}
                      makeThisFindable={(n) => f.makeThisFindable(n, sel.kind)}
                      toast={toast}
                      onClose={() => setSelected(null)}
                    />
                  </section>
                )}
                <section className="fml-panel fml-list" aria-label="Your things">
                  <div className="fml-list-head">
                    <label className="sr-only-fml" htmlFor="fml-filter">
                      Search your things
                    </label>
                    <input id="fml-filter" className="fml-filter" placeholder={`Search ${devices.length} things`} value={query} onChange={(e) => setQuery(e.target.value)} />
                    {!f.thisId && (
                      <button type="button" className="fml-btn fml-btn-sm" onClick={() => void f.makeThisFindable()} disabled={f.busy === "this"}>
                        Add this device
                      </button>
                    )}
                  </div>
                  {filtered.map((d) => (
                    <Row key={d.id} d={d} here={f.here ?? center} places={doc!} selected={d.id === selected} isThis={d.id === f.thisId} onPick={() => pick(d.id)} />
                  ))}
                  {filtered.length === 0 && <p style={{ padding: "18px 14px", fontSize: 13, color: "var(--fml-ink-faint)" }}>Nothing matches “{query}”.</p>}
                </section>
              </div>
            </div>
          </>
        )}
      </div>

      {sheet?.kind === "device" &&
        (() => {
          const d = devices.find((x) => x.id === sheet.id);
          if (!d) return null;
          return (
            <SheetFrame label={d.name} onClose={() => setSheet(null)} bare>
              <DeviceDetail
                device={d}
                doc={doc!}
                here={f.here ?? center}
                pingTemplate={f.view!.ping}
                car={f.view!.car}
                isThis={d.id === f.thisId}
                act={f.act}
                busy={f.busy}
                locateNow={f.locateNow}
                makeThisFindable={(n) => f.makeThisFindable(n, d.kind)}
                toast={toast}
                onClose={() => setSheet(null)}
              />
            </SheetFrame>
          );
        })()}
      {sheet?.kind === "add" && (
        <AddSheet
          hasThis={Boolean(f.thisId)}
          onClose={() => setSheet(null)}
          onThis={async () => {
            await f.makeThisFindable();
            setSheet(null);
          }}
          onAdd={async (kind, name, tag) => {
            const v = await f.act("device.add", { kind, name, tag }, "add");
            if (!v) return;
            const added = v.doc.devices[0];
            toast(`${added.name} added. Set up how it's found below.`);
            setSelected(added.id);
            setSheet(wide ? null : { kind: "device", id: added.id });
          }}
          busy={f.busy}
        />
      )}
      {sheet?.kind === "setup" && f.view && <SetupSheet f={f} onClose={() => setSheet(null)} toast={toast} />}

      {f.ringingMe && me && <Ringing name={me.name} onFound={() => void f.act("device.ack", { id: me.id })} />}
      {toastMsg && (
        <Portal>
          <div className="fml">
            <div className="fml-toast" role="status" data-tone={toastMsg.tone}>
              {toastMsg.text}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

function HeadActions({ onAdd, onSetup }: { onAdd: () => void; onSetup: () => void }) {
  return (
    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
      <button type="button" className="fml-icon-btn" onClick={onSetup} aria-label="Setup: places, car, privacy" title="Setup">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
      </button>
      <button type="button" className="fml-btn fml-btn-hot" onClick={onAdd}>
        + Add
      </button>
    </div>
  );
}

function Stats({ devices, lowBattery }: { devices: Device[]; lowBattery: number }) {
  const now = new Date();
  const live = devices.filter((d) => freshness(bestFix(d), now) === "live").length;
  const located = devices.filter((d) => bestFix(d)).length;
  const lost = devices.filter((d) => d.lost).length;
  return (
    <div className="fml-stats" aria-label="At a glance">
      <span className="fml-stat">
        <b>{String(devices.length).padStart(2, "0")}</b> tracked
      </span>
      <span className="fml-stat" data-tone={located === devices.length ? "good" : "warn"}>
        <b>{String(located).padStart(2, "0")}</b> located
      </span>
      <span className="fml-stat" data-tone="good">
        <b>{String(live).padStart(2, "0")}</b> live now
      </span>
      {lowBattery > 0 && (
        <span className="fml-stat" data-tone="bad">
          <b>{String(lowBattery).padStart(2, "0")}</b> low battery
        </span>
      )}
      {lost > 0 && (
        <span className="fml-stat" data-tone="bad">
          <b>{String(lost).padStart(2, "0")}</b> lost
        </span>
      )}
    </div>
  );
}

function Row({ d, here, places, selected, isThis, onPick }: { d: Device; here: Fix | null; places: { places: { id: string; name: string; lat: number; lng: number }[] }; selected: boolean; isThis: boolean; onPick: () => void }) {
  const fix = bestFix(d);
  const now = new Date();
  const f = d.lost ? "lost" : freshness(fix, now);
  const dist = fix && here ? distanceM(here, fix) : NaN;
  const atPlace = fix ? placeFor(places, fix) : undefined;
  return (
    <button type="button" className="fml-row" aria-pressed={selected} onClick={onPick} data-f={f} data-lost={d.lost ? "true" : undefined}>
      <span className="fml-row-icon">
        <KindIcon kind={d.kind} size={20} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="fml-row-name">
          {d.name}
          {isThis && <span className="fml-chip" data-f="recent">This</span>}
          {d.lost && <span className="fml-chip fml-chip-lost">Lost</span>}
        </span>
        <span className="fml-row-where" style={{ display: "block" }}>
          {fix ? `${atPlace ? `At ${atPlace.name}` : whereText(places, fix)} · ${ago(fix, now)}` : "Not located yet — tap to set up"}
        </span>
      </span>
      <span className="fml-row-meta">
        {fix ? (
          <span className="fml-chip" data-f={f}>
            {SOURCE_SHORT[fix.source]}
          </span>
        ) : (
          <span className="fml-chip" data-f="never">
            Set up
          </span>
        )}
        <span>
          {Number.isFinite(dist) ? `${distanceText(dist)}${dist > 15 ? ` ${compass(bearingDeg(here!, fix!))}` : ""}` : ""}
          {d.fixes[0]?.battery !== undefined && (
            <>
              {" "}
              <Battery fix={d.fixes[0]} />
            </>
          )}
        </span>
      </span>
    </button>
  );
}

function FirstRun({ onThis, onAdd, busy }: { onThis: () => void; onAdd: () => void; busy: boolean }) {
  const guess = typeof navigator === "undefined" ? { kind: "phone" as Kind, name: "This device" } : thisDeviceGuess();
  return (
    <div className="fml-panel fml-hero">
      <div style={{ width: "min(78vw, 300px)" }}>
        <Radar devices={[]} center={null} label="Empty radar" />
      </div>
      <h2>Everything you own, on one radar</h2>
      <p>Phone, laptop, Meta glasses, car, keys, wallet. Start with the device in your hand — it takes one tap and it shows up here live.</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="fml-btn fml-btn-hot" onClick={onThis} disabled={busy}>
          {busy ? "Finding you…" : `Make ${guess.name.replace(/^My /, "my ")} findable`}
        </button>
        <button type="button" className="fml-btn" onClick={onAdd}>
          Add something else
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--fml-ink-faint)" }}>Your locations are private to your account and history clears itself after 30 days.</p>
    </div>
  );
}

function Portal({ children }: { children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.body), []);
  return el ? createPortal(children, el) : null;
}

function SheetFrame({ label, onClose, children, bare }: { label: string; onClose: () => void; children: React.ReactNode; bare?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <Portal>
      <div className="fml">
        <div className="fml-sheet-backdrop" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div className="fml-sheet" style={bare ? { padding: 0 } : undefined}>
            {children}
          </div>
        </div>
      </div>
    </Portal>
  );
}

function AddSheet({
  hasThis,
  onClose,
  onThis,
  onAdd,
  busy,
}: {
  hasThis: boolean;
  onClose: () => void;
  onThis: () => Promise<void>;
  onAdd: (kind: Kind, name: string, tag?: TagBrand) => Promise<void>;
  busy: string | null;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [name, setName] = useState("");
  const [tag, setTag] = useState<TagBrand>("airtag");
  const info = kind ? KIND_BY_ID[kind] : null;
  const guess = thisDeviceGuess();
  return (
    <SheetFrame label="Add something" onClose={onClose}>
      <div className="fml-sheet-head">
        {kind && (
          <button type="button" className="fml-icon-btn" onClick={() => setKind(null)} aria-label="Back">
            ←
          </button>
        )}
        <div style={{ flex: 1 }}>
          <p className="fml-kicker">{kind ? "Step 2 of 2" : "Step 1 of 2"}</p>
          <h2 className="fml-display" style={{ fontSize: 20, fontWeight: 700 }}>
            {info ? `Add a ${info.label.toLowerCase()}` : "What are you adding?"}
          </h2>
        </div>
        <button type="button" className="fml-icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {!kind ? (
        <>
          {!hasThis && (
            <button type="button" className="fml-this" onClick={() => void onThis()} disabled={busy === "this"}>
              <span className="fml-detail-icon" data-f="recent" style={{ width: 48, height: 48 }}>
                <KindIcon kind={guess.kind} size={24} />
              </span>
              <span>
                <b style={{ display: "block", fontSize: 14.5 }}>This device</b>
                <span style={{ fontSize: 12.5, color: "var(--fml-ink-soft)" }}>One tap — {guess.name.replace(/^My /, "your ")} shows up live</span>
              </span>
              <span className="fml-chip" data-f="live">
                {busy === "this" ? "…" : "Best"}
              </span>
            </button>
          )}
          <div className="fml-kinds">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className="fml-kind"
                onClick={() => {
                  setKind(k.id);
                  setName("");
                  setTag(k.tagged ? "airtag" : "none");
                }}
              >
                <KindIcon kind={k.id} size={24} />
                {k.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await onAdd(kind, name.trim() || info!.example, info!.tagged || kind === "other" ? tag : undefined);
          }}
          style={{ display: "grid", gap: 14 }}
        >
          <div>
            <label className="fml-label" htmlFor="fml-add-name">
              Name it
            </label>
            <input id="fml-add-name" className="fml-input" placeholder={info!.example} value={name} onChange={(e) => setName(e.target.value)} maxLength={48} autoFocus />
          </div>
          {(info!.tagged || kind === "other") && (
            <div>
              <label className="fml-label" htmlFor="fml-add-tag">
                Tracker tag on it
              </label>
              <select id="fml-add-tag" className="fml-input" value={tag} onChange={(e) => setTag(e.target.value as TagBrand)}>
                {TAGS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p style={{ fontSize: 13, color: "var(--fml-ink-soft)", lineHeight: 1.5 }}>{info!.how}</p>
          <button type="submit" className="fml-btn fml-btn-hot" disabled={busy === "add"}>
            {busy === "add" ? "Adding…" : `Add ${name.trim() || info!.example}`}
          </button>
        </form>
      )}
    </SheetFrame>
  );
}

function SetupSheet({ f, onClose, toast }: { f: ReturnType<typeof useFindMyLife>; onClose: () => void; toast: (m: string, tone?: "bad") => void }) {
  const view = f.view!;
  const [placeName, setPlaceName] = useState("Home");
  const [wipe, setWipe] = useState(false);
  const me = view.doc.devices.find((d) => d.id === f.thisId);
  return (
    <SheetFrame label="Setup" onClose={onClose}>
      <div className="fml-sheet-head">
        <div style={{ flex: 1 }}>
          <p className="fml-kicker">Find My Life</p>
          <h2 className="fml-display" style={{ fontSize: 20, fontWeight: 700 }}>
            Setup
          </h2>
        </div>
        <button type="button" className="fml-icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <section>
        <p className="fml-kicker">This device</p>
        {me ? (
          <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--fml-ink-soft)" }}>
            This browser is <b style={{ color: "var(--fml-ink)" }}>{me.name}</b>. It checks in while Find My Life or your Jarvis dashboard is open.{" "}
            <button type="button" className="fml-btn fml-btn-sm" onClick={() => f.forgetThis()}>
              Stop reporting here
            </button>
          </p>
        ) : (
          <p style={{ marginTop: 6 }}>
            <button type="button" className="fml-btn fml-btn-hot" onClick={() => void f.makeThisFindable()}>
              Make this device findable
            </button>
          </p>
        )}
      </section>

      <section className="fml-section">
        <p className="fml-kicker">Places</p>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--fml-ink-soft)" }}>Name the spots you go most, so it says “At Home” instead of an address.</p>
        <form
          style={{ display: "flex", gap: 6, marginTop: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const at = f.here ?? (await f.locateNow());
            if (!at) return;
            if (await f.act("place.save", { name: placeName, lat: at.lat, lng: at.lng })) toast(`Saved where you are as ${placeName}.`);
          }}
        >
          <label className="sr-only-fml" htmlFor="fml-place">
            Place name
          </label>
          <input id="fml-place" className="fml-input" value={placeName} onChange={(e) => setPlaceName(e.target.value)} maxLength={40} />
          <button type="submit" className="fml-btn">
            Save here
          </button>
        </form>
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }}>
          {view.doc.places.map((p) => (
            <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ flex: 1 }}>{p.name}</span>
              <button type="button" className="fml-btn fml-btn-sm" onClick={() => void f.act("place.remove", { id: p.id })} aria-label={`Remove ${p.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="fml-section">
        <p className="fml-kicker">Cars</p>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--fml-ink-soft)" }}>
          {!view.car.configured
            ? "Live car location needs Smartcar set up once in Jarvis › Profile › Connections › Cars. The parked-here pin works without it."
            : view.car.connected
              ? "Your car-maker account is connected."
              : "Sign in with your car-maker account to see your car live."}
        </p>
        <p style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!view.car.configured ? (
            <a className="fml-btn fml-btn-sm" href="/apps/jarvis#connections/cars">
              Set up Smartcar
            </a>
          ) : view.car.connected ? (
            <>
              <button type="button" className="fml-btn fml-btn-sm" onClick={() => void f.act("car.refresh", {}, "car")}>
                Ask the car now
              </button>
              <button type="button" className="fml-btn fml-btn-sm fml-btn-danger" onClick={() => void f.act("car.disconnect")}>
                Disconnect cars
              </button>
            </>
          ) : (
            <a className="fml-btn fml-btn-sm fml-btn-hot" href="/api/find-my-life/car/connect">
              Connect car
            </a>
          )}
        </p>
      </section>

      <section className="fml-section">
        <p className="fml-kicker">iPhone Shortcut link</p>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--fml-ink-soft)" }}>Each device&apos;s setup shows its own link. If one ever leaks, make a new key — every old link stops working and you paste the new one into your automations.</p>
        <p style={{ marginTop: 8 }}>
          <button
            type="button"
            className="fml-btn fml-btn-sm"
            onClick={async () => {
              if (await f.act("key.rotate")) toast("New key made. Old Shortcut links no longer work.");
            }}
          >
            Make a new key
          </button>
        </p>
      </section>

      <section className="fml-section">
        <p className="fml-kicker">Privacy</p>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--fml-ink-soft)" }}>
          Locations are kept on your account only, never shown to anyone else, and anything older than 30 days clears itself.
        </p>
        <p style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {wipe ? (
            <>
              <span style={{ fontSize: 13 }}>Delete every device and all location history?</span>
              <button
                type="button"
                className="fml-btn fml-btn-sm fml-btn-danger"
                onClick={async () => {
                  if (await f.act("all.delete")) {
                    f.forgetThis();
                    toast("Everything deleted.");
                    onClose();
                  }
                }}
              >
                Yes, delete all
              </button>
              <button type="button" className="fml-btn fml-btn-sm" onClick={() => setWipe(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="fml-btn fml-btn-sm fml-btn-danger" onClick={() => setWipe(true)}>
              Delete all my data
            </button>
          )}
        </p>
      </section>
    </SheetFrame>
  );
}

function Ringing({ name, onFound }: { name: string; onFound: () => void }) {
  // Browsers may keep a page silent until it's touched, so the first tap anywhere
  // restarts the sound from inside that tap.
  const stopRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    stopRef.current = startRinging();
    return () => stopRef.current();
  }, []);
  return (
    <Portal>
      <div className="fml">
        <div
          className="fml-ringing"
          role="alertdialog"
          aria-label={`${name} is being rung`}
          onClick={() => {
            stopRef.current();
            stopRef.current = startRinging();
          }}
        >
          <span className="fml-ringing-dot" aria-hidden />
          <div>
            <p className="fml-kicker">Find My Life</p>
            <h2 className="fml-display" style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>
              Here I am
            </h2>
            <p style={{ marginTop: 6, color: "var(--fml-ink-soft)" }}>Someone pressed Ring on {name}.</p>
          </div>
          <button type="button" className="fml-btn fml-btn-hot" style={{ minHeight: 54, padding: "0 28px", fontSize: 16 }}
            onClick={(e) => {
              e.stopPropagation();
              stopRef.current();
              onFound();
            }}
          >
            Found it — stop
          </button>
        </div>
      </div>
    </Portal>
  );
}
