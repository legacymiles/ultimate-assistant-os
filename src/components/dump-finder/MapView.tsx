"use client";

// ---------------------------------------------------------------------------
// The map half of Dump Finder: Leaflet over OpenStreetMap (or Esri imagery,
// which is how you see whether a plant has a millings pile and a way in for a
// tri-axle), the search radius drawn as a ring, and one lettered pin per site.
//
// Leaflet touches `window` at import, so it is loaded inside the effect rather
// than at the top of the file — the page still renders on the server.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { KIND_BY_ID } from "@/lib/dump-finder/kinds";
import { METERS_PER_MILE, type Site } from "@/lib/dump-finder/sites";
import type { Place } from "@/lib/dump-finder/store";

const TILES = {
  map: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
} as const;

/** Middle of the lower 48, for the first open before anyone has a location. */
const US_CENTER: [number, number] = [39.5, -98.35];

export interface MapViewProps {
  place: Place | null;
  radiusMi: number;
  sites: Site[];
  selectedId: string | null;
  layer: "map" | "satellite";
  /** True while the owner is choosing where a new spot goes. */
  placing: boolean;
  onSelect: (id: string) => void;
  onPlace: (lat: number, lon: number) => void;
  /** Fires after the map stops moving, with its centre. */
  onMoved: (lat: number, lon: number) => void;
}

function pinHtml(site: Site, selected: boolean): string {
  const k = KIND_BY_ID[site.kinds[0]];
  const mine = site.id.startsWith("mine:");
  const more = site.kinds.length > 1 ? `<i class="df-pin-more">+${site.kinds.length - 1}</i>` : "";
  return `<span class="df-pin${selected ? " is-selected" : ""}${mine ? " is-mine" : ""}" style="--c:${k.color};--i:${k.ink}">${k.glyph}${more}</span>`;
}

export function MapView(props: MapViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const tiles = useRef<Leaflet.TileLayer | null>(null);
  const ring = useRef<Leaflet.Circle | null>(null);
  const you = useRef<Leaflet.Marker | null>(null);
  const pins = useRef<Leaflet.LayerGroup | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  // Callbacks change every render; the map's own listeners read the latest.
  const latest = useRef(props);
  latest.current = props;
  const ready = useRef(false);
  const fitFor = useRef("");

  // --- create the map once ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mod = await import("leaflet");
      if (cancelled || !host.current || map.current) return;
      const lib = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as typeof Leaflet);
      L.current = lib;
      const m = lib.map(host.current, { zoomControl: false, worldCopyJump: true }).setView(US_CENTER, 4);
      lib.control.zoom({ position: "topright" }).addTo(m);
      lib.control.scale({ position: "bottomright", imperial: true, metric: false }).addTo(m);
      pins.current = lib.layerGroup().addTo(m);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => {
        if (latest.current.placing) latest.current.onPlace(e.latlng.lat, e.latlng.lng);
      });
      m.on("moveend", () => {
        const c = m.getCenter();
        latest.current.onMoved(c.lat, c.lng);
      });
      map.current = m;
      ready.current = true;
      // Draw whatever state arrived while Leaflet was loading.
      syncAll();
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      ready.current = false;
      markers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncTiles() {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    const t = TILES[latest.current.layer];
    if (tiles.current && (tiles.current as unknown as { _url: string })._url === t.url) return;
    tiles.current?.remove();
    tiles.current = lib.tileLayer(t.url, { attribution: t.attribution, maxZoom: t.maxZoom }).addTo(m);
  }

  function syncPlace() {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    const { place, radiusMi } = latest.current;
    if (!place) {
      ring.current?.remove();
      you.current?.remove();
      ring.current = null;
      you.current = null;
      return;
    }
    const at: [number, number] = [place.lat, place.lon];
    const radiusM = radiusMi * METERS_PER_MILE;
    if (!ring.current) {
      ring.current = lib
        .circle(at, { radius: radiusM, className: "df-ring", interactive: false })
        .addTo(m);
    } else {
      ring.current.setLatLng(at).setRadius(radiusM);
    }
    const icon = lib.divIcon({
      className: "",
      html: `<span class="df-you${place.source === "gps" ? " is-gps" : ""}"></span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    if (!you.current) {
      you.current = lib.marker(at, { icon, keyboard: false, zIndexOffset: 1000, interactive: false }).addTo(m);
    } else {
      you.current.setLatLng(at).setIcon(icon);
    }
    // Re-frame only when the place or radius actually changed, never on a
    // filter tick — the driver may have zoomed in on purpose.
    const key = `${place.lat},${place.lon},${radiusMi}`;
    if (fitFor.current !== key) {
      fitFor.current = key;
      m.fitBounds(ring.current.getBounds(), { padding: [12, 12], animate: true });
    }
  }

  function syncPins() {
    const lib = L.current;
    const group = pins.current;
    if (!lib || !group) return;
    const { sites, selectedId } = latest.current;
    const keep = new Set(sites.map((s) => s.id));
    for (const [id, mk] of markers.current) {
      if (!keep.has(id)) {
        group.removeLayer(mk);
        markers.current.delete(id);
      }
    }
    for (const s of sites) {
      const selected = s.id === selectedId;
      const icon = lib.divIcon({
        className: "",
        html: pinHtml(s, selected),
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      let mk = markers.current.get(s.id);
      if (!mk) {
        mk = lib.marker([s.lat, s.lon], { icon, title: s.name, riseOnHover: true });
        mk.on("click", () => latest.current.onSelect(s.id));
        group.addLayer(mk);
        markers.current.set(s.id, mk);
      } else {
        mk.setIcon(icon).setLatLng([s.lat, s.lon]);
      }
      mk.setZIndexOffset(selected ? 900 : 0);
    }
  }

  function syncAll() {
    if (!ready.current) return;
    syncTiles();
    syncPlace();
    syncPins();
  }

  useEffect(syncAll);

  // Bring the selected site into view if it is off-screen.
  useEffect(() => {
    const m = map.current;
    const s = props.sites.find((x) => x.id === props.selectedId);
    if (!m || !s) return;
    if (!m.getBounds().pad(-0.1).contains([s.lat, s.lon])) {
      m.panTo([s.lat, s.lon], { animate: true });
    }
  }, [props.selectedId, props.sites]);

  return (
    <div
      ref={host}
      className={`df-map h-full w-full${props.placing ? " is-placing" : ""}`}
      role="application"
      aria-label="Map of sites around you"
    />
  );
}
