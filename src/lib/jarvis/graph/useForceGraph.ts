"use client";

// ---------------------------------------------------------------------------
// The simulation's life, held across frames.
//
// Nothing here renders and nothing here imports `three`. The split matters:
// positions change sixty times a second, and if they lived in React state the
// whole graph would re-render every frame. So the typed arrays live in a ref,
// the canvas reads them directly in its own frame loop, and React only hears
// about the handful of things a person actually changes — what is selected,
// what is hovered, where the sliders are.
//
// Reduced motion is handled here rather than in the canvas, because the honest
// answer is not "animate more slowly": it is to settle the layout once and
// show the finished graph. The content survives with the motion switched off,
// which is the whole test.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSettled, kick, makeState, reheat, settle, step } from "./force";
import { highlightSet, indexMap, neighbourhood } from "./pick";
import { DEFAULT_FORCE, type ForceParams, type ForceState, type GraphSelection, type VaultGraph, type VaultNode } from "./types";

/** Ticks per frame while the layout is still moving. More than one makes it settle visibly faster. */
const TICKS_PER_FRAME = 3;

/** How long a pointer must rest before the idle behaviour starts. */
export const IDLE_AFTER_MS = 8_000;

export interface UseForceGraph {
  /** Live state. Read inside a frame loop; never put in a dependency array. */
  state: ForceState;
  nodes: VaultNode[];
  /** key → index into the position arrays. */
  index: Map<string, number>;
  params: ForceParams;
  setParams: (patch: Partial<ForceParams>) => void;
  selection: GraphSelection;
  select: (key: string | null) => void;
  hover: (key: string | null) => void;
  /** The selected node and everything one hop from it, or null when nothing is selected. */
  lit: Set<string> | null;
  /** Keys matching the search. Empty set when the box is empty. */
  matches: Set<string>;
  search: string;
  setSearch: (q: string) => void;
  /** True while the layout is still moving, so the canvas knows to keep stepping. */
  moving: boolean;
  /** Advance the simulation. Called from the canvas's frame loop. */
  tick: () => void;
  /** Shake a settled layout loose. */
  resettle: () => void;
  /** True once the pointer has been still long enough for the idle behaviour. */
  idle: boolean;
  /** Tell the hook the pointer moved, so idle can reset. Cheap — a ref write. */
  touch: () => void;
  reduced: boolean;
}

export function useForceGraph(graph: VaultGraph, seed = 0x5eed): UseForceGraph {
  const [params, setParamsState] = useState<ForceParams>(DEFAULT_FORCE);
  const [selection, setSelection] = useState<GraphSelection>({ selected: null, hovered: null });
  const [search, setSearch] = useState("");
  const [moving, setMoving] = useState(true);
  const [idle, setIdle] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const nodes = graph.nodes;

  // Rebuilt only when the graph's shape actually changes. Keying on the node
  // list by reference would throw the layout away on every sweep that returned
  // the same notes, and the owner would watch their graph explode and re-settle
  // for no reason.
  const shape = useMemo(
    () => nodes.map((n) => `${n.key}>${n.links.join("|")}`).join("\n"),
    [nodes],
  );

  const stateRef = useRef<ForceState | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    stateRef.current = makeState(nodes, seed);
    if (reduced) {
      // No animation: settle it now and show the answer. A graph that arrives
      // finished is a better reduced-motion experience than a slow one.
      settle(stateRef.current, params, 600);
      setMoving(false);
    } else {
      setMoving(true);
    }
    bump((n) => n + 1);
    // `shape` is the dependency that matters; params is read, not tracked, so a
    // slider move does not rebuild the layout from scratch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, seed, reduced]);

  const state = stateRef.current ?? makeState(nodes, seed);
  const index = useMemo(() => indexMap(nodes), [nodes]);

  const setParams = useCallback((patch: Partial<ForceParams>) => {
    setParamsState((p) => ({ ...p, ...patch }));
    // A slider move WAKES the layout — this is the whole point of the control.
    // The graph visibly inhales and re-settles rather than silently storing a
    // number, so physics reads as an instrument rather than a setting. Without
    // the reheat a cooled layout would absorb the change and not move at all.
    if (stateRef.current) reheat(stateRef.current, 0.6);
    setMoving(true);
  }, []);

  const paramsRef = useRef(params);
  paramsRef.current = params;

  const tick = useCallback(() => {
    const live = stateRef.current;
    if (!live) return;
    for (let i = 0; i < TICKS_PER_FRAME; i += 1) step(live, paramsRef.current);
    if (isSettled(live)) setMoving(false);
  }, []);

  const resettle = useCallback(() => {
    const live = stateRef.current;
    if (!live) return;
    kick(live);
    setMoving(true);
  }, []);

  // --- idle --------------------------------------------------------------
  // The cheapest delight on the list and almost nobody does it: once the
  // pointer has been still a while, the notes the owner owes themselves start
  // to pulse. Driven by a ref and one timer, so moving the mouse costs nothing.
  const lastMove = useRef(Date.now());
  const touch = useCallback(() => {
    lastMove.current = Date.now();
    setIdle((was) => (was ? false : was));
  }, []);

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      setIdle(Date.now() - lastMove.current > IDLE_AFTER_MS);
    }, 1_000);
    return () => clearInterval(timer);
  }, [reduced]);

  const select = useCallback((key: string | null) => {
    setSelection((s) => ({ ...s, selected: key }));
  }, []);

  const hover = useCallback((key: string | null) => {
    setSelection((s) => (s.hovered === key ? s : { ...s, hovered: key }));
  }, []);

  // Hovering wins over selecting for what is lit, because the pointer is the
  // more immediate intention — you are asking about THIS one, now.
  const focusKey = selection.hovered ?? selection.selected;
  const lit = useMemo(() => (focusKey ? neighbourhood(nodes, focusKey) : null), [focusKey, nodes]);
  const matches = useMemo(() => highlightSet(search, nodes), [search, nodes]);

  return {
    state,
    nodes,
    index,
    params,
    setParams,
    selection,
    select,
    hover,
    lit,
    matches,
    search,
    setSearch,
    moving,
    tick,
    resettle,
    idle,
    touch,
    reduced,
  };
}
