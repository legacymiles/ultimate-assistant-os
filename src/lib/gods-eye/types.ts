// Shapes shared by the God's Eye View feed proxy and the globe client.
// Arrays instead of objects where a feed carries thousands of rows.

/** [hex, callsign, origin, lon, lat, altitudeM, onGround(0|1), speedMs, trackDeg, vertRateMs, squawk, type] */
export type AircraftRow = [
  string,
  string,
  string,
  number,
  number,
  number,
  0 | 1,
  number,
  number,
  number,
  string,
  string,
];

export interface FlightsFeed {
  source: "opensky" | "adsb.lol";
  time: number;
  aircraft: AircraftRow[];
  stale?: boolean;
}

/** [name, tleLine1, tleLine2] */
export type TleRow = [string, string, string];

export interface SatellitesFeed {
  time: number;
  sats: TleRow[];
  /** Which CelesTrak file(s) the set came from. */
  source?: string;
  /** True when stitched from smaller groups because the full catalog was refused. */
  partial?: boolean;
  stale?: boolean;
}

export interface Quake {
  id: string;
  mag: number;
  place: string;
  time: number;
  lon: number;
  lat: number;
  depthKm: number;
  url: string;
}

export interface QuakesFeed {
  time: number;
  quakes: Quake[];
  stale?: boolean;
}

export interface Camera {
  id: string;
  name: string;
  lon: number;
  lat: number;
  image: string;
  /** An mp4 clip the browser can play natively (HLS streams are left out). */
  video?: string;
  view?: string;
  /** The agency or network that publishes this camera. */
  source?: string;
}

export interface CameraNetworkStatus {
  id: string;
  label: string;
  count: number;
  state: "live" | "stale" | "error" | "loading";
  error?: string;
}

export interface CamerasFeed {
  time: number;
  provider: string;
  cameras: Camera[];
  networks?: CameraNetworkStatus[];
  /** Whether the server has a Windy webcams key for worldwide coverage. */
  windy?: boolean;
  stale?: boolean;
}

export interface Cable {
  name: string;
  color: string;
  /** One or more line strings of [lon, lat]. */
  lines: [number, number][][];
}

export interface CablesFeed {
  time: number;
  cables: Cable[];
  stale?: boolean;
}

export interface Place {
  name: string;
  detail: string;
  lon: number;
  lat: number;
  /** [west, south, east, north] when the geocoder has an extent. */
  extent?: [number, number, number, number];
}

export interface SearchFeed {
  places: Place[];
}

/** A generic pin for the simpler point layers (launches, fires, vessels, datacenters, dams). */
export interface Poi {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Short line under the title in the context card. */
  sub: string;
  fields: [string, string][];
  link?: { href: string; label: string };
  image?: string;
  /** Degrees clockwise from north, for pins that point (ships). */
  heading?: number;
  /** Relative marker size, 0–1. */
  weight?: number;
  /** Epoch ms the item refers to (launch time, detection time). */
  when?: number;
  /** Speed over ground, knots (vessels). */
  speedKts?: number;
}

export interface PoiFeed {
  time: number;
  items: Poi[];
  note?: string;
  /** Set when the layer needs a server env var that isn't configured. */
  needsKey?: string;
  stale?: boolean;
}
