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
  video?: string;
  view?: string;
}

export interface CamerasFeed {
  time: number;
  provider: string;
  cameras: Camera[];
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
