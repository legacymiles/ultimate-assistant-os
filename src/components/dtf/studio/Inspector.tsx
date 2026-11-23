"use client";

import { AlignCenter, AlignHorizontalJustifyCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, Copy, Eraser, Italic, Lock, Maximize2, RotateCcw, Trash2, Unlock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { DESIGN_FONTS, getFont } from "@/lib/dtf/fonts";
import { getColor, getGarment, isDarkFabric } from "@/lib/dtf/garments";
import { effectiveDpi, getPrinter } from "@/lib/dtf/printers";
import { activeZone } from "@/lib/dtf/project";
import type { DesignOp, ImageLayer, Layer, TextLayer } from "@/lib/dtf/types";
import { Section } from "./panels";
import { useStudio } from "./useStudio";

function NumField({ label, value, unit, step = 0.1, onCommit, min, max }: { label: string; value: number; unit?: string; step?: number; min?: number; max?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n)) onCommit(Math.max(min ?? -1e9, Math.min(max ?? 1e9, n)));
    else setText(fmt(value));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-[var(--text-3)]">{label}</span>
      <span className="relative block">
        <input
          className="dtf-input mono pr-8"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              onCommit(Math.round((value + d) * 100) / 100);
            }
          }}
        />
        {unit && <span className="mono pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-3)]">{unit}</span>}
      </span>
    </label>
  );
}

function Slider({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void }) {
  const s = useStudio();
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <label className="block">
      <span className="mb-0.5 flex justify-between text-[11px] text-[var(--text-3)]">
        {label}
        <span className="mono text-[var(--text-2)]">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--fill" as string]: fill }}
        onPointerDown={s.beginGesture}
        onPointerUp={s.endGesture}
        onKeyUp={s.endGesture}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

const SWATCHES = ["#F4F1EA", "#FFFFFF", "#141416", "#5EE1FF", "#A796FF", "#FF5A4E", "#F5C56B", "#C8B08E", "#3BD38C", "#2546A8", "#B3242B", "#8B5A2B"];

export default function Inspector({ layer, onClose }: { layer: Layer; onClose: () => void }) {
  const s = useStudio();
  const { dispatch } = s;
  const live = (ops: DesignOp[]) => dispatch(ops, { history: false });
  const g = getGarment(s.project.garmentId);
  const fabric = getColor(g, s.project.colorId);
  const zone = activeZone(s.project, layer.side);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
        <h2 className="min-w-0 truncate text-[14px] font-semibold text-white">
          {layer.kind === "text" ? layer.text.split("\n")[0] : layer.name}
          {layer.kind === "image" && layer.origin !== "upload" && (
            <span className="ml-2 text-[11.5px] font-normal text-[var(--text-3)]">{layer.origin === "ai" ? "AI artwork" : "background removed"}</span>
          )}
        </h2>
        <button className="dtf-icon" onClick={onClose} aria-label="Close inspector">
          <X className="h-4 w-4" />
        </button>
      </div>

      {layer.kind === "text" && <TextControls t={layer} live={live} dark={isDarkFabric(fabric.hex)} />}
      {layer.kind === "image" && <ImageControls l={layer} />}

      <Section title="Position on garment">
        <div className="grid grid-cols-2 gap-2.5">
          <NumField label="Across (from centre)" value={layer.x} unit="cm" onCommit={(v) => dispatch([{ op: "move", layerId: layer.id, x: v }])} />
          <NumField label="Down from collar" value={-layer.y} unit="cm" min={-10} onCommit={(v) => dispatch([{ op: "move", layerId: layer.id, y: -v }])} />
          {layer.kind === "image" ? (
            <>
              <NumField label="Width" value={layer.w} unit="cm" min={0.5} max={60} onCommit={(v) => dispatch([{ op: "resize", layerId: layer.id, w: v }])} />
              <NumField label="Height" value={layer.h} unit="cm" min={0.5} max={60} onCommit={(v) => dispatch([{ op: "resize", layerId: layer.id, h: v }])} />
            </>
          ) : (
            <>
              <NumField label="Text size" value={(layer as TextLayer).fontSizeCm} unit="cm" min={0.2} max={30} onCommit={(v) => dispatch([{ op: "set-text", layerId: layer.id, fontSizeCm: v }])} />
              <div className="mono self-end pb-2 text-[11.5px] text-[var(--text-3)]">
                {fmt(layer.w)} × {fmt(layer.h)} cm
              </div>
            </>
          )}
        </div>
        <div className="mt-3 space-y-2">
          <Slider label="Rotation" value={layer.rotation} min={-180} max={180} step={1} display={`${Math.round(layer.rotation)}°`} onChange={(v) => live([{ op: "rotate", layerId: layer.id, rotation: v }])} />
          <Slider label="Opacity" value={layer.opacity} min={0.05} max={1} step={0.01} display={`${Math.round(layer.opacity * 100)}%`} onChange={(v) => live([{ op: "set-opacity", layerId: layer.id, opacity: v }])} />
          {layer.opacity < 1 && <p className="text-[11.5px] text-[var(--warn)]">See-through ink prints speckled on DTF. Keep opacity at 100% unless the fade is the point.</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button className="dtf-btn sm" onClick={() => dispatch([{ op: "center", layerId: layer.id, axis: "x" }])} title="Centre across">
            <AlignHorizontalJustifyCenter className="h-3.5 w-3.5" /> Centre
          </button>
          <button className="dtf-btn sm" onClick={() => dispatch([{ op: "center", layerId: layer.id, axis: "y" }])} title="Centre top to bottom in the print area">
            <AlignVerticalJustifyCenter className="h-3.5 w-3.5" /> Middle
          </button>
          {zone && (
            <button
              className="dtf-btn sm"
              title="Scale to fill the print area"
              onClick={() => {
                const sc = Math.min((zone.rect.w * 0.96) / layer.w, (zone.rect.h * 0.96) / layer.h);
                dispatch([
                  { op: "resize", layerId: layer.id, scale: sc },
                  { op: "move", layerId: layer.id, x: zone.rect.x, y: zone.rect.y },
                ]);
              }}
            >
              <Maximize2 className="h-3.5 w-3.5" /> Fill area
            </button>
          )}
        </div>
      </Section>

      <div className="flex items-center gap-1.5 px-5 py-4">
        <button
          className="dtf-btn sm"
          onClick={() => {
            const r = dispatch([{ op: "duplicate", layerId: layer.id }]);
            if (r.created[0]) s.setSelectedId(r.created[0]);
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Duplicate
        </button>
        <button className="dtf-btn sm" aria-pressed={layer.locked} onClick={() => s.replace({ ...s.project, layers: s.project.layers.map((x) => (x.id === layer.id ? { ...x, locked: !x.locked } : x)) })}>
          {layer.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {layer.locked ? "Unlock" : "Lock"}
        </button>
        <button
          className="dtf-btn sm danger ml-auto"
          disabled={layer.locked}
          onClick={() => {
            dispatch([{ op: "delete", layerId: layer.id }]);
            s.setSelectedId(null);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </div>
  );
}

function TextControls({ t, live, dark }: { t: TextLayer; live: (ops: DesignOp[]) => void; dark: boolean }) {
  const s = useStudio();
  const font = getFont(t.font);
  const [lo, hi] = font.weights.length === 2 && font.weights[0] !== font.weights[1] && !Array.isArray(font.file) ? (font.weights as [number, number]) : [Math.min(...font.weights), Math.max(...font.weights)];
  return (
    <>
      <Section title="Words">
        <textarea
          className="dtf-input text-[14px]"
          rows={Math.min(5, t.text.split("\n").length + 1)}
          value={t.text}
          onFocus={s.beginGesture}
          onBlur={s.endGesture}
          onChange={(e) => live([{ op: "set-text", layerId: t.id, text: e.target.value || " " }])}
          aria-label="Text"
          id="dtf-text-input"
        />
      </Section>
      <Section title="Typeface">
        <div className="grid grid-cols-1 gap-1">
          {DESIGN_FONTS.map((f) => (
            <button
              key={f.id}
              onClick={() => s.dispatch([{ op: "set-text", layerId: t.id, font: f.id, weight: Math.max(Math.min(t.weight, Math.max(...f.weights)), Math.min(...f.weights)) }])}
              className={`flex items-baseline justify-between rounded-[9px] px-2.5 py-1.5 text-left transition ${t.font === f.id ? "bg-[var(--accent-soft)] text-white" : "text-[var(--text-2)] hover:bg-white/[0.04]"}`}
            >
              <span className="truncate text-[16px]" style={{ fontFamily: `${f.family}, system-ui` }}>
                {f.label}
              </span>
              <span className="ml-2 shrink-0 text-[10.5px] text-[var(--text-3)]">{f.feel}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {hi > lo && <Slider label="Weight" value={t.weight} min={lo} max={hi} step={font.weights.length > 2 ? 100 : 50} display={String(t.weight)} onChange={(v) => live([{ op: "set-text", layerId: t.id, weight: v }])} />}
          <Slider label="Letter spacing" value={t.letterSpacing} min={-0.08} max={0.6} step={0.01} display={`${t.letterSpacing.toFixed(2)} em`} onChange={(v) => live([{ op: "set-text", layerId: t.id, letterSpacing: v }])} />
          {t.text.includes("\n") && <Slider label="Line height" value={t.lineHeight} min={0.7} max={2} step={0.01} display={t.lineHeight.toFixed(2)} onChange={(v) => live([{ op: "set-text", layerId: t.id, lineHeight: v }])} />}
        </div>
        <div className="mt-3 flex items-center gap-1">
          <div className="dtf-seg">
            {(["left", "center", "right"] as const).map((a) => {
              const I = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
              return (
                <button key={a} className="dtf-icon !h-7 !w-8" aria-pressed={t.align === a} aria-label={`Align ${a}`} onClick={() => s.dispatch([{ op: "set-text", layerId: t.id, align: a }])}>
                  <I className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
          <button className="dtf-icon !h-8 !w-9" aria-pressed={t.uppercase} aria-label="All caps" onClick={() => s.dispatch([{ op: "set-text", layerId: t.id, uppercase: !t.uppercase }])}>
            <span className="text-[11px] font-bold">AA</span>
          </button>
          <button className="dtf-icon !h-8 !w-9" aria-pressed={t.italic} aria-label="Italic" onClick={() => s.dispatch([{ op: "set-text", layerId: t.id, italic: !t.italic }])}>
            <Italic className="h-3.5 w-3.5" />
          </button>
        </div>
      </Section>
      <Section title="Ink colour">
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => (
            <button key={c} className="dtf-swatch !h-7 !w-7" style={{ background: c }} aria-pressed={t.color.toUpperCase() === c} aria-label={c} onClick={() => s.dispatch([{ op: "set-text", layerId: t.id, color: c }])} />
          ))}
          <label className="dtf-swatch relative !h-7 !w-7 overflow-hidden" style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }} title="Custom colour">
            <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={t.color} onChange={(e) => live([{ op: "set-text", layerId: t.id, color: e.target.value.toUpperCase() }])} onBlur={s.endGesture} onFocus={s.beginGesture} />
          </label>
          <span className="mono ml-1 text-[11px] text-[var(--text-3)]">{t.color}</span>
        </div>
        {contrastLow(t.color, dark) && <p className="mt-2 text-[11.5px] text-[var(--warn)]">This ink is close to the fabric colour and will be hard to read.</p>}
      </Section>
    </>
  );
}

function ImageControls({ l }: { l: ImageLayer }) {
  const s = useStudio();
  const [tol, setTol] = useState(18);
  const vector = l.mime === "image/svg+xml";
  const dpi = Math.min(effectiveDpi(l.naturalW, l.w), effectiveDpi(l.naturalH, l.h));
  const p = getPrinter();
  const tone = vector || dpi >= p.minGoodDpi ? "tone-ok" : dpi >= p.minAcceptableDpi ? "tone-info" : "tone-warn";
  const stats = s.stats[l.id];
  return (
    <Section title="Source">
      <div className="flex gap-3">
        <div className="dtf-artboard grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-[var(--line)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={l.src} alt="" className="max-h-full max-w-full object-contain" />
        </div>
        <div className="min-w-0 space-y-1 text-[12px]">
          <div className="mono text-[var(--text-2)]">{vector ? "Vector (SVG) — sharp at any size" : `${l.naturalW} × ${l.naturalH} px`}</div>
          {!vector && (
            <div className={`mono ${tone}`}>
              {Math.round(dpi)} DPI at {fmt(l.w)} cm
            </div>
          )}
          {!vector && <div className="text-[var(--text-3)]">Sharp up to {fmt((l.naturalW / p.minGoodDpi) * 2.54)} cm wide</div>}
          {stats && !vector && <div className="text-[var(--text-3)]">{stats.hasAlpha ? "Transparent background" : "Solid background"}</div>}
        </div>
      </div>
      {!vector && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <button className="dtf-btn sm" onClick={() => s.removeBg(l.id, tol)}>
              <Eraser className="h-3.5 w-3.5" /> Remove background
            </button>
            {l.sourceAssetId && (
              <button
                className="dtf-btn sm"
                onClick={() => {
                  const src = l.sourceAssetId!;
                  // The original's url: served files keep their id in the path; local ones are resolved by the hook.
                  const url = src.startsWith("ast_") ? `/api/dtf/assets/${src}` : null;
                  if (!url) return s.notify("The original is still uploading — try again in a moment.", "info");
                  const img = new Image();
                  img.onload = () =>
                    s.replace({
                      ...s.project,
                      layers: s.project.layers.map((x) =>
                        x.id === l.id && x.kind === "image" ? { ...x, assetId: src, src: url, origin: "upload", sourceAssetId: undefined, naturalW: img.naturalWidth, naturalH: img.naturalHeight, mime: "image/png" } : x,
                      ),
                    });
                  img.src = url;
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore original
              </button>
            )}
          </div>
          <Slider label="Background tolerance" value={tol} min={2} max={60} step={1} display={String(tol)} onChange={setTol} />
        </div>
      )}
    </Section>
  );
}

function contrastLow(ink: string, darkFabric: boolean): boolean {
  const n = parseInt(ink.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return darkFabric ? lum < 0.28 : lum > 0.82;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
