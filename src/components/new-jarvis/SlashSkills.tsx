"use client";

// ---------------------------------------------------------------------------
// `/` lists the owner's skills, in whatever box is asking for a job.
//
// The skill store already exists; this is only the menu. On pick it writes a
// sentence the build agent can act on ("Use my <name> skill: ") instead of a
// bare slash token, so a cloud model that has never seen the skill still knows
// what was meant, and Claude Code / dsh — which do have the skills — get the
// name they know.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { listSkills } from "@/lib/skills/store";
import type { Skill } from "@/lib/skills/types";

const TRIGGER = /(?:^|\s)\/([^\s/]*)$/;

/** What the menu needs of a skill. A store Skill is one; so is a design-roster entry. */
export type SlashItem = Pick<Skill, "id" | "title" | "overview">;

/** The text with the current `/query` replaced by a skill sentence. */
export function withSkill(text: string, skill: Pick<Skill, "title">): string {
  return text.replace(TRIGGER, (match) => `${match.startsWith(" ") ? " " : ""}Use my "${skill.title}" skill: `);
}

export function SlashSkills<T extends SlashItem = Skill>({
  text,
  onPick,
  skills: fixed,
  label = "Skills",
}: {
  text: string;
  onPick: (skill: T) => void;
  /**
   * A fixed list instead of the whole skill store. Website Studio passes its
   * design roster, so `/` there lists design skills and nothing else.
   */
  skills?: T[];
  label?: string;
}) {
  const match = TRIGGER.exec(text);
  const query = match ? match[1] : null;
  const [stored, setSkills] = useState<T[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">(fixed ? "ready" : "idle");
  const skills = fixed ?? stored;

  useEffect(() => {
    if (fixed || query === null || state !== "idle") return;
    setState("loading");
    void listSkills()
      .then((list) => {
        setSkills(list as unknown as T[]);
        setState("ready");
      })
      .catch(() => setState("failed"));
  }, [fixed, query, state]);

  const found = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    // A fixed list is short and chosen on purpose: all of it shows.
    const cap = fixed ? skills.length : 8;
    if (!q) return skills.slice(0, cap);
    return skills
      .filter((s) => s.title.toLowerCase().includes(q) || s.overview.toLowerCase().includes(q))
      .slice(0, cap);
  }, [skills, query, fixed]);

  if (query === null) return null;

  return (
    <div className="absolute bottom-full left-0 z-40 mb-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-panel shadow-[0_18px_50px_rgba(0,0,0,0.5)]">
      <p className="border-b border-line-soft px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
        {label} · {query ? `“${query}”` : "type to filter"}
      </p>
      {state === "loading" && <p className="px-3 py-2 text-[11px] text-ink-muted">Reading your skills…</p>}
      {state === "failed" && <p className="px-3 py-2 text-[11px] text-ink-muted">Your skills couldn't be read just now.</p>}
      {state === "ready" && found.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-ink-muted">No skill called “{query}”.</p>
      )}
      {found.length > 0 && (
        <ul className="max-h-64 overflow-y-auto py-1">
          {found.map((skill) => (
            <li key={skill.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // Keep the box focused; a blur would close the menu first.
                  e.preventDefault();
                  onPick(skill);
                }}
                className="flex w-full flex-col px-3 py-1.5 text-left transition hover:bg-elevated"
              >
                <span className="text-[12px] text-ink">{skill.title}</span>
                <span className="truncate text-[10.5px] text-ink-muted">{skill.overview}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
