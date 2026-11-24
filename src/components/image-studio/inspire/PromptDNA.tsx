"use client";

// Prompt DNA: the original prompt, untouched but lit up where its ingredients
// are, and the same ingredients as chips sorted into what they do. Click chips
// (or the lit words) to select them; the bar that appears copies them, saves
// them to your chip library, or builds a new prompt from just those.

import { useMemo, useState } from "react";
import { BookmarkPlus, Copy, Shuffle, Wand2, X } from "lucide-react";
import { visiblePrompt } from "@/lib/image-studio/inspire/assemble";
import { dnaRibbon, groupChips } from "@/lib/image-studio/inspire/discover";
import { highlightSpans } from "@/lib/image-studio/inspire/extract";
import { hueOf } from "@/lib/image-studio/inspire/taxonomy";
import type { Chip } from "@/lib/image-studio/inspire/types";
import { useInspire } from "./store";
import { chipStyle, DnaChip } from "./ui";

export function DnaRibbon({ chips, height = 3 }: { chips: Chip[]; height?: number }) {
  const parts = dnaRibbon(chips);
  if (!parts.length) return null;
  return (
    <div className="insp-ribbon" style={{ height }} aria-hidden>
      {parts.map((p) => (
        <span key={p.id} style={{ flex: p.share, ["--h" as string]: p.hue } as React.CSSProperties} />
      ))}
    </div>
  );
}

interface Props {
  prompt: string;
  chips: Chip[];
  /** Shown above the prompt; omit for none. */
  label?: string;
  /** Remix: load these ingredients into the Builder. */
  onRemix?: () => void;
  /** Save the whole prompt to the library. */
  onSavePrompt?: () => void;
  /** Hide the highlighted original text (e.g. when shown elsewhere). */
  hidePrompt?: boolean;
}

export function PromptDNA({ prompt, chips, label = "Original prompt", onRemix, onSavePrompt, hidePrompt }: Props) {
  const { copy, saveChips, sendToBuilder, savedChipTexts } = useInspire();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const spans = useMemo(() => highlightSpans(prompt, chips), [prompt, chips]);
  const groups = useMemo(() => groupChips(chips), [chips]);
  const selected = chips.filter((c) => picked.has(c.text));
  const toggle = (c: Chip) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(c.text)) n.delete(c.text);
      else n.add(c.text);
      return n;
    });

  return (
    <section aria-label="Prompt DNA" style={{ display: "grid", gap: 18 }}>
      {!hidePrompt && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span className="insp-kicker">{label}</span>
            <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={() => void copy(prompt, "Prompt copied")}>
              <Copy size={13} /> Copy prompt
            </button>
          </div>
          <p className="insp-prompt-text" style={{ margin: 0 }}>
            {spans.map((s, i) =>
              s.chip ? (
                <mark
                  key={i}
                  style={chipStyle(s.chip)}
                  data-on={picked.has(s.chip.text)}
                  onClick={() => toggle(s.chip!)}
                  title={s.chip.why}
                >
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </p>
        </div>
      )}

      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <span className="insp-kicker">Prompt DNA · {chips.length} ingredients</span>
          <span className="insp-faint" style={{ fontSize: 11.5 }}>
            Hover to learn · click to select
          </span>
        </div>
        <DnaRibbon chips={chips} height={4} />
        <div style={{ display: "grid", gap: 12, marginTop: 14 }} className="insp-seq">
          {groups.map(({ group, chips: gc }, gi) => (
            <div key={group.id} style={{ display: "grid", gridTemplateColumns: "118px minmax(0,1fr)", gap: 10, alignItems: "start", ["--i" as string]: gi } as React.CSSProperties}>
              <span className="insp-mono" style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", paddingTop: 8, color: `oklch(0.78 0.11 ${group.hue})` }}>
                {group.label}
              </span>
              <div className="insp-chips">
                {gc.map((c) => (
                  <DnaChip key={c.text} chip={c} pressed={picked.has(c.text)} onClick={() => toggle(c)}>
                    {savedChipTexts.has(c.text.toLowerCase()) && <BookmarkPlus size={11} aria-label="In your chips" style={{ opacity: 0.7 }} />}
                  </DnaChip>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="insp-panel" style={{ padding: 12, display: "grid", gap: 10, borderColor: `oklch(0.8 0.12 ${hueOf(selected[0].category)} / .4)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{selected.length} selected</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="insp-btn insp-btn-sm" onClick={() => void copy(selected.map((c) => c.text).join(", "), `Copied ${selected.length} chip${selected.length === 1 ? "" : "s"}`)}>
              <Copy size={13} /> Copy
            </button>
            <button type="button" className="insp-btn insp-btn-sm" onClick={() => void saveChips(selected)}>
              <BookmarkPlus size={13} /> Save to my chips
            </button>
            <button type="button" className="insp-btn insp-btn-sm insp-btn-primary" onClick={() => sendToBuilder(selected)}>
              <Wand2 size={13} /> Build with these
            </button>
            <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" aria-label="Clear selection" onClick={() => setPicked(new Set())}>
              <X size={14} />
            </button>
          </div>
          <div className="insp-faint" style={{ fontSize: 12.5 }}>
            <span className="insp-kicker" style={{ marginRight: 8 }}>
              Combined
            </span>
            {visiblePrompt(selected)}
          </div>
        </div>
      )}

      {(onRemix || onSavePrompt) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onRemix && (
            <button type="button" className="insp-btn insp-btn-primary" onClick={onRemix}>
              <Shuffle size={14} /> Remix this prompt
            </button>
          )}
          {onSavePrompt && (
            <button type="button" className="insp-btn" onClick={onSavePrompt}>
              <BookmarkPlus size={14} /> Save prompt
            </button>
          )}
          <button type="button" className="insp-btn" onClick={() => setPicked(new Set(chips.map((c) => c.text)))}>
            Select all
          </button>
        </div>
      )}
    </section>
  );
}
