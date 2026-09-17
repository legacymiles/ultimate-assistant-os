"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Chakra_Petch, JetBrains_Mono } from "next/font/google";
import { loadCesium } from "@/lib/gods-eye/cesium";
import {
  GlobeEngine,
  LAYERS,
  type Allocation,
  type CameraView,
  type ModelMode,
  type CockpitInfo,
  type DetectMode,
  type HoverInfo,
  type NearbyContact,
  type LayerId,
  type LayerStatus,
  type MapSource,
  type Readout,
  type Selection,
} from "@/lib/gods-eye/globe";
import { STYLES, type StyleId } from "@/lib/gods-eye/shaders";
import { LOCATIONS, describeCommands, parseCommand, type HudMode, type LocationPreset } from "@/lib/gods-eye/commands";
import { formatAltitude, formatLat, formatLon, orbitStamp } from "@/lib/gods-eye/geo";
import type { Place, Poi, SearchFeed } from "@/lib/gods-eye/types";
import type { AgentAction, AgentModel, ChatTurn } from "@/lib/gods-eye/agent";
import { RadioDeck, type RadioHandle } from "./RadioDeck";
import { LiveCam, type FeedMode } from "./LiveCam";
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
  launches: false,
  vessels: false,
  traffic: false,
  fires: false,
  datacenters: false,
  dams: false,
};

const FIRST_VIEW_STORAGE = "gods-eye-view.first-view-dismissed";
const AGENT_STORAGE = "gods-eye-view.agent";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read a reply aloud with the browser's own speech synthesis. */
function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    u.voice =
      voices.find((v) => /en[-_]US/i.test(v.lang) && /(Google|Natural|Aria|Guy|Samantha|Daniel)/i.test(v.name)) ??
      voices.find((v) => /^en/i.test(v.lang)) ??
      null;
    u.rate = 1.05;
    synth.speak(u);
  } catch {
    /* no speech synthesis: the reply is still on screen */
  }
}
const SCENES_STORAGE = "gods-eye-view.scenes";

interface Shot {
  id: string;
  name: string;
  view: CameraView;
  style: StyleId;
  layers: LayerId[];
}

function readShots(): Shot[] {
  try {
    const v = JSON.parse(localStorage.getItem(SCENES_STORAGE) ?? "[]") as Shot[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeShots(shots: Shot[]) {
  try {
    localStorage.setItem(SCENES_STORAGE, JSON.stringify(shots));
  } catch {
    /* private mode: shots last for this visit */
  }
}

const pad3 = (n: number) => String(Math.round(((n % 360) + 360) % 360)).padStart(3, "0");
const compassLabel = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

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
  const [camExpanded, setCamExpanded] = useState(false);
  const [camSnapshot, setCamSnapshot] = useState<"ok" | "err" | "loading">("loading");
  const [camMode, setCamMode] = useState<FeedMode>("still");
  // Measured from the feed itself: how long between two genuinely new frames.
  const [camGap, setCamGap] = useState<number | null>(null);
  const lastFrame = useRef(0);
  const onCamFrame = useCallback((at: number) => {
    if (lastFrame.current) setCamGap((prev) => (prev ? prev * 0.6 + (at - lastFrame.current) * 0.4 : at - lastFrame.current));
    lastFrame.current = at;
  }, []);
  const [autoHop, setAutoHop] = useState(false);
  const [videoOnly, setVideoOnly] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [cockpit, setCockpit] = useState<CockpitInfo | null>(null);
  const [celestial, setCelestial] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [contextTab, setContextTab] = useState<"contacts" | "missions">("contacts");
  const [contacts, setContacts] = useState<NearbyContact[]>([]);
  const [contactCounts, setContactCounts] = useState({ flt: 0, ais: 0 });
  const [missions, setMissions] = useState<Poi[]>([]);
  const [scenesOpen, setScenesOpen] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [playing, setPlaying] = useState<number | null>(null);
  const [firstView, setFirstView] = useState(false);
  const [allocation, setAllocation] = useState<Allocation>("elastic");
  const [labelFade, setLabelFade] = useState(0);
  const [modelMode, setModelMode] = useState<ModelMode>("off");
  const [agentModel, setAgentModel] = useState<AgentModel>("std");
  const [agentVoice, setAgentVoice] = useState(true);
  const [agentBusy, setAgentBusy] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [radioOpen, setRadioOpen] = useState(false);
  const [radioOn, setRadioOn] = useState<string | null>(null);
  const radioRef = useRef<RadioHandle | null>(null);
  const chatRef = useRef<ChatTurn[]>([]);
  chatRef.current = chat;
  const [dontShowFirst, setDontShowFirst] = useState(false);
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
    setShots(readShots());
    try {
      const a = JSON.parse(localStorage.getItem(AGENT_STORAGE) ?? "{}") as { model?: AgentModel; voice?: boolean };
      if (a.model === "std" || a.model === "mini") setAgentModel(a.model);
      if (typeof a.voice === "boolean") setAgentVoice(a.voice);
    } catch {
      /* private mode */
    }
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(FIRST_VIEW_STORAGE) === "1";
    } catch {
      /* private mode */
    }
    if (!dismissed && !h.view) setFirstView(true);
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
            cockpit: setCockpit,
            hover: setHover,
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
      setCockpit(null);
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
    if (ready) engineRef.current?.setCelestial(celestial);
  }, [ready, celestial]);

  useEffect(() => {
    if (ready) engineRef.current?.setAllocation(allocation);
  }, [ready, allocation]);

  useEffect(() => {
    if (ready) engineRef.current?.setLabelFade(labelFade);
  }, [ready, labelFade]);

  useEffect(() => {
    if (ready) engineRef.current?.setModelMode(modelMode);
  }, [ready, modelMode]);

  useEffect(() => {
    try {
      localStorage.setItem(AGENT_STORAGE, JSON.stringify({ model: agentModel, voice: agentVoice }));
    } catch {
      /* private mode */
    }
    if (!agentVoice) window.speechSynthesis?.cancel();
  }, [agentModel, agentVoice]);

  // CONTEXT: nearby contacts and space missions, refreshed while the card is open.
  useEffect(() => {
    if (!ready || !contextOpen || hud === "clean") return;
    const pull = () => {
      const e = engineRef.current;
      if (!e) return;
      const near = e.nearbyContacts();
      const ais = near.filter((c) => c.layer === "vessels").length;
      setContactCounts({ flt: near.length - ais, ais });
      setContacts(near.slice(0, 60));
      // Upcoming launches soonest first, then the most recent ones.
      const now = Date.now();
      const all = e.listPois("launches");
      const upcoming = all.filter((m) => (m.when ?? 0) > now).sort((a, b) => (a.when ?? 0) - (b.when ?? 0));
      const past = all.filter((m) => (m.when ?? 0) <= now).sort((a, b) => (b.when ?? 0) - (a.when ?? 0));
      setMissions([...upcoming, ...past]);
    };
    pull();
    const t = setInterval(pull, 2000);
    return () => clearInterval(t);
  }, [ready, contextOpen, hud, layers.launches, status.launches?.count]);

  // A new camera starts a fresh snapshot; leaving CCTV closes the big viewer.
  const camKey = selection?.layer === "cctv" ? selection.key : null;
  useEffect(() => {
    setCamSnapshot("loading");
    setCamGap(null);
    lastFrame.current = 0;
    if (!camKey) {
      setCamExpanded(false);
      setAutoHop(false);
    }
  }, [camKey]);

  // AUTO HOP: walk the nearest cameras one by one.
  useEffect(() => {
    if (!autoHop || !camKey) return;
    const t = setTimeout(() => engineRef.current?.cycleCamera(1, videoOnly), videoOnly ? 15_000 : 9000);
    return () => clearTimeout(t);
  }, [autoHop, camKey, videoOnly]);

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

  const enterCockpit = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (!e.enterCockpit()) {
      // No aircraft selected: take the nearest one.
      const nearest = e.nearbyContacts().find((c) => c.layer !== "vessels");
      if (!nearest) {
        flash("NO AIRCRAFT NEARBY — TURN ON LIVE FLIGHTS OR ZOOM IN");
        return;
      }
      e.cycleContact(1);
      if (!e.enterCockpit()) flash("COCKPIT NEEDS AN AIRCRAFT");
    }
    setScopeOn(false);
  }, [flash]);

  const captureShot = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    setShots((prev) => {
      const next = [
        ...prev,
        {
          id: `${Date.now()}`,
          name: `Shot ${prev.length + 1}`,
          view: e.getView(),
          style,
          layers: LAYERS.filter((l) => layers[l.id]).map((l) => l.id),
        },
      ];
      writeShots(next);
      return next;
    });
    flash("SHOT CAPTURED");
  }, [flash, layers, style]);

  const loadShot = useCallback((shot: Shot, duration = 3) => {
    setStyle(shot.style);
    setLayers(Object.fromEntries(LAYERS.map((l) => [l.id, shot.layers.includes(l.id)])) as LayerMap);
    engineRef.current?.flyToView(shot.view, duration);
  }, []);

  const deleteShot = useCallback((id: string) => {
    setShots((prev) => {
      const next = prev.filter((x) => x.id !== id);
      writeShots(next);
      return next;
    });
  }, []);

  // START: fly shot to shot, holding a beat on each.
  useEffect(() => {
    if (playing === null) return;
    const shot = shots[playing];
    if (!shot) {
      setPlaying(null);
      flash("SEQUENCE COMPLETE");
      return;
    }
    loadShot(shot, playing === 0 ? 2 : 4);
    const t = setTimeout(() => setPlaying((i) => (i === null ? null : i + 1)), (playing === 0 ? 2 : 4) * 1000 + 2500);
    return () => clearTimeout(t);
  }, [playing, shots, loadShot, flash]);

  const exportShots = () => {
    const blob = new Blob([JSON.stringify(shots, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gods-eye-scenes.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importShots = (file: File) => {
    void file.text().then((text) => {
      try {
        const incoming = JSON.parse(text) as Shot[];
        if (!Array.isArray(incoming) || !incoming.every((x) => x?.view && typeof x.view.lat === "number")) throw new Error();
        setShots((prev) => {
          const next = [...prev, ...incoming.map((x, i) => ({ ...x, id: `${Date.now()}-${i}` }))];
          writeShots(next);
          return next;
        });
        flash(`IMPORTED ${incoming.length} SHOTS`);
      } catch {
        flash("THAT FILE ISN'T A SCENES EXPORT");
      }
    });
  };

  const chooseFirstView = (choice: "contacts" | "space" | "environment" | "manual") => {
    if (dontShowFirst) {
      try {
        localStorage.setItem(FIRST_VIEW_STORAGE, "1");
      } catch {
        /* private mode */
      }
    }
    setFirstView(false);
    const e = engineRef.current;
    if (choice === "contacts") {
      setLayers((p) => ({ ...p, flights: true, military: true }));
      e?.flyTo(-84.4277, 33.6407, 60_000, 30, -35);
      setContextTab("contacts");
      setContextOpen(true);
      flash("LIVE CONTACTS · ATLANTA HARTSFIELD-JACKSON");
    } else if (choice === "space") {
      setLayers((p) => ({ ...p, satellites: true, launches: true }));
      e?.resetGlobe();
      setContextTab("missions");
      setContextOpen(true);
      flash("SPACE MISSIONS");
    } else if (choice === "environment") {
      setLayers((p) => ({ ...p, quakes: true, fires: true, dams: true }));
      e?.resetGlobe();
      flash("ENVIRONMENTAL");
    }
  };

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

  const applyAgentActions = useCallback(
    async (actions: AgentAction[]) => {
      let flying = 0;
      const settle = async () => {
        const wait = flying - Date.now();
        if (wait > 0) await sleep(wait);
      };
      for (const a of actions) {
        const engine = engineRef.current;
        if (!engine) return;
        switch (a.type) {
          case "fly":
            engine.flyTo(a.lon, a.lat, a.range, a.heading, a.pitch);
            flying = Date.now() + 3300;
            break;
          case "layers":
            setLayers((p) => ({ ...p, ...a.set }));
            break;
          case "style":
            if (STYLES.some((x) => x.id === a.style)) setStyle(a.style as StyleId);
            break;
          case "hud":
            setHud(a.mode);
            break;
          case "detect":
            setDetect(a.mode);
            break;
          case "track": {
            await settle();
            const q = a.query.toUpperCase();
            const satLike = ["ISS", "CSS", "HST"].includes(q) || /STARLINK|NOAA|GPS|COSMOS|ISS|HUBBLE|TIANGONG/.test(q);
            if (satLike) setLayers((p) => ({ ...p, satellites: true }));
            engine.trackByName(/HUBBLE/.test(q) ? "HST" : /TIANGONG/.test(q) ? "CSS" : /SPACE STATION/.test(q) ? "ISS" : q);
            break;
          }
          case "untrack":
            engine.untrack();
            break;
          case "cockpit":
            if (a.on) {
              setLayers((p) => ({ ...p, flights: true }));
              await settle();
              enterCockpit();
            } else engine.exitCockpit();
            break;
          case "reset":
            engine.resetGlobe();
            flying = Date.now() + 2600;
            break;
          case "celestial":
            setCelestial(a.on);
            break;
          case "mark":
            engine.addMark(a.label, a.lon, a.lat);
            break;
          case "orbit":
            await settle();
            if (a.on) engine.startOrbit(a.lon, a.lat, a.range);
            else engine.stopOrbit();
            break;
          case "route":
            engine.drawRoute(a.coords, a.label);
            flying = Date.now() + 2800;
            break;
          case "flyRoute":
            await settle();
            if (!engine.flyRoute()) flash("NO ROUTE TO FLY");
            break;
          case "clear":
            engine.clearAnnotations();
            break;
          case "radio": {
            const r = radioRef.current;
            if (!r) break;
            if (a.action === "play") {
              setRadioOpen(true);
              await r.play(a.kind);
            } else if (a.action === "next") r.step(1);
            else if (a.action === "prev") r.step(-1);
            else if (a.action === "pause") r.pause();
            else if (a.action === "resume") r.resume();
            else r.stop();
            break;
          }
        }
      }
    },
    [enterCockpit, flash],
  );

  /** One agent turn; returns false when the agent isn't reachable so the local parser can take over. */
  const askAgent = useCallback(
    async (text: string): Promise<boolean> => {
      const engine = engineRef.current;
      if (!engine) return false;
      const history: ChatTurn[] = [...chatRef.current, { role: "user", content: text }];
      setChat(history);
      setChatOpen(true);
      setAgentBusy(true);
      try {
        const sel = selection;
        const res = await fetch("/api/gods-eye/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: agentModel,
            history,
            context: {
              view: engine.getView(),
              center: engine.getCenter(),
              selection: sel ? { layer: sel.layer, title: sel.title, subtitle: sel.subtitle, fields: sel.fields } : null,
              layers: LAYERS.filter((l) => layers[l.id]).map((l) => l.id),
              style,
              hud,
              cockpit: cockpit?.callsign ?? null,
              nearby: engine.nearbyContacts().slice(0, 15).map((c) => `${c.label} ${c.sub} ${Math.round(c.rangeKm)} km`),
              radio: radioRef.current?.nowPlaying() ?? null,
              marks: engine.listMarks(),
              hasRoute: engine.hasRoute(),
            },
          }),
        });
        const body = (await res.json()) as { reply?: string; actions?: AgentAction[]; error?: string };
        if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
        const reply = body.reply ?? "Done.";
        setChat([...history, { role: "assistant", content: reply }]);
        if (agentVoice) speak(reply);
        await applyAgentActions(body.actions ?? []);
        return true;
      } catch (err) {
        setChat(history.slice(0, -1));
        flash(`AGENT OFFLINE (${err instanceof Error ? err.message : "error"}) — USING LOCAL COMMANDS`.toUpperCase().slice(0, 140));
        return false;
      } finally {
        setAgentBusy(false);
      }
    },
    [agentModel, agentVoice, applyAgentActions, cockpit, flash, hud, layers, selection, style],
  );

  const runCommand = useCallback(
    async (text: string) => {
      if (await askAgent(text)) return;
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
          case "cockpit":
            if (c.on) enterCockpit();
            else engine?.exitCockpit();
            break;
          case "celestial":
            setCelestial(c.on);
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
    [flash, flyToPlace, flyToPreset, searchPlaces, enterCockpit, askAgent],
  );

  const startListening = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) {
      flash("VOICE NEEDS CHROME, EDGE OR SAFARI — TYPE A COMMAND INSTEAD");
      return;
    }
    if (recognitionRef.current) return;
    window.speechSynthesis?.cancel();
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
  const camExpandedRef = useRef(false);
  camExpandedRef.current = camExpanded;
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
        if (camExpandedRef.current) {
          setCamExpanded(false);
          return;
        }
        if (engineRef.current?.inCockpit()) {
          engineRef.current.exitCockpit();
          return;
        }
        engineRef.current?.clearSelection();
        setLocOpen(false);
        setPowerOpen(false);
        setFirstView(false);
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
      {scopeOn && hud !== "clean" && !cockpit && (
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
      {hud !== "clean" && !cockpit && (
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
          <header className={styles.topLeft} hidden={!!cockpit}>
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
              {leftOpen && (
                <div className={styles.card}>
                  <button className={styles.cardHeadBtn} onClick={() => setScenesOpen((o) => !o)} aria-expanded={scenesOpen}>
                    SCENES <span>{shots.length ? `${shots.length} SHOTS` : ""} {scenesOpen ? "▾" : "▸"}</span>
                  </button>
                  {scenesOpen && (
                    <>
                      <div className={styles.row}>
                        <button className={`${styles.btn} ${styles.btnHot}`} onClick={captureShot}>
                          + CAPTURE SHOT
                        </button>
                        {playing === null ? (
                          <button className={styles.btn} disabled={!shots.length} onClick={() => setPlaying(0)}>
                            ▶ START
                          </button>
                        ) : (
                          <button className={styles.btn} onClick={() => setPlaying(null)}>
                            ■ STOP
                          </button>
                        )}
                      </div>
                      {shots.length > 0 ? (
                        <ul className={styles.shotList}>
                          {shots.map((shot, i) => (
                            <li key={shot.id} data-on={playing === i}>
                              <input
                                className={styles.shotName}
                                value={shot.name}
                                aria-label="Shot name"
                                onChange={(e) =>
                                  setShots((prev) => {
                                    const next = prev.map((x) => (x.id === shot.id ? { ...x, name: e.target.value } : x));
                                    writeShots(next);
                                    return next;
                                  })
                                }
                              />
                              <button onClick={() => loadShot(shot)}>LOAD</button>
                              <button onClick={() => deleteShot(shot.id)}>DEL</button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className={styles.hint}>Frame a view, then capture it. START flies the shots in order.</div>
                      )}
                      <div className={styles.row}>
                        <button className={styles.btn} disabled={!shots.length} onClick={exportShots}>
                          EXPORT
                        </button>
                        <label className={styles.btn}>
                          IMPORT
                          <input
                            type="file"
                            accept="application/json"
                            hidden
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) importShots(f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </>
                  )}
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
      {hud !== "clean" && !cockpit && (
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
                    <button
                      className={styles.cctv}
                      onClick={() => setCamExpanded(true)}
                      title="Click to enlarge"
                      aria-label={`Enlarge ${selection.title}`}
                    >
                      {camExpanded ? (
                        <span className={styles.cctvElsewhere}>VIEWING ENLARGED</span>
                      ) : (
                        <LiveCam
                          image={selection.image}
                          video={selection.video}
                          hls={selection.hls}
                          alt={selection.title}
                          onState={(st, m) => {
                            setCamSnapshot(st);
                            setCamMode(m);
                          }}
                          onFrame={onCamFrame}
                        />
                      )}
                      <span className={styles.cctvTag}>
                        <span className={styles.recDot} data-still={camMode === "still"} />{" "}
                        {camMode === "video" ? "LIVE VIDEO" : camMode === "clip" ? "LIVE CLIP" : "STILL"} · {selection.key}
                      </span>
                      <span className={styles.cctvExpand}>⤢ ENLARGE</span>
                    </button>
                  )}
                  {selection.layer === "cctv" && (
                    <>
                      <div className={styles.cctvStatus}>
                        <span data-state={camSnapshot}>
                          {camMode === "video" ? "STREAM" : "SNAPSHOT"}: {camSnapshot === "ok" ? "OK" : camSnapshot === "err" ? "NO SIGNAL" : "…"}
                        </span>
                        <span>
                          {camMode === "video"
                            ? "LIVE HLS VIDEO"
                            : camMode === "clip"
                              ? "TFL CLIP"
                              : camGap
                                ? `THIS AGENCY PUBLISHES ~${camGap >= 1000 ? `${(camGap / 1000).toFixed(camGap < 10_000 ? 1 : 0)} S` : "1 S"} · POLL 1 S`
                                : "POLL 1 S · AGENCY SETS THE RATE"}
                        </span>
                      </div>
                      <div className={styles.row}>
                        <button
                          className={styles.btn}
                          onClick={() => engineRef.current?.cycleCamera(-1, videoOnly) ?? flash("NO OTHER CAMERA NEARBY")}
                        >
                          ‹ PREV
                        </button>
                        <button
                          className={styles.btn}
                          onClick={() => engineRef.current?.cycleCamera(1, videoOnly) ?? flash("NO OTHER CAMERA NEARBY")}
                        >
                          NEXT ›
                        </button>
                        <button className={`${styles.btn} ${autoHop ? styles.btnHot : ""}`} onClick={() => setAutoHop((v) => !v)}>
                          {autoHop ? "■ AUTO HOP" : "▶ AUTO HOP"}
                        </button>
                      </div>
                      <div className={styles.row}>
                        <button
                          className={`${styles.btn} ${videoOnly ? styles.btnHot : ""}`}
                          onClick={() => setVideoOnly((v) => !v)}
                          title="PREV / NEXT / AUTO HOP only visit cameras that stream real video"
                        >
                          {videoOnly ? "◉" : "○"} VIDEO ONLY
                        </button>
                        <button
                          className={styles.btn}
                          onClick={() => {
                            flash("FINDING A LIVE STREAM…");
                            void engineRef.current?.nearestVideoCamera().then((found) =>
                              flash(found ? `LIVE VIDEO › ${found.toUpperCase()}` : "NO STREAMING CAMERA ANSWERED — TRY ANOTHER REGION"),
                            );
                          }}
                        >
                          ⤓ NEAREST LIVE VIDEO
                        </button>
                      </div>
                    </>
                  )}
                  {selection.layer !== "cctv" && selection.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={styles.ctxImage} src={selection.image} alt="" />
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
                    {(selection.layer === "flights" || selection.layer === "military") && (
                      <button className={`${styles.btn} ${styles.btnCockpit}`} onClick={enterCockpit}>
                        ✈ COCKPIT
                      </button>
                    )}
                    {selection.link && (
                      <a className={styles.btn} href={selection.link.href} target="_blank" rel="noreferrer">
                        {selection.link.label} ↗
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.card}>
                <button className={styles.cardHeadBtn} onClick={() => setContextOpen((o) => !o)} aria-expanded={contextOpen}>
                  CONTEXT <span>{contextOpen ? "▾" : "▸"}</span>
                </button>
                {contextOpen && (
                  <>
                    <div className={styles.seg}>
                      <button data-on={contextTab === "contacts"} onClick={() => setContextTab("contacts")}>
                        CONTACTS
                      </button>
                      <button data-on={contextTab === "missions"} onClick={() => setContextTab("missions")}>
                        SPACE MISSIONS
                      </button>
                    </div>
                    {contextTab === "contacts" ? (
                      <>
                        <div className={styles.ctxWindow}>
                          250 KM AIR/SEA WINDOW · FLT {contactCounts.flt} · AIS {contactCounts.ais}
                        </div>
                        <div className={styles.row}>
                          <button className={styles.btn} onClick={() => engineRef.current?.cycleContact(-1)} disabled={!contacts.length}>
                            ‹ PREVIOUS
                          </button>
                          <button className={styles.btn} onClick={() => engineRef.current?.focusSelection()} disabled={!selection}>
                            FOCUS
                          </button>
                          <button className={styles.btn} onClick={() => engineRef.current?.cycleContact(1)} disabled={!contacts.length}>
                            NEXT ›
                          </button>
                        </div>
                        <button className={`${styles.btn} ${styles.btnCockpit} ${styles.btnWide}`} onClick={enterCockpit}>
                          ✈ COCKPIT
                        </button>
                        {contacts.length ? (
                          <ul className={styles.contactList}>
                            {contacts.map((c) => (
                              <li key={`${c.layer}:${c.key}`}>
                                <button
                                  data-on={selection?.key === c.key}
                                  data-layer={c.layer}
                                  onClick={() => {
                                    const e = engineRef.current;
                                    if (!e) return;
                                    e.select({ layer: c.layer, key: c.key });
                                    if (c.layer === "vessels") e.focusSelection();
                                    else e.track();
                                  }}
                                >
                                  <b>{c.label}</b>
                                  <span>{c.sub}</span>
                                  <em>
                                    {c.rangeKm < 10 ? c.rangeKm.toFixed(1) : Math.round(c.rangeKm)} KM · {compassLabel(c.bearing)}
                                  </em>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className={styles.hint}>
                            No aircraft or ships within 250 km of the view centre. Zoom into a city with Live Flights on.
                          </div>
                        )}
                      </>
                    ) : !layers.launches ? (
                      <button className={`${styles.btn} ${styles.btnWide}`} onClick={() => setLayers((p) => ({ ...p, launches: true }))}>
                        TURN ON SPACE MISSIONS
                      </button>
                    ) : missions.length ? (
                      <ul className={styles.contactList}>
                        {missions.map((m) => {
                          const upcoming = (m.when ?? 0) > Date.now();
                          return (
                            <li key={m.id}>
                              <button data-on={selection?.key === m.id} onClick={() => engineRef.current?.selectPoi("launches", m.id)}>
                                <b>{m.name}</b>
                                <span>{m.sub}</span>
                                <em data-upcoming={upcoming}>
                                  {m.when ? new Date(m.when).toISOString().slice(0, 10) : "—"} {upcoming ? "· T-" : ""}
                                  {upcoming && m.when ? `${Math.ceil((m.when - Date.now()) / 86_400_000)}D` : ""}
                                </em>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className={styles.hint}>{status.launches?.state === "error" ? status.launches.note : "Loading missions…"}</div>
                    )}
                  </>
                )}
              </div>

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
                {detect !== "off" && (
                  <>
                    <div className={styles.label}>ALLOCATION</div>
                    <div className={styles.seg}>
                      <button data-on={allocation === "elastic"} onClick={() => setAllocation("elastic")} title="Labels go to the nearest contacts, whatever they are">
                        ELASTIC
                      </button>
                      <button data-on={allocation === "weighted"} onClick={() => setAllocation("weighted")} title="Each kind of contact gets a fair share of labels">
                        WEIGHTED
                      </button>
                    </div>
                    <label className={styles.slider}>
                      <span>FADE</span>
                      <input type="range" min={0} max={100} value={labelFade} onChange={(e) => setLabelFade(Number(e.target.value))} />
                      <b>{labelFade}%</b>
                    </label>
                  </>
                )}
                <div className={styles.label}>3D AIRCRAFT</div>
                <div className={styles.seg}>
                  {(["off", "proximity", "all"] as ModelMode[]).map((m) => (
                    <button key={m} data-on={modelMode === m} onClick={() => setModelMode(m)}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
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
                  <button data-on={celestial} onClick={() => setCelestial((v) => !v)}>
                    <span className={styles.switch} /> CELESTIAL · SUN, MOON, STARS
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
            <button
              className={styles.pill}
              data-on={radioOpen}
              onClick={() => {
                setRadioOpen((o) => !o);
                setLocOpen(false);
              }}
            >
              {radioOn ? <span className={styles.recDot} /> : "📻"} RADIO
            </button>
            <RadioDeck
              ref={radioRef}
              open={radioOpen}
              onClose={() => setRadioOpen(false)}
              center={() => engineRef.current?.getCenter() ?? null}
              onNowPlaying={setRadioOn}
              onFlyTo={(lon, lat) => engineRef.current?.flyTo(lon, lat, 60_000, 0, -50)}
              flash={flash}
            />
          </div>
          <div className={styles.popWrap}>
            <button
              className={styles.pill}
              data-on={locOpen}
              onClick={() => {
                setLocOpen((o) => !o);
                setRadioOpen(false);
              }}
            >
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
          data-busy={agentBusy}
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
          <span className={styles.voiceLabel}>
            {agentBusy ? "AGENT THINKING…" : listening ? "LISTENING" : "VOICE AGENT · HOLD SPACE"}
            <span className={styles.agentToggles}>
              {(["std", "mini"] as AgentModel[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  data-on={agentModel === m}
                  onClick={() => setAgentModel(m)}
                  title={m === "std" ? "Claude Sonnet 5 — smarter" : "Claude Haiku 4.5 — faster"}
                >
                  {m.toUpperCase()}
                </button>
              ))}
              <button type="button" data-on={agentVoice} onClick={() => setAgentVoice((v) => !v)} title="Speak replies aloud">
                {agentVoice ? "🔊" : "🔇"}
              </button>
            </span>
          </span>
          {chatOpen && (chat.length > 0 || agentBusy) && (
            <div className={styles.chat}>
              <div className={styles.chatHead}>
                AGENT
                <span>
                  <button type="button" onClick={() => setChat([])} title="Start a new conversation">
                    NEW
                  </button>
                  <button type="button" onClick={() => setChatOpen(false)} aria-label="Hide transcript">
                    ×
                  </button>
                </span>
              </div>
              <ul>
                {chat.slice(-6).map((t, i) => (
                  <li key={`${chat.length}-${i}`} data-role={t.role}>
                    {t.content}
                  </li>
                ))}
                {agentBusy && <li data-role="assistant" className={styles.chatBusy}>···</li>}
              </ul>
            </div>
          )}
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

      {hover && !camExpanded && !cockpit && (
        <div className={styles.hoverCard} style={{ left: hover.x + 16, top: hover.y + 16 }} aria-hidden>
          {hover.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hover.image} alt="" />
          )}
          <span>{hover.title}</span>
        </div>
      )}

      {camExpanded && selection?.layer === "cctv" && selection.image && (
        <div className={styles.camViewer} role="dialog" aria-label={`Camera ${selection.title}`}>
          <div className={styles.camViewerHead}>
            <span className={styles.recDot} />
            <div>
              <b className={display.className}>{selection.title}</b>
              <span>{selection.subtitle}</span>
            </div>
            <button className={styles.redX} onClick={() => setCamExpanded(false)} aria-label="Close enlarged camera" title="Close (Esc)">
              ×
            </button>
          </div>
          <div className={styles.camViewerFrame}>
            <LiveCam
              image={selection.image}
              video={selection.video}
              hls={selection.hls}
              alt={selection.title}
              onState={(st, m) => {
                setCamSnapshot(st);
                setCamMode(m);
              }}
              onFrame={onCamFrame}
            />
            <span className={styles.cctvTag}>
              <span className={styles.recDot} data-still={camMode === "still"} />{" "}
              {camMode === "video" ? "LIVE VIDEO" : camMode === "clip" ? "LIVE CLIP" : "STILL"} · {selection.key}
            </span>
          </div>
          <div className={styles.camViewerFoot}>
            <span>{selection.fields.map(([k, v]) => `${k} ${v}`).join(" · ")}</span>
            <div className={styles.row}>
              <button className={styles.btn} onClick={() => engineRef.current?.cycleCamera(-1)}>
                ‹ PREV
              </button>
              <button className={styles.btn} onClick={() => engineRef.current?.cycleCamera(1)}>
                NEXT ›
              </button>
              <button className={`${styles.btn} ${autoHop ? styles.btnHot : ""}`} onClick={() => setAutoHop((v) => !v)}>
                {autoHop ? "■ AUTO HOP" : "▶ AUTO HOP"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cockpit && <CockpitHud info={cockpit} fontClass={display.className} engine={engineRef.current} />}

      {firstView && ready && (
        <div className={styles.modalBack}>
          <div className={`${styles.modal} ${styles.firstView}`} role="dialog" aria-label="Choose your first view">
            <div className={`${styles.modalTitle} ${display.className}`}>CHOOSE YOUR FIRST VIEW</div>
            <div className={styles.firstGrid}>
              <button onClick={() => chooseFirstView("contacts")}>
                <b>LIVE CONTACTS</b>
                <span>Every aircraft over the world&apos;s busiest airport. Pick one and ride in the cockpit.</span>
              </button>
              <button onClick={() => chooseFirstView("space")}>
                <b>SPACE MISSIONS</b>
                <span>Thousands of satellites on SGP4, plus every launch in the last and next 30 days.</span>
              </button>
              <button onClick={() => chooseFirstView("environment")}>
                <b>ENVIRONMENTAL</b>
                <span>Earthquakes, active fires and the world&apos;s major dams.</span>
              </button>
              <button onClick={() => chooseFirstView("manual")}>
                <b>EXPLORE MANUALLY</b>
                <span>Just the globe. Everything else is in DATA LAYERS.</span>
              </button>
            </div>
            <label className={styles.dontShow}>
              <input type="checkbox" checked={dontShowFirst} onChange={(e) => setDontShowFirst(e.target.checked)} /> Don&apos;t show this
              again
            </label>
          </div>
        </div>
      )}

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

function CockpitHud({ info, fontClass, engine }: { info: CockpitInfo; fontClass: string; engine: GlobeEngine | null }) {
  // Compass tape: ticks every 5° across ±60° of the nose.
  const ticks = [];
  const base = Math.floor((info.heading - 60) / 5) * 5;
  for (let d = base; d <= info.heading + 60; d += 5) {
    const x = 50 + ((d - info.heading) / 120) * 100;
    const n = ((d % 360) + 360) % 360;
    ticks.push(
      <div key={d} className={styles.tapeTick} data-major={n % 30 === 0} style={{ left: `${x}%` }}>
        {n % 30 === 0 && <span>{n % 90 === 0 ? ["N", "E", "S", "W"][n / 90] : pad3(n)}</span>}
      </div>,
    );
  }
  return (
    <div className={styles.cockpit}>
      <div className={styles.cockpitTop}>
        <div className={styles.tape}>
          {ticks}
          <div className={styles.tapeCaret}>{pad3(info.heading)}</div>
        </div>
      </div>

      <div className={styles.cockpitId}>
        <div className={styles.classif}>FIRST PERSON</div>
        <div className={`${styles.cockpitCallsign} ${fontClass}`}>{info.callsign}</div>
        <div className={styles.dim}>
          {[info.military ? "MILITARY" : "CIVIL", info.type].filter(Boolean).join(" · ")} · {info.lat.toFixed(4)}°, {info.lon.toFixed(4)}°
        </div>
      </div>

      {/* Horizon + pitch ladder, counter-rotated with the bank. */}
      <div className={styles.horizon} style={{ transform: `rotate(${-info.roll}deg)` }} aria-hidden>
        <div style={{ transform: `translateY(${info.pitch * 6}px)` }}>
          {[-20, -10, 10, 20].map((p) => (
            <div key={p} className={styles.ladder} style={{ top: `calc(50% - ${p * 6}px)` }}>
              <span>{Math.abs(p)}</span>
              <i />
              <span>{Math.abs(p)}</span>
            </div>
          ))}
          <div className={styles.horizonLine} />
        </div>
        <div className={styles.boresight} />
      </div>

      <div className={styles.traffic}>
        <div className={styles.cardHead}>LIVE SIGNALS OBSERVED</div>
        {info.traffic.length ? (
          <ul>
            {info.traffic.map((t) => (
              <li key={t.label + t.rangeKm}>
                <b>{t.label}</b>
                <span>
                  {t.rangeKm.toFixed(1)} KM · {t.relBearing >= 0 ? "R" : "L"}
                  {Math.abs(Math.round(t.relBearing))}° · {t.altFt.toLocaleString("en-US")} FT
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.dim}>NO TRAFFIC WITHIN 80 KM</div>
        )}
      </div>

      <div className={styles.instruments}>
        <div>
          <span>GROUND SPEED</span>
          <b className={fontClass}>{info.gsKts}</b>
          <em>KTS</em>
        </div>
        <div>
          <span>HEADING</span>
          <b className={fontClass}>{pad3(info.heading)}</b>
          <em>DEG</em>
        </div>
        <div>
          <span>ALTITUDE</span>
          <b className={fontClass}>{info.onGround ? "GND" : info.altFt.toLocaleString("en-US")}</b>
          <em>{info.onGround ? "ON GROUND" : "FT"}</em>
        </div>
        <div>
          <span>VERT SPEED</span>
          <b className={fontClass}>
            {info.vsFpm > 0 ? "+" : ""}
            {info.vsFpm.toLocaleString("en-US")}
          </b>
          <em>FPM</em>
        </div>
      </div>

      <div className={styles.cockpitControls}>
        <button className={styles.btn} onClick={() => engine?.cycleContact(-1)}>
          ‹ PREV
        </button>
        <button className={`${styles.btn} ${styles.btnHot}`} onClick={() => engine?.exitCockpit()}>
          EXIT COCKPIT
        </button>
        <button className={styles.btn} onClick={() => engine?.cycleContact(1)}>
          NEXT ›
        </button>
      </div>
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
