"use client";

import { Icon } from "../../icons";
import {
  REMOVED_MEMBER,
  colourOf,
  initials,
  priorityMeta,
  type Priority,
  type PublicMember,
} from "@/lib/recall/lists/types";

// ---------------------------------------------------------------------------
// The small shared pieces of the Lists board: who added it, how urgent it is,
// and which list it belongs to. Kept together because they are the board's
// entire visual vocabulary — three signals repeated everywhere.
// ---------------------------------------------------------------------------

/** Any Icon key, resolved by name so a list can store its icon as a string. */
export function ListIcon({
  name,
  ...props
}: { name: string } & React.SVGProps<SVGSVGElement>) {
  const Cmp = (Icon as Record<string, (p: React.SVGProps<SVGSVGElement>) => React.ReactElement>)[name]
    ?? Icon.Note;
  return <Cmp {...props} />;
}

/** The member circle. Colour is identity here, so it is never decorative. */
export function Avatar({
  member,
  size = 20,
  ring = false,
}: {
  member: PublicMember;
  size?: number;
  ring?: boolean;
}) {
  const c = colourOf(member.colour);
  return (
    <span
      title={member.name}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }}
      className={
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none " +
        c.dot + " " + c.ink + (ring ? " ring-2 ring-canvas" : "")
      }
    >
      {initials(member.name)}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: Priority }) {
  const meta = priorityMeta(priority);
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className={"h-2 w-2 shrink-0 rounded-full " + meta.dot}
    />
  );
}

/** Look up an author id against the roster, falling back to the placeholder. */
export function memberById(members: PublicMember[], id: string): PublicMember {
  return members.find((m) => m.id === id) ?? REMOVED_MEMBER;
}

// ----- due dates -----------------------------------------------------------

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dueState(dueDate?: string): "none" | "overdue" | "today" | "soon" | "later" {
  if (!dueDate) return "none";
  const at = Date.parse(`${dueDate}T00:00:00`);
  if (Number.isNaN(at)) return "none";
  const today = startOfToday();
  if (at < today) return "overdue";
  if (at === today) return "today";
  return at - today <= 3 * 24 * 60 * 60 * 1000 ? "soon" : "later";
}

/** "Today", "Tomorrow", "Fri 5 Sep" — short enough to sit on a dense row. */
export function dueLabel(dueDate: string): string {
  const at = Date.parse(`${dueDate}T00:00:00`);
  if (Number.isNaN(at)) return dueDate;
  const days = Math.round((at - startOfToday()) / (24 * 60 * 60 * 1000));
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  const d = new Date(at);
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

export function DueChip({ dueDate }: { dueDate: string }) {
  const state = dueState(dueDate);
  const tone =
    state === "overdue"
      ? "border-red-500/40 bg-red-500/15 text-red-300"
      : state === "today"
        ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
        : "border-line bg-panel-2 text-ink-faint";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[10px] font-medium " + tone
      }
    >
      <Icon.Clock width={9} height={9} />
      {dueLabel(dueDate)}
    </span>
  );
}
