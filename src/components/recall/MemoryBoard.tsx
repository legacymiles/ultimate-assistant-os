"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  buildMemoryGraph,
  memoryNeighbors,
  searchMemory,
  type MemoryGraph,
  type MemoryNode,
  type MemoryNodeKind,
} from "@/lib/recall/memory";
import type { Folder, Item, RecallData } from "@/lib/recall/types";

interface Props {
  data: RecallData;
  onOpenFolder: (folderId: string) => void;
  onOpenItem: (item: Item) => void;
  onOpenProfile: (profileId: string) => void;
  onAsk: (question: string) => void;
}

const W = 1200;
const H = 840;
const CX = W / 2;
const CY = H / 2;

const COLORS: Record<MemoryNodeKind, string> = {
  root: "var(--color-brand)",
  folder: "#a78bfa",
  item: "#7dd3fc",
  profile: "#fbbf24",
  account: "#34d399",
  tag: "#fb7185",
};

const KIND_LABEL: Record<MemoryNodeKind, string> = {
  root: "Memory",
  folder: "Folder",
  item: "Record",
  profile: "Profile",
  account: "Account",
  tag: "Tag",
};

interface Pt {
  x: number;
  y: number;
}

function short(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Lay the graph out as a radial tree: folders own an angular sector, their
 * children subdivide it, and items sit in a small orbit around the folder they
 * belong to. Profiles sit just outside their folder with their accounts around
 * them. Tags live on the outer ring, which is what turns the tree into a web.
 */
function layout(data: RecallData, graph: MemoryGraph): Map<string, Pt> {
  const pos = new Map<string, Pt>();
  pos.set("memory:root", { x: CX, y: CY });

  const byParent = new Map<string | null, Folder[]>();
  for (const folder of data.folders) {
    const list = byParent.get(folder.parentId) ?? [];
    list.push(folder);
    byParent.set(folder.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const folderPos = new Map<string, Pt>();
  function place(folder: Folder, start: number, end: number, depth: number) {
    const angle = (start + end) / 2;
    const radius = 155 + depth * 92;
    const p = {
      x: CX + Math.cos(angle - Math.PI / 2) * radius,
      y: CY + Math.sin(angle - Math.PI / 2) * radius,
    };
    pos.set(`folder:${folder.id}`, p);
    folderPos.set(folder.id, p);
    const kids = byParent.get(folder.id) ?? [];
    if (kids.length) {
      const span = end - start;
      const pad = Math.min(span * 0.12, 0.16);
      const step = (span - pad * 2) / kids.length;
      kids.forEach((kid, i) => place(kid, start + pad + i * step, start + pad + (i + 1) * step, depth + 1));
    }
  }

  const roots = byParent.get(null) ?? [];
  if (roots.length) {
    const span = (Math.PI * 2) / roots.length;
    roots.forEach((root, i) => place(root, i * span, (i + 1) * span, 0));
  }

  // Items orbit their folder. With many items, the orbit becomes two or three
  // rings rather than one unreadable circle.
  const drawnItemIds = new Set(
    graph.nodes.filter((n) => n.kind === "item" && n.itemId).map((n) => n.itemId as string),
  );
  const itemsByFolder = new Map<string, Item[]>();
  for (const item of data.items) {
    if (!drawnItemIds.has(item.id)) continue;
    const key = item.folderId ?? "__root";
    const list = itemsByFolder.get(key) ?? [];
    list.push(item);
    itemsByFolder.set(key, list);
  }
  for (const [folderId, items] of itemsByFolder) {
    const center = folderId === "__root" ? { x: CX, y: CY } : folderPos.get(folderId);
    if (!center) continue;
    const inward = (byParent.get(folderId) ?? []).length > 0;
    items.forEach((item, i) => {
      const ring = Math.floor(i / 8);
      const offset = (i / Math.max(1, items.length)) * Math.PI * 2;
      const angle = inward ? Math.PI + offset : offset;
      const r = 38 + ring * 24;
      pos.set(`item:${item.id}`, {
        x: center.x + Math.cos(angle - Math.PI / 2) * r,
        y: center.y + Math.sin(angle - Math.PI / 2) * r,
      });
    });
  }

  // Profiles and their accounts.
  for (const profile of data.profiles) {
    const anchor = profile.folderId ? folderPos.get(profile.folderId) : { x: CX, y: CY };
    if (!anchor) continue;
    // Push the profile outward along the folder's own radius. Always offsetting
    // "up" put every profile directly on top of its folder label.
    const dx = anchor.x - CX;
    const dy = anchor.y - CY;
    const len = Math.hypot(dx, dy);
    const p =
      len > 1
        ? { x: anchor.x + (dx / len) * 72, y: anchor.y + (dy / len) * 72 }
        : { x: CX + 120, y: CY };
    pos.set(`profile:${profile.id}`, p);
    profile.accounts.forEach((account, i) => {
      const angle = (i / Math.max(1, profile.accounts.length)) * Math.PI * 2;
      pos.set(`account:${profile.id}:${account.id}`, {
        x: p.x + Math.cos(angle) * 29,
        y: p.y + Math.sin(angle) * 29,
      });
    });
  }

  // Outer tag ring.
  const placed = [...pos.values()];
  const maxR = placed.reduce((m, p) => Math.max(m, Math.hypot(p.x - CX, p.y - CY)), 150);
  const tags = graph.nodes.filter((n) => n.kind === "tag");
  const tagRadius = maxR + 82;
  tags.forEach((tag, i) => {
    const angle = (i / Math.max(1, tags.length)) * Math.PI * 2 - Math.PI / 2;
    pos.set(tag.id, {
      x: CX + Math.cos(angle) * tagRadius,
      y: CY + Math.sin(angle) * tagRadius,
    });
  });

  // Safety net: a node the layout did not know about still gets a home.
  let orphan = 0;
  for (const node of graph.nodes) {
    if (pos.has(node.id)) continue;
    const angle = orphan * 0.7;
    pos.set(node.id, {
      x: CX + Math.cos(angle) * (tagRadius + 24),
      y: CY + Math.sin(angle) * (tagRadius + 24),
    });
    orphan++;
  }
  // Server and browser V8 builds can differ in the last bits of a trig result.
  // An SVG attribute rendered at 17 decimal places then "changes" on hydration,
  // which React reports as a real mismatch. Two decimals is visually identical
  // and makes the markup stable.
  for (const [id, point] of pos) {
    pos.set(id, { x: round2(point.x), y: round2(point.y) });
  }
  return pos;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function MemoryBoard({ data, onOpenFolder, onOpenItem, onOpenProfile, onAsk }: Props) {
  const graph = useMemo(() => buildMemoryGraph(data), [data]);
  const positions = useMemo(() => layout(data, graph), [data, graph]);
  const profileFolderIds = useMemo(
    () => new Set(data.profiles.map((p) => p.folderId).filter((id): id is string => Boolean(id))),
    [data.profiles],
  );
  // Fit the drawing to the content. A fixed 1200×840 viewBox left most of the
  // screen empty on a small graph and shrank a large one; this keeps the web
  // using the canvas it actually needs.
  const viewport = useMemo(() => {
    const points = [...positions.values()];
    if (points.length === 0) return { x: 0, y: 0, w: W, h: H, cx: CX, cy: CY };
    const pad = 72;
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const w = Math.max(660, maxX - minX + pad * 2);
    const h = Math.max(470, maxY - minY + pad * 2);
    return {
      x: round2((minX + maxX) / 2 - w / 2),
      y: round2((minY + maxY) / 2 - h / 2),
      w: round2(w),
      h: round2(h),
      cx: round2((minX + maxX) / 2),
      cy: round2((minY + maxY) / 2),
    };
  }, [positions]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const hits = useMemo(() => (query.trim() ? searchMemory(graph, query) : []), [graph, query]);
  const active = useMemo(() => {
    if (!query.trim()) return null;
    const set = new Set<string>();
    for (const hit of hits) {
      set.add(hit.id);
      for (const n of memoryNeighbors(graph, hit.id)) set.add(n.node.id);
    }
    return set;
  }, [query, hits, graph]);

  const selected = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedNeighbors = selected ? memoryNeighbors(graph, selected.id) : [];

  // Wheel zoom has to be a non-passive native listener; React's synthetic
  // onWheel is passive at the root and cannot prevent the page from scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(2.4, Math.max(0.55, z - e.deltaY * 0.0012)));
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [graph.nodes.length]);

  const nodePos = (id: string): Pt => positions.get(id) ?? { x: CX, y: CY };

  function reset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function nodeActions(node: MemoryNode) {
    if (node.kind === "folder" && node.folderId) onOpenFolder(node.folderId);
    else if (node.kind === "item" && node.itemId) {
      const item = data.items.find((i) => i.id === node.itemId);
      if (item) onOpenItem(item);
    } else if (node.kind === "profile" && node.profileId) onOpenProfile(node.profileId);
    else if (node.kind === "account" && node.profileId) onOpenProfile(node.profileId);
  }

  return (
    <div>
      <header className="mb-4">
        <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          <Icon.Network width={12} height={12} /> Memory map
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Everything, connected</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              The folder tree is the source. This is the same records seen as a web — folders,
              profiles, notes, accounts and the tags that cut across them.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <Stat label="folders" value={graph.stats.folders} color={COLORS.folder} />
            <Stat label="records" value={graph.stats.items} color={COLORS.item} />
            <Stat label="profiles" value={graph.stats.profiles} color={COLORS.profile} />
            <Stat label="accounts" value={graph.stats.accounts} color={COLORS.account} />
            <Stat label="links" value={graph.stats.connections} color="var(--color-ink-faint)" />
          </div>
        </div>
      </header>

      {graph.nodes.length <= 1 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-20 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-brand">
            <Icon.Network width={22} height={22} />
          </div>
          <h2 className="text-base font-semibold text-ink">Your memory is empty</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-muted">
            Create a folder or a profile and it appears here immediately. There is no second copy
            to maintain — this map is drawn from the folders themselves.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="overflow-hidden rounded-2xl border border-line bg-[radial-gradient(circle_at_50%_45%,rgba(99,102,241,0.10),transparent_62%)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel/60 px-3 py-2">
              <div className="relative min-w-[180px] flex-1">
                <Icon.Search
                  width={13}
                  height={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the web — a domain, a person, a renewal…"
                  className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-8 pr-7 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-brand"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                    aria-label="Clear"
                  >
                    <Icon.Close width={11} height={11} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setZoom((z) => Math.min(2.4, z + 0.15))}
                  className="rounded-lg border border-line p-1.5 text-ink-faint hover:text-ink"
                  aria-label="Zoom in"
                >
                  <Icon.ZoomIn width={13} height={13} />
                </button>
                <button
                  onClick={() => setZoom((z) => Math.max(0.55, z - 0.15))}
                  className="rounded-lg border border-line p-1.5 text-ink-faint hover:text-ink"
                  aria-label="Zoom out"
                >
                  <Icon.ZoomOut width={13} height={13} />
                </button>
                <button
                  onClick={reset}
                  className="rounded-lg border border-line p-1.5 text-ink-faint hover:text-ink"
                  aria-label="Reset view"
                  title="Reset view"
                >
                  <Icon.Refresh width={13} height={13} />
                </button>
              </div>
            </div>

            {query && (
              <div className="border-b border-line bg-panel/40 px-3 py-2">
                {hits.length === 0 ? (
                  <p className="text-[10px] text-ink-faint">No node matches “{query}”.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {hits.slice(0, 8).map((hit) => (
                      <button
                        key={hit.id}
                        onClick={() => setSelectedId(hit.id)}
                        className="inline-flex max-w-[190px] items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] text-ink-muted hover:border-brand/40 hover:text-ink"
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: COLORS[hit.kind] }}
                        />
                        <span className="truncate">{hit.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <svg
              ref={svgRef}
              viewBox={`${viewport.x} ${viewport.y} ${viewport.w} ${viewport.h}`}
              className={
                "block h-[58vh] min-h-[430px] w-full touch-none select-none " +
                (drag ? "cursor-grabbing" : "cursor-grab")
              }
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                setDrag({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y });
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drag) return;
                setPan({ x: drag.px + (e.clientX - drag.x), y: drag.py + (e.clientY - drag.y) });
              }}
              onPointerUp={() => setDrag(null)}
              onPointerLeave={() => setDrag(null)}
            >
              <defs>
                <radialGradient id="memory-glow">
                  <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle
                cx={viewport.cx}
                cy={viewport.cy}
                r={round2(Math.max(viewport.w, viewport.h) * 0.32)}
                fill="url(#memory-glow)"
              />
              {[0.24, 0.4, 0.56].map((factor) => (
                <circle
                  key={factor}
                  cx={viewport.cx}
                  cy={viewport.cy}
                  r={round2(Math.max(viewport.w, viewport.h) * factor)}
                  fill="none"
                  stroke="var(--color-line)"
                  strokeWidth={1}
                  strokeDasharray="2 10"
                  opacity={0.35}
                />
              ))}
              {[0, 60, 120, 180, 240, 300].map((deg) => {
                const a = (deg * Math.PI) / 180;
                const r = Math.max(viewport.w, viewport.h) * 0.56;
                return (
                  <line
                    key={deg}
                    x1={viewport.cx}
                    y1={viewport.cy}
                    x2={round2(viewport.cx + Math.cos(a) * r)}
                    y2={round2(viewport.cy + Math.sin(a) * r)}
                    stroke="var(--color-line)"
                    strokeWidth={0.7}
                    opacity={0.18}
                  />
                );
              })}
              <g
                transform={`translate(${pan.x + viewport.cx * (1 - zoom)} ${pan.y + viewport.cy * (1 - zoom)}) scale(${zoom})`}
              >
                {graph.edges.map((edge) => {
                  const a = nodePos(edge.from);
                  const b = nodePos(edge.to);
                  const dim = active ? !(active.has(edge.from) && active.has(edge.to)) : false;
                  if (edge.kind === "tree") {
                    return (
                      <line
                        key={edge.id}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={COLORS.folder}
                        strokeWidth={0.8}
                        opacity={dim ? 0.05 : 0.28}
                      />
                    );
                  }
                  const mx = round2((a.x + b.x) / 2 + (b.y - a.y) * 0.08);
                  const my = round2((a.y + b.y) / 2 - (b.x - a.x) * 0.08);
                  const color =
                    edge.kind === "tag"
                      ? COLORS.tag
                      : edge.kind === "profile"
                        ? COLORS.profile
                        : edge.kind === "account"
                          ? COLORS.account
                          : COLORS.item;
                  return (
                    <path
                      key={edge.id}
                      d={`M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={edge.kind === "tag" ? 0.7 : 1}
                      strokeDasharray={edge.kind === "tag" ? "3 4" : edge.kind === "profile" ? "4 3" : undefined}
                      opacity={dim ? 0.04 : 0.38}
                    />
                  );
                })}

                {graph.nodes.map((node) => {
                  const p = nodePos(node.id);
                  const dim = active ? !active.has(node.id) : false;
                  const isSelected = selectedId === node.id;
                  const color = COLORS[node.kind];
                  const r =
                    node.kind === "root"
                      ? 26
                      : node.kind === "folder"
                        ? 14
                        : node.kind === "profile"
                          ? 20
                          : node.kind === "account"
                            ? 8.5
                            : node.kind === "tag"
                              ? 8
                              : 6;
                  const profileOwnsFolder =
                    node.kind === "folder" && node.folderId ? profileFolderIds.has(node.folderId) : false;
                  const showLabel =
                    node.kind === "root" ||
                    (node.kind === "folder" && !profileOwnsFolder) ||
                    node.kind === "profile" ||
                    node.kind === "tag" ||
                    isSelected ||
                    Boolean(query.trim() && active?.has(node.id));
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${p.x} ${p.y})`}
                      opacity={dim ? 0.13 : 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(node.id);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        nodeActions(node);
                      }}
                      className="cursor-pointer"
                    >
                      <title>{`${node.label} — ${KIND_LABEL[node.kind]}${node.detail ? ` · ${node.detail}` : ""}`}</title>
                      {node.kind === "root" ? (
                        <>
                          <circle r={r + 10} fill={color} opacity={0.12} />
                          <circle r={r} fill={color} opacity={0.9} />
                          <circle r={r - 5} fill="var(--color-canvas)" opacity={0.55} />
                        </>
                      ) : node.kind === "folder" ? (
                        <rect
                          x={-r}
                          y={-r * 0.78}
                          width={r * 2}
                          height={r * 1.56}
                          rx={3.5}
                          fill={color}
                          fillOpacity={0.22}
                          stroke={color}
                          strokeWidth={isSelected ? 2.4 : 1.3}
                        />
                      ) : node.kind === "tag" ? (
                        <rect
                          x={-r}
                          y={-r}
                          width={r * 2}
                          height={r * 2}
                          transform="rotate(45)"
                          fill={color}
                          fillOpacity={0.2}
                          stroke={color}
                          strokeWidth={1.2}
                        />
                      ) : (
                        <>
                          {node.kind === "profile" && (
                            <circle r={r + 5} fill="none" stroke={color} strokeWidth={1} opacity={0.35} />
                          )}
                          <circle
                            r={r}
                            fill={node.kind === "profile" ? color : "var(--color-canvas)"}
                            fillOpacity={node.kind === "profile" ? 0.85 : 1}
                            stroke={color}
                            strokeWidth={isSelected ? 2.4 : 1.4}
                          />
                        </>
                      )}
                      {showLabel && (
                        <text
                          y={r + 12}
                          textAnchor="middle"
                          fontSize={node.kind === "root" ? 13 : node.kind === "profile" ? 10.5 : 9.5}
                          fontWeight={node.kind === "root" || node.kind === "profile" ? 700 : 500}
                          fill={node.kind === "root" ? "var(--color-ink)" : "var(--color-ink-muted)"}
                          pointerEvents="none"
                        >
                          {short(node.label, node.kind === "item" ? 18 : 22)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-[9px] text-ink-faint">
              {(
                [
                  ["folder", "folder"],
                  ["item", "record"],
                  ["profile", "profile"],
                  ["account", "account"],
                  ["tag", "tag"],
                ] as const
              ).map(([kind, label]) => (
                <span key={kind} className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLORS[kind] }} />
                  {label}
                </span>
              ))}
              <span className="ml-auto hidden sm:inline">Drag to pan · scroll to zoom · double-click to open</span>
              {graph.stats.hiddenItems > 0 && (
                <span className="text-amber-300/70">+{graph.stats.hiddenItems} older records not drawn</span>
              )}
            </div>
          </div>

          <aside className="rounded-2xl border border-line bg-panel/50 p-3">
            {selected ? (
              <div>
                <div className="mb-2 flex items-start gap-2">
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: COLORS[selected.kind] }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                      {KIND_LABEL[selected.kind]}
                    </p>
                    <h2 className="mt-0.5 break-words text-sm font-semibold text-ink">{selected.label}</h2>
                  </div>
                  <button
                    onClick={() => setSelectedId(null)}
                    className="rounded p-0.5 text-ink-faint hover:text-ink"
                    aria-label="Close inspector"
                  >
                    <Icon.Close width={12} height={12} />
                  </button>
                </div>
                {selected.detail && (
                  <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">{selected.detail}</p>
                )}

                <div className="mb-3 space-y-1">
                  <button
                    onClick={() => nodeActions(selected)}
                    disabled={selected.kind === "tag" || selected.kind === "root"}
                    className="w-full rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => onAsk(`What do you know about “${selected.label}”? Where does it connect?`)}
                    className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-ink"
                  >
                    Ask Jarvis about this
                  </button>
                </div>

                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  Connections · {selectedNeighbors.length}
                </p>
                <div className="max-h-[240px] space-y-1 overflow-y-auto pr-0.5">
                  {selectedNeighbors.slice(0, 24).map(({ node, edge }) => (
                    <button
                      key={`${edge.id}-${node.id}`}
                      onClick={() => setSelectedId(node.id)}
                      className="flex w-full items-center gap-1.5 rounded-md border border-line/70 bg-canvas px-1.5 py-1 text-left text-[10px] text-ink-muted transition hover:border-brand/30 hover:text-ink"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: COLORS[node.kind] }}
                      />
                      <span className="min-w-0 flex-1 truncate">{node.label}</span>
                      <span className="shrink-0 text-[9px] text-ink-faint">{edge.label ?? edge.kind}</span>
                    </button>
                  ))}
                  {selectedNeighbors.length === 0 && (
                    <p className="text-[10px] text-ink-faint">No connections yet.</p>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
                  <Icon.Network width={17} height={17} />
                </div>
                <h2 className="text-sm font-semibold text-ink">How to read this</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                  Every node is a real folder, record, profile or account — nothing is copied into
                  the map. Click a dot to inspect it; double-click opens the thing itself.
                </p>
                <ul className="mt-3 space-y-1.5 text-[10px] leading-relaxed text-ink-faint">
                  <li>
                    <span className="text-violet-300">Violet</span> folders and sub-folders.
                  </li>
                  <li>
                    <span className="text-sky-300">Blue</span> records — notes, files, logins.
                  </li>
                  <li>
                    <span className="text-amber-300">Amber</span> profiles; green are their accounts.
                  </li>
                  <li>
                    <span className="text-rose-300">Pink</span> tags that tie distant things together.
                  </li>
                </ul>
                <div className="mt-3 rounded-lg border border-line bg-canvas p-2 text-[10px] leading-relaxed text-ink-faint">
                  Search dims everything except the matches and their neighbours — that is the RAG
                  view: the records, and how they connect.
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-panel px-2 py-1 text-ink-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <b className="tabular-nums text-ink">{value}</b> {label}
    </span>
  );
}
