"use client";

// ---------------------------------------------------------------------------
// Family & friends' birthdays — add, edit, remove.
//
// One component, two homes: the "Birthdays" step of onboarding and the
// Birthdays sheet (Calendar tab, Calendar widget). Mostly taps: pick who they
// are to you, pick a month and a day, done. The year is optional ("turns 30").
//
// Everything saved here shows on the Calendar every year and in Dashboard
// notifications from 2 days before — that is derived from this one list, so
// there is nothing else to keep in step. The chat writes to the same list
// ("add Mom's birthday, March 14").
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { addBirthday, deleteBirthday, restoreBirthday, useBirthdays } from "@/lib/birthdays/store";
import { MONTHS, bySoonest, daysInMonth, formatBirthday, guessCircle, whenPhrase, type Birthday, type Circle } from "@/lib/birthdays/engine";

const RELATIONS = ["Mom", "Dad", "Wife", "Husband", "Son", "Daughter", "Sister", "Brother", "Grandma", "Grandpa", "Aunt", "Uncle", "Cousin", "Best friend", "Friend"];

const field = "min-h-[40px] w-full rounded-lg border border-line bg-panel-2 px-3 text-[13px] text-ink placeholder:text-ink-faint";

interface Draft {
  id: string | null;
  name: string;
  relation: string;
  circle: Circle;
  /** Picked by hand, so typing a relation stops flipping it. */
  circleSet: boolean;
  month: number;
  day: number;
  year: string;
}

const EMPTY: Draft = { id: null, name: "", relation: "", circle: "family", circleSet: false, month: 0, day: 0, year: "" };

export function BirthdaysEditor({ compact = false }: { compact?: boolean }) {
  const { list } = useBirthdays();
  const [d, setD] = useState<Draft>(EMPTY);
  const [msg, setMsg] = useState<{ text: string; undo?: Birthday; bad?: boolean } | null>(null);
  const rows = useMemo(() => bySoonest(list), [list]);
  const dayMax = d.month ? daysInMonth(d.month, 2000) : 31;

  const setRelation = (relation: string) =>
    setD((x) => ({
      ...x,
      relation,
      // Mom/Dad/Cousin… is family, Best friend is a friend — unless they chose.
      circle: x.circleSet ? x.circle : guessCircle(relation, x.name),
    }));

  const save = () => {
    const name = d.name.trim() || d.relation.trim();
    if (!name) return setMsg({ text: "Add a name (or tap who they are).", bad: true });
    if (!d.month || !d.day) return setMsg({ text: "Pick the month and the day.", bad: true });
    // Editing someone under a new name: drop the old row so they aren't listed twice.
    const old = d.id ? list.find((b) => b.id === d.id) : null;
    if (old && old.name.trim().toLowerCase() !== name.toLowerCase()) deleteBirthday(old.id);
    const out = addBirthday({
      name,
      relation: d.name.trim() && d.relation.trim() ? d.relation.trim() : undefined,
      circle: d.circle,
      month: d.month,
      day: d.day,
      year: d.year.trim() ? Number(d.year) : null,
    });
    if ("error" in out) return setMsg({ text: out.error, bad: true });
    setMsg({ text: `${out.outcome === "updated" ? "Updated" : "Saved"} — ${out.birthday.name}, ${formatBirthday(out.birthday)}. It's on your calendar.` });
    setD({ ...EMPTY, circle: d.circle });
  };

  const edit = (b: Birthday) => {
    setD({
      id: b.id,
      name: b.name,
      relation: b.relation ?? "",
      circle: b.circle,
      circleSet: true,
      month: b.month,
      day: b.day,
      year: b.year ? String(b.year) : "",
    });
    setMsg(null);
  };

  const remove = (b: Birthday) => {
    deleteBirthday(b.id);
    if (d.id === b.id) setD(EMPTY);
    setMsg({ text: `Removed ${b.name}'s birthday.`, undo: b });
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-ink-muted">Name</span>
          <input
            className={field}
            value={d.name}
            placeholder={d.relation || "e.g. Linda"}
            autoComplete="off"
            onKeyDown={onEnter}
            onChange={(e) => setD((x) => ({ ...x, name: e.target.value, circle: x.circleSet ? x.circle : guessCircle(x.relation, e.target.value) }))}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-ink-muted">Who they are to you (optional)</span>
          <input className={field} value={d.relation} placeholder="Mom, best friend, cousin…" onKeyDown={onEnter} onChange={(e) => setRelation(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="Quick pick">
        {RELATIONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={d.relation === r}
            onClick={() => setRelation(d.relation === r ? "" : r)}
            className={`deck-btn rounded-full ${d.relation === r ? "deck-btn--go" : ""}`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_88px_96px] gap-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-ink-muted">Month</span>
          <select className={field} value={d.month} onChange={(e) => setD((x) => ({ ...x, month: Number(e.target.value), day: Math.min(x.day, daysInMonth(Number(e.target.value) || 1, 2000)) }))}>
            <option value={0}>Month…</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-ink-muted">Day</span>
          <select className={field} value={d.day} onChange={(e) => setD((x) => ({ ...x, day: Number(e.target.value) }))}>
            <option value={0}>Day</option>
            {Array.from({ length: dayMax }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-ink-muted">Year (optional)</span>
          <input
            className={field}
            inputMode="numeric"
            maxLength={4}
            value={d.year}
            placeholder="1990"
            onKeyDown={onEnter}
            onChange={(e) => setD((x) => ({ ...x, year: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Family or friend">
          {(["family", "friend"] as Circle[]).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={d.circle === c}
              onClick={() => setD((x) => ({ ...x, circle: c, circleSet: true }))}
              className={`min-h-[34px] rounded-md px-3 text-[12px] capitalize ${d.circle === c ? "bg-elevated text-ink" : "text-ink-muted hover:text-ink"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <button type="button" className="deck-btn deck-btn--go ml-auto" onClick={save}>
          <Icon.Plus width={12} height={12} aria-hidden /> {d.id ? "Save changes" : "Add birthday"}
        </button>
        {d.id && (
          <button type="button" className="deck-btn" onClick={() => setD(EMPTY)}>
            Cancel
          </button>
        )}
      </div>

      {msg && (
        <p role="status" className={`flex items-center gap-2 text-[12px] ${msg.bad ? "text-[var(--hud-amber)]" : "text-ink-muted"}`}>
          {msg.text}
          {msg.undo && (
            <button
              type="button"
              className="text-[var(--hud)] hover:underline"
              onClick={() => {
                restoreBirthday(msg.undo!);
                setMsg({ text: `${msg.undo!.name}'s birthday is back.` });
              }}
            >
              Undo
            </button>
          )}
        </p>
      )}

      {rows.length > 0 ? (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line" aria-label="Birthdays, soonest first">
          {rows.map(({ b, days, turns }) => (
            <li key={b.id} className="flex items-center gap-2 px-3 py-2">
              <span className="text-[15px]" aria-hidden>
                🎂
              </span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => edit(b)} aria-label={`Edit ${b.name}'s birthday`}>
                <span className="block truncate text-[12.5px] text-ink">
                  {b.name}
                  {b.relation ? <span className="text-ink-faint"> · {b.relation}</span> : null}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-ink-faint">
                  {formatBirthday({ ...b, year: null })} · {whenPhrase(days)}
                  {turns ? ` · turns ${turns}` : ""} · {b.circle}
                </span>
              </button>
              {days <= 2 && <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] text-[var(--hud-amber)]" style={{ background: "color-mix(in srgb, var(--hud-amber) 15%, transparent)" }}>soon</span>}
              <button type="button" onClick={() => remove(b)} aria-label={`Remove ${b.name}'s birthday`} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-panel-2 hover:text-ink">
                <Icon.Trash width={13} height={13} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11.5px] text-ink-faint">No birthdays yet.</p>
      )}

      <p className="text-[11px] text-ink-faint">
        Each one shows on your Calendar every year and in Notifications from 2 days before. You can also just tell the chat: &ldquo;add Mom&apos;s birthday, March 14&rdquo;.
      </p>
    </div>
  );
}
