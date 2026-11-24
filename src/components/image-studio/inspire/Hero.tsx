"use client";

// The Explore hero — "Immersive lab". The whole first screen is a Prompt Scan
// stage: a featured picture drawn out of its own prompt, scanned through by
// the pointer (or by itself when nobody points). The headline sits over it in
// difference blend; the picture's ingredients float pinned to the parts they
// describe — select some and build with them. Featured pictures rotate.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Upload, Wand2, X } from "lucide-react";
import { pinOnStage } from "@/lib/image-studio/inspire/scan";
import type { Chip, InspireImage } from "@/lib/image-studio/inspire/types";
import { PromptScan, PromptScanStill } from "./PromptScan";
import { useInspire } from "./store";
import { DnaChip } from "./ui";

const ROTATE_MS = 14000;

export function Hero({ images, onShare }: { images: InspireImage[] | null; onShare: () => void }) {
  const { openImage, sendToBuilder } = useInspire();
  const featured = useMemo(() => {
    const f = (images ?? []).filter((i) => i.featured && i.prompt);
    return f.length ? f : (images ?? []).filter((i) => i.width > i.height && i.prompt).slice(0, 5);
  }, [images]);
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fallback, setFallback] = useState(false);
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [hold, setHold] = useState(false);
  const [reduced, setReduced] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const img = featured.length ? featured[idx % featured.length] : null;

  useEffect(() => setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  // Re-place pins whenever the stage, the headline or the info block changes
  // size — including when the webfont lands and the headline re-wraps.
  const [layout, setLayout] = useState(0);
  useEffect(() => {
    if (!stage) return;
    const bump = () => {
      setSize({ w: stage.clientWidth, h: stage.clientHeight });
      setLayout((n) => n + 1);
    };
    const ro = new ResizeObserver(bump);
    ro.observe(stage);
    if (titleRef.current) ro.observe(titleRef.current);
    if (footRef.current) ro.observe(footRef.current);
    void document.fonts?.ready.then(bump);
    return () => ro.disconnect();
  }, [stage]);

  // Rotate featured pictures — never while someone is pointing or choosing.
  useEffect(() => {
    if (reduced || hold || picked.size || featured.length < 2) return;
    const t = window.setTimeout(() => setIdx((i) => (i + 1) % featured.length), ROTATE_MS);
    return () => window.clearTimeout(t);
  }, [idx, hold, picked.size, featured.length, reduced]);

  const go = (d: number) => {
    setIdx((i) => (i + d + featured.length) % featured.length);
    setPicked(new Set());
    setReady(false);
  };
  useEffect(() => setReady(false), [img?.id]);

  // Pins keep clear of the headline and the info block, so nothing collides.
  const pins = useMemo(() => {
    if (!img?.pins || !size.w || !stage) return [];
    const base = stage.getBoundingClientRect();
    // Each headline line on its own (the short last line leaves room beside
    // it), plus the info block and the carousel controls — not the whole row.
    const blockers = [
      ...Array.from(titleRef.current?.children ?? []),
      ...Array.from(footRef.current?.children ?? []),
    ] as HTMLElement[];
    const keepOut = blockers
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { l: r.left - base.left - 70, r: r.right - base.left + 70, t: r.top - base.top - 44, b: r.bottom - base.top + 20 };
      });
    const max = size.w < 640 ? 4 : 8;
    return img.pins
      .map((p) => ({ ...p, at: pinOnStage(p.x, p.y, img.width, img.height, size.w, size.h, 0.08) }))
      .filter((p): p is typeof p & { at: [number, number] } => {
        if (!p.at) return false;
        const x = p.at[0] * size.w;
        const y = p.at[1] * size.h;
        return !keepOut.some((k) => x > k.l && x < k.r && y > k.t && y < k.b);
      })
      .slice(0, max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, size, stage, layout]);

  const selected: Chip[] = (img?.pins ?? []).map((p) => p.chip).filter((c) => picked.has(c.text));
  const toggle = (c: Chip) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(c.text)) n.delete(c.text);
      else n.add(c.text);
      return n;
    });

  return (
    <section
      ref={setStage}
      className="insp-hero"
      data-standout="prompt-scan"
      aria-label="Featured image: move across it to scan its prompt into the picture"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHold(true)}
      onPointerLeave={() => setHold(false)}
    >
      <div className="insp-hero-stage" data-ready={ready}>
        {img &&
          (fallback ? (
            <PromptScanStill image={img} prompt={img.prompt} />
          ) : (
            <PromptScan key={img.id} image={img} prompt={img.prompt} mode="hero" host={stage} onFallback={() => setFallback(true)} onReady={() => setReady(true)} />
          ))}
      </div>
      <div className="insp-hero-shade" aria-hidden />

      <h1 ref={titleRef} className="insp-hero-title">
        <span>See the prompt</span> <span>behind every</span> <span>picture.</span>
      </h1>

      {img && (
        <div className="insp-hero-pins insp-seq" key={img.id}>
          {pins.map((p, i) => (
            <span key={p.chip.text} className="insp-pin" style={{ left: `${p.at[0] * 100}%`, top: `${p.at[1] * 100}%`, ["--i" as string]: i + 4 } as React.CSSProperties}>
              <DnaChip chip={p.chip} small pressed={picked.has(p.chip.text)} onClick={() => toggle(p.chip)} />
            </span>
          ))}
        </div>
      )}

      {img && (
        <div className="insp-hero-hint" aria-hidden>
          <i />
          {reduced ? "Prompt scan" : "Move to scan"} · {img.title}
        </div>
      )}

      <div ref={footRef} className="insp-hero-foot">
        {img ? (
          <div className="insp-hero-meta">
            <div className="insp-display" style={{ fontSize: "clamp(20px, 2.2vw, 28px)" }}>
              {img.title}
            </div>
            <div className="insp-mono" style={{ fontSize: 11.5, color: "rgba(255,255,255,.7)", marginTop: 3 }}>
              @{img.creator} · {img.pins?.length ?? img.chips.length} ingredients
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {selected.length ? (
                <>
                  <button type="button" className="insp-btn insp-btn-primary" onClick={() => sendToBuilder(selected)}>
                    <Wand2 size={14} /> Build with {selected.length}
                  </button>
                  <button type="button" className="insp-btn insp-hero-glass" onClick={() => setPicked(new Set())}>
                    <X size={14} /> Clear
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="insp-btn insp-btn-primary" onClick={() => openImage(img)}>
                    Open its Prompt DNA <ArrowRight size={14} />
                  </button>
                  <button type="button" className="insp-btn insp-hero-glass" onClick={onShare}>
                    <Upload size={14} /> Share an image
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="insp-skel" style={{ width: 260, height: 90, borderRadius: 16 }} />
        )}
        {featured.length > 1 && (
          <div className="insp-hero-nav">
            <button type="button" className="insp-btn insp-btn-icon insp-hero-glass" onClick={() => go(-1)} aria-label="Previous featured image">
              <ChevronLeft size={16} />
            </button>
            <div className="insp-hero-dots" role="tablist" aria-label="Featured images">
              {featured.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={i === idx % featured.length}
                  aria-label={f.title}
                  onClick={() => {
                    setIdx(i);
                    setPicked(new Set());
                  }}
                >
                  <span style={i === idx % featured.length && !reduced && !hold && !picked.size ? { animation: `insp-progress ${ROTATE_MS}ms linear forwards` } : undefined} />
                </button>
              ))}
            </div>
            <button type="button" className="insp-btn insp-btn-icon insp-hero-glass" onClick={() => go(1)} aria-label="Next featured image">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
