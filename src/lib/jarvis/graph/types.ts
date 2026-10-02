// ---------------------------------------------------------------------------
// What the knowledge graph is made of.
//
// The important decision in this file: a graph node is identified by its
// VAULT PATH, not by a memory row id. `GraphNode` in memoryClient.ts keys on a
// memory id, which cannot express the one node type that matters most — a
// ghost, i.e. `[[A Note I Never Wrote]]`, which Obsidian draws and which has
// no row behind it. Widening `GraphNode` would break its four existing callers,
// so this is a new type and the old one is left alone.
// ---------------------------------------------------------------------------

import type { MemorySource } from "@/lib/jarvis/types";

export type NodeKind =
  /** A real note, with a file on disk and (usually) a mirror row. */
  | "note"
  /** Linked to, never written. No file, no row, no content — on purpose. */
  | "ghost"
  /** A `#tag`, drawn as a node so a tag cluster is visible. */
  | "tag";

export interface VaultNode {
  /**
   * The graph's identity: a vault-relative path for a note, `ghost:<name>` for
   * a ghost, `tag:<tag>` for a tag. Stable across a sweep, which is what lets
   * a selection, a camera position and a dismissal survive a re-layout.
   */
  key: string;
  kind: NodeKind;
  /** The `jarvis_memories` row, when one exists. Absent for ghosts and tags. */
  memoryId?: string;
  /** Where the note came from. Ghosts and tags report `vault`, since that is the graph they belong to. */
  source: MemorySource;
  title: string;
  /** 0..1 — longer and newer reads brighter. Ghosts take their strength from how often they are referenced. */
  strength: number;
  /** Resolved outgoing edges, as keys of other nodes. Never contains this node's own key. */
  links: string[];
  /** Normalised tags, without the leading `#`. */
  tags: string[];
  /** The real path on disk, for `obsidian://open`. Absent for ghosts and tags. */
  path?: string;
}

/** One drawn edge. De-duplicated so A→B and B→A are one line. */
export interface GraphEdge {
  a: string;
  b: string;
  /** True when at least one side embedded the other rather than merely referencing it. */
  embed: boolean;
}

export interface VaultGraph {
  nodes: VaultNode[];
  edges: GraphEdge[];
  /** Link targets that resolved to more than one note, so the UI can say so rather than silently picking. */
  ambiguous: { from: string; target: string; chose: string; among: string[] }[];
}

/**
 * The physics, exposed as plain numbers because the owner drives two of them
 * from sliders. This is the whole reason the integrator is hand-written rather
 * than borrowed: `repel` and `linkDistance` are parameters of our own `step()`,
 * not settings buried behind a force registry.
 */
export interface ForceParams {
  /** How hard unconnected nodes push apart. The "Repel" slider. */
  repel: number;
  /** The rest length of an edge. The "Line length" slider. */
  linkDistance: number;
  /** Spring stiffness along edges. */
  linkStrength: number;
  /** Velocity retained per tick. Below ~0.75 the graph sets like concrete; above ~0.95 it never settles. */
  damping: number;
  /** Pull toward the origin, so a disconnected component drifts but does not leave. */
  centering: number;
  /** Beyond this distance repulsion is not computed at all. Also the spatial-hash cell size. */
  cutoff: number;
}

/**
 * Defaults that actually balance.
 *
 * These are not free choices — they are a solved equilibrium. Repulsion falls
 * off as `repel · taper / (d² + softening)` while a spring pulls as
 * `linkStrength · (d − linkDistance)`, so the distance an edge settles at is
 * where those two cross. A stiff spring is what keeps that crossing point near
 * `linkDistance` rather than well outside it, and `linkStrength` this high is
 * only stable because `DEFAULT_DT` is a quarter step.
 *
 * Change `repel` or `linkStrength` and the layout still works, but edges stop
 * landing on the length the slider claims. force.test.ts asserts that
 * relationship across several rest lengths, so it will say so.
 */
export const DEFAULT_FORCE: ForceParams = {
  repel: 0.03,
  linkDistance: 0.42,
  linkStrength: 8,
  damping: 0.86,
  centering: 0.012,
  cutoff: 1.1,
};

/**
 * The uniform spatial hash repulsion is computed through.
 *
 * Rebuilt every tick, but allocation-free: a counting sort into three reusable
 * typed arrays rather than a Map of per-cell arrays. At 60fps with a couple of
 * thousand nodes, allocating two thousand small arrays per frame is the
 * difference between a smooth graph and a stuttering one.
 */
export interface Grid {
  /** Always a power of two, so the hash can mask instead of modulo. */
  buckets: number;
  /** Per-bucket occupancy, then reused as a fill cursor. */
  counts: Int32Array;
  /** Prefix sums — bucket `b` owns `order[starts[b] .. starts[b + 1]]`. */
  starts: Int32Array;
  /** Node indices, grouped by bucket. */
  order: Int32Array;
}

/** Live simulation state. Flat typed arrays — never one object per node. */
export interface ForceState {
  count: number;
  /** xyz per node. */
  positions: Float32Array;
  /** xyz per node. */
  velocities: Float32Array;
  /** Index pairs into `positions`, two entries per edge. */
  edges: Uint32Array;
  /** Total kinetic energy after the last step, so a caller can tell settled from moving. */
  energy: number;
  /**
   * The cooling schedule, 1 down to 0.
   *
   * Every force is scaled by it, so the layout anneals to a genuine stop
   * instead of drifting forever. Without this a stiff spring network settles
   * into a low-amplitude limit cycle — measured at ~1e-4 energy per node on a
   * real vault, bouncing rather than decreasing — and both the frame loop and
   * the "Settling…" label run for ever. Reheated by `reheat()` whenever the
   * owner changes something.
   */
  alpha: number;
  /** Reusable scratch for the spatial hash. Internal to the integrator. */
  grid: Grid;
}

export interface GraphSelection {
  /** The node the owner clicked, or null. */
  selected: string | null;
  /** The node under the cursor, or null. */
  hovered: string | null;
}
