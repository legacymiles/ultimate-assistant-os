"use client";

// ---------------------------------------------------------------------------
// The map view: the same things on a dark street map (CARTO's dark tiles over
// OpenStreetMap), each pin in its freshness colour, you as a cyan dot. Leaflet
// touches `window` at import, so it loads inside the effect.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { bestFix, freshness, type Device, type Fix } from "@/lib/find-my-life/engine";

const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

// The same glyphs as KindIcon, as strings for Leaflet's divIcon.
const GLYPH: Record<string, string> = {
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.4"/><path d="M10.5 18.5h3"/>',
  laptop: '<rect x="4.5" y="5" width="15" height="10.5" rx="1.4"/><path d="M2.5 19h19"/>',
  tablet: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.2"/>',
  watch: '<rect x="7" y="6.5" width="10" height="11" rx="2.6"/><path d="M9 6.5 10 2.5h4l1 4M9 17.5l1 4h4l1-4"/>',
  earbuds: '<path d="M7 4.2a3 3 0 0 1 3 3v1.6a3 3 0 0 1-3 3M7 11.8V19.5M17 4.2a3 3 0 0 0-3 3v1.6a3 3 0 0 0 3 3M17 11.8V19.5"/>',
  glasses: '<circle cx="6.5" cy="14" r="3.6"/><circle cx="17.5" cy="14" r="3.6"/><path d="M10.1 13.4c1.2-.9 2.6-.9 3.8 0"/>',
  car: '<path d="M4.5 16.2v-4.1L6.8 6.6h10.4l2.3 5.5v4.1zM4.5 12.1h15"/><circle cx="7.8" cy="16.6" r="1.7"/><circle cx="16.2" cy="16.6" r="1.7"/>',
  keys: '<circle cx="8" cy="8" r="4.2"/><path d="m11 11 9.2 9.2M17.2 17.2l2.2-2.2M14.6 14.6l2-2"/>',
  wallet: '<rect x="3" y="6" width="18" height="13.5" rx="2.2"/><path d="M3 9.6h18"/>',
  bag: '<rect x="4" y="8" width="16" height="12.5" rx="2.2"/><path d="M9 8V6.2a3 3 0 0 1 6 0V8"/>',
  bike: '<circle cx="5.8" cy="16" r="3.6"/><circle cx="18.2" cy="16" r="3.6"/><path d="M5.8 16 10 9h5.4l2.8 7"/>',
  pet: '<circle cx="8.2" cy="6.8" r="1.7"/><circle cx="15.8" cy="6.8" r="1.7"/><path d="M12 10.8c-3 0-5.2 3.2-5.2 5.8 0 2 2 2.6 5.2 2.6s5.2-.6 5.2-2.6c0-2.6-2.2-5.8-5.2-5.8z"/>',
  other: '<path d="m12 2.8 8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4z"/>',
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function FmlMap({ devices, here, selectedId, onSelect }: { devices: Device[]; here: Fix | null; selectedId: string | null; onSelect: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const fitted = useRef(false);
  const onSel = useRef(onSelect);
  onSel.current = onSelect;

  useEffect(() => {
    let dead = false;
    void import("leaflet").then((L) => {
      if (dead || !box.current || map.current) return;
      lib.current = L;
      const m = L.map(box.current, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([39.96, -83.0], 11);
      L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19, subdomains: "abcd" }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      draw();
    });
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const L = lib.current;
    const m = map.current;
    const g = layer.current;
    if (!L || !m || !g) return;
    g.clearLayers();
    const now = new Date();
    const pts: [number, number][] = [];
    for (const d of devices) {
      const f = bestFix(d);
      if (!f) continue;
      const fr = d.lost ? "lost" : freshness(f, now);
      const html = `<div class="fml-pin" data-f="${fr}" data-lost="${d.lost ? "true" : "false"}" data-sel="${d.id === selectedId}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPH[d.kind] ?? GLYPH.other}</svg></div>`;
      const icon = L.divIcon({ html, className: "fml-mapicon", iconSize: [34, 34], iconAnchor: [17, 17] });
      const mk = L.marker([f.lat, f.lng], { icon, title: d.name, keyboard: true, zIndexOffset: d.id === selectedId ? 1000 : 0 });
      mk.bindTooltip(esc(d.name), { direction: "top", offset: [0, -16] });
      mk.on("click", () => onSel.current(d.id));
      mk.addTo(g);
      if (f.acc && f.acc > 25 && f.acc < 5000) L.circle([f.lat, f.lng], { radius: f.acc, color: "#3be3ff", weight: 1, opacity: 0.35, fillOpacity: 0.05 }).addTo(g);
      pts.push([f.lat, f.lng]);
    }
    if (here) {
      L.marker([here.lat, here.lng], { icon: L.divIcon({ html: '<div class="fml-pin-you"></div>', className: "fml-mapicon", iconSize: [16, 16], iconAnchor: [8, 8] }), title: "You", interactive: false }).addTo(g);
      pts.push([here.lat, here.lng]);
    }
    if (!fitted.current && pts.length) {
      fitted.current = true;
      if (pts.length === 1) m.setView(pts[0], 16);
      else m.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16 });
    }
  };

  useEffect(draw); // redraw on every change: a few markers, cheap

  // Fly to whatever was picked in the list.
  useEffect(() => {
    const d = devices.find((x) => x.id === selectedId);
    const f = d && bestFix(d);
    if (f && map.current) map.current.flyTo([f.lat, f.lng], Math.max(map.current.getZoom(), 15), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div className="fml-map" ref={box} role="region" aria-label="Map of your things" />;
}
