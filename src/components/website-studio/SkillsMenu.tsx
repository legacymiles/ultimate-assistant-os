"use client";

// ---------------------------------------------------------------------------
// Web design skills — the dropdown, driven by the real registry.
//
// Nothing in here is a list of skill names. It renders whatever
// `studioSkills()` returns, which IS the design-skill roster a hook appends to
// every time a design skill is installed — so a skill that lands tomorrow is
// in this menu tomorrow, with its own description and its "best for" line.
//
// The rules it enforces are the combination rules, not the catalogue: one look
// at a time, passes and centrepieces stack, Impeccable always closes, and
// anything that spends money or renders footage is opt-in and says so.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  CLOSING_PASS,
  combine,
  comboLabel,
  skillGroups,
  studioSkills,
  toggleSkill,
  type StudioSkill,
} from "@/lib/website-studio/skills";

interface Props {
  picks: string[];
  onChange: (picks: string[]) => void;
  /** Every skill offered. Defaults to the whole roster. */
  skills?: StudioSkill[];
  /** Drawn inside the start slab (compact) rather than as its own control. */
  compact?: boolean;
}

export function SkillsMenu({ picks, onChange, skills = studioSkills(), compact }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const combo = combine(picks, skills);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const groups = skillGroups(skills);

  return (
    <div className={`ws-skills${compact ? " compact" : ""}`} ref={wrap}>
      <button
        type="button"
        className="ws-skills-btn"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        title="Which design skills drive the look"
      >
        <SparkIcon />
        <span className="ws-skills-name">{comboLabel(combo)}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="ws-skills-menu" role="dialog" aria-label="Web design skills">
          <div className="ws-skills-head">
            <b>Web design skills</b>
            <span>
              {combo.order.join(" → ")}
            </span>
          </div>
          <div className="ws-skills-scroll">
            {groups.map((g) => (
              <section key={g.role} className="ws-skills-group">
                <h4>{g.label}</h4>
                {g.skills.map((s) => {
                  const on = combo.order.includes(s.name);
                  const locked = s.name === CLOSING_PASS;
                  return (
                    <button
                      key={s.name}
                      type="button"
                      className={`ws-skill${on ? " on" : ""}${locked ? " locked" : ""}`}
                      aria-pressed={on}
                      onClick={() => !locked && onChange(toggleSkill(picks, s.name, skills))}
                      title={locked ? "Always closes the look pass" : s.description}
                    >
                      <span className="ws-skill-mark" aria-hidden>
                        {on ? <Tick /> : null}
                      </span>
                      <span className="ws-skill-body">
                        <span className="ws-skill-name">
                          {s.name}
                          {s.paid && <em className="ws-skill-paid">costs money</em>}
                          {locked && <em className="ws-skill-always">always</em>}
                        </span>
                        <span className="ws-skill-desc">{s.bestFor || s.description}</span>
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
          {combo.paid.length > 0 && (
            <p className="ws-skills-note">
              {combo.paid.join(", ")} {combo.paid.length === 1 ? "spends" : "spend"} money or renders footage. Pictures and
              video are still made locally with WanGP.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`ws-chev${open ? " up" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}
