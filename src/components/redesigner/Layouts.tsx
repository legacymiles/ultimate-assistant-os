"use client";

// ---------------------------------------------------------------------------
// Website Redesigner — the seven compositions.
//
// Picking a design skill does not tint this page, it rebuilds it. The same
// content — target URL, context, ownership, samples, analysis, three
// directions — is arranged seven materially different ways, because an
// arrangement is what a design skill actually decides. A brutalist skill does
// not produce a dark page with red buttons; it produces a printed spec sheet
// with label/value rows and no hierarchy of surfaces. An agency skill does not
// produce rounded corners; it produces a centred stage with one floating
// capsule and enormous air.
//
// Everything here is presentation. State lives in Redesigner.tsx and is handed
// down as `parts`, so switching layout mid-session never loses a keystroke.
// The skill picker is deliberately NOT in any of these: it lives in the dock,
// fixed to the viewport, so the control you are using stays exactly where it
// is while the page reorganises around it.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useState } from "react";
import type { Direction, RedesignResult } from "@/lib/redesigner/engine";
import type { LayoutId, Skin } from "@/lib/redesigner/skins";
import { Icon } from "../icons";
import { Reveal, useTilt } from "./interactions";
import type { Fingerprint } from "@/lib/redesigner/fingerprint";

export const SAMPLES = ["stripe.com", "linear.app", "vercel.com"];

export interface Parts {
  url: string;
  setUrl: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  ownSite: boolean;
  setOwnSite: (v: boolean) => void;
  sourcePath: string;
  setSourcePath: (v: string) => void;
  loading: boolean;
  error: string | null;
  result: RedesignResult | null;
  run: (e?: React.FormEvent) => void;
  fp: Fingerprint;
  stateLabel: string;
  fine: boolean;
  skin: Skin;
}

// ----- shared pieces --------------------------------------------------------

function Back({ label = "Hub" }: { label?: string }) {
  return (
    <Link href="/" className="rdx-back" aria-label="Back to hub">
      <Icon.ArrowLeft width={13} height={13} />
      <span>{label}</span>
    </Link>
  );
}

function State({ parts }: { parts: Parts }) {
  return (
    <span className="rdx-state" data-live={parts.loading ? "1" : "0"}>
      <span className="rdx-dot" />
      {parts.stateLabel}
    </span>
  );
}

function Spinner() {
  return <span className="rdx-spinner" aria-hidden />;
}

function UrlField({ parts, cta = "Redesign" }: { parts: Parts; cta?: string }) {
  return (
    <div className="rdx-url-row">
      <input
        value={parts.url}
        onChange={(e) => parts.setUrl(e.target.value)}
        placeholder="https://example.com"
        inputMode="url"
        aria-label="Target URL"
        className="rdx-url"
      />
      <button type="submit" disabled={parts.loading} className="rdx-go">
        {parts.loading ? <Spinner /> : <Icon.Sparkles width={14} height={14} />}
        <span className="rdx-go-txt">{parts.loading ? "Designing…" : cta}</span>
      </button>
    </div>
  );
}

function ContextField({ parts, rows = 2 }: { parts: Parts; rows?: number }) {
  return (
    <textarea
      value={parts.description}
      onChange={(e) => parts.setDescription(e.target.value)}
      rows={rows}
      placeholder="What is this site, and anything you want the redesign to nail?"
      aria-label="Context"
      className="rdx-note"
    />
  );
}

function OwnershipField({ parts }: { parts: Parts }) {
  return (
    <div className="rdx-own">
      <label className="rdx-check">
        <input
          type="checkbox"
          checked={parts.ownSite}
          onChange={(e) => parts.setOwnSite(e.target.checked)}
        />
        <span className="rdx-box">
          <Icon.Check width={10} height={10} />
        </span>
        This is my own site
      </label>
      {parts.ownSite && (
        <input
          value={parts.sourcePath}
          onChange={(e) => parts.setSourcePath(e.target.value)}
          placeholder="source path / repo (so the rebuild edits real code)"
          aria-label="Source path or repo"
          className="rdx-path"
        />
      )}
    </div>
  );
}

function Samples({ parts }: { parts: Parts }) {
  if (parts.result || parts.loading || parts.error) return null;
  return (
    <div className="rdx-samples">
      <span>try</span>
      {SAMPLES.map((s) => (
        <button key={s} type="button" onClick={() => parts.setUrl(s)} className="rdx-sample">
          {s}
          <Icon.Launch width={10} height={10} />
        </button>
      ))}
    </div>
  );
}

function ErrorNote({ parts }: { parts: Parts }) {
  if (!parts.error) return null;
  return (
    <div className="rdx-error" role="alert">
      <span aria-hidden>✕</span>
      <span>{parts.error}</span>
    </div>
  );
}

function Readout({ parts }: { parts: Parts }) {
  const { fp, loading, stateLabel } = parts;
  return (
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
    </div>
  );
}

function Analysis({ result }: { result: RedesignResult }) {
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

/** Clipboard, shared by all three direction shapes. */
function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the prompt can still be expanded and copied */
    }
  }
  return { copied, copy };
}

function Swatches({ palette }: { palette: string[] }) {
  return (
    <div className="rdx-swatches" aria-hidden>
      {palette.map((c) => (
        <span key={c} className="rdx-swatch" style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}

function Spec({ direction }: { direction: Direction }) {
  return (
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
  );
}

function CopyRow({
  direction,
  open,
  setOpen,
}: {
  direction: Direction;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const { copied, copy } = useCopy(direction.buildPrompt);
  return (
    <div className="rdx-card-actions">
      <button type="button" onClick={copy} className="rdx-copy" data-done={copied ? "1" : "0"}>
        {copied ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
        <span>{copied ? "Copied" : "Copy prompt"}</span>
      </button>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Collapse" : "Expand"}
        aria-expanded={open}
        className="rdx-expand"
        data-open={open ? "1" : "0"}
      >
        <Icon.Chevron width={14} height={14} />
      </button>
    </div>
  );
}

/** Block shape: console, sheet, atelier, reel, lab. */
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
  const tiltRef = useTilt<HTMLDivElement>(fine && !open, 4.5);

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
        <Swatches palette={direction.palette} />
      </div>

      <div className="rdx-card-body">
        <p className="rdx-pitch">{direction.pitch}</p>
        <Spec direction={direction} />
        {(direction.layout || direction.motion) && (
          <p className="rdx-prose">
            {direction.layout} {direction.motion}
          </p>
        )}
        <CopyRow direction={direction} open={open} setOpen={setOpen} />
        {open && <pre className="rdx-prompt">{direction.buildPrompt}</pre>}
      </div>
    </div>
  );
}

/** Long-form shape: editorial. The direction reads as an article entry. */
function DirectionEntry({ direction, index }: { direction: Direction; index: number }) {
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy(direction.buildPrompt);
  return (
    <article className="rdx-entry">
      <p className="rdx-entry-num" aria-hidden>
        {String(index + 1).padStart(2, "0")}
      </p>
      <div className="rdx-entry-body">
        <h3 className="rdx-entry-name">{direction.name}</h3>
        <p className="rdx-entry-pitch">{direction.pitch}</p>
        <dl className="rdx-entry-meta">
          <dt>Skill</dt>
          <dd>{direction.drivingSkills.join(" + ")}</dd>
          <dt>Type</dt>
          <dd>
            {direction.typography.heading} · {direction.typography.body}
          </dd>
          {direction.referenceBar && (
            <>
              <dt>Beat</dt>
              <dd>{direction.referenceBar}</dd>
            </>
          )}
        </dl>
        <div className="rdx-entry-bar" aria-hidden>
          {direction.palette.map((c) => (
            <span key={c} style={{ backgroundColor: c }} />
          ))}
        </div>
        <p className="rdx-entry-links">
          <button type="button" onClick={copy} className="rdx-link" data-done={copied ? "1" : "0"}>
            {copied ? "Prompt copied" : "Copy build prompt"}
          </button>
          <button type="button" onClick={() => setOpen(!open)} className="rdx-link">
            {open ? "Hide it" : "Read it"}
          </button>
        </p>
        {open && <pre className="rdx-prompt">{direction.buildPrompt}</pre>}
      </div>
    </article>
  );
}

/** Dense shape: workbench. A record in a table, expanding in place. */
function DirectionRow({ direction, index }: { direction: Direction; index: number }) {
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy(direction.buildPrompt);
  return (
    <>
      <tr className="rdx-tr" data-open={open ? "1" : "0"}>
        <td className="rdx-td rdx-td-idx">{String(index + 1).padStart(2, "0")}</td>
        <td className="rdx-td">
          <span className="rdx-td-name">{direction.name}</span>
          <span className="rdx-td-sub">{direction.pitch}</span>
        </td>
        <td className="rdx-td rdx-td-skill">
          {direction.drivingSkills.map((s) => (
            <span key={s} className="rdx-skill">
              {s}
            </span>
          ))}
        </td>
        <td className="rdx-td rdx-td-type">
          {direction.typography.heading} · {direction.typography.body}
        </td>
        <td className="rdx-td">
          <Swatches palette={direction.palette} />
        </td>
        <td className="rdx-td rdx-td-act">
          <button type="button" onClick={copy} className="rdx-copy" data-done={copied ? "1" : "0"}>
            {copied ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
            className="rdx-expand"
            data-open={open ? "1" : "0"}
          >
            <Icon.Chevron width={14} height={14} />
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td className="rdx-td rdx-td-full" colSpan={6}>
            <pre className="rdx-prompt">{direction.buildPrompt}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function Directions({ parts, shape }: { parts: Parts; shape: "card" | "entry" | "row" }) {
  const { result, fine } = parts;
  if (!result) return null;

  if (shape === "row") {
    return (
      <div className="rdx-tablewrap">
        <table className="rdx-table">
          <thead>
            <tr>
              <th />
              <th>Direction</th>
              <th>Skill</th>
              <th>Type</th>
              <th>Palette</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.directions.map((d, i) => (
              <DirectionRow key={d.id} direction={d} index={i} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (shape === "entry") {
    return (
      <div className="rdx-entries">
        {result.directions.map((d, i) => (
          <DirectionEntry key={d.id} direction={d} index={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="rdx-cards">
      {result.directions.map((d, i) => (
        <Reveal key={d.id} delay={i * 90} className="rdx-card">
          <DirectionCard direction={d} index={i} fine={fine} />
        </Reveal>
      ))}
    </div>
  );
}

// ----- 1. console — the house instrument panel ------------------------------

function ConsoleLayout({ parts }: { parts: Parts }) {
  const { result } = parts;
  return (
    <>
      <div className="rdx-rail">
        <Back />
        <span className="rdx-rail-title">Website Redesigner</span>
        <span className="rdx-rail-spacer" />
        <State parts={parts} />
      </div>

      <header className="rdx-hero">
        <div className="rdx-hero-head">
          <h1 className="rdx-title">
            <span className="rdx-title-line">Redesign any site,</span>
            <span className={`rdx-title-line rdx-title-out${result ? " is-filled" : ""}`}>
              keep what it does
            </span>
          </h1>
          <p className="rdx-lede">
            Paste a URL. Get three redesign directions — each driven by a <b>design skill</b>{" "}
            and named a <b>real site to beat</b> — plus a paste-ready build prompt that rebuilds
            it with the same functionality.
          </p>
        </div>
        <Readout parts={parts} />
      </header>

      <main className="rdx-body">
        <form onSubmit={parts.run} className="rdx-console">
          <div className="rdx-block">
            <p className="rdx-label">
              <span>Target URL</span>
              <span className="rdx-label-hint">required</span>
            </p>
            <UrlField parts={parts} />
          </div>
          <div className="rdx-block">
            <p className="rdx-label">
              <span>Context</span>
              <span className="rdx-label-hint">optional — helps a lot for JS-heavy sites</span>
            </p>
            <ContextField parts={parts} />
          </div>
          <div className="rdx-block">
            <p className="rdx-label">
              <span>Ownership</span>
            </p>
            <OwnershipField parts={parts} />
          </div>
        </form>
        <ErrorNote parts={parts} />
        <Samples parts={parts} />
        {result && (
          <div className="rdx-results">
            <Reveal>
              <Analysis result={result} />
            </Reveal>
            <Directions parts={parts} shape="card" />
          </div>
        )}
      </main>
    </>
  );
}

// ----- 2. sheet — printed spec sheet ---------------------------------------

function SheetLayout({ parts }: { parts: Parts }) {
  const { result, fp } = parts;
  const ticker = `REDESIGN BUREAU · SEED ${fp.label} · FLOW ${fp.flow.toFixed(3)} · TURB ${fp.turbulence.toFixed(3)} · STATE ${parts.stateLabel.toUpperCase()} · `;
  return (
    <>
      <div className="rdx-masthead">
        <Back label="HUB" />
        <h1 className="rdx-masthead-title">Website Redesigner</h1>
        <State parts={parts} />
      </div>
      <div className="rdx-ticker" aria-hidden>
        <span>{ticker.repeat(4)}</span>
      </div>

      <main className="rdx-sheet">
        <div className="rdx-sheet-head">
          <p className="rdx-sheet-kicker">Form R-01 · redesign requisition</p>
          <h2 className="rdx-sheet-title">
            Redesign any site.
            <br />
            Keep what it does.
          </h2>
          <p className="rdx-sheet-abstract">
            Paste a URL. Three redesign directions come back, each driven by a design skill and
            named a real site to beat, each with a paste-ready build prompt that rebuilds the page
            with its functionality intact.
          </p>
        </div>

        <form onSubmit={parts.run} className="rdx-rows">
          <div className="rdx-row">
            <span className="rdx-row-key">01 / target url</span>
            <div className="rdx-row-val">
              <UrlField parts={parts} cta="Run" />
            </div>
          </div>
          <div className="rdx-row">
            <span className="rdx-row-key">02 / context</span>
            <div className="rdx-row-val">
              <ContextField parts={parts} rows={2} />
            </div>
          </div>
          <div className="rdx-row">
            <span className="rdx-row-key">03 / ownership</span>
            <div className="rdx-row-val">
              <OwnershipField parts={parts} />
            </div>
          </div>
          <div className="rdx-row">
            <span className="rdx-row-key">04 / fingerprint</span>
            <div className="rdx-row-val">
              <Readout parts={parts} />
            </div>
          </div>
        </form>

        <ErrorNote parts={parts} />
        <Samples parts={parts} />

        {result && (
          <div className="rdx-results">
            <Analysis result={result} />
            <Directions parts={parts} shape="card" />
          </div>
        )}
      </main>
    </>
  );
}

// ----- 3. editorial — one measure, set in serif -----------------------------

function EditorialLayout({ parts }: { parts: Parts }) {
  const { result } = parts;
  return (
    <>
      <div className="rdx-rail">
        <Back />
        <span className="rdx-rail-spacer" />
        <State parts={parts} />
      </div>

      <main className="rdx-measure">
        <h1 className="rdx-ed-title">Redesign any site, keep what it does.</h1>
        <p className="rdx-ed-lede">
          Paste a URL. Three redesign directions come back — each driven by a design skill, each
          named a real site to beat — with a build prompt that rebuilds the page and leaves every
          working part of it alone.
        </p>

        <form onSubmit={parts.run} className="rdx-ed-form">
          <p className="rdx-ed-line">
            <label className="rdx-ed-label" htmlFor="rdx-ed-url">
              Redesign
            </label>
            <input
              id="rdx-ed-url"
              value={parts.url}
              onChange={(e) => parts.setUrl(e.target.value)}
              placeholder="example.com"
              inputMode="url"
              className="rdx-ed-input"
            />
          </p>
          <p className="rdx-ed-line">
            <label className="rdx-ed-label" htmlFor="rdx-ed-ctx">
              and make sure it
            </label>
            <input
              id="rdx-ed-ctx"
              value={parts.description}
              onChange={(e) => parts.setDescription(e.target.value)}
              placeholder="keeps the booking flow intact…"
              className="rdx-ed-input"
            />
          </p>
          <div className="rdx-ed-foot">
            <OwnershipField parts={parts} />
            <button type="submit" disabled={parts.loading} className="rdx-go">
              {parts.loading ? <Spinner /> : <Icon.Sparkles width={14} height={14} />}
              <span className="rdx-go-txt">{parts.loading ? "Designing…" : "Redesign"}</span>
            </button>
          </div>
        </form>

        <ErrorNote parts={parts} />
        <Samples parts={parts} />

        {result && (
          <div className="rdx-results">
            <Analysis result={result} />
            <Directions parts={parts} shape="entry" />
          </div>
        )}
      </main>
    </>
  );
}

// ----- 4. atelier — centred stage, floating capsule -------------------------

function AtelierLayout({ parts }: { parts: Parts }) {
  const { result } = parts;
  return (
    <>
      <div className="rdx-rail">
        <Back />
        <span className="rdx-rail-spacer" />
        <State parts={parts} />
      </div>

      <main className="rdx-stagearea">
        <h1 className="rdx-at-title">
          Redesign any site,
          <em>keep what it does</em>
        </h1>
        <p className="rdx-at-lede">
          Three directions, each driven by a design skill and named a real site to beat, with a
          build prompt that keeps every working part of the page.
        </p>

        <form onSubmit={parts.run} className="rdx-capsule-wrap">
          {/* The pill holds ONE thing — the URL. A pill wrapped around a whole
              form stops being a pill and becomes a lozenge with a card in it. */}
          <div className="rdx-capsule">
            <UrlField parts={parts} />
          </div>
          <div className="rdx-capsule-more">
            <ContextField parts={parts} rows={2} />
            <OwnershipField parts={parts} />
          </div>
        </form>

        <ErrorNote parts={parts} />
        <Samples parts={parts} />

        {result && (
          <div className="rdx-results">
            <Analysis result={result} />
            <Directions parts={parts} shape="card" />
          </div>
        )}
      </main>
    </>
  );
}

// ----- 5. workbench — app shell --------------------------------------------

function WorkbenchLayout({ parts }: { parts: Parts }) {
  const { result } = parts;
  const steps = [
    { n: "1", label: "Target", done: !!parts.url.trim() },
    { n: "2", label: "Context", done: !!parts.description.trim() },
    { n: "3", label: "Ownership", done: parts.ownSite },
    { n: "4", label: "Directions", done: !!result },
  ];
  return (
    <div className="rdx-shellgrid">
      <aside className="rdx-side">
        <Back />
        <p className="rdx-side-title">Redesigner</p>
        <ol className="rdx-steps">
          {steps.map((s) => (
            <li key={s.n} className="rdx-step-item" data-done={s.done ? "1" : "0"}>
              <span className="rdx-step-n">{s.done ? <Icon.Check width={9} height={9} /> : s.n}</span>
              {s.label}
            </li>
          ))}
        </ol>
        <div className="rdx-side-foot">
          <Readout parts={parts} />
        </div>
      </aside>

      <div className="rdx-work">
        <div className="rdx-toolbar">
          <span className="rdx-work-title">Redesign a site</span>
          <span className="rdx-rail-spacer" />
          <State parts={parts} />
        </div>

        <main className="rdx-workbody">
          <form onSubmit={parts.run} className="rdx-panel">
            <div className="rdx-wb-field">
              <label className="rdx-label" htmlFor="rdx-wb-url">
                <span>Target URL</span>
                <span className="rdx-label-hint">required</span>
              </label>
              <div className="rdx-url-row">
                <input
                  id="rdx-wb-url"
                  value={parts.url}
                  onChange={(e) => parts.setUrl(e.target.value)}
                  placeholder="https://example.com"
                  inputMode="url"
                  className="rdx-url"
                />
                <button type="submit" disabled={parts.loading} className="rdx-go">
                  {parts.loading ? <Spinner /> : <Icon.Sparkles width={14} height={14} />}
                  <span className="rdx-go-txt">{parts.loading ? "Designing…" : "Redesign"}</span>
                </button>
              </div>
            </div>
            <div className="rdx-wb-field">
              <label className="rdx-label" htmlFor="rdx-wb-ctx">
                <span>Context</span>
                <span className="rdx-label-hint">optional</span>
              </label>
              <ContextField parts={parts} />
            </div>
            <div className="rdx-wb-field">
              <p className="rdx-label">
                <span>Ownership</span>
              </p>
              <OwnershipField parts={parts} />
            </div>
          </form>

          <ErrorNote parts={parts} />
          <Samples parts={parts} />

          {result && (
            <div className="rdx-results">
              <Analysis result={result} />
              <Directions parts={parts} shape="row" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ----- 6. reel — letterboxed title card + filmstrip -------------------------

function ReelLayout({ parts }: { parts: Parts }) {
  const { result } = parts;
  return (
    <>
      <div className="rdx-bar rdx-bar-top" aria-hidden />
      <div className="rdx-rail rdx-rail-reel">
        <Back />
        <span className="rdx-rail-spacer" />
        <State parts={parts} />
      </div>

      <main className="rdx-reel">
        <div className="rdx-titlecard">
          <p className="rdx-reel-kicker">reel 01 · redesign</p>
          <h1 className="rdx-reel-title">Redesign any site</h1>
          <p className="rdx-reel-sub">keep what it does</p>
        </div>

        <form onSubmit={parts.run} className="rdx-slate">
          <div className="rdx-slate-row">
            <span className="rdx-slate-key">scene</span>
            <UrlField parts={parts} cta="Shoot it" />
          </div>
          <div className="rdx-slate-row">
            <span className="rdx-slate-key">notes</span>
            <ContextField parts={parts} rows={2} />
          </div>
          <div className="rdx-slate-row">
            <span className="rdx-slate-key">rights</span>
            <OwnershipField parts={parts} />
          </div>
        </form>

        <ErrorNote parts={parts} />
        <Samples parts={parts} />

        {result && (
          <div className="rdx-results">
            <Analysis result={result} />
            <Directions parts={parts} shape="card" />
          </div>
        )}
      </main>
      <div className="rdx-bar rdx-bar-bottom" aria-hidden />
    </>
  );
}

// ----- 7. lab — full-bleed field, panels off-axis ---------------------------

function LabLayout({ parts }: { parts: Parts }) {
  const { result } = parts;
  return (
    <>
      <div className="rdx-rail rdx-rail-lab">
        <Back />
        <span className="rdx-rail-spacer" />
        <State parts={parts} />
      </div>

      <main className="rdx-lab">
        <h1 className="rdx-lab-title">
          <span>Redesign</span>
          <span className="rdx-lab-title-2">any site</span>
        </h1>
        <p className="rdx-lab-lede">
          Three directions. Each one driven by a design skill, named a real site to beat, and
          handed back as a build prompt that keeps the thing working.
        </p>

        <form onSubmit={parts.run} className="rdx-glass rdx-glass-a">
          <UrlField parts={parts} cta="Run it" />
          <ContextField parts={parts} rows={2} />
        </form>
        <div className="rdx-glass rdx-glass-b">
          <OwnershipField parts={parts} />
          <Readout parts={parts} />
        </div>

        <ErrorNote parts={parts} />
        <Samples parts={parts} />

        {result && (
          <div className="rdx-results">
            <Analysis result={result} />
            <Directions parts={parts} shape="card" />
          </div>
        )}
      </main>
    </>
  );
}

const LAYOUTS: Record<LayoutId, (p: { parts: Parts }) => React.ReactElement> = {
  console: ConsoleLayout,
  sheet: SheetLayout,
  editorial: EditorialLayout,
  atelier: AtelierLayout,
  workbench: WorkbenchLayout,
  reel: ReelLayout,
  lab: LabLayout,
};

export function Layout({ parts }: { parts: Parts }) {
  const Chosen = LAYOUTS[parts.skin.layout] ?? ConsoleLayout;
  return <Chosen parts={parts} />;
}
