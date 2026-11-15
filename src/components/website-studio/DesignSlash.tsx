"use client";

// ---------------------------------------------------------------------------
// `/` in Website Studio lists the owner's website design skills — the design
// roster, grouped and ordered exactly like the Skills dropdown — and nothing
// else. The shared menu used to list the first eight skills in the whole store
// (deploy helpers, video tools, memory skills), which is not what a website
// edit box is asking for.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { slashEntries } from "@/lib/website-studio/skills";
import { SlashSkills, withSkill } from "../new-jarvis/SlashSkills";

export function DesignSlash({
  text,
  onText,
  onPick,
}: {
  text: string;
  onText: (next: string) => void;
  /** Also tick the skill wherever this screen keeps a skill selection. */
  onPick?: (name: string) => void;
}) {
  const items = useMemo(() => slashEntries(), []);
  return (
    <SlashSkills
      text={text}
      skills={items}
      label="Design skills"
      onPick={(item) => {
        onText(withSkill(text, item));
        onPick?.(item.id);
      }}
    />
  );
}
