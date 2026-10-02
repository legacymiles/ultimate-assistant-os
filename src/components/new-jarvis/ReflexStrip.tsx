"use client";

// ---------------------------------------------------------------------------
// The reflex, on screen.
//
// Useful COLLAPSED. One line, present while you type — "answered here · 180 µs"
// — with the bars as an expansion rather than the point. Most telemetry makes
// you open it before it tells you anything; this says the answer and hides the
// working.
//
// It updates as you type, so you can watch it change its mind: "zone" asks the
// model, "zone recovery hedging" is answered here. That live loop is how the
// owner learns what it can short-circuit, without reading anything.
//
// When it does short-circuit, the answer is here BEFORE enter is pressed, with
// a way past it. A reflex that is wrong and cannot be overridden is worse than
// no reflex.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import { formatMicros, ROUTE_LABEL, savedACall, type Reflex } from "@/lib/new-jarvis/reflex";

/** Colour is the route, and nothing else on this strip is coloured at all. */
const ROUTE_CLASS: Record<Reflex["route"], string> = {
  answer: "text-core",
  cannot: "text-amber-300",
  think: "text-support",
  wait: "text-ink-faint",
};

interface Props {
  reflex: Reflex;
  /** Take the local answer and stop. */
  onAccept: () => void;
  /** Send it to the model regardless. */
  onAnyway: () => void;
}

export function ReflexStrip({ reflex, onAccept, onAnyway }: Props) {
  const [open, setOpen] = useState(false);
  const short = savedACall(reflex.route);

  return (
    <div className="nj-reflex border-b border-line bg-panel">
      <div className="flex items-center gap-2 px-3 py-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <Icon.Chevron
            width={9}
            height={9}
            className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
          <span className={`shrink-0 text-[10px] uppercase tracking-[0.12em] ${ROUTE_CLASS[reflex.route]}`}>
            {ROUTE_LABEL[reflex.route]}
          </span>
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-muted">{reflex.because}</span>
          {/* Microseconds, in tabular figures so the number does not jitter
              sideways on every keystroke. */}
          <span className="shrink-0 font-mono text-[10px] text-ink-faint" data-num>
            {formatMicros(reflex.micros)}
          </span>
        </button>
      </div>

      {/* The short circuit, offered rather than imposed. */}
      {short && (
        <div className="border-t border-line-soft px-3 py-2">
          {reflex.route === "answer" && reflex.best && (
            <>
              <p className="text-[11px] text-ink">{reflex.best.title}</p>
              {reflex.best.excerpt && (
                <p className="mt-0.5 line-clamp-3 text-[10.5px] leading-relaxed text-ink-muted">{reflex.best.excerpt}</p>
              )}
            </>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {reflex.route === "answer" && (
              <button
                type="button"
                onClick={onAccept}
                className="rounded border border-line bg-panel-2 px-2 py-0.5 text-[10.5px] text-ink transition hover:border-ink-faint hover:bg-elevated"
              >
                That is what I wanted
              </button>
            )}
            <button
              type="button"
              onClick={onAnyway}
              className="rounded px-2 py-0.5 text-[10.5px] text-ink-muted transition hover:text-ink"
            >
              Ask the model anyway
            </button>
            <span className="text-[9.5px] text-ink-faint">
              {reflex.route === "answer" ? "Nothing was sent anywhere." : "Nothing was sent — it would not have worked."}
            </span>
          </div>
        </div>
      )}

      {open && (
        <ul className="space-y-1 border-t border-line-soft px-3 py-2">
          {reflex.signals.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="w-[5.5rem] shrink-0 text-[10px] text-ink-muted">{s.label}</span>
              {/* A thin filled rule, not a rounded pill — this is an instrument
                  readout and five pills would read as a dashboard. */}
              <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-line-soft" aria-hidden>
                <span
                  className="block h-full bg-ink-muted transition-[width] duration-[90ms] ease-linear"
                  style={{ width: `${Math.round(s.value * 100)}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-faint" data-num>
                {Math.round(s.value * 100)}%
              </span>
              <span className="hidden w-[16rem] shrink-0 truncate text-[9.5px] text-ink-faint sm:block" title={s.note}>
                {s.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
