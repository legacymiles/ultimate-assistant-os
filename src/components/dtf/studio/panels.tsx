"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Info,
  Lock,
  Type,
  Unlock,
  Upload,
  XCircle,
} from "lucide-react";
import { useRef } from "react";
import { GARMENTS, getColor, getGarment, isDarkFabric, SIDE_LABEL, zonesFor } from "@/lib/dtf/garments";
import { money, LOCATION_CENTS } from "@/lib/dtf/pricing";
import { activeZone } from "@/lib/dtf/project";
import type { FontId, Layer, ReadinessIssue, SideId } from "@/lib/dtf/types";
import { useStudio } from "./useStudio";

export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--line)] px-5 py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="dtf-label">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ----- Garment ---------------------------------------------------------------------

export function GarmentPanel() {
  const s = useStudio();
  const { project, dispatch } = s;
  const g = getGarment(project.garmentId);
  const color = getColor(g, project.colorId);
  return (
    <div>
      <Section title="Garment">
        <div className="grid grid-cols-2 gap-2">
          {GARMENTS.map((x) => {
            const on = x.id === g.id;
            return (
              <button
                key={x.id}
                onClick={() => dispatch([{ op: "set-garment", garmentId: x.id }])}
                aria-pressed={on}
                className={`group rounded-[12px] border px-3 py-2.5 text-left transition ${on ? "border-[rgba(94,225,255,0.5)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-white/[0.02] hover:border-[var(--line-2)]"}`}
              >
                <span className="serif block text-[17px] leading-tight text-white">{x.name}</span>
                <span className="mt-0.5 block text-[11.5px] text-[var(--text-3)]">{x.line}</span>
                <span className="mono mt-1.5 block text-[11px] text-[var(--text-2)]">from {money(x.baseCents)}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Fabric colour" aside={<span className="text-[12px] text-[var(--text-2)]">{color.name}</span>}>
        <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Fabric colour">
          {g.colors.map((c) => (
            <button
              key={c.id}
              className="dtf-swatch"
              style={{ background: c.heather ? `repeating-linear-gradient(45deg, ${c.hex}, ${c.hex} 2px, ${shade(c.hex, 14)} 2px, ${shade(c.hex, 14)} 3px)` : c.hex }}
              aria-pressed={c.id === color.id}
              aria-label={c.name}
              title={c.name}
              onClick={() => dispatch([{ op: "set-color", colorId: c.id }])}
            />
          ))}
        </div>
      </Section>
      <Section title="Size">
        <div className="flex flex-wrap gap-1.5">
          {g.sizes.map((sz) => (
            <button
              key={sz}
              className="dtf-chip mono"
              aria-pressed={project.size === sz}
              onClick={() => s.replace({ ...project, size: sz, updatedAt: new Date().toISOString() })}
            >
              {sz}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[12px] text-[var(--text-3)]">
          {g.fit} · {g.fabric}, {g.weightGsm} gsm
        </p>
      </Section>
      <Section title="Print placement">
        <div className="space-y-3">
          {g.sides.map((side) => (
            <div key={side}>
              <div className="mb-1.5 text-[12px] text-[var(--text-2)]">{SIDE_LABEL[side]}</div>
              <div className="flex flex-wrap gap-1.5">
                {zonesFor(g, side).map((z) => (
                  <button
                    key={z.id}
                    className="dtf-chip"
                    aria-pressed={activeZone(project, side)?.id === z.id}
                    title={z.hint}
                    onClick={() => {
                      s.setSide(side);
                      dispatch([{ op: "set-placement", side, zoneId: z.id }]);
                    }}
                  >
                    {z.label}
                    <span className="mono text-[10.5px] opacity-60">
                      {z.rect.w}×{z.rect.h}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-3)]">Each printed side is one transfer. A side only costs extra once it has artwork on it.</p>
      </Section>
    </div>
  );
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ----- Add ---------------------------------------------------------------------------

const TEXT_PRESETS: { label: string; text: string; font: FontId; weight: number; size: number; tracking: number; upper: boolean; italic?: boolean }[] = [
  { label: "Headline", text: "MAKE IT LOUD", font: "archivo-black", weight: 400, size: 3.2, tracking: 0.01, upper: true },
  { label: "Editorial", text: "Atelier No. 7", font: "instrument-serif", weight: 400, size: 3.6, tracking: -0.01, upper: false, italic: true },
  { label: "Wide tag", text: "STUDIO SERIES", font: "syne", weight: 700, size: 1.4, tracking: 0.32, upper: true },
  { label: "Racing", text: "TEAM 24", font: "chakra-petch", weight: 700, size: 2.8, tracking: 0.04, upper: true },
  { label: "Tech", text: "SYS/ONLINE", font: "oxanium", weight: 600, size: 2.2, tracking: 0.12, upper: true },
  { label: "Utility", text: "EST. 2026 — OHIO", font: "jetbrains-mono", weight: 500, size: 1.1, tracking: 0.08, upper: true },
];

export function AddPanel({ show = "all" }: { show?: "all" | "upload" | "text" } = {}) {
  const s = useStudio();
  const file = useRef<HTMLInputElement>(null);
  const zone = activeZone(s.project, s.side);
  return (
    <div>
      {show !== "text" && (
      <Section title={`Artwork · ${SIDE_LABEL[s.side]}`}>
        <button
          onClick={() => file.current?.click()}
          className="group flex w-full flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-[var(--line-2)] bg-white/[0.02] px-4 py-7 text-center transition hover:border-[rgba(94,225,255,0.55)] hover:bg-[var(--accent-soft)]"
        >
          <Upload className="h-5 w-5 text-[var(--accent)] transition group-hover:-translate-y-0.5" />
          <span className="text-[13.5px] font-semibold text-white">Upload artwork</span>
          <span className="text-[12px] text-[var(--text-3)]">PNG, JPG, WebP or SVG · up to 25 MB</span>
          <span className="text-[11.5px] text-[var(--text-3)]">Transparent PNG or SVG prints cleanest</span>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void s.addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {zone && (
          <p className="mt-2.5 text-[12px] text-[var(--text-3)]">
            Lands centred in <span className="text-[var(--text-2)]">{zone.label}</span> ({zone.rect.w} × {zone.rect.h} cm). For a sharp print at that size, aim for{" "}
            <span className="mono text-[var(--text-2)]">{Math.round((zone.rect.w / 2.54) * 300)} px</span> wide.
          </p>
        )}
      </Section>
      )}
      {show !== "upload" && (
      <Section title={show === "text" ? `Text · ${SIDE_LABEL[s.side]}` : "Text"}>
        <div className="grid grid-cols-2 gap-2">
          {TEXT_PRESETS.map((t) => (
            <button
              key={t.label}
              className="rounded-[12px] border border-[var(--line)] bg-white/[0.02] px-3 py-3 text-left transition hover:border-[var(--line-2)] hover:bg-white/[0.04]"
              onClick={() => {
                const z = activeZone(s.project, s.side)?.rect;
                const r = s.dispatch([
                  {
                    op: "add-text",
                    side: s.side,
                    text: t.text,
                    x: z?.x ?? 0,
                    y: z ? z.y + z.h * 0.25 : -15,
                    font: t.font,
                    weight: t.weight,
                    fontSizeCm: Math.min(t.size, (z?.w ?? 28) / 6),
                    letterSpacing: t.tracking,
                    uppercase: t.upper,
                    italic: t.italic,
                    color: isDarkFabric(getColor(getGarment(s.project.garmentId), s.project.colorId).hex) ? "#F4F1EA" : "#141416",
                  },
                ]);
                if (r.created[0]) s.setSelectedId(r.created[0]);
              }}
            >
              <span className="block truncate text-[15px] text-white" style={{ fontFamily: `dtf-${t.font}, system-ui`, fontWeight: t.weight, letterSpacing: `${t.tracking}em`, fontStyle: t.italic ? "italic" : undefined }}>
                {t.upper ? t.text.toUpperCase() : t.text}
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-3)]">{t.label}</span>
            </button>
          ))}
        </div>
      </Section>
      )}
    </div>
  );
}

// ----- Layers ---------------------------------------------------------------------------

export function LayersPanel() {
  const s = useStudio();
  const g = getGarment(s.project.garmentId);
  return (
    <div>
      {g.sides.map((side) => {
        const layers = s.project.layers.filter((l) => l.side === side);
        return (
          <Section key={side} title={SIDE_LABEL[side]} aside={<span className="mono text-[11px] text-[var(--text-3)]">{layers.length}</span>}>
            {!layers.length ? (
              <p className="text-[12px] text-[var(--text-3)]">Nothing printed here.</p>
            ) : (
              <ul className="space-y-1">
                {[...layers].reverse().map((l) => (
                  <LayerRow key={l.id} layer={l} side={side} />
                ))}
              </ul>
            )}
          </Section>
        );
      })}
      <p className="px-5 pb-5 text-[11.5px] text-[var(--text-3)]">Top of the list prints on top.</p>
    </div>
  );
}

function LayerRow({ layer: l, side }: { layer: Layer; side: SideId }) {
  const s = useStudio();
  const on = s.selectedId === l.id;
  return (
    <li
      className={`group flex items-center gap-2 rounded-[10px] px-2 py-1.5 transition ${on ? "bg-[var(--accent-soft)]" : "hover:bg-white/[0.04]"}`}
      onClick={() => {
        s.setSelectedId(l.id);
        s.setSide(side);
      }}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[7px] border border-[var(--line)] bg-black/30">
        {l.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.src} alt="" className="h-full w-full object-contain" />
        ) : (
          <Type className="h-3.5 w-3.5 text-[var(--text-2)]" />
        )}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[12.5px] ${l.hidden ? "text-[var(--text-3)] line-through" : "text-[var(--text)]"}`}>{l.kind === "text" ? l.text.split("\n")[0] : l.name}</span>
      <span className="flex items-center opacity-60 transition group-hover:opacity-100">
        <button className="dtf-icon !h-7 !w-7" title="Move up" onClick={(e) => (e.stopPropagation(), s.dispatch([{ op: "reorder", layerId: l.id, to: "forward" }]))}>
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button className="dtf-icon !h-7 !w-7" title="Move down" onClick={(e) => (e.stopPropagation(), s.dispatch([{ op: "reorder", layerId: l.id, to: "backward" }]))}>
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          className="dtf-icon !h-7 !w-7"
          title={l.hidden ? "Show" : "Hide"}
          aria-pressed={l.hidden}
          onClick={(e) => {
            e.stopPropagation();
            s.replace({ ...s.project, layers: s.project.layers.map((x) => (x.id === l.id ? { ...x, hidden: !x.hidden } : x)) });
          }}
        >
          {l.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button
          className="dtf-icon !h-7 !w-7"
          title={l.locked ? "Unlock" : "Lock"}
          aria-pressed={l.locked}
          onClick={(e) => {
            e.stopPropagation();
            s.replace({ ...s.project, layers: s.project.layers.map((x) => (x.id === l.id ? { ...x, locked: !x.locked } : x)) });
          }}
        >
          {l.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        </button>
      </span>
    </li>
  );
}

// ----- Print check -----------------------------------------------------------------------

const TONE: Record<ReadinessIssue["severity"], { icon: typeof Info; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: "tone-ok", label: "Ready" },
  info: { icon: Info, cls: "tone-info", label: "Note" },
  warn: { icon: AlertTriangle, cls: "tone-warn", label: "Check" },
  block: { icon: XCircle, cls: "tone-block", label: "Must fix" },
};

export function CheckPanel() {
  const s = useStudio();
  const r = s.readiness;
  const t = TONE[r.verdict];
  const Icon = t.icon;
  return (
    <div>
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-full bg-white/[0.04] ${t.cls}`}>
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-white">
              {r.verdict === "block" ? "Not printable yet" : r.verdict === "warn" ? "Printable — worth a look" : "Ready for production review"}
            </div>
            <div className="text-[12px] text-[var(--text-3)]">Lancelot M1630 Pro · {s.caps?.safeWidthMm ?? 290} mm safe width · 300 DPI target</div>
          </div>
        </div>
      </div>
      {Object.entries(r.sides).length > 0 && (
        <Section title="Transfers">
          <div className="space-y-1.5">
            {Object.entries(r.sides).map(([side, d]) => (
              <div key={side} className="flex items-baseline justify-between text-[12.5px]">
                <span className="text-[var(--text-2)]">{SIDE_LABEL[side as SideId]}</span>
                <span className="mono text-[var(--text)]">
                  {d!.widthCm.toFixed(1)} × {d!.heightCm.toFixed(1)} cm{d!.minDpi !== null && <span className="text-[var(--text-3)]"> · {d!.minDpi} dpi</span>}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title="Checks">
        <ul className="space-y-2.5">
          {r.issues.map((i, n) => {
            const tone = TONE[i.severity];
            const I = tone.icon;
            const layer = i.layerId ? s.project.layers.find((l) => l.id === i.layerId) : null;
            return (
              <li key={n} className="flex gap-2.5">
                <I className={`mt-0.5 h-4 w-4 shrink-0 ${tone.cls}`} />
                <div className="min-w-0 text-[12.5px] leading-relaxed">
                  <p className="text-[var(--text)]">{i.message}</p>
                  {i.fix && <p className="text-[var(--text-3)]">{i.fix}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {layer && (
                      <button className="dtf-btn sm" onClick={() => (s.setSelectedId(layer.id), s.setSide(layer.side))}>
                        Select layer
                      </button>
                    )}
                    {layer?.kind === "image" && (i.check === "transparency" || i.check === "background") && (
                      <button className="dtf-btn sm" onClick={() => s.removeBg(layer.id)}>
                        Remove background
                      </button>
                    )}
                    {layer && (i.check === "placement" || i.check === "printer-width") && (
                      <button
                        className="dtf-btn sm"
                        onClick={() => {
                          const z = activeZone(s.project, layer.side)?.rect;
                          if (!z) return;
                          const sc = Math.min(1, (z.w * 0.95) / layer.w, (z.h * 0.95) / layer.h);
                          s.dispatch([
                            { op: "resize", layerId: layer.id, scale: sc },
                            { op: "move", layerId: layer.id, x: z.x, y: z.y },
                          ]);
                        }}
                      >
                        Fit to print area
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Handled by ColorboxRIP, not here">
        <p className="text-[12px] leading-relaxed text-[var(--text-3)]">
          Colour conversion, white underbase, ink limits and mirroring are set by the shop in ColorboxRIP with the printer&apos;s profile. Your file goes to print exactly as you see it, artwork only.
        </p>
      </Section>
    </div>
  );
}

export function LayerThumbIcon({ kind }: { kind: Layer["kind"] }) {
  return kind === "image" ? <ImageIcon className="h-3.5 w-3.5" /> : <Type className="h-3.5 w-3.5" />;
}

export { LOCATION_CENTS };
