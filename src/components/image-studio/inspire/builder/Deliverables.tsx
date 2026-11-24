"use client";

// "What are you making?" — the ten deliverables, plus the Behind-the-scenes
// panel that shows the technical layer assemble() adds for the chosen one.

import { ChevronDown, Copy } from "lucide-react";
import { technicalLayer, type Assembled } from "@/lib/image-studio/inspire/assemble";
import { DELIVERABLES, type DeliverableId } from "@/lib/image-studio/inspire/deliverables";
import { REFERENCE_PURPOSES } from "@/lib/image-studio/inspire/types";
import { useInspire, type BuilderRef } from "../store";

function AspectGlyph({ aspect }: { aspect: string }) {
  const [w, h] = aspect.split(":").map(Number);
  const r = w && h ? w / h : 1;
  const size = 15;
  const width = r >= 1 ? size : Math.round(size * r);
  const height = r >= 1 ? Math.round(size / r) : size;
  return <span aria-hidden className="b-aspect" style={{ width, height }} />;
}

export function DeliverablePicker() {
  const { builder, setBuilder } = useInspire();
  const pick = (id: DeliverableId) => setBuilder((b) => ({ ...b, deliverable: id }));
  return (
    <section className="b-deliv" aria-labelledby="b-deliv-h">
      <div className="b-sec-head">
        <h2 id="b-deliv-h" className="insp-kicker" style={{ margin: 0 }}>
          1 · What are you making?
        </h2>
      </div>
      <div className="b-deliv-strip" role="radiogroup" aria-labelledby="b-deliv-h">
        {DELIVERABLES.map((d) => {
          const on = builder.deliverable === d.id;
          return (
            <button key={d.id} type="button" role="radio" aria-checked={on} className="b-deliv-tile" onClick={() => pick(d.id)}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span className="insp-h3">{d.label}</span>
                <span className="insp-mono insp-faint" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5 }}>
                  <AspectGlyph aspect={d.aspect} />
                  {d.aspect}
                </span>
              </span>
              <span className="insp-faint" style={{ fontSize: 12, lineHeight: 1.35 }}>
                {d.blurb}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** One line per reference purpose, exactly as assemble() would add it. */
function referenceLine(deliverable: string, purpose: BuilderRef["purpose"], rulesCount: number): string {
  return technicalLayer(deliverable, [{ purpose, name: "" }])[rulesCount] ?? "";
}

export function BehindTheScenes({ assembled }: { assembled: Assembled }) {
  const { builder, copy } = useInspire();
  const d = assembled.deliverable;
  const active = new Set(builder.refs.map((r) => r.purpose));
  return (
    <details className="b-details">
      <summary>
        <ChevronDown size={14} className="b-caret" aria-hidden />
        Behind the scenes
        <span className="insp-faint" style={{ fontSize: 12, fontWeight: 400 }}>
          — what the image model also gets for a {d.label.toLowerCase()}
        </span>
      </summary>
      <div style={{ display: "grid", gap: 14, padding: "4px 2px 6px" }}>
        <dl className="b-facts">
          <div>
            <dt className="insp-kicker">Target</dt>
            <dd>{d.target}</dd>
          </div>
          <div>
            <dt className="insp-kicker">Aspect</dt>
            <dd>
              {d.aspect} · {d.width}×{d.height}
            </dd>
          </div>
        </dl>
        <div>
          <div className="insp-kicker" style={{ marginBottom: 6 }}>
            Rules added automatically
          </div>
          {d.rules.length ? (
            <ul className="b-rules">
              {d.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="insp-faint" style={{ margin: 0, fontSize: 12.5 }}>
              Custom adds no rules — only your own words go to the model.
            </p>
          )}
        </div>
        <div>
          <div className="insp-kicker" style={{ marginBottom: 6 }}>
            Reference lines (added when a reference has that purpose)
          </div>
          <ul className="b-rules">
            {REFERENCE_PURPOSES.map((p) => (
              <li key={p.id} data-on={active.has(p.id)}>
                <strong style={{ fontWeight: 600 }}>{p.label}:</strong> {referenceLine(d.id, p.id, d.rules.length)}
                {active.has(p.id) && <span className="insp-badge" style={{ marginLeft: 8, height: 18 }}>In use</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <span className="insp-kicker">Final prompt sent to the model · {assembled.final.length} characters</span>
            <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" disabled={!assembled.final} onClick={() => void copy(assembled.final, "Full prompt copied")}>
              <Copy size={13} /> Copy full prompt
            </button>
          </div>
          <pre className="b-final">{assembled.final || "Nothing yet — add ingredients and the full prompt appears here."}</pre>
        </div>
      </div>
    </details>
  );
}
