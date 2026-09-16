"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Chakra_Petch, JetBrains_Mono } from "next/font/google";
import { loadCesium } from "@/lib/gods-eye/cesium";
import {
  GlobeEngine,
  LAYERS,
  type CameraView,
  type DetectMode,
  type LayerId,
  type LayerStatus,
  type MapSource,
  type Readout,
  type Selection,
} from "@/lib/gods-eye/globe";
import { STYLES, type StyleId } from "@/lib/gods-eye/shaders";
import { LOCATIONS, describeCommands, parseCommand, type HudMode, type LocationPreset } from "@/lib/gods-eye/commands";
import { formatAltitude, formatLat, formatLon, orbitStamp } from "@/lib/gods-eye/geo";
import type { Place, SearchFeed } from "@/lib/gods-eye/types";
import styles from "./gods-eye.module.css";

const display = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"] });

const KEYS_STORAGE = "gods-eye-view.keys";
const MAP_SOURCES: { id: MapSource; label: string }[] = [
  { id: "esri", label: "ESRI SATELLITE" },
  { id: "osm", label: "OSM" },
  { id: "google3d", label: "GOOGLE 3D" },
];

type Keys = { googleKey: string; ionToken: string };
type LayerMap = Record<LayerId, boolean>;

const DEFAULT_LAYERS: LayerMap = {
  flights: true,
  military: true,
  satellites: false,
  quakes: true,
  cctv: false,
  cables: false,
};

function readKeys(): Keys {
  let stored: Partial<Keys> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEYS_STORAGE) ?? "{}") as Partial<Keys>;
  } catch {
    /* private mode */
  }
  return {
    googleKey: stored.googleKey || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "",
    ionToken: stored.ionToken || process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "",
  };
}

interface HashState {
  view?: CameraView;
  style?: StyleId;
  layers?: LayerMap;
  source?: MapSource;
}

function readHash(): HashState {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const out: HashState = {};
  const v = p.get("v")?.split(",").map(Number);
  if (v?.length === 5 && v.every(Number.isFinite)) {
    out.view = { lat: v[0], lon: v[1], alt: v[2], heading: v[3], pitch: v[4] };
  }
  const s = p.get("s");
  if (s && STYLES.some((x) => x.id === s)) out.style = s as StyleId;
  const l = p.get("l");
  if (l !== null) {
    const on = new Set(l.split(","));
    out.layers = Object.fromEntries(LAYERS.map((x) => [x.id, on.has(x.id)])) as LayerMap;
  }
  const m = p.get("m");
  if (m && MAP_SOURCES.some((x) => x.id === m)) out.source = m as MapSource;
  return out;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

export function GodsEyeView() {
  const globeRef = useRef<HTMLDivElement>(null);
  const creditsRef = useRef<HTMLDivElement>(null);
  const detectRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const hashRef = useRef<HashState | null>(null);

  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [keys, setKeys] = useState<Keys | null>(null);

  const [style, setStyle] = useState<StyleId>("normal");
  const [layers, setLayers] = useState<LayerMap>(DEFAULT_LAYERS);
  const [status, setStatus] = useState<Partial<Record<LayerId, LayerStatus>>>({});
  const [source, setSource] = useState<MapSource>("esri");
  const [hud, setHud] = useState<HudMode>("tactical");
  const [detect, setDetect] = useState<DetectMode>("sparse");
  const [density, setDensity] = useState(60);
  const [scopeOn, setScopeOn] = useState(true);
  const [feather, setFeather] = useState(14);
  const [outside, setOutside] = useState(55);
  const [lighting, setLighting] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [ironbow, setIronbow] = useState(true);

  const [readout, setReadout] = useState<Readout | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tracking, setTracking] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [locOpen, setLocOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [command, setCommand] = useState("");
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [camTick, setCamTick] = useState(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const flash = useCallback((text: string) => setToast({ text, id: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  // ----- Boot: keys, share-link state, narrow-screen defaults ---------------
  useEffect(() => {
    const h = readHash();
    hashRef.current = h;
    if (h.style) setStyle(h.style);
    if (h.layers) setLayers(h.layers);
    if (h.source) setSource(h.source);
    if (window.matchMedia("(max-width: 860px)").matches) {
      setLeftOpen(false);
      setRightOpen(false);
    }
    setKeys(readKeys());
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ----- Engine lifecycle (rebuilt when keys change) -------------------------
  useEffect(() => {
    if (!keys) return;
    let engine: GlobeEngine | null = null;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    if (!(canvas.getContext("webgl2") || canvas.getContext("webgl"))) {
      setFatal("This device has no WebGL, which the 3D globe needs.");
      return;
    }
    loadCesium()
      .then((C) => {
        if (cancelled || !globeRef.current || !creditsRef.current || !detectRef.current) return;
        engine = new GlobeEngine(
          C,
          globeRef.current,
          creditsRef.current,
          detectRef.current,
          {
            select: setSelection,
            tracking: setTracking,
            readout: setReadout,
            layer: (id, s) => setStatus((prev) => ({ ...prev, [id]: s })),
            message: flash,
          },
          { googleKey: keys.googleKey || undefined, ionToken: keys.ionToken || undefined },
        );
        engineRef.current = engine;
        // Dev-only handle for inspecting the globe from the console / preview harness.
        if (process.env.NODE_ENV !== "production") (window as unknown as { __gev?: GlobeEngine }).__gev = engine;
        const view = hashRef.current?.view;
        if (view) engine.setView(view);
        else engine.intro();
        setReady(true);
      })
      .catch((err: unknown) => setFatal(err instanceof Error ? err.message : "The globe failed to start."));
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
      setReady(false);
      setStatus({});
      setSelection(null);
      setTracking(false);
    };
  }, [keys, flash]);

  // ----- React state → engine ------------------------------------------------
  useEffect(() => {
    if (ready) engineRef.current?.setStyle(style);
  }, [ready, style]);

  useEffect(() => {
    if (!ready) return;
    for (const l of LAYERS) engineRef.current?.setLayer(l.id, layers[l.id]);
  }, [ready, layers]);

  useEffect(() => {
    if (!ready) return;
    void engineRef.current?.setMapSource(source).then((ok) => {
      if (!ok && source === "google3d") setSource("esri");
    });
  }, [ready, source]);

  useEffect(() => {
    if (ready) engineRef.current?.setDetection(detect, density);
  }, [ready, detect, density]);

  useEffect(() => {
    if (ready) engineRef.current?.setLighting(lighting);
  }, [ready, lighting]);

  useEffect(() => {
    if (ready) engineRef.current?.setAutoRotate(autoRotate);
  }, [ready, autoRotate]);

  useEffect(() => {
    if (ready) engineRef.current?.setStyleParam("flir", "palette", ironbow ? 1 : 0);
  }, [ready, ironbow]);

  // A new lock-on should always show its context card, even with the panel tucked away.
  const selectedKey = selection ? `${selection.layer}:${selection.key}` : null;
  useEffect(() => {
    if (selectedKey) setRightOpen(true);
  }, [selectedKey]);

  // CCTV stills refresh; TfL republishes roughly every few minutes.
  useEffect(() => {
    if (selection?.layer !== "cctv") return;
    const t = setInterval(() => setCamTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [selection?.layer, selection?.key]);

  // ----- Share link: keep the hash in step with the view ---------------------
  useEffect(() => {
    if (!ready) return;
    const write = () => {
      const e = engineRef.current;
      if (!e) return;
      const v = e.getView();
      const p = new URLSearchParams();
      p.set("v", [v.lat.toFixed(4), v.lon.toFixed(4), Math.round(v.alt), v.heading.toFixed(1), v.pitch.toFixed(1)].join(","));
      p.set("s", style);
      p.set("l", LAYERS.filter((l) => layers[l.id]).map((l) => l.id).join(","));
      p.set("m", source);
      window.history.replaceState(null, "", `#${p.toString()}`);
    };
    write();
    const t = setInterval(write, 2000);
    return () => clearInterval(t);
  }, [ready, style, layers, source]);

  // ----- Actions -------------------------------------------------------------
  const flyToPreset = useCallback(
    (loc: LocationPreset) => {
      engineRef.current?.flyTo(loc.lon, loc.lat, loc.range, loc.heading, loc.pitch);
      if (loc.id === "london") setLayers((p) => ({ ...p, cctv: true }));
      setLocOpen(false);
      flash(`FLYING TO ${loc.label}`);
    },
    [flash],
  );

  const flyToPlace = useCallback(
    (place: Place) => {
      let range = 6_000;
      if (place.extent) {
        const [w, s, e, n] = place.extent;
        const spanKm = Math.max(Math.abs(e - w) * 111 * Math.cos((place.lat * Math.PI) / 180), Math.abs(n - s) * 111);
        range = Math.min(4_000_000, Math.max(2_500, spanKm * 1_400));
      }
      engineRef.current?.flyTo(place.lon, place.lat, range, 0, range > 500_000 ? -80 : -40);
      setLocOpen(false);
      setPlaces([]);
      flash(`FLYING TO ${place.name.toUpperCase()}`);
    },
    [flash],
  );

  const searchPlaces = useCallback(async (q: string): Promise<Place[]> => {
    if (!q.trim()) return [];
    try {
      const res = await fetch(`/api/gods-eye/search?q=${encodeURIComponent(q)}`);
      const body = (await res.json()) as SearchFeed;
      return body.places ?? [];
    } catch {
      return [];
    }
  }, []);

  const runCommand = useCallback(
    async (text: string) => {
      const engine = engineRef.current;
      const cmds = parseCommand(text);
      if (!cmds.length) {
        flash(`NO COMMAND IN “${text.toUpperCase()}”`);
        return;
      }
      flash(describeCommands(cmds));
      for (const c of cmds) {
        switch (c.type) {
          case "style":
            setStyle(c.style);
            break;
          case "layer":
            setLayers((p) => ({ ...p, [c.layer]: c.on }));
            break;
          case "reset":
            engine?.resetGlobe();
            break;
          case "hud":
            setHud(c.mode);
            break;
          case "detect":
            setDetect(c.mode);
            break;
          case "untrack":
            engine?.untrack();
            break;
          case "track": {
            const satLike = ["ISS", "CSS", "HST"].includes(c.query) || /STARLINK|NOAA|GPS|COSMOS/.test(c.query);
            if (satLike) setLayers((p) => ({ ...p, satellites: true }));
            if (!engine?.trackByName(c.query)) flash(`ACQUIRING ${c.query}…`);
            break;
          }
          case "fly": {
            const preset = LOCATIONS.find((l) => l.label.toLowerCase() === c.place || l.id === c.place.replace(/\s+/g, "-"));
            if (preset) {
              flyToPreset(preset);
            } else {
              const found = await searchPlaces(c.place);
              if (found[0]) flyToPlace(found[0]);
              else flash(`NO PLACE MATCHES “${c.place.toUpperCase()}”`);
            }
            break;
          }
        }
      }
    },
    [flash, flyToPlace, flyToPreset, searchPlaces],
  );

  const startListening = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) {
      flash("VOICE NEEDS CHROME, EDGE OR SAFARI — TYPE A COMMAND INSTEAD");
      return;
    }
    if (recognitionRef.current) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const results = Array.from(e.results);
      const transcript = results.map((r) => r[0].transcript).join(" ");
      setCommand(transcript);
      const last = results[results.length - 1];
      if (last?.isFinal) void runCommand(transcript);
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") flash(`VOICE ERROR: ${e.error.toUpperCase()}`);
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }, [flash, runCommand]);

  const stopListening = useCallback(() => recognitionRef.current?.stop(), []);

  // ----- Keyboard ------------------------------------------------------------
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = STYLES.find((x) => x.key === e.key);
      if (s) {
        setStyle(s.id);
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) startListening();
      } else if (e.key === "h" || e.key === "H") {
        setHud((m) => (m === "tactical" ? "minimal" : m === "minimal" ? "clean" : "tactical"));
      } else if (e.key === "r" || e.key === "R") {
        engineRef.current?.resetGlobe();
      } else if (e.key === "Escape") {
        engineRef.current?.clearSelection();
        setLocOpen(false);
        setPowerOpen(false);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e.target)) stopListening();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startListening, stopListening]);

  // Debounced place search in the LOCATION tray.
  useEffect(() => {
    if (!locOpen || query.trim().length < 2) {
      setPlaces([]);
      return;
    }
    const t = setTimeout(() => void searchPlaces(query).then(setPlaces), 350);
    return () => clearTimeout(t);
  }, [query, locOpen, searchPlaces]);

  const activeStyle = STYLES.find((s) => s.id === style)!;
  const stamp = orbitStamp(clock);
  const utc = clock.toISOString().replace("T", " ").slice(0, 19) + "Z";
  const keysConfigured = !!(keys?.googleKey || keys?.ionToken);
  const scopeVars = {
    "--feather": `${feather}vmin`,
    "--outside": outside / 100,
  } as React.CSSProperties;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      flash("SHARE LINK COPIED");
    } catch {
      flash("COULD NOT COPY — USE THE ADDRESS BAR");
    }
  };

  return (
    <div className={`${styles.root} ${mono.className}`} data-hud={hud} data-style={style}>
      <div ref={globeRef} className={styles.globe} />
      <canvas ref={detectRef} className={styles.detect} aria-hidden />
      {scopeOn && hud !== "clean" && (
        <div className={styles.scope} style={scopeVars} aria-hidden>
          <svg className={styles.scopeRing} viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
            <circle cx="100" cy="100" r="96" />
            {Array.from({ length: 72 }, (_, i) => {
              const a = (i * 5 * Math.PI) / 180;
              const long = i % 6 === 0;
              const r1 = long ? 90.5 : 93;
              return (
                <line
                  key={i}
                  x1={100 + Math.sin(a) * r1}
                  y1={100 - Math.cos(a) * r1}
                  x2={100 + Math.sin(a) * 96}
                  y2={100 - Math.cos(a) * 96}
                  className={long ? styles.tickLong : undefined}
                />
              );
            })}
          </svg>
        </div>
      )}
      {hud !== "clean" && <div className={styles.scan} aria-hidden />}
      {hud !== "clean" && (
        <div className={styles.crosshair} aria-hidden>
          <span />
        </div>
      )}

      {!ready && !fatal && (
        <div className={styles.boot}>
          <div className={`${styles.bootTitle} ${display.className}`}>GOD&apos;S EYE VIEW</div>
          <div className={styles.bootLine}>ESTABLISHING UPLINK · KH11-4074</div>
          <div className={styles.bootBar}>
            <span />
          </div>
        </div>
      )}
      {fatal && (
        <div className={styles.boot}>
          <div className={`${styles.bootTitle} ${display.className}`}>UPLINK FAILED</div>
          <div className={styles.bootLine}>{fatal}</div>
          <Link href="/" className={styles.btn}>
            BACK TO HUB
          </Link>
        </div>
      )}

      {/* ----- Top chrome ------------------------------------------------ */}
      {hud !== "clean" && (
        <>
          <header className={styles.topLeft}>
            <div className={`${styles.brand} ${display.className}`}>
              <span className={styles.brandMark}>◉</span> GOD&apos;S EYE VIEW
            </div>
            {hud === "tactical" && (
              <>
                <div className={styles.classif}>TOP SECRET // SI-TK // NOFORN</div>
                <div className={styles.dim}>KH11-4074 · OPS-4113 · {tracking ? "TRACK LOCK" : "WIDE AREA"}</div>
              </>
            )}
            {readout && (
              <dl className={styles.telemetry}>
                <dt>LAT</dt>
                <dd>{formatLat(readout.lat)}</dd>
                <dt>LON</dt>
                <dd>{formatLon(readout.lon)}</dd>
                <dt>ALT</dt>
                <dd>{formatAltitude(readout.altM)}</dd>
                {hud === "tactical" && (
                  <>
                    <dt>GSD</dt>
                    <dd>{readout.gsd >= 1000 ? `${(readout.gsd / 1000).toFixed(1)} KM` : `${readout.gsd.toFixed(2)} M`}</dd>
                    <dt>NIIRS</dt>
                    <dd>{readout.niirs.toFixed(1)}</dd>
                    <dt>HDG</dt>
                    <dd>{Math.round(readout.heading).toString().padStart(3, "0")}° · PITCH {Math.round(readout.pitch)}°</dd>
                    <dt>SUN</dt>
                    <dd>
                      EL {readout.sunEl.toFixed(1)}° · AZ {Math.round(readout.sunAz)}°
                    </dd>
                  </>
                )}
              </dl>
            )}

            {/* Data layers flow under the telemetry, so they never collide with it. */}
            <aside className={`${styles.panel} ${styles.panelLeft}`} data-open={leftOpen}>
              <button className={styles.panelTab} onClick={() => setLeftOpen((o) => !o)} aria-expanded={leftOpen}>
                {leftOpen ? "‹" : "›"} LAYERS
              </button>
              {leftOpen && (
                <div className={styles.card}>
                  <div className={styles.cardHead}>DATA LAYERS</div>
                  <ul className={styles.layerList}>
                    {LAYERS.map((l) => {
                      const s = status[l.id];
                      const on = layers[l.id];
                      return (
                        <li key={l.id}>
                          <button
                            className={styles.layerRow}
                            data-on={on}
                            onClick={() => setLayers((p) => ({ ...p, [l.id]: !p[l.id] }))}
                            title={s?.note ?? l.source}
                          >
                            <span className={styles.switch} style={{ "--c": l.color } as React.CSSProperties} />
                            <span className={styles.layerName}>{l.label}</span>
                            <span className={styles.layerCount} data-state={on ? (s?.state ?? "loading") : "off"}>
                              {on
                                ? s?.state === "loading" || !s
                                  ? "···"
                                  : s.state === "error"
                                    ? "ERR"
                                    : s.count.toLocaleString("en-US")
                                : ""}
                            </span>
                            <span className={styles.layerSource}>
                              {on && s?.state === "error" ? s.note : on && s?.note ? s.note : l.source}
                              {on && s?.state === "stale" ? " · STALE" : ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className={styles.hint}>
                    Click any contact to lock on. Keys <kbd>1</kbd>–<kbd>7</kbd> switch sensors, <kbd>H</kbd> HUD,{" "}
                    <kbd>R</kbd> reset, hold <kbd>Space</kbd> to talk.
                  </div>
                </div>
              )}
            </aside>
          </header>

          <div className={styles.topCenter}>
            <Link href="/" className={styles.iconBtn} title="Back to hub">
              ⟵ HUB
            </Link>
            <button className={styles.iconBtn} onClick={() => engineRef.current?.resetGlobe()} title="Reset globe (R)">
              ⌂ RESET
            </button>
            <button
              className={styles.iconBtn}
              onClick={() => setHud((m) => (m === "tactical" ? "minimal" : "clean"))}
              title="Cycle HUD (H)"
            >
              HUD › {hud.toUpperCase()}
            </button>
            <button className={styles.iconBtn} onClick={copyLink} title="Copy a link to this exact view">
              ⧉ LINK
            </button>
          </div>

          <div className={styles.topRight}>
            <div className={styles.rec}>
              <span className={styles.recDot} /> REC {utc}
            </div>
            {hud === "tactical" && (
              <div className={styles.dim}>
                ORB: {stamp.orbit} PASS: {stamp.pass}
              </div>
            )}
            <div className={styles.activeStyle}>
              ACTIVE STYLE: <b>{activeStyle.label}</b>
            </div>
          </div>
        </>
      )}

      {hud === "clean" && (
        <button className={`${styles.iconBtn} ${styles.hudRestore}`} onClick={() => setHud("tactical")}>
          SHOW HUD
        </button>
      )}

      {/* ----- Right: display + context ---------------------------------- */}
      {hud !== "clean" && (
        <aside className={`${styles.panel} ${styles.panelRight}`} data-open={rightOpen}>
          <button className={styles.panelTab} onClick={() => setRightOpen((o) => !o)} aria-expanded={rightOpen}>
            DISPLAY {rightOpen ? "›" : "‹"}
          </button>
          {rightOpen && (
            <>
              {selection && (
                <div className={`${styles.card} ${styles.contextCard}`}>
                  <div className={styles.cardHead}>
                    CONTEXT
                    <button className={styles.close} onClick={() => engineRef.current?.clearSelection()} aria-label="Close">
                      ×
                    </button>
                  </div>
                  <div className={`${styles.ctxTitle} ${display.className}`}>{selection.title}</div>
                  <div className={styles.dim}>{selection.subtitle}</div>
                  {selection.layer === "cctv" && selection.image && (
                    <div className={styles.cctv}>
                      {selection.video ? (
                        <video
                          key={`${selection.key}-${camTick}`}
                          src={`${selection.video}?t=${camTick}`}
                          poster={`${selection.image}?t=${camTick}`}
                          autoPlay
                          muted
                          loop
                          playsInline
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${selection.image}?t=${camTick}`} alt={selection.title} />
                      )}
                      <span className={styles.cctvTag}>
                        <span className={styles.recDot} /> LIVE · {selection.key}
                      </span>
                    </div>
                  )}
                  <dl className={styles.fields}>
                    {selection.fields.map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className={styles.row}>
                    {tracking ? (
                      <button className={`${styles.btn} ${styles.btnHot}`} onClick={() => engineRef.current?.untrack()}>
                        RELEASE
                      </button>
                    ) : (
                      <button className={`${styles.btn} ${styles.btnHot}`} onClick={() => engineRef.current?.track()}>
                        TRACK
                      </button>
                    )}
                    <button className={styles.btn} onClick={() => engineRef.current?.focusSelection()}>
                      FOCUS
                    </button>
                    {selection.link && (
                      <a className={styles.btn} href={selection.link.href} target="_blank" rel="noreferrer">
                        {selection.link.label} ↗
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.card}>
                <div className={styles.cardHead}>DISPLAY</div>
                <div className={styles.label}>HUD</div>
                <div className={styles.seg}>
                  {(["tactical", "minimal", "clean"] as HudMode[]).map((m) => (
                    <button key={m} data-on={hud === m} onClick={() => setHud(m)}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className={styles.label}>DETECTION</div>
                <div className={styles.seg}>
                  {(["off", "sparse", "dense"] as DetectMode[]).map((m) => (
                    <button key={m} data-on={detect === m} onClick={() => setDetect(m)}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
                {detect === "dense" && (
                  <label className={styles.slider}>
                    <span>DENSITY</span>
                    <input type="range" min={0} max={100} value={density} onChange={(e) => setDensity(Number(e.target.value))} />
                    <b>{density}%</b>
                  </label>
                )}
                <div className={styles.label}>SCOPE</div>
                <div className={styles.seg}>
                  <button data-on={scopeOn} onClick={() => setScopeOn(true)}>
                    KEYHOLE
                  </button>
                  <button data-on={!scopeOn} onClick={() => setScopeOn(false)}>
                    FULL FRAME
                  </button>
                </div>
                {scopeOn && (
                  <>
                    <label className={styles.slider}>
                      <span>FEATHER</span>
                      <input type="range" min={0} max={40} value={feather} onChange={(e) => setFeather(Number(e.target.value))} />
                      <b>{feather}</b>
                    </label>
                    <label className={styles.slider}>
                      <span>OUTSIDE</span>
                      <input type="range" min={0} max={100} value={outside} onChange={(e) => setOutside(Number(e.target.value))} />
                      <b>{outside}%</b>
                    </label>
                  </>
                )}
                {style === "flir" && (
                  <>
                    <div className={styles.label}>FLIR PALETTE</div>
                    <div className={styles.seg}>
                      <button data-on={ironbow} onClick={() => setIronbow(true)}>
                        IRONBOW
                      </button>
                      <button data-on={!ironbow} onClick={() => setIronbow(false)}>
                        WHITE-HOT
                      </button>
                    </div>
                  </>
                )}
                <div className={styles.toggles}>
                  <button data-on={lighting} onClick={() => setLighting((v) => !v)}>
                    <span className={styles.switch} /> DAY / NIGHT
                  </button>
                  <button data-on={autoRotate} onClick={() => setAutoRotate((v) => !v)}>
                    <span className={styles.switch} /> ORBIT DRIFT
                  </button>
                </div>
              </div>
            </>
          )}
        </aside>
      )}

      {/* ----- Bottom dock ---------------------------------------------- */}
      <div className={styles.dock} data-hidden={hud === "clean"}>
        <div className={styles.dockSide}>
          <div className={styles.popWrap}>
            <button className={styles.pill} data-on={locOpen} onClick={() => setLocOpen((o) => !o)}>
              ⌖ LOCATION
            </button>
            {locOpen && (
              <div className={styles.pop}>
                <input
                  className={styles.input}
                  placeholder="Search any place…"
                  value={query}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && places[0]) flyToPlace(places[0]);
                  }}
                />
                {places.length > 0 && (
                  <ul className={styles.results}>
                    {places.map((p, i) => (
                      <li key={`${p.lon},${p.lat},${i}`}>
                        <button onClick={() => flyToPlace(p)}>
                          <b>{p.name}</b>
                          <span>{p.detail}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className={styles.presetGrid}>
                  {LOCATIONS.map((l) => (
                    <button key={l.id} onClick={() => flyToPreset(l)}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <form
          className={styles.voice}
          onSubmit={(e) => {
            e.preventDefault();
            if (command.trim()) void runCommand(command);
            setCommand("");
          }}
        >
          <button
            type="button"
            className={styles.mic}
            data-on={listening}
            onClick={() => (listening ? stopListening() : startListening())}
            aria-label={listening ? "Stop listening" : "Start voice control"}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
            </svg>
          </button>
          <input
            className={styles.input}
            value={command}
            enterKeyHint="go"
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              // Explicit, so a synthetic or IME Enter still runs the command.
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (command.trim()) void runCommand(command);
              setCommand("");
            }}
            placeholder={listening ? "Listening…" : "“fly to Tokyo” · “thermal” · “track the ISS”"}
            aria-label="Command"
          />
          <span className={styles.voiceLabel}>{listening ? "LISTENING" : "VOICE CONTROL · HOLD SPACE"}</span>
        </form>

        <div className={`${styles.dockSide} ${styles.dockRight}`}>
          <div className={styles.presets} role="radiogroup" aria-label="Visual presets">
            {STYLES.map((s) => (
              <button key={s.id} role="radio" aria-checked={style === s.id} data-on={style === s.id} onClick={() => setStyle(s.id)} title={s.blurb}>
                <kbd>{s.key}</kbd>
                {s.label}
              </button>
            ))}
          </div>
          <div className={styles.sources}>
            {MAP_SOURCES.map((m) => (
              <button
                key={m.id}
                data-on={source === m.id}
                data-locked={m.id === "google3d" && !keysConfigured}
                onClick={() => {
                  if (m.id === "google3d" && !keysConfigured) {
                    setPowerOpen(true);
                    return;
                  }
                  setSource(m.id);
                }}
              >
                {m.label}
                {m.id === "google3d" && !keysConfigured ? " 🔒" : ""}
              </button>
            ))}
            <button className={styles.power} data-on={keysConfigured} onClick={() => setPowerOpen(true)}>
              ⚡ {keysConfigured ? "POWERED UP" : "POWER UP"}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div key={toast.id} className={styles.toast} role="status">
          {toast.text}
        </div>
      )}

      <div ref={creditsRef} className={styles.credits} />

      {powerOpen && keys && (
        <PowerUp
          keys={keys}
          fontClass={display.className}
          onClose={() => setPowerOpen(false)}
          onSave={(next) => {
            try {
              localStorage.setItem(KEYS_STORAGE, JSON.stringify(next));
            } catch {
              /* private mode: keys last for this session only */
            }
            setPowerOpen(false);
            setSource("esri");
            setKeys(readKeysWith(next));
            flash("KEYS SAVED — GLOBE RESTARTING");
          }}
        />
      )}
    </div>
  );
}

function readKeysWith(next: Keys): Keys {
  return {
    googleKey: next.googleKey || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "",
    ionToken: next.ionToken || process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "",
  };
}

function PowerUp({
  keys,
  fontClass,
  onClose,
  onSave,
}: {
  keys: Keys;
  fontClass: string;
  onClose: () => void;
  onSave: (keys: Keys) => void;
}) {
  const [ion, setIon] = useState(keys.ionToken);
  const [google, setGoogle] = useState(keys.googleKey);
  const envIon = !!process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
  const envGoogle = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  return (
    <div className={styles.modalBack} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Power up the globe">
        <div className={`${styles.modalTitle} ${fontClass}`}>POWER UP THE GLOBE</div>
        <p className={styles.dim}>
          Everything on this globe already runs keyless. Keys add photorealistic 3D cities and world terrain. They stay in
          this browser (localStorage), and both are browser-side keys by design, so restrict them to this site&apos;s domain at
          the provider.
        </p>
        <div className={styles.keyRow}>
          <div>
            <b>CESIUM ION</b>
            <span>World terrain + Google 3D tiles via ion. Free for personal, non-commercial use.</span>
            <a href="https://ion.cesium.com/tokens" target="_blank" rel="noreferrer">
              Get a token ↗
            </a>
          </div>
          {envIon ? (
            <em>CONFIGURED EXTERNALLY</em>
          ) : (
            <input className={styles.input} type="password" value={ion} onChange={(e) => setIon(e.target.value)} placeholder="eyJhbGciOi…" />
          )}
        </div>
        <div className={styles.keyRow}>
          <div>
            <b>GOOGLE MAPS</b>
            <span>Photorealistic 3D Tiles directly from Google (Map Tiles API, billing-enabled).</span>
            <a href="https://console.cloud.google.com/google/maps-apis/api-list" target="_blank" rel="noreferrer">
              Get a key ↗
            </a>
          </div>
          {envGoogle ? (
            <em>CONFIGURED EXTERNALLY</em>
          ) : (
            <input className={styles.input} type="password" value={google} onChange={(e) => setGoogle(e.target.value)} placeholder="AIza…" />
          )}
        </div>
        <div className={styles.row}>
          <button className={`${styles.btn} ${styles.btnHot}`} onClick={() => onSave({ ionToken: envIon ? "" : ion.trim(), googleKey: envGoogle ? "" : google.trim() })}>
            SAVE KEYS
          </button>
          <button className={styles.btn} onClick={onClose}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
