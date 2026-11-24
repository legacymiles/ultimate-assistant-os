"use client";

// The live prompt — the page's one standout. The sentence assemble() builds
// from the chips, with every chip's words glowing in its hue, a DNA ribbon
// that grows as ingredients of new kinds arrive, your own words, and a switch
// to edit the whole thing as plain text.

import { useMemo, type ReactNode } from "react";
import { BookmarkPlus, ChevronDown, Copy, PencilLine, RotateCcw, Undo2 } from "lucide-react";
import type { Assembled } from "@/lib/image-studio/inspire/assemble";
import { dnaRibbon } from "@/lib/image-studio/inspire/discover";
import { categoryOf } from "@/lib/image-studio/inspire/taxonomy";
import { useInspire } from "../store";
import { chipStyle } from "../ui";
import { highlight, MAX_PROMPT } from "./shared";

export function LivePrompt({ assembled, hiddenHistory, children }: { assembled: Assembled; hiddenHistory: number | null; children?: ReactNode }) {
  const { builder, setBuilder, copy, savePrompt, toast } = useInspire();
  const { visible } = assembled;
  const editing = builder.override !== null;
  const segments = useMemo(() => highlight(visible, builder.chips), [visible, builder.chips]);
  const ribbon = useMemo(() => dnaRibbon(builder.chips), [builder.chips]);
  const count = editing ? (builder.override ?? "").length : visible.length;
  const versions = builder.history.map((text, i) => ({ text, i })).filter((v) => v.i !== hiddenHistory);

  const editAsText = () => setBuilder((b) => ({ ...b, override: visible }));
  const backToChips = () => {
    const prev = builder.override;
    setBuilder((b) => ({ ...b, override: null }));
    if (prev && prev.trim()) toast("Back to chips — your typed version was set aside", { action: { label: "Undo", run: () => setBuilder((b) => ({ ...b, override: prev })) } });
  };

  return (
    <section className="b-live" data-standout="live-prompt" aria-labelledby="b-live-h">
      <div className="insp-ribbon b-live-ribbon" aria-hidden>
        {ribbon.length ? ribbon.map((s) => <span key={s.id} style={{ flex: s.share, ["--h" as string]: String(s.hue) }} />) : <span style={{ flex: 1, background: "var(--line-2)", boxShadow: "none" }} />}
      </div>
      <div className="b-sec-head" style={{ marginBottom: 10 }}>
        <h2 id="b-live-h" className="insp-kicker" style={{ margin: 0 }}>
          3 · Live prompt
        </h2>
        <span className="insp-mono insp-faint" style={{ fontSize: 10.5, letterSpacing: ".08em" }} data-warn={count > MAX_PROMPT}>
          {editing ? "HAND-EDITED" : "BUILT FROM CHIPS"} · {count.toLocaleString()} / {MAX_PROMPT.toLocaleString()} CHARACTERS
        </span>
      </div>

      {editing ? (
        <textarea
          className="insp-textarea b-live-edit"
          value={builder.override ?? ""}
          onChange={(e) => setBuilder((b) => ({ ...b, override: e.target.value }))}
          maxLength={MAX_PROMPT}
          autoFocus
          aria-label="Prompt text"
          rows={5}
        />
      ) : (
        <p className="b-live-text" aria-live="polite">
          {segments.length ? (
            segments.map((s, i) =>
              s.chip ? (
                <span key={`c:${s.chip.text}`} className="b-mark" style={chipStyle(s.chip)} title={categoryOf(s.chip.category).label}>
                  {s.text}
                </span>
              ) : (
                <span key={`t:${i}`}>{s.text}</span>
              ),
            )
          ) : (
            <span className="insp-faint">Your prompt writes itself here as you click ingredients.</span>
          )}
        </p>
      )}

      {!editing && (
        <label style={{ display: "block", marginTop: 12 }}>
          <span className="insp-label">Anything else, in your own words</span>
          <textarea
            className="insp-textarea"
            style={{ minHeight: 64 }}
            rows={2}
            value={builder.freeText}
            maxLength={1000}
            onChange={(e) => setBuilder((b) => ({ ...b, freeText: e.target.value }))}
            placeholder="holding a paper lantern, rain just stopped"
          />
        </label>
      )}
      {editing && (
        <p className="insp-faint" style={{ margin: "8px 0 0", fontSize: 12 }}>
          You&apos;re editing the words directly. Chips you add now are kept for when you go back to chips; the technical layer still applies.
        </p>
      )}

      <div className="b-live-actions">
        {editing ? (
          <button type="button" className="insp-btn insp-btn-sm" onClick={backToChips}>
            <Undo2 size={14} /> Back to chips
          </button>
        ) : (
          <button type="button" className="insp-btn insp-btn-sm" onClick={editAsText} disabled={!visible}>
            <PencilLine size={14} /> Edit as text
          </button>
        )}
        <button type="button" className="insp-btn insp-btn-sm" disabled={!visible} onClick={() => void copy(visible, "Prompt copied")}>
          <Copy size={14} /> Copy prompt
        </button>
        <button type="button" className="insp-btn insp-btn-sm" disabled={!visible} onClick={() => void savePrompt({ text: visible, chips: builder.chips, origin: "builder" })}>
          <BookmarkPlus size={14} /> Save prompt
        </button>
      </div>

      {versions.length > 0 && (
        <details className="b-details" style={{ marginTop: 12 }}>
          <summary>
            <ChevronDown size={14} className="b-caret" aria-hidden />
            Earlier versions <span className="insp-count">{versions.length}</span>
          </summary>
          <ol className="b-versions">
            {versions.map((v) => (
              <li key={v.i}>
                <p>{v.text}</p>
                <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={() => setBuilder((b) => ({ ...b, override: v.text }))}>
                  <RotateCcw size={13} /> Use this wording
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      {children}
    </section>
  );
}
