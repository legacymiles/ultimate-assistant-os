import { describe, expect, it } from "vitest";
import { deadReckon, densifyLine, niirsFromGsd, rangeBearing, sunPosition } from "./geo";

describe("deadReckon", () => {
  it("moves ~111 km north per degree of latitude", () => {
    const [lon, lat] = deadReckon(0, 0, 111_195, 0);
    expect(lon).toBeCloseTo(0, 5);
    expect(lat).toBeCloseTo(1, 2);
  });

  it("wraps across the antimeridian", () => {
    const [lon] = deadReckon(179.9, 0, 50_000, 90);
    expect(lon).toBeLessThan(-179);
  });
});

describe("sunPosition", () => {
  it("puts the sun near the zenith at the subsolar point on the equinox", () => {
    const { el } = sunPosition(new Date("2026-03-20T12:07:00Z"), 0, 0);
    expect(el).toBeGreaterThan(85);
  });

  it("puts the sun below the horizon at local midnight", () => {
    const { el } = sunPosition(new Date("2026-06-21T00:00:00Z"), 51.5, 0);
    expect(el).toBeLessThan(0);
  });
});

describe("niirsFromGsd", () => {
  it("rates finer ground sample distance higher", () => {
    expect(niirsFromGsd(0.3)).toBeGreaterThan(niirsFromGsd(1));
    expect(niirsFromGsd(1)).toBeCloseTo(4.97, 1);
  });
});

describe("densifyLine", () => {
  it("splits long segments into ≤1° steps", () => {
    const out = densifyLine([
      [0, 0],
      [10, 0],
    ]);
    expect(out).toHaveLength(11);
    expect(out[5]).toEqual([5, 0]);
  });
});

describe("rangeBearing", () => {
  it("measures a degree of latitude due north", () => {
    const { km, bearing } = rangeBearing(0, 0, 1, 0);
    expect(km).toBeCloseTo(111.2, 0);
    expect(bearing).toBeCloseTo(0, 5);
  });

  it("points east along the equator", () => {
    expect(rangeBearing(0, 10, 0, 11).bearing).toBeCloseTo(90, 5);
  });

  it("round-trips with deadReckon", () => {
    const [lon, lat] = deadReckon(-84.43, 33.64, 80_000, 237);
    const { km, bearing } = rangeBearing(33.64, -84.43, lat, lon);
    expect(km).toBeCloseTo(80, 1);
    expect(bearing).toBeCloseTo(237, 1);
  });
});
