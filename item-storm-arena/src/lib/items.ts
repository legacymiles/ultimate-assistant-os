/**
 * The item roster. Every object in the storm is one of these kinds,
 * each with its own body, mass (how reluctantly it obeys the cursor),
 * and personality flags that drive its physics quirks.
 */
export type ItemKind =
  | "capsule" // energy capsule — eager, light, darts to the cursor
  | "coin" // gold coin — light, blown around by fast cursor "wind"
  | "crystal" // heavy crystal — resists, then commits. Shield on hit
  | "orb" // rainbow orb — refuses to come straight in, circles the cursor
  | "paint" // paint bomb — wobbly, splashes color over the arena on hit
  | "shell" // energy shell — lunges late, shatters the headline on hit
  | "magnet" // magnet core — links to its siblings, drags the storm on hit
  | "gravity"; // gravity orb — heaviest thing in the sky, flips gravity on hit

export interface ItemTypeDef {
  kind: ItemKind;
  count: number;
  color: string;
  emissive: string;
  emissiveIntensity: number;
  mass: number; // 0.5 light … 2 heavy
  size: number;
  /** tangential force bias — >0 makes it orbit the cursor instead of homing */
  orbitBias: number;
  /** how much cursor-velocity "wind" pushes it (light items catch wind) */
  windage: number;
  metalness: number;
  roughness: number;
}

export const ITEM_TYPES: ItemTypeDef[] = [
  { kind: "capsule", count: 12, color: "#3ef5c8", emissive: "#19ffd0", emissiveIntensity: 1.4, mass: 0.55, size: 0.22, orbitBias: 0.0, windage: 0.7, metalness: 0.1, roughness: 0.25 },
  { kind: "coin",    count: 12, color: "#ffd23e", emissive: "#ffb300", emissiveIntensity: 1.1, mass: 0.5,  size: 0.2,  orbitBias: 0.1, windage: 1.4, metalness: 0.9, roughness: 0.25 },
  { kind: "crystal", count: 8,  color: "#9d7bff", emissive: "#7b4dff", emissiveIntensity: 1.2, mass: 1.35, size: 0.26, orbitBias: 0.0, windage: 0.2, metalness: 0.2, roughness: 0.1 },
  { kind: "orb",     count: 8,  color: "#ff6fb1", emissive: "#ff2f8f", emissiveIntensity: 1.5, mass: 0.8,  size: 0.22, orbitBias: 1.0, windage: 0.6, metalness: 0.0, roughness: 0.35 },
  { kind: "paint",   count: 6,  color: "#ff8a3d", emissive: "#ff5a1f", emissiveIntensity: 1.0, mass: 1.0,  size: 0.24, orbitBias: 0.25, windage: 0.5, metalness: 0.0, roughness: 0.6 },
  { kind: "shell",   count: 6,  color: "#59d0ff", emissive: "#18a8ff", emissiveIntensity: 1.3, mass: 1.4,  size: 0.24, orbitBias: 0.0, windage: 0.15, metalness: 0.3, roughness: 0.2 },
  { kind: "magnet",  count: 4,  color: "#ff5470", emissive: "#ff1e4f", emissiveIntensity: 1.2, mass: 1.6,  size: 0.26, orbitBias: 0.0, windage: 0.1, metalness: 0.7, roughness: 0.3 },
  { kind: "gravity", count: 4,  color: "#8ef58a", emissive: "#3dff6e", emissiveIntensity: 1.5, mass: 1.85, size: 0.28, orbitBias: 0.15, windage: 0.05, metalness: 0.1, roughness: 0.15 },
];

export const TYPE_BY_KIND = Object.fromEntries(ITEM_TYPES.map((t) => [t.kind, t])) as Record<ItemKind, ItemTypeDef>;

export const TOTAL_ITEMS = ITEM_TYPES.reduce((n, t) => n + t.count, 0);

/** Item physics lifecycle. */
export enum ItemState {
  STORM = 0, // riding the invisible energy paths
  ORBIT = 1, // captured, orbiting the cursor
  LAUNCH = 2, // fired at the kart
  RETURN = 3, // respawning back into the storm
}
