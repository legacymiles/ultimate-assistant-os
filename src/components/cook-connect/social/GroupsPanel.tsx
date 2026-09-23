"use client";

// The groups half of Explore: what exists, who is in it, and a way to start
// one. Each row goes straight into the group's conversation.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCook } from "../CookConnect";
import {
  createGroup, hueFor, joinGroup, leaveGroup, loadGroups, STARTER_GROUPS,
} from "@/lib/cook-connect/groups";
import type { GroupSummary } from "@/lib/cook-connect/types";
import {
  Button, EmptyState, Field, Input, Loading, Panel, SearchField, SectionHead, Textarea, cx,
} from "../ui";
import { PeopleIcon, PlusIcon, SearchIcon } from "../icons";

export function GroupsPanel() {
  const { sb, userId, navigate, notify } = useCook();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setGroups(await loadGroups(sb, userId));
    setLoading(false);
  }, [sb, userId]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(needle) || (g.description ?? "").toLowerCase().includes(needle));
  }, [groups, term]);

  const make = async (entry: { name: string; description?: string; hue?: number }) => {
    if (!userId || !entry.name.trim()) return;
    setBusy("new");
    const { group, error } = await createGroup(sb, userId, entry);
    setBusy(null);
    if (error) { notify(`Couldn't start it: ${error.message}`); return; }
    setName("");
    setDescription("");
    setMaking(false);
    await load();
    notify(`${entry.name.trim()} is open. You're the first member.`);
    if (group) navigate({ page: "group", id: group.id });
  };

  const toggle = async (g: GroupSummary) => {
    if (!userId) return;
    setBusy(g.id);
    if (g.joined) await leaveGroup(sb, g.id, userId);
    else {
      const error = await joinGroup(sb, g.id, userId);
      if (error) { notify(`Couldn't join: ${error.message}`); setBusy(null); return; }
    }
    setBusy(null);
    await load();
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cc-line)] p-2">
        <div className="min-w-[200px] flex-1">
          <SearchField
            value={term}
            onChange={setTerm}
            placeholder="Search groups"
            icon={<SearchIcon size={14} />}
          />
        </div>
        <Button variant="primary" onClick={() => setMaking((m) => !m)}>
          <PlusIcon size={14} />
          Start a group
        </Button>
      </div>

      {making && (
        <div className="flex flex-wrap items-end gap-2 border-b border-[var(--cc-line)] bg-[var(--cc-panel-2)] p-3">
          <div className="min-w-[170px] flex-1">
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void make({ name, description }); }}
                placeholder="Sunday Bakers"
                autoFocus
              />
            </Field>
          </div>
          <div className="min-w-[220px] flex-[2]">
            <Field label="What is it for">
              <Textarea
                rows={1}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Bread, pastry, and arguing about hydration."
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={!name.trim() || busy === "new"}
            onClick={() => void make({ name, description })}
          >
            Create
          </Button>
          <Button variant="ghost" onClick={() => setMaking(false)}>Cancel</Button>
        </div>
      )}

      <SectionHead title="Groups" count={shown.length} />

      {loading ? (
        <Loading label="Finding groups" />
      ) : shown.length === 0 ? (
        <div>
          <EmptyState
            icon={<PeopleIcon size={26} />}
            title={term ? `No group matches "${term}"` : "No groups yet"}
            body={
              term
                ? "Try a shorter word, or start one with that name."
                : "A group is a room with a subject: people who cook the same way, and one conversation between them. Start one, or take a suggestion."
            }
          />
          {!term && (
            <div className="border-t border-[var(--cc-line-soft)] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
                One tap to start
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STARTER_GROUPS.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    disabled={busy === "new"}
                    onClick={() => void make(s)}
                    title={s.description}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cc-line)]
                               bg-[var(--cc-elevated)] px-2.5 py-1.5 text-[12px] font-semibold
                               transition-colors duration-150 hover:border-[var(--cc-ember)] disabled:opacity-50"
                  >
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 rounded-full"
                      style={{ background: `hsl(${s.hue} 58% 52%)` }}
                    />
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <ul>
          {shown.map((g, i) => (
            <li
              key={g.id}
              className={cx(
                "cc-row flex items-center gap-3 px-3 py-2.5",
                i > 0 && "border-t border-[var(--cc-line-soft)]",
              )}
            >
              <span
                aria-hidden="true"
                className="h-9 w-9 shrink-0 rounded-lg"
                style={{
                  background: `linear-gradient(145deg, hsl(${g.hue} 55% 42%), hsl(${(g.hue + 40) % 360} 50% 26%))`,
                }}
              />
              <button
                type="button"
                onClick={() => navigate({ page: "group", id: g.id })}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[13px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                  {g.name}
                </span>
                {g.description && (
                  <span className="block truncate text-[12px] text-[var(--cc-ink-muted)]">{g.description}</span>
                )}
              </button>
              <span className="cc-num w-[74px] shrink-0 text-right text-[12px] text-[var(--cc-ink-muted)]">
                {g.members} member{g.members === 1 ? "" : "s"}
              </span>
              <Button
                variant={g.joined ? "secondary" : "primary"}
                disabled={busy === g.id}
                onClick={() => void toggle(g)}
              >
                {g.joined ? "Joined" : "Join"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Exported for the group page's colour, so both agree. */
export { hueFor };
