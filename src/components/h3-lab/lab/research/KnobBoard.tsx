"use client";

// The knob switchboard: every compiler knob as a segmented control. The value
// in force is filled (amber when it is the master's, cyan when it is an
// experimental override); the master's own value carries a small amber dot.
// The fill slides between values — the one place motion says "this moved" —
// and holds still under reduced motion.

import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import type { Knob, Strategy } from "@/lib/h3-lab/model";
import { KNOBS } from "@/lib/h3-lab/strategy";

export function KnobBoard({
  id,
  master,
  overrides,
  onChange,
}: {
  /** Unique per board on the page (layout animation group). */
  id: string;
  master: Strategy;
  overrides: Partial<Strategy>;
  onChange: (next: Partial<Strategy>) => void;
}) {
  const reduce = useReducedMotion();
  const set = (knob: Knob, value: string) => {
    const next = { ...overrides } as Record<string, string>;
    if (master[knob] === value) delete next[knob];
    else next[knob] = value;
    onChange(next as Partial<Strategy>);
  };
  return (
    <LayoutGroup id={id}>
      <div role="group" aria-label="Compiler knobs">
        {KNOBS.map((def) => {
          const inForce = (overrides[def.knob] as string | undefined) ?? master[def.knob];
          const changed = inForce !== master[def.knob];
          return (
            <div className="knob-row" key={def.knob}>
              <div className="knob-name" title={def.question}>
                {def.label}
                <small>{def.question}</small>
              </div>
              <div className="seg" role="group" aria-label={def.label}>
                {def.values.map((v) => {
                  const on = v.value === inForce;
                  const isMaster = v.value === master[def.knob];
                  return (
                    <button
                      key={v.value}
                      type="button"
                      aria-pressed={on}
                      title={`${v.does}\nSource: ${v.source}${isMaster ? "\n(master value)" : ""}`}
                      onClick={() => set(def.knob, v.value)}
                    >
                      {on ? (
                        <motion.span
                          className="seg-fill"
                          layoutId={reduce ? undefined : `fill-${def.knob}`}
                          transition={{ type: "spring", stiffness: 520, damping: 40 }}
                          style={{
                            background: changed ? "var(--cyan-dim)" : "var(--amber-dim)",
                            boxShadow: `inset 0 0 0 1px ${changed ? "var(--cyan-line)" : "var(--amber-line)"}`,
                          }}
                        />
                      ) : null}
                      <span className="seg-label" style={on ? { color: changed ? "var(--cyan)" : "var(--amber)" } : undefined}>
                        {isMaster ? <i className="master-dot" aria-label="master value" /> : null}
                        {v.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
