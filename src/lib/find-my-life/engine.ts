// ---------------------------------------------------------------------------
// Find My Life — the pure engine. No I/O; everything here is tested.
//
// One document per account: the things you own, where each was last seen and
// how we know, the places you've named (Home, Work), and any "ring it" asks
// waiting for a device to pick them up. The server keeps it; the browser only
// ever sees its own account's copy.
// ---------------------------------------------------------------------------

import { KIND_BY_ID, type Kind, type SourceKind, type TagBrand } from "./kinds";

export const MAX_DEVICES = 60;
export const MAX_FIXES = 30;
export const MAX_PLACES = 20;
/** Location history older than this is dropped. */
export const KEEP_DAYS = 30;
/** A share link from Find My stops working after a week. */
export const SHARE_LINK_DAYS = 7;
/** Two fixes this close in time and space are the same fix (no duplicates). */
const SAME_FIX_MS = 20_000;
const SAME_FIX_M = 15;
/** Within this of a named place, you're "at" it. */
export const PLACE_RADIUS_M = 150;

export interface Fix {
  lat: number;
  lng: number;
  /** Accuracy, metres. */
  acc?: number;
  /** ISO time it was taken. */
  at: string;
  source: SourceKind;
  /** 0..1 */
  battery?: number;
  charging?: boolean;
  /** Street-level address, filled in by the server when it can. */
  address?: string;
  /** Extra detail from the source (fuel %, "doors locked"…). */
  detail?: string;
}

export interface Device {
  id: string;
  name: string;
  kind: Kind;
  tag?: TagBrand;
  /** An AirTag "Share Item Location" link the owner pasted. */
  shareLink?: { url: string; addedAt: string };
  /** The Bluetooth name the phone sees (for the disconnect Shortcut). */
  btName?: string;
  /** Smartcar vehicle id, once a car is connected. */
  carId?: string;
  /** Newest first. */
  fixes: Fix[];
  createdAt: string;
  /** Set when "Ring" is pressed; the device clears it when it rings. */
  ringAt?: string;
  ringAckAt?: string;
  /** Marked lost: shown first, in red, everywhere. */
  lost?: boolean;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface Doc {
  v: 1;
  devices: Device[];
  places: Place[];
  updatedAt: string;
}

export class FindError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function emptyDoc(now = new Date()): Doc {
  return { v: 1, devices: [], places: [], updatedAt: now.toISOString() };
}

// --- validation ------------------------------------------------------------

const KIND_IDS = new Set(Object.keys(KIND_BY_ID));
const SOURCES = new Set<SourceKind>(["self", "shortcut", "car", "disconnect", "tag-link", "manual"]);
const TAG_IDS = new Set<TagBrand>(["airtag", "tile", "smarttag", "google", "chipolo", "none"]);

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v.trim().replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function cleanName(v: unknown, fallback = ""): string {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim() : "";
  return (s || fallback).slice(0, 48);
}

function isoOr(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

/** Battery from 0..1 or 0..100 (iPhone Shortcuts gives 0..100). */
export function batteryOf(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined || n < 0) return undefined;
  const b = n > 1 ? n / 100 : n;
  return b > 1 ? undefined : Math.round(b * 100) / 100;
}

/** A clean fix, or null when the numbers aren't a real place on Earth. */
export function cleanFix(raw: unknown, source: SourceKind, now = new Date()): Fix | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lat = num(r.lat ?? r.latitude);
  const lng = num(r.lng ?? r.lon ?? r.longitude);
  if (lat === undefined || lng === undefined) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null; // the "no fix" null island
  const nowIso = now.toISOString();
  let at = isoOr(r.at, nowIso);
  if (Date.parse(at) > now.getTime() + 60_000) at = nowIso; // clocks from the future
  const fix: Fix = { lat: round6(lat), lng: round6(lng), at, source: SOURCES.has(source) ? source : "manual" };
  const acc = num(r.acc ?? r.accuracy);
  if (acc !== undefined && acc >= 0 && acc < 1_000_000) fix.acc = Math.round(acc);
  const battery = batteryOf(r.battery ?? r.b);
  if (battery !== undefined) fix.battery = battery;
  const charging = r.charging ?? r.c;
  if (charging === true || charging === "true" || charging === "1" || charging === "Yes") fix.charging = true;
  if (typeof r.address === "string" && r.address.trim()) fix.address = r.address.trim().slice(0, 140);
  if (typeof r.detail === "string" && r.detail.trim()) fix.detail = r.detail.trim().slice(0, 80);
  return fix;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Repair whatever is stored, so a bad row never breaks the page. */
export function normalizeDoc(raw: unknown, now = new Date()): Doc {
  if (!raw || typeof raw !== "object") return emptyDoc(now);
  const r = raw as Partial<Doc>;
  const seen = new Set<string>();
  const devices: Device[] = [];
  for (const d of Array.isArray(r.devices) ? r.devices : []) {
    if (!d || typeof d !== "object" || typeof d.id !== "string" || seen.has(d.id)) continue;
    seen.add(d.id);
    const kind = KIND_IDS.has(d.kind) ? d.kind : "other";
    const fixes = (Array.isArray(d.fixes) ? d.fixes : [])
      .map((f) => cleanFix({ ...f }, (f as Fix)?.source, now))
      .filter((f): f is Fix => Boolean(f))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, MAX_FIXES);
    const dev: Device = {
      id: d.id,
      name: cleanName(d.name, KIND_BY_ID[kind].label),
      kind,
      fixes,
      createdAt: isoOr(d.createdAt, now.toISOString()),
    };
    if (d.tag && TAG_IDS.has(d.tag)) dev.tag = d.tag;
    if (d.shareLink && typeof d.shareLink.url === "string" && isHttps(d.shareLink.url)) {
      dev.shareLink = { url: d.shareLink.url, addedAt: isoOr(d.shareLink.addedAt, now.toISOString()) };
    }
    if (typeof d.btName === "string" && d.btName.trim()) dev.btName = cleanName(d.btName);
    if (typeof d.carId === "string" && d.carId) dev.carId = d.carId.slice(0, 80);
    if (typeof d.ringAt === "string") dev.ringAt = isoOr(d.ringAt, now.toISOString());
    if (typeof d.ringAckAt === "string") dev.ringAckAt = isoOr(d.ringAckAt, now.toISOString());
    if (d.lost === true) dev.lost = true;
    devices.push(dev);
  }
  const places = (Array.isArray(r.places) ? r.places : [])
    .filter((p) => p && typeof p.id === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ id: p.id, name: cleanName(p.name, "Place"), lat: p.lat, lng: p.lng }))
    .slice(0, MAX_PLACES);
  return { v: 1, devices: devices.slice(0, MAX_DEVICES), places, updatedAt: isoOr(r.updatedAt, now.toISOString()) };
}

export function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Drop history older than KEEP_DAYS (a device's newest fix always stays). */
export function prune(doc: Doc, now = new Date()): Doc {
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  return {
    ...doc,
    devices: doc.devices.map((d) => ({
      ...d,
      fixes: d.fixes.filter((f, i) => i === 0 || Date.parse(f.at) >= cutoff).slice(0, MAX_FIXES),
    })),
  };
}

// --- changes ----------------------------------------------------------------

export function newId(prefix = "d"): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rand.slice(0, 16)}`;
}

function touch(doc: Doc, now: Date): Doc {
  return { ...doc, updatedAt: now.toISOString() };
}

function findDevice(doc: Doc, id: unknown): Device {
  const d = doc.devices.find((x) => x.id === id);
  if (!d) throw new FindError("That device isn't on your list any more — it may have been removed on another device.", 404);
  return d;
}

function mapDevice(doc: Doc, id: string, change: (d: Device) => Device, now: Date): Doc {
  findDevice(doc, id);
  return touch({ ...doc, devices: doc.devices.map((d) => (d.id === id ? change(d) : d)) }, now);
}

export interface NewDevice {
  id?: string;
  name?: string;
  kind?: Kind;
  tag?: TagBrand;
  btName?: string;
}

export function addDevice(doc: Doc, input: NewDevice, now = new Date()): { doc: Doc; device: Device } {
  const kind = input.kind && KIND_IDS.has(input.kind) ? input.kind : "other";
  if (doc.devices.length >= MAX_DEVICES) throw new FindError(`You can track up to ${MAX_DEVICES} things. Remove one you don't need first.`);
  const name = cleanName(input.name, KIND_BY_ID[kind].label);
  // No duplicates: the same id (the same browser registering again) returns the one that exists.
  if (input.id) {
    const existing = doc.devices.find((d) => d.id === input.id);
    if (existing) return { doc, device: existing };
  }
  const device: Device = { id: input.id && /^[a-z]_[a-z0-9]{6,32}$/i.test(input.id) ? input.id : newId(), name, kind, fixes: [], createdAt: now.toISOString() };
  if (input.tag && TAG_IDS.has(input.tag)) device.tag = input.tag;
  else if (KIND_BY_ID[kind].tagged) device.tag = "airtag";
  if (input.btName) device.btName = cleanName(input.btName);
  return { doc: touch({ ...doc, devices: [device, ...doc.devices] }, now), device };
}

export function renameDevice(doc: Doc, id: string, name: unknown, now = new Date()): Doc {
  const clean = cleanName(name);
  if (!clean) throw new FindError("Give it a name.");
  return mapDevice(doc, id, (d) => ({ ...d, name: clean }), now);
}

export function removeDevice(doc: Doc, id: string, now = new Date()): Doc {
  findDevice(doc, id);
  return touch({ ...doc, devices: doc.devices.filter((d) => d.id !== id) }, now);
}

export function setTag(doc: Doc, id: string, tag: unknown, now = new Date()): Doc {
  if (!TAG_IDS.has(tag as TagBrand)) throw new FindError("Pick a tag from the list.");
  return mapDevice(doc, id, (d) => ({ ...d, tag: tag as TagBrand }), now);
}

export function setBtName(doc: Doc, id: string, btName: unknown, now = new Date()): Doc {
  return mapDevice(doc, id, (d) => ({ ...d, btName: cleanName(btName) || undefined }), now);
}

export function setShareLink(doc: Doc, id: string, url: unknown, now = new Date()): Doc {
  if (url === null || url === "") return mapDevice(doc, id, (d) => ({ ...d, shareLink: undefined }), now);
  const s = typeof url === "string" ? url.trim() : "";
  const found = s.match(/https:\/\/\S+/)?.[0]?.replace(/[)\].,]+$/, "") ?? "";
  if (!found || !isHttps(found) || found.length > 600) throw new FindError("Paste the link from Find My › your item › Share Item Location. It starts with https://");
  return mapDevice(doc, id, (d) => ({ ...d, shareLink: { url: found, addedAt: now.toISOString() } }), now);
}

export function setLost(doc: Doc, id: string, lost: boolean, now = new Date()): Doc {
  return mapDevice(doc, id, (d) => ({ ...d, lost: lost || undefined }), now);
}

export function setCar(doc: Doc, id: string, carId: string | undefined, now = new Date()): Doc {
  return mapDevice(doc, id, (d) => ({ ...d, carId }), now);
}

/**
 * Add where a device was seen. A fix that repeats the newest one (same spot
 * within 20 s) replaces it instead of piling up — the same ping sent twice is
 * one ping.
 */
export function addFix(doc: Doc, id: string, fix: Fix, now = new Date()): Doc {
  return mapDevice(
    doc,
    id,
    (d) => {
      const top = d.fixes[0];
      let rest = d.fixes;
      if (top && Math.abs(Date.parse(fix.at) - Date.parse(top.at)) < SAME_FIX_MS && distanceM(top, fix) < SAME_FIX_M) {
        rest = d.fixes.slice(1);
        fix = { ...top, ...fix, address: fix.address ?? top.address };
      }
      const fixes = [fix, ...rest].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_FIXES);
      return { ...d, fixes };
    },
    now,
  );
}

export function ring(doc: Doc, id: string, now = new Date()): Doc {
  return mapDevice(doc, id, (d) => ({ ...d, ringAt: now.toISOString() }), now);
}

export function ackRing(doc: Doc, id: string, now = new Date()): Doc {
  return mapDevice(doc, id, (d) => ({ ...d, ringAckAt: now.toISOString() }), now);
}

/** Is a ring waiting for this device? Asks older than 10 minutes are ignored. */
export function ringPending(d: Device, now = new Date()): boolean {
  if (!d.ringAt) return false;
  const at = Date.parse(d.ringAt);
  if (now.getTime() - at > 10 * 60_000) return false;
  return !d.ringAckAt || Date.parse(d.ringAckAt) < at;
}

export function savePlace(doc: Doc, input: { name?: unknown; lat?: unknown; lng?: unknown }, now = new Date()): Doc {
  const name = cleanName(input.name);
  const lat = num(input.lat);
  const lng = num(input.lng);
  if (!name) throw new FindError("Name the place — Home, Work, Gym…");
  if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new FindError("That spot isn't a real location.");
  // One place per name, and one name per spot: saving "Home" again moves it.
  const places = doc.places.filter((p) => p.name.toLowerCase() !== name.toLowerCase() && distanceM(p, { lat, lng }) > 25);
  if (places.length >= MAX_PLACES) throw new FindError(`Up to ${MAX_PLACES} places. Remove one first.`);
  return touch({ ...doc, places: [{ id: newId("p"), name, lat: round6(lat), lng: round6(lng) }, ...places] }, now);
}

export function removePlace(doc: Doc, id: string, now = new Date()): Doc {
  return touch({ ...doc, places: doc.places.filter((p) => p.id !== id) }, now);
}

// --- reading ----------------------------------------------------------------

export type Freshness = "live" | "recent" | "today" | "old" | "never";

export function ageMs(fix: Fix | undefined, now = new Date()): number {
  return fix ? Math.max(0, now.getTime() - Date.parse(fix.at)) : Infinity;
}

export function freshness(fix: Fix | undefined, now = new Date()): Freshness {
  const a = ageMs(fix, now);
  if (a === Infinity) return "never";
  if (a < 5 * 60_000) return "live";
  if (a < 60 * 60_000) return "recent";
  if (a < 24 * 60 * 60_000) return "today";
  return "old";
}

/**
 * The location to trust. The newest fix wins — unless it is much rougher than
 * a slightly older one (a 3 km cell-tower guess right after a 10 m GPS fix).
 */
export function bestFix(d: Device): Fix | undefined {
  const [a, b] = d.fixes;
  if (!a) return undefined;
  if (b && a.acc !== undefined && b.acc !== undefined && a.acc > 1000 && b.acc < 100 && Date.parse(a.at) - Date.parse(b.at) < 10 * 60_000 && distanceM(a, b) < a.acc) {
    return b;
  }
  return a;
}

export function ago(fix: Fix | undefined, now = new Date()): string {
  const a = ageMs(fix, now);
  if (a === Infinity) return "never";
  const s = Math.round(a / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compass(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

/** US-friendly distance: feet up close, miles after that. */
export function distanceText(m: number): string {
  if (!Number.isFinite(m)) return "—";
  const ft = m * 3.28084;
  if (ft < 30) return "right here";
  if (ft < 1000) return `${Math.round(ft / 10) * 10} ft`;
  const mi = m / 1609.344;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi).toLocaleString("en-US")} mi`;
}

/** Radar rings, metres: 100 ft, ¼ mi, 2 mi, 25 mi, 500 mi. */
export const RINGS_M = [30, 402, 3219, 40_234, 804_672];
export const RING_LABELS = ["100 ft", "¼ mi", "2 mi", "25 mi", "500 mi"];

/**
 * Where a distance sits on the radar, 0 (centre) to 1 (rim). Log scale so the
 * keys in the next room and the car across town are both readable; anything
 * past the last ring rides the rim.
 */
export function radarRadius(m: number): number {
  if (!Number.isFinite(m) || m <= 0) return 0;
  const lo = Math.log10(5);
  const hi = Math.log10(RINGS_M[RINGS_M.length - 1]);
  const r = (Math.log10(Math.max(5, m)) - lo) / (hi - lo);
  return Math.max(0.06, Math.min(1, r));
}

export function ringRadius(i: number): number {
  return radarRadius(RINGS_M[i]);
}

/** "Home", or the nearest named place within PLACE_RADIUS_M. */
export function placeFor(doc: Pick<Doc, "places">, at: { lat: number; lng: number }): Place | undefined {
  let best: Place | undefined;
  let bestD = Infinity;
  for (const p of doc.places) {
    const d = distanceM(p, at);
    if (d <= PLACE_RADIUS_M && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** The one line that says where it is, in words. */
export function whereText(doc: Pick<Doc, "places">, fix: Fix | undefined): string {
  if (!fix) return "Not located yet";
  const p = placeFor(doc, fix);
  if (p) return `At ${p.name}`;
  if (fix.address) return fix.address;
  return `${fix.lat.toFixed(4)}, ${fix.lng.toFixed(4)}`;
}

export function shareLinkLeftMs(d: Device, now = new Date()): number {
  if (!d.shareLink) return 0;
  return Math.max(0, Date.parse(d.shareLink.addedAt) + SHARE_LINK_DAYS * 86_400_000 - now.getTime());
}

/** Lost first, then the freshest, then the rest by name. */
export function sortDevices(devs: Device[]): Device[] {
  return [...devs].sort((a, b) => {
    if (Boolean(a.lost) !== Boolean(b.lost)) return a.lost ? -1 : 1;
    const fa = bestFix(a);
    const fb = bestFix(b);
    if (Boolean(fa) !== Boolean(fb)) return fa ? -1 : 1;
    if (fa && fb && fa.at !== fb.at) return Date.parse(fb.at) - Date.parse(fa.at);
    return a.name.localeCompare(b.name);
  });
}

/** The headline the widget leads with: are things where they should be? */
export function summary(doc: Doc, now = new Date()): { located: number; total: number; lost: number; lowBattery: Device[]; line: string } {
  const total = doc.devices.length;
  const located = doc.devices.filter((d) => bestFix(d)).length;
  const lost = doc.devices.filter((d) => d.lost).length;
  const lowBattery = doc.devices.filter((d) => {
    const f = d.fixes[0];
    return f && f.battery !== undefined && f.battery <= 0.2 && !f.charging && freshness(f, now) !== "old";
  });
  let line: string;
  if (!total) line = "Add your phone, laptop, car, keys — see them all here.";
  else if (lost) line = `${lost} marked lost`;
  else if (located === total) line = `All ${total} accounted for`;
  else line = `${located} of ${total} located`;
  return { located, total, lost, lowBattery, line };
}

// --- the background ping (iPhone Shortcuts) ---------------------------------

export type PingEvent = "ping" | "disconnect" | "parked";

/**
 * Read a ping from a Shortcut. It may come as query params (a plain GET URL is
 * the easiest Shortcut to build) or as a JSON / form body. Shortcuts sometimes
 * sends "42.1" with a comma decimal on non-US phones; num() takes both.
 */
export function readPing(query: Record<string, string>, body: unknown, now = new Date()): { deviceId: string; event: PingEvent; fix: Fix | null } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const pick = (k: string) => (b[k] !== undefined ? b[k] : query[k]);
  const deviceId = String(pick("d") ?? pick("device") ?? "").slice(0, 40);
  const ev = String(pick("e") ?? pick("event") ?? "ping");
  const event: PingEvent = ev === "disconnect" || ev === "parked" ? ev : "ping";
  const source: SourceKind = event === "ping" ? "shortcut" : "disconnect";
  const fix = cleanFix(
    {
      lat: pick("lat") ?? pick("latitude"),
      lng: pick("lng") ?? pick("lon") ?? pick("longitude"),
      acc: pick("acc"),
      b: pick("b") ?? pick("battery"),
      c: pick("c") ?? pick("charging"),
      detail: event === "parked" ? "Parked here" : event === "disconnect" ? "Disconnected from your phone here" : undefined,
    },
    source,
    now,
  );
  return { deviceId, event, fix };
}

/** The URL a Shortcut calls for one device — Shortcuts fills in the [brackets]. */
export function pingUrl(origin: string, key: string, deviceId: string, event: PingEvent = "ping"): string {
  const e = event === "ping" ? "" : `&e=${event}`;
  return `${origin}/api/find-my-life/ping?k=${key}&d=${deviceId}${e}&lat=[Latitude]&lng=[Longitude]&b=[Battery Level]`;
}
