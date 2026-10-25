import { describe, expect, it } from "vitest";
import {
  addDevice,
  addFix,
  ackRing,
  ago,
  bearingDeg,
  bestFix,
  batteryOf,
  cleanFix,
  distanceM,
  distanceText,
  emptyDoc,
  FindError,
  freshness,
  normalizeDoc,
  prune,
  radarRadius,
  readPing,
  removeDevice,
  ring,
  ringPending,
  savePlace,
  setShareLink,
  shareLinkLeftMs,
  sortDevices,
  summary,
  whereText,
  type Fix,
} from "./engine";

const NOW = new Date("2026-10-25T21:00:00Z");
const COLUMBUS = { lat: 39.9612, lng: -82.9988 };
const fix = (over: Partial<Fix> = {}): Fix => ({ lat: COLUMBUS.lat, lng: COLUMBUS.lng, at: NOW.toISOString(), source: "self", ...over });

describe("cleanFix", () => {
  it("accepts lat/lng and the long names, rejects junk", () => {
    expect(cleanFix({ lat: 39.96, lng: -82.99 }, "self", NOW)).toMatchObject({ lat: 39.96, lng: -82.99 });
    expect(cleanFix({ latitude: "39,96", longitude: "-82.99" }, "shortcut", NOW)?.lat).toBe(39.96);
    expect(cleanFix({ lat: 91, lng: 0 }, "self", NOW)).toBeNull();
    expect(cleanFix({ lat: 0, lng: 0 }, "self", NOW)).toBeNull();
    expect(cleanFix({ lat: "[Latitude]", lng: "x" }, "self", NOW)).toBeNull();
    expect(cleanFix(null, "self", NOW)).toBeNull();
  });
  it("never trusts a time from the future", () => {
    const f = cleanFix({ lat: 1, lng: 1, at: "2030-01-01T00:00:00Z" }, "self", NOW);
    expect(f?.at).toBe(NOW.toISOString());
  });
  it("reads battery as 0..1 from either scale", () => {
    expect(batteryOf(87)).toBe(0.87);
    expect(batteryOf("0.5")).toBe(0.5);
    expect(batteryOf(-3)).toBeUndefined();
    expect(batteryOf(250)).toBeUndefined();
  });
});

describe("devices", () => {
  it("adds newest first, defaults a tag for tagged kinds, and never duplicates a registered id", () => {
    let doc = emptyDoc(NOW);
    const a = addDevice(doc, { kind: "phone", name: "My iPhone", id: "d_abcdef123456" }, NOW);
    doc = a.doc;
    const b = addDevice(doc, { kind: "keys" }, NOW);
    doc = b.doc;
    expect(doc.devices.map((d) => d.name)).toEqual(["Keys", "My iPhone"]);
    expect(b.device.tag).toBe("airtag");
    const again = addDevice(doc, { kind: "phone", id: "d_abcdef123456" }, NOW);
    expect(again.doc.devices).toHaveLength(2);
    expect(again.device.id).toBe("d_abcdef123456");
  });
  it("removing an unknown device says so in plain words", () => {
    expect(() => removeDevice(emptyDoc(NOW), "nope", NOW)).toThrow(FindError);
  });
});

describe("addFix", () => {
  it("treats the same ping twice as one, and keeps history newest first", () => {
    let { doc, device } = addDevice(emptyDoc(NOW), { kind: "phone" }, NOW);
    doc = addFix(doc, device.id, fix({ at: "2026-10-25T20:00:00Z" }), NOW);
    doc = addFix(doc, device.id, fix({ at: "2026-10-25T20:00:10Z", battery: 0.5 }), NOW);
    expect(doc.devices[0].fixes).toHaveLength(1);
    expect(doc.devices[0].fixes[0].battery).toBe(0.5);
    doc = addFix(doc, device.id, fix({ at: "2026-10-25T20:30:00Z", lat: 39.97 }), NOW);
    expect(doc.devices[0].fixes.map((f) => f.at)).toEqual(["2026-10-25T20:30:00Z", "2026-10-25T20:00:10Z"]);
  });
  it("prefers a sharp GPS fix over a rough guess right after it", () => {
    const d = {
      id: "x",
      name: "x",
      kind: "phone" as const,
      createdAt: NOW.toISOString(),
      fixes: [fix({ at: "2026-10-25T20:05:00Z", acc: 3000, lat: 39.965 }), fix({ at: "2026-10-25T20:00:00Z", acc: 10 })],
    };
    expect(bestFix(d)?.acc).toBe(10);
  });
});

describe("prune", () => {
  it("drops history older than 30 days but keeps the latest spot", () => {
    let { doc, device } = addDevice(emptyDoc(NOW), { kind: "car" }, NOW);
    doc = addFix(doc, device.id, fix({ at: "2026-08-01T00:00:00Z" }), NOW);
    doc = addFix(doc, device.id, fix({ at: "2026-07-01T00:00:00Z", lat: 40 }), NOW);
    const out = prune(doc, NOW);
    expect(out.devices[0].fixes).toHaveLength(1);
  });
});

describe("normalizeDoc", () => {
  it("repairs bad rows instead of breaking the page", () => {
    const doc = normalizeDoc(
      {
        devices: [
          { id: "a", name: "<b>Phone</b>", kind: "spaceship", fixes: [{ lat: 1, lng: 1, at: "2026-10-01T00:00:00Z", source: "self" }, { lat: 999 }] },
          { id: "a", name: "dupe", kind: "phone", fixes: [] },
          { nope: true },
        ],
        places: [{ id: "p", name: "Home", lat: 1, lng: 1 }, { id: "q", name: "bad", lat: "x" }],
      },
      NOW,
    );
    expect(doc.devices).toHaveLength(1);
    expect(doc.devices[0].kind).toBe("other");
    expect(doc.devices[0].name).toBe("bPhone/b");
    expect(doc.devices[0].fixes).toHaveLength(1);
    expect(doc.places).toHaveLength(1);
    expect(normalizeDoc("garbage", NOW).devices).toEqual([]);
  });
});

describe("rings", () => {
  it("is pending until the device answers, and expires after 10 minutes", () => {
    let { doc, device } = addDevice(emptyDoc(NOW), { kind: "laptop" }, NOW);
    doc = ring(doc, device.id, NOW);
    expect(ringPending(doc.devices[0], NOW)).toBe(true);
    expect(ringPending(doc.devices[0], new Date(NOW.getTime() + 11 * 60_000))).toBe(false);
    doc = ackRing(doc, device.id, new Date(NOW.getTime() + 1000));
    expect(ringPending(doc.devices[0], NOW)).toBe(false);
  });
});

describe("places", () => {
  it("names where a thing is when it's at a saved place", () => {
    let doc = savePlace(emptyDoc(NOW), { name: "Home", ...COLUMBUS }, NOW);
    expect(whereText(doc, fix({ lat: COLUMBUS.lat + 0.0005 }))).toBe("At Home");
    expect(whereText(doc, fix({ lat: 40.5, address: "1 Main St" }))).toBe("1 Main St");
    doc = savePlace(doc, { name: "home", lat: 40, lng: -83 }, NOW);
    expect(doc.places).toHaveLength(1);
    expect(() => savePlace(doc, { name: "", lat: 1, lng: 1 }, NOW)).toThrow(FindError);
  });
});

describe("share links", () => {
  it("finds the link inside pasted text and counts down 7 days", () => {
    let { doc, device } = addDevice(emptyDoc(NOW), { kind: "keys" }, NOW);
    doc = setShareLink(doc, device.id, "Track my Keys: https://example.com/item/abc123.", NOW);
    expect(doc.devices[0].shareLink?.url).toBe("https://example.com/item/abc123");
    expect(shareLinkLeftMs(doc.devices[0], NOW)).toBe(7 * 86_400_000);
    expect(() => setShareLink(doc, device.id, "http://insecure.example", NOW)).toThrow(FindError);
    expect(setShareLink(doc, device.id, null, NOW).devices[0].shareLink).toBeUndefined();
  });
});

describe("geometry", () => {
  it("measures distance and bearing", () => {
    const cincy = { lat: 39.1031, lng: -84.512 };
    expect(distanceM(COLUMBUS, cincy) / 1609.344).toBeGreaterThan(95);
    expect(distanceM(COLUMBUS, cincy) / 1609.344).toBeLessThan(105);
    const b = bearingDeg(COLUMBUS, cincy);
    expect(b).toBeGreaterThan(220);
    expect(b).toBeLessThan(240);
  });
  it("speaks distance the US way", () => {
    expect(distanceText(5)).toBe("right here");
    expect(distanceText(100)).toBe("330 ft");
    expect(distanceText(5000)).toBe("3.1 mi");
    expect(distanceText(200_000)).toBe("124 mi");
  });
  it("places things on a log radar, nearest inside, far ones on the rim", () => {
    expect(radarRadius(10)).toBeLessThan(radarRadius(1000));
    expect(radarRadius(5_000_000)).toBe(1);
    expect(radarRadius(0)).toBe(0);
  });
});

describe("reading", () => {
  it("rates freshness and age", () => {
    expect(freshness(fix(), NOW)).toBe("live");
    expect(freshness(fix({ at: "2026-10-25T20:30:00Z" }), NOW)).toBe("recent");
    expect(freshness(undefined, NOW)).toBe("never");
    expect(ago(fix({ at: "2026-10-25T19:00:00Z" }), NOW)).toBe("2 hr ago");
  });
  it("puts lost things first, then the freshest", () => {
    let doc = emptyDoc(NOW);
    const a = addDevice(doc, { kind: "phone", name: "A" }, NOW);
    const b = addDevice(a.doc, { kind: "keys", name: "B" }, NOW);
    const c = addDevice(b.doc, { kind: "car", name: "C" }, NOW);
    doc = addFix(c.doc, a.device.id, fix(), NOW);
    doc = { ...doc, devices: doc.devices.map((d) => (d.id === c.device.id ? { ...d, lost: true } : d)) };
    expect(sortDevices(doc.devices).map((d) => d.name)).toEqual(["C", "A", "B"]);
    expect(summary(doc, NOW).line).toBe("1 marked lost");
  });
  it("flags low batteries", () => {
    let { doc, device } = addDevice(emptyDoc(NOW), { kind: "phone" }, NOW);
    doc = addFix(doc, device.id, fix({ battery: 0.12 }), NOW);
    const s = summary(doc, NOW);
    expect(s.lowBattery).toHaveLength(1);
    expect(s.line).toBe("All 1 accounted for");
  });
});

describe("readPing", () => {
  it("reads a GET-style Shortcut ping", () => {
    const p = readPing({ d: "d_abc", lat: "39.96", lng: "-82.99", b: "54" }, null, NOW);
    expect(p).toMatchObject({ deviceId: "d_abc", event: "ping" });
    expect(p.fix).toMatchObject({ source: "shortcut", battery: 0.54 });
  });
  it("reads a JSON disconnect ping and labels it", () => {
    const p = readPing({ d: "d_glasses" }, { e: "disconnect", latitude: 39.9, longitude: -83 }, NOW);
    expect(p.event).toBe("disconnect");
    expect(p.fix).toMatchObject({ source: "disconnect", detail: "Disconnected from your phone here" });
  });
  it("leaves the fix null when Shortcuts didn't fill in a location", () => {
    expect(readPing({ d: "x", lat: "[Latitude]", lng: "[Longitude]" }, null, NOW).fix).toBeNull();
  });
});
