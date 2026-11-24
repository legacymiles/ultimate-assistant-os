"use client";

// Smart tools under the live prompt: Enhance (AI fills what's missing, you
// review what it added), Translate an idea (plain words → chips), and the
// compact "Suggested next" row from recommend().

import { forwardRef, useState } from "react";
import { Check, Languages, Plus, Sparkles, X } from "lucide-react";
import { mergeChips } from "@/lib/image-studio/inspire/assemble";
import { libraryChip } from "@/lib/image-studio/inspire/chipLibrary";
import { translateIdea, type Recommendation } from "@/lib/image-studio/inspire/discover";
import type { Chip } from "@/lib/image-studio/inspire/types";
import { api } from "../api";
import { useInspire } from "../store";
import { chipStyle, DnaChip, Spinner } from "../ui";
import { chipKey, cleanChip, errorText, highlight, seq, useBuild } from "./shared";

export type Tool = "enhance" | "translate" | null;

const OFFLINE = "Built-in engine — add an AI key for smarter results.";

interface Enhanced {
  prompt: string;
  chips: Chip[];
  added: string[];
  offline?: boolean;
  from: string;
}

interface Translated {
  chips: Chip[];
  offline?: boolean;
  warning?: string;
  note?: string;
}

interface Props {
  visible: string;
  recs: Recommendation[];
  tool: Tool;
  setTool: (t: Tool) => void;
}

export const SmartTools = forwardRef<HTMLTextAreaElement, Props>(function SmartTools({ visible, recs, tool, setTool }, ideaRef) {
  const { me, builder, setBuilder, requireSignIn, toast } = useInspire();
  const { has, toggle, add } = useBuild();
  const [busy, setBusy] = useState<Tool>(null);
  const [error, setError] = useState<string | null>(null);
  const [enhanced, setEnhanced] = useState<Enhanced | null>(null);
  const [idea, setIdea] = useState("");
  const [translated, setTranslated] = useState<Translated | null>(null);

  const enhance = () => {
    setTool("enhance");
    setError(null);
    if (!visible) {
      setError("Add some ingredients or words first — Enhance improves a prompt that exists.");
      return;
    }
    requireSignIn("use Enhance", async () => {
      setBusy("enhance");
      try {
        const r = await api.post<Omit<Enhanced, "from">>("/ai", { action: "enhance", prompt: visible, deliverable: builder.deliverable });
        setEnhanced({ ...r, from: visible });
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(null);
      }
    });
  };

  const useEnhanced = () => {
    if (!enhanced) return;
    const prev = enhanced.from;
    setBuilder((b) => ({
      ...b,
      override: enhanced.prompt,
      chips: mergeChips(b.chips, enhanced.chips.map(cleanChip)),
      history: [prev, ...b.history.filter((h) => h !== prev)].slice(0, 10),
    }));
    setEnhanced(null);
    setTool(null);
    toast("Enhanced prompt in use — the previous wording is under Earlier versions");
  };

  const translate = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = idea.trim();
    setError(null);
    if (!text) {
      setError("Describe your idea first — a sentence is plenty.");
      return;
    }
    if (!me?.signedIn) {
      setTranslated({ chips: translateIdea(text), offline: true, note: "Built-in engine — sign in for AI translation." });
      return;
    }
    setBusy("translate");
    try {
      setTranslated(await api.post<Translated>("/ai", { action: "translate", idea: text }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const addedChips: Chip[] = enhanced
    ? enhanced.added.map((t) => enhanced.chips.find((c) => chipKey(c) === chipKey({ text: t })) ?? libraryChip(t) ?? { text: t, category: "texture" })
    : [];

  return (
    <div className="b-tools">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span className="insp-kicker" style={{ marginRight: 4 }}>
          Smart tools
        </span>
        <button type="button" className="insp-btn insp-btn-sm" aria-expanded={tool === "enhance"} onClick={enhance} disabled={busy === "enhance"}>
          {busy === "enhance" ? <Spinner size={13} /> : <Sparkles size={14} />} Enhance
        </button>
        <button
          type="button"
          className="insp-btn insp-btn-sm"
          aria-expanded={tool === "translate"}
          onClick={() => {
            setError(null);
            setTool(tool === "translate" ? null : "translate");
          }}
        >
          <Languages size={14} /> Translate an idea
        </button>
      </div>

      {error && (
        <div className="insp-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      {tool === "enhance" && enhanced && (
        <div className="b-tool-panel" aria-label="Enhanced prompt">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <span className="insp-kicker">Enhanced · {enhanced.added.length} addition{enhanced.added.length === 1 ? "" : "s"} highlighted</span>
            <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" aria-label="Close" onClick={() => setEnhanced(null)}>
              <X size={14} />
            </button>
          </div>
          <p className="b-live-text" style={{ fontSize: 14.5, margin: "8px 0 0" }}>
            {highlight(enhanced.prompt, addedChips).map((s, i) =>
              s.chip ? (
                <span key={i} className="b-mark" style={chipStyle(s.chip)}>
                  {s.text}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </p>
          {enhanced.offline && <p className="insp-note" style={{ margin: "10px 0 0" }}>{OFFLINE}</p>}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <button type="button" className="insp-btn insp-btn-sm" onClick={useEnhanced}>
              <Check size={14} /> Use this
            </button>
            <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={() => setEnhanced(null)}>
              Keep mine
            </button>
          </div>
        </div>
      )}

      {tool === "translate" && (
        <form className="b-tool-panel" onSubmit={(e) => void translate(e)}>
          <label>
            <span className="insp-label">Describe what you want in plain words</span>
            <textarea
              ref={ideaRef}
              className="insp-textarea"
              style={{ minHeight: 72 }}
              rows={3}
              value={idea}
              maxLength={1200}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="A cute robot selling ramen on a rainy street at night, for a shirt"
            />
          </label>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="submit" className="insp-btn insp-btn-sm" disabled={busy === "translate"}>
              {busy === "translate" ? <Spinner size={13} /> : <Languages size={14} />} Translate
            </button>
          </div>
          {translated && (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className="insp-kicker">{translated.chips.length} building blocks — click to add</span>
                {translated.chips.length > 0 && (
                  <button type="button" className="insp-btn insp-btn-sm" onClick={() => add(translated.chips)}>
                    <Plus size={14} /> Add all
                  </button>
                )}
              </div>
              {translated.chips.length ? (
                <div className="insp-chips insp-seq">
                  {translated.chips.map((c, i) => (
                    <DnaChip key={c.text} chip={c} small pressed={has(c)} onClick={() => toggle(c)} style={seq(i)} />
                  ))}
                </div>
              ) : (
                <p className="insp-faint" style={{ margin: 0, fontSize: 12.5 }}>
                  Nothing recognisable yet — name a subject, a style or a feeling and try again.
                </p>
              )}
              {(translated.offline || translated.warning) && <p className="insp-note" style={{ margin: 0 }}>{translated.note ?? translated.warning ?? OFFLINE}</p>}
            </div>
          )}
        </form>
      )}

      {recs.length > 0 && (
        <div className="b-recs-row">
          <span className="insp-kicker">Suggested next</span>
          <div className="insp-chips">
            {recs.slice(0, 6).map((r) => (
              <DnaChip key={r.text} chip={{ ...r, why: `${r.reason} ${r.why ?? ""}`.trim() }} small className="insp-chip-ghost" onClick={() => add([r])} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
