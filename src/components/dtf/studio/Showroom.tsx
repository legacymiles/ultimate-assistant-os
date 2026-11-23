"use client";

// The showroom pieces around the stage: the filmstrip of live mockups along
// the bottom, and the full Preview page (worn, folded, hanging, flat lay, the
// product shots) with a download of each picture.

import { AnimatePresence, motion } from "motion/react";
import { Download, Loader2, ShoppingBag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getColor, getGarment, SIDE_LABEL } from "@/lib/dtf/garments";
import { photoFor, scenesFor, type Scene } from "@/lib/dtf/mockups";
import { money, quote } from "@/lib/dtf/pricing";
import { sideLayers } from "@/lib/dtf/project";
import { loadDrawable } from "@/lib/dtf/render";
import type { DesignProject, SideId } from "@/lib/dtf/types";
import { renderProductMockup, renderScene } from "../mockup/photoRender";
import { useStudio } from "./useStudio";

/** One thing the Preview can show: a product side or a lifestyle scene. */
export type Shot = { kind: "side"; side: SideId } | { kind: "scene"; scene: Scene };

export const shotKey = (s: Shot) => (s.kind === "side" ? `side:${s.side}` : `scene:${s.scene.id}`);
const shotLabel = (s: Shot) => (s.kind === "side" ? SIDE_LABEL[s.side] : s.scene.label);

// Renders run one at a time so a burst of edits never stacks up work.
let chain: Promise<unknown> = Promise.resolve();
function queue<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

async function renderShot(project: DesignProject, shot: Shot, size: number): Promise<HTMLCanvasElement | null> {
  const g = getGarment(project.garmentId);
  const color = getColor(g, project.colorId);
  const side = shot.kind === "side" ? shot.side : shot.scene.side;
  const layers = sideLayers(project, side);
  await Promise.all(layers.filter((l) => l.kind === "image").map((l) => loadDrawable((l as { src: string }).src)));
  if (shot.kind === "scene") return renderScene(shot.scene, color.hex, Boolean(color.heather), layers, size);
  const photo = photoFor(project.garmentId, side);
  return photo ? renderProductMockup(photo, color.hex, Boolean(color.heather), layers, size, "#F4F3F0") : null;
}

/** A rendered picture of one shot, redrawn (debounced) when the design changes. */
function useShot(project: DesignProject, shot: Shot, size: number, delay = 450): { url: string | null; busy: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const key = shotKey(shot);
  const last = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      void queue(() => renderShot(project, shot, size)).then((c) => {
        if (!live || !c) return;
        c.toBlob(
          (b) => {
            if (!live || !b) return;
            const u = URL.createObjectURL(b);
            if (last.current) URL.revokeObjectURL(last.current);
            last.current = u;
            setUrl(u);
            setBusy(false);
          },
          "image/jpeg",
          0.9,
        );
      });
    }, delay);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.layers, project.garmentId, project.colorId, key, size]);
  useEffect(() => () => void (last.current && URL.revokeObjectURL(last.current)), []);
  return { url, busy };
}

// ----- Filmstrip ----------------------------------------------------------------------------

function Tile({ shot, on, onClick, dot, compact }: { shot: Shot; on: boolean; onClick: () => void; dot?: boolean; compact?: boolean }) {
  const s = useStudio();
  const { url, busy } = useShot(s.project, shot, compact ? 180 : 220);
  return (
    <button className={`dtf-film-tile group ${compact ? "w-[76px]" : "w-[104px]"}`} aria-pressed={on} onClick={onClick} title={shot.kind === "scene" ? `${shot.scene.label} — ${shot.scene.note}` : `Edit the ${SIDE_LABEL[shot.side].toLowerCase()}`}>
      <span className={`relative block overflow-hidden rounded-[14px] border bg-[#f4f3f0] ${compact ? "h-[70px]" : "h-[92px]"} ${on ? "border-[#101114] shadow-[0_0_0_2px_#101114]" : "border-black/10 group-hover:border-black/25"}`}>
        {url ? <img src={url} alt="" className={`h-full w-full ${shot.kind === "scene" ? "object-cover" : "object-contain"} transition-opacity duration-300 ${busy ? "opacity-70" : ""}`} /> : <span className="absolute inset-0 animate-pulse bg-black/[0.04]" />}
        {dot && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#0b9fc4] ring-2 ring-white" />}
      </span>
      <span className={`mt-1 block truncate text-center text-[11.5px] font-semibold ${on ? "text-[#101114]" : "text-[#5b606a]"}`}>{shotLabel(shot)}</span>
    </button>
  );
}

export function Filmstrip({ onOpen, compact }: { onOpen: (shot: Shot) => void; compact?: boolean }) {
  const s = useStudio();
  const g = getGarment(s.project.garmentId);
  const scenes = useMemo(() => scenesFor(s.project.garmentId), [s.project.garmentId]);
  return (
    <div className="dtf-scroll flex h-full items-end gap-2.5 overflow-x-auto overflow-y-hidden pb-0.5" data-standout="live-mockups">
      <span className="dtf-film-tag" aria-hidden>Edit</span>
      {g.sides.map((side) => (
        <Tile
          key={side}
          compact={compact}
          shot={{ kind: "side", side }}
          on={s.side === side}
          dot={s.project.layers.some((l) => l.side === side && !l.hidden)}
          onClick={() => {
            s.setSide(side);
            s.setMode("edit");
          }}
        />
      ))}
      {scenes.length > 0 && (
        <>
          <span className="mx-1 mb-7 h-[76px] w-px flex-none bg-black/10" aria-hidden />
          <span className="dtf-film-tag" aria-hidden>Preview</span>
          {scenes.map((scene) => (
            <Tile key={scene.id} compact={compact} shot={{ kind: "scene", scene }} on={false} onClick={() => onOpen({ kind: "scene", scene })} />
          ))}
        </>
      )}
    </div>
  );
}

// ----- Preview page -------------------------------------------------------------------------

function BigShot({ shot }: { shot: Shot }) {
  const s = useStudio();
  const { url, busy } = useShot(s.project, shot, 1400, 120);
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[22px] bg-[#f1f0ec]">
      {url && <img src={url} alt={`${shotLabel(shot)} mockup of your design`} className={`h-full w-full ${shot.kind === "scene" ? "object-cover" : "object-contain"}`} />}
      {(busy || !url) && (
        <span className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-[#101114]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rendering
        </span>
      )}
      <span className="absolute bottom-4 left-4 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-[#101114]">{shot.kind === "scene" ? `${shot.scene.label} · ${shot.scene.note}` : `${SIDE_LABEL[shot.side]} · product shot`}</span>
    </div>
  );
}

function GridTile({ shot, on, onClick }: { shot: Shot; on: boolean; onClick: () => void }) {
  const s = useStudio();
  const { url } = useShot(s.project, shot, 520, 300);
  return (
    <button className="group text-left" onClick={onClick} aria-pressed={on}>
      <span className={`block aspect-square overflow-hidden rounded-[16px] border bg-[#f4f3f0] ${on ? "border-[#101114] shadow-[0_0_0_2px_#101114]" : "border-black/10 group-hover:border-black/25"}`}>
        {url ? <img src={url} alt="" className={`h-full w-full ${shot.kind === "scene" ? "object-cover" : "object-contain"}`} /> : <span className="block h-full w-full animate-pulse bg-black/[0.04]" />}
      </span>
      <span className={`mt-1.5 block text-[12.5px] font-semibold ${on ? "text-[#101114]" : "text-[#5b606a]"}`}>{shotLabel(shot)}</span>
    </button>
  );
}

export function PreviewPage({ open, start, onClose, onAdd, adding }: { open: boolean; start: Shot | null; onClose: () => void; onAdd: () => void; adding: boolean }) {
  const s = useStudio();
  const g = getGarment(s.project.garmentId);
  const color = getColor(g, s.project.colorId);
  const q = useMemo(() => quote(s.project), [s.project]);
  const shots = useMemo<Shot[]>(() => {
    const printed = new Set(s.project.layers.filter((l) => !l.hidden).map((l) => l.side));
    const sides: Shot[] = g.sides.filter((side) => side === "front" || printed.has(side)).map((side) => ({ kind: "side", side }));
    return [...scenesFor(s.project.garmentId).map((scene) => ({ kind: "scene" as const, scene })), ...sides];
  }, [s.project.garmentId, s.project.layers, g.sides]);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    if (open) setPick(start ? shotKey(start) : null);
  }, [open, start]);
  const current = shots.find((x) => shotKey(x) === pick) ?? shots[0];
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const download = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const c = await queue(() => renderShot(s.project, current, 2000));
      if (!c) return;
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(s.project.name || "design").replace(/[^\w-]+/g, "-").toLowerCase()}-${shotKey(current).replace(":", "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && current && (
        <motion.section
          key="preview"
          role="dialog"
          aria-modal="true"
          aria-label="Preview mockups"
          className="dtf-light absolute inset-0 z-[60] overflow-y-auto bg-[#fbfaf8]"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
        >
          <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 pb-10 pt-4 lg:px-10 lg:pt-8">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[26px] font-bold tracking-[-0.01em] text-[#101114] lg:text-[30px]">Preview</h2>
                <p className="mt-1 text-[13.5px] text-[#6b707a]">
                  {g.name} in {color.name} — your print, in your colour, on the real garment.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-[12px] border border-black/10 bg-white" role="tablist" aria-label="Mode">
                  <button role="tab" aria-selected={false} className="px-4 py-2 text-[13.5px] font-semibold text-[#4a4f59] hover:bg-black/[0.03]" onClick={onClose}>
                    Edit
                  </button>
                  <button role="tab" aria-selected className="bg-[#101114] px-4 py-2 text-[13.5px] font-semibold text-white">
                    Preview
                  </button>
                </div>
                <button className="grid h-10 w-10 place-items-center rounded-full border border-black/10 bg-white text-[#101114] hover:bg-black/[0.03]" onClick={onClose} aria-label="Close the preview">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
              <div className="aspect-square w-full flex-none lg:w-[min(calc(100dvh-150px),58vw)]">
                <BigShot shot={current} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  {shots.map((x) => (
                    <GridTile key={shotKey(x)} shot={x} on={shotKey(x) === shotKey(current)} onClick={() => setPick(shotKey(x))} />
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-black/15 bg-white px-5 text-[14px] font-semibold text-[#101114] hover:bg-black/[0.03] disabled:opacity-60" onClick={download} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download mockup
                  </button>
                  <button className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-[#101114] px-5 text-[14px] font-semibold text-white hover:bg-black disabled:opacity-60" onClick={onAdd} disabled={adding}>
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />} Add to bag · {money(q.unitCents)}
                  </button>
                </div>
                <p className="text-[12px] leading-relaxed text-[#8a8f99]">
                  Mockups are for seeing the design — colour on screen varies. What we press is the print file: your artwork only, at its exact size.
                </p>
              </div>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
