"use client";

// ---------------------------------------------------------------------------
// The Memory map — a living web of everything Jarvis knows about your world.
//
// What's in it is decided by lib/memory-map/build.ts (pure, tested): you at the
// centre, hubs for apps, skills, clients, crashes, tasks, memories and notes,
// and the cross-links that make it a web — a crash wired to the app it hit, a
// memory wired to the client it's about.
//
// How it moves and draws is here. The layout is the same hand-written,
// deterministic force engine the old Brain used (lib/jarvis/graph/force.ts);
// the renderer is a Canvas 2D projection of that 3D layout, because a web of a
// few hundred labelled nodes reads better as glowing sprites with real text
// than as a WebGL point cloud — and it costs no 3D library on this tab.
//
//   drag            orbit            wheel / pinch    zoom
//   hover           light up a node's web, dim the rest
//   click           open it in the inspector (actions: open, copy, send to board, mark fixed)
//   double-click    fly to it        Esc              let go
//   search          light up matches; Enter flies to the first
//   chips           show or hide a kind of thing
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../icons";
import { DEFAULT_FORCE } from "@/lib/jarvis/graph/types";
import { isSettled, makeState, reheat, settle, step } from "@/lib/jarvis/graph/force";
import {
  ITEM_TYPES,
  TYPE_META,
  buildMap,
  neighbourhood,
  searchMap,
  type ClientIn,
  type ItemType,
  type MapNode,
  type SkillIn,
} from "@/lib/memory-map/build";
import { skillMeta } from "@/lib/skills/categories";
import type { Skill } from "@/lib/skills/types";
import type { ErrorEntry } from "@/lib/site-errors/log";
import type { UseQueue } from "@/lib/new-jarvis/useQueue";
import type { UseVault } from "@/lib/new-jarvis/useVault";
import type { JarvisStore } from "@/lib/jarvis/types";
import { sendToBoard, ticketForError, ticketForQueueRow } from "@/lib/new-jarvis/board";

const PARAMS = { ...DEFAULT_FORCE, linkDistance: 0.24, repel: 0.02, centering: 0.05 };
const YOU_COLOR = "#ffffff";

function colorOf(n: MapNode): string {
  if (n.type === "you") return YOU_COLOR;
  if (n.type === "hub" || n.type === "group") return TYPE_META[n.of!].color;
  return TYPE_META[n.type as ItemType].color;
}

function kindOf(n: MapNode): ItemType | null {
  if (n.type === "you") return null;
  if (n.type === "hub" || n.type === "group") return n.of ?? null;
  return n.type as ItemType;
}

/** Base radius in CSS px before perspective. */
function radiusOf(n: MapNode): number {
  if (n.type === "you") return 11;
  if (n.type === "hub") return 7 + n.weight * 3;
  if (n.type === "group") return 4 + n.weight * 2;
  return 2.4 + n.weight * 3.2;
}

/** One soft glow sprite per colour, drawn once and stamped per node. */
const sprites = new Map<string, HTMLCanvasElement>();
function glow(color: string): HTMLCanvasElement {
  let c = sprites.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `${color}ff`);
  grad.addColorStop(0.18, `${color}cc`);
  grad.addColorStop(0.45, `${color}33`);
  grad.addColorStop(1, `${color}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprites.set(color, c);
  return c;
}

// ----- data --------------------------------------------------------------------------

interface Extra {
  skills: SkillIn[];
  crashes: ErrorEntry[];
  clients: ClientIn[];
}

function useExtra(): Extra {
  const [extra, setExtra] = useState<Extra>({ skills: [], crashes: [], clients: [] });
  useEffect(() => {
    let live = true;
    const get = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void Promise.all([get("/api/skills/scan"), get("/api/site-errors"), get("/api/client-review/admin")]).then(([sk, er, cr]) => {
      if (!live) return;
      const skills: SkillIn[] = ((sk?.skills ?? []) as { slug: string; title: string; overview: string; body: string; origin: string }[]).map((s) => {
        const as: Skill = { id: s.slug, slug: s.slug, title: s.title, overview: s.overview, body: s.body, source: "claude-code", origin: s.origin, createdAt: "", updatedAt: "" };
        const m = skillMeta(as);
        return { slug: s.slug, title: s.title, overview: s.overview, categories: m.categories, nicknames: m.nicknames, command: m.command };
      });
      const clients: ClientIn[] = ((cr?.projects ?? []) as { id: string; name: string; clientName?: string; archived?: boolean }[])
        .filter((p) => !p.archived)
        .map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }));
      setExtra({ skills, crashes: (er?.open ?? []) as ErrorEntry[], clients });
    });
    return () => {
      live = false;
    };
  }, []);
  return extra;
}

// ----- the component ------------------------------------------------------------------

interface Props {
  queue: UseQueue;
  store: JarvisStore;
  vault: UseVault;
}

export function MemoryMap({ queue, store, vault }: Props) {
  const router = useRouter();
  const extra = useExtra();

  const graph = useMemo(
    () =>
      buildMap({
        queue: queue.all,
        skills: extra.skills,
        crashes: extra.crashes,
        clients: extra.clients,
        memories: store.memories,
        notes: vault.graph.nodes,
      }),
    [queue.all, extra, store.memories, vault.graph.nodes],
  );

  const [hidden, setHidden] = useState<Set<ItemType>>(new Set());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const matches = useMemo(() => searchMap(graph, query), [graph, query]);
  const byKey = useMemo(() => new Map(graph.nodes.map((n, i) => [n.key, { n, i }])), [graph]);
  const sel = selected ? byKey.get(selected)?.n ?? null : null;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Everything the frame loop reads lives in one ref, so a hover never re-renders React.
  const live = useRef({
    state: makeState([], 1),
    nodes: graph.nodes,
    edges: [] as [number, number][],
    screen: new Float32Array(0), // x, y, scale per node
    rotY: 0.6,
    rotX: -0.25,
    zoom: 1,
    center: [0, 0, 0] as [number, number, number],
    target: null as [number, number, number] | null,
    targetZoom: null as number | null,
    spread: 1,
    hover: -1,
    focus: null as Set<string> | null,
    match: new Set<string>(),
    hidden: new Set<ItemType>(),
    spin: true,
    selected: -1,
    dragging: false,
    reduced: false,
    w: 0,
    h: 0,
  });

  // (Re)build the layout when the shape of the web changes.
  useEffect(() => {
    const L = live.current;
    const prev = new Map<string, [number, number, number]>();
    L.nodes.forEach((n, i) => prev.set(n.key, [L.state.positions[i * 3], L.state.positions[i * 3 + 1], L.state.positions[i * 3 + 2]]));
    L.state = makeState(graph.nodes, 0x5eed);
    // Keep nodes that were already on screen where they were, so new data grows the web instead of re-exploding it.
    graph.nodes.forEach((n, i) => {
      const p = prev.get(n.key);
      if (p) L.state.positions.set(p, i * 3);
    });
    if (prev.size) reheat(L.state, 0.5);
    // First time: arrive mostly settled, then let it breathe — no exploding hairball on open.
    else settle(L.state, PARAMS, 500);
    L.hover = -1;
    L.nodes = graph.nodes;
    L.edges = graph.edges.map(([a, b]) => [byKey.get(a)!.i, byKey.get(b)!.i]);
    L.screen = new Float32Array(graph.nodes.length * 3);
  }, [graph, byKey]);

  useEffect(() => {
    const L = live.current;
    L.hidden = hidden;
    L.match = matches;
    L.spin = spin;
    L.selected = selected ? byKey.get(selected)?.i ?? -1 : -1;
    const anchor = hovered ?? selected;
    L.focus = anchor ? neighbourhood(graph, anchor, 1) : null;
  }, [hidden, matches, spin, selected, hovered, graph, byKey]);

  const flyTo = useCallback(
    (key: string) => {
      const hit = byKey.get(key);
      if (!hit) return;
      const L = live.current;
      const p = L.state.positions;
      L.target = [p[hit.i * 3], p[hit.i * 3 + 1], p[hit.i * 3 + 2]];
      L.targetZoom = hit.n.type === "you" || hit.n.type === "hub" ? 1.3 : 2.2;
      setSelected(key);
    },
    [byKey],
  );

  // ----- the frame loop ------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const L = live.current;
    L.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      L.w = r.width;
      L.h = r.height;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    let t = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // Real time, not frames: a slow phone turns and flies at the same speed as a fast laptop.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      t += dt;
      const ease = 1 - Math.pow(0.92, dt * 60);
      const { state, nodes, edges, screen } = L;
      const n = nodes.length;
      if (!isSettled(state)) {
        step(state, PARAMS);
        if (L.reduced) for (let k = 0; k < 40 && !isSettled(state); k++) step(state, PARAMS);
      }
      if (L.spin && !L.dragging && !L.reduced) L.rotY += 0.096 * dt;

      // Ease the camera toward a fly-to target.
      if (L.target) {
        for (let a = 0; a < 3; a++) L.center[a] += (L.target[a] - L.center[a]) * ease;
        if (Math.hypot(L.target[0] - L.center[0], L.target[1] - L.center[1], L.target[2] - L.center[2]) < 0.002) L.target = null;
      }
      if (L.targetZoom !== null) {
        L.zoom += (L.targetZoom - L.zoom) * ease;
        if (Math.abs(L.targetZoom - L.zoom) < 0.01) L.targetZoom = null;
      }

      // Fit the frame to where the web actually is: its centre, and the radius that holds
      // 90% of it (the max would let one stray dot shrink everything else).
      const p = state.positions;
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (let i = 0; i < n; i++) {
        mx += p[i * 3];
        my += p[i * 3 + 1];
        mz += p[i * 3 + 2];
      }
      if (n) {
        mx /= n;
        my /= n;
        mz /= n;
      }
      if (!L.target && L.selected < 0) {
        L.center[0] += (mx - L.center[0]) * ease * 0.5;
        L.center[1] += (my - L.center[1]) * ease * 0.5;
        L.center[2] += (mz - L.center[2]) * ease * 0.5;
      }
      const radii = new Float32Array(n);
      for (let i = 0; i < n; i++) radii[i] = Math.hypot(p[i * 3] - mx, p[i * 3 + 1] - my, p[i * 3 + 2] - mz);
      radii.sort();
      const fit = Math.max(0.3, n ? radii[Math.floor((n - 1) * 0.9)] * 1.1 : 0.3);
      L.spread += (fit - L.spread) * Math.min(1, ease * 0.6);

      const { w, h } = L;
      const scale = (Math.min(w, h) * 0.44 * L.zoom) / L.spread;
      const cy = Math.cos(L.rotY);
      const sy = Math.sin(L.rotY);
      const cx = Math.cos(L.rotX);
      const sx = Math.sin(L.rotX);
      const camD = 3.2;
      const depth = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x0 = p[i * 3] - L.center[0];
        const y0 = p[i * 3 + 1] - L.center[1];
        const z0 = p[i * 3 + 2] - L.center[2];
        const x1 = x0 * cy + z0 * sy;
        const z1 = -x0 * sy + z0 * cy;
        const y2 = y0 * cx - z1 * sx;
        const z2 = y0 * sx + z1 * cx;
        const zN = z2 / L.spread;
        const s = camD / (camD + zN);
        screen[i * 3] = w / 2 + x1 * scale * s;
        screen[i * 3 + 1] = h / 2 + y2 * scale * s;
        screen[i * 3 + 2] = s;
        depth[i] = zN;
      }

      const visible = (i: number) => {
        const k = kindOf(nodes[i]);
        return !k || !L.hidden.has(k);
      };
      const lit = (i: number) => {
        const key = nodes[i].key;
        if (L.focus) return L.focus.has(key);
        if (L.match.size) return L.match.has(key);
        return true;
      };

      // Background: a faint vignette so the web floats.
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      bg.addColorStop(0, "rgba(40,60,120,0.20)");
      bg.addColorStop(1, "rgba(4,6,12,0)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Edges.
      ctx.lineWidth = 1;
      for (const [a, b] of edges) {
        if (!visible(a) || !visible(b)) continue;
        const on = lit(a) && lit(b);
        const s = (screen[a * 3 + 2] + screen[b * 3 + 2]) / 2;
        const alpha = (on ? (L.focus ? 0.75 : 0.13) : 0.035) * Math.min(1.2, s);
        ctx.strokeStyle = on && L.focus ? `rgba(207,224,255,${alpha})` : `rgba(110,140,255,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(screen[a * 3], screen[a * 3 + 1]);
        ctx.lineTo(screen[b * 3], screen[b * 3 + 1]);
        ctx.stroke();

        // Crashes send sparks along their links.
        const ca = nodes[a].type === "crash";
        const cb = nodes[b].type === "crash";
        if ((ca || cb) && on && !L.reduced) {
          const [from, to] = ca ? [a, b] : [b, a];
          for (let k = 0; k < 2; k++) {
            const f = (t * 0.45 + k * 0.5 + (from % 7) * 0.13) % 1;
            const x = screen[from * 3] + (screen[to * 3] - screen[from * 3]) * f;
            const y = screen[from * 3 + 1] + (screen[to * 3 + 1] - screen[from * 3 + 1]) * f;
            ctx.drawImage(glow(TYPE_META.crash.color), x - 5, y - 5, 10, 10);
          }
        }
      }

      // Nodes, back to front.
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => depth[b] - depth[a]);
      for (const i of order) {
        if (!visible(i)) continue;
        const node = nodes[i];
        const s = screen[i * 3 + 2];
        const on = lit(i);
        let r = radiusOf(node) * s * (0.75 + L.zoom * 0.25);
        if (node.type === "crash" && !L.reduced) r *= 1 + 0.18 * Math.sin(t * 3.2 + i);
        const x = screen[i * 3];
        const y = screen[i * 3 + 1];
        const color = colorOf(node);
        ctx.globalAlpha = on ? Math.min(1, 0.55 + s * 0.45) : 0.12;
        const g = r * (i === L.hover || i === L.selected ? 6 : 4.2);
        ctx.drawImage(glow(color), x - g / 2, y - g / 2, g, g);
        ctx.fillStyle = node.type === "you" ? "#ffffff" : color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2, r * 0.55), 0, Math.PI * 2);
        ctx.fill();
        if (node.state === "wip" && on && (node.type === "app" || node.type === "task")) {
          ctx.strokeStyle = "rgba(255,181,71,0.95)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(x, y, r * 0.95 + 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (i === L.selected || i === L.hover) {
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 5 + (i === L.selected ? Math.sin(t * 4) * 1.5 : 0), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // Labels: the structure always; the rest when it's in focus, found, or you're zoomed in close.
      // Placed most-important first, and a label that would sit on top of one already placed is
      // skipped, so a dense corner (or a phone) never turns into a pile of text.
      ctx.font = "500 11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textBaseline = "middle";
      const narrow = w < 640;
      const cands: { i: number; pri: number }[] = [];
      for (let i = 0; i < n; i++) {
        if (!visible(i)) continue;
        const node = nodes[i];
        const s = screen[i * 3 + 2];
        const key = node.key;
        let pri = -1;
        if (i === L.selected) pri = 100;
        else if (i === L.hover) pri = 95;
        else if (node.type === "you") pri = 90;
        else if (node.type === "hub") pri = 80;
        else if (L.match.has(key)) pri = 70;
        else if (L.focus?.has(key)) pri = 60;
        else if (node.type === "group" && !L.focus && L.zoom > (narrow ? 1.25 : 0.95)) pri = 40;
        else if (L.zoom > 2 && s > 1.02 && !L.focus) pri = 20 + s;
        if (pri >= 0) cands.push({ i, pri });
      }
      cands.sort((a, b) => b.pri - a.pri);
      const placed: [number, number, number, number][] = [];
      for (const { i, pri } of cands) {
        const node = nodes[i];
        const s = screen[i * 3 + 2];
        const label = node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title;
        const x = screen[i * 3] + radiusOf(node) * s + 7;
        const y = screen[i * 3 + 1];
        const tw = ctx.measureText(label).width;
        const box: [number, number, number, number] = [x - 4, y - 8, x + tw + 4, y + 8];
        if (pri < 80 && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        placed.push(box);
        ctx.fillStyle = "rgba(6,8,14,0.72)";
        ctx.fillRect(box[0], box[1], tw + 8, 16);
        ctx.fillStyle = node.type === "hub" || node.type === "you" ? "#ffffff" : "rgba(232,236,245,0.92)";
        ctx.fillText(label, x, y);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // ----- pointer ---------------------------------------------------------------------------
  const pick = useCallback((clientX: number, clientY: number): number => {
    const L = live.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return -1;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = -1;
    let bestS = -1;
    for (let i = 0; i < L.nodes.length; i++) {
      const k = kindOf(L.nodes[i]);
      if (k && L.hidden.has(k)) continue;
      const s = L.screen[i * 3 + 2];
      const r = radiusOf(L.nodes[i]) * s + 6;
      const d = Math.hypot(L.screen[i * 3] - x, L.screen[i * 3 + 1] - y);
      if (d <= r && s > bestS) {
        best = i;
        bestS = s;
      }
    }
    return best;
  }, []);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const downAt = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downAt.current = { x: e.clientX, y: e.clientY, moved: false };
    live.current.dragging = true;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const L = live.current;
    const prev = pointers.current.get(e.pointerId);
    if (prev) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.current) L.zoom = Math.min(6, Math.max(0.35, L.zoom * (d / pinch.current)));
        pinch.current = d;
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (downAt.current && Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) > 4) downAt.current.moved = true;
      L.rotY += dx * 0.006;
      L.rotX = Math.max(-1.3, Math.min(1.3, L.rotX + dy * 0.006));
      return;
    }
    const i = pick(e.clientX, e.clientY);
    if (i !== L.hover) {
      L.hover = i;
      setHovered(i >= 0 ? L.nodes[i].key : null);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) live.current.dragging = false;
    if (downAt.current && !downAt.current.moved) {
      const i = pick(e.clientX, e.clientY);
      setSelected(i >= 0 ? live.current.nodes[i].key : null);
    }
    downAt.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const L = live.current;
    L.targetZoom = null;
    L.zoom = Math.min(6, Math.max(0.35, L.zoom * Math.exp(-e.deltaY * 0.0012)));
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const i = pick(e.clientX, e.clientY);
    if (i >= 0) flyTo(live.current.nodes[i].key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resetView = () => {
    const L = live.current;
    L.target = [0, 0, 0];
    L.targetZoom = 1;
    L.rotX = -0.25;
    setSelected(null);
  };

  // ----- actions -------------------------------------------------------------------------------
  const crashById = useMemo(() => new Map(extra.crashes.map((c) => [c.id, c])), [extra.crashes]);
  const rowById = useMemo(() => new Map(queue.all.map((r) => [r.id, r])), [queue.all]);

  const act = async (label: string, run: () => Promise<string>) => {
    setNote(`${label}…`);
    try {
      setNote(await run());
    } catch {
      setNote("That didn't work — try again.");
    }
  };

  const connections = useMemo(() => {
    if (!sel) return [];
    return sel.links
      .map((k) => byKey.get(k)?.n)
      .filter((n): n is MapNode => Boolean(n))
      .sort((a, b) => (a.type === "hub" ? -1 : b.type === "hub" ? 1 : 0) || a.title.localeCompare(b.title))
      .slice(0, 14);
  }, [sel, byKey]);

  const total = graph.nodes.length;

  return (
    <div ref={wrapRef} className="relative h-full min-h-[420px] w-full overflow-hidden" style={{ background: "radial-gradient(ellipse at center, #0b1020 0%, #05070d 75%)" }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none select-none"
        style={{ cursor: hovered ? "pointer" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!live.current.dragging) {
            live.current.hover = -1;
            setHovered(null);
          }
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        aria-label="Memory map. Drag to turn, scroll to zoom, click a dot to open it."
        role="img"
      />

      {/* toolbar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="relative min-w-0 max-w-xs flex-1">
            <Icon.Search width={12} height={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const first = [...matches][0];
                  if (first) flyTo(first);
                }
              }}
              placeholder="Search the map…"
              aria-label="Search the map"
              className="w-full rounded-lg border border-white/10 bg-black/50 py-1.5 pl-7 pr-2 text-[12px] text-ink outline-none backdrop-blur placeholder:text-ink-faint focus:border-[var(--hud)]"
            />
          </div>
          {query && <span className="shrink-0 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted backdrop-blur">{matches.size} found</span>}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setSpin((s) => !s)}
              aria-pressed={spin}
              title={spin ? "Stop turning" : "Turn slowly"}
              className="rounded-lg border border-white/10 bg-black/50 px-2 py-1.5 text-[11px] text-ink-muted backdrop-blur hover:text-ink"
            >
              {spin ? "Pause" : "Spin"}
            </button>
            <button type="button" onClick={resetView} className="rounded-lg border border-white/10 bg-black/50 px-2 py-1.5 text-[11px] text-ink-muted backdrop-blur hover:text-ink">
              Reset<span className="hidden sm:inline"> view</span>
            </button>
          </div>
        </div>
        <div className="pointer-events-auto flex flex-wrap gap-1">
          {ITEM_TYPES.filter((t) => graph.counts[t] > 0).map((t) => {
            const off = hidden.has(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={!off}
                onClick={() =>
                  setHidden((h) => {
                    const n = new Set(h);
                    if (n.has(t)) n.delete(t);
                    else n.add(t);
                    return n;
                  })
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] backdrop-blur transition ${off ? "border-white/10 bg-black/40 text-ink-faint" : "border-white/15 bg-black/55 text-ink"}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_META[t].color, boxShadow: off ? "none" : `0 0 8px ${TYPE_META[t].color}`, opacity: off ? 0.35 : 1 }} aria-hidden />
                {TYPE_META[t].label}
                <span className="font-mono text-[9.5px] text-ink-faint">{graph.counts[t]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* footer hint */}
      <p className="pointer-events-none absolute bottom-2 left-3 text-[10.5px] text-ink-faint">
        {total} things · {graph.edges.length} links<span className="hidden sm:inline"> · drag to turn · scroll to zoom · double-click to fly in</span>
      </p>

      {/* inspector */}
      {sel && (
        <aside className="absolute inset-x-2 bottom-2 max-h-[55%] overflow-y-auto rounded-xl border border-white/10 bg-black/70 p-3 backdrop-blur-md sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-24 sm:max-h-[calc(100%-7rem)] sm:w-[300px]">
          <div className="flex items-start gap-2">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(sel), boxShadow: `0 0 10px ${colorOf(sel)}` }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-ink-faint">
                {sel.type === "you" ? "You" : sel.type === "hub" ? "Hub" : sel.type === "group" ? `${TYPE_META[sel.of!].label} group` : TYPE_META[sel.type as ItemType].label.replace(/s$/, "")}
                {sel.state === "wip" && <span className="ml-1.5 text-[var(--hud-amber)]">· unfinished</span>}
              </p>
              <h3 className="text-[14px] font-semibold leading-snug text-ink">{sel.title}</h3>
              {sel.subtitle && <p className="text-[11px] text-ink-muted">{sel.subtitle}</p>}
            </div>
            <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="rounded p-1 text-ink-faint hover:text-ink">
              <Icon.Close width={12} height={12} aria-hidden />
            </button>
          </div>
          {sel.detail && <p className="mt-2 line-clamp-6 whitespace-pre-line text-[11.5px] leading-relaxed text-ink-muted">{sel.detail}</p>}

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {sel.href && sel.type !== "crash" && (
              <button type="button" className="deck-btn deck-btn--go" onClick={() => router.push(sel.href!)}>
                <Icon.Launch width={12} height={12} aria-hidden /> Open
              </button>
            )}
            {sel.command && (
              <button
                type="button"
                className="deck-btn"
                onClick={() => void navigator.clipboard?.writeText(sel.command!).then(() => setNote(`Copied ${sel.command}`))}
              >
                <Icon.Copy width={12} height={12} aria-hidden /> {sel.command}
              </button>
            )}
            {sel.type === "crash" && sel.ref && crashById.get(sel.ref) && (
              <>
                <button type="button" className="deck-btn deck-btn--go" onClick={() => void act("Sending to the board", async () => (await sendToBoard(ticketForError(crashById.get(sel.ref!)!))).message)}>
                  <Icon.ListChecks width={12} height={12} aria-hidden /> Send to board
                </button>
                <button
                  type="button"
                  className="deck-btn"
                  onClick={() =>
                    void act("Marking it fixed", async () => {
                      await fetch("/api/site-errors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sel.ref }) });
                      return "Marked fixed. If it happens again it comes back.";
                    })
                  }
                >
                  <Icon.Check width={12} height={12} aria-hidden /> Mark fixed
                </button>
              </>
            )}
            {sel.state === "wip" && sel.ref && rowById.get(sel.ref) && (
              <button type="button" className="deck-btn" onClick={() => void act("Sending to the board", async () => (await sendToBoard(ticketForQueueRow(rowById.get(sel.ref!)!))).message)}>
                <Icon.ListChecks width={12} height={12} aria-hidden /> Finish it (board)
              </button>
            )}
          </div>
          {note && <p className="mt-1.5 text-[11px] text-ink-muted">{note}</p>}

          {connections.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-2">
              <p className="text-[10px] uppercase tracking-wider text-ink-faint">Connected to {sel.links.length}</p>
              <ul className="mt-1 space-y-0.5">
                {connections.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => flyTo(c.key)}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11.5px] text-ink-muted hover:bg-white/5 hover:text-ink"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorOf(c) }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      {c.state === "wip" && <span className="text-[9.5px] text-[var(--hud-amber)]">wip</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      )}

      {total <= 1 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="text-[12px] text-ink-muted">Reading your apps, skills and memories…</p>
        </div>
      )}
    </div>
  );
}
