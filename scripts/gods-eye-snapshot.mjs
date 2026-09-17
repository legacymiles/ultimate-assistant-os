// Rebuilds God's Eye View's static infrastructure layers:
//   public/gods-eye/datacenters.json  (OpenStreetMap telecom=data_center, via Overpass)
//   public/gods-eye/dams.json         (Wikidata dams with coordinates)
//
// Both sources take 30–90 s to answer a worldwide query — far past a Vercel
// function's budget — and the facilities barely change, so they ship as files.
//
//   node scripts/gods-eye-snapshot.mjs
//
// Data: © OpenStreetMap contributors (ODbL); Wikidata (CC0).
import { mkdir, writeFile } from "node:fs/promises";

const UA = "ultimate-assistant-os/gods-eye-view snapshot (+https://ultimate-assistant-os.vercel.app)";
const OUT = new URL("../public/gods-eye/", import.meta.url);
const r4 = (n) => Math.round(n * 1e4) / 1e4;

async function datacenters() {
  const query = '[out:json][timeout:180];nwr["telecom"="data_center"];out center tags;';
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
  const { elements } = await res.json();
  const rows = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const t = e.tags ?? {};
    // Towers tagged as data centres are nearly always telecom masts, not facilities.
    if (lat == null || lon == null || t.man_made === "tower" || t.man_made === "mast") continue;
    const name = t.name || t.operator || "";
    if (!name) continue;
    // [id, name, lat, lon, operator, city/country]
    rows.push([
      `${e.type[0]}${e.id}`,
      name,
      r4(lat),
      r4(lon),
      t.operator && t.operator !== name ? t.operator : "",
      [t["addr:city"], t["addr:country"]].filter(Boolean).join(", "),
    ]);
  }
  return rows;
}

async function dams() {
  const query = `SELECT ?d ?dLabel ?lat ?lon ?cap ?height ?countryLabel WHERE {
    ?d wdt:P31 wd:Q12323; p:P625/psv:P625 [wikibase:geoLatitude ?lat; wikibase:geoLongitude ?lon].
    OPTIONAL { ?d wdt:P2109 ?cap } OPTIONAL { ?d wdt:P2048 ?height } OPTIONAL { ?d wdt:P17 ?country }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
  const { results } = await res.json();
  const byId = new Map();
  for (const b of results.bindings) {
    const id = b.d.value.split("/").pop();
    const name = b.dLabel?.value ?? "";
    if (!name || name === id) continue;
    const cap = b.cap ? Number(b.cap.value) : 0;
    const height = b.height ? Number(b.height.value) : 0;
    // Named dams that are tall (≥ 15 m) or generate power: the ones worth a pin.
    if (height < 15 && !cap) continue;
    const prev = byId.get(id);
    if (prev) {
      prev[4] = Math.max(prev[4], Math.round(cap));
      prev[5] = Math.max(prev[5], Math.round(height));
      continue;
    }
    // [id, name, lat, lon, capacityMW, heightM, country]
    byId.set(id, [id, name, r4(Number(b.lat.value)), r4(Number(b.lon.value)), Math.round(cap), Math.round(height), b.countryLabel?.value ?? ""]);
  }
  return [...byId.values()];
}

await mkdir(OUT, { recursive: true });
for (const [name, load] of [["datacenters", datacenters], ["dams", dams]]) {
  const rows = await load();
  const body = JSON.stringify({ time: Date.now(), rows });
  await writeFile(new URL(`${name}.json`, OUT), body);
  console.log(`${name}: ${rows.length} rows, ${(body.length / 1024).toFixed(0)} KB`);
}
