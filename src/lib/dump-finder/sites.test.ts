import { describe, expect, it } from "vitest";
import { acceptedMaterials, buildQuery, classify, milesBetween, toSites, type OsmElement } from "./sites";

describe("classify", () => {
  it("reads an asphalt plant three ways", () => {
    expect(classify({ man_made: "works", product: "asphalt" })).toEqual(["millings"]);
    expect(classify({ landuse: "industrial", name: "Shelly Materials Hot Mix Plant" })).toEqual(["millings"]);
    expect(classify({ "recycling:asphalt": "yes", amenity: "recycling", recycling_type: "centre" }))
      .toEqual(["millings", "recycling"]);
  });

  it("does not call a shop named Paving Stones an asphalt plant", () => {
    expect(classify({ shop: "garden_centre", name: "Paving Stones R Us" })).toEqual([]);
  });

  it("gives a transfer station that takes rubble both kinds, concrete first", () => {
    expect(classify({ amenity: "waste_transfer_station", "recycling:rubble": "yes" }))
      .toEqual(["concrete", "transfer"]);
  });

  it("drops closed and capped landfills", () => {
    expect(classify({ landuse: "landfill" })).toEqual(["landfill"]);
    expect(classify({ landuse: "landfill", disused: "yes" })).toEqual([]);
    expect(classify({ landuse: "landfill", "landfill:status": "capped" })).toEqual([]);
  });

  it("only counts recycling centres, not street bins", () => {
    expect(classify({ amenity: "recycling", recycling_type: "container" })).toEqual([]);
    expect(classify({ amenity: "recycling", recycling_type: "centre", "recycling:scrap_metal": "yes" }))
      .toEqual(["recycling", "scrap"]);
  });
});

describe("toSites", () => {
  const origin = { lat: 40, lon: -83 };
  const els: OsmElement[] = [
    { type: "node", id: 1, lat: 40.1, lon: -83, tags: { amenity: "waste_transfer_station", name: "North TS" } },
    { type: "way", id: 2, center: { lat: 40.01, lon: -83 }, tags: { landuse: "landfill" } },
    { type: "node", id: 3, lat: 41, lon: -83, tags: { landuse: "landfill", name: "Too Far" } },
    { type: "node", id: 4, lat: 40.05, lon: -83, tags: { shop: "bakery" } },
    // A plant mapped as its yard and as a node on it.
    { type: "way", id: 5, center: { lat: 40.02, lon: -83.01 }, tags: { landuse: "industrial", name: "Valley Asphalt" } },
    { type: "node", id: 6, lat: 40.021, lon: -83.011, tags: { man_made: "works", product: "asphalt", name: "Valley Asphalt", phone: "+1 614 555 0100" } },
  ];
  const sites = toSites(els, origin.lat, origin.lon, 25);

  it("keeps what is inside the radius, nearest first", () => {
    expect(sites.map((s) => s.id)).toEqual(["osm:way/2", "osm:way/5", "osm:node/1"]);
  });

  it("names an unnamed landfill by its kind and says so", () => {
    expect(sites[0]).toMatchObject({ name: "Landfill", unnamed: true });
  });

  it("collapses a plant mapped twice and keeps the phone from either copy", () => {
    expect(sites[1].phone).toBe("+1 614 555 0100");
  });

  it("measures in miles", () => {
    expect(sites[2].distanceMi).toBeCloseTo(6.91, 1);
    expect(milesBetween(40, -83, 40, -83)).toBe(0);
  });
});

it("lists only materials marked yes", () => {
  expect(acceptedMaterials({ "recycling:green_waste": "yes", "recycling:glass": "no", "recycling:tyres": "yes" }))
    .toEqual(["green waste", "tyres"]);
});

it("builds one around-filter per clause", () => {
  const q = buildQuery(40, -83, 16093);
  expect(q).toContain('nwr["landuse"="landfill"](around:16093,40.00000,-83.00000);');
  expect(q.trim().endsWith("out center tags;")).toBe(true);
});
