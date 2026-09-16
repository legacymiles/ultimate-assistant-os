// Small, dependency-free geo helpers for God's Eye View. Pure so they can be tested.

export const toRad = (deg: number) => (deg * Math.PI) / 180;
export const toDeg = (rad: number) => (rad * 180) / Math.PI;

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle destination after travelling `meters` along `trackDeg` from lon/lat. Returns [lon, lat]. */
export function deadReckon(lon: number, lat: number, meters: number, trackDeg: number): [number, number] {
  const d = meters / EARTH_RADIUS_M;
  const brg = toRad(trackDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(brg));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(phi1), Math.cos(d) - Math.sin(phi1) * Math.sin(phi2));
  return [((toDeg(lambda2) + 540) % 360) - 180, toDeg(phi2)];
}

/** Approximate solar elevation and azimuth (degrees) for a place and instant. Good to ~1°. */
export function sunPosition(date: Date, lat: number, lon: number): { el: number; az: number } {
  const d = date.getTime() / 86_400_000 - 10_957.5; // days since J2000.0
  const g = toRad(357.529 + 0.98560028 * d);
  const q = 280.459 + 0.98564736 * d;
  const L = toRad(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const e = toRad(23.439 - 0.00000036 * d);
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmstHours = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = toRad(gmstHours * 15 + lon) - ra;
  const phi = toRad(lat);
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { el: toDeg(el), az: (toDeg(az) + 360) % 360 };
}

/** Ground sample distance (m/px) for a nadir-ish view from `heightM` with vertical FOV `fovyRad`. */
export function estimateGsd(heightM: number, fovyRad: number, viewportPx: number): number {
  return (2 * Math.max(heightM, 1) * Math.tan(fovyRad / 2)) / Math.max(viewportPx, 1);
}

/** NIIRS from GSD with the simplified GIQE (image quality terms held constant). */
export function niirsFromGsd(gsdM: number): number {
  const inches = Math.max(gsdM * 39.3701, 0.01);
  return Math.min(9.9, Math.max(0, 10.251 - 3.32 * Math.log10(inches)));
}

/** Insert points so no segment of a lon/lat line spans more than `maxStepDeg` — keeps long lines off the globe's chord. */
export function densifyLine(line: [number, number][], maxStepDeg = 1): [number, number][] {
  if (line.length < 2) return line;
  const out: [number, number][] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [lon0, lat0] = line[i - 1];
    const [lon1, lat1] = line[i];
    const steps = Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / maxStepDeg);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push([lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t]);
    }
    out.push(line[i]);
  }
  return out;
}

export const formatLat = (lat: number) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}`;
export const formatLon = (lon: number) => `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}`;

export function formatAltitude(m: number): string {
  if (m >= 100_000) return `${Math.round(m / 1000).toLocaleString("en-US")} KM`;
  if (m >= 10_000) return `${(m / 1000).toFixed(1)} KM`;
  return `${Math.round(m).toLocaleString("en-US")} M`;
}

export function formatAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/** Decorative "orbit / pass" counters for the HUD, stable for a given minute. */
export function orbitStamp(date: Date): { orbit: number; pass: string } {
  const minutes = Math.floor(date.getTime() / 60_000);
  const orbit = 40_000 + (Math.floor(minutes / 93) % 60_000);
  const ascending = Math.floor(minutes / 46) % 2 === 0;
  return { orbit, pass: `${ascending ? "ASC" : "DESC"}-${String(minutes % 997).padStart(3, "0")}` };
}
