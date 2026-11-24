"use client";

// The selected-ingredients tray: the build's chips in prompt order. Drag to
// reorder; with a chip focused, ← and → move it and Delete takes it out.

import { useEffect, useRef, useState } from "react";
import { FileDown, Lightbulb, Trash2 } from "lucide-react";
import { moveItem } from "@/lib/image-studio/inspire/assemble";
import { libraryChip } from "@/lib/image-studio/inspire/chipLibrary";
import { deliverableById } from "@/lib/image-studio/inspire/deliverables";
import type { Recommendation } from "@/lib/image-studio/inspire/discover";
import type { Chip } from "@/lib/image-studio/inspire/types";
import { useInspire } from "../store";
import { DnaChip } from "../ui";
import { chipKey, seq, useBuild } from "./shared";

export function Tray({ recs, onImport, onIdea }: { recs: Recommendation[]; onImport: () => void; onIdea: () => void }) {
  const { builder, setBuilder, toast } = useInspire();
  const { remove, add } = useBuild();
  const chips = builder.chips;
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const items = useRef(new Map<string, HTMLSpanElement | null>());
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    const k = focusNext.current;
    if (!k) return;
    focusNext.current = null;
    items.current.get(k)?.querySelector("button")?.focus();
  }, [chips]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= chips.length || from === to) return;
    const chip = chips[from];
    focusNext.current = chipKey(chip);
    setBuilder((b) => ({ ...b, chips: moveItem(b.chips, from, to) }));
    setSaid(`Moved ${chip.text} to position ${to + 1} of ${chips.length}.`);
  };

  const drop = (chip: Chip, i: number) => {
    const neighbour = chips[i + 1] ?? chips[i - 1];
    focusNext.current = neighbour ? chipKey(neighbour) : null;
    remove(chip);
    setSaid(`Removed ${chip.text}.`);
  };

  const clearAll = () => {
    const snap = { chips: builder.chips, freeText: builder.freeText, override: builder.override };
    setBuilder((b) => ({ ...b, chips: [], freeText: "", override: null }));
    toast("Build cleared", { action: { label: "Undo", run: () => setBuilder((b) => ({ ...b, ...snap })) } });
  };

  const d = deliverableById(builder.deliverable);
  const starterSource: Chip[] = d.starters.length
    ? d.starters.map((t) => libraryChip(t)).filter((c): c is NonNullable<typeof c> => Boolean(c))
    : recs;
  const starters: Chip[] = starterSource.slice(0, 3);
  const empty = !chips.length && !builder.freeText.trim() && !builder.override;

  return (
    <section className="b-tray" aria-labelledby="b-tray-h">
      <div className="b-sec-head">
        <h2 id="b-tray-h" className="insp-kicker" style={{ margin: 0 }}>
          2 · Ingredients <span className="insp-count">{chips.length ? `· ${chips.length}` : ""}</span>
        </h2>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={onImport}>
            <FileDown size={14} /> Import from saved prompts
          </button>
          {(chips.length > 0 || builder.freeText || builder.override) && (
            <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={clearAll}>
              <Trash2 size={14} /> Clear all
            </button>
          )}
        </div>
      </div>

      {empty ? (
        <div className="b-empty">
          <p style={{ margin: 0, color: "var(--ink)", fontSize: 15 }}>Click ingredients instead of writing.</p>
          <p className="insp-faint" style={{ margin: 0, fontSize: 13 }}>
            Pick what you&apos;re making above, then click chips in the library — each one adds a precise piece of the picture. Start with one of these for a {d.label.toLowerCase()}:
          </p>
          {starters.length > 0 && (
            <div className="insp-chips insp-seq">
              {starters.map((c, i) => (
                <DnaChip key={c.text} chip={c} onClick={() => add([c])} style={seq(i)} />
              ))}
            </div>
          )}
          <button type="button" className="insp-btn insp-btn-sm" style={{ justifySelf: "start" }} onClick={onIdea}>
            <Lightbulb size={14} /> Start from an idea
          </button>
        </div>
      ) : chips.length === 0 ? (
        <p className="insp-faint" style={{ margin: 0, fontSize: 13 }}>
          No chips yet — your own words are doing the work. Click chips in the library to add precise ingredients.
        </p>
      ) : (
        <>
          <div className="insp-chips b-tray-list" role="list" aria-describedby="b-tray-help">
            {chips.map((c, i) => {
              const k = chipKey(c);
              return (
                <span
                  key={k}
                  role="listitem"
                  ref={(el) => {
                    items.current.set(k, el);
                  }}
                  className="b-tray-item"
                  data-over={over === i && drag !== null && drag !== i ? (drag > i ? "before" : "after") : undefined}
                  data-dragging={drag === i}
                  onDragOver={(e) => {
                    if (drag === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (over !== i) setOver(i);
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = drag ?? Number(e.dataTransfer.getData("text/plain"));
                    if (Number.isInteger(from)) move(from, i);
                    setDrag(null);
                    setOver(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      move(i, e.key === "ArrowLeft" ? i - 1 : i + 1);
                    } else if (e.key === "Delete" || e.key === "Backspace") {
                      e.preventDefault();
                      drop(c, i);
                    }
                  }}
                >
                  <DnaChip
                    chip={c}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(i));
                      setDrag(i);
                    }}
                    onRemove={() => drop(c, i)}
                    style={{ cursor: "grab" }}
                  >
                    <span className="insp-mono" aria-hidden style={{ opacity: 0.45, fontSize: 9.5 }}>
                      {i + 1}
                    </span>
                  </DnaChip>
                </span>
              );
            })}
          </div>
          <p id="b-tray-help" className="insp-faint" style={{ margin: "10px 0 0", fontSize: 11.5 }}>
            Order is prompt order. Drag to reorder — or focus a chip and use ← → to move it, Delete to remove it.
          </p>
        </>
      )}
      <span className="b-sr" aria-live="polite">
        {said}
      </span>
    </section>
  );
}
