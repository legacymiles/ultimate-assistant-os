"use client";

// ---------------------------------------------------------------------------
// Website Redesigner — the shell.
//
// This file owns state, the request, and the two things that never move: the
// backdrop and the dock. Everything else — the entire page composition — is
// chosen by the design skill you have picked or are hovering, and lives in
// Layouts.tsx.
//
// The deal with the owner: hovering a skill in the dropdown redesigns the page
// as if that skill had built it — layout, background, motion, colour, type —
// while the dropdown itself stays exactly where it is, docked to the viewport.
// So the control never moves and everything around it does.
//
// Motion rule for this file: nothing animates through React state. The field
// and the pointer effects are driven imperatively (see FingerprintField and
// interactions.tsx) so typing stays at 60fps.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SKILLS, type RedesignResult } from "@/lib/redesigner/engine";
import { fingerprint, hexToRgb } from "@/lib/redesigner/fingerprint";
import {
  fieldParams,
  skinFor,
  skinVars,
  SKIN_ORDER,
  type Skin,
} from "@/lib/redesigner/skins";
import { Icon } from "../icons";
import { CustomCursor, useFinePointer, useReducedMotion } from "./interactions";
import {
  FingerprintField,
  type FieldHandle,
  type FieldPaint,
  type FieldPhase,
} from "./FingerprintField";
import { Layout, type Parts } from "./Layouts";
import "./redesigner.css";
import "./layouts.css";

/** The stepper walks the house composition plus every skill, in roster order. */
const SKIN_WALK = ["house", ...SKIN_ORDER];

export function Redesigner() {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [ownSite, setOwnSite] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  // Hovering a row in the menu rebuilds the page without committing to it, so
  // the roster can be flicked through like a portfolio.
  const [previewSkill, setPreviewSkill] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RedesignResult | null>(null);

  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const field = useRef<FieldHandle>(null);

  const fp = useMemo(() => fingerprint(url), [url]);
  const phase: FieldPhase = loading ? "forge" : result ? "done" : "idle";

  // The first pick owns the frame — the same rule the build prompt uses — so
  // it is the skill the page is built as. A hover outranks it, visually only.
  const skinId = previewSkill ?? selectedSkills[0] ?? null;
  const skin = skinFor(skinId);

  const paint = useMemo<FieldPaint>(() => {
    const f = fieldParams(skin);
    return {
      base: hexToRgb(f.base) ?? [0.02, 0.02, 0.02],
      sig: hexToRgb(f.sig) ?? [1, 0.3, 0.18],
      polarity: f.polarity,
      energy: f.energy,
      texture: f.texture,
    };
  }, [skin]);

  // Once results land, the three palettes bleed into the field — the page ends
  // up wearing the answer it just produced.
  const cells = useMemo<Array<[number, number, number]>>(() => {
    if (!result) return [];
    return result.directions.slice(0, 3).map((d) => {
      const hex = d.palette[2] ?? d.palette[d.palette.length - 1] ?? "#FF4D2E";
      const rgb = hexToRgb(hex) ?? [1, 0.3, 0.18];
      return [rgb[0] * 0.8, rgb[1] * 0.8, rgb[2] * 0.8] as [number, number, number];
    });
  }, [result]);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!url.trim()) {
      setError("Paste a URL to redesign.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/redesign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          description: description.trim() || undefined,
          ownSite,
          sourcePath: ownSite ? sourcePath.trim() || undefined : undefined,
          selectedSkills,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      if (!data?.directions?.length)
        throw new Error("No redesign directions came back. Try another URL.");
      setResult(data as RedesignResult);
    } catch (err) {
      setError((err as Error).message || "Something went wrong generating the redesign.");
    } finally {
      setLoading(false);
    }
  }

  const stateLabel = loading
    ? "forging"
    : result
      ? `${result.directions.length} directions`
      : "idle";

  // ← → in the dock, and [ ] on the keyboard, walk the whole roster.
  function stepSkin(dir: 1 | -1) {
    setPreviewSkill(null);
    // Functional update, because a held-down bracket fires faster than React
    // re-renders — reading selectedSkills here would walk the same step twice.
    setSelectedSkills((prev) => {
      const at = SKIN_WALK.indexOf(prev[0] ?? "house");
      const next = SKIN_WALK[(at + dir + SKIN_WALK.length) % SKIN_WALK.length];
      return next === "house" ? [] : [next];
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "[" && e.key !== "]") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      // Never steal a bracket from someone typing a URL or a note.
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      stepSkin(e.key === "]" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const parts: Parts = {
    url,
    setUrl: (v) => {
      setUrl(v);
      field.current?.pulse(0.34);
    },
    description,
    setDescription,
    ownSite,
    setOwnSite,
    sourcePath,
    setSourcePath,
    loading,
    error,
    result,
    run,
    fp,
    stateLabel,
    fine: fine && !reduced,
    skin,
  };

  const showField = !reduced && skin.backdrop === "field" && skin.field !== "off";

  return (
    <div
      className="rdx"
      style={skinVars(skin)}
      data-skin={skin.id}
      data-layout={skin.layout}
      data-motion={skin.motion}
      data-backdrop={skin.backdrop}
      data-hero={skin.hero}
      data-stagger={skin.stagger ? "1" : "0"}
      data-field={skin.field}
      onPointerDown={(e) => field.current?.ripple(e.clientX, e.clientY)}
    >
      {showField ? (
        <FingerprintField
          ref={field}
          seed={fp.seed}
          turbulence={fp.turbulence}
          phase={phase}
          cells={cells}
          paint={paint}
        />
      ) : (
        <Backdrop kind={skin.backdrop} />
      )}
      {skin.backdrop === "field" && <div className="rdx-scrim" aria-hidden />}
      <div className="rdx-grid" aria-hidden />
      <CustomCursor enabled={fine && !reduced} />

      {/* Remounting on layout change — not on every skin — replays that
          composition's authored entrance without restarting it when two skills
          of the same family follow each other. */}
      <div key={skin.layout} className="rdx-shell rdx-stage">
        <Layout parts={parts} />
      </div>

      <Dock
        selected={selectedSkills}
        onChange={setSelectedSkills}
        skin={skin}
        preview={previewSkill}
        onPreview={setPreviewSkill}
        onStep={stepSkin}
      />
    </div>
  );
}

/**
 * The background, for the compositions that do not run the shader. Each one is
 * a different material, not a different colour: paper takes grain and a press
 * rule, bloom takes two slow lights, dots take a measured grid, bars take a
 * projector vignette. Pure CSS, so switching costs nothing.
 */
function Backdrop({ kind }: { kind: string }) {
  if (kind === "flat") return <div className="rdx-bg rdx-bg-flat" aria-hidden />;
  return (
    <div className={`rdx-bg rdx-bg-${kind}`} aria-hidden>
      {kind === "bloom" && (
        <>
          <span className="rdx-bloom rdx-bloom-1" />
          <span className="rdx-bloom rdx-bloom-2" />
        </>
      )}
      {kind === "bars" && <span className="rdx-projector" />}
    </div>
  );
}

/**
 * The dock: the one thing on this page that never moves.
 *
 * Every composition rearranges around it, so the control you are holding stays
 * under your cursor while the page becomes a spec sheet, an app shell, a
 * filmstrip. Hovering a row builds the page as that skill; clicking keeps it.
 */
function Dock({
  selected,
  onChange,
  skin,
  preview,
  onPreview,
  onStep,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  skin: Skin;
  preview: string | null;
  onPreview: (next: string | null) => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A closed menu can never leave the page built as something nobody chose.
  useEffect(() => {
    if (!open) onPreview(null);
  }, [open, onPreview]);

  function toggle(name: string) {
    // Keep roster order, so "the first skill owns the frame" stays predictable.
    const next = selected.includes(name)
      ? selected.filter((s) => s !== name)
      : DEFAULT_SKILLS.map((s) => s.name).filter(
          (n) => n === name || selected.includes(n),
        );
    onPreview(null);
    onChange(next);
    setOpen(false); // one pick per open — reopen to mix in another
  }

  const house = skin.id === "house";
  const label =
    selected.length === 0
      ? "Pick for me"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} skills mixed`;

  return (
    <div className="rdx-dock" ref={wrapRef}>
      <div className="rdx-dock-top">
        <button
          type="button"
          onClick={() => onStep(-1)}
          className="rdx-step"
          aria-label="Previous design skill (left bracket)"
          title="Previous  ["
        >
          <Icon.ArrowLeft width={11} height={11} />
        </button>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="rdx-pick"
          data-on={selected.length ? "1" : "0"}
          data-open={open ? "1" : "0"}
        >
          <span className="rdx-pick-chip" aria-hidden />
          <span className="rdx-pick-label">{label}</span>
          <Icon.Chevron width={12} height={12} />
        </button>

        <button
          type="button"
          onClick={() => onStep(1)}
          className="rdx-step"
          aria-label="Next design skill (right bracket)"
          title="Next  ]"
        >
          <Icon.ArrowRight width={11} height={11} />
        </button>
      </div>

      <p className="rdx-dock-note">
        <b>{preview ? "building as" : house ? "house" : "built as"}</b>
        <span>{skin.note}</span>
      </p>

      {selected.length > 0 && (
        <div className="rdx-dock-tags">
          {selected.map((name) => (
            <span key={name} className="rdx-tag">
              {name}
              <button
                type="button"
                onClick={() => onChange(selected.filter((s) => s !== name))}
                aria-label={`Remove ${name}`}
              >
                &times;
              </button>
            </span>
          ))}
          <button type="button" onClick={() => onChange([])} className="rdx-clear">
            Clear
          </button>
        </div>
      )}

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="rdx-menu"
          onMouseLeave={() => onPreview(null)}
        >
          <p className="rdx-menu-head">
            <span>Hover to rebuild the page</span>
            <span style={{ marginLeft: "auto", opacity: 0.7 }}>click to keep</span>
          </p>
          {DEFAULT_SKILLS.map((entry) => {
            const look = skinFor(entry.name);
            const on = selected.includes(entry.name);
            return (
              <button
                key={entry.name}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(entry.name)}
                onMouseEnter={() => onPreview(entry.name)}
                onFocus={() => onPreview(entry.name)}
                className="rdx-opt"
                data-on={on ? "1" : "0"}
                data-preview={preview === entry.name ? "1" : "0"}
              >
                <span className="rdx-opt-mark">
                  {on && <Icon.Check width={9} height={9} />}
                </span>
                {/* That skin's real surface, ink and accent, so the list is
                    comparable before you commit to anything. */}
                <span className="rdx-opt-swatch" aria-hidden>
                  <span className="rdx-opt-chip" style={{ backgroundColor: look.void }} />
                  <span className="rdx-opt-chip" style={{ backgroundColor: look.ink }} />
                  <span className="rdx-opt-chip" style={{ backgroundColor: look.sig }} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="rdx-opt-name">
                    {entry.name}
                    <span className="rdx-opt-layout">{look.layout}</span>
                  </span>
                  <span className="rdx-opt-desc">{entry.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
