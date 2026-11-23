"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  CloudOff,
  Eye,
  EyeOff,
  Factory,
  FolderOpen,
  ImagePlus,
  Layers as LayersIcon,
  Loader2,
  Maximize2,
  Minus,
  Package,
  Plus,
  Redo2,
  Shirt,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadDrawable } from "@/lib/dtf/render";
import { getColor, getGarment } from "@/lib/dtf/garments";
import { photoFor } from "@/lib/dtf/mockups";
import { money, quote } from "@/lib/dtf/pricing";
import { loadDesignFonts } from "@/lib/dtf/fonts";
import { sideLayers } from "@/lib/dtf/project";
import { renderProductMockup } from "../mockup/photoRender";
import AiPanel from "./AiPanel";
import FlatEditor from "./FlatEditor";
import Inspector from "./Inspector";
import { AddPanel, CheckPanel, GarmentPanel, LayersPanel } from "./panels";
import { BagSheet, DesignsSheet, OrdersSheet, useBag } from "./sheets";
import { Filmstrip, PreviewPage, type Shot } from "./Showroom";
import { StudioContext, useStudio, useStudioState } from "./useStudio";

type Tool = "garment" | "upload" | "text" | "ai" | "layers" | "check";

const TOOLS: { id: Tool; label: string; icon: typeof Shirt }[] = [
  { id: "garment", label: "Product", icon: Shirt },
  { id: "upload", label: "Upload", icon: ImagePlus },
  { id: "text", label: "Text", icon: Type },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "layers", label: "Layers", icon: LayersIcon },
  { id: "check", label: "Check", icon: ShieldCheck },
];

/** Whole garment, then two steps in on the print area. */
const ZOOMS = [1, 1.45, 2.1];

function useMedia(q: string): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [q]);
  return m;
}

export default function StudioApp() {
  const studio = useStudioState();
  return (
    <StudioContext.Provider value={studio}>
      <Shell />
    </StudioContext.Provider>
  );
}

function Shell() {
  const s = useStudioContext();
  const desktop = useMedia("(min-width: 1024px)");
  const [tool, setTool] = useState<Tool>("garment");
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheet, setSheet] = useState<"bag" | "designs" | "orders" | null>(null);
  const [orderFocus, setOrderFocus] = useState<{ id: string; session: string | null } | null>(null);
  const [preview, setPreview] = useState<{ open: boolean; start: Shot | null }>({ open: false, start: null });
  const [zoomStep, setZoomStep] = useState(0);
  const bag = useBag();
  const q = useMemo(() => quote(s.project), [s.project]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadDesignFonts().then(() => s.remeasureText());
    const p = new URLSearchParams(window.location.search);
    const order = p.get("order");
    if (order) {
      setOrderFocus({ id: order, session: p.get("session_id") });
      setSheet("orders");
      if (p.get("cancelled")) s.notify("Payment was cancelled — your order is saved and waiting for payment.", "info");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Development only: lets scripts (checks, clip recorders) drive the studio.
  // Compiled out of production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __dtf?: unknown }).__dtf = {
      dispatch: s.dispatch,
      setMode: s.setMode,
      setSide: s.setSide,
      loadProject: s.loadProject,
      openPreview: () => setPreview({ open: true, start: null }),
    };
  }, [s]);

  // A new side or garment starts back on the whole-garment view.
  useEffect(() => setZoomStep(0), [s.side, s.project.garmentId]);

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (preview.open) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      const sel = s.selected;
      if (!sel) return;
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const r = s.dispatch([{ op: "duplicate", layerId: sel.id }]);
        if (r.created[0]) s.setSelectedId(r.created[0]);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        s.dispatch([{ op: "delete", layerId: sel.id }]);
        s.setSelectedId(null);
      } else if (e.key === "Escape") {
        s.setSelectedId(null);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const d = e.shiftKey ? 1 : 0.1;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0;
        s.dispatch([{ op: "move", layerId: sel.id, dx, dy }]);
      } else if (e.key === "Enter" && sel.kind === "text") {
        document.getElementById("dtf-text-input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, preview.open]);

  const addToBag = async () => {
    if (s.readiness.verdict === "block") {
      setPreview({ open: false, start: null });
      s.setSelectedId(null);
      setTool("check");
      setPanelOpen(true);
      s.notify(s.readiness.issues.find((i) => i.severity === "block")?.message ?? "Fix the print check first.", "error");
      return;
    }
    setAdding(true);
    try {
      await Promise.all(s.project.layers.filter((l) => l.kind === "image").map((l) => loadDrawable((l as { src: string }).src)));
      // The bag picture is the product shot of the side that carries the print.
      const side = q.printed.some((p) => p.side === "front") || !q.printed.length ? "front" : q.printed[0].side;
      const color = getColor(getGarment(s.project.garmentId), s.project.colorId);
      const photo = photoFor(s.project.garmentId, side);
      const canvas = photo ? await renderProductMockup(photo, color.hex, Boolean(color.heather), sideLayers(s.project, side), 720, "#F4F3F0") : null;
      const thumb = canvas ? canvas.toDataURL("image/png") : undefined;
      // A frozen copy: later edits in the studio never change what's in the bag.
      // (saveBag stores blob: images as local:<id>, which survive a reload.)
      bag.update([...bag.lines, { id: crypto.randomUUID(), project: structuredClone(s.project), quantity: 1, thumb, readiness: s.readiness }]);
      setPreview({ open: false, start: null });
      setSheet("bag");
      s.notify(`${s.project.name} added to your bag.`, "ok");
    } finally {
      setAdding(false);
    }
  };

  const pickTool = (t: Tool) => {
    const wasSelected = Boolean(s.selected);
    s.setSelectedId(null);
    if (!wasSelected && tool === t && panelOpen) setPanelOpen(false);
    else {
      setTool(t);
      setPanelOpen(true);
    }
  };

  const showPanel = panelOpen || Boolean(s.selected);
  const stageLeft = showPanel ? 18 + 404 + 16 : 18 + 64 + 16;

  const zoomControls = (
    <div className={`flex gap-2 ${desktop ? "flex-col" : "flex-row"}`}>
      <button className="dtf-chip-btn" onClick={() => setZoomStep((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomStep === ZOOMS.length - 1} aria-label="Zoom in on the print area" title="Zoom in">
        <Plus className="h-4 w-4" />
      </button>
      <button className="dtf-chip-btn" onClick={() => setZoomStep((z) => Math.max(0, z - 1))} disabled={zoomStep === 0} aria-label="Zoom out" title="Zoom out">
        <Minus className="h-4 w-4" />
      </button>
      <button className="dtf-chip-btn" onClick={() => setZoomStep(0)} disabled={zoomStep === 0} aria-label="Show the whole garment" title="Whole garment">
        <Maximize2 className="h-4 w-4" />
      </button>
      <button
        className="dtf-chip-btn"
        aria-pressed={s.mode === "preview"}
        onClick={() => s.setMode(s.mode === "edit" ? "preview" : "edit")}
        aria-label={s.mode === "preview" ? "Show the print area and handles" : "Hide the print area and handles"}
        title={s.mode === "preview" ? "Show guides" : "Hide guides"}
      >
        {s.mode === "preview" ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );

  return (
    <div className="dtf dtf-showroom fixed inset-0 overflow-hidden">
      {/* ----- Stage: the real garment, full bleed ----- */}
      <div
        className="absolute transition-[left] duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
        style={desktop ? { top: 76, bottom: 146, left: stageLeft, right: 76 } : { top: 56, left: 0, right: 0, height: "calc(46dvh - 8px)" }}
      >
        <FlatEditor side={s.side} zoom={ZOOMS[zoomStep]} />
      </div>
      <div className={desktop ? "absolute right-[18px] top-1/2 z-30 -translate-y-1/2" : "absolute right-2 z-30"} style={desktop ? undefined : { top: "calc(56px + 46dvh - 50px)" }}>
        {zoomControls}
      </div>

      {/* ----- Top bar ----- */}
      <header className="absolute left-3 right-3 top-2 z-40 flex h-[48px] items-center gap-2 lg:left-[22px] lg:right-[22px] lg:top-4 lg:h-[52px] lg:gap-3">
        <a href="/apps/dtf-studio" className="flex items-baseline gap-1.5 pr-1 text-[#101114]" aria-label="DTF Studio home">
          <span className="serif text-[25px] italic leading-none">DTF</span>
          <span className="hidden text-[10.5px] font-bold uppercase tracking-[0.22em] text-[#4a4f59] sm:inline">Studio</span>
        </a>
        <input
          className="hidden h-9 min-w-0 max-w-[220px] flex-1 rounded-[10px] bg-transparent px-2 text-[13.5px] font-semibold text-[#2b2f36] outline-none hover:bg-black/[0.04] focus:bg-white lg:block"
          value={s.project.name}
          onChange={(e) => s.rename(e.target.value)}
          aria-label="Design name"
        />
        <SaveBadge />
        <div className="ml-auto flex items-center gap-1.5 lg:gap-2">
          <button className="dtf-pill" onClick={s.undo} disabled={!s.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 className="h-4 w-4" />
          </button>
          <button className="dtf-pill" onClick={s.redo} disabled={!s.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="h-4 w-4" />
          </button>
          <button className="dtf-pill hidden lg:inline-flex" onClick={() => setPreview({ open: true, start: null })}>
            <Eye className="h-4 w-4" /> Preview
          </button>
          <button className="dtf-pill hidden lg:inline-flex" onClick={() => setSheet("designs")}>
            <FolderOpen className="h-4 w-4" /> Designs
          </button>
          <button className="dtf-pill hidden lg:inline-flex" onClick={() => setSheet("orders")}>
            <Package className="h-4 w-4" /> Orders
          </button>
          {s.caps?.owner && (
            <a className="dtf-pill hidden xl:inline-flex" href="/apps/dtf-production">
              <Factory className="h-4 w-4" /> Production
            </a>
          )}
          <button className="dtf-pill relative" onClick={() => setSheet("bag")} aria-label={`Bag, ${bag.lines.length} item${bag.lines.length === 1 ? "" : "s"}`}>
            <ShoppingBag className="h-4 w-4" />
            {bag.lines.length > 0 && <span className="mono absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#0b9fc4] px-1 text-[10px] font-bold text-white">{bag.lines.length}</span>}
          </button>
          <button className="dtf-buy" onClick={addToBag} disabled={adding || !s.loaded} data-standout="buy-pill">
            {adding && <Loader2 className="h-4 w-4 animate-spin" />}
            <span className="hidden sm:inline">Add to bag</span>
            <b className="mono">
              <RollingPrice cents={q.unitCents} />
            </b>
          </button>
        </div>
      </header>

      {/* ----- Desktop: the floating tool dock ----- */}
      {desktop && (
        <aside className="dtf-dock absolute bottom-[146px] left-[18px] top-[84px] z-30 flex overflow-hidden rounded-[22px]" style={{ width: showPanel ? 404 : 64 }} aria-label="Design tools">
          <nav className="flex w-16 flex-none flex-col items-center gap-1 bg-[#0b0c0f] py-2.5" aria-label="Tools">
            {TOOLS.map((t) => {
              const I = t.icon;
              const on = !s.selected && panelOpen && tool === t.id;
              const issue = t.id === "check" && s.readiness.verdict !== "ok" && s.readiness.verdict !== "info" && s.project.layers.length > 0;
              return (
                <button
                  key={t.id}
                  className={`relative flex w-[52px] flex-col items-center gap-1 rounded-[12px] py-2 text-[10px] font-semibold transition ${on ? (t.id === "ai" ? "bg-[var(--ai-soft)] text-[#d9d1ff]" : "bg-[var(--accent-soft)] text-[var(--accent)]") : "text-[var(--text-3)] hover:bg-white/[0.05] hover:text-[var(--text)]"}`}
                  onClick={() => pickTool(t.id)}
                  aria-pressed={on}
                >
                  <I className="h-[18px] w-[18px]" />
                  {t.label}
                  {issue && <span className={`absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full ${s.readiness.verdict === "block" ? "bg-[var(--block)]" : "bg-[var(--warn)]"}`} />}
                </button>
              );
            })}
          </nav>
          {showPanel && (
            <div className={`min-w-0 flex-1 ${tool === "ai" && !s.selected ? "overflow-hidden" : "dtf-scroll overflow-y-auto"}`}>
              {s.selected ? <Inspector layer={s.selected} onClose={() => s.setSelectedId(null)} /> : <ToolBody tool={tool} />}
            </div>
          )}
        </aside>
      )}

      {/* ----- Filmstrip: the sides you edit, then live mockups ----- */}
      <div className={desktop ? "absolute bottom-3 left-[18px] right-[18px] z-30 h-[124px]" : "absolute inset-x-2 z-30 h-[98px]"} style={desktop ? undefined : { top: "calc(56px + 46dvh)" }}>
        <Filmstrip compact={!desktop} onOpen={(shot) => setPreview({ open: true, start: shot })} />
      </div>

      {/* ----- Phone: tool tabs + sheet ----- */}
      {!desktop && (
        <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col" style={{ top: "calc(56px + 46dvh + 104px)" }}>
          <div className="dtf-dock mx-2 flex items-center justify-between rounded-[14px] p-1">
            {TOOLS.map((t) => {
              const I = t.icon;
              const on = tool === t.id && !s.selected;
              return (
                <button
                  key={t.id}
                  className={`flex flex-1 flex-col items-center gap-0.5 rounded-[10px] py-1.5 text-[10px] font-semibold ${on ? (t.id === "ai" ? "bg-[var(--ai-soft)] text-[#d9d1ff]" : "bg-[var(--accent-soft)] text-[var(--accent)]") : "text-[var(--text-3)]"}`}
                  onClick={() => {
                    s.setSelectedId(null);
                    setTool(t.id);
                  }}
                >
                  <I className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="dtf-dock dtf-scroll mx-2 mb-2 mt-2 min-h-0 flex-1 overflow-y-auto rounded-[14px]">
            {s.selected ? <Inspector layer={s.selected} onClose={() => s.setSelectedId(null)} /> : <div className={tool === "ai" ? "h-full" : ""}><ToolBody tool={tool} /></div>}
            <div className="flex gap-2 border-t border-[var(--line)] p-3">
              <button className="dtf-btn sm flex-1" onClick={() => setPreview({ open: true, start: null })}>
                <Eye className="h-3.5 w-3.5" /> Preview
              </button>
              <button className="dtf-btn sm flex-1" onClick={() => setSheet("designs")}>
                <FolderOpen className="h-3.5 w-3.5" /> Designs
              </button>
              <button className="dtf-btn sm flex-1" onClick={() => setSheet("orders")}>
                <Package className="h-3.5 w-3.5" /> Orders
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----- Busy + toast ----- */}
      <AnimatePresence>
        {s.busy && (
          <motion.div className="dtf-glass absolute left-1/2 top-[84px] z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-[12.5px]" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" /> {s.busy}
          </motion.div>
        )}
      </AnimatePresence>
      <Toast />

      <PreviewPage open={preview.open} start={preview.start} onClose={() => setPreview({ open: false, start: null })} onAdd={addToBag} adding={adding} />
      <BagSheet open={sheet === "bag"} onClose={() => setSheet(null)} bag={bag} />
      <DesignsSheet open={sheet === "designs"} onClose={() => setSheet(null)} />
      <OrdersSheet open={sheet === "orders"} onClose={() => setSheet(null)} focus={orderFocus} />
    </div>
  );
}

function ToolBody({ tool }: { tool: Tool }) {
  switch (tool) {
    case "garment":
      return <GarmentPanel />;
    case "upload":
      return <AddPanel show="upload" />;
    case "text":
      return <AddPanel show="text" />;
    case "ai":
      return <AiPanel />;
    case "layers":
      return <LayersPanel />;
    case "check":
      return <CheckPanel />;
  }
}

function SaveBadge() {
  const s = useStudioContext();
  const label =
    s.saveState === "saving" ? "Saving…" : s.saveState === "saved" ? "Saved" : s.saveState === "error" ? "Not saved" : s.caps?.signedIn ? "" : s.loaded && s.project.layers.length ? "On this device" : "";
  if (!label) return null;
  return (
    <span className={`hidden items-center gap-1 text-[11.5px] font-medium lg:flex ${s.saveState === "error" ? "text-[#9a6400]" : "text-[#6b707a]"}`}>
      {s.saveState === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : s.saveState === "error" || !s.caps?.signedIn ? <CloudOff className="h-3 w-3" /> : <Check className="h-3 w-3" />}
      {label}
    </span>
  );
}

function Toast() {
  const s = useStudioContext();
  const [shown, setShown] = useState(s.toast);
  useEffect(() => {
    setShown(s.toast);
    if (!s.toast) return;
    const t = setTimeout(() => setShown(null), s.toast.tone === "error" ? 7000 : 4500);
    return () => clearTimeout(t);
  }, [s.toast]);
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.id}
          role="status"
          className={`dtf-glass absolute bottom-[150px] left-1/2 z-[70] flex max-w-[min(520px,calc(100vw-24px))] -translate-x-1/2 items-start gap-2 rounded-[14px] px-4 py-3 text-[12.5px] leading-relaxed ${shown.tone === "error" ? "text-[#ffd0d0]" : shown.tone === "ok" ? "text-[#c9f5df]" : "text-[var(--text)]"}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
        >
          <span className="flex-1">{shown.text}</span>
          <button className="text-[var(--text-3)] hover:text-white" onClick={() => setShown(null)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A price that rolls to its new value instead of snapping. */
function RollingPrice({ cents }: { cents: number }) {
  const [shown, setShown] = useState(cents);
  const from = useRef(cents);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = cents;
    if (a === b) return;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 420);
      const e = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(a + (b - a) * e));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cents]);
  return <>{money(shown)}</>;
}

const useStudioContext = useStudio;
