// The part registry — the single source of truth for the exploded showcase.
// Everything (geometry placement, explode animation, callouts, keyboard list)
// reads from this list. Local model space: +Z = forward/nose, +X = right, +Y = up.
// Ground sits at y = GROUND. Swap this list to showcase a different machine.

export type Region = "front" | "cockpit" | "powertrain" | "wheels" | "aero";

export interface PartDef {
  id: string;
  region: Region;
  name: string;
  spec: string;
  /** Assembled position (object space). */
  home: [number, number, number];
  /** Displacement from home when this part's region is active. */
  explode: [number, number, number];
}

export const GROUND = -0.62;

export const REGIONS: { id: Region; label: string }[] = [
  { id: "front", label: "Front" },
  { id: "cockpit", label: "Cockpit" },
  { id: "powertrain", label: "Powertrain" },
  { id: "wheels", label: "Wheels" },
  { id: "aero", label: "Aero" },
];

export const REGION_INDEX: Record<Region, string> = {
  front: "01",
  cockpit: "02",
  powertrain: "03",
  wheels: "04",
  aero: "05",
};

export const PARTS: PartDef[] = [
  // ---- front ----------------------------------------------------------
  {
    id: "nose",
    region: "front",
    name: "Nose Cone",
    spec: "Impact-absorbing composite fairing",
    home: [0, -0.08, 1.16],
    explode: [0, 0.34, 1.5],
  },
  {
    id: "bumper",
    region: "front",
    name: "Front Nerf Bar",
    spec: "FIA-spec tubular bumper · 6082-T6",
    home: [0, -0.2, 1.42],
    explode: [0, -0.1, 1.75],
  },
  // ---- cockpit --------------------------------------------------------
  {
    id: "seat",
    region: "cockpit",
    name: "Seat Shell",
    spec: "Carbon monocoque · 4-point harness",
    home: [0, 0.04, -0.24],
    explode: [0, 0.72, -0.5],
  },
  {
    id: "steering",
    region: "cockpit",
    name: "Steering",
    spec: "Quick-release wheel · 2.1 turns L-to-L",
    home: [0, 0.16, 0.34],
    explode: [0, 0.95, 0.55],
  },
  // ---- powertrain -----------------------------------------------------
  {
    id: "engine",
    region: "powertrain",
    name: "Engine",
    spec: "125cc 2-stroke · 46 bhp @ 13,000 rpm",
    home: [0.36, 0.02, -0.7],
    explode: [1.0, 0.42, -0.55],
  },
  {
    id: "exhaust",
    region: "powertrain",
    name: "Expansion Chamber",
    spec: "Tuned resonant exhaust · +7% mid-range",
    home: [0.18, -0.14, -1.02],
    explode: [0.7, 0.2, -1.35],
  },
  // ---- wheels ---------------------------------------------------------
  {
    id: "wheelFL",
    region: "wheels",
    name: "Front Slick",
    spec: '10" magnesium rim · soft compound',
    home: [-0.64, -0.28, 0.9],
    explode: [-0.95, 0.14, 0.55],
  },
  {
    id: "wheelFR",
    region: "wheels",
    name: "Front Slick",
    spec: '10" magnesium rim · soft compound',
    home: [0.64, -0.28, 0.9],
    explode: [0.95, 0.14, 0.55],
  },
  {
    id: "wheelRL",
    region: "wheels",
    name: "Rear Slick",
    spec: '11" magnesium rim · 212mm width',
    home: [-0.7, -0.26, -0.84],
    explode: [-1.05, 0.14, -0.5],
  },
  {
    id: "wheelRR",
    region: "wheels",
    name: "Rear Slick",
    spec: '11" magnesium rim · 212mm width',
    home: [0.7, -0.26, -0.84],
    explode: [1.05, 0.14, -0.5],
  },
  // ---- aero -----------------------------------------------------------
  {
    id: "wing",
    region: "aero",
    name: "Rear Wing",
    spec: "3-element · +40kg downforce @ 90km/h",
    home: [0, 0.44, -1.2],
    explode: [0, 0.95, -1.55],
  },
  {
    id: "floor",
    region: "aero",
    name: "Floor Tray",
    spec: "Stiffened aluminium honeycomb",
    home: [0, -0.32, -0.05],
    explode: [0, -0.62, -0.2],
  },
];

export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries(
  PARTS.map((p) => [p.id, p]),
);

/** The exploded anchor point (world-ish) where a part's callout should sit. */
export function anchorOf(p: PartDef): [number, number, number] {
  return [p.home[0] + p.explode[0], p.home[1] + p.explode[1], p.home[2] + p.explode[2]];
}
