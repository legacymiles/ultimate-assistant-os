"use client";

import { Icon } from "../../icons";
import { Avatar } from "./bits";
import { colourOf, type PublicMember } from "@/lib/recall/lists/types";

// ---------------------------------------------------------------------------
// Whose items to show.
//
// An empty selection means everyone — the natural default, and it keeps the
// "All" chip honest rather than making it a fake member you have to remember to
// re-select. Any combination is allowed: one person, three of five, nobody in
// particular.
// ---------------------------------------------------------------------------

interface Props {
  members: PublicMember[];
  /** Member ids. Empty = show everyone. */
  active: string[];
  onChange: (next: string[]) => void;
  counts: Record<string, number>;
  isAdmin: boolean;
  onManage: () => void;
}

export function MemberFilter({ members, active, onChange, counts, isAdmin, onManage }: Props) {
  const all = active.length === 0;
  const toggle = (id: string) =>
    onChange(active.includes(id) ? active.filter((x) => x !== id) : [...active, id]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => onChange([])}
        aria-pressed={all}
        className={
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition " +
          (all
            ? "border-brand bg-brand/15 text-brand"
            : "border-line text-ink-muted hover:border-ink-faint hover:text-ink")
        }
      >
        <Icon.Users width={12} height={12} />
        Everyone
      </button>

      {members.map((m) => {
        const on = active.includes(m.id);
        const c = colourOf(m.colour);
        return (
          <button
            key={m.id}
            onClick={() => toggle(m.id)}
            aria-pressed={on}
            title={`${m.name} — ${counts[m.id] ?? 0} open`}
            className={
              "inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[11.5px] font-medium transition " +
              (on ? c.chip : "border-line text-ink-muted hover:border-ink-faint hover:text-ink")
            }
          >
            <Avatar member={m} size={18} />
            <span className="max-w-[8rem] truncate">{m.name}</span>
            {(counts[m.id] ?? 0) > 0 && (
              <span className="tabular-nums opacity-70">{counts[m.id]}</span>
            )}
          </button>
        );
      })}

      {isAdmin && (
        <button
          onClick={onManage}
          title="Invite family, manage members"
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-faint transition hover:border-brand/50 hover:text-brand"
        >
          <Icon.Plus width={12} height={12} />
          Invite
        </button>
      )}
    </div>
  );
}
