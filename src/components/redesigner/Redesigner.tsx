"use client";

// ---------------------------------------------------------------------------
// Website Redesigner — "Experimental WebGL" direction, worn over any skin.
//
// The shell is a full-bleed shader field seeded by the URL you are typing, a
// console instead of a card, and a staggered result grid.
//
// The page also WEARS the design skill you pick. Choosing one in the dropdown
// (or stepping the rail's ← →) re-skins everything — surface, ink, accent,
// the three type voices, radii, rule weight, casing, shadow, grid, the
// shader's polarity and energy, hero alignment, density. Reading "warm
// monochrome, typographic contrast" tells you nothing about a skill; watching
// the console turn into warm paper with a serif headline tells you in half a
// second. That is the whole point: judge the skills by looking at them.
//
// Motion rule for this file: nothing animates through React state. The field
// and the pointer effects are driven imperatively (see FingerprintField and
// interactions.tsx) so typing stays at 60fps.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SKILLS, type Direction, type RedesignResult } from "@/lib/redesigner/engine";
import { fingerprint, hexToRgb } from "@/lib/redesigner/fingerprint";
import {
  fieldParams,
  skinFor,
  skinVars,
  SKIN_ORDER,
  type Skin,
} from "@/lib/redesigner/skins";
import { Icon } from "../icons";
import {
  CustomCursor,
  Reveal,
  useFinePointer,
  useMagnetic,
  useReducedMotion,
  useTilt,
} from "./interactions";
import {
  FingerprintField,
  type FieldHandle,
  type FieldPaint,
  type FieldPhase,
} from "./FingerprintField";
import "./redesigner.css";

const SAMPLES = ["stripe.com", "linear.app", "vercel.com"];

/** The stepper walks the house skin plus every skill, in roster order. */
const SKIN_WALK = ["house", ...SKIN_ORDER];

export function Redesigner() {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [ownSite, setOwnSite] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  // Hovering a row in the menu shows that skin without committing to it, so
  // the list can be flicked through like a contact sheet.
  const [previewSkill, setPreviewSkill] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RedesignResult | null>(null);

  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const field = useRef<FieldHandle>(null);
  const goRef = useMagnetic<HTMLButtonElement>(fine && !reduced, 0.28);

  const fp = useMemo(() => fingerprint(url), [url]);
  const phase: FieldPhase = loading ? "forge" : result ? "done" : "idle";

  // The first pick owns the frame — the same rule the build prompt uses — so
  // it is the skill the page wears. A hover outranks it, and only visually.
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

  // ← → in the rail, and [ ] on the keyboard, walk the whole roster. Judging
  // which skill designs best is a flicking motion, not a form-filling one.
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

  // Once results land, the three palettes bleed into the field — the page ends
  // up wearing the answer it just produced.
  const cells = useMemo<Array<[number, number, number]>>(() => {
    if (!result) return [];
    return result.directions
      .slice(0, 3)
      .map((d) => {
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
      if (!data?.directions?.length) throw new Error("No redesign directions came back. Try another URL.");
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

  return (
    <div
      className="rdx"
      style={skinVars(skin)}
      data-skin={skin.id}
      data-hero={skin.hero}
      data-stagger={skin.stagger ? "1" : "0"}
      data-field={skin.field}
      onPointerDown={(e) => field.current?.ripple(e.clientX, e.clientY)}
    >
      {reduced || skin.field === "off" ? (
        <div className="rdx-field-static" />
      ) : (
        <FingerprintField
          ref={field}
          seed={fp.seed}
          turbulence={fp.turbulence}
          phase={phase}
          cells={cells}
          paint={paint}
        />
      )}
      <div className="rdx-scrim" aria-hidden />
      <div className="rdx-grid" aria-hidden />
      <CustomCursor enabled={fine && !reduced} />

      <div className="rdx-shell">
        {/* ----- rail ----- */}
        <div className="rdx-rail">
          <Link href="/" className="rdx-back" aria-label="Back to hub">
            <Icon.ArrowLeft width={13} height={13} />
            <span>Hub</span>
          </Link>
          <span className="rdx-rail-title">Website Redesigner</span>
          <span className="rdx-rail-spacer" />
          <SkinBar skin={skin} onStep={stepSkin} />
          <span className="rdx-state" data-live={loading ? "1" : "0"}>
            <span className="rdx-dot" />
            {stateLabel}
          </span>
        </div>

        {/* ----- hero ----- */}
        <header className="rdx-hero">
          <div className="rdx-hero-head">
            <p className="rdx-eyebrow">URL → Redesign</p>
            <h1 className="rdx-title">
              <span className="rdx-title-line">Redesign any site,</span>
              <span className={`rdx-title-line rdx-title-out${result ? " is-filled" : ""}`}>
                keep what it does
              </span>
            </h1>
            <p className="rdx-lede">
              Paste a URL. Get three redesign directions — each driven by a{" "}
              <b>design skill</b> and named a <b>real site to beat</b> — plus a paste-ready
              build prompt that rebuilds it with the same functionality.
            </p>
          </div>

          {/* The toy, made legible: the field behind this page is seeded by
              whatever is in the URL box, and these are its real numbers. */}
          <div className="rdx-readout" aria-hidden>
            <div className="rdx-readout-row">
              <span>seed</span>
              <span className="rdx-readout-val">{fp.label}</span>
            </div>
            <div className="rdx-readout-row">
              <span>flow</span>
              <span className="rdx-readout-val">{fp.flow.toFixed(3)}</span>
            </div>
            <div className="rdx-readout-row">
              <span>turb</span>
              <span className="rdx-readout-val">{fp.turbulence.toFixed(3)}</span>
            </div>
            <div className="rdx-readout-row">
              <span>state</span>
              <span className="rdx-readout-val" data-hot={loading ? "1" : "0"}>
                {stateLabel}
              </span>
            </div>
            <p className="rdx-readout-note">
              The field is hashed from the URL you type. Every site has its own.
            </p>
          </div>
        </header>

        <main className="rdx-body">
          {/* ----- console ----- */}
          <form onSubmit={run} className="rdx-console">
            <div className="rdx-block">
              <p className="rdx-label">
                <span className="rdx-label-idx">01</span>
                <span>Target URL</span>
                <span className="rdx-label-hint">required</span>
              </p>
              <div className="rdx-url-row">
                <input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    field.current?.pulse(0.34);
                  }}
                  placeholder="https://example.com"
                  inputMode="url"
                  aria-label="Target URL"
                  className="rdx-url"
                />
                <button ref={goRef} type="submit" disabled={loading} className="rdx-go">
                  {loading ? <Spinner /> : <Icon.Sparkles width={14} height={14} />}
                  <span className="rdx-go-txt">{loading ? "Designing…" : "Redesign"}</span>
                </button>
              </div>
            </div>

            <div className="rdx-block">
              <p className="rdx-label">
                <span className="rdx-label-idx">02</span>
                <span>Context</span>
                <span className="rdx-label-hint">optional — helps a lot for JS-heavy sites</span>
              </p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What is this site, and anything you want the redesign to nail?"
                aria-label="Context"
                className="rdx-note"
              />
            </div>

            <div className="rdx-block">
              <p className="rdx-label">
                <span className="rdx-label-idx">03</span>
                <span>Ownership</span>
              </p>
              <div className="rdx-own">
                <label className="rdx-check">
                  <input
                    type="checkbox"
                    checked={ownSite}
                    onChange={(e) => setOwnSite(e.target.checked)}
                  />
                  <span className="rdx-box">
                    <Icon.Check width={10} height={10} />
                  </span>
                  This is my own site
                </label>
                {ownSite && (
                  <input
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    placeholder="source path / repo (so the rebuild edits real code)"
                    aria-label="Source path or repo"
                    className="rdx-path"
                  />
                )}
              </div>
            </div>

            <div className="rdx-block">
              <p className="rdx-label">
                <span className="rdx-label-idx">04</span>
                <span>Design skills</span>
              </p>
              <SkillPicker
                selected={selectedSkills}
                onChange={setSelectedSkills}
                skin={skin}
                preview={previewSkill}
                onPreview={setPreviewSkill}
              />
            </div>
          </form>

          {error && (
            <div className="rdx-error" role="alert">
              <span aria-hidden>✕</span>
              <span>{error}</span>
            </div>
          )}

          {!result && !loading && !error && (
            <div className="rdx-samples">
              <span>try</span>
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setUrl(s)}
                  className="rdx-sample"
                >
                  {s}
                  <Icon.Launch width={10} height={10} />
                </button>
              ))}
            </div>
          )}

          {/* ----- results ----- */}
          {result && (
            <div className="rdx-results">
              <Reveal>
                <AnalysisReadout result={result} />
              </Reveal>
              <div className="rdx-cards">
                {result.directions.map((d, i) => (
                  <Reveal key={d.id} delay={i * 90} className="rdx-card">
                    <DirectionCard direction={d} index={i} fine={fine && !reduced} />
                  </Reveal>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function AnalysisReadout({ result }: { result: RedesignResult }) {
  const { analysis, engine } = result;
  return (
    <div className="rdx-analysis">
      <div className="rdx-analysis-top">
        <h2 className="rdx-analysis-title">{analysis.title}</h2>
        {analysis.confidence === "low" && (
          <span className="rdx-badge" data-kind="warn">
            thin scrape — add a description for a better result
          </span>
        )}
        <span className="rdx-badge" data-kind={engine === "ai" ? "ai" : "plain"}>
          <Icon.Sparkles width={9} height={9} />
          {engine === "ai" ? "AI" : "Offline draft"}
        </span>
      </div>
      <p className="rdx-analysis-summary">{analysis.summary}</p>

      {analysis.functionality.length > 0 && (
        <div className="rdx-func">
          <p className="rdx-func-head">Functionality to preserve</p>
          <div className="rdx-func-list">
            {analysis.functionality.map((f, i) => (
              <span key={i} className="rdx-func-item" title={f.detail}>
                <span className="rdx-func-kind">[{f.kind}]</span> {f.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DirectionCard({
  direction,
  index,
  fine,
}: {
  direction: Direction;
  index: number;
  fine: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tiltRef = useTilt<HTMLDivElement>(fine && !open, 4.5);

  async function copy() {
    try {
      await navigator.clipboard.writeText(direction.buildPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can expand and copy manually */
    }
  }

  return (
    <div ref={tiltRef} className="rdx-card-tilt">
      <div
        className="rdx-card-top"
        style={{
          background: `linear-gradient(140deg, ${direction.palette[0] ?? "#111"} 0%, ${
            direction.palette[1] ?? direction.palette[0] ?? "#222"
          } 100%)`,
        }}
      >
        <span className="rdx-card-num" aria-hidden>
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 className="rdx-card-name" style={{ color: direction.palette[2] ?? "#fff" }}>
          {direction.name}
        </h3>
        <div className="rdx-swatches" aria-hidden>
          {direction.palette.map((c) => (
            <span key={c} className="rdx-swatch" style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>

      <div className="rdx-card-body">
        <p className="rdx-pitch">{direction.pitch}</p>

        <div className="rdx-spec">
          <div className="rdx-spec-row">
            <span className="rdx-spec-key">
              {direction.drivingSkills.length > 1 ? "Mix" : "Skill"}
            </span>
            <span className="rdx-spec-val">
              {direction.drivingSkills.map((s) => (
                <span key={s} className="rdx-skill">
                  {s}
                </span>
              ))}
            </span>
          </div>
          <div className="rdx-spec-row">
            <span className="rdx-spec-key">Type</span>
            <span className="rdx-spec-val">
              {direction.typography.heading} · {direction.typography.body}
            </span>
          </div>
          {direction.referenceBar && (
            <div className="rdx-spec-row">
              <span className="rdx-spec-key">Beat</span>
              <span className="rdx-spec-val">{direction.referenceBar}</span>
            </div>
          )}
        </div>

        {(direction.layout || direction.motion) && (
          <p className="rdx-prose">
            {direction.layout} {direction.motion}
          </p>
        )}

        <div className="rdx-card-actions">
          <button
            type="button"
            onClick={copy}
            className="rdx-copy"
            data-done={copied ? "1" : "0"}
          >
            {copied ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
            {/* An element, not a bare text node: the hover fill is a positioned
                pseudo-element and would paint straight over loose text. */}
            <span>{copied ? "Copied" : "Copy prompt"}</span>
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
            className="rdx-expand"
            data-open={open ? "1" : "0"}
          >
            <Icon.Chevron width={14} height={14} />
          </button>
        </div>

        {open && <pre className="rdx-prompt">{direction.buildPrompt}</pre>}
      </div>
    </div>
  );
}

/**
 * Multi-select design-skill dropdown — and the page's style switch.
 *
 * Each pick closes the menu (the user's ask): reopen it to see what's already
 * chosen — highlighted with a check — and add or remove one more. Nothing
 * picked = the engine chooses per direction, and the page wears its own skin.
 *
 * Hovering or keyboard-focusing a row skins the whole page behind the open
 * menu without committing, so the roster can be flicked through and compared.
 */
function SkillPicker({
  selected,
  onChange,
  skin,
  preview,
  onPreview,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  skin: Skin;
  preview: string | null;
  onPreview: (next: string | null) => void;
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

  // A closed menu can never leave the page wearing a skin nobody chose.
  useEffect(() => {
    if (!open) onPreview(null);
  }, [open, onPreview]);

  function toggle(name: string) {
    // Keep roster order, so "the first skill owns the frame" stays predictable.
    const next = selected.includes(name)
      ? selected.filter((s) => s !== name)
      : DEFAULT_SKILLS.map((s) => s.name).filter((n) => n === name || selected.includes(n));
    onPreview(null);
    onChange(next);
    setOpen(false); // one pick per open — reopen to mix in another
  }

  const label =
    selected.length === 0
      ? "Pick for me"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} skills mixed`;

  return (
    <div>
      <div className="rdx-picker">
        <div ref={wrapRef} className="rdx-pick-wrap">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="rdx-pick"
            data-on={selected.length ? "1" : "0"}
            data-open={open ? "1" : "0"}
          >
            <span>{label}</span>
            <Icon.Chevron width={12} height={12} />
          </button>

          {open && (
            <div
              role="listbox"
              aria-multiselectable
              className="rdx-menu"
              onMouseLeave={() => onPreview(null)}
            >
              <p className="rdx-menu-head">
                <span>Hover to try it on</span>
                <span style={{ marginLeft: "auto", opacity: 0.7 }}>click to keep</span>
              </p>
              {DEFAULT_SKILLS.map((entry) => {
                const on = selected.includes(entry.name);
                const look = skinFor(entry.name);
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
                    {/* The row carries that skin's real surface, ink and
                        accent, so the list is comparable before you commit. */}
                    <span className="rdx-opt-swatch" aria-hidden>
                      <span
                        className="rdx-opt-chip"
                        style={{ backgroundColor: look.void }}
                      />
                      <span
                        className="rdx-opt-chip"
                        style={{ backgroundColor: look.ink }}
                      />
                      <span
                        className="rdx-opt-chip"
                        style={{ backgroundColor: look.sig }}
                      />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="rdx-opt-name">{entry.name}</span>
                      <span className="rdx-opt-desc">{entry.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

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

        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="rdx-clear">
            Clear
          </button>
        )}
      </div>

      {/* What you are looking at, named. The page is the sample. */}
      <p className="rdx-skin-note">
        <b>{preview ? "trying on" : "wearing"} · {skin.family}</b>
        <span>{skin.note}</span>
      </p>

      <p className="rdx-hint">
        {selected.length > 1
          ? `Every direction blends all ${selected.length} — ${selected[0]} owns the frame and skins this page, the rest add their signature moves.`
          : selected.length === 1
            ? "Every direction uses this skill, and the page is wearing it. Reopen the menu to mix in another."
            : "Leave empty and each direction picks its own skill. Hover the menu — or press [ and ] — to see what each one looks like."}
      </p>
    </div>
  );
}

/**
 * The rail's skin stepper. One place that always says which design skill the
 * page is currently wearing, and two keys' worth of travel to the next one.
 */
function SkinBar({ skin, onStep }: { skin: Skin; onStep: (dir: 1 | -1) => void }) {
  const house = skin.id === "house";
  return (
    <span className="rdx-skinbar">
      <button
        type="button"
        onClick={() => onStep(-1)}
        className="rdx-step"
        aria-label="Previous design skill (left bracket)"
        title="Previous skin  ["
      >
        <Icon.ArrowLeft width={11} height={11} />
      </button>
      <span className="rdx-skin-name" data-house={house ? "1" : "0"}>
        <span className="rdx-skin-chip" aria-hidden />
        {house ? "house skin" : skin.id}
      </span>
      <button
        type="button"
        onClick={() => onStep(1)}
        className="rdx-step"
        aria-label="Next design skill (right bracket)"
        title="Next skin  ]"
      >
        <Icon.ArrowRight width={11} height={11} />
      </button>
    </span>
  );
}

function Spinner() {
  return <span className="rdx-spinner" aria-hidden />;
}
