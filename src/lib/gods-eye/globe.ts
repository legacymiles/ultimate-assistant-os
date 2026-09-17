// ---------------------------------------------------------------------------
// GlobeEngine — the imperative CesiumJS side of God's Eye View.
//
// React owns the HUD and the choices (style, layers, map source); this class
// owns the viewer and everything drawn on it, and reports back through
// EngineEvents. Thousands of aircraft and satellites are primitive collections
// (billboards / points), never Entities — Entities are reserved for the one
// tracked target, where Cesium's trackedEntity camera is worth the overhead.
// ---------------------------------------------------------------------------

import type {
  Billboard,
  BillboardCollection,
  Cartesian3,
  Cesium3DTileset,
  Entity,
  ImageryLayer,
  LabelCollection,
  Matrix4,
  Model,
  NearFarScalar,
  PerspectiveFrustum,
  PointPrimitive,
  PointPrimitiveCollection,
  PolylineCollection,
  PostProcessStage,
  ScreenSpaceEventHandler,
  Viewer,
} from "cesium";
import { eciToEcf, eciToGeodetic, gstime, propagate, twoline2satrec, type SatRec } from "satellite.js";
import type { CesiumModule } from "./cesium";
import { styleById, type StyleId } from "./shaders";
import {
  deadReckon,
  rangeBearing,
  densifyLine,
  estimateGsd,
  formatAgo,
  formatLat,
  formatLon,
  niirsFromGsd,
  sunPosition,
  toDeg,
  toRad,
} from "./geo";
import type {
  AircraftRow,
  Cable,
  CablesFeed,
  Camera,
  CamerasFeed,
  FlightsFeed,
  Poi,
  PoiFeed,
  Quake,
  QuakesFeed,
  SatellitesFeed,
} from "./types";

export type PoiLayerId = "launches" | "fires" | "vessels" | "datacenters" | "dams";
export type LayerId = "flights" | "military" | "satellites" | "quakes" | "cctv" | "cables" | "traffic" | PoiLayerId;
const POI_LAYERS: PoiLayerId[] = ["launches", "fires", "vessels", "datacenters", "dams"];
const isPoiLayer = (id: LayerId): id is PoiLayerId => (POI_LAYERS as LayerId[]).includes(id);
export type MapSource = "esri" | "osm" | "google3d";
export type LayerState = "off" | "loading" | "live" | "stale" | "error";

export interface LayerStatus {
  state: LayerState;
  count: number;
  note?: string;
}

export interface Selection {
  layer: LayerId;
  key: string;
  title: string;
  subtitle: string;
  fields: [string, string][];
  image?: string;
  video?: string;
  hls?: string;
  link?: { href: string; label: string };
}

export interface Readout {
  lat: number;
  lon: number;
  altM: number;
  heading: number;
  pitch: number;
  gsd: number;
  niirs: number;
  sunEl: number;
  sunAz: number;
}

export interface CameraView {
  lon: number;
  lat: number;
  alt: number;
  heading: number;
  pitch: number;
}

export type DetectMode = "off" | "sparse" | "dense";
export type Allocation = "elastic" | "weighted";
export type ModelMode = "off" | "proximity" | "all";

/** Cesium's sample aircraft (Apache-2.0), served from the pinned Cesium release on jsDelivr. */
const AIRCRAFT_MODEL_URL = "https://cdn.jsdelivr.net/gh/CesiumGS/cesium@1.145/Apps/SampleData/models/CesiumAir/Cesium_Air.glb";

/** A nearby moving contact, for the CONTEXT › CONTACTS list. */
export interface NearbyContact {
  layer: "flights" | "military" | "vessels";
  key: string;
  label: string;
  sub: string;
  rangeKm: number;
  /** Bearing from the view centre, degrees. */
  bearing: number;
}

/** What the cockpit HUD shows, emitted a few times a second while in first person. */
export interface CockpitInfo {
  key: string;
  callsign: string;
  type: string;
  military: boolean;
  gsKts: number;
  heading: number;
  pitch: number;
  roll: number;
  altFt: number;
  vsFpm: number;
  onGround: boolean;
  lat: number;
  lon: number;
  traffic: { label: string; rangeKm: number; relBearing: number; altFt: number }[];
}

export interface HoverInfo {
  x: number;
  y: number;
  title: string;
  image?: string;
}

export interface EngineEvents {
  select(selection: Selection | null): void;
  tracking(on: boolean): void;
  readout(readout: Readout): void;
  layer(id: LayerId, status: LayerStatus): void;
  message(text: string): void;
  cockpit?(info: CockpitInfo | null): void;
  hover?(info: HoverInfo | null): void;
}

export interface EngineKeys {
  googleKey?: string;
  ionToken?: string;
}

export const LAYERS: { id: LayerId; label: string; source: string; color: string }[] = [
  { id: "flights", label: "Live Flights", source: "OpenSky · adsb.lol", color: "#e8f4ff" },
  { id: "military", label: "Military Flights", source: "adsb.lol", color: "#ffb020" },
  { id: "satellites", label: "Satellites", source: "CelesTrak · SGP4", color: "#00f0ff" },
  { id: "quakes", label: "Earthquakes (24h)", source: "USGS", color: "#ff4d4d" },
  { id: "cctv", label: "CCTV · Traffic Cams", source: "Open-data DOTs · Windy", color: "#39ff88" },
  { id: "cables", label: "Submarine Cables", source: "TeleGeography", color: "#00e5ff" },
  { id: "launches", label: "Space Missions (±30d)", source: "Launch Library", color: "#c78bff" },
  { id: "vessels", label: "Vessels (AIS)", source: "AISStream · key", color: "#4dd2ff" },
  { id: "traffic", label: "Street Traffic", source: "TomTom · key", color: "#ff6b3d" },
  { id: "fires", label: "FIRMS Active Fires", source: "NASA FIRMS · key", color: "#ff7a1a" },
  { id: "datacenters", label: "Datacenters", source: "OpenStreetMap", color: "#9dff5c" },
  { id: "dams", label: "Dams", source: "Wikidata", color: "#5ca8ff" },
];

const POLL_MS: Record<LayerId, number> = {
  flights: 30_000,
  military: 20_000,
  satellites: 3 * 60 * 60_000,
  quakes: 120_000,
  // Camera lists are cached for hours upstream; the stills themselves refresh in the context card.
  cctv: 30 * 60_000,
  cables: 0,
  launches: 60 * 60_000,
  vessels: 60_000,
  traffic: 0,
  fires: 30 * 60_000,
  datacenters: 0,
  dams: 0,
};

const POI_STYLE: Record<PoiLayerId, { color: string; label: string }> = {
  launches: { color: "#c78bff", label: "LAUNCH" },
  vessels: { color: "#4dd2ff", label: "AIS" },
  fires: { color: "#ff7a1a", label: "FIRE" },
  datacenters: { color: "#9dff5c", label: "DC" },
  dams: { color: "#5ca8ff", label: "DAM" },
};

interface PoiLayer {
  coll: BillboardCollection;
  items: Map<string, Poi>;
  positions: Map<string, Cartesian3>;
  note: string;
}

const FT_PER_M = 3.28084;
const KT_PER_MS = 1.943844;

interface Contact {
  key: string;
  layer: "flights" | "military";
  row: AircraftRow;
  /** Client time the row arrived; dead reckoning runs from here. */
  at: number;
  bb: Billboard;
}

interface SatRecord {
  key: string;
  name: string;
  rec: SatRec;
  kind: "station" | "starlink" | "other";
  point: PointPrimitive;
}

type PickId = { layer: LayerId; key: string };

function isPickId(v: unknown): v is PickId {
  return !!v && typeof v === "object" && "layer" in v && "key" in v;
}

// ----- Icons (canvas → data URL, so the billboard atlas dedupes them) --------

function planeIcon(fill: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.translate(32, 32);
  g.fillStyle = fill;
  g.strokeStyle = "rgba(0,0,0,0.7)";
  g.lineWidth = 2.5;
  g.beginPath();
  const pts = [
    [0, -29], [4, -19], [4, -7], [27, 6], [27, 11], [4, 5], [3, 19], [10, 25], [10, 28], [0, 25],
    [-10, 28], [-10, 25], [-3, 19], [-4, 5], [-27, 11], [-27, 6], [-4, -7], [-4, -19],
  ];
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.stroke();
  g.fill();
  return c.toDataURL();
}

function cameraIcon(stroke: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  g.strokeStyle = stroke;
  g.fillStyle = "rgba(0,20,10,0.75)";
  g.lineWidth = 3;
  g.beginPath();
  g.rect(6, 15, 24, 18);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(30, 20);
  g.lineTo(42, 13);
  g.lineTo(42, 35);
  g.lineTo(30, 28);
  g.closePath();
  g.fill();
  g.stroke();
  return c.toDataURL();
}

function poiIcon(kind: PoiLayerId, color: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  g.translate(24, 24);
  g.lineWidth = 3;
  g.strokeStyle = color;
  g.fillStyle = "rgba(2,10,20,0.8)";
  g.beginPath();
  if (kind === "vessels") {
    // A hull pointing up; billboards rotate it to the ship's heading.
    g.moveTo(0, -20);
    g.lineTo(10, -4);
    g.lineTo(9, 18);
    g.lineTo(-9, 18);
    g.lineTo(-10, -4);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.strokeStyle = "rgba(0,0,0,0.7)";
    g.stroke();
    return c.toDataURL();
  }
  if (kind === "fires") {
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 22);
    grad.addColorStop(0, "rgba(255,255,210,1)");
    grad.addColorStop(0.3, color);
    grad.addColorStop(1, "rgba(255,60,0,0)");
    g.fillStyle = grad;
    g.arc(0, 0, 22, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL();
  }
  if (kind === "launches") {
    g.moveTo(0, -20);
    g.quadraticCurveTo(9, -8, 8, 10);
    g.lineTo(14, 20);
    g.lineTo(-14, 20);
    g.lineTo(-8, 10);
    g.quadraticCurveTo(-9, -8, 0, -20);
  } else if (kind === "datacenters") {
    g.rect(-14, -17, 28, 34);
    g.moveTo(-14, -6);
    g.lineTo(14, -6);
    g.moveTo(-14, 5);
    g.lineTo(14, 5);
  } else {
    // dams: a wall with water behind it
    g.moveTo(-18, -12);
    g.lineTo(18, -12);
    g.lineTo(12, 16);
    g.lineTo(-12, 16);
    g.closePath();
  }
  g.fill();
  g.stroke();
  return c.toDataURL();
}

const angleDiff = (from: number, to: number) => ((to - from + 540) % 360) - 180;

// -----------------------------------------------------------------------------

export class GlobeEngine {
  readonly viewer: Viewer;
  private readonly C: CesiumModule;
  private readonly ev: EngineEvents;
  private readonly keys: EngineKeys;
  private readonly detectCanvas: HTMLCanvasElement;
  private readonly handler: ScreenSpaceEventHandler;
  private readonly t0 = performance.now();
  private destroyed = false;
  private readonly cleanups: (() => void)[] = [];

  private readonly layersOn = new Set<LayerId>();
  private readonly timers = new Map<LayerId, number>();
  private readonly aborts = new Map<LayerId, AbortController>();
  private readonly statuses = new Map<LayerId, LayerStatus>();

  private readonly icons: { plane: string; ground: string; mil: string; cam: string; camVideo: string };
  private readonly nearFar: NearFarScalar;
  private readonly flightBB: BillboardCollection;
  private readonly milBB: BillboardCollection;
  private readonly contacts = new Map<string, Contact>();
  private flightSource = "";

  private readonly satPoints: PointPrimitiveCollection;
  private readonly satLabels: LabelCollection;
  private readonly orbitLines: PolylineCollection;
  private sats: SatRecord[] = [];
  private readonly satIndex = new Map<string, SatRecord>();
  private lastSatPropagate = 0;
  private pendingTrack: string | null = null;

  private readonly quakePoints: PointPrimitiveCollection;
  private readonly quakeRings: PointPrimitiveCollection;
  private readonly quakeLabels: LabelCollection;
  private quakes: Quake[] = [];

  private readonly camBB: BillboardCollection;
  private readonly cameras = new Map<string, Camera>();
  private readonly camPositions = new Map<string, Cartesian3>();
  /** lat,lon cells already drawn: a city and its state DOT often republish the same camera. */
  private readonly camCoords = new Set<string>();
  private camAbort: AbortController | null = null;
  private cameraProvider = "";
  private camNetworksNote = "";
  private windyEnabled = false;
  private readonly windyBB = new Map<string, Billboard>();
  private windyCell = "";
  private windyAbort: AbortController | null = null;

  private readonly cableLines: PolylineCollection;
  private cables: Cable[] = [];

  private readonly pois = new Map<PoiLayerId, PoiLayer>();
  private readonly poiIcons = new Map<PoiLayerId, string>();
  private vesselCell = "";
  private trafficLayer: ImageryLayer | null = null;

  private cockpit: { key: string; heading: number; pitch: number; roll: number; offset: Cartesian3; at: number; last: Cartesian3 | null } | null = null;
  private lastCockpitEmit = 0;
  private savedFovy = 0;

  private allocation: Allocation = "elastic";
  private labelFade = 0;
  private modelMode: ModelMode = "off";
  private readonly models = new Map<string, Model | "loading">();
  private lastModelPick = 0;

  private readonly marks: { label: string; entity: Entity }[] = [];
  private routeEntity: Entity | null = null;
  private routeCoords: [number, number][] = [];
  private orbitCenter: Cartesian3 | null = null;
  private routeFlight: { points: Cartesian3[]; seg: number; t: number; heading: number } | null = null;
  private lightingOn = false;
  private celestialOn = false;
  private hop: { list: string[]; videoOnly: boolean } | null = null;

  private style: StyleId = "normal";
  private readonly styleStages = new Map<StyleId, PostProcessStage>();
  private styleIntensity = 1;
  private styleFadeStart = 0;
  private readonly styleParams: Record<string, number> = {};

  private mapSource: MapSource | null = null;
  private baseLayer: ImageryLayer | null = null;
  private tileset: Cesium3DTileset | null = null;

  private selected: PickId | null = null;
  private tracked: PickId | null = null;
  private readonly followScratch: Cartesian3;
  private readonly followMatrix: Matrix4;
  private trailEntity: Entity | null = null;
  private trail: Cartesian3[] = [];
  private lastTrailSample = 0;
  private lastDescribe = 0;

  private detectMode: DetectMode = "sparse";
  private detectDensity = 60;
  private lastDetect = 0;
  private lastReadout = 0;
  private lastReckon = 0;

  private autoRotate = true;
  private lastInteraction = 0;
  private lastTick = performance.now();

  constructor(
    C: CesiumModule,
    container: HTMLElement,
    credits: HTMLElement,
    detectCanvas: HTMLCanvasElement,
    events: EngineEvents,
    keys: EngineKeys,
  ) {
    this.C = C;
    this.ev = events;
    this.keys = keys;
    this.detectCanvas = detectCanvas;
    this.followScratch = new C.Cartesian3();
    this.followMatrix = new C.Matrix4();

    if (keys.ionToken) C.Ion.defaultAccessToken = keys.ionToken;

    const viewer = new C.Viewer(container, {
      baseLayer: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: credits,
      showRenderLoopErrors: false,
      shouldAnimate: true,
    });
    this.viewer = viewer;

    const scene = viewer.scene;
    scene.backgroundColor = C.Color.BLACK;
    scene.globe.baseColor = C.Color.fromCssColorString("#050a14");
    scene.globe.showGroundAtmosphere = true;
    scene.globe.enableLighting = false;
    scene.fog.enabled = true;
    scene.postProcessStages.fxaa.enabled = true;
    scene.screenSpaceCameraController.minimumZoomDistance = 40;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    if (keys.ionToken) {
      try {
        scene.setTerrain(C.Terrain.fromWorldTerrain());
      } catch {
        /* flat ellipsoid is fine */
      }
    }

    this.icons = {
      plane: planeIcon("#eaf6ff"),
      ground: planeIcon("#7f8c99"),
      mil: planeIcon("#ffb020"),
      cam: cameraIcon("#39ff88"),
      // Cameras that stream real video are drawn cyan, so they stand out from stills.
      camVideo: cameraIcon("#00f0ff"),
    };
    this.nearFar = new C.NearFarScalar(2_000, 1.25, 1.5e7, 0.4);

    this.cableLines = scene.primitives.add(new C.PolylineCollection());
    this.quakeRings = scene.primitives.add(new C.PointPrimitiveCollection());
    this.quakePoints = scene.primitives.add(new C.PointPrimitiveCollection());
    this.quakeLabels = scene.primitives.add(new C.LabelCollection());
    this.orbitLines = scene.primitives.add(new C.PolylineCollection());
    this.satPoints = scene.primitives.add(new C.PointPrimitiveCollection());
    this.satLabels = scene.primitives.add(new C.LabelCollection());
    this.camBB = scene.primitives.add(new C.BillboardCollection());
    for (const id of POI_LAYERS) {
      this.pois.set(id, { coll: scene.primitives.add(new C.BillboardCollection()), items: new Map(), positions: new Map(), note: "" });
      this.poiIcons.set(id, poiIcon(id, POI_STYLE[id].color));
    }
    this.flightBB = scene.primitives.add(new C.BillboardCollection());
    this.milBB = scene.primitives.add(new C.BillboardCollection());

    // A shader that fails to compile shouldn't freeze the globe: drop back to NORMAL.
    scene.renderError.addEventListener((_scene, error) => {
      console.error("[gods-eye] render error", error);
      const failed = this.style;
      const stage = this.styleStages.get(failed);
      if (stage) {
        scene.postProcessStages.remove(stage);
        this.styleStages.delete(failed);
      }
      this.style = "normal";
      this.ev.message(`${failed.toUpperCase()} FAILED ON THIS GPU — BACK TO NORMAL`);
      viewer.useDefaultRenderLoop = true;
    });

    this.handler = new C.ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction(
      (e: { position: { x: number; y: number } }) => this.onClick(e.position),
      C.ScreenSpaceEventType.LEFT_CLICK,
    );
    let lastHover = 0;
    this.handler.setInputAction((e: { endPosition: { x: number; y: number } }) => {
      const now = performance.now();
      if (now - lastHover < 80) return;
      lastHover = now;
      const picked = scene.pick(new C.Cartesian2(e.endPosition.x, e.endPosition.y));
      scene.canvas.style.cursor = isPickId(picked?.id) ? "pointer" : "";
      const id = isPickId(picked?.id) ? picked.id : null;
      if (id?.layer === "cctv") {
        const cam = this.cameras.get(id.key);
        this.ev.hover?.(cam ? { x: e.endPosition.x, y: e.endPosition.y, title: cam.name, image: cam.image } : null);
      } else if (id && isPoiLayer(id.layer)) {
        const item = this.pois.get(id.layer)?.items.get(id.key);
        this.ev.hover?.(item ? { x: e.endPosition.x, y: e.endPosition.y, title: item.name, image: item.image } : null);
      } else {
        this.ev.hover?.(null);
      }
    }, C.ScreenSpaceEventType.MOUSE_MOVE);

    const touch = () => {
      this.lastInteraction = performance.now();
      if (this.orbitCenter) this.stopOrbit();
    };
    for (const type of ["pointerdown", "wheel", "touchstart"] as const) {
      scene.canvas.addEventListener(type, touch, { passive: true });
      this.cleanups.push(() => scene.canvas.removeEventListener(type, touch));
    }

    this.cleanups.push(scene.preRender.addEventListener(() => this.tick()));
    // Windy webcams are fetched around wherever the view settles.
    this.cleanups.push(
      viewer.camera.moveEnd.addEventListener(() => {
        void this.loadWebcams();
        if (this.layersOn.has("vessels")) void this.loadVessels(false);
      }),
    );
    this.cleanups.push(scene.postRender.addEventListener(() => this.afterRender()));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.models.clear();
    for (const t of this.timers.values()) clearInterval(t);
    for (const a of this.aborts.values()) a.abort();
    this.cleanups.forEach((fn) => fn());
    this.handler.destroy();
    this.viewer.destroy();
  }

  // ----- View ----------------------------------------------------------------

  getView(): CameraView {
    const cam = this.viewer.camera;
    const carto = cam.positionCartographic;
    return {
      lon: toDeg(carto.longitude),
      lat: toDeg(carto.latitude),
      alt: carto.height,
      heading: toDeg(cam.heading),
      pitch: toDeg(cam.pitch),
    };
  }

  setView(v: CameraView) {
    const C = this.C;
    this.viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(v.lon, v.lat, v.alt),
      orientation: { heading: toRad(v.heading), pitch: toRad(v.pitch), roll: 0 },
    });
  }

  /** Orbit-in from deep space to the whole Earth. */
  intro(lon = -40, lat = 25) {
    const C = this.C;
    this.viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon + 60, lat, 60_000_000) });
    this.viewer.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(lon, lat, 21_000_000),
      orientation: { heading: 0, pitch: toRad(-90), roll: 0 },
      duration: 3.2,
    });
  }

  /** Fly so the target sits in the middle of the frame, seen from `range` metres at heading/pitch. */
  flyTo(lon: number, lat: number, range: number, heading = 0, pitch = -40, duration = 3) {
    const C = this.C;
    this.stopOrbit();
    this.stopRouteFlight();
    this.untrack();
    this.lastInteraction = performance.now();
    const center = C.Cartesian3.fromDegrees(lon, lat, 0);
    this.exitCockpit(false);
    this.viewer.camera.flyToBoundingSphere(new C.BoundingSphere(center, 1), {
      offset: new C.HeadingPitchRange(toRad(heading), toRad(pitch), range),
      duration,
    });
  }

  /** Fly to an exact saved camera (scenes). */
  flyToView(v: CameraView, duration = 3) {
    const C = this.C;
    this.stopOrbit();
    this.stopRouteFlight();
    this.exitCockpit(false);
    this.untrack();
    this.lastInteraction = performance.now();
    this.viewer.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(v.lon, v.lat, v.alt),
      orientation: { heading: toRad(v.heading), pitch: toRad(v.pitch), roll: 0 },
      duration,
    });
  }

  /** Real sun, moon and stars with day/night lighting. */
  setCelestial(on: boolean) {
    const scene = this.viewer.scene;
    if (scene.sun) {
      scene.sun.show = on;
      scene.sun.glowFactor = on ? 1.6 : 1;
    }
    if (scene.moon) scene.moon.show = on;
    this.viewer.clock.currentTime = this.C.JulianDate.now();
    this.viewer.clock.multiplier = 1;
    this.celestialOn = on;
    scene.globe.enableLighting = on || this.lightingOn;
    scene.globe.dynamicAtmosphereLighting = on || this.lightingOn;
  }

  resetGlobe() {
    const C = this.C;
    this.stopOrbit();
    this.stopRouteFlight();
    this.exitCockpit(false);
    this.untrack();
    const { lon, lat } = this.getView();
    this.viewer.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(lon, Math.max(-50, Math.min(50, lat)), 21_000_000),
      orientation: { heading: 0, pitch: toRad(-90), roll: 0 },
      duration: 2.5,
    });
  }

  setAutoRotate(on: boolean) {
    this.autoRotate = on;
  }

  setLighting(on: boolean) {
    this.lightingOn = on;
    this.viewer.scene.globe.enableLighting = on || this.celestialOn;
    this.viewer.scene.globe.dynamicAtmosphereLighting = on || this.celestialOn;
  }

  setDetection(mode: DetectMode, density: number) {
    this.detectMode = mode;
    this.detectDensity = density;
    this.lastDetect = 0;
  }

  /** ELASTIC: labels go to the nearest contacts of any kind. WEIGHTED: each kind gets a fair share. */
  setAllocation(mode: Allocation) {
    this.allocation = mode;
    this.lastDetect = 0;
  }

  /** 0–100: how much far labels fade relative to near ones. */
  setLabelFade(amount: number) {
    this.labelFade = Math.max(0, Math.min(1, amount / 100));
    this.lastDetect = 0;
  }

  /** Swap aircraft icons for 3D models: none, the ones close to the camera, or every visible one (capped). */
  setModelMode(mode: ModelMode) {
    this.modelMode = mode;
    this.lastModelPick = 0;
    if (mode === "off") this.syncModels(new Set());
  }

  // ----- Annotations (voice agent) --------------------------------------------

  addMark(label: string, lon: number, lat: number) {
    const C = this.C;
    const entity = this.viewer.entities.add({
      position: C.Cartesian3.fromDegrees(lon, lat, 0),
      point: {
        pixelSize: 12,
        color: C.Color.fromCssColorString("#ff3b3b"),
        outlineColor: C.Color.WHITE,
        outlineWidth: 2,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      polyline: {
        positions: [C.Cartesian3.fromDegrees(lon, lat, 0), C.Cartesian3.fromDegrees(lon, lat, 600)],
        width: 2,
        material: C.Color.fromCssColorString("#ff3b3b").withAlpha(0.8),
      },
      label: {
        text: label.toUpperCase(),
        font: "600 13px 'JetBrains Mono', ui-monospace, monospace",
        fillColor: C.Color.WHITE,
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString("#200406").withAlpha(0.85),
        pixelOffset: new C.Cartesian2(0, -28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        eyeOffset: new C.Cartesian3(0, 600, 0),
      },
    });
    this.marks.push({ label, entity });
  }

  listMarks(): string[] {
    return this.marks.map((m) => m.label);
  }

  drawRoute(coords: [number, number][], label: string) {
    const C = this.C;
    if (this.routeEntity) this.viewer.entities.remove(this.routeEntity);
    this.routeCoords = coords;
    this.routeEntity = this.viewer.entities.add({
      name: label,
      polyline: {
        positions: coords.map(([lon, lat]) => C.Cartesian3.fromDegrees(lon, lat, 0)),
        width: 5,
        clampToGround: true,
        material: new C.PolylineGlowMaterialProperty({ glowPower: 0.3, color: C.Color.fromCssColorString("#00f0ff") }),
      },
    });
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const rect = C.Rectangle.fromDegrees(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats));
    this.untrack();
    this.viewer.camera.flyTo({ destination: rect, duration: 2.5 });
  }

  hasRoute() {
    return this.routeCoords.length > 1;
  }

  /** Low, forward-looking flight along the drawn route. */
  flyRoute(): boolean {
    if (this.routeCoords.length < 2) return false;
    const C = this.C;
    this.exitCockpit(false);
    this.untrack();
    this.orbitCenter = null;
    this.viewer.camera.cancelFlight();
    const points = this.routeCoords.map(([lon, lat]) => C.Cartesian3.fromDegrees(lon, lat, 0));
    const [lon0, lat0] = this.routeCoords[0];
    const [lon1, lat1] = this.routeCoords[1];
    this.routeFlight = { points, seg: 0, t: 0, heading: rangeBearing(lat0, lon0, lat1, lon1).bearing };
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
    return true;
  }

  private stopRouteFlight() {
    if (!this.routeFlight) return;
    this.routeFlight = null;
    if (!this.cockpit) this.viewer.scene.screenSpaceCameraController.enableInputs = true;
  }

  /** Circle the camera around a point (default: the screen centre). */
  startOrbit(lon?: number, lat?: number, range?: number) {
    const C = this.C;
    this.exitCockpit(false);
    this.untrack();
    this.stopRouteFlight();
    const center = lon !== undefined && lat !== undefined ? { lon, lat } : this.viewCenter();
    this.orbitCenter = C.Cartesian3.fromDegrees(center.lon, center.lat, 0);
    const r = range ?? Math.min(Math.max(this.getView().alt * 1.4, 1_500), 60_000);
    this.viewer.camera.cancelFlight();
    this.viewer.camera.lookAt(this.orbitCenter, new C.HeadingPitchRange(this.viewer.camera.heading, toRad(-35), r));
  }

  stopOrbit() {
    if (!this.orbitCenter) return;
    this.orbitCenter = null;
    this.viewer.camera.lookAtTransform(this.C.Matrix4.IDENTITY);
  }

  clearAnnotations() {
    for (const m of this.marks) this.viewer.entities.remove(m.entity);
    this.marks.length = 0;
    if (this.routeEntity) this.viewer.entities.remove(this.routeEntity);
    this.routeEntity = null;
    this.routeCoords = [];
    this.stopOrbit();
    this.stopRouteFlight();
  }

  /** The ground point under the middle of the screen, for the agent's context. */
  getCenter(): { lat: number; lon: number } {
    return this.viewCenter();
  }

  // ----- Style ---------------------------------------------------------------

  setStyle(id: StyleId) {
    if (id === this.style) return;
    const C = this.C;
    const def = styleById(id);
    if (def.fragmentShader && !this.styleStages.has(id)) {
      const uniforms: Record<string, () => number> = {
        intensity: () => this.styleIntensity,
        time: () => (performance.now() - this.t0) / 1000,
      };
      for (const [name, value] of Object.entries(def.uniforms ?? {})) {
        uniforms[name] = () => this.styleParams[`${id}.${name}`] ?? value;
      }
      const stage = new C.PostProcessStage({ name: `gev_${id}`, fragmentShader: def.fragmentShader, uniforms });
      this.viewer.scene.postProcessStages.add(stage);
      this.styleStages.set(id, stage);
    }
    for (const [sid, stage] of this.styleStages) stage.enabled = sid === id;
    this.style = id;
    this.styleIntensity = 0;
    this.styleFadeStart = performance.now();
  }

  setStyleParam(style: StyleId, name: string, value: number) {
    this.styleParams[`${style}.${name}`] = value;
  }

  // ----- Map source ----------------------------------------------------------

  async setMapSource(source: MapSource): Promise<boolean> {
    if (source === this.mapSource) return true;
    const { C, viewer } = this;

    if (source === "google3d") {
      if (!this.keys.googleKey && !this.keys.ionToken) {
        this.ev.message("GOOGLE 3D NEEDS A GOOGLE MAPS KEY OR CESIUM ION TOKEN — OPEN POWER UP");
        return false;
      }
      if (!this.tileset) {
        try {
          this.ev.message("STREAMING PHOTOREALISTIC 3D TILES…");
          const tileset = await C.createGooglePhotorealistic3DTileset(
            this.keys.googleKey ? { key: this.keys.googleKey } : undefined,
            { maximumScreenSpaceError: 16 },
          );
          if (this.destroyed) return false;
          this.tileset = viewer.scene.primitives.add(tileset);
          // Draw the tiles under the overlays.
          viewer.scene.primitives.lowerToBottom(tileset);
        } catch (err) {
          this.ev.message(`3D TILES FAILED: ${err instanceof Error ? err.message : "unknown error"}`.toUpperCase());
          return false;
        }
      }
      this.tileset!.show = true;
      viewer.scene.globe.show = false;
      this.mapSource = source;
      return true;
    }

    if (this.tileset) this.tileset.show = false;
    viewer.scene.globe.show = true;
    if (this.baseLayer) viewer.imageryLayers.remove(this.baseLayer, true);
    const provider =
      source === "osm"
        ? new C.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })
        : new C.UrlTemplateImageryProvider({
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            maximumLevel: 19,
            credit: "Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
          });
    this.baseLayer = viewer.imageryLayers.addImageryProvider(provider, 0);
    this.mapSource = source;
    return true;
  }

  // ----- Layers --------------------------------------------------------------

  setLayer(id: LayerId, on: boolean) {
    if (on === this.layersOn.has(id)) return;
    if (on) {
      this.layersOn.add(id);
      this.collectionsFor(id).forEach((c) => (c.show = true));
      void this.refresh(id);
      if (POLL_MS[id]) this.timers.set(id, window.setInterval(() => void this.refresh(id), POLL_MS[id]));
      return;
    }

    this.layersOn.delete(id);
    clearInterval(this.timers.get(id));
    this.timers.delete(id);
    this.aborts.get(id)?.abort();
    if (id === "cctv") {
      this.camAbort?.abort();
      this.windyAbort?.abort();
    }
    if ((id === "flights" || id === "military") && this.cockpit && this.contacts.get(this.cockpit.key)?.layer === id) {
      this.exitCockpit(false);
    }
    this.collectionsFor(id).forEach((c) => (c.show = false));
    if (id === "flights" || id === "military") {
      // Thousands of billboards: free them rather than keep them hidden.
      (id === "flights" ? this.flightBB : this.milBB).removeAll();
      for (const [key, c] of this.contacts) if (c.layer === id) this.contacts.delete(key);
    }
    if (this.selected?.layer === id) this.select(null);
    this.setStatus(id, { state: "off", count: 0 });
  }

  private collectionsFor(id: LayerId): { show: boolean }[] {
    if (isPoiLayer(id)) return [this.pois.get(id)!.coll];
    switch (id) {
      case "traffic":
        return this.trafficLayer ? [this.trafficLayer] : [];
      case "flights":
        return [this.flightBB];
      case "military":
        return [this.milBB];
      case "satellites":
        return [this.satPoints, this.satLabels, this.orbitLines];
      case "quakes":
        return [this.quakePoints, this.quakeRings, this.quakeLabels];
      case "cctv":
        return [this.camBB];
      case "cables":
        return [this.cableLines];
    }
  }

  private setStatus(id: LayerId, status: LayerStatus) {
    this.statuses.set(id, status);
    this.ev.layer(id, status);
  }

  private async fetchFeed<T extends { stale?: boolean }>(id: LayerId, path: string): Promise<T | null> {
    this.aborts.get(id)?.abort();
    const ac = new AbortController();
    this.aborts.set(id, ac);
    const prev = this.statuses.get(id);
    if (!prev || prev.state === "off" || prev.state === "error") this.setStatus(id, { state: "loading", count: prev?.count ?? 0 });
    try {
      const res = await fetch(`/api/gods-eye/${path}`, { signal: ac.signal });
      const body = (await res.json()) as T & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body;
    } catch (err) {
      if (ac.signal.aborted || this.destroyed) return null;
      this.setStatus(id, {
        state: "error",
        count: prev?.count ?? 0,
        note: err instanceof Error ? err.message : "Feed unavailable",
      });
      return null;
    }
  }

  private async refresh(id: LayerId) {
    switch (id) {
      case "flights":
      case "military":
        return this.loadFlights(id);
      case "satellites":
        return this.loadSatellites();
      case "quakes":
        return this.loadQuakes();
      case "cctv":
        return this.loadCameras();
      case "cables":
        return this.loadCables();
      case "traffic":
        return this.loadTraffic();
      case "launches":
      case "fires":
        return this.loadPoiFeed(id, id);
      case "vessels":
        return this.loadVessels(true);
      case "datacenters":
      case "dams":
        return this.loadSnapshot(id);
    }
  }

  // ----- Point layers (launches, fires, vessels, datacenters, dams) ----------

  private drawPois(id: PoiLayerId, items: Poi[], note: string, stale?: boolean) {
    const C = this.C;
    const layer = this.pois.get(id)!;
    layer.coll.removeAll();
    layer.items.clear();
    layer.positions.clear();
    layer.note = note;
    const icon = this.poiIcons.get(id)!;
    const near = id === "fires" ? new C.NearFarScalar(5_000, 1.1, 8e6, 0.35) : new C.NearFarScalar(2_000, 1.2, 1.2e7, 0.4);
    for (const item of items) {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;
      const position = C.Cartesian3.fromDegrees(item.lon, item.lat, id === "launches" ? 200 : 30);
      const size = (id === "fires" ? 10 : id === "vessels" ? 12 : 16) + (item.weight ?? 0.5) * (id === "fires" ? 22 : 8);
      layer.items.set(item.id, item);
      layer.positions.set(item.id, position);
      layer.coll.add({
        position,
        image: icon,
        width: size,
        height: size,
        rotation: item.heading !== undefined ? -toRad(item.heading) : 0,
        alignedAxis: item.heading !== undefined ? C.Cartesian3.UNIT_Z : C.Cartesian3.ZERO,
        scaleByDistance: near,
        id: { layer: id, key: item.id } satisfies PickId,
      });
    }
    this.setStatus(id, { state: stale ? "stale" : "live", count: layer.items.size, note });
    if (this.selected?.layer === id) this.ev.select(this.describe(this.selected));
  }

  private async loadPoiFeed(id: PoiLayerId, path: string) {
    const data = await this.fetchFeed<PoiFeed>(id, path);
    if (!data || this.destroyed || !this.layersOn.has(id)) return;
    if (data.needsKey) {
      this.setStatus(id, { state: "error", count: 0, note: `Add ${data.needsKey} to .env.local` });
      return;
    }
    this.drawPois(id, data.items, data.note ?? "", data.stale);
  }

  private async loadVessels(force: boolean) {
    const { lat, lon, alt } = this.getView();
    const cell = `${Math.round(lat)}:${Math.round(lon)}`;
    if (!force && cell === this.vesselCell) return;
    if (alt > 4_000_000 && !force) return;
    this.vesselCell = cell;
    await this.loadPoiFeed("vessels", `vessels?lat=${lat.toFixed(1)}&lon=${lon.toFixed(1)}`);
  }

  private async loadSnapshot(id: "datacenters" | "dams") {
    if (this.pois.get(id)!.items.size) {
      const l = this.pois.get(id)!;
      this.setStatus(id, { state: "live", count: l.items.size, note: l.note });
      return;
    }
    this.setStatus(id, { state: "loading", count: 0 });
    try {
      const res = await fetch(`/gods-eye/${id}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { rows } = (await res.json()) as { rows: (string | number)[][] };
      if (this.destroyed || !this.layersOn.has(id)) return;
      const items: Poi[] =
        id === "datacenters"
          ? rows.map(([key, name, lat, lon, operator, place]) => ({
              id: String(key),
              name: String(name),
              lat: Number(lat),
              lon: Number(lon),
              sub: ["DATA CENTER", operator, place].filter(Boolean).join(" · ").toUpperCase(),
              weight: 0.5,
              fields: [
                ["OPERATOR", String(operator || "—").toUpperCase()],
                ["LOCATION", String(place || "—").toUpperCase()],
                ["POS", `${formatLat(Number(lat))} ${formatLon(Number(lon))}`],
              ] as [string, string][],
              link: {
                href: `https://www.openstreetmap.org/${({ n: "node", w: "way", r: "relation" } as Record<string, string>)[String(key)[0]]}/${String(key).slice(1)}`,
                label: "OpenStreetMap",
              },
            }))
          : rows.map(([key, name, lat, lon, mw, height, country]) => ({
              id: String(key),
              name: String(name),
              lat: Number(lat),
              lon: Number(lon),
              sub: ["DAM", country].filter(Boolean).join(" · ").toUpperCase(),
              weight: Math.min(1, Number(mw) / 3000 + Number(height) / 300),
              fields: [
                ["HYDRO", Number(mw) ? `${Number(mw).toLocaleString("en-US")} MW` : "—"],
                ["HEIGHT", Number(height) ? `${height} M` : "—"],
                ["COUNTRY", String(country || "—").toUpperCase()],
                ["POS", `${formatLat(Number(lat))} ${formatLon(Number(lon))}`],
              ] as [string, string][],
              link: { href: `https://www.wikidata.org/wiki/${key}`, label: "Wikidata" },
            }));
      this.drawPois(id, items, id === "datacenters" ? "OpenStreetMap snapshot" : "Wikidata · ≥15 m or hydro");
    } catch (err) {
      this.setStatus(id, { state: "error", count: 0, note: err instanceof Error ? err.message : "unavailable" });
    }
  }

  private async loadTraffic() {
    const C = this.C;
    if (!this.trafficLayer) {
      this.setStatus("traffic", { state: "loading", count: 0 });
      const probe = await fetch("/api/gods-eye/traffic/3/2/3").catch(() => null);
      if (this.destroyed || !this.layersOn.has("traffic")) return;
      if (!probe || !probe.ok) {
        const text = probe ? await probe.text() : "network error";
        this.setStatus("traffic", {
          state: "error",
          count: 0,
          note: probe?.status === 503 ? "Add TOMTOM_API_KEY to .env.local" : text.slice(0, 80),
        });
        return;
      }
      this.trafficLayer = this.viewer.imageryLayers.addImageryProvider(
        new C.UrlTemplateImageryProvider({
          url: "/api/gods-eye/traffic/{z}/{x}/{y}",
          minimumLevel: 0,
          maximumLevel: 18,
          credit: "Traffic © TomTom",
        }),
      );
      this.trafficLayer.alpha = 0.9;
    }
    this.trafficLayer.show = true;
    this.setStatus("traffic", {
      state: "live",
      count: 0,
      note: this.mapSource === "google3d" ? "TomTom flow · shows on ESRI/OSM maps" : "TomTom flow · live",
    });
  }

  /** Items of a point layer, e.g. the SPACE MISSIONS list. */
  listPois(id: PoiLayerId): Poi[] {
    return [...(this.pois.get(id)?.items.values() ?? [])];
  }

  selectPoi(id: PoiLayerId, key: string) {
    if (!this.pois.get(id)?.items.has(key)) return;
    this.select({ layer: id, key });
    this.focusSelection();
  }

  // ----- Context: nearby contacts ---------------------------------------------

  /** The ground point under the middle of the screen (or under the camera). */
  private viewCenter(): { lat: number; lon: number } {
    const { C, viewer } = this;
    if (this.cockpit) {
      const c = this.contacts.get(this.cockpit.key);
      if (c) return { lat: c.row[4], lon: c.row[3] };
    }
    const canvas = viewer.scene.canvas;
    const hit = viewer.camera.pickEllipsoid(new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    const carto = hit ? C.Cartographic.fromCartesian(hit) : viewer.camera.positionCartographic;
    return { lat: toDeg(carto.latitude), lon: toDeg(carto.longitude) };
  }

  nearbyContacts(radiusKm = 250): NearbyContact[] {
    const { lat, lon } = this.viewCenter();
    const out: NearbyContact[] = [];
    const push = (layer: NearbyContact["layer"], key: string, la: number, lo: number, label: string, sub: string) => {
      const { km, bearing } = rangeBearing(lat, lon, la, lo);
      if (km <= radiusKm) out.push({ layer, key, label, sub, rangeKm: km, bearing });
    };
    for (const c of this.contacts.values()) {
      const r = c.row;
      const ft = Math.round((r[5] * FT_PER_M) / 100);
      push(c.layer, c.key, r[4], r[3], r[1] || r[0].toUpperCase(), r[6] ? "GND" : `FL${String(ft).padStart(3, "0")} · ${Math.round(r[7] * KT_PER_MS)} KT`);
    }
    if (this.layersOn.has("vessels")) {
      for (const v of this.pois.get("vessels")!.items.values()) {
        push("vessels", v.id, v.lat, v.lon, v.name, `AIS · ${v.speedKts !== undefined ? `${v.speedKts.toFixed(1)} KT` : "—"}`);
      }
    }
    return out.sort((a, b) => a.rangeKm - b.rangeKm);
  }

  /** Step to the previous/next nearby contact and lock on (or fly the cockpit to it). */
  cycleContact(dir: 1 | -1): string | null {
    const list = this.nearbyContacts().filter((c) => !this.cockpit || c.layer !== "vessels");
    if (!list.length) return null;
    const current = this.cockpit?.key ?? this.selected?.key;
    const i = list.findIndex((c) => c.key === current);
    const next = list[i < 0 ? 0 : (i + dir + list.length) % list.length];
    if (this.cockpit) {
      this.select({ layer: next.layer, key: next.key });
      this.enterCockpit();
    } else {
      this.select({ layer: next.layer, key: next.key });
      if (next.layer === "vessels") this.focusSelection();
      else this.track();
    }
    return next.label;
  }

  // ----- CCTV hopping --------------------------------------------------------------

  /** Step to the next-nearest camera around where hopping started. */
  cycleCamera(dir: 1 | -1, videoOnly = false): string | null {
    const sel = this.selected;
    if (sel?.layer !== "cctv") return null;
    if (!this.hop || this.hop.videoOnly !== videoOnly || !this.hop.list.includes(sel.key)) {
      const origin = this.camPositions.get(sel.key);
      if (!origin) return null;
      const C = this.C;
      const near: [string, number][] = [];
      for (const [id, p] of this.camPositions) {
        if (videoOnly && !this.cameras.get(id)?.hls && id !== sel.key) continue;
        const d = C.Cartesian3.distance(origin, p);
        if (d < (videoOnly ? 400_000 : 60_000)) near.push([id, d]);
      }
      near.sort((a, b) => a[1] - b[1]);
      if (near.length < 2) return null;
      this.hop = { videoOnly, list: near.slice(0, 80).map(([id]) => id) };
    }
    const list = this.hop.list;
    const i = list.indexOf(sel.key);
    const nextKey = list[(i + dir + list.length) % list.length];
    const hop = this.hop;
    this.select({ layer: "cctv", key: nextKey });
    this.hop = hop;
    const cam = this.cameras.get(nextKey);
    if (cam) this.flyTo(cam.lon, cam.lat, 1_800, this.getView().heading, -45, 1.4);
    return cam?.name ?? null;
  }

  /**
   * Fly to the closest camera that is streaming right now.
   *
   * Cameras go offline without their agency saying so, so the nearest few are
   * probed and the first playlist that actually answers wins.
   */
  async nearestVideoCamera(): Promise<string | null> {
    const C = this.C;
    const { lat, lon } = this.viewCenter();
    const here = C.Cartesian3.fromDegrees(lon, lat, 0);
    const near: { id: string; dist: number }[] = [];
    for (const [id, p] of this.camPositions) {
      if (!this.cameras.get(id)?.hls) continue;
      near.push({ id, dist: C.Cartesian3.distance(here, p) });
    }
    if (!near.length) return null;
    near.sort((a, b) => a.dist - b.dist);
    for (const candidate of near.slice(0, 6)) {
      const cam = this.cameras.get(candidate.id)!;
      const live = await fetch(cam.hls!, { signal: AbortSignal.timeout(4000) })
        .then((r) => r.ok)
        .catch(() => false);
      if (this.destroyed) return null;
      if (!live) continue;
      this.select({ layer: "cctv", key: candidate.id });
      this.flyTo(cam.lon, cam.lat, 2_000, 0, -45, 2.4);
      return `${cam.name} · ${(candidate.dist / 1000).toFixed(0)} KM`;
    }
    return null;
  }

  /** How many loaded cameras stream video. */
  videoCameraCount(): number {
    let n = 0;
    for (const cam of this.cameras.values()) if (cam.hls) n++;
    return n;
  }

  // ----- Cockpit (first person) -------------------------------------------------

  /** Put the camera in the selected aircraft's flight deck, looking along its track. */
  enterCockpit(): boolean {
    const sel = this.selected;
    if (!sel || (sel.layer !== "flights" && sel.layer !== "military")) return false;
    const c = this.contacts.get(sel.key);
    if (!c) return false;
    const { C, viewer } = this;
    this.stopOrbit();
    this.stopRouteFlight();
    this.untrack();
    if (this.cockpit) {
      const prev = this.contacts.get(this.cockpit.key);
      if (prev) prev.bb.show = true;
    } else {
      const frustum = viewer.camera.frustum as PerspectiveFrustum;
      this.savedFovy = frustum.fov ?? toRad(60);
      frustum.fov = toRad(75);
      viewer.scene.screenSpaceCameraController.enableInputs = false;
    }
    viewer.camera.cancelFlight();
    c.bb.show = false;
    this.cockpit = { key: c.key, heading: c.row[8], pitch: 0, roll: 0, offset: new C.Cartesian3(), at: c.at, last: null };
    this.ev.message(`COCKPIT › ${c.row[1] || c.row[0].toUpperCase()}`);
    return true;
  }

  /** Leave first person; by default settle into a chase view of the same aircraft. */
  exitCockpit(chase = true) {
    const cp = this.cockpit;
    if (!cp) return;
    const { viewer } = this;
    this.cockpit = null;
    const c = this.contacts.get(cp.key);
    if (c) c.bb.show = true;
    (viewer.camera.frustum as PerspectiveFrustum).fov = this.savedFovy || toRad(60);
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    this.ev.cockpit?.(null);
    if (chase && c && this.selected?.key === cp.key) this.track();
  }

  inCockpit() {
    return !!this.cockpit;
  }

  private updateRouteFlight(dt: number) {
    const f = this.routeFlight!;
    const C = this.C;
    const speed = 600; // m/s along the ground — a 100 km route takes under 3 minutes
    let travel = speed * dt;
    while (travel > 0 && f.seg < f.points.length - 1) {
      const a = f.points[f.seg];
      const b = f.points[f.seg + 1];
      const len = Math.max(C.Cartesian3.distance(a, b), 0.01);
      const left = len * (1 - f.t);
      if (travel < left) {
        f.t += travel / len;
        travel = 0;
      } else {
        travel -= left;
        f.seg++;
        f.t = 0;
      }
    }
    if (f.seg >= f.points.length - 1) {
      this.stopRouteFlight();
      this.ev.message("ROUTE COMPLETE");
      return;
    }
    const a = C.Cartographic.fromCartesian(f.points[f.seg]);
    const b = C.Cartographic.fromCartesian(f.points[f.seg + 1]);
    const lat = toDeg(a.latitude + (b.latitude - a.latitude) * f.t);
    const lon = toDeg(a.longitude + (b.longitude - a.longitude) * f.t);
    // Look a few points ahead so the heading doesn't twitch on every road kink.
    const ahead = C.Cartographic.fromCartesian(f.points[Math.min(f.seg + 6, f.points.length - 1)]);
    const target = rangeBearing(lat, lon, toDeg(ahead.latitude), toDeg(ahead.longitude)).bearing;
    f.heading = (f.heading + angleDiff(f.heading, target) * Math.min(1, dt * 1.5) + 360) % 360;
    // Sit behind and above the point, looking along the route.
    const [bLon, bLat] = deadReckon(lon, lat, -900, f.heading);
    this.viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(bLon, bLat, 650),
      orientation: { heading: toRad(f.heading), pitch: toRad(-28), roll: 0 },
    });
  }

  /** Keep a pool of 3D aircraft models on the contacts nearest the camera. */
  private updateModels(now: number) {
    const C = this.C;
    const camPos = this.viewer.camera.positionWC;
    if (now - this.lastModelPick > 700) {
      this.lastModelPick = now;
      const maxDist = this.modelMode === "proximity" ? 60_000 : 400_000;
      const cap = this.modelMode === "proximity" ? 30 : 120;
      const near: [string, number][] = [];
      const scratch = new C.Cartesian3();
      for (const c of this.contacts.values()) {
        if (c.key === this.cockpit?.key) continue;
        const d = C.Cartesian3.distance(this.contactPosition(c, scratch), camPos);
        if (d < maxDist) near.push([c.key, d]);
      }
      near.sort((a, b) => a[1] - b[1]);
      this.syncModels(new Set(near.slice(0, cap).map(([k]) => k)));
    }
    const hpr = new C.HeadingPitchRoll();
    const matrix = new C.Matrix4();
    for (const [key, model] of this.models) {
      if (model === "loading") continue;
      const c = this.contacts.get(key);
      if (!c) continue;
      const pos = this.contactPosition(c);
      // The sample aircraft's nose points along local +X (east), so heading = track − 90°.
      hpr.heading = toRad(c.row[8] - 90);
      hpr.pitch = c.row[7] > 5 ? Math.atan2(c.row[9], c.row[7]) : 0;
      model.modelMatrix = C.Transforms.headingPitchRollToFixedFrame(pos, hpr, C.Ellipsoid.WGS84, C.Transforms.eastNorthUpToFixedFrame, matrix);
    }
  }

  private syncModels(want: Set<string>) {
    const scene = this.viewer.scene;
    for (const [key, model] of this.models) {
      if (want.has(key)) continue;
      if (model !== "loading") scene.primitives.remove(model);
      this.models.delete(key);
      const c = this.contacts.get(key);
      if (c && c.key !== this.cockpit?.key) c.bb.show = true;
    }
    for (const key of want) {
      if (this.models.has(key)) continue;
      this.models.set(key, "loading");
      const layer = this.contacts.get(key)?.layer ?? "flights";
      void this.C.Model.fromGltfAsync({ url: AIRCRAFT_MODEL_URL, minimumPixelSize: 40, maximumScale: 400, id: { layer, key } satisfies PickId })
        .then((model) => {
          if (this.destroyed || this.models.get(key) !== "loading") {
            model.destroy();
            return;
          }
          const c = this.contacts.get(key);
          if (!c) {
            this.models.delete(key);
            model.destroy();
            return;
          }
          scene.primitives.add(model);
          this.models.set(key, model);
          c.bb.show = false;
        })
        .catch(() => this.models.delete(key));
    }
  }

  private updateCockpit(dt: number, now: number) {
    const cp = this.cockpit!;
    const { C, viewer } = this;
    const c = this.contacts.get(cp.key);
    if (!c) {
      this.ev.message("SIGNAL LOST — LEAVING COCKPIT");
      this.exitCockpit(false);
      return;
    }
    const r = c.row;
    const raw = this.contactPosition(c);
    // A fresh feed row snaps the dead-reckoned position; carry the old spot as an
    // offset that bleeds away over a couple of seconds instead of jumping.
    if (c.at !== cp.at && cp.last) {
      C.Cartesian3.subtract(cp.last, raw, cp.offset);
      cp.at = c.at;
    }
    C.Cartesian3.multiplyByScalar(cp.offset, Math.exp(-dt * 0.9), cp.offset);
    const pos = C.Cartesian3.add(raw, cp.offset, new C.Cartesian3());
    const carto = C.Cartographic.fromCartesian(pos);
    const ground = viewer.scene.globe.getHeight(carto) ?? 0;
    carto.height = Math.max(carto.height, ground + (r[6] ? 4 : 25)) + 3;
    const eye = C.Cartographic.toCartesian(carto);
    cp.last = C.Cartesian3.clone(pos);

    const turn = angleDiff(cp.heading, r[8]);
    const step = Math.max(-dt * 6, Math.min(dt * 6, turn * Math.min(1, dt * 1.2)));
    cp.heading = (cp.heading + step + 360) % 360;
    const climb = r[7] > 5 ? toDeg(Math.atan2(r[9], r[7])) : 0;
    cp.pitch += (Math.max(-12, Math.min(15, climb)) - cp.pitch) * Math.min(1, dt * 1.5);
    const rollTarget = Math.max(-25, Math.min(25, (step / Math.max(dt, 1e-3)) * 8));
    cp.roll += (rollTarget - cp.roll) * Math.min(1, dt * 2);

    viewer.camera.setView({
      destination: eye,
      orientation: { heading: toRad(cp.heading), pitch: toRad(cp.pitch - 4), roll: toRad(cp.roll) },
    });

    if (now - this.lastCockpitEmit > 200) {
      this.lastCockpitEmit = now;
      const lat = toDeg(carto.latitude);
      const lon = toDeg(carto.longitude);
      const traffic: CockpitInfo["traffic"] = [];
      for (const o of this.contacts.values()) {
        if (o.key === c.key) continue;
        const { km, bearing } = rangeBearing(lat, lon, o.row[4], o.row[3]);
        if (km > 80) continue;
        traffic.push({
          label: o.row[1] || o.row[0].toUpperCase(),
          rangeKm: km,
          relBearing: angleDiff(cp.heading, bearing),
          altFt: Math.round(o.row[5] * FT_PER_M),
        });
      }
      traffic.sort((a, b) => a.rangeKm - b.rangeKm);
      this.ev.cockpit?.({
        key: c.key,
        callsign: r[1] || r[0].toUpperCase(),
        type: r[11] || "",
        military: c.layer === "military",
        gsKts: Math.round(r[7] * KT_PER_MS),
        heading: cp.heading,
        pitch: cp.pitch,
        roll: cp.roll,
        altFt: Math.round((carto.height - 3) * FT_PER_M),
        vsFpm: Math.round(r[9] * FT_PER_M * 60),
        onGround: !!r[6],
        lat,
        lon,
        traffic: traffic.slice(0, 8),
      });
    }
  }

  // ----- Flights -------------------------------------------------------------

  private async loadFlights(id: "flights" | "military") {
    const { lat, lon } = this.getView();
    const data = await this.fetchFeed<FlightsFeed>(
      id,
      id === "military" ? "military" : `flights?lat=${lat.toFixed(1)}&lon=${lon.toFixed(1)}`,
    );
    if (!data || !this.layersOn.has(id) || this.destroyed) return;
    const C = this.C;
    const coll = id === "military" ? this.milBB : this.flightBB;
    const now = performance.now();
    const seen = new Set<string>();

    for (const row of data.aircraft) {
      const key = `${id === "military" ? "m" : "f"}:${row[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const position = C.Cartesian3.fromDegrees(row[3], row[4], row[5]);
      const image = id === "military" ? this.icons.mil : row[6] ? this.icons.ground : this.icons.plane;
      const existing = this.contacts.get(key);
      if (existing) {
        existing.row = row;
        existing.at = now;
        existing.bb.position = position;
        existing.bb.rotation = -toRad(row[8]);
        existing.bb.image = image;
      } else {
        const bb = coll.add({
          position,
          image,
          width: id === "military" ? 24 : 20,
          height: id === "military" ? 24 : 20,
          rotation: -toRad(row[8]),
          alignedAxis: C.Cartesian3.UNIT_Z,
          scaleByDistance: this.nearFar,
          id: { layer: id, key } satisfies PickId,
        });
        this.contacts.set(key, { key, layer: id, row, at: now, bb });
      }
    }
    for (const [key, c] of this.contacts) {
      if (c.layer === id && !seen.has(key)) {
        coll.remove(c.bb);
        this.contacts.delete(key);
      }
    }
    if (id === "flights") this.flightSource = data.source;
    this.setStatus(id, {
      state: data.stale ? "stale" : "live",
      count: seen.size,
      note: id === "flights" ? (data.source === "opensky" ? "OpenSky · worldwide" : "adsb.lol · 250 nm of view") : "adsb.lol",
    });
    this.tryPendingTrack();
  }

  private contactPosition(c: Contact, result?: Cartesian3): Cartesian3 {
    const r = c.row;
    const dt = Math.min((performance.now() - c.at) / 1000, 240);
    if (r[6] || r[7] < 5) return this.C.Cartesian3.fromDegrees(r[3], r[4], r[5], undefined, result);
    const [lon, lat] = deadReckon(r[3], r[4], r[7] * dt, r[8]);
    const alt = Math.max(0, r[5] + r[9] * Math.min(dt, 60));
    return this.C.Cartesian3.fromDegrees(lon, lat, alt, undefined, result);
  }

  // ----- Satellites ----------------------------------------------------------

  private async loadSatellites() {
    const data = await this.fetchFeed<SatellitesFeed>("satellites", "satellites");
    if (!data || this.destroyed) return;
    const C = this.C;
    this.satPoints.removeAll();
    this.satLabels.removeAll();
    this.orbitLines.removeAll();
    this.sats = [];
    this.satIndex.clear();

    const stationColor = C.Color.fromCssColorString("#ffffff");
    const starlinkColor = C.Color.fromCssColorString("#4fb3d9").withAlpha(0.55);
    const otherColor = C.Color.fromCssColorString("#00f0ff").withAlpha(0.9);
    const notable = /^(ISS \(ZARYA\)|CSS \(TIANHE\)|HST)$/;

    for (const [name, l1, l2] of data.sats) {
      let rec: SatRec;
      try {
        rec = twoline2satrec(l1, l2);
      } catch {
        continue;
      }
      if (rec.error) continue;
      const kind: SatRecord["kind"] = notable.test(name) ? "station" : name.startsWith("STARLINK") ? "starlink" : "other";
      const key = `s:${rec.satnum}`;
      const point = this.satPoints.add({
        pixelSize: kind === "station" ? 7 : kind === "starlink" ? 2 : 3,
        color: kind === "station" ? stationColor : kind === "starlink" ? starlinkColor : otherColor,
        outlineColor: C.Color.fromCssColorString("#ff3b3b"),
        outlineWidth: kind === "station" ? 2 : 0,
        id: { layer: "satellites", key } satisfies PickId,
      });
      const record: SatRecord = { key, name, rec, kind, point };
      this.sats.push(record);
      this.satIndex.set(key, record);
    }

    this.propagateAll(new Date());
    for (const s of this.sats) {
      if (s.kind !== "station") continue;
      this.satLabels.add({
        position: s.point.position,
        text: s.name.replace(/ \(.*\)/, ""),
        font: "600 12px 'JetBrains Mono', ui-monospace, monospace",
        fillColor: C.Color.WHITE,
        showBackground: true,
        backgroundColor: C.Color.BLACK.withAlpha(0.55),
        pixelOffset: new C.Cartesian2(10, -12),
        id: { layer: "satellites", key: s.key } satisfies PickId,
      });
    }
    this.setStatus("satellites", {
      state: data.stale ? "stale" : "live",
      count: this.sats.length,
      note: `${data.source ?? "CelesTrak"} · SGP4`,
    });
    this.tryPendingTrack();
  }

  private satPosition(s: SatRecord, date: Date, result?: Cartesian3): Cartesian3 | null {
    const pv = propagate(s.rec, date);
    if (!pv || typeof pv.position !== "object") return null;
    const ecf = eciToEcf(pv.position, gstime(date));
    if (!Number.isFinite(ecf.x)) return null;
    const C = this.C;
    return result
      ? C.Cartesian3.fromElements(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000, result)
      : new C.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000);
  }

  private propagateAll(date: Date) {
    const scratch = new this.C.Cartesian3();
    let labelIdx = 0;
    for (const s of this.sats) {
      const p = this.satPosition(s, date, scratch);
      if (!p) {
        s.point.show = false;
        continue;
      }
      s.point.show = true;
      s.point.position = p;
      if (s.kind === "station" && labelIdx < this.satLabels.length) {
        this.satLabels.get(labelIdx++).position = p;
      }
    }
  }

  private drawOrbit(s: SatRecord) {
    const C = this.C;
    this.orbitLines.removeAll();
    const periodMin = (2 * Math.PI) / s.rec.no;
    if (!Number.isFinite(periodMin) || periodMin <= 0) return;
    // Fix Earth's rotation at "now" so one revolution draws as a closed ring.
    const now = new Date();
    const gmst = gstime(now);
    const positions: Cartesian3[] = [];
    for (let i = 0; i <= 180; i++) {
      const t = new Date(now.getTime() + (i / 180) * periodMin * 60_000);
      const pv = propagate(s.rec, t);
      if (!pv || typeof pv.position !== "object") continue;
      const ecf = eciToEcf(pv.position, gmst);
      positions.push(new C.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000));
    }
    if (positions.length > 2) {
      this.orbitLines.add({
        positions,
        width: 1.5,
        material: C.Material.fromType("Color", { color: C.Color.fromCssColorString("#ff3b3b").withAlpha(0.75) }),
      });
    }
  }

  // ----- Quakes --------------------------------------------------------------

  private async loadQuakes() {
    const data = await this.fetchFeed<QuakesFeed>("quakes", "quakes");
    if (!data || this.destroyed) return;
    const C = this.C;
    this.quakes = data.quakes;
    this.quakePoints.removeAll();
    this.quakeRings.removeAll();
    this.quakeLabels.removeAll();
    const red = C.Color.fromCssColorString("#ff3b3b");
    for (const q of data.quakes) {
      const position = C.Cartesian3.fromDegrees(q.lon, q.lat, 500);
      const size = 5 + Math.max(0, q.mag) * 2.2;
      const id: PickId = { layer: "quakes", key: q.id };
      this.quakeRings.add({ position, pixelSize: size, color: C.Color.TRANSPARENT, outlineColor: red, outlineWidth: 2, id });
      this.quakePoints.add({ position, pixelSize: size, color: red.withAlpha(0.85), outlineColor: C.Color.BLACK, outlineWidth: 1, id });
      if (q.mag >= 4) {
        this.quakeLabels.add({
          position,
          text: `M${q.mag.toFixed(1)}`,
          font: "600 11px 'JetBrains Mono', ui-monospace, monospace",
          fillColor: C.Color.fromCssColorString("#ffd0d0"),
          showBackground: true,
          backgroundColor: C.Color.BLACK.withAlpha(0.5),
          pixelOffset: new C.Cartesian2(12, -10),
          id,
        });
      }
    }
    this.setStatus("quakes", { state: data.stale ? "stale" : "live", count: data.quakes.length, note: "USGS · M2.5+" });
  }

  // ----- Cameras -------------------------------------------------------------

  private async loadCameras() {
    const index = await this.fetchFeed<CamerasFeed>("cctv", "cameras");
    if (!index || this.destroyed || !this.layersOn.has("cctv")) return;
    this.cameraProvider = index.provider;
    this.windyEnabled = Boolean(index.windy);
    // Windy doesn't depend on the open-data networks; start it straight away.
    void this.loadWebcams();

    this.camAbort?.abort();
    const ac = new AbortController();
    this.camAbort = ac;
    const nets = index.networks ?? [];
    let live = 0;
    let failed = 0;
    let done = 0;
    const note = () =>
      `${live} networks${done < nets.length ? ` · ${nets.length - done} loading` : ""}` +
      `${failed ? ` · ${failed} down` : ""}${this.windyEnabled ? " · + Windy nearby" : ""}`;

    let next = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (next < nets.length) {
          const net = nets[next++];
          try {
            const res = await fetch(`/api/gods-eye/cameras?net=${encodeURIComponent(net.id)}`, { signal: ac.signal });
            const data = (await res.json()) as CamerasFeed & { error?: string };
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            if (ac.signal.aborted || this.destroyed || !this.layersOn.has("cctv")) return;
            for (const cam of data.cameras) this.addCamera(cam);
            live++;
          } catch {
            if (ac.signal.aborted || this.destroyed) return;
            failed++;
          }
          done++;
          this.camNetworksNote = note();
          this.setStatus("cctv", { state: live ? "live" : done < nets.length ? "loading" : "error", count: this.cameras.size, note: this.camNetworksNote });
        }
      }),
    );
  }

  private addCamera(cam: Camera): Billboard | null {
    if (this.cameras.has(cam.id)) return null;
    const at = `${cam.lat.toFixed(4)},${cam.lon.toFixed(4)}`;
    if (this.camCoords.has(at)) return null;
    this.camCoords.add(at);
    const C = this.C;
    const position = C.Cartesian3.fromDegrees(cam.lon, cam.lat, 25);
    this.cameras.set(cam.id, cam);
    this.camPositions.set(cam.id, position);
    return this.camBB.add({
      position,
      image: cam.hls ? this.icons.camVideo : this.icons.cam,
      width: 22,
      height: 22,
      scaleByDistance: new C.NearFarScalar(500, 1.3, 400_000, 0.35),
      translucencyByDistance: new C.NearFarScalar(200_000, 1, 2_500_000, 0),
      id: { layer: "cctv", key: cam.id } satisfies PickId,
    });
  }

  /** Swap in Windy's webcams around the current view (only when the server has a key). */
  private async loadWebcams() {
    if (!this.windyEnabled || !this.layersOn.has("cctv") || this.destroyed) return;
    const { lat, lon, alt } = this.getView();
    if (alt > 3_000_000) return; // whole-globe view: nothing "nearby" to ask for
    const cell = `${Math.round(lat)}:${Math.round(lon)}`;
    if (cell === this.windyCell) return;
    this.windyAbort?.abort();
    const ac = new AbortController();
    this.windyAbort = ac;
    try {
      const res = await fetch(`/api/gods-eye/webcams?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`, { signal: ac.signal });
      const data = (await res.json()) as CamerasFeed & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (ac.signal.aborted || this.destroyed || !this.layersOn.has("cctv")) return;
      this.windyCell = cell;
      const keep = new Set(data.cameras.map((c) => c.id));
      for (const [id, bb] of this.windyBB) {
        if (keep.has(id) || this.selected?.key === id) continue;
        this.camBB.remove(bb);
        this.windyBB.delete(id);
        const gone = this.cameras.get(id);
        if (gone) this.camCoords.delete(`${gone.lat.toFixed(4)},${gone.lon.toFixed(4)}`);
        this.cameras.delete(id);
        this.camPositions.delete(id);
      }
      for (const cam of data.cameras) {
        const bb = this.addCamera(cam);
        if (bb) this.windyBB.set(cam.id, bb);
        else if (this.windyBB.has(cam.id)) this.cameras.set(cam.id, cam); // refresh the short-lived image token
      }
      this.setStatus("cctv", { state: "live", count: this.cameras.size, note: this.camNetworksNote });
    } catch {
      /* Windy is a bonus layer: keep the open-data cameras as they are */
    }
  }

  // ----- Cables --------------------------------------------------------------

  private async loadCables() {
    if (this.cables.length) {
      this.setStatus("cables", { state: "live", count: this.cables.length, note: "TeleGeography" });
      return;
    }
    const data = await this.fetchFeed<CablesFeed>("cables", "cables");
    if (!data || this.destroyed) return;
    const C = this.C;
    this.cables = data.cables;
    const material = C.Material.fromType("Color", { color: C.Color.fromCssColorString("#00e5ff").withAlpha(0.5) });
    data.cables.forEach((cable, i) => {
      for (const line of cable.lines) {
        const flat = densifyLine(line, 1).flat();
        if (flat.length < 4) continue;
        this.cableLines.add({
          positions: C.Cartesian3.fromDegreesArrayHeights(
            flat.flatMap((v, j) => (j % 2 === 1 ? [v, 1500] : [v])),
          ),
          width: 1.25,
          material,
          id: { layer: "cables", key: String(i) } satisfies PickId,
        });
      }
    });
    this.cableLines.show = this.layersOn.has("cables");
    this.setStatus("cables", { state: data.stale ? "stale" : "live", count: data.cables.length, note: "TeleGeography" });
  }

  // ----- Selection & tracking -----------------------------------------------

  private onClick(pos: { x: number; y: number }) {
    const picked = this.viewer.scene.pick(new this.C.Cartesian2(pos.x, pos.y));
    if (isPickId(picked?.id)) {
      this.select(picked.id);
    } else if (!this.tracked) {
      this.select(null);
    }
  }

  select(id: PickId | null) {
    const prev = this.selected;
    if (prev && id && prev.layer === id.layer && prev.key === id.key) return;
    if (this.tracked) this.untrack();
    this.hop = null;
    this.selected = id;
    this.trail = [];
    this.orbitLines.removeAll();
    if (id?.layer === "satellites") {
      const s = this.satIndex.get(id.key);
      if (s) this.drawOrbit(s);
    }
    this.lastDetect = 0;
    this.ev.select(id ? this.describe(id) : null);
  }

  clearSelection() {
    this.select(null);
  }

  /**
   * Lock the camera onto the selection, with a fading trail for moving targets.
   *
   * Not Cesium's trackedEntity: that waits on a bounding sphere a 1px point never
   * reports, so the camera stayed wherever it was. Instead the camera is anchored
   * in the target's east-north-up frame, and tick() re-anchors it every frame —
   * the offset carries over, so the mouse still orbits and zooms around the target.
   */
  track() {
    const sel = this.selected;
    if (!sel) return;
    const { C, viewer } = this;
    this.stopOrbit();
    this.stopRouteFlight();
    this.exitCockpit(false);
    this.untrack();
    const target = this.positionOf(sel);
    if (!target) return;
    const moving = sel.layer === "flights" || sel.layer === "military";
    const range = sel.layer === "satellites" ? 1_400_000 : moving ? 25_000 : 3_000;
    viewer.camera.cancelFlight();
    viewer.camera.lookAtTransform(
      C.Transforms.eastNorthUpToFixedFrame(target),
      new C.HeadingPitchRange(toRad(20), toRad(sel.layer === "satellites" ? -25 : -35), range),
    );
    this.tracked = sel;
    if (sel.layer === "flights" || sel.layer === "military" || sel.layer === "satellites") {
      this.trailEntity = viewer.entities.add({
        polyline: {
          positions: new C.CallbackProperty(() => this.trail, false),
          width: 2,
          material: new C.PolylineGlowMaterialProperty({
            glowPower: 0.25,
            color: C.Color.fromCssColorString(sel.layer === "satellites" ? "#ff3b3b" : "#ffb020").withAlpha(0.9),
          }),
        },
      });
    }
    this.ev.tracking(true);
  }

  untrack() {
    if (!this.tracked) return;
    const viewer = this.viewer;
    viewer.camera.lookAtTransform(this.C.Matrix4.IDENTITY);
    if (this.trailEntity) viewer.entities.remove(this.trailEntity);
    this.tracked = null;
    this.trailEntity = null;
    this.trail = [];
    this.ev.tracking(false);
  }

  /** Fly the camera to the selection without locking on. */
  focusSelection() {
    const sel = this.selected;
    if (!sel) return;
    this.exitCockpit(false);
    const p = this.positionOf(sel);
    if (!p) return;
    const carto = this.C.Cartographic.fromCartesian(p);
    const range =
      sel.layer === "satellites" ? 3_000_000
      : sel.layer === "cables" ? 2_000_000
      : sel.layer === "quakes" || sel.layer === "launches" || sel.layer === "fires" ? 400_000
      : sel.layer === "cctv" ? 1_800
      : 12_000;
    const lon = toDeg(carto.longitude);
    const lat = toDeg(carto.latitude);
    this.untrack();
    this.lastInteraction = performance.now();
    this.viewer.camera.flyToBoundingSphere(new this.C.BoundingSphere(p, 1), {
      offset: new this.C.HeadingPitchRange(0, toRad(sel.layer === "satellites" || sel.layer === "quakes" || sel.layer === "cables" ? -80 : -35), range),
      duration: 2.5,
    });
    void lon;
    void lat;
  }

  /** Find a satellite or flight by name/callsign and lock onto it. Returns false if nothing matches yet. */
  trackByName(query: string): boolean {
    const q = query.trim().toUpperCase();
    if (!q) return false;
    const aliases: Record<string, string> = { ISS: "ISS (ZARYA)", CSS: "CSS (TIANHE)", HST: "HST" };
    const target = aliases[q];
    const sat =
      (target && this.sats.find((s) => s.name === target)) ||
      this.sats.find((s) => s.name === q) ||
      this.sats.find((s) => s.name.includes(q));
    if (sat) {
      this.pendingTrack = null;
      this.select({ layer: "satellites", key: sat.key });
      this.track();
      return true;
    }
    const compact = q.replace(/\s+/g, "");
    for (const c of this.contacts.values()) {
      if (c.row[1].toUpperCase() === compact || c.row[0].toUpperCase() === compact.toLowerCase().toUpperCase()) {
        this.pendingTrack = null;
        this.select({ layer: c.layer, key: c.key });
        this.track();
        return true;
      }
    }
    this.pendingTrack = q;
    return false;
  }

  private tryPendingTrack() {
    const query = this.pendingTrack;
    if (query && this.trackByName(query)) this.ev.message(`TRACK LOCKED › ${query}`);
  }

  private positionOf(sel: PickId, result?: Cartesian3): Cartesian3 | null {
    const C = this.C;
    if (isPoiLayer(sel.layer)) {
      const p = this.pois.get(sel.layer)?.positions.get(sel.key);
      return p ? C.Cartesian3.clone(p, result) : null;
    }
    switch (sel.layer) {
      case "traffic":
        return null;
      case "flights":
      case "military": {
        const c = this.contacts.get(sel.key);
        return c ? this.contactPosition(c, result) : null;
      }
      case "satellites": {
        const s = this.satIndex.get(sel.key);
        return s ? this.satPosition(s, new Date(), result) : null;
      }
      case "quakes": {
        const q = this.quakes.find((x) => x.id === sel.key);
        return q ? C.Cartesian3.fromDegrees(q.lon, q.lat, 500, undefined, result) : null;
      }
      case "cctv": {
        const p = this.camPositions.get(sel.key);
        return p ? C.Cartesian3.clone(p, result) : null;
      }
      case "cables": {
        const cable = this.cables[Number(sel.key)];
        const line = cable?.lines[0];
        if (!line?.length) return null;
        const [lon, lat] = line[Math.floor(line.length / 2)];
        return C.Cartesian3.fromDegrees(lon, lat, 1500, undefined, result);
      }
    }
  }

  private describe(sel: PickId): Selection {
    const base = { layer: sel.layer, key: sel.key };
    const C = this.C;
    if (isPoiLayer(sel.layer)) {
      const item = this.pois.get(sel.layer)?.items.get(sel.key);
      if (!item) return { ...base, title: "NO LONGER REPORTED", subtitle: "", fields: [] };
      const when = item.when ? [["SEEN", formatAgo(item.when)] as [string, string]] : [];
      return {
        ...base,
        title: item.name.toUpperCase(),
        subtitle: item.sub.toUpperCase(),
        fields: [...item.fields, ...(sel.layer === "vessels" ? when : [])],
        image: item.image,
        link: item.link,
      };
    }
    switch (sel.layer) {
      case "traffic":
        return { ...base, title: "STREET TRAFFIC", subtitle: "", fields: [] };
      case "flights":
      case "military": {
        const c = this.contacts.get(sel.key);
        if (!c) return { ...base, title: "SIGNAL LOST", subtitle: "Contact no longer reported", fields: [] };
        const r = c.row;
        const p = this.contactPosition(c);
        const carto = C.Cartographic.fromCartesian(p);
        const ft = Math.round((carto.height * FT_PER_M) / 25) * 25;
        return {
          ...base,
          title: r[1] || r[0].toUpperCase(),
          subtitle: [sel.layer === "military" ? "MILITARY" : "CIVIL", r[11], r[2]].filter(Boolean).join(" · ").toUpperCase(),
          fields: [
            ["ICAO24", r[0].toUpperCase()],
            ["ALT", r[6] ? "ON GROUND" : `${ft.toLocaleString("en-US")} FT${ft >= 18_000 ? ` · FL${Math.round(ft / 100)}` : ""}`],
            ["GS", `${Math.round(r[7] * KT_PER_MS)} KTS`],
            ["HDG", `${Math.round(r[8]).toString().padStart(3, "0")}°`],
            ["V/S", `${Math.round(r[9] * FT_PER_M * 60)} FPM`],
            ["SQUAWK", r[10] || "—"],
            ["POS", `${formatLat(toDeg(carto.latitude))} ${formatLon(toDeg(carto.longitude))}`],
            ["SOURCE", (sel.layer === "military" ? "adsb.lol" : this.flightSource || "—").toUpperCase()],
          ],
          link: { href: `https://globe.adsb.lol/?icao=${r[0]}`, label: "ADS-B history" },
        };
      }
      case "satellites": {
        const s = this.satIndex.get(sel.key);
        if (!s) return { ...base, title: "NO ELEMENT SET", subtitle: "", fields: [] };
        const now = new Date();
        const pv = propagate(s.rec, now);
        const fields: [string, string][] = [["NORAD", s.rec.satnum]];
        if (pv && typeof pv.position === "object") {
          const geo = eciToGeodetic(pv.position, gstime(now));
          const v = pv.velocity;
          fields.push(
            ["ALT", `${Math.round(geo.height).toLocaleString("en-US")} KM`],
            ["VEL", `${Math.hypot(v.x, v.y, v.z).toFixed(2)} KM/S`],
            ["POS", `${formatLat(toDeg(geo.latitude))} ${formatLon(toDeg(geo.longitude))}`],
          );
        }
        fields.push(
          ["INC", `${toDeg(s.rec.inclo).toFixed(2)}°`],
          ["PERIOD", `${((2 * Math.PI) / s.rec.no).toFixed(1)} MIN`],
        );
        return {
          ...base,
          title: s.name,
          subtitle: s.kind === "station" ? "CREWED STATION / OBSERVATORY" : s.kind === "starlink" ? "STARLINK CONSTELLATION" : "ACTIVE SATELLITE",
          fields,
          link: { href: `https://www.n2yo.com/satellite/?s=${s.rec.satnum}`, label: "N2YO pass data" },
        };
      }
      case "quakes": {
        const q = this.quakes.find((x) => x.id === sel.key);
        if (!q) return { ...base, title: "EVENT EXPIRED", subtitle: "", fields: [] };
        return {
          ...base,
          title: `M${q.mag.toFixed(1)} EARTHQUAKE`,
          subtitle: q.place.toUpperCase(),
          fields: [
            ["MAG", q.mag.toFixed(1)],
            ["DEPTH", `${q.depthKm.toFixed(1)} KM`],
            ["TIME", `${new Date(q.time).toISOString().slice(11, 19)}Z · ${formatAgo(q.time)}`],
            ["POS", `${formatLat(q.lat)} ${formatLon(q.lon)}`],
          ],
          link: { href: q.url, label: "USGS event page" },
        };
      }
      case "cctv": {
        const cam = this.cameras.get(sel.key);
        if (!cam) return { ...base, title: "CAMERA OFFLINE", subtitle: "", fields: [] };
        return {
          ...base,
          title: cam.name.toUpperCase(),
          subtitle: `${cam.id} · ${(cam.source ?? this.cameraProvider).toUpperCase()}`,
          fields: [
            ["VIEW", (cam.view ?? "—").toUpperCase()],
            ["POS", `${formatLat(cam.lat)} ${formatLon(cam.lon)}`],
          ],
          image: cam.image,
          video: cam.video,
          hls: cam.hls,
        };
      }
      case "cables": {
        const cable = this.cables[Number(sel.key)];
        return {
          ...base,
          title: (cable?.name ?? "CABLE").toUpperCase(),
          subtitle: "SUBMARINE CABLE SYSTEM",
          fields: [["SEGMENTS", String(cable?.lines.length ?? 0)]],
          link: { href: "https://www.submarinecablemap.com/", label: "© TeleGeography" },
        };
      }
    }
  }

  // ----- Frame loop ----------------------------------------------------------

  private tick() {
    if (this.destroyed) return;
    const C = this.C;
    const now = performance.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.1);
    this.lastTick = now;

    if (this.styleIntensity < 1) this.styleIntensity = Math.min(1, (now - this.styleFadeStart) / 500);

    // Dead reckoning: glide every aircraft along its track between feed updates.
    if (now - this.lastReckon > 1000 && this.contacts.size) {
      this.lastReckon = now;
      const scratch = new C.Cartesian3();
      for (const c of this.contacts.values()) {
        if (c.row[6] || c.row[7] < 5) continue;
        c.bb.position = this.contactPosition(c, scratch);
      }
    }

    if (this.sats.length && this.layersOn.has("satellites") && now - this.lastSatPropagate > 2000) {
      this.lastSatPropagate = now;
      this.propagateAll(new Date());
    }

    // Quake ping: an outline ring expanding and fading on each epicentre.
    if (this.quakeRings.length && this.layersOn.has("quakes")) {
      const t = (now - this.t0) / 1000;
      for (let i = 0; i < this.quakeRings.length; i++) {
        const ring = this.quakeRings.get(i);
        const base = this.quakePoints.get(i).pixelSize;
        const phase = (t * 0.6 + i * 0.137) % 1;
        ring.pixelSize = base + phase * base * 2.5;
        ring.outlineColor = C.Color.fromCssColorString("#ff3b3b").withAlpha(1 - phase);
      }
    }

    if (this.cockpit) this.updateCockpit(dt, now);
    if (this.orbitCenter) this.viewer.camera.rotateRight(dt * 0.12);
    if (this.routeFlight) this.updateRouteFlight(dt);
    if (this.modelMode !== "off") this.updateModels(now);

    if (this.tracked) {
      const p = this.positionOf(this.tracked, this.followScratch);
      if (p) this.viewer.camera.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(p, undefined, this.followMatrix));
      else this.untrack();
    }

    if (this.tracked && now - this.lastTrailSample > 1000) {
      this.lastTrailSample = now;
      const p = this.positionOf(this.tracked);
      if (p) {
        this.trail.push(p);
        if (this.trail.length > 240) this.trail.shift();
      }
    }

    if (
      this.autoRotate &&
      !this.tracked &&
      !this.cockpit &&
      !this.orbitCenter &&
      !this.routeFlight &&
      now - this.lastInteraction > 8000 &&
      this.viewer.camera.positionCartographic.height > 6_000_000
    ) {
      this.viewer.camera.rotate(C.Cartesian3.UNIT_Z, -dt * 0.03);
    }
  }

  private afterRender() {
    if (this.destroyed) return;
    const now = performance.now();
    if (now - this.lastReadout > 250) {
      this.lastReadout = now;
      this.emitReadout();
    }
    if (this.selected && now - this.lastDescribe > 1000) {
      this.lastDescribe = now;
      const still: LayerId[] = ["cctv", "cables", "datacenters", "dams", "launches", "fires"];
      if (!still.includes(this.selected.layer)) {
        this.ev.select(this.describe(this.selected));
      }
    }
    if (now - this.lastDetect > 120) {
      this.lastDetect = now;
      this.drawDetections();
    }
  }

  private emitReadout() {
    const cam = this.viewer.camera;
    const carto = cam.positionCartographic;
    const lat = toDeg(carto.latitude);
    const lon = toDeg(carto.longitude);
    const frustum = cam.frustum as PerspectiveFrustum;
    const gsd = estimateGsd(carto.height, frustum.fovy ?? toRad(60), this.viewer.scene.canvas.clientHeight);
    const sun = sunPosition(new Date(), lat, lon);
    this.ev.readout({
      lat,
      lon,
      altM: carto.height,
      heading: (toDeg(cam.heading) + 360) % 360,
      pitch: toDeg(cam.pitch),
      gsd,
      niirs: niirsFromGsd(gsd),
      sunEl: sun.el,
      sunAz: sun.az,
    });
  }

  // ----- Detection overlay ---------------------------------------------------

  private drawDetections() {
    const C = this.C;
    const canvas = this.detectCanvas;
    const scene = this.viewer.scene;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const camPos = scene.camera.positionWC;
    const camDir = scene.camera.directionWC;
    const scratch = new C.Cartesian3();
    const toCam = new C.Cartesian3();
    // Horizon culling against a sphere of Earth's polar radius (Cesium's own
    // EllipsoidalOccluder test, unscaled): hidden when the line of sight dips
    // below the horizon plane AND past the tangent cone.
    const EARTH_R = 6_356_752;
    const vh = C.Cartesian3.magnitudeSquared(camPos) - EARTH_R * EARTH_R;

    type Cand = { p: Cartesian3; dist: number; label: string; sub: string; color: string; sel: boolean };
    const visible = (p: Cartesian3) => {
      C.Cartesian3.subtract(p, camPos, toCam);
      if (C.Cartesian3.dot(toCam, camDir) <= 0) return false;
      const vtDotVc = -C.Cartesian3.dot(toCam, camPos);
      return !(vtDotVc > vh && (vtDotVc * vtDotVc) / C.Cartesian3.magnitudeSquared(toCam) > vh);
    };

    const cands: Cand[] = [];
    if (this.detectMode !== "off") {
      const limit = this.detectMode === "sparse" ? 10 : 10 + Math.round(this.detectDensity * 0.7);
      for (const c of this.contacts.values()) {
        if (c.key === this.cockpit?.key) continue;
        const p = this.contactPosition(c, scratch);
        if (!visible(p)) continue;
        const dist = C.Cartesian3.distance(p, camPos);
        const ft = Math.round((c.row[5] * FT_PER_M) / 100);
        cands.push({
          p: C.Cartesian3.clone(p),
          dist,
          label: c.row[1] || c.row[0].toUpperCase(),
          sub: c.row[6] ? "GND" : `FL${String(ft).padStart(3, "0")}`,
          color: c.layer === "military" ? "#ffb020" : "#00f0ff",
          sel: false,
        });
      }
      if (this.layersOn.has("cctv")) {
        // Tens of thousands of cameras: only those close enough to be drawn are worth labelling.
        for (const [id, p] of this.camPositions) {
          const dist = C.Cartesian3.distance(p, camPos);
          if (dist > 400_000 || !visible(p)) continue;
          cands.push({ p, dist, label: id, sub: "CCTV", color: "#39ff88", sel: false });
        }
      }
      for (const id of ["vessels", "launches", "datacenters", "dams"] as const) {
        if (!this.layersOn.has(id)) continue;
        const layer = this.pois.get(id)!;
        const style = POI_STYLE[id];
        for (const [key, p] of layer.positions) {
          const dist = C.Cartesian3.distance(p, camPos);
          if (dist > (id === "launches" ? 2_000_000 : 150_000) || !visible(p)) continue;
          cands.push({ p, dist, label: (layer.items.get(key)?.name ?? key).slice(0, 18).toUpperCase(), sub: style.label, color: style.color, sel: false });
        }
      }
      if (this.detectMode === "dense" && this.layersOn.has("satellites")) {
        for (const s of this.sats) {
          if (s.kind === "starlink" || !s.point.show) continue;
          const p = s.point.position;
          if (!visible(p)) continue;
          cands.push({ p, dist: C.Cartesian3.distance(p, camPos), label: s.name.slice(0, 16), sub: "SAT", color: "#7fdcff", sel: false });
        }
      }
      cands.sort((a, b) => a.dist - b.dist);
      if (this.allocation === "weighted") {
        // Round-robin across kinds (colour identifies the kind), nearest first within each.
        const groups = new Map<string, Cand[]>();
        for (const c of cands) (groups.get(c.color) ?? groups.set(c.color, []).get(c.color)!).push(c);
        const picked: Cand[] = [];
        const queues = [...groups.values()];
        for (let i = 0; picked.length < limit && queues.some((q) => q.length > i); i++) {
          for (const q of queues) if (q[i] && picked.length < limit) picked.push(q[i]);
        }
        cands.length = 0;
        cands.push(...picked);
      } else {
        cands.length = Math.min(cands.length, limit);
      }
    }
    const farthest = cands.reduce((m, c) => Math.max(m, c.dist), 1);

    if (this.selected) {
      const p = this.positionOf(this.selected);
      if (p && visible(p)) {
        const d = this.describe(this.selected);
        cands.push({ p, dist: C.Cartesian3.distance(p, camPos), label: d.title.slice(0, 22), sub: "LOCK", color: "#ff3b3b", sel: true });
      }
    }

    ctx.font = "600 10px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textBaseline = "bottom";
    // Boxes always draw; a label that would overprint one already drawn is dropped.
    const labelRects: [number, number, number, number][] = [];
    for (const c of cands) {
      const win = C.SceneTransforms.worldToWindowCoordinates(scene, c.p);
      if (!win || win.x < -40 || win.y < -40 || win.x > w + 40 || win.y > h + 40) continue;
      const size = c.sel ? 34 : Math.max(12, Math.min(44, 9e5 / Math.max(c.dist, 1)));
      const half = size / 2;
      const arm = Math.max(4, size * 0.3);
      ctx.strokeStyle = c.color;
      ctx.lineWidth = c.sel ? 2 : 1.25;
      ctx.globalAlpha = c.sel ? 1 : 0.85 * Math.max(0.12, 1 - this.labelFade * (c.dist / farthest));
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const x = win.x + sx * half;
        const y = win.y + sy * half;
        ctx.moveTo(x, y - sy * arm);
        ctx.lineTo(x, y);
        ctx.lineTo(x - sx * arm, y);
      }
      ctx.stroke();
      if (c.sel) {
        ctx.beginPath();
        ctx.moveTo(win.x - half - 10, win.y);
        ctx.lineTo(win.x - half - 3, win.y);
        ctx.moveTo(win.x + half + 3, win.y);
        ctx.lineTo(win.x + half + 10, win.y);
        ctx.stroke();
      }
      const text = `${c.label} ${c.sub}`;
      const lx = win.x - half;
      const ly = win.y - half - 3;
      const rect: [number, number, number, number] = [lx, ly - 11, lx + ctx.measureText(text).width, ly];
      const clash = labelRects.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
      if (c.sel || !clash) {
        labelRects.push(rect);
        ctx.fillStyle = c.color;
        ctx.fillText(text, lx, ly);
      }
    }
    ctx.globalAlpha = 1;
  }
}
