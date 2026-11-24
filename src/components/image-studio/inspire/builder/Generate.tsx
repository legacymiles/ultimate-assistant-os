"use client";

// Generate: 1–4 outputs, drawn one after another (the PC drawer is serial),
// each slot showing its own live state. Every result is already saved privately
// by the route with its full recipe; here it joins My Library at once.

import { useRef, useState } from "react";
import { RefreshCw, Shuffle, Wand2 } from "lucide-react";
import type { Assembled } from "@/lib/image-studio/inspire/assemble";
import type { InspireImage } from "@/lib/image-studio/inspire/types";
import { api, urlToDataUrl } from "../api";
import { useInspire } from "../store";
import { Shot, Spinner } from "../ui";
import { CATEGORY_FOR, errorText } from "./shared";

type SlotStatus = "waiting" | "drawing" | "done" | "error";

interface Slot {
  status: SlotStatus;
  image?: InspireImage;
  error?: string;
}

interface Run {
  id: number;
  at: string;
  prompt: string;
  aspect: string;
  lane: string | null;
  slots: Slot[];
}

interface RunBody {
  body: Record<string, unknown>;
  variants: number[];
}

export function Generate({ assembled }: { assembled: Assembled }) {
  const { builder, lib, requireSignIn, upsertOwnImage, openImage, toast } = useInspire();
  const [count, setCount] = useState(2);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const bodies = useRef(new Map<number, RunBody>());
  const busy = runs.some((r) => r.slots.some((s) => s.status === "waiting" || s.status === "drawing"));
  const d = assembled.deliverable;

  const patchSlot = (runId: number, idx: number, slot: Slot, lane?: string) =>
    setRuns((rs) => rs.map((r) => (r.id === runId ? { ...r, lane: lane ?? r.lane, slots: r.slots.map((s, i) => (i === idx ? slot : s)) } : r)));

  /** Draw one slot. Resolves true when an image came back. */
  const drawSlot = async (runId: number, idx: number): Promise<boolean> => {
    const job = bodies.current.get(runId);
    if (!job) return false;
    patchSlot(runId, idx, { status: "drawing" });
    try {
      const r = await api.post<{ image: InspireImage; lane: string }>("/generate", { ...job.body, variant: job.variants[idx] });
      upsertOwnImage(r.image);
      patchSlot(runId, idx, { status: "done", image: r.image }, r.lane);
      return true;
    } catch (err) {
      patchSlot(runId, idx, { status: "error", error: errorText(err) });
      return false;
    }
  };

  const generate = () => {
    setError(null);
    if (!assembled.visible) {
      setError("Add ingredients or write a prompt first — there's nothing to draw yet.");
      return;
    }
    if (busy) return;
    requireSignIn("generate images", async () => {
      const id = ++seqRef.current;
      const base = ((id - 1) % 4) * 4;
      const n = count;
      setRuns((rs) =>
        [{ id, at: new Date().toISOString(), prompt: assembled.visible, aspect: `${d.width} / ${d.height}`, lane: null, slots: Array.from({ length: n }, (): Slot => ({ status: "waiting" })) }, ...rs].slice(0, 6),
      );
      let refs: { dataUrl: string; purpose: string; name: string; imageId: string }[];
      try {
        refs = await Promise.all(
          builder.refs.map(async (r) => ({ dataUrl: await urlToDataUrl(lib.images[r.imageId]?.src ?? r.src), purpose: r.purpose, name: r.name, imageId: r.imageId })),
        );
      } catch (err) {
        const msg = `A reference image couldn't be read: ${errorText(err)} Remove it and try again.`;
        setRuns((rs) => rs.map((r) => (r.id === id ? { ...r, slots: r.slots.map(() => ({ status: "error", error: msg })) } : r)));
        return;
      }
      bodies.current.set(id, {
        variants: Array.from({ length: n }, (_, i) => base + i),
        body: {
          chips: builder.chips,
          freeText: builder.freeText,
          override: builder.override,
          deliverable: builder.deliverable,
          refs,
          history: builder.history,
          category: CATEGORY_FOR[d.id],
        },
      });
      let ok = 0;
      for (let i = 0; i < n; i++) if (await drawSlot(id, i)) ok++;
      if (ok) toast(ok === 1 ? "Saved to My Library" : `${ok} images saved to My Library`);
    });
  };

  const regenerate = (runId: number, idx: number) =>
    requireSignIn("generate images", async () => {
      if (await drawSlot(runId, idx)) toast("Saved to My Library");
    });

  return (
    <section className="b-gen" aria-labelledby="b-gen-h">
      <div className="b-sec-head">
        <h2 id="b-gen-h" className="insp-kicker" style={{ margin: 0 }}>
          5 · Generate
        </h2>
        <span className="insp-mono insp-faint" style={{ fontSize: 10.5 }}>
          {d.label.toUpperCase()} · {d.aspect} · {d.width}×{d.height}
        </span>
      </div>
      <div className="b-gen-bar">
        <div className="insp-tabs" role="radiogroup" aria-label="How many images">
          {[1, 2, 3, 4].map((k) => (
            <button key={k} type="button" role="radio" aria-checked={count === k} className="insp-tab b-count" onClick={() => setCount(k)} disabled={busy}>
              {k}
            </button>
          ))}
        </div>
        <button type="button" className="insp-btn insp-btn-primary insp-btn-lg" onClick={generate} disabled={busy}>
          {busy ? <Spinner size={15} /> : <Wand2 size={16} />}
          {busy ? "Drawing…" : `Generate ${count} image${count === 1 ? "" : "s"}`}
        </button>
        {runs.length > 0 && !busy && (
          <button type="button" className="insp-btn" onClick={generate}>
            <Shuffle size={14} /> Variations
          </button>
        )}
      </div>
      {error && (
        <div className="insp-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      {runs.map((run) => {
        const drawing = run.slots.findIndex((s) => s.status === "drawing");
        return (
          <div key={run.id} className="b-run">
            <div className="b-run-head">
              <span className="insp-kicker">
                {new Date(run.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {run.lane ? ` · Drawn with ${run.lane}` : drawing >= 0 ? " · Finding a drawer…" : ""}
              </span>
              <span className="insp-faint b-run-prompt" title={run.prompt}>
                {run.prompt}
              </span>
            </div>
            <div className="b-run-grid" role="status" aria-live="polite">
              {run.slots.map((s, i) => (
                <div key={i} className="b-slot" style={{ aspectRatio: run.aspect }}>
                  {s.status === "done" && s.image ? (
                    <button type="button" className="b-slot-img" onClick={() => openImage(s.image!)} aria-label={`Open result ${i + 1}`}>
                      <Shot img={s.image} style={{ width: "100%", height: "100%", display: "block" }} />
                    </button>
                  ) : s.status === "error" ? (
                    <div className="b-slot-msg">
                      <div className="insp-error" style={{ fontSize: 12 }}>
                        {s.error}
                      </div>
                      <button type="button" className="insp-btn insp-btn-sm" onClick={() => regenerate(run.id, i)} disabled={busy}>
                        <RefreshCw size={13} /> Regenerate
                      </button>
                    </div>
                  ) : (
                    <div className={`b-slot-msg ${s.status === "drawing" ? "insp-skel" : ""}`} style={{ borderRadius: 0 }}>
                      {s.status === "drawing" ? <Spinner size={15} /> : null}
                      <span className="insp-mono" style={{ fontSize: 10.5, letterSpacing: ".1em", color: s.status === "drawing" ? "var(--ink-2)" : "var(--ink-3)" }}>
                        {s.status === "drawing" ? `DRAWING ${i + 1} OF ${run.slots.length}…` : `QUEUED · ${i + 1} OF ${run.slots.length}`}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
