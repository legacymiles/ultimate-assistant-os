"use client";

// Image Studio › Inspire › Prompt Builder — build a detailed image prompt by
// clicking chips instead of writing. Choose what you're making, pick
// ingredients from the library, watch the live prompt assemble itself, add
// style references, then draw it. The technical rules for the deliverable are
// applied by assemble(); they only surface under "Behind the scenes".

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { assemble } from "@/lib/image-studio/inspire/assemble";
import { recommend } from "@/lib/image-studio/inspire/discover";
import type { InspireImage } from "@/lib/image-studio/inspire/types";
import { api } from "./api";
import { useInspire, type BuilderState } from "./store";
import { ChipLibrary } from "./builder/ChipLibrary";
import { BehindTheScenes, DeliverablePicker } from "./builder/Deliverables";
import { Generate } from "./builder/Generate";
import { ImportPrompts } from "./builder/ImportPrompts";
import { LivePrompt } from "./builder/LivePrompt";
import { References } from "./builder/References";
import { SmartTools, type Tool } from "./builder/SmartTools";
import { Tray } from "./builder/Tray";

const ORIGIN_VERB: Record<NonNullable<BuilderState["origin"]>["kind"], string> = {
  remix: "Remixing",
  reverse: "Reverse-engineered from",
  prompt: "Loaded from saved prompt",
  translate: "Translated from",
};

export function Builder() {
  const { builder, setBuilder } = useInspire();
  const [gallery, setGallery] = useState<InspireImage[]>([]);
  const [tool, setTool] = useState<Tool>(null);
  const [focusIdea, setFocusIdea] = useState(0);
  const [importing, setImporting] = useState(false);
  const ideaRef = useRef<HTMLTextAreaElement>(null);

  // Shared images feed the "shows up alongside your ingredients" signal.
  useEffect(() => {
    let live = true;
    api
      .get<{ images: InspireImage[] }>("/images?scope=public")
      .then((r) => live && setGallery(r.images))
      .catch(() => {
        /* recommendations still work from the chip library alone */
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!focusIdea || tool !== "translate") return;
    const el = ideaRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, [focusIdea, tool]);

  const assembled = useMemo(
    () =>
      assemble({
        chips: builder.chips,
        freeText: builder.freeText,
        override: builder.override,
        deliverable: builder.deliverable,
        refs: builder.refs.map((r) => ({ purpose: r.purpose, name: r.name })),
      }),
    [builder.chips, builder.freeText, builder.override, builder.deliverable, builder.refs],
  );
  const recs = useMemo(() => recommend(builder.chips, gallery, builder.deliverable, 12), [builder.chips, gallery, builder.deliverable]);

  const startIdea = () => {
    setTool("translate");
    setFocusIdea((n) => n + 1);
  };

  const origin = builder.origin;
  const originalIdx = origin && builder.history.length ? builder.history.length - 1 : null;
  const original = originalIdx !== null ? builder.history[originalIdx] : null;

  return (
    <div className="insp-builder">
      <style>{CSS}</style>
      <header className="insp-page-head">
        <div style={{ display: "grid", gap: 8 }}>
          <h1 className="insp-h1" style={{ margin: 0 }}>
            Prompt Builder
          </h1>
          <p className="insp-muted" style={{ margin: 0, maxWidth: 520 }}>
            Click ingredients instead of writing. The prompt assembles itself, the technical details are handled for you, and every image you draw is kept in My Library.
          </p>
        </div>
        <div className="insp-mono insp-faint" style={{ fontSize: 10.5, letterSpacing: ".1em", textAlign: "right", lineHeight: 1.8 }}>
          {assembled.deliverable.label.toUpperCase()}
          <br />
          {builder.chips.length} CHIP{builder.chips.length === 1 ? "" : "S"} · {builder.refs.length} REF{builder.refs.length === 1 ? "" : "S"}
        </div>
      </header>

      {origin && (
        <div className="b-origin" role="status">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span className="b-origin-dot" aria-hidden />
            <span className="insp-kicker" style={{ flex: "none" }}>
              {ORIGIN_VERB[origin.kind]}
            </span>
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{origin.label}</span>
            <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" style={{ marginLeft: "auto", flex: "none" }} aria-label="Dismiss" onClick={() => setBuilder((b) => ({ ...b, origin: null }))}>
              <X size={14} />
            </button>
          </div>
          {original && (
            <details className="b-details">
              <summary>
                <ChevronDown size={14} className="b-caret" aria-hidden />
                Original prompt <span className="insp-faint" style={{ fontWeight: 400 }}>— kept untouched</span>
              </summary>
              <p className="b-original">{original}</p>
            </details>
          )}
        </div>
      )}

      <div className="b-grid">
        <DeliverablePicker />
        <ChipLibrary recs={recs} />
        <div className="b-work">
          <Tray recs={recs} onImport={() => setImporting(true)} onIdea={startIdea} />
          <LivePrompt assembled={assembled} hiddenHistory={originalIdx}>
            <SmartTools ref={ideaRef} visible={assembled.visible} recs={recs} tool={tool} setTool={setTool} />
            <BehindTheScenes assembled={assembled} />
          </LivePrompt>
          <References />
          <Generate assembled={assembled} />
        </div>
      </div>

      <ImportPrompts open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

// Scoped to .insp-builder; the shared look lives in inspire.css.
const CSS = `
.insp-builder .b-grid { display: grid; gap: 22px 32px; grid-template-columns: minmax(0, 1fr); grid-template-areas: "deliv" "lib" "work"; }
.insp-builder .b-deliv { grid-area: deliv; min-width: 0; }
.insp-builder .b-lib { grid-area: lib; min-width: 0; }
.insp-builder .b-work { grid-area: work; min-width: 0; display: flex; flex-direction: column; gap: 26px; }
@media (min-width: 1100px) {
  .insp-builder .b-grid { grid-template-columns: 340px minmax(0, 1fr); grid-template-rows: auto 1fr; grid-template-areas: "lib deliv" "lib work"; }
  .insp-builder .b-lib { position: sticky; top: 16px; align-self: start; max-height: calc(100dvh - 32px); display: flex; flex-direction: column; border-right: 1px solid var(--line); padding-right: 22px; }
  .insp-builder .b-lib-toggle { display: none; }
  .insp-builder .b-lib-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .insp-builder .b-lib-list { overflow: auto; flex: 1; min-height: 0; overscroll-behavior: contain; }
}
@media (max-width: 1099px) {
  .insp-builder .b-lib-toggle { width: 100%; justify-content: flex-start; height: 44px; border-radius: 14px; }
  .insp-builder .b-lib-body { margin-top: 10px; display: flex; flex-direction: column; }
  .insp-builder .b-lib-body[data-open="false"] { display: none; }
  .insp-builder .b-lib-list { max-height: 56dvh; overflow: auto; overscroll-behavior: contain; }
}

.insp-builder .b-sec-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; min-height: 30px; }
.insp-builder .b-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.insp-builder .b-link { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; font: inherit; }
.insp-builder .b-dot { width: 7px; height: 7px; border-radius: 99px; flex: none; background: oklch(0.78 0.16 var(--h)); box-shadow: 0 0 8px oklch(0.78 0.16 var(--h) / 0.8); }

/* deliverables */
.insp-builder .b-deliv-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
@media (max-width: 1399px) and (min-width: 861px) { .insp-builder .b-deliv-strip { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); } }
@media (max-width: 860px) {
  .insp-builder .b-deliv-strip { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; margin: 0 -14px; padding: 0 14px 2px; }
  .insp-builder .b-deliv-strip::-webkit-scrollbar { display: none; }
  .insp-builder .b-deliv-tile { flex: 0 0 158px; scroll-snap-align: start; }
}
.insp-builder .b-deliv-tile { display: grid; gap: 4px; align-content: start; text-align: left; padding: 10px 12px 11px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255,255,255,.015); transition: border-color .2s, background .2s; cursor: pointer; }
.insp-builder .b-deliv-tile:hover { border-color: var(--line-2); background: rgba(255,255,255,.04); }
.insp-builder .b-deliv-tile[aria-checked="true"] { border-color: rgba(255,255,255,.75); background: rgba(255,255,255,.07); box-shadow: 0 0 0 3px rgba(255,255,255,.05); }
.insp-builder .b-aspect { display: inline-block; border: 1.25px solid currentColor; border-radius: 2px; }

/* library */
.insp-builder .b-lib-head { display: grid; gap: 10px; padding-bottom: 12px; }
.insp-builder .b-pills { display: flex; flex-wrap: wrap; gap: 4px; }
.insp-builder .b-pill { height: 26px; padding: 0 9px; font-size: 11.5px; gap: 5px; }
.insp-builder .b-pill[aria-pressed="true"] .b-dot { box-shadow: none; }
.insp-builder .b-lib-list { padding: 4px 2px 14px; }
.insp-builder .b-drawer-head { display: inline-flex; align-items: center; gap: 7px; margin: 0 0 7px; font-family: var(--mono); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: oklch(0.82 0.08 var(--h)); }
.insp-builder .b-drawer-head:hover { color: oklch(0.92 0.08 var(--h)); }
.insp-builder .b-saved { display: inline-flex; align-items: center; gap: 1px; }
.insp-builder .b-star { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 7px; color: var(--ink-3); }
.insp-builder .b-star:hover { color: var(--ink); background: rgba(255,255,255,.06); }
.insp-builder .b-star[aria-pressed="true"] { color: var(--warn); }
.insp-builder .b-recs { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.insp-builder .b-recs li { display: grid; gap: 4px; justify-items: start; font-size: 11.5px; line-height: 1.4; }
.insp-builder .b-custom { display: grid; gap: 7px; padding-top: 12px; border-top: 1px solid var(--line); }

/* tray */
.insp-builder .b-tray-list { gap: 7px; }
.insp-builder .b-tray-item { position: relative; display: inline-flex; border-radius: 10px; transition: opacity .2s; }
.insp-builder .b-tray-item[data-dragging="true"] { opacity: .4; }
.insp-builder .b-tray-item[data-over]::before { content: ""; position: absolute; top: 3px; bottom: 3px; width: 2px; border-radius: 2px; background: var(--ink); box-shadow: 0 0 10px rgba(255,255,255,.8); }
.insp-builder .b-tray-item[data-over="before"]::before { left: -5px; }
.insp-builder .b-tray-item[data-over="after"]::before { right: -5px; }
.insp-builder .b-empty { display: grid; gap: 12px; padding: 22px; border: 1px dashed var(--line-2); border-radius: 16px; }

/* live prompt: the standout */
.insp-builder .b-live { position: relative; padding: 18px 20px 18px; border-radius: 18px; border: 1px solid var(--line-2); background: linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,.012)); box-shadow: 0 30px 80px -40px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.05); }
.insp-builder .b-live-ribbon { position: absolute; left: 20px; right: 20px; top: -1.5px; }
.insp-builder .b-live-ribbon > span { transition: flex .5s var(--ease); }
.insp-builder .b-live-text { margin: 0; font-size: 18px; line-height: 1.75; color: var(--ink-2); letter-spacing: -.005em; min-height: 3.5em; overflow-wrap: anywhere; }
@media (max-width: 860px) { .insp-builder .b-live-text { font-size: 16px; } .insp-builder .b-live { padding: 16px 14px; } }
.insp-builder .b-mark { background: oklch(0.74 0.13 var(--h) / .12); box-shadow: inset 0 -1.5px 0 oklch(0.78 0.15 var(--h) / .75); border-radius: 4px; padding: 1px 2px; color: oklch(0.94 0.05 var(--h)); animation: b-arrive .7s var(--ease) both; }
@keyframes b-arrive { from { background: oklch(0.74 0.15 var(--h) / .45); box-shadow: inset 0 -1.5px 0 oklch(0.85 0.15 var(--h)), 0 0 18px oklch(0.78 0.16 var(--h) / .6); } }
.insp-builder .b-live-edit { font-size: 15.5px; min-height: 140px; }
.insp-builder [data-warn="true"] { color: var(--bad); }
.insp-builder .b-live-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.insp-builder .b-tools { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.insp-builder .b-tool-panel { margin-top: 12px; padding: 14px; border-radius: 14px; border: 1px solid var(--line); background: rgba(0,0,0,.25); }
.insp-builder .b-recs-row { display: grid; gap: 8px; margin-top: 14px; }
.insp-builder .b-versions { margin: 6px 0 0; padding: 0 0 0 18px; display: grid; gap: 10px; color: var(--ink-3); font-size: 12px; }
.insp-builder .b-versions p { margin: 0 0 4px; color: var(--ink-2); font-size: 13px; line-height: 1.55; }

/* details */
.insp-builder .b-details { margin-top: 14px; }
.insp-builder .b-details > summary { list-style: none; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; font-size: 12.5px; font-weight: 550; color: var(--ink-2); padding: 4px 0; border-radius: 6px; }
.insp-builder .b-details > summary::-webkit-details-marker { display: none; }
.insp-builder .b-details > summary:hover { color: var(--ink); }
.insp-builder .b-details .b-caret { transition: transform .2s var(--ease); transform: rotate(-90deg); }
.insp-builder .b-details[open] .b-caret { transform: none; }
.insp-builder .b-facts { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 6px 0 0; }
.insp-builder .b-facts dd { margin: 2px 0 0; font-size: 13px; }
.insp-builder .b-rules { margin: 0; padding-left: 16px; display: grid; gap: 4px; font-size: 12.5px; color: var(--ink-2); }
.insp-builder .b-rules li[data-on="false"] { color: var(--ink-3); }
.insp-builder .b-final { margin: 0; padding: 12px 14px; border-radius: 12px; background: rgba(0,0,0,.35); border: 1px solid var(--line); font-family: var(--mono); font-size: 11.5px; line-height: 1.6; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; }

/* origin */
.insp-builder .b-origin { display: grid; gap: 4px; margin: -4px 0 22px; padding: 8px 10px 8px 14px; border-radius: 14px; border: 1px solid var(--line-2); background: rgba(255,255,255,.03); }
.insp-builder .b-origin .b-details { margin-top: 0; }
.insp-builder .b-origin-dot { width: 7px; height: 7px; border-radius: 99px; background: var(--ink); box-shadow: 0 0 10px rgba(255,255,255,.7); flex: none; }
.insp-builder .b-original { margin: 6px 0 4px; font-size: 13px; line-height: 1.6; color: var(--ink-2); white-space: pre-wrap; }

/* references */
.insp-builder .b-ref-list { list-style: none; margin: 0 0 10px; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.insp-builder .b-ref { position: relative; display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; padding: 8px 36px 8px 8px; border-radius: 14px; border: 1px solid var(--line); background: rgba(255,255,255,.02); }
.insp-builder .b-ref img { width: 72px; height: 72px; object-fit: cover; border-radius: 9px; background: var(--raise); }
.insp-builder .b-ref-x { position: absolute; top: 6px; right: 6px; }
.insp-builder .b-drop { display: grid; gap: 6px; justify-items: center; text-align: center; padding: 20px 16px; }

/* portalled dialogs (Modal renders outside .insp-builder, inside .insp) */
.insp .b-import { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; max-height: 52dvh; overflow: auto; }
.insp .b-import-item { width: 100%; display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 12px; text-align: left; padding: 12px; border-radius: 14px; border: 1px solid var(--line); transition: border-color .2s, background .2s; }
.insp .b-import-item:hover { border-color: var(--line-2); }
.insp .b-import-item[aria-selected="true"] { border-color: rgba(255,255,255,.7); background: rgba(255,255,255,.05); }
.insp .b-check { width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--line-2); display: grid; place-items: center; color: #0a0a0c; margin-top: 1px; }
.insp .b-check[data-on="true"] { background: var(--ink); border-color: var(--ink); }
.insp .b-static-chip { cursor: inherit; pointer-events: none; }
.insp .b-pick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.insp .b-pick { display: grid; gap: 4px; text-align: left; padding: 6px; border-radius: 12px; border: 1px solid var(--line); transition: border-color .2s, background .2s; }
.insp .b-pick img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; display: block; }
.insp .b-pick:hover { border-color: var(--line-2); }
.insp .b-pick[aria-pressed="true"] { border-color: rgba(255,255,255,.8); background: rgba(255,255,255,.06); }
.insp .b-ref-name { font-size: 12.5px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* generate */
.insp-builder .b-count { min-width: 34px; justify-content: center; font-family: var(--mono); }
.insp-builder .b-count[aria-checked="true"] { background: rgba(255,255,255,.1); color: var(--ink); }
.insp-builder .b-gen-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.insp-builder .b-run { margin-top: 22px; }
.insp-builder .b-run-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 10px; }
.insp-builder .b-run-prompt { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.insp-builder .b-run-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
@media (max-width: 520px) { .insp-builder .b-run-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } }
.insp-builder .b-slot { position: relative; border-radius: 14px; overflow: hidden; background: var(--raise); border: 1px solid var(--line); max-height: 420px; }
.insp-builder .b-slot-img { display: block; width: 100%; height: 100%; cursor: zoom-in; }
.insp-builder .b-slot-img img { transition: transform .6s var(--ease), opacity .5s; }
.insp-builder .b-slot-img:hover img { transform: scale(1.03); }
.insp-builder .b-slot-msg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 10px; padding: 12px; text-align: center; }
`;
